// The section list a document contributes to the site's navigation.
//
// Titles come from markdown-it's parsed inline tokens rather than a regex over
// the source. An earlier version stripped `*`, `_` and backticks from the raw
// heading to remove emphasis markers, which also ate them out of identifiers:
// a heading naming `on_overrun` reached the navigation as `onoverrun`. The
// parser already knows which underscore is emphasis and which is code, so
// asking it is the only way to be right without reimplementing that judgement.

const NAV_LEVEL = 'h2';

// `tokens` is markdown-it's token stream; `headings` is the chunker's list, in
// document order, carrying the anchor each heading was allocated. The caller
// asserts the two agree on heading count, so the nth `heading_open` and the nth
// entry describe the same heading.
export function sectionsFrom(tokens, headings) {
  const sections = [];
  let index = 0;

  for (const [position, token] of tokens.entries()) {
    if (token.type !== 'heading_open') continue;
    const anchor = headings[index]?.anchor;
    index += 1;
    if (token.tag !== NAV_LEVEL) continue;

    const title = (tokens[position + 1]?.children ?? [])
      .filter((child) => child.type === 'text' || child.type === 'code_inline')
      .map((child) => child.content)
      .join('')
      .trim();

    if (title && anchor) sections.push({ title, anchor });
  }

  return sections;
}
