-- Faza 1.1 — birth_year i polling_station_id postaju opcioni
-- (godište i BM nisu obavezna polja u formi)

ALTER TABLE "registrations"
  ALTER COLUMN "birth_year" DROP NOT NULL,
  ALTER COLUMN "polling_station_id" DROP NOT NULL;
