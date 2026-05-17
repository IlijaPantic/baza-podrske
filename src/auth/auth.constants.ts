/**
 * Centralized constants for authentication.
 * Change here instead of scattering values across files.
 */

export const ADMIN_BASE = 'kontrola-admin';
export const ADMIN_PATH = `/${ADMIN_BASE}`;

const isProd = process.env.NODE_ENV === 'production';

/**
 * __Host- prefix requires: Secure + Path=/ + no Domain — strongest browser-side guarantee.
 * In dev (HTTP) we cannot use __Host-, so we use a plain name.
 */
export const SESSION_COOKIE = isProd ? '__Host-kontrola_session' : 'kontrola_session';
export const CSRF_COOKIE = isProd ? '__Host-kontrola_csrf' : 'kontrola_csrf';

/**
 * Cookie defaults for all admin cookies.
 * HttpOnly: JS cannot read session cookie (XSS mitigation)
 * Secure: HTTPS only — false in dev
 * SameSite=Strict: cookie is NOT sent on cross-origin requests (first line of CSRF defense)
 * Path=/ — __Host- prefix requires exactly "/"
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict' as const,
  path: '/',
};

/**
 * CSRF cookie — same security except httpOnly: false so JS can read it
 * for the double-submit pattern.
 */
export const CSRF_COOKIE_OPTIONS = {
  httpOnly: false,
  secure: isProd,
  sameSite: 'strict' as const,
  path: '/',
};

/** Idle timeout — moves forward on each request. */
export const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes

/** Absolute timeout — fixed from session creation, does not slide. */
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000; // 8 hours

/** Brute-force lockout per account. */
export const LOGIN_LOCK_THRESHOLD = 5;
export const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/** Per-IP rate limit for login attempts (in-memory in Phase 1). */
export const LOGIN_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 min
export const LOGIN_RATE_LIMIT_MAX = 10;

/** Minimum password length (NIST guidance — length, not complexity). */
export const PASSWORD_MIN_LENGTH = 12;

/** Argon2id parameters — OWASP 2024 guidance for interactive login. */
export const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
} as const;
