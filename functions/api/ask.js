// POST /api/ask  { question: string }
//
// Retrieval happens here, never in the browser. The client sends a question
// and nothing else, so this endpoint can only ever answer from its own bundled
// corpus — being used as a general-purpose chatbot is not forbidden by a rule,
// it is unreachable.

import corpus from '../../generated/chunks.json';

import { search } from '../../tools/bm25.mjs';
import { cacheKey, readCache, writeCache } from './_cache.js';
import { SYSTEM_PROMPT } from './_prompt.js';
import { isRefusal, validateAnswer } from './_citations.js';
import { recordModelCall, takeToken, withinDailyCeiling } from './_limits.js';
import { DEFAULT_MODEL, ModelError, answer as callModel } from './_model.js';

const MAX_QUESTION = 500;
const PASSAGES = 6;
const RESULTS = 5;

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const byId = new Map(corpus.chunks.map((chunk) => [chunk.id, chunk]));

const asResult = (chunk) => ({
  docSlug: chunk.docSlug,
  docTitle: chunk.docTitle,
  headingPath: chunk.headingPath,
  anchor: chunk.anchor,
});

function retrieve(question, limit) {
  return search(corpus.index, question, limit)
    .map((hit) => byId.get(hit.id))
    .filter(Boolean);
}

// A document's opening chunk: the part before its first section heading, which
// is where it says what it is about.
const openingOf = new Map();
for (const chunk of corpus.chunks) {
  if (chunk.headingPath.length === 1 && !openingOf.has(chunk.docSlug)) {
    openingOf.set(chunk.docSlug, chunk);
  }
}

// Ranking finds fragments; answering needs to know what document they came
// from. An entry titled "Publisher" holding four lines of code ranks well and
// defines nothing, so a question about the concept it demonstrates was handed
// six such fragments and refused for want of the sentence that says what a
// periodic node is. That sentence is always in the opening, so every document
// that scores contributes one -- at most a handful of extra passages, and the
// cheapest correct form of ranking on fragments while answering from sections.
function withOpenings(ranked) {
  const seen = new Set(ranked.map((chunk) => chunk.id));
  const openings = [];

  for (const slug of new Set(ranked.map((chunk) => chunk.docSlug))) {
    const opening = openingOf.get(slug);
    if (opening && !seen.has(opening.id)) {
      seen.add(opening.id);
      openings.push(opening);
    }
  }

  // Openings lead, so passage [1] is context rather than a fragment.
  return [...openings, ...ranked];
}

// Every limit lands here: results, never an error. The site becomes less
// clever until the quota resets, and never broken.
const degraded = (question, reason, results) =>
  json({ status: 'degraded', question, reason, results: results.map(asResult) });

export async function onRequestPost({ request, env }) {
  let question;
  try {
    const body = await request.json();
    question = String(body?.question ?? '').trim().slice(0, MAX_QUESTION);
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  if (!question) return json({ error: 'question is required' }, 400);

  const kv = env.ANSWER_CACHE ?? null;
  const now = Date.now();
  const ranked = retrieve(question, PASSAGES);
  // What the reader is shown when there is no answer stays the ranked hits: an
  // opening is context for the model, not a search result.
  const results = ranked.slice(0, RESULTS);
  const passages = withOpenings(ranked);

  if (ranked.length === 0) {
    return json({
      status: 'unsupported',
      question,
      reason: 'Nothing in the published documentation matches that question.',
      coverage: corpus.coverage,
      results: [],
    });
  }

  // Resolved here rather than inside answer(), because the cache key has to
  // name the model that actually produced the entry.
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const key = await cacheKey(question, corpus.buildId, model, SYSTEM_PROMPT);
  const cached = await readCache(kv, key);
  if (cached) return json(cached);

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const limit = await takeToken(kv, ip, now);
  if (!limit.allowed) {
    return degraded(question, 'You have asked a lot of questions in a short time. Here are the closest sections.', results);
  }
  if (!(await withinDailyCeiling(kv, now))) {
    return degraded(question, 'The daily limit for generated answers has been reached. Here are the closest sections.', results);
  }

  let text;
  try {
    await recordModelCall(kv, now);
    ({ text } = await callModel({
      question,
      passages,
      apiKey: env.GEMINI_API_KEY,
      model,
    }));
  } catch (error) {
    const reason = error instanceof ModelError && error.kind === 'quota'
      ? 'The daily limit for generated answers has been reached. Here are the closest sections.'
      : 'The answering service is unavailable right now. Here are the closest sections.';
    return degraded(question, reason, results);
  }

  if (isRefusal(text)) {
    const payload = {
      status: 'unsupported',
      question,
      reason: 'The documentation published here does not cover that. I will not guess at anything outside it.',
      coverage: corpus.coverage,
      results: results.map(asResult),
    };
    await writeCache(kv, key, payload);
    return json(payload);
  }

  // The prompt asks for citations; this is what enforces them. An uncited or
  // out-of-range answer is discarded rather than shown.
  const verdict = validateAnswer(text, passages.length);
  if (!verdict.ok) {
    return degraded(
      question,
      'A sourced answer could not be produced for that question. Here are the closest sections.',
      results,
    );
  }

  const payload = {
    status: 'answered',
    question,
    answer: text,
    citations: verdict.used.map((n) => ({ n, ...asResult(passages[n - 1]) })),
    results: results.map(asResult),
  };
  await writeCache(kv, key, payload);
  return json(payload);
}
