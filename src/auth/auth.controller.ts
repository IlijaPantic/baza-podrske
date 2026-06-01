import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { PendingLoginTokenService } from './pending-login-token.service';
import { IpSaltService } from '../common/ip-salt.service';
import { AuditService } from '../audit/audit.service';
import { AuditEvent } from '../audit/audit.events';
import {
  ADMIN_BASE,
  ADMIN_PATH,
  CSRF_COOKIE,
  CSRF_COOKIE_OPTIONS,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_IDLE_MS,
} from './auth.constants';
import { loginPage, login2faPage } from './templates/login';
import { randomBytes } from 'node:crypto';

const LoginSchema = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
  _csrf: z.string().min(1).max(100),
});

const Login2faSchema = z.object({
  code: z.string().trim().min(6).max(10),
  _csrf: z.string().min(1).max(100),
  _pt: z.string().min(10).max(300),
});

/**
 * Login flow:
 *   GET  /kontrola-admin/login  → renders the form with a CSRF token in a hidden field and cookie
 *   POST /kontrola-admin/login  → validates CSRF, checks password, creates session, redirects to /kontrola-admin
 *   POST /kontrola-admin/logout → revokes session, clears cookies, redirects to /kontrola-admin/login
 *
 * NB: Login GET does not use SessionGuard (must be available to unauthenticated users).
 * NB: Login POST does not use SessionGuard or CsrfGuard — we apply "pre-session CSRF"
 *     manually (cookie ↔ form _csrf must match; both are issued on GET and are unrelated
 *     to the user session because there is none yet).
 */
@Controller(ADMIN_BASE)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly pendingToken: PendingLoginTokenService,
    private readonly ipSalt: IpSaltService,
    private readonly audit: AuditService,
  ) {}

  @Get('login')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Referrer-Policy', 'no-referrer')
  loginPage(@Res({ passthrough: true }) res: FastifyReply): string {
    // Pre-session CSRF token for the first POST
    const token = randomBytes(32).toString('base64url');
    res.setCookie(CSRF_COOKIE, token, {
      ...CSRF_COOKIE_OPTIONS,
      maxAge: 600, // 10 min — login form must not stay open indefinitely
    });
    return loginPage({ csrfToken: token });
  }

  @Post('login')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('X-Content-Type-Options', 'nosniff')
  async login(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<string | void> {
    const parsed = LoginSchema.safeParse(body);

    // Cookie token must exist and match the form field
    const cookieToken = req.cookies?.[CSRF_COOKIE] ?? '';
    const ipAddress = (req.ip || '').toString();

    if (!parsed.success || !cookieToken || cookieToken !== parsed.data._csrf) {
      this.logger.warn(`Login odbijen — CSRF mismatch ili nevalidno polje, IP=${ipAddress.slice(0,20)}`);
      // Return form with a new token and message
      return this.renderLoginError(res, '', 'Sesija forme je istekla. Probajte ponovo.');
    }

    const userAgent = (req.headers['user-agent'] || '').toString();

    try {
      const { userId, controlRegionId, role, assignedOpstinaSlug, requires2fa } =
        await this.auth.verifyCredentials({
          email: parsed.data.email,
          password: parsed.data.password,
          ipAddress,
          userAgent,
        });

      if (requires2fa) {
        // Issue pending token (HMAC, 5 min TTL) and show the 2FA challenge page.
        // Rotate CSRF cookie for the second POST.
        const pendingToken = this.pendingToken.issue(userId);
        const newCsrf = randomBytes(32).toString('base64url');
        res.setCookie(CSRF_COOKIE, newCsrf, {
          ...CSRF_COOKIE_OPTIONS,
          maxAge: 600,
        });
        res.status(200);
        return login2faPage({ pendingToken, csrfToken: newCsrf });
      }

      // Without 2FA — create session immediately
      const session = await this.sessions.create({
        userId,
        controlRegionId,
        role,
        assignedOpstinaSlug,
        ipAddress,
        userAgent,
        ipSalt: await this.ipSalt.get(),
      });

      this.setSessionCookies(res, session.id, session.csrfToken);
      res.status(303).header('location', ADMIN_PATH).send();
      return;
    } catch (e: unknown) {
      const msg =
        e instanceof HttpException
          ? this.extractMessage(e)
          : 'Greška pri prijavi. Pokušajte ponovo.';
      const emailEcho = parsed.success ? parsed.data.email : '';
      return this.renderLoginError(res, emailEcho, msg);
    }
  }

  @Post('login/2fa')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('X-Content-Type-Options', 'nosniff')
  async login2fa(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<string | void> {
    const parsed = Login2faSchema.safeParse(body);
    const cookieToken = req.cookies?.[CSRF_COOKIE] ?? '';
    const ipAddress = (req.ip || '').toString();
    const userAgent = (req.headers['user-agent'] || '').toString();

    if (
      !parsed.success ||
      !cookieToken ||
      cookieToken !== parsed.data._csrf
    ) {
      // Back to login start — pending CSRF mismatch
      return this.renderLoginError(
        res,
        '',
        'Sesija forme je istekla. Prijavite se ponovo.',
      );
    }

    const tokenCheck = this.pendingToken.verify(parsed.data._pt);
    if (!tokenCheck.ok) {
      return this.renderLoginError(
        res,
        '',
        tokenCheck.reason === 'expired'
          ? 'Vreme za 2FA je isteklo. Prijavite se ponovo.'
          : 'Sesija forme je istekla. Prijavite se ponovo.',
      );
    }

    try {
      const { userId, controlRegionId, role, assignedOpstinaSlug } =
        await this.auth.verifyTotpAndFinalize({
          userId: tokenCheck.userId,
          code: parsed.data.code,
          ipAddress,
          userAgent,
        });

      const session = await this.sessions.create({
        userId,
        controlRegionId,
        role,
        assignedOpstinaSlug,
        ipAddress,
        userAgent,
        ipSalt: await this.ipSalt.get(),
      });

      this.setSessionCookies(res, session.id, session.csrfToken);
      res.status(303).header('location', ADMIN_PATH).send();
      return;
    } catch (e: unknown) {
      const msg =
        e instanceof HttpException
          ? this.extractMessage(e)
          : 'Neispravan kod. Pokušajte ponovo.';
      // Reissue pending token and CSRF for the next attempt (same userId);
      // failedLoginCount already accounts for brute-force.
      const reissued = this.pendingToken.issue(tokenCheck.userId);
      const newCsrf = randomBytes(32).toString('base64url');
      res.setCookie(CSRF_COOKIE, newCsrf, {
        ...CSRF_COOKIE_OPTIONS,
        maxAge: 600,
      });
      res.status(401);
      return login2faPage({
        pendingToken: reissued,
        csrfToken: newCsrf,
        error: msg,
      });
    }
  }

  @Post('logout')
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    // Logout does not branch — whether the session is valid or not, clear cookies
    const sid = req.cookies?.[SESSION_COOKIE];
    if (sid) {
      // Before revoke, capture userId for audit
      const session = await this.sessions.lookupRaw(sid).catch(() => null);
      await this.sessions.revoke(sid).catch(() => undefined);
      if (session?.userId) {
        await this.audit.log({
          event: AuditEvent.LOGOUT,
          userId: session.userId,
          controlRegionId: session.controlRegionId ?? null,
          ipAddress: (req.ip || '').toString(),
          userAgent: (req.headers['user-agent'] || '').toString(),
        });
      }
    }
    res.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    res.clearCookie(CSRF_COOKIE, CSRF_COOKIE_OPTIONS);
    res.status(303).header('location', `${ADMIN_PATH}/login`).send();
  }

  // ---------------------------------------------------------------------

  private setSessionCookies(
    res: FastifyReply,
    sessionId: string,
    csrfToken: string,
  ): void {
    const idleSec = Math.floor(SESSION_IDLE_MS / 1000);
    res.setCookie(SESSION_COOKIE, sessionId, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: idleSec,
    });
    res.setCookie(CSRF_COOKIE, csrfToken, {
      ...CSRF_COOKIE_OPTIONS,
      maxAge: idleSec,
    });
  }

  private renderLoginError(res: FastifyReply, emailValue: string, error: string): string {
    const token = randomBytes(32).toString('base64url');
    res.setCookie(CSRF_COOKIE, token, {
      ...CSRF_COOKIE_OPTIONS,
      maxAge: 600,
    });
    res.status(401);
    return loginPage({ csrfToken: token, emailValue, error });
  }

  private extractMessage(e: HttpException): string {
    const resp = e.getResponse();
    if (typeof resp === 'string') return resp;
    if (resp && typeof resp === 'object' && 'message' in resp) {
      const m = (resp as { message: unknown }).message;
      if (typeof m === 'string') return m;
    }
    return 'Neispravan email ili lozinka.';
  }
}
