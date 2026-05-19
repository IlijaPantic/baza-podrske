/**
 * Prisma seed — fills `control_regions`, `polling_stations`, and default `system_config`.
 *
 * Run:
 *   npm run db:seed
 * or directly:
 *   npx prisma db seed
 *
 * Idempotent — can be run multiple times. Adds new control_regions and
 * polling_stations if missing; does not touch existing rows.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

type SeedFile = {
  control_regions: Array<{
    id: number;
    name: string;
    slug: string;
  }>;
  opstine: Array<{
    muni_id: number;
    control_region_id: number;
    slug: string;
    naziv_cir: string;
    naziv_lat: string;
    bm_count: number;
  }>;
  polling_stations: Array<{
    ps_id: string;
    muni_id: number;
    control_region_id: number;
    opstina_cir: string;
    opstina_lat: string;
    opstina_slug: string;
    bm_broj: string;
    bm_naziv_cir: string;
    bm_naziv_lat: string;
    bm_raw: string;
  }>;
};

async function seedControlRegions(data: SeedFile) {
  let inserted = 0;
  for (const cr of data.control_regions) {
    await prisma.controlRegion.upsert({
      where: { id: cr.id },
      create: { id: cr.id, name: cr.name, slug: cr.slug },
      update: { name: cr.name, slug: cr.slug },
    });
    inserted++;
  }
  console.log(`✓ control_regions: ${inserted} entries upserted`);
}

async function seedPollingStations(data: SeedFile) {
  console.log(
    `Loaded: ${data.opstine.length} opstine, ${data.polling_stations.length} polling stations`,
  );

  const existing = await prisma.pollingStation.count();

  if (existing === 0) {
    // First-time seed — bulk insert
    const result = await prisma.pollingStation.createMany({
      data: data.polling_stations.map((p) => ({
        psId: p.ps_id,
        muniId: p.muni_id,
        controlRegionId: p.control_region_id,
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
    console.log(`✓ Inserted ${result.count} polling stations`);
    return;
  }

  // Idempotent: only insert polling stations not already present (by psId).
  console.log(
    `polling_stations already has ${existing} rows — inserting only new psIds...`,
  );

  const existingPsIds = new Set(
    (await prisma.pollingStation.findMany({ select: { psId: true } }))
      .map((r) => r.psId)
      .filter(Boolean) as string[],
  );

  const toInsert = data.polling_stations.filter((p) => !existingPsIds.has(p.ps_id));
  if (toInsert.length === 0) {
    console.log('  No new polling stations to insert.');
    return;
  }
  const result = await prisma.pollingStation.createMany({
    data: toInsert.map((p) => ({
      psId: p.ps_id,
      muniId: p.muni_id,
      controlRegionId: p.control_region_id,
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
  console.log(`  ✓ Inserted ${result.count} new polling stations`);
}

async function seedSystemConfig() {
  // Salt for IP hashing — rotated daily by IpSaltService
  await prisma.systemConfig.upsert({
    where: { key: 'daily_ip_salt' },
    create: {
      key: 'daily_ip_salt',
      value: randomBytes(32).toString('base64'),
    },
    update: {},
  });

  console.log('✓ system_config initialized (daily_ip_salt seeded)');
}

async function main() {
  console.log('--- Kontrola seed start ---');
  const file = join(__dirname, '..', 'data', 'polling-stations.json');
  const data: SeedFile = JSON.parse(readFileSync(file, 'utf8'));

  await seedControlRegions(data);
  await seedPollingStations(data);
  await seedSystemConfig();
  console.log('--- Seed completed ---');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
