# Kontrola

Web aplikacija za prikupljanje prijava volontera/kontrolora sa admin panelom za pregled i izvoz podataka. Podržava više **control regiona** (univerziteta) sa strogom izolacijom — admin jednog univerziteta ne može pristupiti podacima drugog.

## Stack

NestJS (Fastify) · Prisma 6 · PostgreSQL 16 · Node 20 · Argon2id · TOTP 2FA · SSR template-i + vanilla JS

## Control regions (trenutno aktivni)

| ID | Naziv | Opštine | Biračka mesta |
|---|---|---:|---:|
| 2 | Univerzitet u Kragujevcu | 5 | 495 |
| 3 | Univerzitet u Nišu | 9 | 547 |
| 4 | Univerzitet u Novom Sadu | 44 | 1702 |

Univerziteti **NP** (1), **BG** (5) i **Ostalo** (6) su definisani u bazi ali bez admina. Aktiviraju se izborom seed filtera i pravljenjem admina (`npm run admin:create -- --email=X --cr=N`).

## Brzi start (lokalno)

```bash
# 1. Kloniraj i instaliraj
git clone https://github.com/IlijaPantic/Anketa-kontrolori.git
cd Anketa-kontrolori
npm install

# 2. Pripremi .env
cp .env.example .env
# Generiši COOKIE_SECRET i FORM_TOKEN_SECRET (komande su u .env.example)

# 3. Pokreni Postgres (Docker)
docker compose up -d postgres

# 4. Generiši seed podatke za aktivne regione (NS+KG+NIS)
npm run db:extract -- --cr=2,3,4

# 5. Migracije + seed (~2744 biračkih mesta za 3 regiona)
npx prisma migrate deploy
npx prisma generate
npm run db:seed

# 6. Kreiraj prve admine (po jedan po regionu)
npm run admin:create -- --email=admin-ns@primer.rs --cr=4
npm run admin:create -- --email=admin-kg@primer.rs --cr=2
npm run admin:create -- --email=admin-nis@primer.rs --cr=3

# 7. Pokreni aplikaciju
npm run start:dev
```

Otvori:
- **Javna forma:** http://localhost:3000/?muniid=119
- **Admin panel:** http://localhost:3000/kontrola-admin/login

## Struktura

```
src/
  registrations/    # Javna forma + rate limiting + form-token (anti-bot)
  admin/            # Admin panel (prijave, admini, 2FA, nalog)
  auth/             # Login, sesije, TOTP 2FA
  audit/            # Audit log
  polling-stations/ # Biračka mesta (muniId/psId)
  public/           # SSR template-i za javnu formu
  common/           # IpSaltService (dnevna rotacija)
prisma/             # Schema + migracije + seed
data/               # JSON sa biračkim mestima i regionima
scripts/            # create-admin, extract-bm
```

## URL parametri (javna forma)

- `?muniid=119` — primarno, numerički ID opštine iz `data/ps_regions_1.json`
- `?opstina=novi-sad` — fallback slug

Kontrolni region (univerzitet) se izvodi iz `muniId`-a automatski pri podnošenju.

## Komande

| | |
|---|---|
| `npm run start:dev` | Dev server sa hot-reload |
| `npm run build` | Build (`dist/`) |
| `npm run start:prod` | Production start (`node dist/main`) |
| `npm run db:migrate` | Primeni migracije |
| `npm run db:extract -- --cr=2,3,4` | Generiši `polling-stations.json` za regione |
| `npm run db:seed` | Seed biračka mesta + control regions |
| `npm run admin:create -- --email=X --cr=N` | Dodaj admina (N = control region id) |

## Multi-region operacije (CLI / SSH)

Nema "superadmin" naloga u UI-u. Operacije preko više regiona idu CLI-jem:

- **Novi admin za drugi region:** `npm run admin:create -- --email=X --cr=N`
- **Reset admin lozinke:** `npm run admin:create -- --email=X --update`
- **Globalni pregled / agregirani brojevi:** direktan SQL upit na bazu (`psql`)
- **Kompletno gašenje ankete (svi regioni):** `UPDATE control_regions SET survey_open = false;`

## Produkcija

Vidi [`DEPLOY.md`](./DEPLOY.md) — kompletno uputstvo za Hetzner/VPS (Postgres u Docker-u, Node preko systemd-a, Caddy reverse proxy).

## Privatnost

Lozinke: Argon2id. IP adrese: hash-ovane sa dnevno rotirajućim salt-om (ne čuva se sirov IP). Ime/prezime/telefon/email čuvaju se kao plain text (po dogovoru, šifrovanje na nivou polja je odloženo).
