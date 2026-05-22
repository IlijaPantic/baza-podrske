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
      totpEnabledAt: true,
      lastLoginAt: true,
      lockedUntil: true,
      failedLoginCount: true,
      createdAt: true,
      deletedAt: true,
    },
    orderBy: [{ controlRegionId: 'asc' }, { email: 'asc' }],
  });

  if (admins.length === 0) {
    console.log('No admin users in the database yet.');
    return;
  }

  console.log(`\nAdmin korisnici (${admins.length}):\n`);
  console.log(
    `  ${pad('Email', 32)} ${pad('CR', 3)} ${pad('Univerzitet', 36)} ${pad('Status', 9)} ${pad('2FA', 4)} ${pad('Last login', 17)} ${pad('Created', 17)}`,
  );
  console.log('  ' + '-'.repeat(124));

  for (const a of admins) {
    let status: string;
    if (a.deletedAt) {
      status = 'DELETED';
    } else if (a.lockedUntil && a.lockedUntil > now) {
      status = 'LOCKED';
    } else {
      status = 'active';
    }
    console.log(
      `  ${pad(a.email, 32)} ${pad(String(a.controlRegionId), 3)} ${pad(a.controlRegion?.name ?? '—', 36)} ${pad(status, 9)} ${pad(a.totpEnabledAt ? 'on' : 'off', 4)} ${pad(fmtDate(a.lastLoginAt), 17)} ${pad(fmtDate(a.createdAt), 17)}`,
    );
  }

  // Sažetak po CR-u
  const byCr = new Map<number, number>();
  for (const a of admins) {
    if (a.deletedAt) continue;
    if (a.lockedUntil && a.lockedUntil > now) continue;
    byCr.set(a.controlRegionId, (byCr.get(a.controlRegionId) ?? 0) + 1);
  }
  if (byCr.size > 0) {
    console.log('\nAktivni admini po CR-u:');
    for (const [cr, n] of [...byCr.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`  CR ${cr}: ${n}`);
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
