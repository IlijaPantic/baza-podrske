-- Faza 2 — Audit log
-- Append-only tabela za sve sigurnosno-relevantne događaje.

CREATE TABLE "audit_log" (
    "id"             BIGSERIAL NOT NULL,
    "event"          VARCHAR(64) NOT NULL,
    "user_id"        UUID,
    "target_user_id" UUID,
    "ip_hash"        TEXT NOT NULL,
    "user_agent"     TEXT NOT NULL,
    "metadata"       JSONB NOT NULL DEFAULT '{}',
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_log_created_at_idx"        ON "audit_log"("created_at" DESC);
CREATE INDEX "audit_log_event_created_at_idx"  ON "audit_log"("event", "created_at" DESC);
CREATE INDEX "audit_log_user_id_created_at_idx" ON "audit_log"("user_id", "created_at" DESC);
CREATE INDEX "audit_log_target_user_id_idx"    ON "audit_log"("target_user_id", "created_at" DESC);
