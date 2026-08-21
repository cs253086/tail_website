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

  it('drops an empty fence rather than emitting a blank block', () => {
    expect(parseAnswer('Text [1].\n\n```\n```\n')).toHaveLength(1);
  });

  it('returns nothing for empty input', () => {
    expect(parseAnswer('')).toEqual([]);
    expect(parseAnswer(null)).toEqual([]);
  });
});
