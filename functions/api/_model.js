// The only file that knows which model provider is in use.
//
// Everything else — retrieval, the grounding contract, the citation check,
// caching, rate limiting — is provider-independent. Moving to a different
// provider is an edit to answer() and nothing else.

import { parseAnswer } from '../../assets/js/answer-format.js';
import { REFUSAL_TOKEN } from './_citations.js';
import { SYSTEM_PROMPT, buildUserMessage } from './_prompt.js';

// A non-thinking model is a requirement, not a preference. The provider
// charges thinking tokens against maxOutputTokens, so on a thinking model the
// reasoning consumes the budget and the reader receives whatever few tokens
// are left — measured at 985 of 1024 spent before the answer began. Lite
// models do not think, so the whole budget reaches the page.
export const DEFAULT_MODEL = 'gemini-flash-lite-latest';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 20000;

// The reply's shape, enforced by the provider. A prose block must name at
// least one passage, so an answer with an uncited paragraph cannot be
// produced by a well-formed reply. Asked for in prose, a citation was left off
// a correct answer often enough (5 of 36 questions, 2026-10-05) that the gate
// in §5.3 discarded one answer in seven.
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    refused: { type: 'BOOLEAN' },
    blocks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: ['prose', 'code'] },
          text: { type: 'STRING' },
          sources: { type: 'ARRAY', items: { type: 'INTEGER' }, minItems: 1 },
        },
        required: ['kind', 'text', 'sources'],
        propertyOrdering: ['kind', 'text', 'sources'],
      },
    },
  },
  required: ['refused', 'blocks'],
  propertyOrdering: ['refused', 'blocks'],
};

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
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1024,
          candidateCount: 1,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
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
  return { text: answerText(parseReply(text)) };
}

// A reply that is not the promised shape is a provider failure, like a
// truncated one: the handler degrades to search results.
function parseReply(text) {
  let reply;
  try {
    reply = JSON.parse(text);
  } catch {
    throw new ModelError('provider returned malformed JSON', 'unavailable');
  }
  const wellFormed = reply && typeof reply.refused === 'boolean' && Array.isArray(reply.blocks)
    && reply.blocks.every((block) => ['prose', 'code'].includes(block?.kind)
      && typeof block.text === 'string'
      && Array.isArray(block.sources) && block.sources.length > 0
      && block.sources.every(Number.isInteger));
  if (!wellFormed) throw new ModelError('provider reply does not match the response schema', 'unavailable');
  return reply;
}

// The reply becomes the same answer text the rest of the site has always
// handled, so the citation gate, the cache and the renderer are unchanged.
function answerText(reply) {
  if (reply.refused) return REFUSAL_TOKEN;
  const text = reply.blocks
    .map((block) => (block.kind === 'code' ? fence(block.text) : cite(block.text, block.sources)))
    .filter(Boolean)
    .join('\n\n');
  if (!text) throw new ModelError('provider returned no text', 'unavailable');
  return text;
}

const fence = (code) => (code.trim() ? `\`\`\`\n${code.replace(/\n+$/, '')}\n\`\`\`` : '');

// `sources` is the one record of what a paragraph rests on. A marker the
// model also wrote into the text is dropped, found by the parse that decides
// what a citation is everywhere else, so `array[1]` in inline code survives.
function cite(text, sources) {
  const prose = parseAnswer(text)
    .map((block) => (block.type === 'code' ? fence(block.text) : uncited(block.pieces)))
    .filter(Boolean)
    .join('\n\n');
  if (!prose) return '';
  const marker = `[${[...new Set(sources)].join(', ')}]`;
  const end = /[.,;:!?]$/.test(prose) ? prose.length - 1 : prose.length;
  return `${prose.slice(0, end)} ${marker}${prose.slice(end)}`;
}

// A paragraph's pieces back to text, without its citation markers. Only plain
// text is tidied where a marker was cut out, never the inside of inline code.
function uncited(pieces) {
  const out = [];
  for (const piece of pieces) {
    if (piece.type === 'cite') continue;
    if (piece.type === 'text' && out.at(-1)?.type === 'text') out.at(-1).text += piece.text;
    else out.push({ ...piece });
  }
  return out
    .map((piece) => {
      if (piece.type === 'code') return `\`${piece.text}\``;
      if (piece.type === 'strong') return `**${piece.text}**`;
      return piece.text.replace(/ +([.,;:!?])/g, '$1').replace(/ {2,}/g, ' ');
    })
    .join('')
    .trim();
}
