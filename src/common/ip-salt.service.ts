import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Daily IP salt service.
 *
 * GOAL: The user's IP address is NEVER stored in plain text. Instead,
 * we store `SHA256(ip || '::' || daily_salt)`. The daily salt rotates once
 * per day, which means:
 *
 *   - correlation "same IP today → which records" works (deduplication,
 *     audit triage, abuse investigation within the same day),
 *   - correlation "same IP yesterday vs today" is NO longer possible (forensic
 *     traceback is time-limited to 24h).
 *
 * This is a standard GDPR-friendly technique (Cloudflare does something similar
 * with IPs).
 *
 * IMPLEMENTATION:
 *  - Salt is held in memory (`current`) + persisted in `system_config`
 *    under key `daily_ip_salt`.
 *  - `@Cron(EVERY_DAY_AT_3AM)` rotates (3 AM CET — lowest traffic).
 *  - On startup it is loaded from the database; if missing, it is generated and written.
 *  - Old salts are NOT kept — that is a feature, not a bug. Once it
 *    rotates, yesterday's IP hashes are effectively "frozen" — you can
 *    see them, but not de-anonymize.
 */
@Injectable()
export class IpSaltService implements OnModuleInit {
  private readonly logger = new Logger(IpSaltService.name);
  private current: string = '';
  private currentSetAt: Date | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.loadOrGenerate();
  }

  /**
   * Returns the current salt (always set after onModuleInit).
   * If it is unset for some reason, uses lazy fallback.
   */
  async get(): Promise<string> {
    if (this.current) return this.current;
    return this.loadOrGenerate();
  }

  /**
   * Forced rotation — used from tests or admin action (later).
   */
  async rotate(): Promise<{ rotatedAt: Date }> {
    const newSalt = randomBytes(32).toString('base64');
    await this.prisma.systemConfig.upsert({
      where: { key: 'daily_ip_salt' },
      create: { key: 'daily_ip_salt', value: newSalt },
      update: { value: newSalt },
    });
    this.current = newSalt;
    this.currentSetAt = new Date();
    this.logger.log(`IP salt rotated at ${this.currentSetAt.toISOString()}`);
    return { rotatedAt: this.currentSetAt };
  }

  /**
   * Cron: rotates the salt every day at 3 AM local time (Europe/Belgrade
   * default if TZ env is unset — that is low traffic time).
   *
   * Safe even if the app restarts in between — onModuleInit will load
   * the latest salt from the database. If a run is skipped due to downtime, the next 3 AM
   * will still rotate. It is not catastrophic if the salt stays for 2 days —
   * privacy is only slightly reduced.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async dailyRotation(): Promise<void> {
    this.logger.log('Daily IP salt rotation kicking off...');
    await this.rotate();
  }

  private async loadOrGenerate(): Promise<string> {
    const row = await this.prisma.systemConfig.findUnique({
      where: { key: 'daily_ip_salt' },
    });
    if (row && row.value) {
      this.current = row.value;
      this.currentSetAt = row.updatedAt ?? null;
      return this.current;
    }
    // First startup: salt does not exist yet
    const newSalt = randomBytes(32).toString('base64');
    await this.prisma.systemConfig.upsert({
      where: { key: 'daily_ip_salt' },
      create: { key: 'daily_ip_salt', value: newSalt },
      update: { value: newSalt },
    });
    this.current = newSalt;
    this.currentSetAt = new Date();
    this.logger.log('IP salt initialized (first run)');
    return newSalt;
  }

  /** Debug helper. */
  stats(): { hasSalt: boolean; setAt: string | null } {
    return {
      hasSalt: !!this.current,
      setAt: this.currentSetAt?.toISOString() ?? null,
    };
  }
}
