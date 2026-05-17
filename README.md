# Kontrola

Web aplikacija za prikupljanje prijava volontera/kontrolora (Vojvodina) sa admin panelom za pregled i izvoz podataka.

## Stack

NestJS (Fastify) · Prisma 6 · PostgreSQL 16 · Node 20 · Argon2id · TOTP 2FA · SSR template-i + vanilla JS

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

# 4. Migracije + seed (~1776 biračkih mesta)
npx prisma migrate deploy
npx prisma generate
npm run db:seed

# 5. Kreiraj prvog admina
npm run admin:create -- --email=admin@primer.rs

# 6. Pokreni aplikaciju
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

- `?muniid=119` — primarno, numerički ID opštine iz `data/ps_regions.json`
- `?opstina=novi-sad` — fallback slug

## Komande

| | |
|---|---|
| `npm run start:dev` | Dev server sa hot-reload |
| `npm run build` | Build (`dist/`) |
| `npm run start:prod` | Production start (`node dist/main`) |
| `npm run db:migrate` | Primeni migracije |
| `npm run db:seed` | Seed biračka mesta |
| `npm run admin:create -- --email=X` | Dodaj admina |

## Produkcija

Vidi [`DEPLOY.md`](./DEPLOY.md) — kompletno uputstvo za Hetzner/VPS (Postgres u Docker-u, Node preko systemd-a, Caddy reverse proxy).

## Privatnost

Lozinke: Argon2id. IP adrese: hash-ovane sa dnevno rotirajućim salt-om (ne čuva se sirov IP). Ime/prezime/telefon/email čuvaju se kao plain text (po dogovoru, šifrovanje na nivou polja je odloženo).
