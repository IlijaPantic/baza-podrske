import { Injectable, Logger } from '@nestjs/common';
import {
  LOGIN_RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_WINDOW_MS,
} from './auth.constants';

type Bucket = {
  count: number;
  resetAt: number;
};

/**
 * Simple in-memory token bucket for per-IP rate limiting.
 *
 * Limitations:
 *  - Lost on process restart (OK for Phase 1; Phase 2 moves to Redis)
 *  - Not shared across instances (Phase 2: Redis distributed)
 *  - Tracks only failed attempts; success resets counter
 *
 * Usage:
 *   if (rl.tooMany(ip)) throw new TooManyRequestsException();
 *   ... attempt login ...
 *   if (failed) rl.recordFailure(ip);
 *   if (success) rl.reset(ip);
 */
@Injectable()
export class LoginRateLimitService {
  private readonly logger = new Logger(LoginRateLimitService.name);
  private readonly buckets = new Map<string, Bucket>();

  private getBucket(key: string): Bucket {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (existing && existing.resetAt > now) return existing;
    const fresh: Bucket = {
      count: 0,
      resetAt: now + LOGIN_RATE_LIMIT_WINDOW_MS,
    };
    this.buckets.set(key, fresh);
    return fresh;
  }

  /** Whether the IP hit the limit and should be rejected before attempting login. */
  tooMany(ip: string): boolean {
    const b = this.getBucket(ip);
    return b.count >= LOGIN_RATE_LIMIT_MAX;
  }

  recordFailure(ip: string): void {
    const b = this.getBucket(ip);
    b.count++;
    if (b.count === LOGIN_RATE_LIMIT_MAX) {
      this.logger.warn(`Rate limit dostignut za IP=${ip.slice(0, 20)}`);
    }
  }

  reset(ip: string): void {
    this.buckets.delete(ip);
  }

  /** Periodic GC of stale buckets (called from a ticker). */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, b] of this.buckets) {
      if (b.resetAt <= now) {
        this.buckets.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
