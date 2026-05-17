/**
 * Filters Dušan's file `rezultati_izbora_2023.json` to only the fields needed
 * for seeding the `polling_stations` table — and only for Vojvodina.
 *
 * Run:  node scripts/extract-bm-vojvodina.js
 * Output:       data/polling-stations-vojvodina.json
 */
const fs = require('node:fs');
const path = require('node:path');

const INPUT = path.join(__dirname, '..', 'rezultati_izbora_2023.json');
const REGIONS = path.join(__dirname, '..', 'data', 'ps_regions.json');
const OUTDIR = path.join(__dirname, '..', 'data');
const OUTFILE = path.join(OUTDIR, 'polling-stations-vojvodina.json');

console.log('Čitam', INPUT);
const raw = fs.readFileSync(INPUT, 'utf8');
const data = JSON.parse(raw);
console.log('Ukupno redova:', data.length);

// Filter Vojvodina
const isVojvodina = (r) => r.region && r.region.trim() === 'Регион Војводине';
const vojvodina = data.filter(isVojvodina);
console.log('Vojvodina redova:', vojvodina.length);

// Split "1 - ОШ \"...\"" into number and name
function parseBm(raw) {
  const m = String(raw).match(/^\s*(\d+)\s*-\s*(.+)$/);
  if (!m) return { broj: null, naziv: String(raw).trim() };
  return {
    broj: m[1],
    naziv: m[2].trim(),
  };
}

// Cyrillic → Latin mapping with diacritics (for display)
const CIR2LAT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'đ', е: 'e', ж: 'ž', з: 'z',
  и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', ћ: 'ć', у: 'u', ф: 'f', х: 'h', ц: 'c',
  ч: 'č', џ: 'dž', ш: 'š',
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Ђ: 'Đ', Е: 'E', Ж: 'Ž', З: 'Z',
  И: 'I', Ј: 'J', К: 'K', Л: 'L', Љ: 'Lj', М: 'M', Н: 'N', Њ: 'Nj', О: 'O',
  П: 'P', Р: 'R', С: 'S', Т: 'T', Ћ: 'Ć', У: 'U', Ф: 'F', Х: 'H', Ц: 'C',
  Ч: 'Č', Џ: 'Dž', Ш: 'Š',
};
function cirToLat(s) {
  return String(s).split('').map((c) => CIR2LAT[c] ?? c).join('');
}
// Strip diacritics for URL slug
function stripDiacritics(s) {
  const map = { š: 's', č: 'c', ć: 'c', đ: 'dj', ž: 'z',
                Š: 'S', Č: 'C', Ć: 'C', Đ: 'Dj', Ž: 'Z' };
  return String(s).split('').map((c) => map[c] ?? c).join('');
}
function slug(s) {
  return stripDiacritics(cirToLat(s))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// =====================================================================
// Load ps_regions.json and build municipalityName → muniId mapping.
// We treat Vojvodina as region id=1. Districts in Vojvodina are district.id
// values where district.region == 1. Municipalities belong to Vojvodina if their
// district is in that set.
// =====================================================================
console.log('Čitam', REGIONS);
const regionsData = JSON.parse(fs.readFileSync(REGIONS, 'utf8'));
const vojvodinaDistrictIds = new Set(
  regionsData.districts.filter((d) => d.region === 1).map((d) => d.id),
);
const muniByNameLower = new Map();
let vojvodinaMuniCount = 0;
for (const m of regionsData.municipalities) {
  if (!vojvodinaDistrictIds.has(m.district)) continue;
  // Normalize name for matching: lowercase + trim. ps_regions.json is already
  // in Latin with diacritics, same as our `opstinaLat`.
  muniByNameLower.set(m.name.toLowerCase().trim(), m.id);
  vojvodinaMuniCount++;
}
console.log(`Učitano ${vojvodinaMuniCount} Vojvodjanskih opština iz ps_regions.json`);

// Load polling_stations from ps_regions.json and build mapping
// (municipality, station_number) → ps_id (string, e.g. "4246").
// We filter only Vojvodina municipalities (by `muniByNameLower` value set).
const vojvodinaMuniIds = new Set(muniByNameLower.values());
const psIdByMuniAndNumber = new Map();
let psCountTotal = 0;
let psCountVojvodina = 0;
for (const ps of regionsData.polling_stations || []) {
  psCountTotal++;
  if (!vojvodinaMuniIds.has(ps.municipality)) continue;
  psCountVojvodina++;
  const key = `${ps.municipality}::${ps.station_number}`;
  psIdByMuniAndNumber.set(key, String(ps.id));
}
console.log(
  `Učitano ${psCountVojvodina} Vojvodjanskih BM-a iz ps_regions.json (od ukupno ${psCountTotal})`,
);

// Municipality name normalizer for mapping (strips "Grad " prefix, lowercase,
// trim). Source data in `rezultati_izbora_2023.json` uses "Grad Novi Sad"
// while `ps_regions.json` has only "Novi Sad" — so we normalize here.
function normalizeMuniName(latin) {
  return latin.replace(/^\s*Grad\s+/i, '').trim().toLowerCase();
}

// Process
const unmappedOpstine = new Set();
const unmappedPs = []; // [{muniId, bmBroj}]
const records = vojvodina.map((r) => {
  const opstinaCir = String(r.opstina || '').trim();
  const opstinaLat = cirToLat(opstinaCir);
  const muniId = muniByNameLower.get(normalizeMuniName(opstinaLat)) ?? null;
  if (muniId == null) unmappedOpstine.add(opstinaLat);
  const { broj, naziv } = parseBm(r.birackoPesto);

  // Map to ps_id (unique string ID from ps_regions.json) by
  // (muniId, station_number). station_number in ps_regions.json is an integer,
  // while our `broj` is a string — Number(broj) aligns them.
  let psId = null;
  if (muniId != null && broj != null) {
    const bmNum = Number(broj);
    if (Number.isInteger(bmNum)) {
      psId = psIdByMuniAndNumber.get(`${muniId}::${bmNum}`) ?? null;
      if (psId == null) unmappedPs.push({ muniId, bmBroj: broj });
    }
  }

  return {
    ps_id: psId,
    muni_id: muniId,
    opstina_cir: opstinaCir,
    opstina_lat: opstinaLat,
    opstina_slug: slug(opstinaCir),
    bm_broj: broj,
    bm_naziv_cir: naziv,
    bm_naziv_lat: cirToLat(naziv),
    bm_raw: r.birackoPesto,
  };
});

if (unmappedOpstine.size > 0) {
  console.warn(
    `\nUPOZORENJE: ${unmappedOpstine.size} opština nije mapirano na muniId:`,
  );
  for (const o of unmappedOpstine) console.warn(`  - "${o}"`);
}
if (unmappedPs.length > 0) {
  console.warn(
    `\nUPOZORENJE: ${unmappedPs.length} BM-ova nije mapirano na ps_id:`,
  );
  // Show first 10 so we don't flood the console
  for (const u of unmappedPs.slice(0, 10))
    console.warn(`  - muniId=${u.muniId} bmBroj=${u.bmBroj}`);
  if (unmappedPs.length > 10)
    console.warn(`  ... + još ${unmappedPs.length - 10}`);
}

// Uniqueness check on (opstina_slug, bm_broj)
const seen = new Set();
const duplicates = [];
for (const r of records) {
  const key = `${r.opstina_slug}::${r.bm_broj}`;
  if (seen.has(key)) duplicates.push(key);
  seen.add(key);
}
console.log('Duplikati (opstina + broj):', duplicates.length);

// List of municipalities with BM count
const opstine = {};
for (const r of records) {
  if (!opstine[r.opstina_slug]) {
    opstine[r.opstina_slug] = {
      muni_id: r.muni_id,
      slug: r.opstina_slug,
      naziv_cir: r.opstina_cir,
      naziv_lat: r.opstina_lat,
      bm_count: 0,
    };
  }
  opstine[r.opstina_slug].bm_count++;
}
const opstineList = Object.values(opstine).sort((a, b) => a.naziv_lat.localeCompare(b.naziv_lat));

console.log('Broj jedinstvenih opština:', opstineList.length);
console.log('\nPrimer 5 opština:');
opstineList.slice(0, 5).forEach((o) =>
  console.log(
    `  muniId=${String(o.muni_id).padStart(3)} ${o.slug.padEnd(25)} ${o.naziv_lat.padEnd(25)} (${o.bm_count} BM)`,
  ),
);
console.log('\nPrimer 3 BM zapisa:');
records.slice(0, 3).forEach((r) =>
  console.log(
    `  psId=${String(r.ps_id).padStart(5)} | ${r.opstina_slug} | ${r.bm_broj} | ${r.bm_naziv_lat.slice(0, 60)}`,
  ),
);
console.log(
  `\nUkupno mapirano ps_id: ${records.filter((r) => r.ps_id).length} / ${records.length}`,
);

// Write output
if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(
  OUTFILE,
  JSON.stringify({ opstine: opstineList, polling_stations: records }, null, 2),
  'utf8',
);
console.log(`\nSnimio ${records.length} BM zapisa u ${OUTFILE}`);
