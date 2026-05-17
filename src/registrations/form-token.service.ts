import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Stateless HMAC form-token service for time-to-fill heuristic.
 *
 * GOAL: a bot that does `GET /api/form-token → POST /api/submit` in under
 * 3s is very likely script-driven. A human needs at least 5–10s
 * to read the form and type first name, last name, phone, email.
 *
 * Token format: `<base64url(ts)>.<base64url(nonce)>.<base64url(hmac_first_16_bytes)>`
 *
 * Validation on submit:
 *  - HMAC must be valid (prevents spoofing old tokens)
 *  - Age must be `>= 3s` (bot is too fast)
 *  - Age must be `<= 4h` (form left open in browser too long, very likely bot)
 *
 * Stateless = we do NOT remember issued tokens. That means the same token CAN
 * be used multiple times — but with rate limit "per (IP+UA) 3/15min" + 4h
 * TTL, a bot hitting 100 times with one token is stopped on the
 * 4th attempt.
 *
 * Alternative: stateful (Redis with SETNX and TTL) — Phase 3, when
 * multi-instance + stronger anti-bot is needed.
 */
@Injectable()
export class FormTokenService {
  private readonly logger = new Logger(FormTokenService.name);
  private readonly secret: Buffer;

  /** Minimum time between issuance and submit — bot is faster than this. */
  static readonly MIN_AGE_MS = 3_000;
  /** Maximum time — form older than this is likely a bot or abandoned. */
  static readonly MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4h

  constructor(config: ConfigService) {
    const raw = config.get<string>('FORM_TOKEN_SECRET') ?? '';
    if (raw.length < 24) {
      throw new Error(
        'FORM_TOKEN_SECRET je obavezan i mora imati barem 24 karaktera. ' +
          'Generiši: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      );
    }
    this.secret = Buffer.from(raw);
  }

  /**
   * Issue new token. Returns string + ttlSec so client knows when to refresh
   * (e.g. if page stays open 4h+, JS can fetch a new one before
   * submit).
   */
  issue(): { token: string; ttlSec: number } {
    const ts = Date.now();
    const nonce = randomBytes(8).toString('base64url');
    const payload = `${ts}.${nonce}`;
    const sig = this.hmac(payload);
    return {
      token: `${ts}.${nonce}.${sig}`,
      ttlSec: Math.floor(FormTokenService.MAX_AGE_MS / 1000),
    };
  }

  /**
   * Verify token. Returns detailed info for audit log.
   */
  verify(token: string | undefined | null): {
    ok: boolean;
    reason?: 'missing' | 'malformed' | 'bad_sig' | 'too_fast' | 'too_old';
    ageMs?: number;
  } {
    if (!token || typeof token !== 'string') {
      return { ok: false, reason: 'missing' };
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { ok: false, reason: 'malformed' };
    }
    const [tsStr, nonce, sig] = parts;
    const ts = Number(tsStr);
    if (!Number.isFinite(ts) || ts <= 0 || !nonce || !sig) {
      return { ok: false, reason: 'malformed' };
    }

    const expectedSig = this.hmac(`${tsStr}.${nonce}`);
    // Constant-time comparison
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'bad_sig' };
    }

    const ageMs = Date.now() - ts;
    if (ageMs < FormTokenService.MIN_AGE_MS) {
      return { ok: false, reason: 'too_fast', ageMs };
    }
    if (ageMs > FormTokenService.MAX_AGE_MS) {
      return { ok: false, reason: 'too_old', ageMs };
    }
    return { ok: true, ageMs };
  }

  /** HMAC-SHA256 → base64url, truncated to 22 chars (128-bit signature). */
  private hmac(payload: string): string {
    return createHmac('sha256', this.secret)
      .update(payload)
      .digest('base64url')
      .slice(0, 22);
  }
}
