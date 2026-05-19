import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { PollingStationsService } from '../polling-stations/polling-stations.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { formPage } from './templates/form';
import { thankYouPage } from './templates/thank-you';
import { closedPage } from './templates/closed';

/**
 * Public pages (SSR HTML):
 *   GET /          — form (or "closed" if the resolved CR's survey is closed)
 *   GET /hvala     — page after successful registration
 *   GET /zatvoreno — direct check (debug / link)
 *
 * Redirect/prefill parameters:
 *   ?muniid=14           — primary format (numeric ID from ps_regions.json)
 *   ?opstina=novi-sad    — backward-compat (slug), kept for safety
 *                         during transition to the new format
 *   If both are given, `muniid` takes precedence.
 */
@Controller()
export class PublicController {
  constructor(
    private readonly stations: PollingStationsService,
    private readonly registrations: RegistrationsService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Cache strategy for GET / (see cache headers below):
  //   - public: allow Cloudflare (and any CDN) to cache
  //   - max-age=30 (browser): user who refreshes quickly gets the same HTML
  //   - s-maxage=60 (CDN): CF cache 60s — for an event with 50K users in 15min,
  //     CF amortizes 99%+ of requests (because the HTML page is the same for everyone with the same
  //     `opstina` query value).
  //   - Vary: Accept-Encoding (standard for gzip/br compression)
  //
  // Trade-off: when admin closes the survey, existing cache may still
  // show the form for up to 60s. That is acceptable (admin is notified in the UI).
  @Header(
    'Cache-Control',
    'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
  )
  @Header('Vary', 'Accept-Encoding')
  async index(
    @Query('opstina') opstinaQuery: string | undefined,
    @Query('muniid') muniIdQuery: string | undefined,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<string> {
    // If a specific muniid is given, check ONLY that municipality's control
    // region. Otherwise fall back to "is any region accepting submissions".
    let surveyOpen: boolean;
    if (muniIdQuery !== undefined) {
      const parsed = parseInt(muniIdQuery, 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        const slug = await this.stations.resolveOpstinaSlugByMuniId(parsed);
        if (slug) {
          const meta = await this.stations.getOpstinaMeta(slug);
          surveyOpen = meta
            ? await this.registrations.isSurveyOpenFor(meta.controlRegionId)
            : await this.registrations.isAnySurveyOpen();
        } else {
          surveyOpen = await this.registrations.isAnySurveyOpen();
        }
      } else {
        surveyOpen = await this.registrations.isAnySurveyOpen();
      }
    } else {
      surveyOpen = await this.registrations.isAnySurveyOpen();
    }

    if (!surveyOpen) {
      res.status(200);
      res.header(
        'Cache-Control',
        'public, max-age=10, s-maxage=30, stale-while-revalidate=60',
      );
      return closedPage();
    }

    const opstine = await this.stations.listOpstine();
    const bmByOpstina = await this.stations.allByOpstina();

    // Defensive: if seed has not run, dropdown is empty — better show closed
    if (opstine.length === 0) {
      res.status(503);
      res.header('Cache-Control', 'no-store'); // do not cache 503
      return closedPage();
    }

    // Resolve prefilled municipality — `muniid` takes precedence, fallback to `opstina` slug.
    // Both must be on the allowlist (prevents injection via URL).
    let prefilled: string | undefined;
    if (muniIdQuery !== undefined) {
      const parsed = parseInt(muniIdQuery, 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        const resolved = await this.stations.resolveOpstinaSlugByMuniId(parsed);
        if (resolved) prefilled = resolved;
      }
    }
    if (!prefilled && opstinaQuery) {
      if (opstine.some((o) => o.slug === opstinaQuery)) {
        prefilled = opstinaQuery;
      }
    }

    return formPage({
      opstine,
      bmByOpstina,
      prefilledOpstina: prefilled,
    });
  }

  @Get('hvala')
  @Header('Content-Type', 'text/html; charset=utf-8')
  // "Thank you" page is almost static — aggressive cache OK
  @Header(
    'Cache-Control',
    'public, max-age=300, s-maxage=600, stale-while-revalidate=3600',
  )
  thankYou(@Query('id') id?: string): string {
    // Only show id that matches A-Z 2-9 with our length — prevents
    // injection of arbitrary text via query string.
    const safeId = id && /^[A-Z2-9]{6,12}$/.test(id) ? id : undefined;
    return thankYouPage(safeId);
  }

  @Get('zatvoreno')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header(
    'Cache-Control',
    'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
  )
  closed(): string {
    return closedPage();
  }
}
