-- Open the survey for ALL five university control regions.
--
-- Intent: in this survey every opština of every university center must be
-- reachable on the public form. This SUPERSEDES `scripts/set-survey.sql`,
-- which closed UB (id=5) under the previous ps_regions_2 rollout — do NOT run
-- that file any more, it would hide Beograd again.
--
-- CR 6 ("Ostalo" — Kosovo + posebne kategorije: INOSTRANSTVO, MINISTARSTVO
-- ODBRANE, UPRAVA ZA IZVRŠENJE ZAVODSKIH SANKCIJA) is intentionally left out.
-- It is not a university center, has no admin and no polling stations seeded
-- (`db:extract` is run with --cr=1,2,3,4,5), so opening it would have no
-- effect anyway.
--
-- Run:
--   npx prisma db execute --file scripts/open-all-surveys.sql --schema=prisma/schema.prisma
--
-- Idempotent. Restart the app afterwards is NOT required for this change —
-- `getActiveControlRegionIds()` reads control_regions on every call — but the
-- public GET / is CDN-cached, so allow for the cache TTL before the new
-- opštine show up in the dropdown for everyone.

UPDATE control_regions
SET survey_open = true
WHERE id IN (1, 2, 3, 4, 5)
  AND survey_open = false;
