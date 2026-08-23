// The only file that knows which model provider is in use.
//
// Everything else — retrieval, the grounding contract, the citation check,
// caching, rate limiting — is provider-independent. Moving to a different
// provider is an edit to answer() and nothing else.

import { SYSTEM_PROMPT, buildUserMessage } from './_prompt.js';

// A non-thinking model is a requirement, not a preference. The provider
// charges thinking tokens against maxOutputTokens, so on a thinking model the
// reasoning consumes the budget and the reader receives whatever few tokens
// are left — measured at 985 of 1024 spent before the answer began. Lite
// models do not think, so the whole budget reaches the page.
export const DEFAULT_MODEL = 'gemini-flash-lite-latest';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 20000;

export class ModelError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

export async function answer({ question, passages, apiKey, model = DEFAULT_MODEL, fetchImpl = fetch }) {
  if (!apiKey) throw new ModelError('missing API key', 'unconfigured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  let body;
  try {
    response = await fetchImpl(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildUserMessage(question, passages) }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 1024, candidateCount: 1 },
      }),
    });
    if (response.status === 429) throw new ModelError('provider quota exhausted', 'quota');
    if (!response.ok) throw new ModelError(`provider returned ${response.status}`, 'unavailable');
    // Read the body inside the timeout: headers can arrive promptly and the
    // body then trickle, which would otherwise hang past TIMEOUT_MS.
    body = await response.json();
  } catch (error) {
    if (error instanceof ModelError) throw error;
    throw new ModelError(`request failed: ${error.message}`, 'unavailable');
  } finally {
    clearTimeout(timer);
  }
  const candidate = body?.candidates?.[0];

  // Anything other than STOP means the provider cut the generation short:
  // MAX_TOKENS ends mid-word, SAFETY and RECITATION end wherever they end. The
  // fragment is not a shorter answer, it is a broken one, and it would still
  // satisfy the citation gate if a marker happened to land before the cut. An
  // absent reason is not a truncation signal, so only an explicit one rejects.
  const { finishReason } = candidate ?? {};
  if (finishReason && finishReason !== 'STOP') {
    throw new ModelError(`generation stopped early: ${finishReason}`, 'unavailable');
  }

  const text = (candidate?.content?.parts ?? [])
    .map((part) => part?.text ?? '')
    .join('')
    .trim();

  if (!text) throw new ModelError('provider returned no text', 'unavailable');
  return { text };
}
