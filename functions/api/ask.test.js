import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findMarkers, isRefusal, validateAnswer } from './_citations.js';
import { cacheKey, normalizeQuestion } from './_cache.js';
import { DAILY_CEILING, PER_IP_BURST, refill, takeToken, withinDailyCeiling } from './_limits.js';

// A fixture corpus keeps these tests independent of whatever the generator
// last produced.
const CORPUS = {
  buildId: 'build-one',
  coverage: [{ slug: 'qemu', title: 'Running TAIL OS in QEMU', summary: 'Boot under QEMU.' }],
  chunks: [
    {
      id: 'qemu#run:0', docSlug: 'qemu', docTitle: 'Running TAIL OS in QEMU',
      headingPath: ['Running TAIL OS in QEMU', 'Run TailOS'], anchor: 'run-tailos',
      text: 'Install qemu-system-aarch64 and launch the prebuilt image with one command.',
    },
    {
      id: 'rpi#flash:0', docSlug: 'raspberry-pi-3', docTitle: 'Installing on Raspberry Pi 3',
      headingPath: ['Installing on Raspberry Pi 3', 'Quick Start'], anchor: 'quick-start',
      text: 'Flash the SD card image and wire the serial console before powering on.',
    },
  ],
  index: null,
};

const { buildIndex } = await import('../../tools/bm25.mjs');
CORPUS.index = buildIndex(CORPUS.chunks.map((chunk) => ({
  id: chunk.id, heading: chunk.headingPath.join(' '), body: chunk.text,
})));

vi.mock('../../generated/chunks.json', () => ({ default: CORPUS }));
const modelMock = vi.hoisted(() => ({ answer: vi.fn() }));
vi.mock('./_model.js', async (importOriginal) => ({
  ...(await importOriginal()),
  answer: modelMock.answer,
}));

const { onRequestPost } = await import('./ask.js');
const { ModelError } = await import('./_model.js');

function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) { store.set(key, String(value)); },
  };
}

const ask = (question, env = {}) => onRequestPost({
  request: new Request('https://tail-os.com/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
    body: JSON.stringify({ question }),
  }),
  env: { GEMINI_API_KEY: 'test-key', ...env },
});

beforeEach(() => {
  modelMock.answer.mockReset();
});

// --- citation enforcement ---------------------------------------------------

describe('validateAnswer', () => {
  it('accepts an answer whose markers are all in range', () => {
    expect(validateAnswer('Install it [1], then boot [2].', 2)).toEqual({ ok: true, used: [1, 2] });
  });

  it('rejects an answer with no citation at all', () => {
    expect(validateAnswer('Just run make and it works.', 3).reason).toBe('uncited');
  });

  it('rejects a marker pointing past the passages supplied', () => {
    expect(validateAnswer('See [7].', 3).reason).toBe('out_of_range');
  });

  it('rejects an empty answer', () => {
    expect(validateAnswer('   ', 3).reason).toBe('empty');
  });

  it('reports each source once, in order of first appearance', () => {
    expect(validateAnswer('[2] then [1] then [2] again.', 2).used).toEqual([2, 1]);
  });

  it('finds every marker in the text', () => {
    expect(findMarkers('a [1] b [12] c')).toEqual([1, 12]);
  });

  // The gate must count what the browser will actually render as a citation.
  // Counting raw [n] let `array[1]` pass as sourced while rendering none.
  it('does not accept a bracket inside inline code as a citation', () => {
    expect(validateAnswer('Index the array with `array[1]` to read it.', 6).reason).toBe('uncited');
  });

  it('does not accept a bracket inside a fenced block as a citation', () => {
    expect(validateAnswer('Run:\n\n```bash\nprintf "%s" "${arr[1]}"\n```\n', 6).reason).toBe('uncited');
  });

  it('still accepts a genuine citation beside bracketed code', () => {
    expect(validateAnswer('Use `array[1]` as shown [2].', 6)).toEqual({ ok: true, used: [2] });
  });
});

describe('isRefusal', () => {
  it('recognises the refusal token', () => {
    expect(isRefusal('NO_ANSWER_IN_DOCS')).toBe(true);
    expect(isRefusal('The kernel uses message passing [1].')).toBe(false);
  });
});

// --- cache keying -----------------------------------------------------------

describe('cache keys', () => {
  it('treats trivially different phrasings as the same question', () => {
    expect(normalizeQuestion('  How do I run QEMU?  ')).toBe(normalizeQuestion('how do i run qemu'));
  });

  it('is stable for the same question and build', async () => {
    expect(await cacheKey('How do I run QEMU?', 'b1', 'm1')).toBe(await cacheKey('how do i run qemu', 'b1', 'm1'));
  });

  it('changes when the documentation is republished', async () => {
    expect(await cacheKey('How do I run QEMU?', 'b1', 'm1')).not.toBe(await cacheKey('How do I run QEMU?', 'b2', 'm1'));
  });

  it('retires cached answers when the model changes, so a switch takes effect', async () => {
    // Without the model in the key, replacing a model kept serving thirty days
    // of answers produced by the one it replaced.
    expect(await cacheKey('q', 'b1', 'gemini-3.7-flash'))
      .not.toBe(await cacheKey('q', 'b1', 'gemini-flash-lite-latest'));
  });

  it('retires cached answers when the system prompt changes', async () => {
    expect(await cacheKey('q', 'b1', 'm1', 'answer from passages'))
      .not.toBe(await cacheKey('q', 'b1', 'm1', 'answer differently'));
  });

  it('cannot collide across fields, because they are NUL-separated', async () => {
    expect(await cacheKey('q', 'a', 'b:c')).not.toBe(await cacheKey('q', 'a:b', 'c'));
  });
});

// --- quota protection -------------------------------------------------------

describe('rate limiting', () => {
  it('refills one token per interval and never exceeds the burst', () => {
    const start = 1_000_000;
    expect(refill({ tokens: 0, updatedAt: start }, start + 45_000).tokens).toBe(1);
    expect(refill({ tokens: 0, updatedAt: start }, start + 44_999).tokens).toBe(0);
    expect(refill({ tokens: 7, updatedAt: start }, start + 10 * 45_000).tokens).toBe(PER_IP_BURST);
  });

  it('does not lose fractional time between refills', () => {
    const start = 1_000_000;
    const once = refill({ tokens: 0, updatedAt: start }, start + 60_000);
    expect(once.tokens).toBe(1);
    // The unused 15s carries forward, so the second token lands at 90s, not 105s.
    expect(refill(once, start + 89_000).tokens).toBe(1);
    expect(refill(once, start + 90_000).tokens).toBe(2);
  });

  it('spends the burst then refuses', async () => {
    const kv = fakeKv();
    const now = 1_000_000;
    for (let i = 0; i < PER_IP_BURST; i += 1) {
      expect((await takeToken(kv, 'ip', now)).allowed).toBe(true);
    }
    expect(await takeToken(kv, 'ip', now)).toEqual({ allowed: false, reason: 'rate_limit' });
  });

  it('allows everything when no store is bound', async () => {
    expect((await takeToken(null, 'ip', Date.now())).allowed).toBe(true);
  });
});

describe('daily ceiling', () => {
  it('stops calling the model once the ceiling is reached', async () => {
    const kv = fakeKv();
    const now = Date.UTC(2026, 7, 21, 12);
    const key = `daily:${new Date(now).toISOString().slice(0, 10)}`;

    await kv.put(key, String(DAILY_CEILING - 1));
    expect(await withinDailyCeiling(kv, now)).toBe(true);

    await kv.put(key, String(DAILY_CEILING));
    expect(await withinDailyCeiling(kv, now)).toBe(false);
  });

  it('counts each day separately', async () => {
    const kv = fakeKv();
    const today = Date.UTC(2026, 7, 21, 12);
    await kv.put(`daily:${new Date(today).toISOString().slice(0, 10)}`, String(DAILY_CEILING));
    expect(await withinDailyCeiling(kv, Date.UTC(2026, 7, 22, 12))).toBe(true);
  });
});

// --- handler ----------------------------------------------------------------

describe('POST /api/ask', () => {
  it('returns a cited answer with its sources', async () => {
    modelMock.answer.mockResolvedValue({ text: 'Install qemu-system-aarch64 and launch it [1].' });
    const payload = await (await ask('how do I run tail os on qemu')).json();

    expect(payload.status).toBe('answered');
    expect(payload.citations).toEqual([
      expect.objectContaining({ n: 1, docSlug: 'qemu', anchor: 'run-tailos' }),
    ]);
  });

  it('discards an uncited answer instead of showing it', async () => {
    modelMock.answer.mockResolvedValue({ text: 'Just run make qemu, it always works.' });
    const payload = await (await ask('how do I run tail os on qemu')).json();

    expect(payload.status).toBe('degraded');
    expect(payload.answer).toBeUndefined();
    expect(payload.results.length).toBeGreaterThan(0);
  });

  it('discards an answer citing a passage it was never given', async () => {
    modelMock.answer.mockResolvedValue({ text: 'The scheduler is preemptive [9].' });
    expect((await (await ask('qemu')).json()).status).toBe('degraded');
  });

  it('reports an honest refusal, with what is covered', async () => {
    modelMock.answer.mockResolvedValue({ text: 'NO_ANSWER_IN_DOCS' });
    const payload = await (await ask('how does IPC message passing work in qemu')).json();

    expect(payload.status).toBe('unsupported');
    expect(payload.coverage).toEqual(CORPUS.coverage);
  });

  it('is unsupported, not an error, when nothing matches', async () => {
    const payload = await (await ask('zzzz quantum entanglement teapot')).json();
    expect(payload.status).toBe('unsupported');
    expect(modelMock.answer).not.toHaveBeenCalled();
  });

  it('degrades to results when the provider is out of quota', async () => {
    modelMock.answer.mockRejectedValue(new ModelError('quota', 'quota'));
    const payload = await (await ask('qemu boot')).json();

    expect(payload.status).toBe('degraded');
    expect(payload.results.length).toBeGreaterThan(0);
  });

  it('degrades to results when the provider is unreachable', async () => {
    modelMock.answer.mockRejectedValue(new ModelError('socket hang up', 'unavailable'));
    expect((await (await ask('qemu boot')).json()).status).toBe('degraded');
  });

  it('serves a repeated question from cache without calling the model again', async () => {
    const env = { ANSWER_CACHE: fakeKv() };
    modelMock.answer.mockResolvedValue({ text: 'Launch it with one command [1].' });

    expect((await (await ask('how do I run qemu', env)).json()).status).toBe('answered');
    expect((await (await ask('How do I run QEMU?', env)).json()).status).toBe('answered');
    expect(modelMock.answer).toHaveBeenCalledTimes(1);
  });

  it('degrades once a single visitor exhausts their burst', async () => {
    const env = { ANSWER_CACHE: fakeKv() };
    let call = 0;
    modelMock.answer.mockImplementation(async () => ({ text: `Boot it [1]. Call ${(call += 1)}.` }));

    const statuses = [];
    for (let i = 0; i < PER_IP_BURST + 2; i += 1) {
      statuses.push((await (await ask(`qemu question ${i}`, env)).json()).status);
    }
    expect(statuses.slice(0, PER_IP_BURST)).toEqual(Array(PER_IP_BURST).fill('answered'));
    expect(statuses.at(-1)).toBe('degraded');
  });

  it('rejects a missing or malformed question', async () => {
    expect((await ask('   ')).status).toBe(400);
    const bad = await onRequestPost({
      request: new Request('https://tail-os.com/api/ask', { method: 'POST', body: 'not json' }),
      env: {},
    });
    expect(bad.status).toBe(400);
  });
});
