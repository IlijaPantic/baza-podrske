/**
 * Lists all admin users in the database.
 *
 * Shows: email, control region (id + name), active state, last login time,
 *        2FA enabled, created at.
 *
 * Run:
 *   npm run admin:list
 *
 * Read-only — does not modify the database.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function fmtDate(d: Date | null): string {
  if (!d) return 'never';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

async function main() {
  const now = new Date();
  const admins = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      controlRegionId: true,
      controlRegion: { select: { name: true } },
      assignedOpstinaSlug: true,
      totpEnabledAt: true,
      lastLoginAt: true,
      lockedUntil: true,
      failedLoginCount: true,
      createdAt: true,
      deletedAt: true,
    },
    orderBy: [{ controlRegionId: 'asc' }, { role: 'asc' }, { email: 'asc' }],
  });

  if (admins.length === 0) {
    console.log('No admin users in the database yet.');
    return;
  }

  console.log(`\nAdmin korisnici (${admins.length}):\n`);
  console.log(
    `  ${pad('Email', 32)} ${pad('Tip', 11)} ${pad('Opština', 20)} ${pad('CR', 3)} ${pad('Univerzitet', 30)} ${pad('Status', 9)} ${pad('2FA', 4)} ${pad('Last login', 17)}`,
  );
  console.log('  ' + '-'.repeat(140));

  for (const a of admins) {
    let status: string;
    if (a.deletedAt) {
      status = 'DELETED';
    } else if (a.lockedUntil && a.lockedUntil > now) {
      status = 'LOCKED';
    } else {
      status = 'active';
    }
    const typ = a.role === 'municipality_admin' ? 'opštinski' : 'CR admin';
    const opstina =
      a.role === 'municipality_admin' ? (a.assignedOpstinaSlug ?? '—') : '—';
    console.log(
      `  ${pad(a.email, 32)} ${pad(typ, 11)} ${pad(opstina, 20)} ${pad(String(a.controlRegionId), 3)} ${pad(a.controlRegion?.name ?? '—', 30)} ${pad(status, 9)} ${pad(a.totpEnabledAt ? 'on' : 'off', 4)} ${pad(fmtDate(a.lastLoginAt), 17)}`,
    );
  }

  // Sažetak po CR-u (zasebno za CR admine i opštinske)
  const crCounts = new Map<number, { cr: number; muni: number }>();
  for (const a of admins) {
    if (a.deletedAt) continue;
    if (a.lockedUntil && a.lockedUntil > now) continue;
    const bucket = crCounts.get(a.controlRegionId) ?? { cr: 0, muni: 0 };
    if (a.role === 'municipality_admin') bucket.muni++;
    else bucket.cr++;
    crCounts.set(a.controlRegionId, bucket);
  }
  if (crCounts.size > 0) {
    console.log('\nAktivni admini po CR-u:');
    for (const [cr, n] of [...crCounts.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`  CR ${cr}: ${n.cr} CR admina, ${n.muni} opštinskih`);
    }
  }
  console.log();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
