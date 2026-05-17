import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IpSaltService } from '../common/ip-salt.service';
import { sha256Hex } from '../common/normalize';
import { AuditEvent, AuditEventName, AUDIT_EVENT_VALUES } from './audit.events';

/**
 * Options for a single audit log entry.
 *
 * NB: `ipAddress` is a plain string. We hash it internally with the daily salt
 * (same as registrations) so audit and registrations are comparable
 * within the same day.
 *
 * `metadata` must not contain raw PII (phone, plain email). The
 * `maskEmail()` helper exists for the "ma***@domain" format.
 */
export type AuditOptions = {
  event: AuditEventName;
  userId?: string | null;
  targetUserId?: string | null;
  ipAddress: string;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

export type AuditListFilters = {
  event?: AuditEventName | '';
  userId?: string;
  targetUserId?: string;
  od?: string;
  do?: string;
};

export type AuditListQuery = AuditListFilters & {
  page: number;
  pageSize: number;
};

export type AuditRow = {
  id: string; // BigInt → string for JSON serialization
  event: string;
  userId: string | null;
  /** User email if resolved (may be null when the user no longer exists) */
  userEmail: string | null;
  targetUserId: string | null;
  targetEmail: string | null;
  ipHash: string;
  userAgent: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ipSalt: IpSaltService,
  ) {}

  /**
   * Main log entry point.
   *
   * CRITICAL: this call must NEVER throw an error that would break the
   * caller. Audit log failure is logged to stdout but not propagated.
   */
  async log(opts: AuditOptions): Promise<void> {
    try {
      const salt = await this.ipSalt.get();
      const ipHash = sha256Hex(`${opts.ipAddress ?? ''}::${salt}`);
      await this.prisma.auditLog.create({
        data: {
          event: opts.event,
          userId: opts.userId ?? null,
          targetUserId: opts.targetUserId ?? null,
          ipHash,
          userAgent: (opts.userAgent ?? '').slice(0, 500),
          metadata: (opts.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (e: any) {
      // Never throw — audit must not block the user
      this.logger.error(
        `Audit log failure event=${opts.event}: ${e?.message ?? e}`,
      );
    }
  }

  // -------------- Admin queries ----------------

  parseFilters(query: Record<string, unknown>): AuditListFilters {
    const out: AuditListFilters = {};

    const event = typeof query.event === 'string' ? query.event.trim() : '';
    if (event && AUDIT_EVENT_VALUES.includes(event as AuditEventName)) {
      out.event = event as AuditEventName;
    }

    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const userId = typeof query.userId === 'string' ? query.userId.trim() : '';
    if (userId && uuid.test(userId)) out.userId = userId;
    const targetUserId =
      typeof query.targetUserId === 'string' ? query.targetUserId.trim() : '';
    if (targetUserId && uuid.test(targetUserId)) out.targetUserId = targetUserId;

    const od = typeof query.od === 'string' ? query.od.trim() : '';
    if (od && /^\d{4}-\d{2}-\d{2}$/.test(od) && !Number.isNaN(Date.parse(od))) out.od = od;
    const dO = typeof query.do === 'string' ? query.do.trim() : '';
    if (dO && /^\d{4}-\d{2}-\d{2}$/.test(dO) && !Number.isNaN(Date.parse(dO))) out.do = dO;

    return out;
  }

  parsePagination(query: Record<string, unknown>): { page: number; pageSize: number } {
    const rawPage = typeof query.page === 'string' ? parseInt(query.page, 10) : 1;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    return { page, pageSize: DEFAULT_PAGE_SIZE };
  }

  async list(query: AuditListQuery): Promise<{
    rows: AuditRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.event) where.event = query.event;
    if (query.userId) where.userId = query.userId;
    if (query.targetUserId) where.targetUserId = query.targetUserId;
    if (query.od || query.do) {
      where.createdAt = {};
      if (query.od) where.createdAt.gte = new Date(`${query.od}T00:00:00.000Z`);
      if (query.do) where.createdAt.lte = new Date(`${query.do}T23:59:59.999Z`);
    }

    const [total, raw] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: Math.min(query.pageSize, MAX_PAGE_SIZE),
      }),
    ]);

    // Resolve user emails for all userId and targetUserId values at once (1 query)
    const userIds = new Set<string>();
    for (const r of raw) {
      if (r.userId) userIds.add(r.userId);
      if (r.targetUserId) userIds.add(r.targetUserId);
    }
    const users =
      userIds.size === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: Array.from(userIds) } },
            select: { id: true, email: true },
          });
    const emailById = new Map(users.map((u) => [u.id, u.email]));

    const rows: AuditRow[] = raw.map((r) => ({
      id: r.id.toString(),
      event: r.event,
      userId: r.userId,
      userEmail: r.userId ? emailById.get(r.userId) ?? null : null,
      targetUserId: r.targetUserId,
      targetEmail: r.targetUserId ? emailById.get(r.targetUserId) ?? null : null,
      ipHash: r.ipHash,
      userAgent: r.userAgent,
      metadata: r.metadata as Record<string, unknown>,
      createdAt: r.createdAt,
    }));

    return {
      rows,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }
}

// Re-export for import convenience
export { AuditEvent } from './audit.events';
