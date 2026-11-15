// What a code block's copy button puts on the clipboard. Pure: no DOM, no globals.
//
// A block copies what it shows, less the newline markdown leaves after its last
// line. A block that shows more than should be pasted (a shell prompt, say)
// names the exact text in data-copy instead.

export function textToCopy(pre) {
  return pre.dataset.copy ?? pre.textContent.replace(/\n$/, '');
}
