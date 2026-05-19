import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { SessionsService } from '../auth/sessions.service';
import { AuditService } from '../audit/audit.service';
import { AuditEvent, maskEmail } from '../audit/audit.events';
import { PASSWORD_MIN_LENGTH } from '../auth/auth.constants';

export type AdminUserRow = {
  id: string;
  email: string;
  controlRegionId: number;
  createdAt: Date;
  lastLoginAt: Date | null;
  lockedUntil: Date | null;
  failedLoginCount: number;
  deletedAt: Date | null;
  activeSessions: number;
  isSelf: boolean;
};

/**
 * Service for managing admin users from the admin panel.
 *
 * Security rules:
 *  - Email must be valid and unique (case-insensitive, citext column)
 *  - Password must be >= PASSWORD_MIN_LENGTH characters
 *  - An admin cannot deactivate themselves (anti-lockout)
 *  - The system does not allow deactivating the last active admin
 *  - Password reset automatically revokes all sessions for the affected user
 *  - Deactivation is a soft delete (deletedAt) + session revoke (survey history remains)
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  // ---------- read ----------

  /**
   * List admins. Scoped to a single control region so admins only see
   * peers within their own region (no cross-region visibility).
   */
  async listAdmins(
    currentUserId: string,
    scopedControlRegionId: number,
  ): Promise<AdminUserRow[]> {
    const users = await this.prisma.user.findMany({
      where: { controlRegionId: scopedControlRegionId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        controlRegionId: true,
        createdAt: true,
        lastLoginAt: true,
        lockedUntil: true,
        failedLoginCount: true,
        deletedAt: true,
        _count: {
          select: {
            sessions: {
              where: {
                revokedAt: null,
                absoluteExpiresAt: { gt: new Date() },
              },
            },
          },
        },
      },
    });

    const rows: AdminUserRow[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      controlRegionId: u.controlRegionId,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      lockedUntil: u.lockedUntil,
      failedLoginCount: u.failedLoginCount,
      deletedAt: u.deletedAt,
      activeSessions: u._count.sessions,
      isSelf: u.id === currentUserId,
    }));

    // Active first, deactivated last; within each group by createdAt
    rows.sort((a, b) => {
      if (!a.deletedAt && b.deletedAt) return -1;
      if (a.deletedAt && !b.deletedAt) return 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return rows;
  }

  // ---------- write ----------

  /**
   * Creates a new admin.
   * Email is normalized (lowercase, trim). Password is Argon2id-hashed.
   */
  async createAdmin(input: {
    email: string;
    password: string;
    controlRegionId: number;
    byUserId: string;
    ipAddress: string;
    userAgent: string;
  }): Promise<{ id: string }> {
    const email = (input.email ?? '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Email nije validan.');
    }
    if (email.length > 254) {
      throw new BadRequestException('Email je predugačak.');
    }

    let passwordHash: string;
    try {
      passwordHash = await this.auth.hashPassword(input.password ?? '');
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Lozinka nije validna.');
    }

    try {
      const created = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          role: 'admin',
          controlRegionId: input.controlRegionId,
        },
        select: { id: true },
      });
      this.logger.log(
        `Admin kreiran: ${created.id.slice(0, 8)} email=${email} cr=${input.controlRegionId} by=${input.byUserId.slice(0, 8)}`,
      );
      await this.audit.log({
        event: AuditEvent.ADMIN_CREATED,
        userId: input.byUserId,
        targetUserId: created.id,
        controlRegionId: input.controlRegionId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: { emailMasked: maskEmail(email) },
      });
      return created;
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Već postoji admin sa tim email-om.');
      }
      throw e;
    }
  }

  /**
   * Verify that the target admin belongs to the inviting admin's control
   * region. Cross-region mutation is treated as not found (do not leak
   * existence of admins in other regions).
   */
  private async loadTargetInScope(
    targetUserId: string,
    scopedControlRegionId: number,
  ): Promise<{ id: string; email: string; deletedAt: Date | null; controlRegionId: number } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, deletedAt: true, controlRegionId: true },
    });
    if (!user) return null;
    if (user.controlRegionId !== scopedControlRegionId) return null;
    return user;
  }

  /**
   * Password reset. All active sessions for the affected admin are revoked.
   * An admin may reset their own password (alternative to "change password").
   */
  async resetPassword(input: {
    targetUserId: string;
    newPassword: string;
    byUserId: string;
    scopedControlRegionId: number;
    ipAddress: string;
    userAgent: string;
  }): Promise<void> {
    const user = await this.loadTargetInScope(
      input.targetUserId,
      input.scopedControlRegionId,
    );
    if (!user) throw new NotFoundException('Admin ne postoji.');
    if (user.deletedAt) {
      throw new BadRequestException(
        'Nije moguće promeniti lozinku deaktiviranom adminu. Najpre reaktiviraj.',
      );
    }

    let passwordHash: string;
    try {
      passwordHash = await this.auth.hashPassword(input.newPassword ?? '');
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Lozinka nije validna.');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: input.targetUserId },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.session.updateMany({
        where: { userId: input.targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    this.logger.log(
      `Reset lozinke: target=${input.targetUserId.slice(0, 8)} by=${input.byUserId.slice(0, 8)}`,
    );
    await this.audit.log({
      event: AuditEvent.ADMIN_PASSWORD_RESET,
      userId: input.byUserId,
      targetUserId: input.targetUserId,
      controlRegionId: input.scopedControlRegionId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: { selfReset: input.byUserId === input.targetUserId },
    });
  }

  /**
   * Soft-delete an admin account. All sessions are revoked immediately.
   */
  async deactivate(input: {
    targetUserId: string;
    byUserId: string;
    scopedControlRegionId: number;
    ipAddress: string;
    userAgent: string;
  }): Promise<void> {
    if (input.targetUserId === input.byUserId) {
      throw new ForbiddenException(
        'Ne možeš deaktivirati sopstveni nalog (rizik od zaključavanja). ' +
          'Zamoli drugog admina da to uradi.',
      );
    }

    const target = await this.loadTargetInScope(
      input.targetUserId,
      input.scopedControlRegionId,
    );
    if (!target) throw new NotFoundException('Admin ne postoji.');
    if (target.deletedAt) {
      throw new BadRequestException('Admin je već deaktiviran.');
    }

    // Anti-lockout: do not allow deactivating the last active admin
    // WITHIN this control region.
    const activeCount = await this.prisma.user.count({
      where: { deletedAt: null, controlRegionId: input.scopedControlRegionId },
    });
    if (activeCount <= 1) {
      throw new ForbiddenException(
        'Nije moguće deaktivirati poslednjeg aktivnog admina ovog univerziteta.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: input.targetUserId },
        data: { deletedAt: new Date() },
      }),
      this.prisma.session.updateMany({
        where: { userId: input.targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    this.logger.log(
      `Admin deaktiviran: target=${input.targetUserId.slice(0, 8)} by=${input.byUserId.slice(0, 8)}`,
    );
    await this.audit.log({
      event: AuditEvent.ADMIN_DEACTIVATED,
      userId: input.byUserId,
      targetUserId: input.targetUserId,
      controlRegionId: input.scopedControlRegionId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  }

  /**
   * Reactivate a previously deactivated account. Resets failedLoginCount/lockedUntil
   * so the admin does not have to change the password immediately due to an old lockout.
   */
  async reactivate(input: {
    targetUserId: string;
    byUserId: string;
    scopedControlRegionId: number;
    ipAddress: string;
    userAgent: string;
  }): Promise<void> {
    const target = await this.loadTargetInScope(
      input.targetUserId,
      input.scopedControlRegionId,
    );
    if (!target) throw new NotFoundException('Admin ne postoji.');
    if (!target.deletedAt) {
      throw new BadRequestException('Admin nije deaktiviran.');
    }
    await this.prisma.user.update({
      where: { id: input.targetUserId },
      data: { deletedAt: null, failedLoginCount: 0, lockedUntil: null },
    });
    this.logger.log(
      `Admin reaktiviran: target=${input.targetUserId.slice(0, 8)} by=${input.byUserId.slice(0, 8)}`,
    );
    await this.audit.log({
      event: AuditEvent.ADMIN_REACTIVATED,
      userId: input.byUserId,
      targetUserId: input.targetUserId,
      controlRegionId: input.scopedControlRegionId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  }

  /**
   * Revoke all active sessions for the affected admin.
   * Useful when we suspect another session was stolen.
   */
  async revokeAllSessions(input: {
    targetUserId: string;
    byUserId: string;
    scopedControlRegionId: number;
    ipAddress: string;
    userAgent: string;
  }): Promise<{ revoked: number }> {
    const target = await this.loadTargetInScope(
      input.targetUserId,
      input.scopedControlRegionId,
    );
    if (!target) throw new NotFoundException('Admin ne postoji.');

    const result = await this.prisma.session.updateMany({
      where: { userId: input.targetUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger.log(
      `Revoke sesija: target=${input.targetUserId.slice(0, 8)} by=${input.byUserId.slice(0, 8)} count=${result.count}`,
    );
    await this.audit.log({
      event: AuditEvent.ADMIN_SESSIONS_REVOKED,
      userId: input.byUserId,
      targetUserId: input.targetUserId,
      controlRegionId: input.scopedControlRegionId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: { count: result.count },
    });
    return { revoked: result.count };
  }
}

// Re-export so templates can import PASSWORD_MIN_LENGTH without pulling auth.constants directly.
export { PASSWORD_MIN_LENGTH };
