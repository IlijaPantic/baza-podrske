-- ============================================================================
-- Add support for "municipality_admin" role — a sub-admin scoped to ONE opština
-- within a control region.
--
-- ADDITIVE migration. Safe to run on a live database:
--   - Adds a new value to the UserRole enum
--   - Adds a nullable column "assigned_opstina_slug" to users
--   - Adds a partial index for fast lookup of municipality admins
--
-- ROLLBACK strategy: only the index and column would need to be dropped.
-- The enum value can stay (Postgres does not allow removing enum values
-- without recreating the type).
-- ============================================================================

-- 1) New enum value (Postgres-safe; cannot be done inside a transaction)
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'municipality_admin';

-- 2) New nullable column on users
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "assigned_opstina_slug" VARCHAR;

-- 3) Index for the common access pattern "find all municipality admins
--    in CR=N, optionally for opstina=X" (admin list page).
CREATE INDEX IF NOT EXISTS "users_control_region_id_assigned_opstina_slug_idx"
  ON "users"("control_region_id", "assigned_opstina_slug");
