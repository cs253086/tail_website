// answer() had no direct coverage: ask.test.js mocks this module out entirely,
// so the response-shape handling below was exercised only against the live API.
// A thinking model shipped truncated answers to the page because of that gap.

import { describe, expect, it, vi } from 'vitest';
import { validateAnswer } from './_citations.js';
import { DEFAULT_MODEL, ModelError, RESPONSE_SCHEMA, answer } from './_model.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

const candidate = (text, finishReason = 'STOP') => ({
  candidates: [{ finishReason, content: { parts: [{ text }] } }],
});

// A reply in the response schema: blocks of [kind, text, sources].
const reply = (...blocks) => candidate(JSON.stringify({
  refused: false,
  blocks: blocks.map(([kind, text, sources]) => ({ kind, text, sources })),
}));

const call = (body, overrides = {}) => answer({
  question: 'How do I run TAIL OS on QEMU?',
  passages: [{ n: 1, text: 'Install qemu-system-aarch64.' }],
  apiKey: 'test-key',
  fetchImpl: vi.fn(async () => ok(body)),
  ...overrides,
});

describe('answer', () => {
  it('returns the text of a generation that finished normally', async () => {
    await expect(call(reply(['prose', 'Install QEMU.', [1]]))).resolves.toEqual({ text: 'Install QEMU [1].' });
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
    const text = JSON.stringify({ refused: false, blocks: [{ kind: 'prose', text: 'Install QEMU.', sources: [1] }] });
    await expect(call({ candidates: [{ content: { parts: [{ text }] } }] }))
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
    const fetchImpl = vi.fn(async () => ok(reply(['prose', 'ok', [1]])));
    await call({}, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toContain(`/${DEFAULT_MODEL}:generateContent`);
  });

  it('asks for the response schema, in which a paragraph cannot lack a source', async () => {
    const fetchImpl = vi.fn(async () => ok(reply(['prose', 'ok', [1]])));
    await call({}, { fetchImpl });
    const { generationConfig } = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(generationConfig.responseMimeType).toBe('application/json');
    expect(generationConfig.responseSchema).toEqual(RESPONSE_SCHEMA);
    expect(RESPONSE_SCHEMA.properties.blocks.items.properties.sources.minItems).toBe(1);
  });
});

describe('answer text from a structured reply', () => {
  const text = async (body) => (await call(body)).text;

  it('places the citation before the final punctuation, sources merged once each', async () => {
    expect(await text(reply(['prose', 'Boot takes a few seconds.', [3, 1, 3]]))).toBe('Boot takes a few seconds [3, 1].');
    expect(await text(reply(['prose', 'It needs no network', [2]]))).toBe('It needs no network [2]');
  });

  it('drops a marker the model also wrote into the text, so sources is the only record', async () => {
    expect(await text(reply(['prose', 'Under QEMU the log shows four messages [4]:', [4]])))
      .toBe('Under QEMU the log shows four messages [4]:');
    expect(await text(reply(['prose', 'Install QEMU [1] first.', [2]]))).toBe('Install QEMU first [2].');
  });

  it('keeps a bracket inside inline code, and bold', async () => {
    expect(await text(reply(['prose', 'Index with `array[1]` and press **Ctrl-A, then lowercase x**.', [2]])))
      .toBe('Index with `array[1]` and press **Ctrl-A, then lowercase x** [2].');
  });

  it('fences a code block and writes no citation into it', async () => {
    expect(await text(reply(
      ['prose', 'Flash the card:', [2]],
      ['code', 'sudo dd if=tailos_sd.img of=/dev/sdX bs=4M status=progress\nsync\n', [2]],
    ))).toBe('Flash the card [2]:\n\n```\nsudo dd if=tailos_sd.img of=/dev/sdX bs=4M status=progress\nsync\n```');
  });

  it('produces text the citation gate accepts', async () => {
    const body = reply(['prose', 'The shell is /rfs/tsh.', [2]], ['code', 'which tsh', [2]]);
    expect(validateAnswer(await text(body), 3)).toEqual({ ok: true, used: [2] });
  });

  it('turns a refusal into the refusal token the handler already recognises', async () => {
    expect(await text(candidate(JSON.stringify({ refused: true, blocks: [] })))).toBe('NO_ANSWER_IN_DOCS');
  });

  it.each([
    ['text that is not JSON', 'Install QEMU [1].'],
    ['a paragraph without sources', JSON.stringify({ refused: false, blocks: [{ kind: 'prose', text: 'x', sources: [] }] })],
    ['an unknown block kind', JSON.stringify({ refused: false, blocks: [{ kind: 'list', text: 'x', sources: [1] }] })],
    ['a source that is not a number', JSON.stringify({ refused: false, blocks: [{ kind: 'prose', text: 'x', sources: ['1'] }] })],
    ['no refused flag', JSON.stringify({ blocks: [] })],
  ])('treats %s as a provider failure', async (_name, body) => {
    await expect(call(candidate(body))).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('rejects a reply with no blocks that is not a refusal', async () => {
    await expect(call(candidate(JSON.stringify({ refused: false, blocks: [] })))).rejects.toThrow(/no text/);
  });
});
