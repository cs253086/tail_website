// Answer cache. A documentation site is asked the same few dozen questions
// indefinitely, so this is the difference between staying inside a free quota
// and exhausting it by lunchtime.
//
// The build hash is part of the key, so republishing the documentation retires
// every cached answer without an explicit purge step.

const TTL_SECONDS = 60 * 60 * 24 * 30;

export function normalizeQuestion(question) {
  return String(question)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?!.,;:]+$/g, '')
    .trim();
}

export async function cacheKey(question, buildId) {
  const data = new TextEncoder().encode(`${buildId}:${normalizeQuestion(question)}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `answer:${buildId}:${hex.slice(0, 32)}`;
}

export async function readCache(kv, key) {
  if (!kv) return null;
  try {
    return await kv.get(key, 'json');
  } catch {
    return null;
  }
}

export async function writeCache(kv, key, payload) {
  if (!kv) return;
  try {
    await kv.put(key, JSON.stringify(payload), { expirationTtl: TTL_SECONDS });
  } catch {
    // A cache that cannot be written is a cost problem, not a correctness one.
  }
}
