import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEvent, maskEmail } from '../audit/audit.events';
import { IpSaltService } from '../common/ip-salt.service';
import {
  generateShortId,
  normalizeEmail,
  normalizePhoneRS,
  sha256Hex,
} from '../common/normalize';
import { SubmitDto } from './dto/submit.dto';

/**
 * Service for receiving registrations.
 *
 * Responsibilities:
 *   - check whether survey is open (system_config.survey_open)
 *   - normalize phone and email (for unique check, does not replace original)
 *   - verify polling station belongs to selected municipality
 *   - generate short_id
 *   - hash IP with daily salt (anonymization)
 *   - map DB unique violation to user-friendly error
 */
@Injectable()
export class RegistrationsService {
  private readonly logger = new Logger(RegistrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ipSalt: IpSaltService,
  ) {}

  /**
   * Is the survey open? Default true if key is missing.
   * Will be memory-cached later; currently reads DB every time.
   */
  async isSurveyOpen(): Promise<boolean> {
    const row = await this.prisma.systemConfig.findUnique({
      where: { key: 'survey_open' },
    });
    if (!row) return true;
    return row.value === 'true';
  }

  /**
   * Main submit function.
   * Returns { shortId } on success.
   */
  async submit(
    dto: SubmitDto,
    meta: { ipAddress: string; userAgent: string },
  ): Promise<{ shortId: string }> {
    const auditCtx = {
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    };

    // 1. Honeypot — silent success
    if (dto._hp && dto._hp.trim().length > 0) {
      this.logger.warn(`Honeypot triggered, IP=${meta.ipAddress.slice(0, 20)}`);
      await this.audit.log({
        event: AuditEvent.SUBMIT_BOT,
        ...auditCtx,
        metadata: { opstinaSlug: dto.opstinaSlug },
      });
      return { shortId: 'BOT00000' };
    }

    // 2. Survey open?
    if (!(await this.isSurveyOpen())) {
      await this.audit.log({
        event: AuditEvent.SUBMIT_SURVEY_CLOSED,
        ...auditCtx,
      });
      throw new ForbiddenException('Anketa je zatvorena.');
    }

    // 3. Resolve municipality — polling station is optional, but municipality is required.
    //    If polling station is given, validate it belongs to that municipality.
    //    If not given, use name from first station for that municipality
    //    (all stations in same municipality share the same `opstinaLat`).
    let station: { id: number; opstinaSlug: string; opstinaLat: string; bmBroj: string | null } | null = null;
    let opstinaLat: string;

    if (dto.pollingStationId !== undefined) {
      const found = await this.prisma.pollingStation.findUnique({
        where: { id: dto.pollingStationId },
      });
      if (!found) {
        throw new BadRequestException('Izabrano biračko mesto ne postoji.');
      }
      if (found.opstinaSlug !== dto.opstinaSlug) {
        throw new BadRequestException(
          'Biračko mesto ne pripada izabranoj opštini.',
        );
      }
      station = { ...found };
      opstinaLat = found.opstinaLat;
    } else {
      // Polling station skipped — verify municipality exists in our DB
      const any = await this.prisma.pollingStation.findFirst({
        where: { opstinaSlug: dto.opstinaSlug },
        select: { opstinaLat: true },
      });
      if (!any) {
        throw new BadRequestException('Opština nije validna.');
      }
      opstinaLat = any.opstinaLat;
    }

    // 4. Phone and email normalization (store originals too)
    let phoneNormalized: string;
    let emailNormalized: string;
    try {
      phoneNormalized = normalizePhoneRS(dto.phone);
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Telefon nije validan');
    }
    try {
      emailNormalized = normalizeEmail(dto.email);
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Email nije validan');
    }

    // 5. IP hash with daily salt (anonymization)
    const salt = await this.ipSalt.get();
    const ipHash = sha256Hex(`${meta.ipAddress}::${salt}`);

    // 6. Short ID with retry (collision probability negligible, but just in case)
    for (let attempt = 0; attempt < 3; attempt++) {
      const shortId = generateShortId(8);
      try {
        await this.prisma.registration.create({
          data: {
            shortId,
            firstName: dto.firstName,
            lastName: dto.lastName,
            birthYear: dto.birthYear ?? null,
            opstina: opstinaLat,
            opstinaSlug: dto.opstinaSlug,
            pollingStationId: station?.id ?? null,
            phone: dto.phone,
            phoneNormalized,
            email: dto.email,
            emailNormalized,
            // Implicit consent — set at submit time.
            // Valid fineprint is shown on the public form.
            consentAt: new Date(),
            ipHash,
            userAgent: meta.userAgent.slice(0, 500),
          },
        });
        this.logger.log(
          `Prijava OK: ${shortId} (opština=${dto.opstinaSlug}, BM=${station?.bmBroj ?? '—'})`,
        );
        await this.audit.log({
          event: AuditEvent.SUBMIT_OK,
          ...auditCtx,
          metadata: {
            shortId,
            opstinaSlug: dto.opstinaSlug,
            bmBroj: station?.bmBroj ?? null,
            emailMasked: maskEmail(dto.email),
          },
        });
        return { shortId };
      } catch (e: unknown) {
        if (e instanceof Prisma.PrismaClientKnownRequestError) {
          if (e.code === 'P2002') {
            const target = (e.meta?.target as string[] | undefined) ?? [];
            if (target.includes('short_id')) {
              continue; // retry with new short_id
            }
            const dupField = target.includes('phone_normalized')
              ? 'phone'
              : target.includes('email_normalized')
                ? 'email'
                : 'unknown';
            await this.audit.log({
              event: AuditEvent.SUBMIT_DUPLICATE,
              ...auditCtx,
              metadata: { field: dupField, opstinaSlug: dto.opstinaSlug },
            });
            if (dupField === 'phone') {
              throw new ConflictException('Ovaj telefon je već prijavljen.');
            }
            if (dupField === 'email') {
              throw new ConflictException('Ovaj email je već prijavljen.');
            }
            throw new ConflictException('Već ste se prijavili.');
          }
        }
        throw e;
      }
    }
    throw new Error('Nije moguće generisati unikatan ID; pokušajte ponovo.');
  }
}
