import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SessionsService, ValidSession } from '../sessions.service';
import { CSRF_COOKIE } from '../auth.constants';
import { AuditService } from '../../audit/audit.service';
import { AuditEvent } from '../../audit/audit.events';

/**
 * Double-submit CSRF protection for state-changing POST/PUT/DELETE requests.
 *
 * Must run AFTER SessionGuard — uses `req.session.csrfToken` as
 * expected value. If this fails first, everything else is moot.
 *
 * Token must be supplied via one of:
 *  - hidden `_csrf` field in form POST (application/x-www-form-urlencoded or JSON)
 *  - X-CSRF-Token header (for AJAX)
 *
 * Cookie must exist and match header/form value —
 * proving the request comes from a page on our origin (attackers on
 * other domains cannot read our cookie due to Same-Origin Policy).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const session = (req as any).session as ValidSession | undefined;
    if (!session) {
      // SessionGuard did not set session — defensively reject
      throw new ForbiddenException('Nevalidna sesija.');
    }

    const ipAddress = (req.ip || '').toString();
    const userAgent = (req.headers['user-agent'] || '').toString();
    const url = req.url ?? '';

    const fail = async (reason: string): Promise<never> => {
      await this.audit.log({
        event: AuditEvent.CSRF_FAIL,
        userId: session.userId,
        ipAddress,
        userAgent,
        metadata: { reason, url },
      });
      throw new ForbiddenException(reason);
    };

    const cookieToken = req.cookies?.[CSRF_COOKIE];
    if (!cookieToken) {
      return fail('CSRF cookie nedostaje.');
    }

    // Token from request (header wins; then form/JSON body)
    const headerToken = (req.headers['x-csrf-token'] as string | undefined) ?? '';
    const bodyToken = this.extractFromBody(req.body);
    const submitted = headerToken || bodyToken;

    if (!submitted) {
      return fail('CSRF token nedostaje u zahtevu.');
    }

    // All three must match: cookie ↔ submitted ↔ session.csrfToken
    if (!this.sessions.verifyCsrf(session.csrfToken, cookieToken)) {
      return fail('CSRF cookie nije validan.');
    }
    if (!this.sessions.verifyCsrf(session.csrfToken, submitted)) {
      return fail('CSRF token se ne poklapa.');
    }

    return true;
  }

  private extractFromBody(body: unknown): string {
    if (!body || typeof body !== 'object') return '';
    const v = (body as Record<string, unknown>)._csrf;
    return typeof v === 'string' ? v : '';
  }
}
