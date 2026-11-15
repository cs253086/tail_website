// Copy buttons for code blocks.
//
// Progressive enhancement: every <pre> on the page gets a button when this runs,
// and a page without JavaScript shows its blocks exactly as before. Like the
// answer view, everything here is built with createElement, so a button added to
// model output cannot carry markup from it.

import { textToCopy } from './copy-text.js';

const COPY = [
  'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z',
  'M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2',
];
const DONE = ['M20 6 9 17l-5-5'];

const glyph = (paths) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
};

// `pre` must already have a parent: the button sits in a wrapper that takes the
// block's place, so it stays in the corner while wide code scrolls sideways.
export function addCopyButton(pre) {
  const wrap = document.createElement('div');
  wrap.className = 'code-block';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy';
  const status = document.createElement('span');
  status.className = 'visually-hidden';
  status.setAttribute('aria-live', 'polite');

  let reset;
  const show = (label, paths, state, announcement = '') => {
    button.replaceChildren(glyph(paths));
    button.setAttribute('aria-label', label);
    button.title = label;
    button.dataset.state = state;
    status.textContent = announcement;
  };
  const idle = () => show('Copy code', COPY, 'idle');
  idle();

  button.addEventListener('click', async () => {
    clearTimeout(reset);
    try {
      await navigator.clipboard.writeText(textToCopy(pre));
      show('Copied', DONE, 'done', 'Copied');
    } catch {
      // The clipboard can be refused (an insecure origin, a denied permission).
      // Selecting the code leaves the reader one keystroke from the same result.
      getSelection().selectAllChildren(pre);
      show('Selected: copy with your keyboard', COPY, 'selected', 'Code selected. Copy it with your keyboard.');
    }
    reset = setTimeout(idle, 2000);
  });

  pre.before(wrap);
  wrap.append(pre, button, status);
}

for (const pre of document.querySelectorAll('pre')) addCopyButton(pre);
