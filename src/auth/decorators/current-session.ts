import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ValidSession } from '../sessions.service';

/**
 * Use: `myEndpoint(@CurrentSession() session: ValidSession) { ... }`
 * Assumes SessionGuard has set `req.session`.
 */
export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ValidSession | undefined => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    return (req as any).session as ValidSession | undefined;
  },
);
