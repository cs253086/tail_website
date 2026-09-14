// Answer view for /ask/?q=...
//
// Model output is never assigned to innerHTML. Every fragment below is built
// with createElement and textContent, so a crafted answer cannot introduce
// markup, links, or script into this page.

import { parseAnswer } from './answer-format.js';
import { search } from './bm25.js';

const root = document.getElementById('ask-root');
const headerInput = document.querySelector('.hdr-search input');

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const icon = (paths, size = 16) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
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

const sourceHref = (source) =>
  `/docs/${encodeURIComponent(source.docSlug)}/${source.anchor ? `#${encodeURIComponent(source.anchor)}` : ''}`;

const pathLabel = (source) =>
  Array.isArray(source.headingPath) && source.headingPath.length
    ? source.headingPath.join(' › ')
    : source.docTitle;

// --- answer text ------------------------------------------------------------

function citeNode(n, citations) {
  const source = citations.find((candidate) => candidate.n === n);
  if (!source) return document.createTextNode(`[${n}]`);
  const link = el('a', 'cite', String(n));
  link.href = sourceHref(source);
  link.title = pathLabel(source);
  return link;
}

function renderAnswer(text, citations) {
  const container = el('div', 'ans');

  for (const block of parseAnswer(text)) {
    if (block.type === 'code') {
      const pre = el('pre');
      pre.append(el('code', null, block.text));
      container.append(pre);
      continue;
    }
    const paragraph = el('p');
    for (const piece of block.pieces) {
      if (piece.type === 'code') paragraph.append(el('code', null, piece.text));
      else if (piece.type === 'cite') paragraph.append(citeNode(piece.n, citations));
      else paragraph.append(document.createTextNode(piece.text));
    }
    container.append(paragraph);
  }

  return container;
}

// --- panels -----------------------------------------------------------------

function renderSources(citations) {
  const panel = el('div', 'srcs');
  panel.append(el('span', 'srcs-h', 'Sources'));
  for (const source of citations) {
    const card = document.createElement('a');
    card.className = 'src';
    card.href = sourceHref(source);
    const top = el('div', 'src-top');
    top.append(el('span', 'src-n', String(source.n)), el('span', 'src-t', source.docTitle));
    card.append(top, el('span', 'src-p', pathLabel(source)));
    panel.append(card);
  }
  return panel;
}

function renderResults(results, heading) {
  const panel = el('div', 'srcs');
  panel.append(el('span', 'srcs-h', heading));
  for (const result of results) {
    const card = document.createElement('a');
    card.className = 'src';
    card.href = sourceHref(result);
    card.append(el('span', 'src-t', result.docTitle), el('span', 'src-p', pathLabel(result)));
    panel.append(card);
  }
  return panel;
}

function renderNotice(title, body, coverage) {
  const notice = el('div', 'notice');
  const head = el('div', 'notice-h');
  head.append(
    icon(['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'], 18),
    el('span', null, title),
  );
  notice.append(head, el('p', null, body));

  if (coverage?.length) {
    const list = el('div', 'covers');
    list.append(el('span', 'srcs-h', 'What is covered right now'));
    for (const entry of coverage) {
      const link = document.createElement('a');
      link.href = `/docs/${encodeURIComponent(entry.slug)}/`;
      link.textContent = entry.title;
      list.append(link);
    }
    notice.append(list);
  }
  return notice;
}

// --- page -------------------------------------------------------------------

function paint(question, build) {
  root.replaceChildren();
  root.append(el('h1', 'q', question));
  build(root);
}

function waiting(question) {
  paint(question, (target) => {
    const label = el('div', 'ans-label');
    label.append(el('span', 'dot is-wait'), el('span', null, 'Searching the documentation'));
    target.append(label);
  });
}

function showAnswer(question, payload) {
  paint(question, (target) => {
    const layout = el('div', 'ans-layout');
    const left = el('div');

    if (payload.status === 'answered') {
      const label = el('div', 'ans-label');
      label.append(el('span', 'dot'), el('span', null, 'Answer'));
      left.append(label, renderAnswer(payload.answer, payload.citations ?? []));

      const note = el('div', 'ans-note');
      note.append(
        icon(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 16v-4', 'M12 8h.01'], 14),
        el('span', null, 'Generated from the documentation cited here. Every claim carries a source.'),
      );
      left.append(note);
    } else if (payload.status === 'unsupported') {
      left.append(renderNotice(
        'That is not in the published documentation yet.',
        payload.reason
          ?? 'I answer only from the documents published on this site, and I will not guess at anything outside them.',
        payload.coverage,
      ));
    } else {
      left.append(renderNotice(
        'Answering is unavailable right now.',
        payload.reason ?? 'The daily limit for generated answers has been reached. Keyword results are below.',
        null,
      ));
    }

    layout.append(left);
    if (payload.status === 'answered' && payload.citations?.length) {
      layout.append(renderSources(payload.citations));
    } else if (payload.results?.length) {
      layout.append(renderResults(payload.results, 'Closest sections'));
    }
    target.append(layout);
  });
}

// When the endpoint itself is unreachable, the browser can still search the
// index it already downloaded. Degraded, but never a dead end.
async function localFallback(question) {
  const build = root?.dataset.build ?? '';
  const response = await fetch(`/search-index.json?v=${encodeURIComponent(build)}`);
  const data = await response.json();
  const byId = new Map(data.chunks.map((chunk) => [chunk.id, chunk]));
  const results = search(data.index, question, 6)
    .map((hit) => byId.get(hit.id))
    .filter(Boolean);
  showAnswer(question, {
    status: 'degraded',
    reason: 'The answering service could not be reached, so these are keyword matches from the documentation.',
    results,
  });
}

async function run() {
  const question = (new URLSearchParams(location.search).get('q') ?? '').trim().slice(0, 500);
  if (!question) return;

  if (headerInput) headerInput.value = question;
  document.title = `${question} — TAIL OS`;
  waiting(question);

  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    if (!response.ok) throw new Error(`ask failed: ${response.status}`);
    showAnswer(question, await response.json());
  } catch {
    try {
      await localFallback(question);
    } catch {
      showAnswer(question, {
        status: 'degraded',
        reason: 'The answering service could not be reached. Browse the documentation from the sidebar.',
        results: [],
      });
    }
  }
}

run();
