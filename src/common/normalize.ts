/**
 * Helper functions for normalizing input data.
 *
 * All normalizations are used ONLY for unique check / dedupe; the original
 * (as the user typed it) is always stored in a separate column.
 */

import { randomBytes } from 'node:crypto';

/**
 * Normalizes a mobile number from RS / ME / BA to E.164.
 *
 * Accepted forms:
 *   065 123 4567       → +381651234567 (Serbia — default if no country code)
 *   0651234567         → +381651234567
 *   +381651234567      → +381651234567
 *   00381651234567     → +381651234567
 *   +382 67 123 456    → +38267123456  (Montenegro)
 *   +387 61 234 567    → +38761234567  (Bosnia and Herzegovina)
 *
 * Validation rules (mobile only, fixed lines are rejected):
 *   RS (+381): leading 6 + 6–9 digits (covers 060…069 prefixes)
 *   ME (+382): leading 6 + 6–7 digits (covers 067/068/069 prefixes)
 *   BA (+387): leading 6 + 6–7 digits (covers 060…066 prefixes)
 *
 * Throws on:
 *   - empty / non-string input
 *   - unrecognized country code
 *   - format that does not match mobile rules of the resolved country
 */
export function normalizePhone(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Telefon je obavezan');
  }

  // Strip everything except digits and a leading +
  const cleaned = raw.replace(/[^\d+]/g, '');

  // Detect country code. Order matters — match longer prefixes first.
  let countryCode: '381' | '382' | '387';
  let local: string;

  if (cleaned.startsWith('+381') || cleaned.startsWith('00381')) {
    countryCode = '381';
    local = cleaned.slice(cleaned.startsWith('+') ? 4 : 5);
  } else if (cleaned.startsWith('+382') || cleaned.startsWith('00382')) {
    countryCode = '382';
    local = cleaned.slice(cleaned.startsWith('+') ? 4 : 5);
  } else if (cleaned.startsWith('+387') || cleaned.startsWith('00387')) {
    countryCode = '387';
    local = cleaned.slice(cleaned.startsWith('+') ? 4 : 5);
  } else if (cleaned.startsWith('381')) {
    countryCode = '381';
    local = cleaned.slice(3);
  } else if (cleaned.startsWith('382')) {
    countryCode = '382';
    local = cleaned.slice(3);
  } else if (cleaned.startsWith('387')) {
    countryCode = '387';
    local = cleaned.slice(3);
  } else if (cleaned.startsWith('+')) {
    // Some other country code we don't support
    throw new Error(
      'Podržani su brojevi iz Srbije, Crne Gore i BiH (+381/+382/+387)',
    );
  } else if (cleaned.startsWith('0')) {
    // No country code → default to Serbia
    countryCode = '381';
    local = cleaned.slice(1);
  } else if (/^\d+$/.test(cleaned)) {
    // Raw digits with no leading 0 and no country code → default Serbia
    countryCode = '381';
    local = cleaned;
  } else {
    throw new Error('Telefon nije u prepoznatom formatu');
  }

  // Country-specific mobile validation
  let valid = false;
  if (countryCode === '381') {
    // Serbia mobile: 06X (X = 0..9), 7–10 digits with leading 0 → 7–10 after slice
    valid = /^6\d{6,9}$/.test(local);
  } else if (countryCode === '382') {
    // Montenegro mobile: 067/068/069 + 6 digits (some operators 7) → 7–8 after slice
    valid = /^6\d{6,7}$/.test(local);
  } else if (countryCode === '387') {
    // BiH mobile: 060..066 + 6–7 digits → 7–8 after slice
    valid = /^6\d{6,7}$/.test(local);
  }

  if (!valid) {
    throw new Error(
      'Telefon mora biti mobilni broj iz Srbije, Crne Gore ili BiH (npr. 0651234567 ili +38765123456)',
    );
  }

  return `+${countryCode}${local}`;
}

/**
 * Backward-compatible alias. New code should use `normalizePhone`.
 * @deprecated Use {@link normalizePhone} instead.
 */
export const normalizePhoneRS = normalizePhone;

/**
 * Validates and normalizes email to a lowercase trimmed variant.
 * The original (case-sensitive) is stored separately.
 */
export function normalizeEmail(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Email je obavezan');
  }
  const trimmed = raw.trim().toLowerCase();
  // Pragmatic email regex (RFC is not very strict in practice)
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) {
    throw new Error('Email nije validan');
  }
  return trimmed;
}

/**
 * Generates a short unique ID for export (8 chars, A-Z+2-9 without 0/O/1/I).
 * Collision probability: 32^8 ≈ 1.1e12 — more than enough for <1M records.
 *
 * Format: "K2P3X9A8"
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars
export function generateShortId(length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    // bytes[i] (0-255) mod 32 = 0-31 → ALPHABET[index]
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/**
 * SHA256 hash bytes → hex string. Short helper.
 */
import { createHash } from 'node:crypto';
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
