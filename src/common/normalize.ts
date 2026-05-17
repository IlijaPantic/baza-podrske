/**
 * Helper functions for normalizing input data.
 *
 * All normalizations are used ONLY for unique check / dedupe; the original
 * (as the user typed it) is always stored in a separate column.
 */

import { randomBytes } from 'node:crypto';

/**
 * Normalizes a Serbian mobile number to E.164 (+381XXXXXXXX).
 *
 * Accepted forms:
 *   065 123 4567     → +381651234567
 *   0651234567       → +381651234567
 *   +381651234567    → +381651234567
 *   381651234567     → +381651234567
 *   +381 (65) 1234567 → +381651234567
 *
 * Throws if parsing fails or the number is not in Serbian mobile
 * format (06X + 6-9 digits).
 */
export function normalizePhoneRS(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Telefon je obavezan');
  }

  // Strip everything except digits and a leading +
  const cleaned = raw.replace(/[^\d+]/g, '');

  let digits: string;
  if (cleaned.startsWith('+381')) {
    digits = cleaned.slice(4);
  } else if (cleaned.startsWith('00381')) {
    digits = cleaned.slice(5);
  } else if (cleaned.startsWith('381')) {
    digits = cleaned.slice(3);
  } else if (cleaned.startsWith('0')) {
    digits = cleaned.slice(1);
  } else if (/^\d+$/.test(cleaned)) {
    digits = cleaned;
  } else {
    throw new Error('Telefon nije u prepoznatom formatu');
  }

  // Serbian mobile: 6 prefix (60..69) + 6-9 digits → 7-10 digits total after leading 0
  if (!/^6\d{6,9}$/.test(digits)) {
    throw new Error('Telefon mora biti srpski mobilni (npr. 065 123 4567)');
  }

  return `+381${digits}`;
}

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
