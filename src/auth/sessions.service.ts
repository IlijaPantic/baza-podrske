import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { sha256Hex } from '../common/normalize';
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from './auth.constants';

export type ValidSession = {
  id: string;
  userId: string;
  /** Control region the admin is scoped to. */
  controlRegionId: number;
  csrfToken: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
};

/**
 * Service for server-side sessions.
 *
 * Session ID is 256-bit random base64url (43 chars). Browser cookie holds
 * only the ID; everything else is in the DB. Validation on each request checks:
 *  - session exists
 *  - not revoked
 *  - idle and absolute expiry not passed
 * On successful validation, idle_expires_at is moved forward.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate a cryptographically random token encoded as base64url.
   * 32 bytes = 256 bits entropy = 43 chars base64url without padding.
   */
  private generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Create a new session for a user and return (id, csrfToken).
   * IP hash uses salt from system_config (rotates in Phase 2).
   */
  async create(opts: {
    userId: string;
    controlRegionId: number;
    ipAddress: string;
    userAgent: string;
    ipSalt: string;
  }): Promise<ValidSession> {
    const id = this.generateToken();
    const csrfToken = this.generateToken();
    const now = new Date();
    const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
    const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
    const ipHash = sha256Hex(`${opts.ipAddress}::${opts.ipSalt}`);

    await this.prisma.session.create({
      data: {
        id,
        userId: opts.userId,
        csrfToken,
        ipHash,
        userAgent: opts.userAgent.slice(0, 500),
        idleExpiresAt,
        absoluteExpiresAt,
      },
    });

    this.logger.log(`Sesija kreirana: user=${opts.userId.slice(0, 8)} cr=${opts.controlRegionId} sid=${id.slice(0, 6)}…`);
    return {
      id,
      userId: opts.userId,
      controlRegionId: opts.controlRegionId,
      csrfToken,
      idleExpiresAt,
      absoluteExpiresAt,
    };
  }

  /**
   * Validate session ID from cookie and refresh idle timer.
   * Returns null if session missing, expired, or revoked.
   */
  async validateAndTouch(sessionId: string): Promise<ValidSession | null> {
    if (!sessionId || typeof sessionId !== 'string' || sessionId.length !== 43) {
      return null;
    }

    const row = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: { select: { controlRegionId: true, deletedAt: true } } },
    });
    if (!row) return null;
    if (row.revokedAt) return null;
    // If the underlying admin was deactivated, treat the session as invalid.
    if (row.user?.deletedAt) return null;

    const now = new Date();
    if (row.absoluteExpiresAt <= now) return null;
    if (row.idleExpiresAt <= now) return null;

    // Refresh idle timer (only if changed by more than 60s — fewer DB writes)
    const newIdleExpires = new Date(now.getTime() + SESSION_IDLE_MS);
    if (newIdleExpires.getTime() - row.idleExpiresAt.getTime() > 60_000) {
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { idleExpiresAt: newIdleExpires, lastSeenAt: now },
      });
    }

    return {
      id: row.id,
      userId: row.userId,
      controlRegionId: row.user!.controlRegionId,
      csrfToken: row.csrfToken,
      idleExpiresAt: newIdleExpires,
      absoluteExpiresAt: row.absoluteExpiresAt,
    };
  }

  /**
   * Raw lookup by sessionId — returns { userId } if row exists;
   * does not validate expiry or revoke. Used for audit on logout
   * (to know who logged out even if session expired in the meantime).
   */
  async lookupRaw(
    sessionId: string,
  ): Promise<{ userId: string; controlRegionId: number | null } | null> {
    if (!sessionId || typeof sessionId !== 'string') return null;
    const row = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, user: { select: { controlRegionId: true } } },
    });
    if (!row) return null;
    return { userId: row.userId, controlRegionId: row.user?.controlRegionId ?? null };
  }

  /**
   * Logout — mark session revoked (better than delete for audit trail).
   */
  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revoke all sessions for a user (e.g. "sign out all devices" or password change).
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const res = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }

  /**
   * CSRF token verification — constant-time comparison (mitigates timing attacks).
   * `expected` is from session (DB), `actual` is from cookie or header/form.
   */
  verifyCsrf(expected: string, actual: string | undefined | null): boolean {
    if (!actual || typeof actual !== 'string') return false;
    if (expected.length !== actual.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
    } catch {
      return false;
    }
  }
}
