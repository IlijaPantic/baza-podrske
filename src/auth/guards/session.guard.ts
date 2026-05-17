import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SessionsService, ValidSession } from '../sessions.service';
import {
  CSRF_COOKIE,
  CSRF_COOKIE_OPTIONS,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_IDLE_MS,
  ADMIN_PATH,
} from '../auth.constants';

/**
 * Protects all admin routes. Reads session cookie, validates in DB,
 * refreshes idle timer, and sets `req.session` + `req.user` for downstream handlers.
 *
 * When session invalid: for GET requests redirects to login; for others
 * returns 401.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const res = ctx.switchToHttp().getResponse<FastifyReply>();

    const sid = req.cookies?.[SESSION_COOKIE];
    const session = sid ? await this.sessions.validateAndTouch(sid) : null;

    if (!session) {
      // Clear potentially stale cookies
      this.clearCookies(res);
      if (req.method === 'GET') {
        const target = `${ADMIN_PATH}/login`;
        res.status(302).header('location', target).send();
        return false;
      }
      throw new UnauthorizedException('Sesija je istekla. Prijavite se ponovo.');
    }

    // Refresh cookies so idle timer does not expire on the browser side
    this.setCookies(res, session);

    // Anti-cache for all admin pages — prevents browser or CDN
    // from caching authenticated HTML (back/forward after logout).
    res.header(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, private',
    );
    res.header('Pragma', 'no-cache');

    // For downstream handlers
    (req as any).session = session;
    return true;
  }

  private setCookies(res: FastifyReply, session: ValidSession): void {
    // maxAge in seconds (Fastify cookie API)
    const idleSec = Math.floor(SESSION_IDLE_MS / 1000);
    res.setCookie(SESSION_COOKIE, session.id, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: idleSec,
    });
    res.setCookie(CSRF_COOKIE, session.csrfToken, {
      ...CSRF_COOKIE_OPTIONS,
      maxAge: idleSec,
    });
  }

  private clearCookies(res: FastifyReply): void {
    res.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    res.clearCookie(CSRF_COOKIE, CSRF_COOKIE_OPTIONS);
  }
}
