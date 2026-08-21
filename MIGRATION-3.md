# Migracija na ps_regions_3 — prekrajanje jurisdikcija + otvaranje svih centara

Tri zahvata u istom prozoru:

1. **Jurisdikcija** — Jagodina, Varvarin i Ćićevac prelaze sa Univerziteta u Beogradu (CR 5) na Univerzitet u Kragujevcu (CR 2), a Gornji Milanovac ide u suprotnom smeru: sa UNIKG na UB.
2. **Otvaranje ankete** — svih pet univerzitetskih centara postaje otvoreno, tako da su sve opštine dostupne na javnoj formi. UB je do sada bio skriven (`survey_open = false`); to se ukida.
3. **Razdvajanje dve Palilule** — Beograd i Niš imaju istoimenu opštinu koja se do sada u aplikaciji stapala u jednu stavku. Dobijaju razlikovne nazive i različite slug-ove.

Nastavak na [MIGRATION.md](MIGRATION.md) (migracija na `ps_regions_2`). Šema baze se **ne menja** — samo podaci.

---

## Šta se menja

| Opština | muniId | Okrug | BM | Pre | Posle |
| --- | --- | --- | --- | --- | --- |
| Jagodina | 118 | 18 — Pomoravski | 91 | UB | **UNIKG** |
| Varvarin | 134 | 20 — Rasinski | 40 | UB | **UNIKG** |
| Ćićevac | 135 | 20 — Rasinski | 18 | UB | **UNIKG** |
| Gornji Milanovac | 95 | 14 — Moravički | 66 | UNIKG | **UB** |

**149 BM** ide ka UNIKG, **66 BM** ka UB — ukupno **215 dirnutih biračkih mesta**. Prve tri zaokružuju Rasinski okrug pod UNIKG (Kruševac, Trstenik, Aleksandrovac i Vrnjačka Banja su prešli još u `ps_regions_2`), a Pomoravski se spaja sa već postojećim Rekovcem.

⚠️ **Gornji Milanovac se razlikuje od ostale tri.** One su dolazile iz zatvorenog UB-a, pa nemaju istoriju. Gornji Milanovac je sve vreme bio **otvoren pod UNIKG** — može imati postojeće prijave i opštinskog admina. Njegove prijave prelaze pod UB, što znači da ih UNIKG admin **više neće videti** u svom pregledu ni u exportu. Prebroj ih u koraku 0 i uporedi posle migracije.

**Rezultat po CR-u:**

| CR | Akronim | Opštine | BM | Status ankete |
| --- | --- | --- | --- | --- |
| 1 | DUNP | 4 | 294 | otvoren |
| 2 | UNIKG | 16 → **18** | 997 → **1.080** | otvoren |
| 3 | UNI | 32 | 1.514 | otvoren |
| 4 | UNS | 44 | 1.702 | otvoren |
| 5 | UB | 69 → **67** | 3.605 → **3.522** | zatvoren → **otvoren** |

Ukupan broj BM u bazi ostaje **8.112** — nijedno se ne dodaje ni briše, samo im se menja `control_region_id`.

Posle otvaranja UB-a javna forma nudi **svih 165 opština** iz 5 univerzitetskih centara (do sada 96).

CR 6 („Ostalo" — Kosovo i posebne kategorije: INOSTRANSTVO, MINISTARSTVO ODBRANE, UPRAVA ZA IZVRŠENJE ZAVODSKIH SANKCIJA) ostaje van ankete. Nije univerzitetski centar, nema admina, i njegova BM nisu ni seedovana u bazu (`db:extract` se pušta sa `--cr=1,2,3,4,5`).

---

## Razdvajanje Palilule (Beograd / Niš)

Dve opštine nose isto ime — **Palilula** u Beogradu (muni 64, UB, 104 BM) i **Palilula** u Nišu (muni 106, UNI, 48 BM). Obe su davale isti slug `palilula`.

`PollingStationsService` gradi svoj keš opština **grupisan po `opstina_slug`**, pa su se dve opštine stapale u jednu stavku: 152 biračka mesta oba grada u jednoj listi, pod onim univerzitetom čiji je red baza slučajno vratila prvi (`ORDER BY opstina_lat, bm_broj` je za njih neodlučen). Posledično su i `?muniid=64` i `?muniid=106` vodili na istu stavku, a `getOpstinaMeta('palilula')` je svaku prijavu za Palilulu svrstavao pod jedan univerzitet — bez obzira iz kog je grada prijavljeni.

Dok je UB bio zatvoren problem je bio delimično maskiran, ali ga otvaranje UB-a čini vidljivim u punom obimu.

**Rešenje:**

| muniId | Naziv (novi) | Slug | CR | BM |
| --- | --- | --- | --- | --- |
| 106 | Palilula — Niš | `palilula` *(nepromenjen)* | UNI (3) | 48 |
| 64 | Palilula — Beograd | `palilula-beograd` *(novi)* | UB (5) | 104 |

Niški slug se **namerno ne menja** — to je jedina od dve koja ima žive podatke (UB je bio zatvoren), pa bi preimenovanje osirotelo postojeće `registrations.opstina_slug` i eventualnog opštinskog admina. Beogradska je nova na javnoj formi, nema šta da se migrira. Pin je zapisan u `SLUG_OVERRIDES` u `scripts/extract-polling-stations.js`, sa objašnjenjem zašto postoji.

U dropdown-u će se videti `Palilula — Niš (UNI, 48 BM)` i `Palilula — Beograd (UB, 104 BM)`.

`extract-polling-stations.js` je dobio i **tvrdu proveru**: ako dve različite opštine ikad ponovo daju isti slug, skript se prekida sa `FATAL` umesto da tiho izgeneriše spojene podatke. Provereno — puca kako treba.

---

## ⚠️ Tri stvari koje treba znati unapred

### 1. Otvaranje UB-a izlaže 67 opština, ne 4

Ovo je daleko veći zahvat od same promene jurisdikcije. `survey_open` je per-univerzitet, **ne per-opština** — ne postoji način da se otvori samo deo UB-a. Čim se UB otvori:

- javni dropdown ide sa **96 na 165 opština**
- Beograd i cela Šumadija/Podunavlje/Kolubara pod UB-om (sada i Gornji Milanovac) počinju da primaju prijave
- `?muniid=58` (Barajevo) i ostali UB linkovi prestaju da vraćaju „Anketa zatvorena"

Promena jurisdikcije za 4 opštine je uz ovo sporedna — one bi ionako bile otvorene, samo pod drugim univerzitetom.

### 2. UB mora da ima CR admina PRE otvaranja

Ako je UB otvoren a nema nijednog aktivnog `admin` naloga na `control_region_id = 5`, prijave za 67 opština stižu u bazu a **niko ne može da ih vidi ni izveze** — nema super-admina u UI-ju, scope je tvrdo vezan za CR. Provera i kreiranje su u koraku 0 odnosno 7.

### 3. Opštinske admine treba prebaciti ručno

`migrate-jurisdictions.ts` namerno ne dira `users` tabelu. Ako postoji `municipality_admin` vezan za neku od ove četiri opštine, on ostaje na starom `control_region_id` i posle migracije **tiho vidi nula prijava** (scope filter postaje npr. `CR 5 AND opstina_slug = 'jagodina'`, što se više nikad ne poklapa). Najverovatniji slučaj je Gornji Milanovac, jer je jedini bio otvoren. Korak 6 to rešava, u oba smera.

---

## 0) Pre nego što kreneš

```bash
ssh user@server
cd /opt/kontrola
```

Obavesti admine UNIKG i UB da sledi kratak prekid (~10 s, samo restart).

**Snimi zatečeno stanje** — ovo određuje koje korake uopšte moraš da radiš:

```bash
# a) Ima li opštinskih admina za ove četiri opštine?  -> da li ti treba korak 6
npm run admin:list | grep -iE 'jagodina|varvarin|cicevac|Ćićevac|milanovac'

# b) Ima li UB (CR 5) aktivnog CR admina?  -> da li ti treba korak 7
npm run admin:list | grep 'Univerzitet u Beogradu'

# c) Trenutni status ankete po centru  -> očekivano: samo CR 5 ima false
docker exec -i kontrola_postgres psql -U kontrola_admin -d kontrola_prod \
  -c "SELECT id, name, survey_open FROM control_regions ORDER BY id;"

# d) Ima li već prijava za te opštine?
#    Jagodina/Varvarin/Ćićevac: očekivano 0 (UB je bio zatvoren).
#    Gornji Milanovac:          očekivano > 0 (bio je otvoren pod UNIKG) — ZAPIŠI BROJ.
docker exec -i kontrola_postgres psql -U kontrola_admin -d kontrola_prod \
  -c "SELECT opstina_slug, control_region_id, count(*) FROM registrations
      WHERE opstina_slug IN ('jagodina','varvarin','cicevac','gornji-milanovac')
      GROUP BY 1,2 ORDER BY 1;"
```

Zapiši sve izlaze — trebaće za verifikaciju na kraju.

---

## 1) Backup baze (OBAVEZNO)

```bash
docker exec -t kontrola_postgres pg_dump -U kontrola_admin -F c kontrola_prod \
  > "$HOME/backup-pre-kg3-$(date +%Y%m%d-%H%M).pgdump"

ls -lh "$HOME/backup-pre-kg3-"*.pgdump
```

---

## 2) Pull novi kod

```bash
git pull
npm ci
npx prisma generate
npm run build
```

Nema novih Prisma migracija — `npx prisma migrate deploy` nije potreban.

---

## 3) Re-extract polling stations iz ps_regions_3.json

```bash
npm run db:extract -- --cr=1,2,3,4,5
```

Očekivani izlaz:

```
Municipalities in active CRs: 165
  CR 1 Univerzitet u Novom Pazaru          opstine=   4  bm=  294
  CR 2 Univerzitet u Kragujevcu            opstine=  18  bm= 1080
  CR 3 Univerzitet u Nišu                  opstine=  32  bm= 1514
  CR 4 Univerzitet u Novom Sadu            opstine=  44  bm= 1702
  CR 5 Univerzitet u Beogradu              opstine=  67  bm= 3522
  TOTAL                                            opstine= 165  bm= 8112
```

`WARNING: 37 duplicate (opstina_slug, bm_broj) pairs` je očekivan i bezopasan — u izvornim podacima neke opštine imaju duplirane brojeve BM, zato `(opstina_slug, bm_broj)` i nije unique u šemi. (Bilo ih je 85; razdvajanjem Palilule nestalo je 48 lažnih duplikata koji su nastajali sudarom dva grada u istom slug-u.)

Ako skript završi sa `FATAL: opstina_slug collision` — **stop**. To znači da je neka izmena izvornih podataka uvela novi sudar imena; treba ga razrešiti kao Palilulu, ne zaobići.

> `data/polling-stations.json` je već izgenerisan i komitovan, pa je ovaj korak zapravo provera da server proizvodi isti fajl. Ako `git status` posle njega prijavi izmenu tog fajla — **stop**, nešto se ne poklapa.

---

## 4) Migracija jurisdikcija — DRY RUN prvo

```bash
npm run db:migrate-jurisdictions -- --dry-run
```

**Očekivano — brojevi moraju biti tačno ovi:**

```
  UPDATE control_region_id : 215
  RENAME opstina slug/naziv: 152
  INSERT new polling stations: 0
  ORPHANED in DB (left untouched): 0

  Update breakdown:
    CR 2 → 5       :    66 polling stations
    CR 5 → 2       :   149 polling stations

  Rename breakdown:
      104 polling stations : Palilula [palilula] → Palilula — Beograd [palilula-beograd]
       48 polling stations : Palilula [palilula] → Palilula — Niš [palilula]
```

215 i 152 se **ne preklapaju** — to su dva različita skupa redova, ukupno 367 dirnutih biračkih mesta.

Ako je `INSERT` različit od 0, ako se pojavi neki treći `CR x → y`, ili ako `RENAME` obuhvati neku opštinu osim Palilule — **stop i istraži**. To znači da prod baza nije na `ps_regions_2` stanju kako se očekuje.

---

## 5) Migracija jurisdikcija — APPLY

```bash
npm run db:migrate-jurisdictions
```

Sve u jednoj Prisma transakciji (timeout 120 s): update-uje `polling_stations` (i promene CR-a i preimenovanja opština), pa `registrations` po `polling_station_id` i po `opstina_slug`. Ne briše ništa.

Ako na kraju ispiše `WARNING: registrations with an unknown opstina_slug`, to znači da neke prijave pokazuju na slug koji više ne nosi nijedno biračko mesto. Očekivano je da ovog upozorenja **nema** — niški `palilula` je namerno zadržan baš da se to ne desi. Ako se ipak pojavi, ne nastavljaj sa otvaranjem ankete dok ne utvrdiš koje su to prijave.

Na kraju ispisuje finalno stanje po CR-u — proveri da je UNIKG 1.080 BM, UB 3.522 BM.

Proveri i broj prijava: UB dobija onoliko koliko je Gornji Milanovac imao (broj iz koraka 0d), UNIKG za toliko gubi.

---

## 6) Prebaci opštinske admine na nove centre

Preskoči samo ako je provera (a) iz koraka 0 pokazala da nema takvih admina.

```bash
npx prisma db execute --file scripts/remap-opstina-admins.sql --schema=prisma/schema.prisma
```

Skript je idempotentan i radi u oba smera: Jagodina/Varvarin/Ćićevac sa CR 5 na CR 2, Gornji Milanovac sa CR 2 na CR 5.

Verifikacija:

```bash
npm run admin:list | grep -iE 'jagodina|varvarin|cicevac|Ćićevac|milanovac'
# jagodina/varvarin/cicevac -> CR 2, "Univerzitet u Kragujevcu"
# gornji-milanovac          -> CR 5, "Univerzitet u Beogradu"
```

Sesije se **ne moraju** poništavati — `validateAndTouch()` čita `control_region_id` iz `users` na svakom requestu, pa novi scope važi od sledećeg klika, bez re-logina.

---

## 7) Osiguraj da UB ima CR admina

**Uraditi PRE koraka 8** — ne otvarati anketu za 67 opština bez ikoga ko može da vidi prijave koje stižu.

Ako provera (b) iz koraka 0 nije vratila nijedan aktivan nalog za CR 5:

```bash
npm run admin:create -- --email=admin.bg@kontrola.rs --cr=5
# Interaktivno pita za lozinku — minimum 12 karaktera
```

Nalog mora biti role `admin` (dakle **bez** `--opstina`), da bi video ceo UB i imao pristup `/anketa` toggle-u.

---

## 8) Otvori anketu za sve univerzitetske centre

```bash
npx prisma db execute --file scripts/open-all-surveys.sql --schema=prisma/schema.prisma
```

Postavlja `survey_open = true` za CR 1–5. U praksi menja samo UB — ostala četiri su već otvorena. Idempotentno.

> ⛔ **Ne pokretati `scripts/set-survey.sql`** — to je stari skript koji zatvara UB. Ispražnjen je i označen kao zastareo, ali ga MIGRATION.md (korak 6) i dalje pominje.

Verifikacija:

```bash
docker exec -i kontrola_postgres psql -U kontrola_admin -d kontrola_prod \
  -c "SELECT id, name, survey_open FROM control_regions ORDER BY id;"
# CR 1-5 -> t   (CR 6 je svejedno — nema nijedno BM u bazi)
```

Alternativa bez SQL-a: UB CR admin se uloguje i otvori anketu sam preko `/<admin>/anketa`. Efekat je isti, uz `SURVEY_OPENED` zapis u audit logu.

---

## 9) Restart aplikacije (OBAVEZNO)

```bash
sudo systemctl restart kontrola
sudo systemctl status kontrola
sudo journalctl -u kontrola -n 50 --no-pager
```

`PollingStationsService` drži listu opština u in-memory kešu za ceo životni vek procesa i ne invalidira je sam. **Bez restarta aplikacija i dalje servira staru mapu**, bez obzira što je baza ispravna.

---

## 10) Smoke test (15 min)

| Test | Očekivano |
| --- | --- |
| `GET /` → dropdown opština | **165 opština** (bilo 96). Vide se svi akronimi: `(DUNP)`, `(UNIKG)`, `(UNI)`, `(UNS)`, `(UB)` |
| Jagodina / Varvarin / Ćićevac u dropdown-u | Akronim `(UNIKG)`, ne `(UB)` |
| Gornji Milanovac u dropdown-u | Akronim `(UB)`, ne `(UNIKG)` |
| `GET /?muniid=118` (Jagodina) | Forma se učita (ranije „Anketa zatvorena") |
| `GET /?muniid=134` / `?muniid=135` | Isto — forma se učita |
| `GET /?muniid=58` (Barajevo, UB) | Forma se učita (ranije „Anketa zatvorena") |
| `GET /?muniid=170` (Priština, CR 6) | 404 / opština ne postoji — CR 6 nije seedovan |
| Palilula u dropdown-u | **Dve stavke**: `Palilula — Niš (UNI, 48 BM)` i `Palilula — Beograd (UB, 104 BM)` |
| `GET /?muniid=64` → izbor BM | Samo beogradska BM (Peta beogradska gimnazija itd.), 104 komada |
| `GET /?muniid=106` → izbor BM | Samo niška BM, 48 komada |
| Test submit za Jagodinu | ✅ Uspešno, prijava dobija `control_region_id = 2` |
| Test submit za neku UB opštinu | ✅ Uspešno, `control_region_id = 5` |
| Login CR admin UNIKG | Vidi **18** opština; Jagodina/Varvarin/Ćićevac u filteru, Gornji Milanovac **nije** |
| Login CR admin UB | Vidi **67** opština; te tri više nisu u listi, Gornji Milanovac jeste; `/anketa` prikazuje „otvorena" |
| Prijave za Gornji Milanovac | Vidljive UB adminu, u broju zabeleženom u koraku 0d; UNIKG admin ih više ne vidi |
| Login opštinski admin za Jagodinu (ako postoji) | Vidi svoju opštinu i njene prijave |
| Export CSV kod UNIKG admina | Redovi za nove opštine imaju `control_region_id = 2` |

SQL kontrola:

```bash
docker exec -i kontrola_postgres psql -U kontrola_admin -d kontrola_prod \
  -c "SELECT opstina_slug, control_region_id, count(*) AS bm FROM polling_stations
      WHERE opstina_slug IN ('jagodina','varvarin','cicevac','gornji-milanovac')
      GROUP BY 1,2 ORDER BY 1;"
# očekivano: cicevac/2/18, gornji-milanovac/5/66, jagodina/2/91, varvarin/2/40

docker exec -i kontrola_postgres psql -U kontrola_admin -d kontrola_prod \
  -c "SELECT id, name, survey_open FROM control_regions ORDER BY id;"
# očekivano: CR 1-5 -> t

docker exec -i kontrola_postgres psql -U kontrola_admin -d kontrola_prod \
  -c "SELECT opstina_slug, opstina_lat, control_region_id, count(*) FROM polling_stations
      WHERE opstina_slug LIKE 'palilula%' GROUP BY 1,2,3 ORDER BY 1;"
# očekivano: palilula / Palilula — Niš / 3 / 48   i   palilula-beograd / Palilula — Beograd / 5 / 104
```

---

## Rollback

```bash
# 1) Zaustavi app
sudo systemctl stop kontrola

# 2) Restore iz backup-a
docker exec -i kontrola_postgres pg_restore -U kontrola_admin -d kontrola_prod -c \
  < "$HOME/backup-pre-kg3-YYYYMMDD-HHMM.pgdump"

# 3) Vrati prethodnu verziju koda
git reset --hard HEAD~1
npm ci && npm run build

# 4) Pokreni app
sudo systemctl start kontrola
```

**Alternativa bez restore-a** (ako je migracija prošla ali odluka se promenila): vrati kod na prethodni commit, pusti `npm run db:extract -- --cr=1,2,3,4,5` sa `ps_regions_2.json` i ponovo `npm run db:migrate-jurisdictions`. Skript je simetričan — vratiće svih 215 BM na stare CR-ove, a prijave prikupljene u međuvremenu idu sa svojom opštinom. Admine vrati ručno — `remap-opstina-admins.sql` sa zamenjenim vrednostima.

**Ako treba samo zatvoriti UB nazad** (a jurisdikciju ostaviti): `UPDATE control_regions SET survey_open = false WHERE id = 5;` ili UB admin klikne „zatvori" na `/anketa`. Restart nije potreban — `survey_open` se čita iz baze na svaki poziv. Prijave koje su u međuvremenu stigle ostaju u bazi i vidljive su UB adminu.

---

## Rezime izmena u repou

- ✅ `data/ps_regions_3.json` — nova kanonska mapa (kopija `_2`; 3 opštine na CR 2, Gornji Milanovac na CR 5, 2 Palilule preimenovane)
- ✅ `data/polling-stations.json` — regenerisan; 8.112 BM, 215 sa promenjenim CR, 152 preimenovana, 0 dodatih/obrisanih
- ✅ `data/opstine-list.txt` — regenerisan
- ✅ `scripts/extract-polling-stations.js` — default `--src` = `ps_regions_3.json`, `SLUG_OVERRIDES` za nišku Palilulu, FATAL provera sudara slug-ova
- ✅ `scripts/list-opstine.js` — default `--src` = `ps_regions_3.json`
- ✅ `scripts/migrate-jurisdictions.ts` — hvata i preimenovanja opština (ranije je slug ažurirao samo uz promenu CR-a) + upozorenje za prijave sa nepoznatim slug-om
- ✅ `scripts/remap-opstina-admins.sql` — remapiranje opštinskih admina, u oba smera
- ✅ `scripts/open-all-surveys.sql` — otvara anketu za CR 1–5
- ✅ `scripts/set-survey.sql` — ispražnjen i označen kao zastareo (zatvarao je UB)
- ⛔ Prisma šema — **nije menjana**
- ⛔ `data/ps_regions_2.json` — ostavljen netaknut radi dijagnostike i diff-a
