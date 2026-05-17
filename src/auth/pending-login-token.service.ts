import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Stateless HMAC token for multi-step login.
 *
 * Flow:
 *   1) User submits email+password
 *   2) Backend validates credentials
 *   3) If user has 2FA, backend issues PENDING token (userId + ts + nonce)
 *      → returns HTML page for entering the 6-digit code with hidden field for pending token
 *   4) User enters TOTP code → POST with pending token + code
 *   5) Backend validates token + code → creates real session
 *
 * Format: `<base64url(userId)>.<base64url(ts)>.<base64url(nonce)>.<base64url(sig)>`
 *
 * TTL: 5 minutes. An attacker cannot use a credentials dump without TOTP — token
 * expires before brute-forcing 6 digits (1M combinations
 * × max ~5 attempts that count in 5 min = far below 1M).
 */
@Injectable()
export class PendingLoginTokenService {
  private readonly secret: Buffer;

  /** TTL for 2FA challenge — 5 min is enough for a human to open the app and type. */
  static readonly TTL_MS = 5 * 60 * 1000;

  constructor(config: ConfigService) {
    // We can reuse the same FORM_TOKEN_SECRET — different context and purpose,
    // but cryptographically fine to share HMAC key across these two uses because
    // payloads are structurally disjoint (form token has 3 segments, pending login has 4).
    const raw =
      config.get<string>('FORM_TOKEN_SECRET') ??
      config.get<string>('JWT_SECRET') ??
      '';
    if (raw.length < 24) {
      throw new Error(
        'FORM_TOKEN_SECRET (ili JWT_SECRET) je obavezan za PendingLoginTokenService.',
      );
    }
    this.secret = Buffer.from(raw + ':pending-login');
  }

  issue(userId: string): string {
    const ts = Date.now();
    const nonce = randomBytes(8).toString('base64url');
    const payload = `${Buffer.from(userId).toString('base64url')}.${ts}.${nonce}`;
    const sig = this.hmac(payload);
    return `${payload}.${sig}`;
  }

  verify(token: string | undefined | null):
    | { ok: true; userId: string }
    | {
        ok: false;
        reason: 'missing' | 'malformed' | 'bad_sig' | 'expired';
      } {
    if (!token || typeof token !== 'string') {
      return { ok: false, reason: 'missing' };
    }
    const parts = token.split('.');
    if (parts.length !== 4) return { ok: false, reason: 'malformed' };
    const [uidB64, tsStr, nonce, sig] = parts;
    const ts = Number(tsStr);
    if (!uidB64 || !Number.isFinite(ts) || ts <= 0 || !nonce || !sig) {
      return { ok: false, reason: 'malformed' };
    }
    const expected = this.hmac(`${uidB64}.${tsStr}.${nonce}`);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'bad_sig' };
    }
    if (Date.now() - ts > PendingLoginTokenService.TTL_MS) {
      return { ok: false, reason: 'expired' };
    }
    try {
      const userId = Buffer.from(uidB64, 'base64url').toString('utf8');
      if (!userId) return { ok: false, reason: 'malformed' };
      return { ok: true, userId };
    } catch {
      return { ok: false, reason: 'malformed' };
    }
  }

  private hmac(payload: string): string {
    return createHmac('sha256', this.secret)
      .update(payload)
      .digest('base64url')
      .slice(0, 22);
  }
}
