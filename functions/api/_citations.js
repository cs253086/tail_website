// Citations are enforced here, not requested politely in the prompt.
//
// A model can ignore an instruction; it cannot ignore this check. An answer
// with no citation, or one pointing outside the passages it was given, is
// discarded rather than shown — so a fabricated answer can never reach a
// reader wearing the appearance of a sourced one.

import { parseAnswer } from '../../assets/js/answer-format.js';

// Markers are counted from the same parse the browser renders, so a bracket
// inside `array[1]` or inside a fenced command is not a citation here either.
// Two definitions of "a citation" is how an uncited answer slips through
// wearing the appearance of a sourced one.
export function findMarkers(text) {
  return parseAnswer(text)
    .flatMap((block) => block.pieces ?? [])
    .filter((piece) => piece.type === 'cite')
    .map((piece) => piece.n);
}

export function validateAnswer(text, passageCount) {
  const body = String(text ?? '').trim();
  if (!body) return { ok: false, reason: 'empty' };

  const markers = findMarkers(body);
  if (markers.length === 0) return { ok: false, reason: 'uncited' };

  const outOfRange = markers.filter((n) => n < 1 || n > passageCount);
  if (outOfRange.length > 0) return { ok: false, reason: 'out_of_range' };

  // Order of first appearance, so the Sources panel reads top to bottom.
  const used = [];
  for (const n of markers) if (!used.includes(n)) used.push(n);
  return { ok: true, used };
}

// A refusal is a legitimate outcome, not a failure. The model is told to emit
// this exact token when the passages do not contain the answer.
export const REFUSAL_TOKEN = 'NO_ANSWER_IN_DOCS';

export function isRefusal(text) {
  return String(text ?? '').trim().toUpperCase().includes(REFUSAL_TOKEN);
}
