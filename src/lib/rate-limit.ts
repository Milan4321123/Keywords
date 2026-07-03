import { ApiAuthError } from '@/lib/auth';

interface Bucket {
  count: number;
  resetAt: number;
}

// In-memory sliding-window limiter. Per-instance (resets on deploy);
// swap for Redis/Upstash when running multiple instances.
const buckets = new Map<string, Bucket>();

const LIMITS: Record<string, { max: number; windowMs: number }> = {
  ai: { max: 30, windowMs: 60_000 },        // AI questions / user / minute
  upload: { max: 60, windowMs: 60_000 },    // file & dataset uploads
  heavy: { max: 20, windowMs: 60_000 },     // report generation, forecasts, validation
};

/**
 * Throws ApiAuthError(429) when the caller exceeds the bucket's limit.
 * Key by user id so one user cannot starve the whole org.
 */
export function enforceRateLimit(bucketName: keyof typeof LIMITS, userId: string): void {
  const limit = LIMITS[bucketName];
  const key = `${bucketName}:${userId}`;
  const now = Date.now();

  // Opportunistic cleanup
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) {
      if (b.resetAt < now) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return;
  }
  bucket.count++;
  if (bucket.count > limit.max) {
    const waitSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    throw new ApiAuthError(
      429,
      'rate_limited',
      `Rate limit reached (${limit.max}/${limit.windowMs / 1000}s). Try again in ${waitSeconds}s.`
    );
  }
}
