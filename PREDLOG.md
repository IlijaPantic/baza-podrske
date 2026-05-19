# Predlog — Više regiona

Kratak predlog kako proširiti aplikaciju na **3 regiona na ovoj platformi** (+ 1 region koji ide na zasebnu aplikaciju i nas se ne tiče).

---

## Trenutno stanje

- Aplikacija pokriva **samo Vojvodinu**
- Jedna baza, jedan deploy, jedan domen
- Admini koji se ulogu vide **sve** prijave (jer su sve "njihove")
- URL forma: `?muniid=119`

## Šta želimo

- **3 regiona** na ovoj platformi (npr. Vojvodina, Centralna Srbija, Kosovo)
- **4. region** ("Posebne kategorije" ili sl.) → potpuno druga aplikacija, ne tiče nas
- Admini regiona A **ne smeju** da vide prijave regiona B
- Redirect sajt (zaseban) šalje korisnike na pravo mesto

---

## Dva pristupa

### Pristup A — Jedna aplikacija, jedna baza, "region scope"

Sve tri regije dele istu instancu aplikacije i istu bazu. Svaka prijava i svaki admin imaju "tag" kojem regionu pripadaju. Admin koji se uloguje vidi samo svoj region.

**Za:**
- Jedan server, jedan domen, jedna cena (~5–10€/mes ukupno)
- Jedinstven repo, jedan deploy pri update-ima
- Lakše ako će kasnije biti neki "super-admin" koji gleda sve

**Protiv:**
- Composit problem ako jedan region ima eksploziju saobraćaja → svi pate
- Politička izloženost: ako se desi curenje, curi sve odjednom (3 regiona)
- Admin model postaje komplikovaniji (svaka lista, izvoz, filter mora da se "zatvori" po regionu — više mesta gde može da se desi greška)
- Backup je jedan veliki — teže izolovati po regionu

### Pristup B — Tri odvojena deploy-a istog koda (klonovi)

Isti repo, **tri zasebna servera**. Vojvodina.xyz.rs, centralna.xyz.rs, kg.xyz.rs — svaki sa svojom bazom, svojim adminima, svojim URL-om.

**Za:**
- **Potpuna izolacija** — kvar/curenje/preopterećenje jednog regiona ne dira druge
- Admin model **ostaje jednostavan** (kao sada — admin vidi sve, ali "sve" = samo njegov region jer se to fizički nalazi u njegovoj bazi)
- Različiti regioni mogu da koriste različiti brand, domen, kontakt
- Skalira se zasebno — Vojvodina može na CX22, Beograd na CX32 ako treba
- Politička/timska autonomija — svaki region ima svoj tim koji ne deli pristup sa drugima

**Protiv:**
- 3× trošak servera (umesto 5€/mes, ide ~15€/mes ukupno)
- 3× deploy posla pri update-ovima (mada Docker compose to skoro automatizuje)
- Nema jedinstvenog pregleda — ako neko hoće "ukupan broj prijava preko Srbije", treba to ručno sabrati iz 3 izvora

---

## Preporuka — Pristup B (klonovi)

Razlog:

1. **Izolacija je politički i operativno bitnija od cene.** Razlika u trošku je 10€/mes ukupno — za ozbiljnu kampanju to nije tema.
2. **Admin model ostaje jednostavan i sigurniji.** U Pristupu A, jedan propust u nekoj listi/izvozu može da "procuri" podatke između regiona. U Pristupu B, to je fizički nemoguće.
3. **Timovi regiona su verovatno različiti ljudi sa različitim poverenjem.** Lakše je dati nekome "ti si admin samo Centralne Srbije" tako što mu daš pristup samo tom serveru.
4. **Kod ostaje isti, već ima sve što treba.** Samo se 3× deploy-uje sa različitim `.env`-om i različitim podskupom polling stations.
5. **Ako neki region ima problem** (overload, curenje, hak), drugi nastavljaju da rade nesmetano.

---

## Kako bi to izgledalo u praksi

| Region | Domen (primer) | Baza | Admini |
|---|---|---|---|
| Vojvodina | `vojvodina.kontrola.rs` | Svoja | Tim Vojvodine |
| Centralna Srbija | `centralna.kontrola.rs` | Svoja | Tim Centralne |
| Kosovo | `kosovo.kontrola.rs` | Svoja | Tim Kosova |
| Posebne kategorije | `→ ide na drugu aplikaciju, ne nas` | — | — |

Redirect sajt zna mapiranje **opština → region → tačan domen**, i šalje korisnika direktno na pravu adresu (npr. korisnik bira "Novi Sad" → ide na `vojvodina.kontrola.rs/?muniid=119`).

---

## Pitanje parametara — `muniid` ili `regid` + `muniid`?

**Provereno u `ps_regions.json`: muniId-evi su globalno jedinstveni.** Alibunar=1, Bela Crkva=2, Novi Sad=119, Beograd-opštine imaju svoje brojeve, itd. — **nema duplikata između regiona**.

Zato:

- **Ne treba poseban `regid` parametar.**
- URL ostaje kao sada: `?muniid=119`
- Svaka instanca aplikacije zna **svoj** region (znan iz `.env`-a ili seed-a), pa zna koje opštine prima.
- Ako neko pokuša da pristupi `vojvodina.kontrola.rs/?muniid=900` (opština iz Beograda) → aplikacija odgovara "ova opština nije u ovom regionu" i pokazuje grešku ili redirect-uje na pravi domen.

Redirect sajt ne mora ništa od ovoga da zna — on samo gleda **kojem regionu pripada izabrana opština** i šalje na tačan domen.

---

## Šta ostaje da se odluči (pre implementacije)

1. **Da li ide Pristup B (klonovi)?** Ako da, krećemo dalje. Ako preferiraš Pristup A — moguće je, ali traje duže i menja admin model.
2. **Domeni** — jedan domen sa pod-domenima (`vojvodina.kontrola.rs`, `cs.kontrola.rs`, ...) ili tri odvojena domena?
3. **Ko upravlja svakim regionom?** — jer to određuje ko dobija prvi admin nalog za svaki server.
4. **Redirect sajt** — postoji li već ili treba i njega da pravimo? Ako postoji, treba mu samo nova mapa "opština → URL".
5. **Da li je u redu da Vojvodina ostaje na trenutnom serveru, a druga dva regiona se podižu kao novi klonovi?** (Najmanje rizično — Vojvodina ne pada, samo se dodaju novi.)

---

## Vremenska procena (gruba)

| Korak | Vreme |
|---|---|
| Skripta za izvlačenje polling stations za novi region iz `ps_regions.json` | par sati |
| Postavljanje novog Hetzner servera + Docker setup (isto kao Vojvodina) | par sati |
| Kreiranje prvih admina za novi region | 15 min |
| Konfiguracija domena i HTTPS | 30 min |
| Provera kroz `TESTIRANJE_MANUELNO.md` | 1h |
| **Ukupno po regionu** | **~pola dana posla** |

Za 2 nova regiona = **~1 ceo radni dan**.

---

## TL;DR

- **Predlog:** tri zasebna deploy-a istog koda (Pristup B)
- **Parametri:** ne menjamo — `?muniid=` je dovoljan
- **Redirect sajt** drži mapu "opština → domen" i šalje korisnika na pravu adresu
- **Trošak:** ~15€/mes ukupno za tri servera + domene
- **Implementacija:** ~pola dana po regionu

Ako se slažeš sa pristupom, sledeći korak je da napravimo skriptu za izdvajanje polling stations za novi region (već imamo `extract-bm-vojvodina.js` koja se trivijalno parametrizuje).
