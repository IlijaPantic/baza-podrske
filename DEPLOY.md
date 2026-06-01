# Deploy uputstvo — Kontrola

Kratko, praktično uputstvo za podizanje aplikacije na samostalan Linux server (Hetzner Cloud, DigitalOcean, ili sličan VPS).

---

## 1) Tehnologije (šta je u stack-u)

| Sloj | Tehnologija | Verzija | Uloga |
|---|---|---|---|
| Runtime | **Node.js** | 20 LTS | Pokreće aplikaciju |
| Framework | **NestJS** + **Fastify** | Nest 11 | Backend + SSR template-i |
| Baza | **PostgreSQL** | 16 | Trajno skladište |
| ORM | **Prisma** | 6 | Migracije + query layer |
| Hashing | **Argon2id** (`@node-rs/argon2`) | — | Lozinke admina |
| Container | **Docker** + **Docker Compose** | recent | Samo za Postgres (app vrti direktno na hostu) |
| Reverse proxy | **Caddy** | 2.x | HTTPS (Let's Encrypt auto) + reverse proxy |
| Process manager | **systemd** | — | Auto-restart aplikacije |

**Bitno:** aplikacija nije containerizovana. Postgres jeste (preko `docker-compose.yml`). Node app se pokreće direktno na host OS-u kroz `systemd`.

---

## 2) Šta ti treba pre nego što počneš

- VPS sa **Ubuntu 22.04 ili 24.04** (minimalno: 2 vCPU, 4 GB RAM, 40 GB disk — Hetzner CX22 je dovoljan)
- SSH pristup kao non-root korisnik sa `sudo`
- **Domen** sa A-record-om koji pokazuje na IP servera (npr. `kontrola.tvoj-domen.rs → 1.2.3.4`)
- Otvoreni portovi: **22** (SSH), **80** (HTTP, za Let's Encrypt), **443** (HTTPS)
- Od vlasnika:
  - Pristup GitHub repo-u (`https://github.com/IlijaPantic/Anketa-kontrolori.git`) — read access
  - **Vrednosti za `COOKIE_SECRET` i `FORM_TOKEN_SECRET`** *ili* dozvolu da ih sam generišeš (komande su ispod)
  - Email koji će biti prvi admin (i lozinku — preko Signal/Bitwarden Send, ne emailom)

---

## 3) Instalacija osnovnih paketa

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw

# Node.js 20 LTS preko NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # treba v20.x

# Docker + Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# odjaviti se i ponovo prijaviti da bi `docker` radio bez sudo
newgrp docker

# Caddy (reverse proxy + HTTPS)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

---

## 4) Kloniranje repo-a i podešavanje `.env`

```bash
sudo mkdir -p /opt/kontrola
sudo chown -R $USER:$USER /opt/kontrola
cd /opt
git clone https://github.com/IlijaPantic/Anketa-kontrolori.git kontrola
cd kontrola

cp .env.example .env
```

Otvori `.env` i popuni:

```bash
nano .env
```

Promeni minimalno:

```env
NODE_ENV=production
PORT=3000

# Promeni `kontrola_dev` u jaku lozinku, isto kao u docker-compose.yml ispod.
DATABASE_URL="postgresql://kontrola:JAKA_LOZINKA@localhost:5433/kontrola?schema=public"

# Generiši:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
COOKIE_SECRET=<paste hex 64 znakova>

# Generiši:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
FORM_TOKEN_SECRET=<paste base64 ~44 znaka>
```

Zatim u `docker-compose.yml` izmeni `POSTGRES_PASSWORD: kontrola_dev` da bude **isto** kao password u `DATABASE_URL`:

```bash
nano docker-compose.yml
```

---

## 5) Pokretanje Postgres-a

```bash
docker compose up -d postgres
docker compose ps   # postgres treba da bude "healthy"
```

Postgres sluša na host portu **5433** (ne 5432, da se ne sudara sa lokalnim Postgresom ako postoji).

---

## 6) Build aplikacije + migracije + seed

```bash
npm ci
npx prisma generate
npm run build

# Primeni sve migracije
npx prisma migrate deploy

# Generiši seed fajl za aktivne control regione (NS=4, KG=2, NIS=3)
npm run db:extract -- --cr=2,3,4

# Seed: control_regions tabela + biračka mesta (~2744 za 3 univerziteta)
npm run db:seed
```

Posle `db:seed` u bazi treba da bude **6 control_regiona** (svi su definisani, čak i oni bez admina) i **~2744 biračkih mesta** za NS+KG+NIS, sa `muni_id`, `ps_id` i `control_region_id` popunjeno.

---

## 7) Kreiranje prvog admina za svaki univerzitet

Svaki admin pripada tačno jednom **control regionu** (`--cr=N`):

| --cr | Univerzitet |
|---|---|
| 1 | Univerzitet u Novom Pazaru |
| 2 | Univerzitet u Kragujevcu |
| 3 | Univerzitet u Nišu |
| 4 | Univerzitet u Novom Sadu |
| 5 | Univerzitet u Beogradu |
| 6 | Ostalo |

```bash
# Po jedan admin za svaki aktivni univerzitet
npm run admin:create -- --email=admin-ns@primer.rs --cr=4 (cr = 4  za Novi Sad)
npm run admin:create -- --email=admin-kg@primer.rs --cr=2 (cr = 2 za Kragujevac)
npm run admin:create -- --email=admin-nis@primer.rs --cr=3 (cr = 3 za Nis)
# Skript pita za lozinku interaktivno (min 12 karaktera)
```

**Bitno:**
- Lozinka se ne prosleđuje preko CLI argumenata (zato što se loguje u history). Skript je čita preko skrivenog inputa.
- `--cr=N` je **obavezan** pri kreiranju novog admina. Admin vidi samo podatke svog regiona — nema cross-region pristupa.
- Za reset lozinke postojećem adminu: `npm run admin:create -- --email=X --update` (lozinku odredi novu pri pokretanju).

Sledeći admini istog regiona mogu da se dodaju iz admin panela: `/kontrola-admin/admini`. Admin Kragujevca može da kreira samo nove admine **Kragujevca** — ne i drugih regiona. Cross-region admin se dodaje samo CLI-jem.

---

## 8) systemd servis za aplikaciju

```bash
sudo tee /etc/systemd/system/kontrola.service > /dev/null <<'EOF'
[Unit]
Description=Kontrola — NestJS app
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=__USER__
WorkingDirectory=/opt/kontrola
EnvironmentFile=/opt/kontrola/.env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Zameni __USER__ tvojim username-om
sudo sed -i "s/__USER__/$USER/" /etc/systemd/system/kontrola.service

sudo systemctl daemon-reload
sudo systemctl enable --now kontrola
sudo systemctl status kontrola   # treba "active (running)"
```

Logovi:

```bash
sudo journalctl -u kontrola -f
```

Provera lokalno (na samom serveru):

```bash
curl -i http://localhost:3000/health
# treba HTTP/1.1 200
```

---

## 9) Caddy reverse proxy + auto-HTTPS

Zameni `kontrola.tvoj-domen.rs` stvarnim domenom:

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
kontrola.tvoj-domen.rs {
    encode gzip
    reverse_proxy localhost:3000

    # Security headers (best-effort; aplikacija šalje svoje preko CSP)
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
EOF

sudo systemctl restart caddy
sudo systemctl status caddy
```

Caddy automatski pribavlja Let's Encrypt sertifikat (treba ti DNS A-record da već pokazuje na server, plus otvoreni 80/443).

Provera spolja:

```bash
curl -I https://kontrola.tvoj-domen.rs/health
# HTTP/2 200
```

---

## 10) Post-deploy checklist

- [ ] `https://kontrola.tvoj-domen.rs/` — vidi se javna forma (smeš da koristiš `?muniid=119` za testiranje)
- [ ] `https://kontrola.tvoj-domen.rs/kontrola-admin/login` — admin login otvara stranicu
- [ ] Prijava sa admin email-om i lozinkom prolazi
- [ ] U admin panelu, idi na `/kontrola-admin/admini` → vidi se admin nalog
- [ ] U `/kontrola-admin/sigurnost` admin uključi 2FA (toplo preporučeno na produkciji)
- [ ] Test podnošenja jedne prijave kroz javnu formu
- [ ] Prijava se pojavi u `/kontrola-admin/`

---

## 11) Bekapi (uradi PRE produkcijskog otvaranja)

```bash
# Dnevni dump u /var/backups/kontrola/
sudo mkdir -p /var/backups/kontrola
sudo tee /etc/cron.daily/kontrola-backup > /dev/null <<'EOF'
#!/bin/bash
set -e
TS=$(date +%Y%m%d_%H%M%S)
docker exec kontrola_postgres pg_dump -U kontrola kontrola | gzip > /var/backups/kontrola/dump_$TS.sql.gz
find /var/backups/kontrola/ -type f -mtime +14 -delete
EOF
sudo chmod +x /etc/cron.daily/kontrola-backup
```

Skripta čuva 14 dana unazad. Po potrebi šalji backup off-site (rclone na S3, restic, itd.).

---

## 12) Tipični problemi

| Simptom | Uzrok | Fix |
|---|---|---|
| `kontrola.service` failed: `Cannot find module 'dist/main.js'` | Niste pokrenuli `npm run build` | `cd /opt/kontrola && npm run build && sudo systemctl restart kontrola` |
| Prisma greška `P1001: Can't reach database` | Postgres nije up, ili pogrešan port | `docker compose ps`, proveri da je port 5433 u `DATABASE_URL` |
| Caddy ne dobija sertifikat | DNS nije propagiran, ili portovi 80/443 zatvoreni | `dig kontrola.tvoj-domen.rs`, `sudo ufw status` |
| 403 ili `Forbidden` na admin formi | CSRF token mismatch (cookies blokirani) | Proveri da koristiš HTTPS (cookies su `Secure`) |
| Login ne ide, čeka | Login rate limit u memoriji posle 5 pogrešnih pokušaja | Restart `kontrola.service` ili sačekaj 15 min |

Logovi za debug:

```bash
sudo journalctl -u kontrola -n 200 --no-pager   # app
sudo journalctl -u caddy -n 100 --no-pager      # proxy
docker logs kontrola_postgres --tail=100         # baza
```

---

## 13) Update na novu verziju (kasnije)

```bash
cd /opt/kontrola
git pull
npm ci
npx prisma generate
npm run build
npx prisma migrate deploy   # samo ako su nove migracije
sudo systemctl restart kontrola
```

---

## 14) Aktivacija dodatnog univerziteta (kasnije, ako bude potrebno)

Svih 6 control regiona je već definisano u `data/ps_regions_1.json` (vidi tabelu u sekciji 7). Ako kasnije treba da uključiš još jedan (npr. Beograd `--cr=5`), prošireni set se aktivira ovako:

```bash
cd /opt/kontrola

# 1) Re-extract polling stations sa dodatim CR-om (postojeći + novi)
npm run db:extract -- --cr=2,3,4,5

# 2) Seed je idempotentan — upiše nove control_regione i biračka mesta;
#    postojeći podaci (prijave, admini) se NE diraju.
npm run db:seed

# 3) Napravi prvog admina za novi region
npm run admin:create -- --email=admin-bg@primer.rs --cr=5

# 4) Restart (da se cache opština/PS u memoriji osveži)
sudo systemctl restart kontrola
```

Posle ovoga novi admin se loguje na `/kontrola-admin/login` i vidi **samo** svoj region. Postojeći admini (NS/KG/NIS) i njihovi podaci ostaju netaknuti.

**Bitno:** ovo NE briše bazu. `prisma migrate reset` se koristi samo pri prvom deployu (sekcija 6). Kasnije izmene su sve idempotentni `seed` pozivi.

---

## 15) Opštinski admini (dvonivovska hijerarhija)

Aplikacija podržava dva tipa admina, oba scopovana striktno na svoj univerzitet (CR):

| Rola | Vidi | Akcije |
| --- | --- | --- |
| **CR admin** (`role='admin'`) | **Sve** opštine svog univerziteta | Sve: prijave, eksport, grupisano, audit log, anketa toggle, upravljanje adminima |
| **Opštinski admin** (`role='municipality_admin'`) | **Samo jednu opštinu** | Prijave + eksport (CSV/JSON) **samo za tu opštinu**, lozinka, 2FA |

Opštinski admin **ne može**: da vidi audit log, da otvori/zatvori anketu, da kreira ili menja druge admine. Pokušaj direktnog pristupa tim URL-ovima vraća 303/403 (zaštićeno guard-om u kodu).

### Kreiranje opštinskog admina iz UI

CR admin se loguje pa ide na `/kontrola-admin/admini`:

1. U formi "Dodaj novog admina" izabere **Opštinski admin**.
2. Pojavi se dropdown sa svim opštinama tog univerziteta.
3. Unese email + lozinku + opštinu i klikne "Kreiraj admina".
4. Bezbedno prosledi pristupne podatke novom adminu (Signal/Bitwarden Send).

### Kreiranje opštinskog admina iz CLI (alternativa)

```bash
cd /opt/kontrola
# Primer: opštinski admin za Novi Sad u CR=4 (UNS)
npm run admin:create -- --email=novisad@kontrola.org --cr=4 --opstina=novi-sad
```

Slug-ovi opština se mogu naći u `data/opstine-list.txt`.

### Pregled svih admina iz CLI

```bash
npm run admin:list
```

Ispis pokazuje: tip (CR/opštinski), opštinu (samo za opštinske), CR, status, 2FA, last login. Sažetak na kraju daje broj aktivnih CR admina i opštinskih admina po univerzitetu.

### Migracija na ovu funkcionalnost (live deploy)

Migracija je **additive** — postojeći admini se NE menjaju (svi postaju `role='admin'`, koja je i bila default), nova kolona `assigned_opstina_slug` je `NULL`.

```bash
cd /opt/kontrola
git pull
npm ci
npx prisma generate
npm run build
npx prisma migrate deploy     # primeni novu migraciju
sudo systemctl restart kontrola
```

**Zero-downtime sigurnost:**
- Migracija samo dodaje (`ALTER TYPE ... ADD VALUE`, `ALTER TABLE ADD COLUMN nullable`, novi index). Nema lock-ova na podatke.
- Postojeći podaci (prijave, admini, sesije) ostaju netaknuti.
- Rollback: stari kod radi pravilno i sa novom shemom (ignoriše nove kolone/vrednosti). Ako treba — `systemctl restart kontrola` na staru verziju.

### Tipični problemi sa opštinskim adminima

| Simptom | Uzrok | Fix |
| --- | --- | --- |
| Opštinski admin posle login-a vidi prazne prijave | Opština koju mu je dodeljen je u CR-u sa `surveyOpen=false` (data na javnu formu nije ulazila) | Otvori anketu, ili daj mu drugu opštinu |
| `create_invalid_opstina` greška u UI | Slug ne pripada admin-ovom CR-u (zaštita od forging-a) | Proveri `data/opstine-list.txt`, slug se mora poklapati |
| Nema pristupa `/audit`, `/anketa`, `/admini` | Opštinski admin se redirektuje na `/kontrola-admin` (to je očekivano) | Za pristup tim stranicama mora biti CR admin |

---

## 16) Bezbednosna preporuka

- **SSH:** isključi password login, ostavi samo ključ
- **2FA na admin nalogu:** uključi odmah na produkciji (`/kontrola-admin/sigurnost`)
- **Fail2ban** (opciono) za SSH brute-force zaštitu:
  ```bash
  sudo apt install -y fail2ban
  sudo systemctl enable --now fail2ban
  ```
- **`.env` nikad ne ide u git** (već je u `.gitignore`)
- Promeni default Postgres password (`kontrola_dev`) na nešto jako i drži ga van repo-a
