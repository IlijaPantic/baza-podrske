-- Dodaje opciona TOTP polja na users.
-- totp_secret se čuva kao base32 string (otpauth standard).
-- totp_enabled_at postavlja se NAKON što korisnik potvrdi prvi 6-cifreni kod
-- iz authenticator app-a. Dok je null, 2FA nije aktivan čak i ako secret postoji
-- (korisnik je u procesu enrollment-a).

ALTER TABLE "users"
  ADD COLUMN "totp_secret"     TEXT,
  ADD COLUMN "totp_enabled_at" TIMESTAMPTZ;
