import {
  Body,
  Controller,
  Get,
  Header,
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
import { AuthService } from '../auth/auth.service';
import { PollingStationsService } from '../polling-stations/polling-stations.service';
import { ADMIN_BASE, ADMIN_PATH } from '../auth/auth.constants';
import { nalogPage } from './templates/nalog';

/**
 * Body schema for the password change form.
 * Length constraints match the policy in `AuthService.hashPassword`
 * (min 12 chars, max 200) and the form-level HTML constraints.
 */
const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(12).max(200),
    newPasswordConfirm: z.string().min(12).max(200),
  })
  .refine((d) => d.newPassword === d.newPasswordConfirm, {
    message: 'mismatch',
    path: ['newPasswordConfirm'],
  });

/**
 * Self-service account page — currently only password change.
 *
 * Routes:
 *   GET  /kontrola-admin/nalog          — render form
 *   POST /kontrola-admin/nalog/lozinka  — change password (CSRF protected)
 *
 * Security:
 *  - SessionGuard: must be logged in
 *  - CsrfGuard on POST: every state change needs a CSRF token
 *  - Current password verification — prevents session-takeover attackers from
 *    locking out the legitimate admin
 *  - All OTHER active sessions of this user are revoked on success
 *  - PASSWORD_CHANGED / PASSWORD_CHANGE_FAILED events go to the audit log
 */
@Controller(ADMIN_BASE)
@UseGuards(SessionGuard)
export class NalogController {
  private readonly logger = new Logger(NalogController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly stations: PollingStationsService,
  ) {}

  /** Resolve opština label for the topbar badge (only for municipality admin). */
  private async opstinaNaziv(session: ValidSession): Promise<string | null> {
    if (session.role !== 'municipality_admin' || !session.assignedOpstinaSlug) {
      return null;
    }
    const meta = await this.stations.getOpstinaMeta(session.assignedOpstinaSlug);
    return meta?.naziv ?? session.assignedOpstinaSlug;
  }

  @Get('nalog')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async page(
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: ValidSession,
  ): Promise<string> {
    const [user, opstinaNaziv] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: session.userId },
        select: { email: true, controlRegion: { select: { name: true } } },
      }),
      this.opstinaNaziv(session),
    ]);
    const controlRegionName =
      user?.controlRegion?.name ?? `CR #${session.controlRegionId}`;
    if (!user) {
      return nalogPage({
        userEmail: '?',
        controlRegionName,
        role: session.role,
        opstinaNaziv,
        csrfToken: session.csrfToken,
        error: 'Korisnik nije pronađen.',
      });
    }

    const message = this.flashFromQuery(query, 'm');
    const error = this.flashFromQuery(query, 'e');

    return nalogPage({
      userEmail: user.email,
      controlRegionName,
      role: session.role,
      opstinaNaziv,
      csrfToken: session.csrfToken,
      message,
      error,
    });
  }

  @Post('nalog/lozinka')
  @UseGuards(CsrfGuard)
  async changePassword(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    const parsed = ChangePasswordSchema.safeParse(body);
    if (!parsed.success) {
      // Confirm-mismatch comes via path ['newPasswordConfirm']; length errors
      // are unified into a generic flash. We don't expose Zod's raw messages.
      const isMismatch = parsed.error.issues.some(
        (i) => i.path[0] === 'newPasswordConfirm' && i.message === 'mismatch',
      );
      res
        .status(303)
        .header('location', `${ADMIN_PATH}/nalog?e=${isMismatch ? 'mismatch' : 'bad'}`)
        .send();
      return;
    }

    const session = (req as any).session as ValidSession;
    const result = await this.auth.changeOwnPassword({
      userId: session.userId,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      keepSessionId: session.id,
      ipAddress: (req.ip || '').toString(),
      userAgent: (req.headers['user-agent'] || '').toString(),
    });

    if (!result.ok) {
      // Map server reason → URL flash code (kept short so they cannot be used
      // as an injection vector; rendering happens server-side via flashFromQuery).
      const code =
        result.reason === 'wrong_current'
          ? 'wrong'
          : result.reason === 'same_as_old'
            ? 'same'
            : result.reason === 'invalid_new'
              ? 'weak'
              : 'bad';
      res.status(303).header('location', `${ADMIN_PATH}/nalog?e=${code}`).send();
      return;
    }
    res.status(303).header('location', `${ADMIN_PATH}/nalog?m=changed`).send();
  }

  private flashFromQuery(
    query: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const v = typeof query[key] === 'string' ? (query[key] as string) : '';
    if (!v) return undefined;
    switch (key + ':' + v) {
      case 'm:changed':
        return 'Lozinka je uspešno promenjena. Sve ostale sesije su odjavljene.';
      case 'e:wrong':
        return 'Trenutna lozinka nije ispravna.';
      case 'e:weak':
        return 'Nova lozinka mora imati minimum 12 karaktera.';
      case 'e:same':
        return 'Nova lozinka mora biti različita od trenutne.';
      case 'e:mismatch':
        return 'Polja "Nova lozinka" i "Potvrdi" se ne poklapaju.';
      case 'e:bad':
        return 'Greška u zahtevu. Pokušajte ponovo.';
      default:
        return undefined;
    }
  }
}
