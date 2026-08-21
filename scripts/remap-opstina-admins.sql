-- Remap municipality admins after the ps_regions_3 jurisdiction change.
--
-- Moves in this migration:
--   Jagodina, Varvarin, Ćićevac : UB (5)    -> UNIKG (2)
--   Gornji Milanovac            : UNIKG (2) -> UB (5)
--
-- `scripts/migrate-jurisdictions.ts` migrates polling_stations and
-- registrations but deliberately never touches `users` — an admin's scope is
-- an operational decision, not derived data. Without this step a
-- municipality_admin keeps the old control_region_id while the opština has
-- moved, so `buildWhere()` produces e.g.
-- `control_region_id = 5 AND opstina_slug = 'jagodina'` and the admin silently
-- sees zero prijave and an empty opština dropdown.
--
-- Gornji Milanovac matters most here: unlike the other three it has been LIVE
-- under UNIKG, so an admin (and prijave) may well exist for it.
--
-- Run AFTER `npm run db:migrate-jurisdictions` and BEFORE the app restart:
--   npx prisma db execute --file scripts/remap-opstina-admins.sql --schema=prisma/schema.prisma
--
-- Idempotent — the WHERE clauses make a second run a no-op.
--
-- Sessions do not need to be revoked: sessions.service.validateAndTouch()
-- re-reads control_region_id from `users` on every request, so the new scope
-- applies on the affected admin's next page load without re-login.

-- UB -> UNIKG
UPDATE users
SET control_region_id = 2
WHERE assigned_opstina_slug IN ('jagodina', 'varvarin', 'cicevac')
  AND control_region_id = 5
  AND role = 'municipality_admin';

-- UNIKG -> UB
UPDATE users
SET control_region_id = 5
WHERE assigned_opstina_slug = 'gornji-milanovac'
  AND control_region_id = 2
  AND role = 'municipality_admin';
