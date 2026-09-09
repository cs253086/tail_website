import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';

import { chunkMarkdown } from './chunk.mjs';
import { sectionsFrom } from './sections.mjs';

// Built the way the generator builds them, so the test exercises the same two
// parsers agreeing that production depends on.
function sections(markdown) {
  const { headings } = chunkMarkdown(markdown, { docSlug: 'doc', docTitle: 'Doc' });
  const tokens = new MarkdownIt({ html: false, linkify: true, typographer: false })
    .parse(markdown, {});
  return sectionsFrom(tokens, headings);
}

describe('sectionsFrom', () => {
  it('keeps the underscores in an identifier', () => {
    // The regression: `_` was stripped as an emphasis marker, so a heading
    // naming a key reached the navigation as `onoverrun`.
    expect(sections('# Doc\n\n## `on_overrun` — required\n\ntext\n'))
      .toEqual([{ title: 'on_overrun — required', anchor: 'on_overrun-required' }]);
  });

  it('keeps underscores that are not inside code either', () => {
    expect(sections('# Doc\n\n## stale_after\n\ntext\n')[0].title).toBe('stale_after');
  });

  it('drops the delimiters of a code span, which are not part of its text', () => {
    expect(sections('# Doc\n\n## `Cycle<T>`\n\ntext\n')[0].title).toBe('Cycle<T>');
  });

  it('drops emphasis markers, which are not text', () => {
    expect(sections('# Doc\n\n## *really* important\n\ntext\n')[0].title)
      .toBe('really important');
  });

  it('lists only navigation-level headings', () => {
    const markdown = '# Doc\n\n## Group\n\n### Entry\n\n#### Deeper\n\n## Other\n\ntext\n';
    expect(sections(markdown).map((section) => section.title)).toEqual(['Group', 'Other']);
  });

  it('pairs each title with the anchor allocated for that heading', () => {
    const markdown = '# Doc\n\n## Notes\n\na\n\n### Notes\n\nb\n\n## Notes\n\nc\n';
    // The chunker dedups identically-slugified headings; the nth heading_open
    // must take the nth allocation, not a re-slugified guess.
    expect(sections(markdown)).toEqual([
      { title: 'Notes', anchor: 'notes' },
      { title: 'Notes', anchor: 'notes-2' },
    ]);
  });

  it('skips a heading with no text rather than emitting an empty entry', () => {
    expect(sections('# Doc\n\n## ``\n\ntext\n')).toEqual([]);
  });
});
