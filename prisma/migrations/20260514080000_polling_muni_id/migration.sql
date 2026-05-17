-- Dodaje numerički ID opštine (`muni_id`) iz ps_regions.json na polling_stations.
-- Svi BM-ovi iste opštine imaju isti muni_id.
-- Nullable jer postojeći redovi će dobiti vrednost kroz re-seed (idempotentan
-- update u prisma/seed.ts).

ALTER TABLE "polling_stations"
  ADD COLUMN "muni_id" INTEGER;

CREATE INDEX "polling_stations_muni_id_idx" ON "polling_stations"("muni_id");
