/**
 * Enum-like constants for audit log events.
 * Kept in one place for consistency and easier searching in the log.
 */
export const AuditEvent = {
  // ---- Auth ----
  LOGIN_OK: 'LOGIN_OK',
  LOGIN_FAIL: 'LOGIN_FAIL',
  LOGIN_LOCKED: 'LOGIN_LOCKED',
  LOGIN_RATE_LIMITED: 'LOGIN_RATE_LIMITED',
  LOGIN_2FA_OK: 'LOGIN_2FA_OK',
  LOGIN_2FA_FAIL: 'LOGIN_2FA_FAIL',
  LOGOUT: 'LOGOUT',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  CSRF_FAIL: 'CSRF_FAIL',

  // ---- 2FA management ----
  TOTP_ENABLED: 'TOTP_ENABLED',
  TOTP_DISABLED: 'TOTP_DISABLED',

  // ---- Self-service account management ----
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_CHANGE_FAILED: 'PASSWORD_CHANGE_FAILED',

  // ---- Admin user management ----
  ADMIN_CREATED: 'ADMIN_CREATED',
  ADMIN_PASSWORD_RESET: 'ADMIN_PASSWORD_RESET',
  ADMIN_DEACTIVATED: 'ADMIN_DEACTIVATED',
  ADMIN_REACTIVATED: 'ADMIN_REACTIVATED',
  ADMIN_SESSIONS_REVOKED: 'ADMIN_SESSIONS_REVOKED',

  // ---- Survey toggle ----
  SURVEY_OPENED: 'SURVEY_OPENED',
  SURVEY_CLOSED: 'SURVEY_CLOSED',

  // ---- Public form submissions ----
  SUBMIT_OK: 'SUBMIT_OK',
  SUBMIT_BOT: 'SUBMIT_BOT',
  SUBMIT_RATE_LIMITED: 'SUBMIT_RATE_LIMITED',
  SUBMIT_VALIDATION: 'SUBMIT_VALIDATION',
  SUBMIT_DUPLICATE: 'SUBMIT_DUPLICATE',
  SUBMIT_SURVEY_CLOSED: 'SUBMIT_SURVEY_CLOSED',
} as const;

export type AuditEventName = (typeof AuditEvent)[keyof typeof AuditEvent];

/**
 * List of all event values — for the UI dropdown in the admin audit view.
 */
export const AUDIT_EVENT_VALUES: AuditEventName[] = Object.values(AuditEvent);

/**
 * Mask for email in the audit log — "marko.markovic@kontrola.org" → "ma***@kontrola.org".
 * We do not leave plain email in audit metadata (PII minimization).
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return '';
  const at = email.indexOf('@');
  if (at < 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const prefix = local.slice(0, 2);
  return `${prefix}***@${domain}`;
}
