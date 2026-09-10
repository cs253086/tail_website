import { describe, expect, it } from 'vitest';
import { buildIndex, search, stem, tokenize } from './bm25.mjs';

describe('stem', () => {
  it('collapses the forms a reader might type for one word', () => {
    // The reported failure: "installation" reached 2 chunks where
    // "installing" reached 22, because they were unrelated terms.
    const forms = ['install', 'installs', 'installed', 'installing', 'installation'];
    expect(new Set(forms.map(stem)).size).toBe(1);
  });

  it.each([
    ['caresses', 'caress'], ['ponies', 'poni'], ['cats', 'cat'], ['feed', 'feed'],
    ['agreed', 'agre'], ['plastered', 'plaster'], ['bled', 'bled'], ['motoring', 'motor'],
    ['sing', 'sing'], ['conflated', 'conflat'], ['sized', 'size'], ['hopping', 'hop'],
    ['falling', 'fall'], ['filing', 'file'], ['happy', 'happi'], ['sky', 'sky'],
    ['relational', 'relat'], ['rational', 'ration'], ['predication', 'predic'],
    ['operator', 'oper'], ['hopefulness', 'hope'], ['formality', 'formal'],
    ['electrical', 'electr'], ['goodness', 'good'], ['allowance', 'allow'],
    ['adjustable', 'adjust'], ['replacement', 'replac'], ['adoption', 'adopt'],
    ['effective', 'effect'], ['controlling', 'control'], ['rolling', 'roll'],
  ])('stems %s to %s, as Porter specifies', (word, expected) => {
    // Pinned against the published reference vocabulary, so a future edit that
    // quietly turns this into a bespoke suffix stripper fails here.
    expect(stem(word)).toBe(expected);
  });

  it('leaves anything that is not an English word alone', () => {
    for (const symbol of ['qemu-system-aarch64', 'on_overrun', 'v0.9.0', 'aarch64', 'os', 'ms']) {
      expect(stem(symbol)).toBe(symbol);
    }
  });
});

describe('tokenize with stemming', () => {
  it('emits one term for a word however the reader inflected it', () => {
    expect(tokenize('installation')).toEqual(tokenize('installing'));
  });

  it('still keeps an identifier exactly as written', () => {
    // Stripping a suffix from a symbol would leave it unfindable by its name.
    expect(tokenize('on_overrun')).toContain('on_overrun');
    expect(tokenize('qemu-system-aarch64')).toContain('qemu-system-aarch64');
  });
});

describe('tokenize', () => {
  it('keeps technical compounds whole and also indexes their parts', () => {
    const terms = tokenize('qemu-system-aarch64');
    expect(terms).toContain('qemu-system-aarch64');
    expect(terms).toContain('aarch64');
    expect(terms).toContain('qemu');
  });

  it('keeps version strings intact', () => {
    expect(tokenize('TAIL OS v0.9.0')).toContain('v0.9.0');
  });

  it('drops stopwords and single characters', () => {
    expect(tokenize('how do I run it')).toEqual(['run']);
  });

  it('strips trailing sentence punctuation without splitting the term', () => {
    expect(tokenize('install qemu-utils.')).toContain('qemu-utils');
  });
});

describe('search', () => {
  const index = buildIndex([
    { id: 'qemu', body: 'Install QEMU and boot the prebuilt image with one command.' },
    { id: 'rpi', body: 'Flash the SD card image and wire the serial console on Raspberry Pi 3.' },
    { id: 'build', body: 'Developer setup installs the cross compiler toolchain from source.' },
  ]);

  it('ranks the document that matches the query first', () => {
    expect(search(index, 'how do I boot under qemu')[0].id).toBe('qemu');
    expect(search(index, 'serial console wiring')[0].id).toBe('rpi');
  });

  it('returns nothing for a query with no indexed terms', () => {
    expect(search(index, 'quantum entanglement')).toEqual([]);
  });

  it('returns nothing for an empty query rather than every document', () => {
    expect(search(index, '   ')).toEqual([]);
  });

  it('honours the result limit', () => {
    expect(search(index, 'image source install', 2)).toHaveLength(2);
  });

  it('is deterministic for equal scores', () => {
    const a = search(index, 'image').map((hit) => hit.id);
    const b = search(index, 'image').map((hit) => hit.id);
    expect(a).toEqual(b);
  });
});

describe('field weighting', () => {
  const index = buildIndex([
    { id: 'titled', heading: 'Running TAIL OS in QEMU Run TailOS one command', body: 'Launch the prebuilt image.' },
    { id: 'passing', heading: 'Developing Applications 5. Run it', body: 'Run it and watch the output appear under QEMU.' },
  ]);

  it('prefers the section whose title matches the question over a passing mention', () => {
    expect(search(index, 'how do I run TAIL OS on QEMU')[0].id).toBe('titled');
  });
});

describe('product name spelling', () => {
  it('treats TailOS and TAIL OS as the same thing', () => {
    const index = buildIndex([
      { id: 'qemu', heading: 'Running TailOS in QEMU', body: 'Boot the prebuilt image.' },
      { id: 'other', heading: 'Developing Applications', body: 'Write an application.' },
    ]);
    expect(search(index, 'run TAIL OS under QEMU')[0].id).toBe('qemu');
    expect(search(index, 'run TailOS under QEMU')[0].id).toBe('qemu');
  });
});
