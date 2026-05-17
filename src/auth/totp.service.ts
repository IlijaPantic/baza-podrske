import { Injectable, Logger } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';

/**
 * TOTP service (RFC 6238) for admin 2FA.
 *
 * LIBRARY: `otplib` — standard, well maintained. Generates base32
 * secrets and validates 6-digit codes. Authenticator apps
 * (Google Authenticator, Authy, 1Password, Bitwarden) support
 * RFC 6238 with SHA1 (default), 30s window, 6 digits.
 *
 * SECURITY:
 *   - Secret is generated with `randomBytes(20)` → 160 bits entropy
 *     (otplib default = 20 bytes).
 *   - Validation allows window=1 (±30s clock drift) — standard.
 *   - Replay protection: none for now (otplib alone does not persist consumed codes).
 *     Phase 3: add used_totp_codes table to forbid reuse (relevant
 *     only if someone races MITM within the 30s window).
 *
 * USAGE:
 *   1. `generateSecret()` → secret (base32) — store in user.totpSecret
 *   2. `otpAuthUri(email, secret)` → otpauth:// URI for QR
 *   3. `qrCodeDataUrl(uri)` → data URL (PNG) for <img src="...">
 *   4. User scans QR, enters 6 digits
 *   5. `verifyCode(code, secret)` → boolean
 *   6. If OK, set `totpEnabledAt = now()` — from then on login requires 2FA
 */
@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);

  /** Issuer name shown in the authenticator app. */
  private readonly issuer = 'Kontrola';

  constructor() {
    // Configure otplib: 30s step, 6 digits, SHA1 (RFC 6238 default,
    // supported by all major mobile apps)
    authenticator.options = {
      step: 30,
      digits: 6,
      window: 1, // ±30s drift tolerancija
    };
  }

  /** Generate a fresh secret (160 bits, base32). */
  generateSecret(): string {
    return authenticator.generateSecret();
  }

  /**
   * Otpauth URI standard:
   *   otpauth://totp/Issuer:account?secret=...&issuer=Issuer
   *
   * Authenticator apps parse this and show "Issuer (account)"
   * in the token list.
   */
  otpAuthUri(email: string, secret: string): string {
    return authenticator.keyuri(email, this.issuer, secret);
  }

  /** Generate QR code as data: URL (PNG base64) for <img>. */
  async qrCodeDataUrl(otpAuthUri: string): Promise<string> {
    return QRCode.toDataURL(otpAuthUri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 6,
    });
  }

  /**
   * Verify 6-digit code. Any whitespace in code is stripped
   * (users often type "123 456").
   * Returns false if secret is invalid or code does not match.
   */
  verifyCode(code: string, secret: string): boolean {
    if (!code || !secret) return false;
    const cleaned = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleaned)) return false;
    try {
      return authenticator.verify({ token: cleaned, secret });
    } catch (e: any) {
      this.logger.warn(`TOTP verify error: ${e?.message ?? e}`);
      return false;
    }
  }
}
