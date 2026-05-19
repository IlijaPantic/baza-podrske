/**
 * Bootstrap script — creates a new admin user (scoped to a control region).
 *
 * Run:
 *   npm run admin:create -- --email=admin@kontrola.org --cr=4
 *
 * Where --cr=N is the control_region ID (1..6):
 *   1 = Univerzitet u Novom Pazaru
 *   2 = Univerzitet u Kragujevcu
 *   3 = Univerzitet u Nišu
 *   4 = Univerzitet u Novom Sadu
 *   5 = Univerzitet u Beogradu
 *   6 = Ostalo
 *
 * The script:
 *  - Loads .env (DATABASE_URL)
 *  - Prompts for password interactively (hidden input via readline)
 *  - Validates: min 12 characters, max 200
 *  - Hashes with Argon2id (OWASP parameters)
 *  - Inserts into users table (or updates existing if --update is passed)
 *
 * Idempotent with --update; without --update throws if email already exists.
 */
import { PrismaClient } from '@prisma/client';
import { hash as argonHash, Algorithm } from '@node-rs/argon2';
import { createInterface, Interface } from 'node:readline';

// Constants live here so the script is self-contained and does not depend on @app/src/
const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  algorithm: Algorithm.Argon2id,
};
const PASSWORD_MIN_LENGTH = 12;

function parseArgs(argv: string[]): {
  email?: string;
  controlRegionId?: number;
  update: boolean;
} {
  const out: { email?: string; controlRegionId?: number; update: boolean } = {
    update: false,
  };
  for (const a of argv) {
    if (a.startsWith('--email=')) out.email = a.slice('--email='.length).trim();
    if (a.startsWith('--cr=')) {
      const n = parseInt(a.slice('--cr='.length).trim(), 10);
      if (Number.isInteger(n)) out.controlRegionId = n;
    }
    if (a === '--update') out.update = true;
  }
  return out;
}

function promptHidden(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean };
    process.stdout.write(question);

    let buf = '';
    const onData = (data: Buffer): void => {
      const str = data.toString('utf8');
      for (const ch of str) {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10) {
          // Enter
          process.stdout.write('\n');
          stdin.removeListener('data', onData);
          if (stdin.isRaw) stdin.setRawMode(false);
          stdin.pause();
          resolve(buf);
          return;
        }
        if (code === 3) {
          // Ctrl+C
          process.stdout.write('\n');
          process.exit(130);
        }
        if (code === 8 || code === 127) {
          // Backspace
          buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const { email, controlRegionId, update } = parseArgs(process.argv.slice(2));
  if (!email) {
    console.error('Greška: --email=<adresa> je obavezan.');
    console.error('Primer: npm run admin:create -- --email=admin@kontrola.org --cr=4');
    process.exit(2);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Greška: nevalidan email format.');
    process.exit(2);
  }

  if (controlRegionId === undefined && !update) {
    console.error('Greška: --cr=<id> je obavezan pri kreiranju novog admina.');
    console.error('  1=Novi Pazar, 2=Kragujevac, 3=Niš, 4=Novi Sad, 5=Beograd, 6=Ostalo');
    process.exit(2);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const password = await promptHidden(rl, 'Lozinka (min 12 chars, skriven unos): ');
  const passwordConfirm = await promptHidden(rl, 'Potvrdi lozinku: ');
  rl.close();

  if (password !== passwordConfirm) {
    console.error('Greška: lozinke se ne poklapaju.');
    process.exit(2);
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    console.error(`Greška: lozinka mora imati minimum ${PASSWORD_MIN_LENGTH} znakova.`);
    process.exit(2);
  }
  if (password.length > 200) {
    console.error('Greška: lozinka je preduga (max 200).');
    process.exit(2);
  }

  console.log('\nHash lozinke (Argon2id, oko 300ms)...');
  const hashed = await argonHash(password, ARGON2_OPTIONS);

  const prisma = new PrismaClient();
  try {
    // Validate control region exists (if specified)
    if (controlRegionId !== undefined) {
      const cr = await prisma.controlRegion.findUnique({
        where: { id: controlRegionId },
        select: { id: true, name: true },
      });
      if (!cr) {
        console.error(`Greška: control region ${controlRegionId} ne postoji u bazi.`);
        console.error('Najpre pokreni: npx prisma db seed');
        process.exit(2);
      }
      console.log(`Control region: ${cr.id} — ${cr.name}`);
    }

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing && !update) {
      console.error(`Greška: korisnik sa email-om ${email} već postoji.`);
      console.error('Dodaj --update da prepišeš lozinku.');
      process.exit(2);
    }

    if (existing && update) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash: hashed,
          failedLoginCount: 0,
          lockedUntil: null,
          deletedAt: null,
          // If --cr specified during update, change the user's control region too.
          ...(controlRegionId !== undefined && { controlRegionId }),
        },
      });
      // On password change — revoke all existing sessions for this user
      const revoked = await prisma.session.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      console.log(`✓ Lozinka korisnika ${email} promenjena.`);
      console.log(`✓ Odjavljeno ${revoked.count} aktivnih sesija.`);
    } else {
      const created = await prisma.user.create({
        data: {
          email,
          passwordHash: hashed,
          role: 'admin',
          controlRegionId: controlRegionId!,
        },
      });
      console.log(`✓ Admin kreiran: ${created.email} (id=${created.id}, cr=${created.controlRegionId})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Skripta neuspela:', e);
  process.exit(1);
});
