import { describe, expect, it } from 'vitest';
import { chunkMarkdown, slugify } from './chunk.mjs';

const options = { docSlug: 'guide', docTitle: 'Guide' };

describe('slugify', () => {
  it('matches the anchor style used for heading ids', () => {
    expect(slugify('Run TailOS (one command)')).toBe('run-tailos-one-command');
    expect(slugify('config.txt Reference')).toBe('configtxt-reference');
  });
});

describe('chunkMarkdown', () => {
  it('splits at headings and records the heading path', () => {
    const chunks = chunkMarkdown('# Guide\n\nIntro text.\n\n## Install\n\nRun the installer.\n', options);
    expect(chunks).toHaveLength(2);
    expect(chunks[1].headingPath).toEqual(['Guide', 'Install']);
    expect(chunks[1].anchor).toBe('install');
  });

  it('never treats a comment inside a fenced block as a heading', () => {
    const markdown = [
      '## Quick Start',
      '',
      '```bash',
      '# 1. Build TailOS and create the SD card image',
      'make sd-image',
      '# 2. Flash to SD card',
      'dd if=tailos_sd.img of=/dev/sdX',
      '```',
      '',
    ].join('\n');

    const chunks = chunkMarkdown(markdown, options);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].anchor).toBe('quick-start');
    expect(chunks[0].text).toContain('# 1. Build TailOS');
  });

  it('keeps a fenced block whole when a section is split for size', () => {
    const filler = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const markdown = `## Big\n\n${filler}\n\n\`\`\`bash\ncurl -sSL https://example.test/run.sh | bash\n\`\`\`\n\n${filler}\n`;
    const chunks = chunkMarkdown(markdown, options);

    expect(chunks.length).toBeGreaterThan(1);
    const withFence = chunks.filter((chunk) => chunk.text.includes('curl -sSL'));
    expect(withFence).toHaveLength(1);
    expect(withFence[0].text).toContain('```bash');
    expect(withFence[0].text).toContain('| bash');
  });

  it('gives every chunk a unique id', () => {
    const filler = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkMarkdown(`## Big\n\n${filler}\n`, options);
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(chunks.length);
  });

  it('exposes the heading path as its own field, separate from the body', () => {
    const chunks = chunkMarkdown('# Guide\n\n## Serial Console Wiring\n\nConnect the pins.\n', options);
    expect(chunks[0].heading).toBe('Guide Serial Console Wiring');
    expect(chunks[0].text).not.toContain('Serial Console Wiring');
  });

  it('drops heading-only sections that carry no retrievable text', () => {
    const chunks = chunkMarkdown('## Empty\n\n## Real\n\nBody.\n', options);
    expect(chunks.map((chunk) => chunk.anchor)).toEqual(['real']);
  });
});
