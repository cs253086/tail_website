// Turns model output into a render tree. Pure: no DOM, no globals.
//
// Splitting parsing from rendering is what makes the shape of an answer
// testable, and it keeps the renderer trivial enough to audit at a glance —
// it only ever sets textContent, so nothing here can become markup.

export function parseAnswer(text) {
  const blocks = [];
  // Fenced regions are separated first so their contents are never treated as
  // prose, and so a shell command keeps its line breaks.
  const segments = String(text ?? '').split(/```[a-zA-Z0-9_-]*\n?/);

  segments.forEach((segment, index) => {
    if (index % 2 === 1) {
      const code = segment.replace(/\n$/, '');
      if (code) blocks.push({ type: 'code', text: code });
      return;
    }
    for (const raw of segment.split(/\n{2,}/)) {
      const paragraph = raw.trim();
      if (!paragraph) continue;
      blocks.push({ type: 'para', pieces: parsePieces(paragraph) });
    }
  });

  return blocks;
}

function parsePieces(paragraph) {
  const pieces = [];
  for (const part of paragraph.split(/(`[^`\n]+`)/g)) {
    if (!part) continue;
    if (/^`[^`\n]+`$/.test(part)) {
      pieces.push({ type: 'code', text: part.slice(1, -1) });
      continue;
    }
    for (const piece of part.split(/(\[\d{1,2}\])/g)) {
      if (!piece) continue;
      const marker = /^\[(\d{1,2})\]$/.exec(piece);
      if (marker) pieces.push({ type: 'cite', n: Number(marker[1]) });
      else pieces.push({ type: 'text', text: piece });
    }
  }
  return pieces;
}
