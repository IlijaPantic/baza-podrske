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
  normalizePhone,
  sha256Hex,
} from '../common/normalize';
import { SubmitDto } from './dto/submit.dto';

/**
 * Service for receiving registrations.
 *
 * Responsibilities:
 *   - check whether survey is open for the resolved control region
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
   * Is the survey open for a specific control region?
   * Each control region has its own kill switch.
   */
  async isSurveyOpenFor(controlRegionId: number): Promise<boolean> {
    const cr = await this.prisma.controlRegion.findUnique({
      where: { id: controlRegionId },
      select: { surveyOpen: true },
    });
    return cr?.surveyOpen ?? false;
  }

  /**
   * Is at least one control region accepting submissions?
   * Used by the public homepage to decide whether to render the form or the
   * "closed" page when no muniid query parameter is present.
   */
  async isAnySurveyOpen(): Promise<boolean> {
    const cnt = await this.prisma.controlRegion.count({
      where: { surveyOpen: true },
    });
    return cnt > 0;
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

    // 2. Resolve municipality and control region — required.
    //    If polling station is given, validate it belongs to that municipality.
    //    If not given, derive control region from any polling station of the
    //    same municipality (all share the same controlRegionId).
    let station: { id: number; opstinaSlug: string; opstinaLat: string; bmBroj: string | null; controlRegionId: number } | null = null;
    let opstinaLat: string;
    let controlRegionId: number;

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
      controlRegionId = found.controlRegionId;
    } else {
      const any = await this.prisma.pollingStation.findFirst({
        where: { opstinaSlug: dto.opstinaSlug },
        select: { opstinaLat: true, controlRegionId: true },
      });
      if (!any) {
        throw new BadRequestException('Opština nije validna.');
      }
      opstinaLat = any.opstinaLat;
      controlRegionId = any.controlRegionId;
    }

    // 3. Survey open for this specific control region?
    if (!(await this.isSurveyOpenFor(controlRegionId))) {
      await this.audit.log({
        event: AuditEvent.SUBMIT_SURVEY_CLOSED,
        ...auditCtx,
        controlRegionId,
        metadata: { opstinaSlug: dto.opstinaSlug },
      });
      throw new ForbiddenException('Anketa je zatvorena za vaš univerzitet.');
    }

    // 4. Phone and email normalization (store originals too)
    let phoneNormalized: string;
    let emailNormalized: string;
    try {
      phoneNormalized = normalizePhone(dto.phone);
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
            controlRegionId,
            phone: dto.phone,
            phoneNormalized,
            email: dto.email,
            emailNormalized,
            consentAt: new Date(),
            ipHash,
            userAgent: meta.userAgent.slice(0, 500),
          },
        });
        this.logger.log(
          `Submit OK: ${shortId} (cr=${controlRegionId} opstina=${dto.opstinaSlug} bm=${station?.bmBroj ?? '—'})`,
        );
        await this.audit.log({
          event: AuditEvent.SUBMIT_OK,
          ...auditCtx,
          controlRegionId,
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
              controlRegionId,
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
