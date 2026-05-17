import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type OpstinaListItem = {
  /** Numeric ID from ps_regions.json — used as `?muniid=` redirect parameter. */
  muniId: number | null;
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
@Injectable()
export class PollingStationsService {
  private opstineCache: OpstinaListItem[] | null = null;
  private bmCache: Map<string, BmListItem[]> | null = null;
  /** Fast slug lookup by muniId (`?muniid=` query). */
  private muniIdToSlugCache: Map<number, string> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async loadCache(): Promise<void> {
    if (this.opstineCache && this.bmCache && this.muniIdToSlugCache) return;

    const rows = await this.prisma.pollingStation.findMany({
      orderBy: [{ opstinaLat: 'asc' }, { bmBroj: 'asc' }],
      select: {
        id: true,
        muniId: true,
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
    for (const r of rows) {
      if (!byOpstina.has(r.opstinaSlug)) {
        byOpstina.set(r.opstinaSlug, []);
        opstineMap.set(r.opstinaSlug, {
          muniId: r.muniId,
          slug: r.opstinaSlug,
          naziv: r.opstinaLat,
          bmCount: 0,
        });
        if (r.muniId != null) muniIdToSlug.set(r.muniId, r.opstinaSlug);
      }
      byOpstina.get(r.opstinaSlug)!.push({
        id: r.id,
        broj: r.bmBroj,
        // Sort polling stations by numeric station number, with fallback
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
    this.opstineCache = Array.from(opstineMap.values()).sort((a, b) =>
      a.naziv.localeCompare(b.naziv, 'sr'),
    );
  }

  /**
   * Turn numeric `muniId` (from `?muniid=` query) into the `opstinaSlug` used
   * internally by the form. Returns null if muniId is missing or not in
   * the Vojvodina dataset.
   */
  async resolveOpstinaSlugByMuniId(muniId: number): Promise<string | null> {
    await this.loadCache();
    return this.muniIdToSlugCache!.get(muniId) ?? null;
  }

  /**
   * Returns list of all municipalities (Vojvodina).
   */
  async listOpstine(): Promise<OpstinaListItem[]> {
    await this.loadCache();
    return this.opstineCache!;
  }

  /**
   * Returns all polling stations from DB, grouped by municipality slug (for embedding in page).
   */
  async allByOpstina(): Promise<Record<string, BmListItem[]>> {
    await this.loadCache();
    const out: Record<string, BmListItem[]> = {};
    for (const [slug, list] of this.bmCache!) {
      out[slug] = list;
    }
    return out;
  }

  /**
   * Returns polling stations for one municipality. For API endpoint if we do not want
   * to embed everything (left as an option).
   */
  async byOpstina(slug: string): Promise<BmListItem[]> {
    await this.loadCache();
    return this.bmCache!.get(slug) ?? [];
  }

  /** Manual invalidation (e.g. after re-seed). */
  invalidate(): void {
    this.opstineCache = null;
    this.bmCache = null;
    this.muniIdToSlugCache = null;
  }
}
