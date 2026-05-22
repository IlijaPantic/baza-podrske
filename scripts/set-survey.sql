-- Close UB (id=5) — Beograd is hidden from the public form by design
-- (only DUNP, UNIKG, UNI, UNS are exposed). Re-run idempotently.
UPDATE control_regions SET survey_open = false WHERE id = 5;
