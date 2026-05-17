-- Dodaje eksterni ID biračkog mesta (`ps_id`) iz ps_regions.json.
-- String tip jer su id-evi u izvornom fajlu stringovi ("4246", "78", "579").
-- Unique constraint — jedan eksterni ID = jedan polling_station red.
-- Postgres default-no NE tretira NULL kao duplikat u UNIQUE constraint-u,
-- pa više NULL vrednosti je OK tokom prelaza (postojeći redovi se backfill-uju
-- kroz `prisma db seed`).

ALTER TABLE "polling_stations"
  ADD COLUMN "ps_id" TEXT;

CREATE UNIQUE INDEX "polling_stations_ps_id_key"
  ON "polling_stations"("ps_id");
