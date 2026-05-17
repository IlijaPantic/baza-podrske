-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'admin',
    "last_login_at" TIMESTAMPTZ,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polling_stations" (
    "id" SERIAL NOT NULL,
    "opstina_cir" TEXT NOT NULL,
    "opstina_lat" TEXT NOT NULL,
    "opstina_slug" TEXT NOT NULL,
    "bm_broj" TEXT NOT NULL,
    "bm_naziv_lat" TEXT NOT NULL,
    "bm_naziv_cir" TEXT NOT NULL,
    "bm_raw" TEXT NOT NULL,

    CONSTRAINT "polling_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" UUID NOT NULL,
    "short_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "birth_year" INTEGER NOT NULL,
    "opstina" TEXT NOT NULL,
    "opstina_slug" TEXT NOT NULL,
    "polling_station_id" INTEGER NOT NULL,
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

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "polling_stations_opstina_slug_idx" ON "polling_stations"("opstina_slug");

-- CreateIndex
CREATE UNIQUE INDEX "polling_stations_opstina_slug_bm_broj_key" ON "polling_stations"("opstina_slug", "bm_broj");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_short_id_key" ON "registrations"("short_id");

-- CreateIndex
CREATE INDEX "registrations_opstina_slug_submitted_at_idx" ON "registrations"("opstina_slug", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "registrations_submitted_at_idx" ON "registrations"("submitted_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "registrations_phone_normalized_key" ON "registrations"("phone_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_email_normalized_key" ON "registrations"("email_normalized");

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_polling_station_id_fkey" FOREIGN KEY ("polling_station_id") REFERENCES "polling_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

