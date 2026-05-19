import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEvent } from '../audit/audit.events';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const MAX_EXPORT_ROWS = 50_000; // safety limit for a single export

export type ListFilters = {
  /** Municipality slug ("backa-palanka") — optional. */
  opstina?: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  od?: string;
  /** ISO date (YYYY-MM-DD), inclusive (through end of day). */
  do?: string;
};

export type ListQuery = ListFilters & {
  page: number;
  pageSize: number;
};

/**
 * Scope — every admin query MUST pass the admin's controlRegionId.
 * This is the security boundary that prevents cross-region access.
 */
export type Scope = {
  controlRegionId: number;
};

export type RegistrationRow = {
  id: string;
  shortId: string;
  firstName: string;
  lastName: string;
  birthYear: number | null;
  opstina: string;
  opstinaSlug: string;
  muniId: number | null;
  psId: string | null;
  /** Control region (university) this registration belongs to. */
  controlRegionId: number;
  bmBroj: string | null;
  bmNaziv: string | null;
  /** Phone exactly as the citizen entered it (e.g. "0657894561"). */
  phone: string;
  /** E.164 normalized phone (e.g. "+381657894561") — always unambiguous. */
  phoneNormalized: string;
  email: string;
  submittedAt: Date;
};

/**
 * Service for admin queries — list, counts, grouping, export.
 *
 * All lists and exports use the same filters (municipality, date from/to) so
 * the admin can "search then export".
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Parses and sanitizes filters from the query string.
   * Values that fail validation are skipped silently
   * (we always allow the admin form to open).
   */
  parseFilters(query: Record<string, unknown>): ListFilters {
    const out: ListFilters = {};

    const opstina = typeof query.opstina === 'string' ? query.opstina.trim() : '';
    if (opstina && /^[a-z0-9-]{1,80}$/.test(opstina)) {
      out.opstina = opstina;
    }

    const od = typeof query.od === 'string' ? query.od.trim() : '';
    if (od && /^\d{4}-\d{2}-\d{2}$/.test(od) && !Number.isNaN(Date.parse(od))) {
      out.od = od;
    }
    const dO = typeof query.do === 'string' ? query.do.trim() : '';
    if (dO && /^\d{4}-\d{2}-\d{2}$/.test(dO) && !Number.isNaN(Date.parse(dO))) {
      out.do = dO;
    }
    return out;
  }

  parsePagination(query: Record<string, unknown>): { page: number; pageSize: number } {
    const rawPage = typeof query.page === 'string' ? parseInt(query.page, 10) : 1;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    return { page, pageSize: DEFAULT_PAGE_SIZE };
  }

  /**
   * Build WHERE clause with mandatory control region scope.
   * This is the SINGLE place where the cross-region boundary is enforced.
   */
  private buildWhere(
    filters: ListFilters,
    scope: Scope,
  ): Prisma.RegistrationWhereInput {
    const where: Prisma.RegistrationWhereInput = {
      controlRegionId: scope.controlRegionId,
    };
    if (filters.opstina) where.opstinaSlug = filters.opstina;
    if (filters.od || filters.do) {
      where.submittedAt = {};
      if (filters.od) {
        where.submittedAt.gte = new Date(`${filters.od}T00:00:00.000Z`);
      }
      if (filters.do) {
        where.submittedAt.lte = new Date(`${filters.do}T23:59:59.999Z`);
      }
    }
    return where;
  }

  async listRegistrations(query: ListQuery, scope: Scope): Promise<{
    rows: RegistrationRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const where = this.buildWhere(query, scope);
    const [total, raw] = await this.prisma.$transaction([
      this.prisma.registration.count({ where }),
      this.prisma.registration.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          shortId: true,
          firstName: true,
          lastName: true,
          birthYear: true,
          opstina: true,
          opstinaSlug: true,
          controlRegionId: true,
          phone: true,
          phoneNormalized: true,
          email: true,
          submittedAt: true,
          pollingStation: {
            select: {
              psId: true,
              muniId: true,
              bmBroj: true,
              bmNazivLat: true,
            },
          },
        },
      }),
    ]);

    const rows: RegistrationRow[] = raw.map((r) => ({
      id: r.id,
      shortId: r.shortId,
      firstName: r.firstName,
      lastName: r.lastName,
      birthYear: r.birthYear,
      opstina: r.opstina,
      opstinaSlug: r.opstinaSlug,
      controlRegionId: r.controlRegionId,
      muniId: r.pollingStation?.muniId ?? null,
      psId: r.pollingStation?.psId ?? null,
      bmBroj: r.pollingStation?.bmBroj ?? null,
      bmNaziv: r.pollingStation?.bmNazivLat ?? null,
      phone: r.phone,
      phoneNormalized: r.phoneNormalized,
      email: r.email,
      submittedAt: r.submittedAt,
    }));

    return {
      rows,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /**
   * Returns data for export (everything matching filters, no pagination, with a hard limit).
   * Returns the same shape as listRegistrations rows plus a flag indicating truncation.
   */
  async exportRegistrations(
    filters: ListFilters,
    scope: Scope,
  ): Promise<{
    rows: RegistrationRow[];
    truncated: boolean;
  }> {
    const where = this.buildWhere(filters, scope);
    const raw = await this.prisma.registration.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      take: MAX_EXPORT_ROWS + 1,
      select: {
        id: true,
        shortId: true,
        firstName: true,
        lastName: true,
        birthYear: true,
        opstina: true,
        opstinaSlug: true,
        controlRegionId: true,
        phone: true,
        phoneNormalized: true,
        email: true,
        submittedAt: true,
        pollingStation: {
          select: {
            psId: true,
            muniId: true,
            bmBroj: true,
            bmNazivLat: true,
          },
        },
      },
    });

    const truncated = raw.length > MAX_EXPORT_ROWS;
    const sliced = truncated ? raw.slice(0, MAX_EXPORT_ROWS) : raw;
    const rows: RegistrationRow[] = sliced.map((r) => ({
      id: r.id,
      shortId: r.shortId,
      firstName: r.firstName,
      lastName: r.lastName,
      birthYear: r.birthYear,
      opstina: r.opstina,
      opstinaSlug: r.opstinaSlug,
      controlRegionId: r.controlRegionId,
      muniId: r.pollingStation?.muniId ?? null,
      psId: r.pollingStation?.psId ?? null,
      bmBroj: r.pollingStation?.bmBroj ?? null,
      bmNaziv: r.pollingStation?.bmNazivLat ?? null,
      phone: r.phone,
      phoneNormalized: r.phoneNormalized,
      email: r.email,
      submittedAt: r.submittedAt,
    }));

    return { rows, truncated };
  }

  /**
   * Group by municipality with counts.
   * Returns a list of opstinaSlug + name + count, sorted by count desc, then by name.
   */
  async groupByOpstina(filters: ListFilters, scope: Scope): Promise<
    Array<{ slug: string; naziv: string; count: number }>
  > {
    const where = this.buildWhere(filters, scope);
    const groups = await this.prisma.registration.groupBy({
      by: ['opstinaSlug', 'opstina'],
      where,
      _count: { _all: true },
      orderBy: [{ _count: { id: 'desc' } }, { opstina: 'asc' }],
    });
    return groups.map((g) => ({
      slug: g.opstinaSlug,
      naziv: g.opstina,
      count: g._count._all,
    }));
  }

  // -------------- per-region survey toggle --------------

  async getSurveyOpen(scope: Scope): Promise<boolean> {
    const row = await this.prisma.controlRegion.findUnique({
      where: { id: scope.controlRegionId },
      select: { surveyOpen: true },
    });
    return row?.surveyOpen ?? false;
  }

  async setSurveyOpen(
    value: boolean,
    scope: Scope,
    ctx: { byUserId: string; ipAddress: string; userAgent: string },
  ): Promise<void> {
    await this.prisma.controlRegion.update({
      where: { id: scope.controlRegionId },
      data: { surveyOpen: value },
    });
    this.logger.log(
      `surveyOpen=${value} cr=${scope.controlRegionId} by=${ctx.byUserId.slice(0, 8)}`,
    );
    await this.audit.log({
      event: value ? AuditEvent.SURVEY_OPENED : AuditEvent.SURVEY_CLOSED,
      userId: ctx.byUserId,
      controlRegionId: scope.controlRegionId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /** Lookup of the current admin's control region name (for header badge). */
  async getControlRegionName(controlRegionId: number): Promise<string> {
    const cr = await this.prisma.controlRegion.findUnique({
      where: { id: controlRegionId },
      select: { name: true },
    });
    return cr?.name ?? `CR #${controlRegionId}`;
  }
}
