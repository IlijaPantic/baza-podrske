-- ============================================================================
-- Initial migration — multi control region model.
-- Builds the full schema from scratch:
--   control_regions, users, sessions, polling_stations, registrations,
--   system_config, audit_log
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin');

-- ============================================================================
-- control_regions
-- ============================================================================
CREATE TABLE "control_regions" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "survey_open" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "control_regions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "control_regions_slug_key" ON "control_regions"("slug");

-- ============================================================================
-- users
-- ============================================================================
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'admin',
    "control_region_id" INTEGER NOT NULL,
    "last_login_at" TIMESTAMPTZ,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "totp_secret" TEXT,
    "totp_enabled_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_control_region_id_idx" ON "users"("control_region_id");
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- ============================================================================
-- sessions
-- ============================================================================
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "csrf_token" TEXT NOT NULL,
    "ip_hash" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_absolute_expires_at_idx" ON "sessions"("absolute_expires_at");

-- ============================================================================
-- polling_stations
-- ============================================================================
CREATE TABLE "polling_stations" (
    "id" SERIAL NOT NULL,
    "ps_id" TEXT,
    "muni_id" INTEGER,
    "control_region_id" INTEGER NOT NULL,
    "opstina_cir" TEXT NOT NULL,
    "opstina_lat" TEXT NOT NULL,
    "opstina_slug" TEXT NOT NULL,
    "bm_broj" TEXT NOT NULL,
    "bm_naziv_lat" TEXT NOT NULL,
    "bm_naziv_cir" TEXT NOT NULL,
    "bm_raw" TEXT NOT NULL,

    CONSTRAINT "polling_stations_pkey" PRIMARY KEY ("id")
);

-- psId is unique nationwide; (opstina_slug, bm_broj) is NOT unique
-- (some municipalities have duplicate station numbers in source data).
CREATE UNIQUE INDEX "polling_stations_ps_id_key" ON "polling_stations"("ps_id");
CREATE INDEX "polling_stations_control_region_id_idx" ON "polling_stations"("control_region_id");
CREATE INDEX "polling_stations_opstina_slug_idx" ON "polling_stations"("opstina_slug");
CREATE INDEX "polling_stations_opstina_slug_bm_broj_idx" ON "polling_stations"("opstina_slug", "bm_broj");
CREATE INDEX "polling_stations_muni_id_idx" ON "polling_stations"("muni_id");

-- ============================================================================
-- registrations
-- ============================================================================
CREATE TABLE "registrations" (
    "id" UUID NOT NULL,
    "short_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "birth_year" INTEGER,
    "opstina" TEXT NOT NULL,
    "opstina_slug" TEXT NOT NULL,
    "polling_station_id" INTEGER,
    "control_region_id" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "phone_normalized" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_normalized" CITEXT NOT NULL,
    "consent_at" TIMESTAMPTZ NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "pii_enc" BYTEA,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "registrations_short_id_key" ON "registrations"("short_id");
CREATE UNIQUE INDEX "registrations_phone_normalized_key" ON "registrations"("phone_normalized");
CREATE UNIQUE INDEX "registrations_email_normalized_key" ON "registrations"("email_normalized");
CREATE INDEX "registrations_control_region_id_submitted_at_idx" ON "registrations"("control_region_id", "submitted_at" DESC);
CREATE INDEX "registrations_control_region_id_opstina_slug_submitted_at_idx" ON "registrations"("control_region_id", "opstina_slug", "submitted_at" DESC);
CREATE INDEX "registrations_submitted_at_idx" ON "registrations"("submitted_at" DESC);

-- ============================================================================
-- system_config
-- ============================================================================
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- ============================================================================
-- audit_log
-- ============================================================================
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "event" VARCHAR(64) NOT NULL,
    "user_id" UUID,
    "target_user_id" UUID,
    "control_region_id" INTEGER,
    "ip_hash" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at" DESC);
CREATE INDEX "audit_log_event_created_at_idx" ON "audit_log"("event", "created_at" DESC);
CREATE INDEX "audit_log_user_id_created_at_idx" ON "audit_log"("user_id", "created_at" DESC);
CREATE INDEX "audit_log_target_user_id_created_at_idx" ON "audit_log"("target_user_id", "created_at" DESC);
CREATE INDEX "audit_log_control_region_id_created_at_idx" ON "audit_log"("control_region_id", "created_at" DESC);

-- ============================================================================
-- Foreign keys
-- ============================================================================
ALTER TABLE "users"
    ADD CONSTRAINT "users_control_region_id_fkey"
    FOREIGN KEY ("control_region_id") REFERENCES "control_regions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "polling_stations"
    ADD CONSTRAINT "polling_stations_control_region_id_fkey"
    FOREIGN KEY ("control_region_id") REFERENCES "control_regions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "registrations"
    ADD CONSTRAINT "registrations_polling_station_id_fkey"
    FOREIGN KEY ("polling_station_id") REFERENCES "polling_stations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "registrations"
    ADD CONSTRAINT "registrations_control_region_id_fkey"
    FOREIGN KEY ("control_region_id") REFERENCES "control_regions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_log"
    ADD CONSTRAINT "audit_log_control_region_id_fkey"
    FOREIGN KEY ("control_region_id") REFERENCES "control_regions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
