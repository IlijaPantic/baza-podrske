# Migracija na ps_regions_2 — produkcija

Sažeto uputstvo za migraciju produkcionog deploya na novu jurisdikciju (5 aktivnih univerziteta: DUNP, UNIKG, UNI, UNS + UB skriven).

> **Napomena:** ovo uputstvo opisuje već izvršenu migraciju na `ps_regions_2`. Aktuelna kanonska mapa je `ps_regions_3` — vidi [MIGRATION-3.md](MIGRATION-3.md) (Jagodina, Varvarin i Ćićevac prebačeni sa UB na UNIKG).

---

## 0) Pre nego što kreneš

- Obavesti sve admine da sledi kratak prekid
- Pristupi serveru: `ssh user@server`
- Postavi se u app folder: `cd /opt/kontrola`

---

## 1) Backup baze (OBAVEZNO)

```bash
docker exec -t kontrola_postgres pg_dump -U kontrola_admin -F c kontrola_prod \
  > "$HOME/backup-pre-jurisdikcije-$(date +%Y%m%d-%H%M).pgdump"

# Verifikuj da je veličina razumna
ls -lh "$HOME/backup-pre-jurisdikcije-"*.pgdump
```

---

## 2) Pull novi kod + dependencies

```bash
git pull
npm ci
npx prisma generate
npm run build
```

---

## 3) Re-extract polling stations iz ps_regions_2.json

```bash
npm run db:extract -- --cr=1,2,3,4,5
```

Generiše `data/polling-stations.json` sa **8112 BM** za 5 CR-ova.

---

## 4) Migracija jurisdikcija — DRY RUN prvo

```bash
npm run db:migrate-jurisdictions -- --dry-run
```

Očekivani output (ako prod kreće od starog stanja sa samo NS+KG+NIS aktivnim):
- `UPDATE`: ~28 PS-ova (Arilje: UNIKG → UB)
- `INSERT`: ~5368 novih PS-ova (DUNP + UB + dodatne KG/NI opštine; Raška ide direktno u UB)
- `ORPHANED`: 0

Ako brojevi izgledaju razumno → nastavi. Ako ne, **stop** i istraži.

---

## 5) Migracija jurisdikcija — APPLY

```bash
npm run db:migrate-jurisdictions
```

Sve u jednoj Prisma transakciji. Update-uje polling_stations + insert nove + migrira registrations po opštini.

Na kraju ispiše finalno stanje per CR.

---

## 6) Sakrij UB iz javne forme

```bash
npx prisma db execute --file scripts/set-survey.sql --schema=prisma/schema.prisma
```

Postavlja `UB.surveyOpen = false`. Beograd se neće prikazivati u dropdown-u niti će primati nove prijave.

Ostala 4 univerziteta (DUNP, UNIKG, UNI, UNS) ostaju otvoreni.

---

## 7) Restart aplikacije

```bash
sudo systemctl restart kontrola
sudo systemctl status kontrola   # treba "active (running)"
sudo journalctl -u kontrola -n 50 --no-pager   # proveri logove
```

---

## 8) Kreiraj admine za nove regione

Za regione koji do sada nisu imali admina (DUNP):

```bash
npm run admin:create -- --email=admin.np@kontrola.rs --cr=1
# Interaktivno pita za lozinku — minimum 12 karaktera
```

UB admin (ako je potreban — može i kasnije):

```bash
npm run admin:create -- --email=admin.bg@kontrola.rs --cr=5
```

---

## 9) Smoke test (15 min)

| Test | Očekivano |
| --- | --- |
| `GET /` → dropdown opština | **96 opština** vidljivo, akronimi `(DUNP)`, `(UNIKG)`, `(UNI)`, `(UNS)`. Nijedna `(UB)`. |
| `GET /?muniid=14` (Novi Sad) | Forma se učita normalno |
| `GET /?muniid=58` (Barajevo, UB) | "Anketa zatvorena" stranica |
| `GET /?muniid=138` (Raška, sada UB) | "Anketa zatvorena" stranica |
| Submit za neku DUNP opštinu | ✅ Uspešno |
| Submit za neku UB opštinu (curl direct) | ❌ 403 "Anketa je zatvorena" |
| Login admin UNIKG | Vidi **16** opština (umesto 5) |
| Login admin UNI | Vidi **32** opštine (umesto 9) |
| Login admin UNS | Vidi **44** opštine (nepromenjeno) |
| Login admin DUNP (novi) | Vidi **4** opštine (Novi Pazar, Prijepolje, Sjenica, Tutin) |
| Login admin UB (ako kreiran) | Vidi **69** opština (uključujući Rašku) |

---

## Rollback (ako nešto pođe loše)

```bash
# 1) Zaustavi app
sudo systemctl stop kontrola

# 2) Restore iz backup-a
docker exec -i kontrola_postgres pg_restore -U kontrola_admin -d kontrola_prod -c \
  < "$HOME/backup-pre-jurisdikcije-YYYYMMDD-HHMM.pgdump"

# 3) Vrati prethodnu verziju koda
git reset --hard HEAD~1
npm ci
npm run build

# 4) Pokreni app
sudo systemctl start kontrola
```

---

## Šta je urađeno (rezime)

- ✅ Polling stations remapirana po `ps_regions_2.json`:
  - **Arilje** prebačen UNIKG → UB
  - **Raška** prebačena DUNP → UB
  - Dodato ~5368 novih PS-ova za DUNP + UB + nove KG/NI opštine
- ✅ Postojeće registracije migrirane na nove CR-ove po opštini (automatski)
- ✅ Akronimi promenjeni: `DUNP`, `UNIKG`, `UNI`, `UNS`, `UB`
- ✅ UB sakriven sa javne forme (`surveyOpen=false`)
- ✅ Schema baze NIJE menjana — samo data

**Aktivnih univerziteta na frontu: 4** (DUNP, UNIKG, UNI, UNS). UB ostaje u bazi za buduće potrebe ali nije izložen javnosti.

**Finalno stanje po CR-u:**

| CR | Akronim | Opštine | BM | Status |
| --- | --- | --- | --- | --- |
| 1 | DUNP | 4 | 294 | otvoren |
| 2 | UNIKG | 16 | 997 | otvoren |
| 3 | UNI | 32 | 1.514 | otvoren |
| 4 | UNS | 44 | 1.702 | otvoren |
| 5 | UB | 69 (uklj. Rašku) | 3.605 | **zatvoren** (skriven) |
| 6 | Ostalo | 0 | 0 | nije u upotrebi |
