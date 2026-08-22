// Splits a markdown document into retrieval units at heading boundaries.
//
// A chunk is what a citation points at, so every chunk carries the heading path
// that names it and the anchor that deep-links to it. Chunks are never split
// inside a fenced code block: half a shell command is worse than none.

const MAX_WORDS = 650;

// Two headings can slugify identically ("Notes" under two parents). Left alone
// that collides chunk ids — the Function's byId map silently drops one and a
// citation then points at the wrong passage — and emits duplicate HTML ids, so
// the deep link lands on the wrong section too. Anchors are allocated once, in
// document order, and every consumer uses that allocation.
export function makeAnchorAllocator() {
  const seen = new Map();
  return (text) => {
    const base = slugify(text);
    if (!base) return '';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function countWords(lines) {
  return lines.join(' ').split(/\s+/).filter(Boolean).length;
}

// Groups lines into blocks separated by blank lines, keeping fenced code whole
// so a split can never land inside one.
function toBlocks(lines) {
  const blocks = [];
  let current = [];
  let fence = null;

  for (const line of lines) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (line.trimStart().startsWith(fence.repeat(3))) fence = null;
      current.push(line);
      continue;
    }
    if (fence === null && line.trim() === '') {
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function splitSection(lines) {
  if (countWords(lines) <= MAX_WORDS) return [lines];

  const parts = [];
  let current = [];
  for (const block of toBlocks(lines)) {
    if (current.length && countWords([...current, ...block]) > MAX_WORDS) {
      parts.push(current);
      current = [];
    }
    if (current.length) current.push('');
    current.push(...block);
  }
  if (current.length) parts.push(current);
  return parts;
}

// Returns the chunks and, separately, every heading in document order with its
// allocated anchor. The generator assigns HTML ids from that same list, so a
// citation anchor and a heading id can never disagree.
export function chunkMarkdown(markdown, { docSlug, docTitle }) {
  const lines = String(markdown).split('\n');
  const allocate = makeAnchorAllocator();
  const headings = [];
  const sections = [];
  let headingStack = [];
  let currentHeading = null;
  let buffer = [];
  let fence = null;

  const flush = () => {
    if (!countWords(buffer)) {
      buffer = [];
      return;
    }
    sections.push({
      headingPath: currentHeading ? [...headingStack] : [docTitle],
      anchor: currentHeading ? currentHeading.anchor : '',
      lines: buffer,
    });
    buffer = [];
  };

  for (const line of lines) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (line.trimStart().startsWith(fence.repeat(3))) fence = null;
      buffer.push(line);
      continue;
    }

    const heading = fence === null ? /^(#{1,6})\s+(.*\S)\s*$/.exec(line) : null;
    if (heading) {
      flush();
      const level = heading[1].length;
      const text = heading[2].replace(/\s*#+\s*$/, '');
      headingStack = headingStack.slice(0, level - 1);
      headingStack[level - 1] = text;
      headingStack = headingStack.filter((entry) => entry !== undefined);
      currentHeading = { level, text, anchor: allocate(text) };
      headings.push(currentHeading);
      continue;
    }

    buffer.push(line);
  }
  flush();

  const chunks = [];
  for (const section of sections) {
    const parts = splitSection(section.lines);
    parts.forEach((part, partIndex) => {
      const text = part.join('\n').trim();
      if (!text) return;
      const headingPath = section.headingPath;
      chunks.push({
        id: `${docSlug}#${section.anchor || 'top'}:${partIndex}`,
        docSlug,
        docTitle,
        headingPath,
        anchor: section.anchor,
        text,
        // Indexed as a separate, more heavily weighted field than the body.
        heading: headingPath.join(' '),
      });
    });
  }
  return { chunks, headings };
}
