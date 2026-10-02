import { describe, expect, it } from 'vitest';
import { parseAnswer } from './answer-format.js';

const flat = (block) => block.pieces.map((p) => p.text ?? `[${p.n}]`).join('');

describe('parseAnswer', () => {
  it('separates prose paragraphs', () => {
    const blocks = parseAnswer('First line [1].\n\nSecond line [2].');
    expect(blocks.map((b) => b.type)).toEqual(['para', 'para']);
    expect(flat(blocks[1])).toBe('Second line [2].');
  });

  it('keeps a fenced command whole, with its line breaks', () => {
    const blocks = parseAnswer('Run this [1]:\n\n```bash\nsudo apt install -y qemu-utils\ncurl -sSL x | bash\n```\n\nDone [1].');
    expect(blocks.map((b) => b.type)).toEqual(['para', 'code', 'para']);
    expect(blocks[1].text).toBe('sudo apt install -y qemu-utils\ncurl -sSL x | bash');
  });

  it('extracts citation markers as their own pieces', () => {
    const [block] = parseAnswer('Install it [1] and boot [12].');
    expect(block.pieces.filter((p) => p.type === 'cite').map((p) => p.n)).toEqual([1, 12]);
  });

  it('reads a grouped marker as one citation per passage', () => {
    // A claim resting on two passages is cited as one bracket holding both.
    // Counting that as zero discarded correctly sourced answers.
    const cites = (text) => parseAnswer(text)[0].pieces
      .filter((piece) => piece.type === 'cite').map((piece) => piece.n);
    expect(cites('Both lanes carry safety data [1, 2].')).toEqual([1, 2]);
    expect(cites('Three of them [1,2,6].')).toEqual([1, 2, 6]);
    expect(cites('Mixed [3] and grouped [4, 5].')).toEqual([3, 4, 5]);
  });

  it('keeps the prose around a grouped marker intact', () => {
    const [block] = parseAnswer('Install QEMU [1, 2] before booting.');
    expect(flat(block)).toBe('Install QEMU [1][2] before booting.');
  });

  it('leaves a bracket that is not a citation as text', () => {
    const cites = (text) => parseAnswer(text)[0].pieces
      .filter((piece) => piece.type === 'cite').map((piece) => piece.n);
    expect(cites('An array [1 2] is not a citation.')).toEqual([]);
    expect(cites('Nor is [] or [a, b].')).toEqual([]);
  });

  it('does not mistake a bracket inside inline code for a citation', () => {
    const [block] = parseAnswer('Use `array[1]` carefully [2].');
    expect(block.pieces.find((p) => p.type === 'code').text).toBe('array[1]');
    expect(block.pieces.filter((p) => p.type === 'cite').map((p) => p.n)).toEqual([2]);
  });

  it('treats markup in model output as literal text, never as structure', () => {
    const [block] = parseAnswer('<script>alert(1)</script> and <img src=x onerror=y> [1].');
    const literal = block.pieces.filter((p) => p.type === 'text').map((p) => p.text).join('');
    expect(literal).toContain('<script>alert(1)</script>');
    expect(literal).toContain('<img src=x onerror=y>');
    expect(block.pieces.every((p) => ['text', 'code', 'cite'].includes(p.type))).toBe(true);
  });

  it('reads **bold** as emphasis rather than literal asterisks', () => {
    const [block] = parseAnswer('Quit with **Ctrl-A, then lowercase x** [1].');
    expect(block.pieces).toEqual([
      { type: 'text', text: 'Quit with ' },
      { type: 'strong', text: 'Ctrl-A, then lowercase x' },
      { type: 'text', text: ' ' },
      { type: 'cite', n: 1 },
      { type: 'text', text: '.' },
    ]);
  });

  it('still counts a citation written inside bold', () => {
    // The citation gate counts these pieces; emphasis must not hide a marker.
    const [block] = parseAnswer('**Uppercase X does nothing [2]**');
    expect(block.pieces).toEqual([
      { type: 'strong', text: 'Uppercase X does nothing ' },
      { type: 'cite', n: 2 },
    ]);
  });

  it('leaves unpaired asterisks as text', () => {
    const [block] = parseAnswer('Globs like ** match deeply [1].');
    expect(block.pieces.some((p) => p.type === 'strong')).toBe(false);
    expect(flat(block)).toBe('Globs like ** match deeply [1].');
  });

  it('keeps asterisks inside code as code', () => {
    const blocks = parseAnswer('Run `ls **/*.rs` [1].\n\n```\necho **x**\n```');
    expect(blocks[0].pieces.find((p) => p.type === 'code').text).toBe('ls **/*.rs');
    expect(blocks[0].pieces.some((p) => p.type === 'strong')).toBe(false);
    expect(blocks[1]).toEqual({ type: 'code', text: 'echo **x**' });
  });

  it('drops an empty fence rather than emitting a blank block', () => {
    expect(parseAnswer('Text [1].\n\n```\n```\n')).toHaveLength(1);
  });

  it('returns nothing for empty input', () => {
    expect(parseAnswer('')).toEqual([]);
    expect(parseAnswer(null)).toEqual([]);
  });
});
