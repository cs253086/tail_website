import { describe, expect, it } from 'vitest';
import { assertRedacted, compileRules, redact } from './redact.mjs';

const rules = () => compileRules([
  {
    label: 'tailos repository',
    pattern: 'https://github\\.com/cs253086/tailos[^\\s)"\'`<]*',
    replacement: '(private repository)',
  },
]);

describe('redact', () => {
  it('replaces a private URL wherever it appears and reports each hit', () => {
    const { text, hits } = redact('Clone https://github.com/cs253086/tailos.git today.', rules());
    expect(text).toBe('Clone (private repository) today.');
    expect(hits).toHaveLength(1);
    expect(hits[0].match).toBe('https://github.com/cs253086/tailos.git');
  });

  it('catches every occurrence, not only the first', () => {
    const source = 'a https://github.com/cs253086/tailos b https://github.com/cs253086/tailos.git c';
    const { hits } = redact(source, rules());
    expect(hits).toHaveLength(2);
  });

  it('reaches inside a fenced command, where a link rewriter would not', () => {
    const { text } = redact('```bash\ncurl -sSL https://github.com/cs253086/tailos/raw/main/x.sh | bash\n```', rules());
    expect(text).not.toContain('github.com');
  });

  it('stops at the closing delimiter of a markdown link', () => {
    const { text } = redact('[setup](https://github.com/cs253086/tailos/blob/main/x.md) next', rules());
    expect(text).toBe('[setup]((private repository)) next');
  });

  it('leaves unrelated URLs alone', () => {
    const source = 'See https://github.com/raspberrypi/firmware/tree/master/boot for details.';
    expect(redact(source, rules()).text).toBe(source);
  });

  it('is a no-op when no rules are configured', () => {
    expect(redact('https://github.com/cs253086/tailos', compileRules([])).hits).toEqual([]);
  });
});

describe('assertRedacted', () => {
  it('fails the build rather than publishing something that escaped', () => {
    expect(() => assertRedacted('<p>https://github.com/cs253086/tailos</p>', rules(), 'doc/a.md'))
      .toThrow(/redaction escaped into doc\/a\.md/);
  });

  it('passes clean output', () => {
    expect(() => assertRedacted('<p>nothing private here</p>', rules(), 'doc/a.md')).not.toThrow();
  });
});
