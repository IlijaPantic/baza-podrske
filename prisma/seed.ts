/**
 * Prisma seed — fills `polling_stations` and default `system_config`.
 *
 * Run:
 *   npm run db:seed
 * or directly:
 *   npx prisma db seed
 *
 * Idempotent — can be run multiple times.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

type SeedFile = {
  opstine: Array<{
    muni_id: number | null;
    slug: string;
    naziv_cir: string;
    naziv_lat: string;
    bm_count: number;
  }>;
  polling_stations: Array<{
    ps_id: string | null;
    muni_id: number | null;
    opstina_cir: string;
    opstina_lat: string;
    opstina_slug: string;
    bm_broj: string;
    bm_naziv_cir: string;
    bm_naziv_lat: string;
    bm_raw: string;
  }>;
};

async function seedPollingStations() {
  const file = join(__dirname, '..', 'data', 'polling-stations-vojvodina.json');
  const data: SeedFile = JSON.parse(readFileSync(file, 'utf8'));

  console.log(
    `Učitano: ${data.opstine.length} opština, ${data.polling_stations.length} BM-a`,
  );

  const existing = await prisma.pollingStation.count();

  if (existing === 0) {
    // First-time seed — bulk insert
    const result = await prisma.pollingStation.createMany({
      data: data.polling_stations.map((p) => ({
        psId: p.ps_id,
        muniId: p.muni_id,
        opstinaCir: p.opstina_cir,
        opstinaLat: p.opstina_lat,
        opstinaSlug: p.opstina_slug,
        bmBroj: p.bm_broj,
        bmNazivCir: p.bm_naziv_cir,
        bmNazivLat: p.bm_naziv_lat,
        bmRaw: p.bm_raw,
      })),
      skipDuplicates: true,
    });
    console.log(`✓ Ubacio ${result.count} BM-a u polling_stations`);
    return;
  }

  // Data already exists — idempotent backfill of `muniId` and `psId`.
  // muniId: by opstinaSlug (all polling stations in a municipality share the same value).
  // psId: by (opstinaSlug, bmBroj) — unique per polling station.
  console.log(
    `polling_stations već ima ${existing} redova — pokrećem backfill muniId i psId...`,
  );

  // 1) muniId backfill per municipality
  const slugToMuniId = new Map<string, number>();
  for (const p of data.polling_stations) {
    if (p.muni_id != null && !slugToMuniId.has(p.opstina_slug)) {
      slugToMuniId.set(p.opstina_slug, p.muni_id);
    }
  }
  let muniUpdated = 0;
  for (const [slug, muniId] of slugToMuniId) {
    const res = await prisma.pollingStation.updateMany({
      where: { opstinaSlug: slug, muniId: null },
      data: { muniId },
    });
    muniUpdated += res.count;
  }
  console.log(`  ✓ muniId backfill: ${muniUpdated} redova`);

  // 2) psId backfill by (opstinaSlug, bmBroj)
  let psUpdated = 0;
  let psSkipped = 0;
  for (const p of data.polling_stations) {
    if (!p.ps_id) continue;
    try {
      const res = await prisma.pollingStation.updateMany({
        where: {
          opstinaSlug: p.opstina_slug,
          bmBroj: p.bm_broj,
          psId: null, // do not touch rows that already have psId
        },
        data: { psId: p.ps_id },
      });
      psUpdated += res.count;
    } catch (e: any) {
      // Unique violation — someone already had the same psId; log and skip
      psSkipped++;
      if (psSkipped < 5) {
        console.warn(
          `  ! psId backfill skip: slug=${p.opstina_slug} bm=${p.bm_broj} ps_id=${p.ps_id} (${e?.message?.slice(0, 80)})`,
        );
      }
    }
  }
  console.log(
    `  ✓ psId backfill: ${psUpdated} redova` +
      (psSkipped > 0 ? `, ${psSkipped} preskočeno (duplikati)` : ''),
  );
}

async function seedSystemConfig() {
  // Survey open by default
  await prisma.systemConfig.upsert({
    where: { key: 'survey_open' },
    create: { key: 'survey_open', value: 'true' },
    update: {},
  });

  // Salt for IP hash — rotated in Phase 2
  await prisma.systemConfig.upsert({
    where: { key: 'daily_ip_salt' },
    create: {
      key: 'daily_ip_salt',
      value: randomBytes(32).toString('base64'),
    },
    update: {},
  });

  console.log('✓ system_config inicijalizovan (survey_open=true, daily_ip_salt=randomized)');
}

async function main() {
  console.log('--- Kontrola seed start ---');
  await seedPollingStations();
  await seedSystemConfig();
  console.log('--- Seed kompletiran ---');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Seed neuspeo:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
