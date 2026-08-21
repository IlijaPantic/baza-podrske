/**
 * Migrate polling stations and registrations to a new jurisdiction mapping.
 *
 * Use when `data/ps_regions_*.json` changes which control_region a municipality
 * belongs to (e.g. opštine prebačene između UNIKG/UNI/UB).
 *
 * What it does (idempotent — safe to re-run):
 *
 *   1. Loads `data/polling-stations.json` (the freshly extracted seed file).
 *   2. UPDATEs existing `polling_stations.control_region_id` where the source
 *      JSON says it should be different.
 *   3. INSERTs new polling stations (those that did not exist in DB before).
 *   4. UPDATEs `registrations.control_region_id` to follow the new mapping:
 *        a) registrations with `polling_station_id` → use that PS's CR
 *        b) registrations without `polling_station_id` → resolve by `opstina_slug`
 *   5. Reports final counts per control region.
 *
 * Run:
 *   npm run db:migrate-jurisdictions -- --dry-run      # show planned changes
 *   npm run db:migrate-jurisdictions                   # apply
 *
 * Safety:
 *   - Wrapped in a single Prisma transaction — partial failures roll back.
 *   - Never deletes polling stations or registrations.
 *   - Polling stations present in DB but absent from the source JSON are
 *     LEFT UNTOUCHED (a warning is printed so the operator can decide).
 *
 * Before production run: ALWAYS take a `pg_dump` backup first.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const prisma = new PrismaClient();

type PollingStationSeed = {
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
};

type ControlRegionSeed = { id: number; name: string; slug: string };

type SeedFile = {
  control_regions: ControlRegionSeed[];
  polling_stations: PollingStationSeed[];
};

function padR(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padL(s: string | number, n: number): string {
  const v = String(s);
  return v.length >= n ? v : ' '.repeat(n - v.length) + v;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('==============================================');
  console.log(' Migrate jurisdictions');
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no writes)' : 'COMMIT'}`);
  console.log('==============================================\n');

  // ---------- Load source -----------------------------------------
  const file = join(__dirname, '..', 'data', 'polling-stations.json');
  const raw: SeedFile = JSON.parse(readFileSync(file, 'utf8'));
  const polling = raw.polling_stations;
  console.log(`Source: ${polling.length} polling stations across ${raw.control_regions.length} control regions`);

  // ---------- Load current DB state -------------------------------
  const existingRaw = await prisma.pollingStation.findMany({
    select: {
      id: true,
      psId: true,
      controlRegionId: true,
      opstinaSlug: true,
      opstinaLat: true,
    },
  });
  console.log(
    `Database: ${existingRaw.length} polling stations currently in DB`,
  );

  // psId is nullable in the schema — guard against legacy rows without one.
  // Such rows cannot be matched against the source JSON; report and ignore.
  type Existing = (typeof existingRaw)[number] & { psId: string };
  const existing: Existing[] = [];
  let withoutPsId = 0;
  for (const p of existingRaw) {
    if (p.psId == null) {
      withoutPsId++;
    } else {
      existing.push({ ...p, psId: p.psId });
    }
  }
  if (withoutPsId > 0) {
    console.log(
      `  WARNING: ${withoutPsId} polling stations in DB have NULL ps_id — they will be ignored by this migration.`,
    );
  }

  const byPsId = new Map(existing.map((p) => [p.psId, p]));

  // ---------- Plan changes ----------------------------------------
  type Diff = { psId: string; from: number; to: number };
  /**
   * An opština whose slug or display name changed without changing control
   * region — e.g. "Palilula" split into "Palilula — Beograd" / "Palilula — Niš"
   * to break a slug collision. These need the same UPDATE as a CR move,
   * otherwise the DB keeps serving the old slug and the app's opština cache
   * stays merged.
   */
  type Rename = {
    psId: string;
    fromSlug: string;
    toSlug: string;
    fromLat: string;
    toLat: string;
  };
  const updates: Diff[] = [];
  const renames: Rename[] = [];
  const inserts: PollingStationSeed[] = [];

  for (const ps of polling) {
    const cur = byPsId.get(ps.ps_id);
    if (!cur) {
      inserts.push(ps);
      continue;
    }
    if (cur.controlRegionId !== ps.control_region_id) {
      updates.push({
        psId: ps.ps_id,
        from: cur.controlRegionId,
        to: ps.control_region_id,
      });
    }
    if (cur.opstinaSlug !== ps.opstina_slug || cur.opstinaLat !== ps.opstina_lat) {
      renames.push({
        psId: ps.ps_id,
        fromSlug: cur.opstinaSlug,
        toSlug: ps.opstina_slug,
        fromLat: cur.opstinaLat,
        toLat: ps.opstina_lat,
      });
    }
  }

  // Polling stations in DB but missing from source — warning only.
  const sourcePsIds = new Set(polling.map((p) => p.ps_id));
  const orphaned = existing.filter((p) => !sourcePsIds.has(p.psId));

  console.log('\n--- Plan ---');
  console.log(`  UPDATE control_region_id : ${updates.length}`);
  console.log(`  RENAME opstina slug/naziv: ${renames.length}`);
  console.log(`  INSERT new polling stations: ${inserts.length}`);
  console.log(`  ORPHANED in DB (left untouched): ${orphaned.length}`);

  if (updates.length > 0) {
    const byMove = new Map<string, number>();
    for (const u of updates) {
      const k = `CR ${u.from} → ${u.to}`;
      byMove.set(k, (byMove.get(k) ?? 0) + 1);
    }
    console.log('\n  Update breakdown:');
    for (const [k, n] of [...byMove.entries()].sort()) {
      console.log(`    ${padR(k, 14)} : ${padL(n, 5)} polling stations`);
    }
  }

  if (renames.length > 0) {
    const byRename = new Map<string, number>();
    for (const r of renames) {
      const k = `${r.fromLat} [${r.fromSlug}] → ${r.toLat} [${r.toSlug}]`;
      byRename.set(k, (byRename.get(k) ?? 0) + 1);
    }
    console.log('\n  Rename breakdown:');
    for (const [k, n] of [...byRename.entries()].sort()) {
      console.log(`    ${padL(n, 5)} polling stations : ${k}`);
    }
  }

  if (orphaned.length > 0) {
    console.log(
      `\n  NOTE: ${orphaned.length} polling stations exist in DB but not in source JSON.`,
    );
    console.log(
      '  These are NOT modified. If they should be deleted, do it manually after review.',
    );
  }

  if (dryRun) {
    console.log('\n[DRY RUN] Done — no changes applied.');
    return;
  }

  // ---------- Apply in single transaction -------------------------
  console.log('\n--- Applying changes ---');

  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Update polling stations whose CR and/or opština slug/naziv changed.
      //    Both cases write the same four columns, so one pass handles them;
      //    a rename-only row (CR unchanged) must not be skipped or the DB
      //    keeps the stale slug.
      let updated = 0;
      let renamed = 0;
      for (const ps of polling) {
        const cur = byPsId.get(ps.ps_id);
        if (!cur) continue;
        const crChanged = cur.controlRegionId !== ps.control_region_id;
        const nameChanged =
          cur.opstinaSlug !== ps.opstina_slug || cur.opstinaLat !== ps.opstina_lat;
        if (!crChanged && !nameChanged) continue;
        await tx.pollingStation.update({
          where: { id: cur.id },
          data: {
            controlRegionId: ps.control_region_id,
            opstinaSlug: ps.opstina_slug,
            opstinaLat: ps.opstina_lat,
            opstinaCir: ps.opstina_cir,
          },
        });
        if (crChanged) updated++;
        if (nameChanged) renamed++;
      }
      console.log(`  Updated ${updated} polling stations (CR change)`);
      console.log(`  Updated ${renamed} polling stations (opstina rename)`);

      // 2. Insert new polling stations
      let insertedCount = 0;
      if (inserts.length > 0) {
        const ins = await tx.pollingStation.createMany({
          data: inserts.map((p) => ({
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
        insertedCount = ins.count;
      }
      console.log(`  Inserted ${insertedCount} new polling stations`);

      // 3a. Migrate registrations linked to a polling station
      const regA = await tx.$executeRaw`
        UPDATE registrations r
        SET control_region_id = ps.control_region_id
        FROM polling_stations ps
        WHERE r.polling_station_id = ps.id
          AND r.control_region_id <> ps.control_region_id
      `;
      console.log(`  Updated ${regA} registrations (by polling_station_id)`);

      // 3b. Migrate registrations without polling_station_id — resolve by opstina_slug.
      // Use any polling station of that opština to read its current CR.
      const regB = await tx.$executeRaw`
        UPDATE registrations r
        SET control_region_id = sub.cr
        FROM (
          SELECT DISTINCT ON (opstina_slug)
            opstina_slug,
            control_region_id AS cr
          FROM polling_stations
          ORDER BY opstina_slug, id
        ) sub
        WHERE r.polling_station_id IS NULL
          AND r.opstina_slug = sub.opstina_slug
          AND r.control_region_id <> sub.cr
      `;
      console.log(`  Updated ${regB} registrations (by opstina_slug)`);

      return { updated, renamed, insertedCount, regA, regB };
    },
    { timeout: 120_000 }, // 2 min — large jurisdictions may take a while
  );

  // ---------- Orphaned registration slugs -------------------------
  // A registration keeps `opstina_slug` as a snapshot. If an opština was
  // renamed, older rows can point at a slug no polling station carries any
  // more — a municipality_admin scoped to the new slug would not see them.
  // Report only; fixing requires a deliberate decision per case.
  const orphanSlugs = await prisma.$queryRaw<
    { opstina_slug: string; n: bigint }[]
  >`
    SELECT r.opstina_slug, count(*) AS n
    FROM registrations r
    WHERE NOT EXISTS (
      SELECT 1 FROM polling_stations ps WHERE ps.opstina_slug = r.opstina_slug
    )
    GROUP BY r.opstina_slug
    ORDER BY 1
  `;
  if (orphanSlugs.length > 0) {
    console.log('\n--- WARNING: registrations with an unknown opstina_slug ---');
    for (const o of orphanSlugs) {
      console.log(`  ${padR(o.opstina_slug, 32)} : ${padL(Number(o.n), 6)} registrations`);
    }
    console.log(
      '  These no longer match any polling station. Check whether an opština rename left them behind.',
    );
  }

  // ---------- Final state -----------------------------------------
  console.log('\n--- Final state per control region ---');
  const finalState = await prisma.controlRegion.findMany({
    select: {
      id: true,
      name: true,
      surveyOpen: true,
      _count: { select: { pollingStations: true, registrations: true } },
    },
    orderBy: { id: 'asc' },
  });
  console.log(
    `  ${padR('CR', 3)} ${padR('Name', 40)} ${padR('Open?', 6)} ${padL('PSs', 6)} ${padL('Regs', 6)}`,
  );
  for (const cr of finalState) {
    console.log(
      `  ${padL(cr.id, 3)} ${padR(cr.name, 40)} ${padR(cr.surveyOpen ? 'YES' : 'no', 6)} ${padL(cr._count.pollingStations, 6)} ${padL(cr._count.registrations, 6)}`,
    );
  }

  console.log('\n==============================================');
  console.log(' Migration completed successfully.');
  console.log(`   Updated: ${result.updated} polling stations (CR change)`);
  console.log(`   Renamed: ${result.renamed} polling stations (opstina slug/naziv)`);
  console.log(`   Inserted: ${result.insertedCount} polling stations`);
  console.log(
    `   Registrations migrated: ${result.regA + result.regB} (${result.regA} by PS, ${result.regB} by opština)`,
  );
  console.log('==============================================');
  console.log('\nReminder:');
  console.log('  - Restart the app (`sudo systemctl restart kontrola`) to flush the in-memory cache.');
  console.log('  - Open/close surveys per CR from the admin panel as needed.');
  console.log('  - Create admins for newly activated CRs via `npm run admin:create -- --cr=N`.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('\n!! Migration FAILED:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
