import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Short acronym shown next to opština name on the public form
 * ("Novi Sad (UNS, 1702 BM)").
 * Matches control_region IDs from data/ps_regions_1.json.
 */
export const CONTROL_REGION_ACRONYMS: Record<number, string> = {
  1: 'UNP', // Univerzitet u Novom Pazaru
  2: 'UNKG', // Univerzitet u Kragujevcu
  3: 'UNN', // Univerzitet u Nišu
  4: 'UNS', // Univerzitet u Novom Sadu
  5: 'UB', // Univerzitet u Beogradu
  6: '', // Ostalo — no acronym
};

export function controlRegionAcronym(id: number): string {
  return CONTROL_REGION_ACRONYMS[id] ?? '';
}

export type OpstinaListItem = {
  /** Numeric ID from ps_regions_1.json — used as `?muniid=` redirect parameter. */
  muniId: number | null;
  /** Control region (university) this opština belongs to. */
  controlRegionId: number;
  /** Short label for UI ("UNS", "UNN", "UNKG"). Empty for region "Ostalo". */
  controlRegionAcronym: string;
  slug: string;
  naziv: string;
  bmCount: number;
};

export type BmListItem = {
  id: number;
  broj: string;
  naziv: string;
};

/**
 * Service for listing municipalities and polling stations.
 *
 * Data loads once into in-memory cache on first call and
 * stays cached for the app lifetime (~1776 rows ≈ 200 KB, negligible).
 * Cache is invalidated manually (only seed changes this data).
 */
/** Per-opština metadata for resolving control region from URL parameters. */
export type OpstinaMeta = {
  slug: string;
  muniId: number;
  controlRegionId: number;
  naziv: string;
};

@Injectable()
export class PollingStationsService {
  private opstineCache: OpstinaListItem[] | null = null;
  private bmCache: Map<string, BmListItem[]> | null = null;
  /** Fast slug lookup by muniId (`?muniid=` query). */
  private muniIdToSlugCache: Map<number, string> | null = null;
  /** Slug → opština metadata (for resolving control region in submit). */
  private opstinaMetaCache: Map<string, OpstinaMeta> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async loadCache(): Promise<void> {
    if (
      this.opstineCache &&
      this.bmCache &&
      this.muniIdToSlugCache &&
      this.opstinaMetaCache
    ) {
      return;
    }

    const rows = await this.prisma.pollingStation.findMany({
      orderBy: [{ opstinaLat: 'asc' }, { bmBroj: 'asc' }],
      select: {
        id: true,
        muniId: true,
        controlRegionId: true,
        opstinaSlug: true,
        opstinaLat: true,
        bmBroj: true,
        bmNazivLat: true,
      },
    });

    // Group by municipality
    const byOpstina = new Map<string, BmListItem[]>();
    const opstineMap = new Map<string, OpstinaListItem>();
    const muniIdToSlug = new Map<number, string>();
    const opstinaMeta = new Map<string, OpstinaMeta>();
    for (const r of rows) {
      if (!byOpstina.has(r.opstinaSlug)) {
        byOpstina.set(r.opstinaSlug, []);
        opstineMap.set(r.opstinaSlug, {
          muniId: r.muniId,
          controlRegionId: r.controlRegionId,
          controlRegionAcronym: controlRegionAcronym(r.controlRegionId),
          slug: r.opstinaSlug,
          naziv: r.opstinaLat,
          bmCount: 0,
        });
        if (r.muniId != null) {
          muniIdToSlug.set(r.muniId, r.opstinaSlug);
          opstinaMeta.set(r.opstinaSlug, {
            slug: r.opstinaSlug,
            muniId: r.muniId,
            controlRegionId: r.controlRegionId,
            naziv: r.opstinaLat,
          });
        }
      }
      byOpstina.get(r.opstinaSlug)!.push({
        id: r.id,
        broj: r.bmBroj,
        naziv: `${r.bmBroj} — ${r.bmNazivLat}`,
      });
      opstineMap.get(r.opstinaSlug)!.bmCount++;
    }

    // Sort polling stations within each municipality by numeric value
    for (const [slug, list] of byOpstina) {
      list.sort((a, b) => {
        const na = parseInt(a.broj, 10);
        const nb = parseInt(b.broj, 10);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return a.broj.localeCompare(b.broj);
      });
      byOpstina.set(slug, list);
    }

    this.bmCache = byOpstina;
    this.muniIdToSlugCache = muniIdToSlug;
    this.opstinaMetaCache = opstinaMeta;
    this.opstineCache = Array.from(opstineMap.values()).sort((a, b) =>
      a.naziv.localeCompare(b.naziv, 'sr'),
    );
  }

  /**
   * Turn numeric `muniId` (from `?muniid=` query) into the `opstinaSlug` used
   * internally by the form. Returns null if muniId is missing or not in
   * the active dataset.
   */
  async resolveOpstinaSlugByMuniId(muniId: number): Promise<string | null> {
    await this.loadCache();
    return this.muniIdToSlugCache!.get(muniId) ?? null;
  }

  /**
   * Resolve full opština metadata (including controlRegionId) by slug.
   * Used by submit logic to attach control region scope to a registration.
   */
  async getOpstinaMeta(slug: string): Promise<OpstinaMeta | null> {
    await this.loadCache();
    return this.opstinaMetaCache!.get(slug) ?? null;
  }

  /** List all municipalities across all active control regions. */
  async listOpstine(): Promise<OpstinaListItem[]> {
    await this.loadCache();
    return this.opstineCache!;
  }

  /** List municipalities filtered to a single control region (admin scope). */
  async listOpstineForControlRegion(controlRegionId: number): Promise<OpstinaListItem[]> {
    await this.loadCache();
    return this.opstineCache!.filter((o) => o.controlRegionId === controlRegionId);
  }

  /** Returns all polling stations from DB, grouped by municipality slug. */
  async allByOpstina(): Promise<Record<string, BmListItem[]>> {
    await this.loadCache();
    const out: Record<string, BmListItem[]> = {};
    for (const [slug, list] of this.bmCache!) {
      out[slug] = list;
    }
    return out;
  }

  /** Returns polling stations for one municipality. */
  async byOpstina(slug: string): Promise<BmListItem[]> {
    await this.loadCache();
    return this.bmCache!.get(slug) ?? [];
  }

  /** Manual invalidation (e.g. after re-seed). */
  invalidate(): void {
    this.opstineCache = null;
    this.bmCache = null;
    this.muniIdToSlugCache = null;
    this.opstinaMetaCache = null;
  }
}
