/**
 * Generates `data/opstine-list.txt` — a human-readable list of all
 * municipalities in `data/ps_regions_1.json`, with their muniId and the
 * control region (university) acronym in parentheses.
 *
 * Run:
 *   node scripts/list-opstine.js
 */

const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'data', 'ps_regions_1.json');
const DST = path.join(__dirname, '..', 'data', 'opstine-list.txt');

/** control_region.id -> { acronym, name } */
const CR_MAP = {
  1: { acronym: 'UNINP', name: 'Univerzitet u Novom Pazaru' },
  2: { acronym: 'UNIKG', name: 'Univerzitet u Kragujevcu' },
  3: { acronym: 'UNIS',  name: 'Univerzitet u Nišu' },
  4: { acronym: 'UNS',   name: 'Univerzitet u Novom Sadu' },
  5: { acronym: 'UB',    name: 'Univerzitet u Beogradu' },
  6: { acronym: 'OST',   name: 'Ostalo' },
};

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padLeft(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const munis = raw.municipalities || [];

const sorted = [...munis].sort((a, b) => {
  if (a.control_region !== b.control_region) {
    return a.control_region - b.control_region;
  }
  return a.name.localeCompare(b.name, 'sr');
});

const byCr = new Map();
for (const m of sorted) {
  const list = byCr.get(m.control_region) || [];
  list.push(m);
  byCr.set(m.control_region, list);
}

const lines = [];
lines.push('===========================================================');
lines.push('  SVE OPŠTINE — muniId i univerzitet (control region)');
lines.push(`  Generated: ${new Date().toISOString()}`);
lines.push(`  Source:    data/ps_regions_1.json`);
lines.push(`  Total:     ${munis.length} opština`);
lines.push('===========================================================');
lines.push('');

const NAME_W = 32;

for (const crId of [...byCr.keys()].sort((a, b) => a - b)) {
  const info = CR_MAP[crId] || { acronym: `CR${crId}`, name: `CR ${crId}` };
  const list = byCr.get(crId);
  lines.push('');
  lines.push(`── ${info.acronym} — ${info.name}  (${list.length} opština)`);
  lines.push('   ' + '─'.repeat(60));
  for (const m of list) {
    lines.push(
      `   ${padLeft(m.id, 4)}  ${pad(m.name, NAME_W)} (${info.acronym})`,
    );
  }
}

lines.push('');
lines.push('===========================================================');
lines.push('  FLAT LISTA (sortirano po muniId)');
lines.push('===========================================================');
lines.push('');

const byId = [...munis].sort((a, b) => a.id - b.id);
for (const m of byId) {
  const info = CR_MAP[m.control_region] || { acronym: `CR${m.control_region}` };
  lines.push(
    `${padLeft(m.id, 4)}  ${pad(m.name, NAME_W)} (${info.acronym})`,
  );
}

lines.push('');
fs.writeFileSync(DST, lines.join('\r\n'), 'utf8');
console.log(`OK: ${DST}`);
console.log(`Total: ${munis.length} opština in ${byCr.size} control regions.`);
for (const crId of [...byCr.keys()].sort((a, b) => a - b)) {
  const info = CR_MAP[crId] || { acronym: `CR${crId}` };
  console.log(`  ${info.acronym.padEnd(7)} : ${byCr.get(crId).length}`);
}
