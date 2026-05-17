import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from './sessions.service';
import { LoginRateLimitService } from './rate-limit.service';
import { AuditService } from '../audit/audit.service';
import { AuditEvent, maskEmail } from '../audit/audit.events';
import { TotpService } from './totp.service';
import {
  ARGON2_OPTIONS,
  LOGIN_LOCK_DURATION_MS,
  LOGIN_LOCK_THRESHOLD,
  PASSWORD_MIN_LENGTH,
} from './auth.constants';

/**
 * AuthService — core logic for login, password hashing, and account lockout.
 *
 * Protections we implement:
 *  1. Constant-time email/password comparison (Argon2id verify)
 *  2. Generic error "neispravan email ili lozinka" — does not reveal whether the email exists
 *  3. Per-account lockout (5 failures → 15 min locked)
 *  4. Per-IP rate limit (10 attempts / 5 min) — before Argon2 verify (cheap)
 *  5. Dummy verify when user does not exist — mitigates timing attacks for email probing
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Password hash always used for dummy verify (mitigates timing attacks). */
  private dummyHashPromise: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly rateLimit: LoginRateLimitService,
    private readonly audit: AuditService,
    private readonly totp: TotpService,
  ) {
    // Pre-compute dummy hash synchronously at startup (~100ms on a laptop)
    this.dummyHashPromise = argonHash('dummy-password-for-timing-safety', {
      ...ARGON2_OPTIONS,
      algorithm: Algorithm.Argon2id,
    });
  }

  /**
   * Hash a new password — used in the bootstrap script and when changing password.
   */
  async hashPassword(plain: string): Promise<string> {
    if (typeof plain !== 'string') {
      throw new Error('Lozinka mora biti string');
    }
    if (plain.length < PASSWORD_MIN_LENGTH) {
      throw new Error(`Lozinka mora imati minimum ${PASSWORD_MIN_LENGTH} karaktera`);
    }
    if (plain.length > 200) {
      throw new Error('Lozinka je preduga (max 200 karaktera)');
    }
    return argonHash(plain, { ...ARGON2_OPTIONS, algorithm: Algorithm.Argon2id });
  }

  /**
   * Attempt login (step 1). Returns:
   *   - `requires2fa: false` when user has no 2FA — caller may create session immediately
   *   - `requires2fa: true` when user has 2FA — caller must issue pending token
   *     and show 2FA challenge page
   *
   * On error throws UnauthorizedException with a generic message.
   */
  async verifyCredentials(opts: {
    email: string;
    password: string;
    ipAddress: string;
    userAgent?: string;
  }): Promise<{ userId: string; requires2fa: boolean }> {
    const email = opts.email?.trim()?.toLowerCase();
    const password = opts.password ?? '';
    const auditCtx = {
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent ?? '',
    };

    // 1) Rate limit per IP (cheap, before DB lookup)
    if (this.rateLimit.tooMany(opts.ipAddress)) {
      this.logger.warn(`Login blokiran — rate limit IP=${opts.ipAddress.slice(0, 20)}`);
      await this.audit.log({
        event: AuditEvent.LOGIN_RATE_LIMITED,
        ...auditCtx,
        metadata: { emailMasked: maskEmail(email) },
      });
      throw new HttpException(
        'Previše pokušaja. Pokušajte ponovo za nekoliko minuta.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!email || !password) {
      this.rateLimit.recordFailure(opts.ipAddress);
      // Dummy verify for constant-time behavior even when fields are empty
      await this.dummyVerify();
      await this.audit.log({
        event: AuditEvent.LOGIN_FAIL,
        ...auditCtx,
        metadata: { reason: 'empty_fields' },
      });
      throw new UnauthorizedException('Neispravan email ili lozinka.');
    }

    // 2) Load user
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // 3) If user does not exist — dummy verify then generic error
    if (!user || user.deletedAt) {
      this.rateLimit.recordFailure(opts.ipAddress);
      await this.dummyVerify();
      await this.audit.log({
        event: AuditEvent.LOGIN_FAIL,
        ...auditCtx,
        metadata: {
          reason: user?.deletedAt ? 'deactivated' : 'unknown_user',
          emailMasked: maskEmail(email),
        },
      });
      throw new UnauthorizedException('Neispravan email ili lozinka.');
    }

    // 4) Lockout check
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      const minutesLeft = Math.ceil(
        (user.lockedUntil.getTime() - now.getTime()) / 60000,
      );
      this.logger.warn(`Login blokiran — account locked user=${user.id.slice(0, 8)}`);
      await this.audit.log({
        event: AuditEvent.LOGIN_LOCKED,
        userId: user.id,
        ...auditCtx,
        metadata: { minutesLeft },
      });
      throw new UnauthorizedException(
        `Nalog je privremeno zaključan zbog previše neuspelih pokušaja. Pokušajte za ${minutesLeft} min.`,
      );
    }

    // 5) Argon2id verify
    let ok = false;
    try {
      ok = await argonVerify(user.passwordHash, password);
    } catch (e) {
      this.logger.error(
        `Greška u argonVerify za user=${user.id.slice(0, 8)}: ${(e as Error).message}`,
      );
      ok = false;
    }

    if (!ok) {
      this.rateLimit.recordFailure(opts.ipAddress);
      const newCount = user.failedLoginCount + 1;
      const data: { failedLoginCount: number; lockedUntil?: Date } = {
        failedLoginCount: newCount,
      };
      const willLock = newCount >= LOGIN_LOCK_THRESHOLD;
      if (willLock) {
        data.lockedUntil = new Date(now.getTime() + LOGIN_LOCK_DURATION_MS);
        this.logger.warn(
          `Account zaključan — user=${user.id.slice(0, 8)} count=${newCount}`,
        );
      }
      await this.prisma.user.update({ where: { id: user.id }, data });
      await this.audit.log({
        event: AuditEvent.LOGIN_FAIL,
        userId: user.id,
        ...auditCtx,
        metadata: {
          reason: 'wrong_password',
          failedCount: newCount,
          willLock,
        },
      });
      throw new UnauthorizedException('Neispravan email ili lozinka.');
    }

    // 6) Password OK — check whether 2FA is enabled
    const has2fa = !!user.totpEnabledAt && !!user.totpSecret;

    if (has2fa) {
      // Reset only rate limit; failedLoginCount and lockout reset
      // ONLY after 2FA succeeds, so credential stuffing with a stolen password
      // can still exhaust the lockout threshold quickly.
      this.rateLimit.reset(opts.ipAddress);
      this.logger.log(
        `Login step 1 OK (2FA needed): user=${user.id.slice(0, 8)}`,
      );
      return { userId: user.id, requires2fa: true };
    }

    // No 2FA → final success
    await this.finalizeLoginSuccess(user.id, opts.ipAddress, opts.userAgent);
    return { userId: user.id, requires2fa: false };
  }

  /**
   * Step 2 — verify 6-digit TOTP code. Caller must have already validated
   * pending login token (HMAC + ttl) and pass `userId` from that token.
   *
   * On error: increment failedLoginCount (may trigger lockout) and
   * throw UnauthorizedException.
   */
  async verifyTotpAndFinalize(opts: {
    userId: string;
    code: string;
    ipAddress: string;
    userAgent?: string;
  }): Promise<{ userId: string }> {
    const auditCtx = {
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent ?? '',
    };

    // 1) Rate limit (same bucket as login)
    if (this.rateLimit.tooMany(opts.ipAddress)) {
      await this.audit.log({
        event: AuditEvent.LOGIN_RATE_LIMITED,
        userId: opts.userId,
        ...auditCtx,
        metadata: { phase: '2fa' },
      });
      throw new HttpException(
        'Previše pokušaja. Pokušajte ponovo za nekoliko minuta.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2) Load user
    const user = await this.prisma.user.findUnique({
      where: { id: opts.userId },
    });
    if (
      !user ||
      user.deletedAt ||
      !user.totpEnabledAt ||
      !user.totpSecret
    ) {
      // Token valid but user invalid / 2FA disabled → skip step 2.
      // Generic error, audit.
      await this.audit.log({
        event: AuditEvent.LOGIN_2FA_FAIL,
        userId: opts.userId,
        ...auditCtx,
        metadata: { reason: 'invalid_state' },
      });
      throw new UnauthorizedException('Neispravan kod. Prijavite se ponovo.');
    }

    // 3) Lockout check (same counter as for password)
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      const minutesLeft = Math.ceil(
        (user.lockedUntil.getTime() - now.getTime()) / 60000,
      );
      await this.audit.log({
        event: AuditEvent.LOGIN_LOCKED,
        userId: user.id,
        ...auditCtx,
        metadata: { phase: '2fa', minutesLeft },
      });
      throw new UnauthorizedException(
        `Nalog je privremeno zaključan. Pokušajte za ${minutesLeft} min.`,
      );
    }

    // 4) Verify TOTP
    const codeOk = this.totp.verifyCode(opts.code, user.totpSecret);
    if (!codeOk) {
      this.rateLimit.recordFailure(opts.ipAddress);
      const newCount = user.failedLoginCount + 1;
      const data: { failedLoginCount: number; lockedUntil?: Date } = {
        failedLoginCount: newCount,
      };
      const willLock = newCount >= LOGIN_LOCK_THRESHOLD;
      if (willLock) {
        data.lockedUntil = new Date(now.getTime() + LOGIN_LOCK_DURATION_MS);
      }
      await this.prisma.user.update({ where: { id: user.id }, data });
      await this.audit.log({
        event: AuditEvent.LOGIN_2FA_FAIL,
        userId: user.id,
        ...auditCtx,
        metadata: {
          reason: 'wrong_code',
          failedCount: newCount,
          willLock,
        },
      });
      throw new UnauthorizedException('Neispravan kod. Pokušajte ponovo.');
    }

    // 5) Success
    await this.finalizeLoginSuccess(user.id, opts.ipAddress, opts.userAgent, {
      via2fa: true,
    });
    return { userId: user.id };
  }

  /** Reset counters; record LOGIN_OK or LOGIN_2FA_OK. */
  private async finalizeLoginSuccess(
    userId: string,
    ipAddress: string,
    userAgent: string | undefined,
    opts?: { via2fa?: boolean },
  ): Promise<void> {
    this.rateLimit.reset(ipAddress);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });
    await this.audit.log({
      event: opts?.via2fa ? AuditEvent.LOGIN_2FA_OK : AuditEvent.LOGIN_OK,
      userId,
      ipAddress,
      userAgent: userAgent ?? '',
    });
    this.logger.log(
      `Login finalized (${opts?.via2fa ? '2fa' : 'password'}): user=${userId.slice(0, 8)}`,
    );
  }

  /**
   * Generate secret + otpauth URI + QR data URL for enrollment.
   * Does NOT persist — caller (TotpController) stores secret only after
   * the user confirms the first code.
   */
  async startTotpEnrollment(opts: {
    userId: string;
    email: string;
  }): Promise<{ secret: string; otpAuthUri: string; qrDataUrl: string }> {
    const secret = this.totp.generateSecret();
    const uri = this.totp.otpAuthUri(opts.email, secret);
    const qr = await this.totp.qrCodeDataUrl(uri);
    return { secret, otpAuthUri: uri, qrDataUrl: qr };
  }

  /**
   * Confirm enrollment: verify first 6-digit code. When it passes,
   * persist secret and set totpEnabledAt.
   */
  async confirmTotpEnrollment(opts: {
    userId: string;
    secret: string;
    code: string;
    ipAddress: string;
    userAgent?: string;
  }): Promise<boolean> {
    if (!this.totp.verifyCode(opts.code, opts.secret)) {
      await this.audit.log({
        event: AuditEvent.LOGIN_2FA_FAIL,
        userId: opts.userId,
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent ?? '',
        metadata: { reason: 'enrollment_code_wrong' },
      });
      return false;
    }
    await this.prisma.user.update({
      where: { id: opts.userId },
      data: {
        totpSecret: opts.secret,
        totpEnabledAt: new Date(),
      },
    });
    await this.audit.log({
      event: AuditEvent.TOTP_ENABLED,
      userId: opts.userId,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent ?? '',
    });
    return true;
  }

  /**
   * Self-service password change. Verifies the current password, hashes the
   * new one, and revokes all OTHER active sessions of this user (the current
   * session is preserved so the admin stays logged in).
   *
   * Returns a tagged result instead of throwing so the controller can render
   * a friendly form error.
   */
  async changeOwnPassword(opts: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    /** Current session id — will NOT be revoked (admin stays logged in). */
    keepSessionId: string;
    ipAddress: string;
    userAgent?: string;
  }): Promise<
    | { ok: true; revokedOtherSessions: number }
    | { ok: false; reason: 'wrong_current' | 'invalid_new' | 'same_as_old' | 'no_user'; message: string }
  > {
    const user = await this.prisma.user.findUnique({
      where: { id: opts.userId },
      select: { id: true, passwordHash: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      return { ok: false, reason: 'no_user', message: 'Korisnik ne postoji.' };
    }

    let passwordOk = false;
    try {
      passwordOk = await argonVerify(user.passwordHash, opts.currentPassword);
    } catch {
      passwordOk = false;
    }
    if (!passwordOk) {
      await this.audit.log({
        event: AuditEvent.PASSWORD_CHANGE_FAILED,
        userId: opts.userId,
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent ?? '',
        metadata: { reason: 'wrong_current' },
      });
      return {
        ok: false,
        reason: 'wrong_current',
        message: 'Trenutna lozinka nije ispravna.',
      };
    }

    if (opts.newPassword === opts.currentPassword) {
      return {
        ok: false,
        reason: 'same_as_old',
        message: 'Nova lozinka mora biti različita od trenutne.',
      };
    }

    let newHash: string;
    try {
      newHash = await this.hashPassword(opts.newPassword);
    } catch (e: any) {
      return {
        ok: false,
        reason: 'invalid_new',
        message: e?.message ?? 'Nova lozinka nije validna.',
      };
    }

    const [, revoked] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: opts.userId },
        data: {
          passwordHash: newHash,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.session.updateMany({
        where: {
          userId: opts.userId,
          revokedAt: null,
          id: { not: opts.keepSessionId },
        },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.log({
      event: AuditEvent.PASSWORD_CHANGED,
      userId: opts.userId,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent ?? '',
      metadata: { revokedOtherSessions: revoked.count },
    });

    this.logger.log(
      `Password changed: user=${opts.userId.slice(0, 8)} other_sessions_revoked=${revoked.count}`,
    );
    return { ok: true, revokedOtherSessions: revoked.count };
  }

  /** Disable 2FA. Requires current code confirmation. */
  async disableTotp(opts: {
    userId: string;
    code: string;
    ipAddress: string;
    userAgent?: string;
  }): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: opts.userId } });
    if (!user || !user.totpSecret || !user.totpEnabledAt) {
      return false; // already disabled
    }
    if (!this.totp.verifyCode(opts.code, user.totpSecret)) {
      await this.audit.log({
        event: AuditEvent.LOGIN_2FA_FAIL,
        userId: opts.userId,
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent ?? '',
        metadata: { reason: 'disable_code_wrong' },
      });
      return false;
    }
    await this.prisma.user.update({
      where: { id: opts.userId },
      data: { totpSecret: null, totpEnabledAt: null },
    });
    await this.audit.log({
      event: AuditEvent.TOTP_DISABLED,
      userId: opts.userId,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent ?? '',
    });
    return true;
  }

  private async dummyVerify(): Promise<void> {
    try {
      const dummyHash = await this.dummyHashPromise;
      await argonVerify(dummyHash, 'wrong-password');
    } catch {
      /* ignore */
    }
  }
}
