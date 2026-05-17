import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';

/**
 * Layered rate limit for POST /api/submit.
 *
 * CONTEXT: at an event there can be **up to 50,000 users in 5–15 minutes**
 * coming from mobile internet (MTS, Yettel, Telenor). In Serbia
 * that means **carrier-grade NAT** — thousands of subscribers share one public
 * IP. A naive per-IP rate limit would reject everyone except a handful.
 *
 * Realistic pace:
 *   - 50,000 / 5 min  = 167 req/sec
 *   - 50,000 / 15 min = 56 req/sec
 *
 * Solution: 4 layers with different goals:
 *
 *   ┌────────────────────┬──────────┬───────────┬───────────────────────────┐
 *   │ Layer              │ Window   │ Max       │ Goal                       │
 *   ├────────────────────┼──────────┼───────────┼───────────────────────────┤
 *   │ Burst per (IP+UA)  │ 250ms    │ 1 req     │ Same user does not click 2x│
 *   │                    │          │           │ in 250ms; separates different│
 *   │                    │          │           │ people behind same NAT      │
 *   │ Per (IP+UA)        │ 15 min   │ 3 req     │ One person max 3 registrations│
 *   │                    │          │           │ (normal=1, error retry=2)   │
 *   │ Per IP (sanity)    │ 15 min   │ 25,000    │ Sanity cap — above this is │
 *   │                    │          │           │ attack even from MTS NAT.    │
 *   │                    │          │           │ Set generously to          │
 *   │                    │          │           │ cover 50K event with 2–3   │
 *   │                    │          │           │ public IPs behind MTS NAT.  │
 *   │ Global             │ 1 min    │ 20,000    │ 2x headroom over real      │
 *   │                    │          │           │ pace of ~10K/min           │
 *   └────────────────────┴──────────┴───────────┴───────────────────────────┘
 *
 * Reasons for this layering:
 *  - Burst is NOT per IP but per (IP+UA): if 5 people behind same MTS IP
 *    hit submit in the same second, all pass because they have different UAs.
 *    Bot that rotates UA falls under the next layers.
 *  - Per (IP+UA) tight (3/15min) because in practice one sends 1, max 2–3.
 *    Bot that changes UA every request is still stopped by sanity
 *    layer.
 *  - Per IP loose (25K/15min) → bot farm from one IP rotating UA
 *    cannot exceed 25K requests. Legitimate 50K event with 10+ different
 *    MTS public IPs passes without issue.
 *  - Global (20K/min) → server saturation guard. Cloudflare in front
 *    amortizes GET HTML before it reaches us.
 *
 * Phase 3: switch to Redis when we have multiple node instances.
 */

const MIN_MS = 60 * 1000;

/** "Mini token bucket" — allows one request every N ms. */
class BurstLimiter {
  private lastAt = new Map<string, number>();
  constructor(public readonly minIntervalMs: number) {}

  tryConsume(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const last = this.lastAt.get(key) ?? 0;
    const delta = now - last;
    if (delta < this.minIntervalMs) {
      return { allowed: false, retryAfterMs: this.minIntervalMs - delta };
    }
    this.lastAt.set(key, now);
    return { allowed: true, retryAfterMs: 0 };
  }

  cleanup(): number {
    const cutoff = Date.now() - this.minIntervalMs * 20;
    let removed = 0;
    for (const [k, ts] of this.lastAt) {
      if (ts < cutoff) {
        this.lastAt.delete(k);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.lastAt.size;
  }
}

/** Fixed-window counter. */
class FixedWindow {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(
    public readonly name: string,
    public readonly max: number,
    public readonly windowMs: number,
  ) {}

  tryConsume(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, b);
    }
    if (b.count >= this.max) {
      return { allowed: false, retryAfterMs: b.resetAt - now };
    }
    b.count++;
    return { allowed: true, retryAfterMs: 0 };
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [k, b] of this.buckets) {
      if (b.resetAt <= now) {
        this.buckets.delete(k);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.buckets.size;
  }
}

export const SUBMIT_RATE_LIMIT = {
  /** Burst — same user (IP+UA) must not click 2x faster than 250ms. */
  BURST_MIN_INTERVAL_MS: 250,

  /** Per (IP+UA) — one person has 3 attempts in 15 min. */
  PER_IP_UA_MAX: 3,
  PER_IP_UA_WINDOW_MS: 15 * 60 * 1000,

  /**
   * Per IP sanity — more than 25K requests from same NAT in 15 min is suspicious.
   *
   * Why 25K:
   *  - 50K legitimate users in 15 min behind 2 MTS public IPs = 25K/IP
   *  - with 3+ public IPs (more realistic for 50K crowd) = ~17K/IP, well under limit
   *  - bot rotating UA staying under 25K per IP → too much effort for small
   *    chance of success; if it happens, block IP manually via Cloudflare
   *
   * Memory: ~50 bytes per unique IP, GC after 15 min — trivial.
   * Performance: O(1) Map lookup, no DB hit.
   *
   * If extreme events need more headroom, raise this number
   * (e.g. 50_000). Phase 2: add "Event mode" toggle in admin panel
   * that dynamically raises these limits for the duration of a rally.
   */
  PER_IP_SANITY_MAX: 25_000,
  PER_IP_SANITY_WINDOW_MS: 15 * 60 * 1000,

  /** Global cap — 333 req/sec, 2x above expected peak of ~170 req/sec. */
  GLOBAL_MAX: 20_000,
  GLOBAL_WINDOW_MS: 60 * 1000,
} as const;

export type RateLimitReason =
  | 'burst'
  | 'ip_ua'
  | 'ip_sanity'
  | 'global'
  | '';

export type RateLimitCheck = {
  allowed: boolean;
  retryAfterSec: number;
  reason: RateLimitReason;
};

/**
 * Per-reason user-facing messages. All deliberately generic so a bot cannot
 * use reason as an oracle for probing limits. Exact copy is Serbian; see `messageForReason` body.
 */
export function messageForReason(reason: RateLimitReason): string {
  if (reason === 'global') {
    return 'Sistem je trenutno zauzet zbog velikog broja prijava. Sačekajte par sekundi i pokušajte ponovo.';
  }
  return 'Previše prijava sa vaše adrese. Pokušajte ponovo za par minuta.';
}

@Injectable()
export class SubmitRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(SubmitRateLimitService.name);

  private readonly burstByIpUa = new BurstLimiter(
    SUBMIT_RATE_LIMIT.BURST_MIN_INTERVAL_MS,
  );
  private readonly byIpUa = new FixedWindow(
    'ip_ua',
    SUBMIT_RATE_LIMIT.PER_IP_UA_MAX,
    SUBMIT_RATE_LIMIT.PER_IP_UA_WINDOW_MS,
  );
  private readonly byIpSanity = new FixedWindow(
    'ip_sanity',
    SUBMIT_RATE_LIMIT.PER_IP_SANITY_MAX,
    SUBMIT_RATE_LIMIT.PER_IP_SANITY_WINDOW_MS,
  );
  private readonly global = new FixedWindow(
    'global',
    SUBMIT_RATE_LIMIT.GLOBAL_MAX,
    SUBMIT_RATE_LIMIT.GLOBAL_WINDOW_MS,
  );

  /** GC interval — cleans expired buckets so memory does not grow unbounded. */
  private readonly gcInterval: NodeJS.Timeout;

  constructor() {
    // 2 min GC; important because at events memory can grow to ~100MB
    this.gcInterval = setInterval(() => this.cleanup(), 2 * MIN_MS);
    if (typeof this.gcInterval.unref === 'function') this.gcInterval.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.gcInterval);
  }

  /**
   * Main check — returns allowed=true only when ALL 4 layers pass.
   * Layers are checked in cheap → expensive order.
   * If a layer rejects, later layers are not incremented.
   */
  check(opts: { ip: string; userAgent: string }): RateLimitCheck {
    const ip = (opts.ip || 'unknown').slice(0, 64);
    const uaHash = this.uaHash(opts.userAgent);
    const ipUaKey = `${ip}|${uaHash}`;

    const burst = this.burstByIpUa.tryConsume(ipUaKey);
    if (!burst.allowed) {
      return {
        allowed: false,
        retryAfterSec: 1, // burst is always short; 1s is enough
        reason: 'burst',
      };
    }

    const ipUa = this.byIpUa.tryConsume(ipUaKey);
    if (!ipUa.allowed) {
      return {
        allowed: false,
        retryAfterSec: Math.max(60, Math.ceil(ipUa.retryAfterMs / 1000)),
        reason: 'ip_ua',
      };
    }

    const ipSanity = this.byIpSanity.tryConsume(ip);
    if (!ipSanity.allowed) {
      return {
        allowed: false,
        retryAfterSec: Math.max(60, Math.ceil(ipSanity.retryAfterMs / 1000)),
        reason: 'ip_sanity',
      };
    }

    const glob = this.global.tryConsume('global');
    if (!glob.allowed) {
      // Global cap → server under load; quick retry and window will open
      return {
        allowed: false,
        retryAfterSec: Math.max(2, Math.ceil(glob.retryAfterMs / 1000)),
        reason: 'global',
      };
    }

    return { allowed: true, retryAfterSec: 0, reason: '' };
  }

  /** Compact UA hash — 16 hex chars is enough to differentiate. */
  private uaHash(ua: string): string {
    return createHash('sha256')
      .update((ua || '').slice(0, 500))
      .digest('hex')
      .slice(0, 16);
  }

  private cleanup(): void {
    const a = this.burstByIpUa.cleanup();
    const b = this.byIpUa.cleanup();
    const c = this.byIpSanity.cleanup();
    const d = this.global.cleanup();
    if (a + b + c + d > 0) {
      this.logger.debug(
        `rate-limit GC: burst=${a} ip_ua=${b} ip_sanity=${c} global=${d}`,
      );
    }
  }

  /** Debug helper — returns current bucket counts per layer. */
  stats(): Record<string, number> {
    return {
      burst_tracked: this.burstByIpUa.size(),
      ip_ua_buckets: this.byIpUa.size(),
      ip_sanity_buckets: this.byIpSanity.size(),
      global_buckets: this.global.size(),
    };
  }
}
