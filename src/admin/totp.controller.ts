import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { SessionGuard } from '../auth/guards/session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { CurrentSession } from '../auth/decorators/current-session';
import type { ValidSession } from '../auth/sessions.service';
import { SessionsService } from '../auth/sessions.service';
import { AuthService } from '../auth/auth.service';
import { ADMIN_BASE, ADMIN_PATH } from '../auth/auth.constants';
import { securityPage } from './templates/security';

const ConfirmSchema = z.object({
  secret: z.string().min(16).max(64),
  code: z.string().trim().min(6).max(10),
});

const DisableSchema = z.object({
  code: z.string().trim().min(6).max(10),
});

/**
 * Self-service 2FA: each admin enables/disables 2FA for their own account.
 *
 * Routes:
 *   GET  /kontrola-admin/2fa         — status + start button / disable form
 *   POST /kontrola-admin/2fa/zapocni — generates QR + secret
 *   POST /kontrola-admin/2fa/potvrdi — validates first code, persists secret
 *   POST /kontrola-admin/2fa/otkazi  — cancels enrollment in progress
 *   POST /kontrola-admin/2fa/iskljuci — requires code, clears secret + totpEnabledAt
 *
 * Security:
 *  - SessionGuard: must be logged in
 *  - CsrfGuard: every POST has a CSRF token
 *  - Enrollment secret is not persisted until the code is confirmed (kept in a hidden form field)
 *  - Disable requires a live code — prevents someone who steals the session from turning off 2FA
 */
@Controller(ADMIN_BASE)
@UseGuards(SessionGuard)
export class TotpController {
  private readonly logger = new Logger(TotpController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  // ---- GET /2fa ----------------------------------------------------------

  @Get('2fa')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async page(
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: ValidSession,
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        email: true,
        totpEnabledAt: true,
        totpSecret: true,
      },
    });
    if (!user) {
      // Session is valid but user gone — render minimal page
      return securityPage({
        userEmail: '?',
        csrfToken: session.csrfToken,
        totpEnabled: false,
        totpEnabledAt: null,
        error: 'Korisnik nije pronađen.',
      });
    }

    const message = this.flashFromQuery(query, 'm');
    const error = this.flashFromQuery(query, 'e');

    return securityPage({
      userEmail: user.email,
      csrfToken: session.csrfToken,
      totpEnabled: !!user.totpEnabledAt && !!user.totpSecret,
      totpEnabledAt: user.totpEnabledAt,
      message,
      error,
    });
  }

  // ---- POST /2fa/zapocni — generate QR + secret --------------------------

  @Post('2fa/zapocni')
  @UseGuards(CsrfGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @HttpCode(200)
  async startEnrollment(
    @CurrentSession() session: ValidSession,
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { email: true, totpEnabledAt: true },
    });
    if (!user) {
      return securityPage({
        userEmail: '?',
        csrfToken: session.csrfToken,
        totpEnabled: false,
        totpEnabledAt: null,
        error: 'Korisnik nije pronađen.',
      });
    }
    if (user.totpEnabledAt) {
      return securityPage({
        userEmail: user.email,
        csrfToken: session.csrfToken,
        totpEnabled: true,
        totpEnabledAt: user.totpEnabledAt,
        error: '2FA je već aktivan. Isključite ga pa pokušajte ponovo.',
      });
    }

    const enrollment = await this.auth.startTotpEnrollment({
      userId: session.userId,
      email: user.email,
    });

    return securityPage({
      userEmail: user.email,
      csrfToken: session.csrfToken,
      totpEnabled: false,
      totpEnabledAt: null,
      enrollment,
    });
  }

  // ---- POST /2fa/potvrdi — validate first code ----------------------------

  @Post('2fa/potvrdi')
  @UseGuards(CsrfGuard)
  async confirmEnrollment(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    const parsed = ConfirmSchema.safeParse(body);
    if (!parsed.success) {
      res.status(303).header('location', `${ADMIN_PATH}/2fa?e=bad`).send();
      return;
    }
    const session = (req as any).session as ValidSession;
    const ok = await this.auth.confirmTotpEnrollment({
      userId: session.userId,
      secret: parsed.data.secret,
      code: parsed.data.code,
      ipAddress: (req.ip || '').toString(),
      userAgent: (req.headers['user-agent'] || '').toString(),
    });

    if (!ok) {
      // Redirect back to the page with a new enrollment using the same secret.
      res
        .status(303)
        .header('location', `${ADMIN_PATH}/2fa?e=code`)
        .send();
      return;
    }
    res.status(303).header('location', `${ADMIN_PATH}/2fa?m=enabled`).send();
  }

  // ---- POST /2fa/otkazi — cancel enrollment in progress ----------------------

  @Post('2fa/otkazi')
  @UseGuards(CsrfGuard)
  cancelEnrollment(@Res({ passthrough: true }) res: FastifyReply): void {
    // Enrollment is stateless (secret in a hidden field), so cancellation is
    // just a redirect with no server state to clear.
    res.status(303).header('location', `${ADMIN_PATH}/2fa`).send();
  }

  // ---- POST /2fa/iskljuci — disable 2FA ---------------------------------

  @Post('2fa/iskljuci')
  @UseGuards(CsrfGuard)
  async disable2fa(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    const parsed = DisableSchema.safeParse(body);
    if (!parsed.success) {
      res.status(303).header('location', `${ADMIN_PATH}/2fa?e=bad`).send();
      return;
    }
    const session = (req as any).session as ValidSession;
    const ok = await this.auth.disableTotp({
      userId: session.userId,
      code: parsed.data.code,
      ipAddress: (req.ip || '').toString(),
      userAgent: (req.headers['user-agent'] || '').toString(),
    });

    if (!ok) {
      res.status(303).header('location', `${ADMIN_PATH}/2fa?e=code`).send();
      return;
    }
    res.status(303).header('location', `${ADMIN_PATH}/2fa?m=disabled`).send();
  }

  // ---- Helpers -----------------------------------------------------------

  private flashFromQuery(
    query: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const v = typeof query[key] === 'string' ? (query[key] as string) : '';
    if (!v) return undefined;
    switch (key + ':' + v) {
      case 'm:enabled':
        return '2FA je uspešno aktiviran. Od sledeće prijave traži se 6-cifreni kod.';
      case 'm:disabled':
        return '2FA je isključen.';
      case 'e:code':
        return 'Neispravan kod. Pokušajte ponovo.';
      case 'e:bad':
        return 'Greška u zahtevu. Pokušajte ponovo.';
      default:
        return undefined;
    }
  }
}
