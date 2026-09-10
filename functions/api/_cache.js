// Answer cache. A documentation site is asked the same few dozen questions
// indefinitely, so this is the difference between staying inside a free quota
// and exhausting it by lunchtime.
//
// The key covers every input that determines the answer — the corpus (via the
// build hash), the model, the system prompt, the passages retrieval assembled,
// and the question — so changing any of them retires the affected entries
// without an explicit purge step. Leaving
// the model out once meant a model switch kept serving thirty days of answers
// from the model it replaced. Fields are NUL-separated so no combination of
// values can collide with a different one.

const TTL_SECONDS = 60 * 60 * 24 * 30;

export function normalizeQuestion(question) {
  return String(question)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?!.,;:]+$/g, '')
    .trim();
}

export async function cacheKey(question, buildId, model, systemPrompt = '', passageIds = []) {
  // The passages are the input the answer is made from, so naming them is what
  // makes the key cover retrieval as well. A version constant would do the same
  // job only until somebody changed how passages are assembled and forgot to
  // bump it -- which is how a refusal produced before openings were added went
  // on being served after they were.
  //
  // Sorted, because rank order decides which passage is [1] but not whether the
  // answer is still valid; two identical sets should share one entry.
  const passages = [...passageIds].sort().join('\u001f');
  const data = new TextEncoder().encode(
    [buildId, model, systemPrompt, passages, normalizeQuestion(question)].join('\u0000'),
  );
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
