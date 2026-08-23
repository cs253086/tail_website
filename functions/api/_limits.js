// Quota protection. Three independent limits, each degrading to keyword
// results rather than an error, so exhaustion makes the site less clever for
// the rest of the day but never broken.
//
// `now` is always injected so the arithmetic is testable without waiting.
//
// Known limitation: both counters are read-modify-write over Workers KV, which
// offers no compare-and-set and propagates writes with eventual consistency.
// Concurrent requests — especially across colos — can therefore overshoot both
// limits for a short window. These are cost guards, not security controls, so
// the ceiling is set well under the provider's hard limit to absorb that rather
// than reaching for Durable Objects, which would add cost and complexity a
// documentation site does not need. Tighten this if it ever guards something
// that must not be exceeded.

export const PER_IP_BURST = 8;
export const PER_IP_REFILL_SECONDS = 45;
// The free tier is metered per model per day, and the allowance is far smaller
// than the 1,500/day the older Flash models offered: gemini-3.7-flash grants
// 20. This ceiling is deliberately conservative because the lite model's exact
// allowance has not been read off the provider's dashboard; raise it to sit
// just under the real figure once that is known. The gap also absorbs
// eventual-consistency overshoot rather than assuming the counter is exact.
export const DAILY_CEILING = 200;

function dayKey(now) {
  return `daily:${new Date(now).toISOString().slice(0, 10)}`;
}

export function refill(bucket, now, burst = PER_IP_BURST, refillSeconds = PER_IP_REFILL_SECONDS) {
  const elapsed = Math.max(0, now - (bucket?.updatedAt ?? now)) / 1000;
  const gained = Math.floor(elapsed / refillSeconds);
  const tokens = Math.min(burst, (bucket?.tokens ?? burst) + gained);
  // Only advance the clock by whole tokens, so fractional time is not lost.
  const updatedAt = (bucket?.updatedAt ?? now) + gained * refillSeconds * 1000;
  return { tokens, updatedAt: Math.min(updatedAt, now) };
}

export async function takeToken(kv, ip, now) {
  if (!kv) return { allowed: true };

  const key = `ip:${ip}`;
  const bucket = refill(await kv.get(key, 'json'), now);
  if (bucket.tokens <= 0) {
    return { allowed: false, reason: 'rate_limit' };
  }

  await kv.put(
    key,
    JSON.stringify({ tokens: bucket.tokens - 1, updatedAt: bucket.updatedAt }),
    { expirationTtl: PER_IP_BURST * PER_IP_REFILL_SECONDS * 2 },
  );
  return { allowed: true };
}

export async function withinDailyCeiling(kv, now, ceiling = DAILY_CEILING) {
  if (!kv) return true;
  const used = Number((await kv.get(dayKey(now))) ?? 0);
  return used < ceiling;
}

export async function recordModelCall(kv, now) {
  if (!kv) return;
  const key = dayKey(now);
  const used = Number((await kv.get(key)) ?? 0);
  await kv.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });
}
