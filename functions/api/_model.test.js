// answer() had no direct coverage: ask.test.js mocks this module out entirely,
// so the response-shape handling below was exercised only against the live API.
// A thinking model shipped truncated answers to the page because of that gap.

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, ModelError, answer } from './_model.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

const candidate = (text, finishReason = 'STOP') => ({
  candidates: [{ finishReason, content: { parts: [{ text }] } }],
});

const call = (body, overrides = {}) => answer({
  question: 'How do I run TAIL OS on QEMU?',
  passages: [{ n: 1, text: 'Install qemu-system-aarch64.' }],
  apiKey: 'test-key',
  fetchImpl: vi.fn(async () => ok(body)),
  ...overrides,
});

describe('answer', () => {
  it('returns the text of a generation that finished normally', async () => {
    await expect(call(candidate('Install QEMU [1].'))).resolves.toEqual({ text: 'Install QEMU [1].' });
  });

  it('rejects a generation the provider truncated', async () => {
    // The exact failure that reached the page: a thinking model spent the
    // output budget on reasoning and the answer stopped mid-word.
    await expect(call(candidate('sudo apt install -y qemu-system-aarch6', 'MAX_TOKENS')))
      .rejects.toThrow(/stopped early: MAX_TOKENS/);
  });

  it('rejects a truncated generation even when a citation marker survived the cut', async () => {
    // Without this the fragment passes the citation gate in §5.3 and renders.
    await expect(call(candidate('First install QEMU [1]:\n\n```bash\nsudo apt inst', 'MAX_TOKENS')))
      .rejects.toThrow(ModelError);
  });

  it.each(['SAFETY', 'RECITATION', 'OTHER'])('rejects a %s finish', async (reason) => {
    await expect(call(candidate('partial', reason))).rejects.toThrow(/stopped early/);
  });

  it('accepts a response that omits finishReason, which is not a truncation signal', async () => {
    await expect(call({ candidates: [{ content: { parts: [{ text: 'Install QEMU [1].' }] } }] }))
      .resolves.toEqual({ text: 'Install QEMU [1].' });
  });

  it('reports an exhausted quota distinctly, so the handler can say so', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    await expect(call({}, { fetchImpl })).rejects.toMatchObject({ kind: 'quota' });
  });

  it('reports other provider failures as unavailable', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(call({}, { fetchImpl })).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('rejects an empty generation', async () => {
    await expect(call(candidate('   '))).rejects.toThrow(/no text/);
  });

  it('refuses to call the provider without a key', async () => {
    const fetchImpl = vi.fn();
    await expect(answer({ question: 'q', passages: [], apiKey: '', fetchImpl }))
      .rejects.toMatchObject({ kind: 'unconfigured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('defaults to a non-thinking model, so the output budget is not spent on reasoning', async () => {
    expect(DEFAULT_MODEL).toBe('gemini-flash-lite-latest');
    const fetchImpl = vi.fn(async () => ok(candidate('ok')));
    await call(candidate('ok'), { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toContain(`/${DEFAULT_MODEL}:generateContent`);
  });
});
