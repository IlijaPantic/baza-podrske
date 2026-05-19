import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import { PollingStationsService } from '../polling-stations/polling-stations.service';
import { SessionGuard } from '../auth/guards/session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { CurrentSession } from '../auth/decorators/current-session';
import type { ValidSession } from '../auth/sessions.service';
import { ADMIN_BASE, ADMIN_PATH } from '../auth/auth.constants';
import { AdminService } from './admin.service';
import { AdminUsersService } from './admin-users.service';
import { AuditService } from '../audit/audit.service';
import { adminListPage } from './templates/list';
import { adminGroupedPage } from './templates/grouped';
import { adminAnketaPage } from './templates/anketa';
import { adminUsersPage } from './templates/admini';
import { adminAuditPage } from './templates/audit';
import { CsvColumn, toCsv } from './csv';
import type { RegistrationRow } from './admin.service';

/**
 * All admin GET pages use SessionGuard.
 * State-changing POSTs use SessionGuard + CsrfGuard.
 *
 * NB: SessionGuard redirects GET requests to /login, but returns 401 for POST.
 * We rely on that behavior here.
 */
@Controller(ADMIN_BASE)
@UseGuards(SessionGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
    private readonly stations: PollingStationsService,
    private readonly adminUsers: AdminUsersService,
    private readonly auditService: AuditService,
  ) {}

  /** Helper — returns the active user's email and control region name. */
  private async userContext(session: ValidSession): Promise<{
    email: string;
    controlRegionName: string;
  }> {
    const u = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { email: true, controlRegion: { select: { name: true } } },
    });
    return {
      email: u?.email ?? '?',
      controlRegionName: u?.controlRegion?.name ?? `CR #${session.controlRegionId}`,
    };
  }

  /** The mandatory scope passed to all admin service methods. */
  private scopeOf(session: ValidSession): { controlRegionId: number } {
    return { controlRegionId: session.controlRegionId };
  }

  // ========== GET / — registration list ==========
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Referrer-Policy', 'no-referrer')
  async list(
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: ValidSession,
  ): Promise<string> {
    const scope = this.scopeOf(session);
    const filters = this.admin.parseFilters(query);
    const { page, pageSize } = this.admin.parsePagination(query);
    const [{ rows, total, totalPages }, opstine, ctx] = await Promise.all([
      this.admin.listRegistrations({ ...filters, page, pageSize }, scope),
      this.stations.listOpstineForControlRegion(scope.controlRegionId),
      this.userContext(session),
    ]);

    return adminListPage({
      userEmail: ctx.email,
      controlRegionName: ctx.controlRegionName,
      filters,
      opstine,
      rows,
      total,
      page,
      totalPages,
    });
  }

  // ========== GET /grupisano — counts per municipality ==========
  @Get('grupisano')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('X-Content-Type-Options', 'nosniff')
  async grouped(
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: ValidSession,
  ): Promise<string> {
    const scope = this.scopeOf(session);
    const filters = this.admin.parseFilters(query);
    const [groups, ctx] = await Promise.all([
      this.admin.groupByOpstina(filters, scope),
      this.userContext(session),
    ]);
    return adminGroupedPage({
      userEmail: ctx.email,
      controlRegionName: ctx.controlRegionName,
      filters,
      groups,
    });
  }

  // ========== GET /anketa — per-region toggle page ==========
  @Get('anketa')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('X-Content-Type-Options', 'nosniff')
  async anketa(
    @CurrentSession() session: ValidSession,
    @Query('msg') msg: string | undefined,
  ): Promise<string> {
    const scope = this.scopeOf(session);
    const [isOpen, ctx] = await Promise.all([
      this.admin.getSurveyOpen(scope),
      this.userContext(session),
    ]);
    const safeMsg =
      msg === 'opened'
        ? 'Anketa je uspešno otvorena.'
        : msg === 'closed'
          ? 'Anketa je uspešno zatvorena.'
          : undefined;
    return adminAnketaPage({
      userEmail: ctx.email,
      controlRegionName: ctx.controlRegionName,
      isOpen,
      csrfToken: session.csrfToken,
      message: safeMsg,
    });
  }

  // ========== POST /anketa/toggle — per-region close/open ==========
  @Post('anketa/toggle')
  @UseGuards(CsrfGuard)
  @HttpCode(303)
  async anketaToggle(
    @Body() body: { action?: string },
    @CurrentSession() session: ValidSession,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    const action = body?.action;
    if (action !== 'open' && action !== 'close') {
      throw new BadRequestException('Nevalidna akcija.');
    }
    const value = action === 'open';
    await this.admin.setSurveyOpen(value, this.scopeOf(session), {
      byUserId: session.userId,
      ipAddress: (req.ip || '').toString(),
      userAgent: (req.headers['user-agent'] || '').toString(),
    });
    res
      .header('location', `${ADMIN_PATH}/anketa?msg=${value ? 'opened' : 'closed'}`)
      .send();
  }

  // ========== GET /export.csv ==========
  @Get('export.csv')
  async exportCsv(
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: ValidSession,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<string> {
    const filters = this.admin.parseFilters(query);
    const { rows, truncated } = await this.admin.exportRegistrations(
      filters,
      this.scopeOf(session),
    );
    const csv = toCsv(rows, this.exportColumns());
    const filename = this.buildFilename(filters, 'csv');
    res
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('X-Content-Type-Options', 'nosniff');
    if (truncated) {
      res.header('X-Truncated', 'true');
      this.logger.warn(`CSV eksport odsečen na 50000 redova, IP=${req.ip}`);
    }
    return csv;
  }

  // ========== GET /export.json ==========
  @Get('export.json')
  async exportJson(
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: ValidSession,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<unknown> {
    const filters = this.admin.parseFilters(query);
    const { rows, truncated } = await this.admin.exportRegistrations(
      filters,
      this.scopeOf(session),
    );
    const filename = this.buildFilename(filters, 'json');
    res
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('X-Content-Type-Options', 'nosniff');
    return {
      exported_at: new Date().toISOString(),
      filters,
      count: rows.length,
      truncated,
      registrations: rows.map((r) => ({
        short_id: r.shortId,
        first_name: r.firstName,
        last_name: r.lastName,
        birth_year: r.birthYear,
        opstina: r.opstina,
        opstina_slug: r.opstinaSlug,
        muni_id: r.muniId,
        ps_id: r.psId,
        control_region_id: r.controlRegionId,
        bm_broj: r.bmBroj,
        bm_naziv: r.bmNaziv,
        phone: r.phone,
        phone_normalized: r.phoneNormalized,
        email: r.email,
        submitted_at: r.submittedAt.toISOString(),
      })),
    };
  }

  // ========== Audit log (/kontrola-admin/audit) ==========

  @Get('audit')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('X-Content-Type-Options', 'nosniff')
  async auditList(
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: ValidSession,
  ): Promise<string> {
    const filters = this.auditService.parseFilters(query);
    const { page, pageSize } = this.auditService.parsePagination(query);
    // Scope: only audit log entries for this admin's control region.
    // Unscoped entries (e.g. unauthenticated LOGIN_FAIL with no CR context)
    // are hidden from regional admins — visible only via direct DB query.
    const scopedFilters = {
      ...filters,
      controlRegionId: session.controlRegionId,
    };
    const [{ rows, total, totalPages }, ctx] = await Promise.all([
      this.auditService.list({ ...scopedFilters, page, pageSize }),
      this.userContext(session),
    ]);
    return adminAuditPage({
      userEmail: ctx.email,
      controlRegionName: ctx.controlRegionName,
      filters,
      rows,
      total,
      page,
      totalPages,
    });
  }

  // ========== Admin users (/kontrola-admin/admini) ==========

  /**
   * Admin list + form for a new admin.
   * `msg` (success) and `err` (error) are sanitized enums — we never render
   * raw user input directly to avoid XSS via the query string.
   */
  @Get('admini')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('X-Content-Type-Options', 'nosniff')
  async listAdmini(
    @CurrentSession() session: ValidSession,
    @Query('msg') msg: string | undefined,
    @Query('err') err: string | undefined,
  ): Promise<string> {
    const [users, ctx] = await Promise.all([
      this.adminUsers.listAdmins(session.userId, session.controlRegionId),
      this.userContext(session),
    ]);
    return adminUsersPage({
      userEmail: ctx.email,
      controlRegionName: ctx.controlRegionName,
      csrfToken: session.csrfToken,
      users,
      message: this.adminUserMsg(msg),
      error: this.adminUserErr(err),
    });
  }

  @Post('admini/novi')
  @UseGuards(CsrfGuard)
  @HttpCode(303)
  async createAdmin(
    @Body() body: { email?: string; password?: string },
    @CurrentSession() session: ValidSession,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    try {
      // New admins are always created in the inviting admin's control region.
      // Cross-region admin creation is intentionally not allowed via UI.
      await this.adminUsers.createAdmin({
        email: body?.email ?? '',
        password: body?.password ?? '',
        controlRegionId: session.controlRegionId,
        byUserId: session.userId,
        ipAddress: (req.ip || '').toString(),
        userAgent: (req.headers['user-agent'] || '').toString(),
      });
      res.header('location', `${ADMIN_PATH}/admini?msg=created`).send();
    } catch (e) {
      const code = this.errToCode(e, 'create');
      res.header('location', `${ADMIN_PATH}/admini?err=${code}`).send();
    }
  }

  @Post('admini/:id/lozinka')
  @UseGuards(CsrfGuard)
  @HttpCode(303)
  async resetAdminPassword(
    @Param('id') id: string,
    @Body() body: { newPassword?: string },
    @CurrentSession() session: ValidSession,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    try {
      this.assertValidUuid(id);
      await this.adminUsers.resetPassword({
        targetUserId: id,
        newPassword: body?.newPassword ?? '',
        byUserId: session.userId,
        scopedControlRegionId: session.controlRegionId,
        ipAddress: (req.ip || '').toString(),
        userAgent: (req.headers['user-agent'] || '').toString(),
      });
      res.header('location', `${ADMIN_PATH}/admini?msg=password_reset`).send();
    } catch (e) {
      const code = this.errToCode(e, 'password');
      res.header('location', `${ADMIN_PATH}/admini?err=${code}`).send();
    }
  }

  @Post('admini/:id/deaktiviraj')
  @UseGuards(CsrfGuard)
  @HttpCode(303)
  async deactivateAdmin(
    @Param('id') id: string,
    @CurrentSession() session: ValidSession,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    try {
      this.assertValidUuid(id);
      await this.adminUsers.deactivate({
        targetUserId: id,
        byUserId: session.userId,
        scopedControlRegionId: session.controlRegionId,
        ipAddress: (req.ip || '').toString(),
        userAgent: (req.headers['user-agent'] || '').toString(),
      });
      res.header('location', `${ADMIN_PATH}/admini?msg=deactivated`).send();
    } catch (e) {
      const code = this.errToCode(e, 'deactivate');
      res.header('location', `${ADMIN_PATH}/admini?err=${code}`).send();
    }
  }

  @Post('admini/:id/reaktiviraj')
  @UseGuards(CsrfGuard)
  @HttpCode(303)
  async reactivateAdmin(
    @Param('id') id: string,
    @CurrentSession() session: ValidSession,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    try {
      this.assertValidUuid(id);
      await this.adminUsers.reactivate({
        targetUserId: id,
        byUserId: session.userId,
        scopedControlRegionId: session.controlRegionId,
        ipAddress: (req.ip || '').toString(),
        userAgent: (req.headers['user-agent'] || '').toString(),
      });
      res.header('location', `${ADMIN_PATH}/admini?msg=reactivated`).send();
    } catch (e) {
      const code = this.errToCode(e, 'reactivate');
      res.header('location', `${ADMIN_PATH}/admini?err=${code}`).send();
    }
  }

  @Post('admini/:id/odjavi-sesije')
  @UseGuards(CsrfGuard)
  @HttpCode(303)
  async revokeAdminSessions(
    @Param('id') id: string,
    @CurrentSession() session: ValidSession,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    try {
      this.assertValidUuid(id);
      await this.adminUsers.revokeAllSessions({
        targetUserId: id,
        byUserId: session.userId,
        scopedControlRegionId: session.controlRegionId,
        ipAddress: (req.ip || '').toString(),
        userAgent: (req.headers['user-agent'] || '').toString(),
      });
      res.header('location', `${ADMIN_PATH}/admini?msg=sessions_revoked`).send();
    } catch (e) {
      const code = this.errToCode(e, 'sessions');
      res.header('location', `${ADMIN_PATH}/admini?err=${code}`).send();
    }
  }

  // -------------- helpers ----------------

  private assertValidUuid(id: string): void {
    // Standard UUID v4 format (8-4-4-4-12 hex)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new BadRequestException('Nevalidan ID.');
    }
  }

  /**
   * Maps known success codes from the query string to display text.
   * The code is a strict enum; we never show the raw query.
   */
  private adminUserMsg(code: string | undefined): string | undefined {
    switch (code) {
      case 'created':
        return 'Novi admin je uspešno kreiran.';
      case 'password_reset':
        return 'Lozinka je promenjena. Korisnik je odjavljen sa svih uređaja.';
      case 'deactivated':
        return 'Admin je deaktiviran.';
      case 'reactivated':
        return 'Admin je reaktiviran.';
      case 'sessions_revoked':
        return 'Sve sesije su revoke-ovane.';
      default:
        return undefined;
    }
  }

  private adminUserErr(code: string | undefined): string | undefined {
    switch (code) {
      case 'create_invalid_email':
        return 'Email nije validan.';
      case 'create_invalid_password':
        return 'Lozinka nije validna (min 12 karaktera).';
      case 'create_conflict':
        return 'Već postoji admin sa tim email-om.';
      case 'password_invalid':
        return 'Lozinka nije validna (min 12 karaktera).';
      case 'password_not_found':
        return 'Admin ne postoji.';
      case 'password_deactivated':
        return 'Najpre reaktiviraj admina, pa zatim promeni lozinku.';
      case 'deactivate_self':
        return 'Ne možeš deaktivirati sopstveni nalog.';
      case 'deactivate_last':
        return 'Nije moguće deaktivirati poslednjeg aktivnog admina.';
      case 'deactivate_not_found':
        return 'Admin ne postoji.';
      case 'deactivate_already':
        return 'Admin je već deaktiviran.';
      case 'reactivate_not_found':
        return 'Admin ne postoji.';
      case 'reactivate_already':
        return 'Admin nije deaktiviran.';
      case 'sessions_not_found':
        return 'Admin ne postoji.';
      case 'invalid_id':
        return 'Nevalidan ID admina.';
      default:
        return code ? 'Došlo je do greške.' : undefined;
    }
  }

  /**
   * Converts an exception to a short code for the query string.
   * This avoids error messages carrying user-controlled text in the URL.
   */
  private errToCode(e: unknown, op: 'create' | 'password' | 'deactivate' | 'reactivate' | 'sessions'): string {
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const resp = e.getResponse();
      const msg = typeof resp === 'string' ? resp : (resp as any)?.message ?? '';
      // Per-operation mapping
      if (op === 'create') {
        if (status === 409) return 'create_conflict';
        if (msg.toLowerCase().includes('email')) return 'create_invalid_email';
        return 'create_invalid_password';
      }
      if (op === 'password') {
        if (status === 404) return 'password_not_found';
        if (msg.toLowerCase().includes('deaktiv')) return 'password_deactivated';
        return 'password_invalid';
      }
      if (op === 'deactivate') {
        if (status === 404) return 'deactivate_not_found';
        if (msg.toLowerCase().includes('poslednjeg')) return 'deactivate_last';
        if (msg.toLowerCase().includes('sopstven')) return 'deactivate_self';
        if (msg.toLowerCase().includes('već deaktiviran')) return 'deactivate_already';
        return 'deactivate_self';
      }
      if (op === 'reactivate') {
        if (status === 404) return 'reactivate_not_found';
        return 'reactivate_already';
      }
      if (op === 'sessions') {
        if (status === 404) return 'sessions_not_found';
        return 'invalid_id';
      }
    }
    this.logger.error(`Admin user op=${op} failed: ${(e as Error)?.message}`);
    return 'unknown';
  }

  private exportColumns(): CsvColumn<RegistrationRow>[] {
    return [
      { header: 'short_id', value: (r) => r.shortId },
      { header: 'ime', value: (r) => r.firstName },
      { header: 'prezime', value: (r) => r.lastName },
      { header: 'godiste', value: (r) => r.birthYear },
      { header: 'opstina', value: (r) => r.opstina },
      { header: 'opstina_slug', value: (r) => r.opstinaSlug },
      { header: 'muni_id', value: (r) => r.muniId },
      { header: 'ps_id', value: (r) => r.psId },
      { header: 'control_region_id', value: (r) => r.controlRegionId },
      { header: 'bm_broj', value: (r) => r.bmBroj },
      { header: 'bm_naziv', value: (r) => r.bmNaziv },
      // `telefon` is wrapped as Excel text (="...") so the leading 0 is preserved
      // when opening the CSV in Excel/LibreOffice. Without this, "0657894561"
      // gets parsed as a number and shown as "657894561".
      { header: 'telefon', value: (r) => r.phone, excelText: true },
      // E.164 form ("+381651234567") is unambiguous for any consumer.
      { header: 'telefon_e164', value: (r) => r.phoneNormalized },
      { header: 'email', value: (r) => r.email },
      { header: 'prijavljen_at', value: (r) => r.submittedAt.toISOString() },
    ];
  }

  private buildFilename(filters: { opstina?: string; od?: string; do?: string }, ext: string): string {
    const parts = ['prijave'];
    if (filters.opstina) parts.push(filters.opstina);
    if (filters.od || filters.do) {
      parts.push(`${filters.od ?? 'pocetak'}_${filters.do ?? 'kraj'}`);
    }
    const now = new Date().toISOString().slice(0, 10);
    parts.push(now);
    return `${parts.join('_')}.${ext}`;
  }
}
