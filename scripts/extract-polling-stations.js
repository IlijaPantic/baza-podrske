/**
 * Extract polling stations from data/ps_regions_1.json into the seed format
 * used by prisma/seed.ts.
 *
 * Filters by --cr=ID,ID,... (comma-separated control region IDs).
 * Defaults to active control regions: 2 (KG), 3 (NIS), 4 (NS).
 *
 * Run:
 *   node scripts/extract-polling-stations.js --cr=2,3,4
 *
 * Output:
 *   data/polling-stations.json
 *
 * Output schema:
 *   {
 *     control_regions: [{ id, name, slug }],
 *     opstine:         [{ muni_id, control_region_id, slug, naziv_lat, naziv_cir, bm_count }],
 *     polling_stations:[{
 *        ps_id, muni_id, control_region_id,
 *        opstina_cir, opstina_lat, opstina_slug,
 *        bm_broj, bm_naziv_lat, bm_naziv_cir, bm_raw
 *     }]
 *   }
 */
const fs = require('node:fs');
const path = require('node:path');

const REGIONS = path.join(__dirname, '..', 'data', 'ps_regions_1.json');
const OUTDIR = path.join(__dirname, '..', 'data');
const OUTFILE = path.join(OUTDIR, 'polling-stations.json');

// ---------------------------------------------------------------------------
// Parse --cr=2,3,4 from argv
// ---------------------------------------------------------------------------
function parseControlRegions(argv) {
  const arg = argv.find((a) => a.startsWith('--cr='));
  if (!arg) return [2, 3, 4]; // default active: KG, NIS, NS
  const ids = arg
    .slice('--cr='.length)
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n));
  if (ids.length === 0) {
    throw new Error('Invalid --cr value. Use e.g. --cr=2,3,4');
  }
  return ids;
}

const activeCrIds = parseControlRegions(process.argv);
console.log('Active control regions:', activeCrIds.join(', '));

// ---------------------------------------------------------------------------
// Latin → Cyrillic (for legacy `bm_naziv_cir` / `opstina_cir` columns).
// Source data in ps_regions_1.json is already in Latin script.
// ---------------------------------------------------------------------------
const LAT2CIR = {
  a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з',
  i: 'и', j: 'ј', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о',
  p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', f: 'ф', h: 'х',
  c: 'ц',
  A: 'А', B: 'Б', V: 'В', G: 'Г', D: 'Д', E: 'Е', Z: 'З',
  I: 'И', J: 'Ј', K: 'К', L: 'Л', M: 'М', N: 'Н', O: 'О',
  P: 'П', R: 'Р', S: 'С', T: 'Т', U: 'У', F: 'Ф', H: 'Х',
  C: 'Ц',
  // Digraphs - handled with replace below
  // Diacritics
  š: 'ш', č: 'ч', ć: 'ћ', đ: 'ђ', ž: 'ж',
  Š: 'Ш', Č: 'Ч', Ć: 'Ћ', Đ: 'Ђ', Ž: 'Ж',
};
function latToCir(s) {
  if (s == null) return '';
  return String(s)
    // Digraphs first to avoid splitting "lj"/"nj"/"dž"
    .replace(/Lj/g, 'Љ').replace(/lj/g, 'љ').replace(/LJ/g, 'Љ')
    .replace(/Nj/g, 'Њ').replace(/nj/g, 'њ').replace(/NJ/g, 'Њ')
    .replace(/Dž/g, 'Џ').replace(/dž/g, 'џ').replace(/DŽ/g, 'Џ')
    .split('')
    .map((c) => LAT2CIR[c] ?? c)
    .join('');
}

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------
function stripDiacritics(s) {
  const map = { š: 's', č: 'c', ć: 'c', đ: 'dj', ž: 'z',
                Š: 'S', Č: 'C', Ć: 'C', Đ: 'Dj', Ž: 'Z' };
  return String(s).split('').map((c) => map[c] ?? c).join('');
}
function slug(s) {
  return stripDiacritics(String(s))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Load source
// ---------------------------------------------------------------------------
console.log('Reading', REGIONS);
const src = JSON.parse(fs.readFileSync(REGIONS, 'utf8'));

const crById = new Map(src.control_regions.map((c) => [c.id, c]));
const muniById = new Map(src.municipalities.map((m) => [m.id, m]));

// Filter municipalities to active CRs
const activeMuniIds = new Set();
for (const m of src.municipalities) {
  if (activeCrIds.includes(m.control_region)) activeMuniIds.add(m.id);
}
console.log(`Municipalities in active CRs: ${activeMuniIds.size}`);

// ---------------------------------------------------------------------------
// Build polling station records
// ---------------------------------------------------------------------------
const opstineMap = new Map(); // slug → opstina record
const records = [];

for (const ps of src.polling_stations) {
  if (!activeMuniIds.has(ps.municipality)) continue;

  const muni = muniById.get(ps.municipality);
  if (!muni) {
    console.warn(`Polling station ${ps.id} references unknown municipality ${ps.municipality}`);
    continue;
  }

  const opstinaLat = muni.name;
  const opstinaCir = latToCir(opstinaLat);
  const opstinaSlug = slug(opstinaLat);

  const bmBroj = String(ps.station_number);
  const bmNazivLat = String(ps.name || '').trim();
  const bmNazivCir = latToCir(bmNazivLat);
  const bmRaw = `${bmBroj} - ${bmNazivLat}`;

  records.push({
    ps_id: String(ps.id),
    muni_id: muni.id,
    control_region_id: muni.control_region,
    opstina_cir: opstinaCir,
    opstina_lat: opstinaLat,
    opstina_slug: opstinaSlug,
    bm_broj: bmBroj,
    bm_naziv_lat: bmNazivLat,
    bm_naziv_cir: bmNazivCir,
    bm_raw: bmRaw,
  });

  if (!opstineMap.has(opstinaSlug)) {
    opstineMap.set(opstinaSlug, {
      muni_id: muni.id,
      control_region_id: muni.control_region,
      slug: opstinaSlug,
      naziv_lat: opstinaLat,
      naziv_cir: opstinaCir,
      bm_count: 0,
    });
  }
  opstineMap.get(opstinaSlug).bm_count++;
}

const opstineList = [...opstineMap.values()].sort((a, b) =>
  a.naziv_lat.localeCompare(b.naziv_lat),
);

// ---------------------------------------------------------------------------
// Sanity checks
// ---------------------------------------------------------------------------
const seenKeys = new Set();
const duplicates = [];
for (const r of records) {
  const key = `${r.opstina_slug}::${r.bm_broj}`;
  if (seenKeys.has(key)) duplicates.push(key);
  seenKeys.add(key);
}
if (duplicates.length > 0) {
  console.warn(`WARNING: ${duplicates.length} duplicate (opstina_slug, bm_broj) pairs`);
}

const seenPsIds = new Set();
const duplicatePsIds = [];
for (const r of records) {
  if (seenPsIds.has(r.ps_id)) duplicatePsIds.push(r.ps_id);
  seenPsIds.add(r.ps_id);
}
if (duplicatePsIds.length > 0) {
  console.warn(`WARNING: ${duplicatePsIds.length} duplicate ps_id values`);
}

// ---------------------------------------------------------------------------
// Control regions catalog (always include ALL 6, not just active —
// seed populates table fully so future expansion just flips a flag)
// ---------------------------------------------------------------------------
const controlRegionsOut = src.control_regions.map((c) => ({
  id: c.id,
  name: c.name,
  slug: slug(c.name),
}));

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
console.log('\n=== Summary ===');
console.log(`Active control regions: ${activeCrIds.join(', ')}`);
const byCr = new Map();
for (const r of records) {
  if (!byCr.has(r.control_region_id)) byCr.set(r.control_region_id, { ps: 0, opstine: new Set() });
  byCr.get(r.control_region_id).ps++;
  byCr.get(r.control_region_id).opstine.add(r.opstina_slug);
}
for (const id of activeCrIds) {
  const stats = byCr.get(id) || { ps: 0, opstine: new Set() };
  console.log(
    `  CR ${id} ${crById.get(id)?.name.padEnd(35) || '?'}` +
    ` opstine=${String(stats.opstine.size).padStart(4)}  bm=${String(stats.ps).padStart(5)}`,
  );
}
console.log(`  TOTAL                                            opstine=${String(opstineList.length).padStart(4)}  bm=${String(records.length).padStart(5)}`);

console.log('\nFirst 3 polling stations:');
records.slice(0, 3).forEach((r) =>
  console.log(
    `  psId=${String(r.ps_id).padStart(5)} cr=${r.control_region_id} ${r.opstina_slug} | ${r.bm_broj} | ${r.bm_naziv_lat.slice(0, 50)}`,
  ),
);

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------
if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(
  OUTFILE,
  JSON.stringify(
    { control_regions: controlRegionsOut, opstine: opstineList, polling_stations: records },
    null,
    2,
  ),
  'utf8',
);
console.log(`\nWrote ${records.length} polling stations to ${OUTFILE}`);
