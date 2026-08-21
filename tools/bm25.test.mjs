import { describe, expect, it } from 'vitest';
import { buildIndex, search, tokenize } from './bm25.mjs';

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
