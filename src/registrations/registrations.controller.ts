import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RegistrationsService } from './registrations.service';
import { SubmitSchema } from './dto/submit.dto';
import {
  SubmitRateLimitService,
  messageForReason,
} from './submit-rate-limit.service';
import { FormTokenService } from './form-token.service';
import { AuditService } from '../audit/audit.service';
import { AuditEvent } from '../audit/audit.events';

@Controller('api')
export class RegistrationsController {
  private readonly logger = new Logger(RegistrationsController.name);

  constructor(
    private readonly service: RegistrationsService,
    private readonly rateLimit: SubmitRateLimitService,
    private readonly formToken: FormTokenService,
    private readonly audit: AuditService,
  ) {}

  /**
   * GET /api/form-token
   *
   * Client (JS) calls it as soon as the form loads.
   * Returns HMAC-signed token + ttlSec. We do NOT store tokens on the server
   * (stateless); validation happens on submit.
   *
   * No separate rate limit here — global cap from `SubmitRateLimitService`
   * protects against abuse (if someone hits /form-token with millions of requests).
   * Token endpoint is extra cheap (HMAC only), no DB touch.
   */
  @Get('form-token')
  @HttpCode(200)
  issueFormToken(@Res({ passthrough: true }) res: FastifyReply): {
    token: string;
    ttlSec: number;
  } {
    // Ensure response is not cached on client or CF
    res
      .header('Cache-Control', 'no-store, max-age=0')
      .header('Pragma', 'no-cache');
    return this.formToken.issue();
  }

  /**
   * POST /api/submit
   *
   * Body: JSON with fields from SubmitSchema + optional `_t` (form token).
   * Returns: { shortId } 200 OK, or { fieldErrors, message } 4xx.
   *
   * Check order (cheap → expensive):
   *  1. Rate limit (in-memory, O(1))
   *  2. Form token (HMAC verification + age check) — blocks bot scripts
   *  3. Zod validation (DTO)
   *  4. Service.submit (DB work)
   */
  @Post('submit')
  @HttpCode(200)
  async submit(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const ipAddress = (req.ip || '').toString();
    const userAgent = (req.headers['user-agent'] || '').toString();

    // 1) Rate limit FIRST (before Zod, before everything) — 4 layers
    const rl = this.rateLimit.check({ ip: ipAddress, userAgent });
    if (!rl.allowed) {
      res.header('Retry-After', String(rl.retryAfterSec));
      await this.audit.log({
        event: AuditEvent.SUBMIT_RATE_LIMITED,
        ipAddress,
        userAgent,
        metadata: { reason: rl.reason, retryAfter: rl.retryAfterSec },
      });
      throw new HttpException(
        { message: messageForReason(rl.reason) },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2) Form token (time-to-fill heuristic)
    const token = this.extractToken(body);
    const tokenCheck = this.formToken.verify(token);
    if (!tokenCheck.ok) {
      await this.audit.log({
        event: AuditEvent.SUBMIT_BOT,
        ipAddress,
        userAgent,
        metadata: {
          tokenReason: tokenCheck.reason,
          ageMs: tokenCheck.ageMs,
        },
      });
      // Deliberately UNUSUAL message — bot should not know the reason,
      // and a human seeing this can refresh the page.
      throw new BadRequestException({
        message: 'Sesija forme je istekla ili nije validna. Osvežite stranicu.',
      });
    }

    // 3) Zod validation
    const parsed = SubmitSchema.safeParse(body);
    if (!parsed.success) {
      const fieldErrors = parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'form',
        message: issue.message,
      }));
      await this.audit.log({
        event: AuditEvent.SUBMIT_VALIDATION,
        ipAddress,
        userAgent,
        metadata: {
          fields: parsed.error.issues.map((i) => i.path.join('.') || 'form'),
        },
      });
      throw new BadRequestException({
        message: 'Greška u podacima.',
        fieldErrors,
      });
    }

    // 4) Business logic
    return this.service.submit(parsed.data, { ipAddress, userAgent });
  }

  /** Return `_t` from JSON body. Does not propagate types further (string or undefined). */
  private extractToken(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const v = (body as Record<string, unknown>)._t;
    return typeof v === 'string' ? v : undefined;
  }
}
