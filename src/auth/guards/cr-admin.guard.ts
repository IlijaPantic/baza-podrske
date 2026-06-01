import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ValidSession } from '../sessions.service';
import { ADMIN_PATH } from '../auth.constants';

/**
 * Allows only CR-level admins (role='admin').
 * Municipality admins (role='municipality_admin') are rejected:
 *   - For GET requests we redirect to /kontrola-admin (their permitted page).
 *   - For state-changing POST requests we return 403 Forbidden so a malicious
 *     municipality admin cannot toggle the survey or manage admins via a
 *     direct API call.
 *
 * MUST be applied AFTER SessionGuard (so `req.session` is set).
 */
@Injectable()
export class CrAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const res = ctx.switchToHttp().getResponse<FastifyReply>();
    const session = (req as any).session as ValidSession | undefined;

    // SessionGuard should have rejected an unauthenticated request before us;
    // this is a defense-in-depth check.
    if (!session) {
      throw new ForbiddenException('Sesija nije validna.');
    }
    if (session.role === 'admin') {
      return true;
    }

    if (req.method === 'GET') {
      // Soft redirect — municipality admin landed on a page they cannot see.
      // Send them home (prijave list, which is scoped to their opština).
      res.status(303).header('location', ADMIN_PATH).send();
      return false;
    }
    throw new ForbiddenException(
      'Ovo mogu samo admini univerziteta (CR admini).',
    );
  }
}
