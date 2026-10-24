// HTML for every generated page. Two layouts: the home page (search hero, no
// sidebar) and the documentation shell (persistent section nav) used by /ask/
// and every /docs/ page.

import { buildNavTree } from './nav.mjs';

export function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MARK = `<svg class="mark" viewBox="0 0 32 32" width="22" height="22" fill="none" aria-hidden="true"><path d="M4 8h24M4 16h16M4 24h8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;

const SEARCH_GLYPH = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;

function head({ site, title, description, canonical, extraHead = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b1220" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="${esc(site.assets)}/img/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${esc(site.assets)}/css/style.css">
<script type="module" src="${esc(site.assets)}/js/copy.js"></script>
<script type="module" src="${esc(site.assets)}/js/reveal.js"></script>
${extraHead}</head>`;
}

function header({ site, search = true }) {
  const searchBox = search
    ? `<form class="hdr-search" action="/ask/" method="get" role="search">
      ${SEARCH_GLYPH}
      <input type="search" name="q" placeholder="Search or ask a question" aria-label="Search or ask a question" autocomplete="off">
    </form>`
    : '';
  return `<header class="hdr">
  <div class="hdr-in">
    <a class="brand" href="/">${MARK}<span>TAIL OS</span><span class="ver">${esc(site.version)}</span></a>
    ${searchBox}
    <nav class="hdr-nav" aria-label="Primary">
      <a href="/docs/">Docs</a>
      <a href="/robots/">Robots</a>
    </nav>
  </div>
</header>`;
}

function navNodes(nodes, activeSlug) {
  return nodes.map((node) => {
    if (node.type === 'group') {
      // A group names a part of the documentation. It is not a page, so it is
      // not a link.
      return `<li class="nav-group">
      <span class="nav-label">${esc(node.label)}</span>
      <ul class="nav-list">
        ${navNodes(node.children, activeSlug)}
      </ul>
    </li>`;
    }

    const { doc } = node;
    const isActive = doc.slug === activeSlug;
    // Only the page being read lists its sections. Every document's sections at
    // once was already a long sidebar at four documents; grouped, it would bury
    // the groups under headings from pages nobody has opened.
    const sections = isActive && doc.sections.length
      ? `
      <ul class="nav-sections">
        ${doc.sections.map((section) => `<li><a href="/docs/${esc(doc.slug)}/#${esc(section.anchor)}">${esc(section.title)}</a></li>`).join('\n        ')}
      </ul>`
      : '';
    return `<li class="nav-page">
      <a class="nav-link" href="/docs/${esc(doc.slug)}/"${isActive ? ' aria-current="page"' : ''}>${esc(doc.navTitle ?? doc.title)}</a>${sections}
    </li>`;
  }).join('\n    ');
}

function sidebar({ docs, activeSlug }) {
  return `<aside class="side">
  <nav aria-label="Documentation">
    <ul class="nav-docs">
    ${navNodes(buildNavTree(docs), activeSlug)}
    </ul>
  </nav>
</aside>`;
}

// Cloudflare Pages `_redirects`. Each alias is listed with and without its
// trailing slash, because a citation copied from a source file can lose it.
export function renderRedirects(docs) {
  return docs
    .filter((doc) => doc.alias)
    .flatMap((doc) => [doc.alias, doc.alias.slice(0, -1)].map((from) => `${from} /docs/${doc.slug}/ 301`))
    .map((line) => `${line}\n`)
    .join('');
}

function footer({ site }) {
  return `<footer class="ftr">
  <span>TAIL OS &mdash; real-time OS in Rust</span>
  <span class="ftr-sep">/</span>
  <span class="mono">${esc(site.version)}</span>
</footer>`;
}

export function renderHome({ site, docs, questions, robots = [], home = {} }) {
  // Links, not submit buttons: a button named `q` inside a form whose input is
  // also named `q` submits both, and URLSearchParams.get() takes the first.
  const chips = questions.length
    ? `      <div class="chips">
        ${questions.map((q) => `<a class="chip" href="/ask/?q=${encodeURIComponent(q)}">${esc(q)}</a>`).join('\n        ')}
      </div>`
    : '';

  // Every front-page claim is uncited by nature, so it comes from config the
  // maintainer owns rather than from a literal in this file.
  const highlights = (home.highlights ?? []).length
    ? `  <section class="strip" aria-label="At a glance">
${(home.highlights ?? []).map((item) => `    <div class="stat"><span class="stat-n mono">${esc(item.value)}</span><span class="stat-l">${esc(item.label)}</span></div>`).join('\n')}
  </section>
`
    : '';

  const quickstart = home.quickstart
    ? `
  <section class="quick">
    <div class="quick-head">
      <h2>${esc(home.quickstart.title)}</h2>
      <a href="/docs/${esc(home.quickstart.doc)}/">Read the full guide</a>
    </div>
    <pre class="term" data-copy="${esc(home.quickstart.commands.join('\n'))}"><code>${home.quickstart.commands.map((line) => `<span class="pr">$</span> ${esc(line)}`).join('\n')}</code></pre>
    <p class="quick-note">${esc(home.quickstart.note)}</p>
  </section>
`
    : '';

  const cards = docs
    .map((doc) => `<a class="card" href="/docs/${esc(doc.slug)}/">
        <span class="card-t">${esc(doc.title)}</span>
        <span class="card-d">${esc(doc.summary)}</span>
      </a>`)
    .join('\n      ');

  return `${head({
    site,
    title: 'TAIL OS — real-time microkernel RTOS in Rust',
    description: 'Microkernel Real-Time RUST Robot Safety. Ask anything about TAIL OS.',
    canonical: `${site.origin}/`,
  })}
<body class="page-home">
${header({ site, search: false })}
<main>
  <section class="hero">
    <h1>TAIL OS</h1>
    <p class="lede"><strong class="kw-kernel">Microkernel</strong> <strong class="kw-realtime">Real-Time</strong> <strong class="kw-rust">RUST</strong> <strong class="kw-robot">Robot</strong> <strong class="kw-safety">Safety</strong></p>

    <form class="ask" action="/ask/" method="get" role="search">
      <label class="ask-field">
        ${SEARCH_GLYPH}
        <input type="search" name="q" placeholder="Ask anything about TAIL OS" aria-label="Ask a question about TAIL OS" autocomplete="off" autofocus>
      </label>
      <button class="ask-go" type="submit" aria-label="Ask">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </button>
${chips}
    </form>
  </section>

${highlights}${quickstart}
  <section class="docs-cards" aria-label="Documentation">
      ${cards}
  </section>
${robots.length ? '  <p class="robots-link"><a href="/robots/">Robots built on TAIL OS</a></p>\n' : ''}</main>
${footer({ site })}
</body>
</html>`;
}

function shell({ site, docs, title, description, canonical, activeSlug, main, extraHead = '', scripts = '' }) {
  return `${head({ site, title, description, canonical, extraHead })}
<body class="page-shell">
${header({ site })}
<div class="shell">
${sidebar({ docs, activeSlug })}
<main class="content">
${main}
</main>
</div>
${footer({ site })}
${scripts}
</body>
</html>`;
}

export function renderAsk({ site, docs, questions }) {
  const chips = questions.length
    ? `    <div class="chips">
      ${questions.map((q) => `<a class="chip" href="/ask/?q=${encodeURIComponent(q)}">${esc(q)}</a>`).join('\n      ')}
    </div>`
    : '';

  return shell({
    site,
    docs,
    title: 'Ask — TAIL OS',
    description: 'Ask a question about TAIL OS and get an answer cited from the documentation.',
    canonical: `${site.origin}/ask/`,
    activeSlug: null,
    // Answers are generated per request, so this route is deliberately excluded
    // from indexing; the documents it cites are what search engines should see.
    extraHead: '<meta name="robots" content="noindex">\n',
    main: `<div id="ask-root" class="ask-root" data-build="${esc(site.buildId)}">
  <noscript><p class="notice">Answering needs JavaScript. <a href="/docs/">Browse the documentation</a> instead.</p></noscript>
  <div class="ask-empty">
    <h1>What do you want to know?</h1>
    <p class="lede">Ask in your own words. Every answer cites the documentation it came from.</p>
${chips}
  </div>
</div>`,
    scripts: `<script type="module" src="${esc(site.assets)}/js/ask.js"></script>`,
  });
}

export function renderNotFound({ site, docs }) {
  return shell({
    site,
    docs,
    title: 'Not found — TAIL OS',
    description: 'That page does not exist.',
    canonical: `${site.origin}/404.html`,
    activeSlug: null,
    extraHead: '<meta name="robots" content="noindex">\n',
    main: `<article class="doc">
  <h1>That page does not exist.</h1>
  <p class="lede">The address may be out of date. Search from the bar above, or pick a document from the sidebar.</p>
  <ul class="idx">
    ${docs.map((doc) => `<li>
      <a class="idx-t" href="/docs/${esc(doc.slug)}/">${esc(doc.title)}</a>
      <p class="idx-d">${esc(doc.summary)}</p>
    </li>`).join('\n    ')}
  </ul>
</article>`,
  });
}

function indexNodes(nodes, depth) {
  return nodes.map((node) => {
    if (node.type === 'group') {
      const tag = depth === 0 ? 'h2' : 'h3';
      return `<li class="idx-group">
      <${tag} class="idx-g">${esc(node.label)}</${tag}>
      <ul class="idx">
        ${indexNodes(node.children, depth + 1)}
      </ul>
    </li>`;
    }
    return `<li>
      <a class="idx-t" href="/docs/${esc(node.doc.slug)}/">${esc(node.doc.title)}</a>
      <p class="idx-d">${esc(node.doc.summary)}</p>
    </li>`;
  }).join('\n    ');
}

export function renderDocsIndex({ site, docs }) {
  const tree = buildNavTree(docs);
  const items = indexNodes(tree, 0);
  // Derived from the hierarchy, so it cannot go stale when a document is added.
  const parts = tree.map((node) => (node.type === 'group' ? node.label : node.doc.title));

  return shell({
    site,
    docs,
    title: 'Documentation — TAIL OS',
    description: `TAIL OS documentation: ${parts.join(', ')}.`,
    canonical: `${site.origin}/docs/`,
    activeSlug: null,
    main: `<article class="doc">
  <h1>Documentation</h1>
  <p class="lede">Everything published here is generated from the TAIL OS repository.</p>
  <ul class="idx">
    ${items}
  </ul>
</article>`,
  });
}

// Robot store pages. Text comes from reviewed JSON and is escaped like everything
// else here. The layout follows the store's app-style pages: a banner, scrolling
// rows, one main action per robot, and hazards shown before the steps.
const LEVEL_LABEL = { low: 'Low risk', caution: 'Caution', hazard: 'Hazard' };
const ICON_CLASSES = ['icon-blue', 'icon-brown', 'icon-green', 'icon-violet'];

// A fixed colour per robot, from its slug, so it never changes between builds.
function iconClass(robot) {
  if (robot.color) return `icon-${robot.color}`;
  const sum = [...robot.slug].reduce((total, ch) => total + ch.charCodeAt(0), 0);
  return ICON_CLASSES[sum % ICON_CLASSES.length];
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((word) => word[0].toUpperCase()).join('');
}

// A robot's picture, from content/robots/images, or its initials on a colour
// when no picture is listed.
function thumbnail(robot, size = '') {
  if (robot.image) {
    return `<img class="robot-picture ${size}" src="/robots/images/${esc(robot.image)}" alt="" width="200" height="200" loading="lazy">`;
  }
  return `<span class="robot-icon ${size} ${iconClass(robot)}" aria-hidden="true">${esc(initials(robot.name))}</span>`;
}

function storeNav(active) {
  const links = [
    ['/', 'Home', 'home'],
    ['/robots/', 'Robots', 'robots'],
    ['/docs/', 'Docs', 'docs'],
    ['/ask/', 'Ask', 'ask'],
  ];
  return links
    .map(([href, label, key]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`)
    .join('');
}

// The store's page frame: the site header, the page, and a bottom bar on a phone.
// No documentation sidebar, so the store reads as its own app-style space.
function storeShell({ site, title, description, canonical, active, main }) {
  return `${head({ site, title, description, canonical })}
<body class="page-store">
${header({ site })}
<main class="store">
${main}
</main>
<nav class="store-tabs" aria-label="Sections">${storeNav(active)}</nav>
</body>
</html>`;
}

function robotCard(robot) {
  return `      <a class="robot-card" href="/robots/${esc(robot.slug)}/">
        ${thumbnail(robot)}
        <strong>${esc(robot.name)}</strong>
        <span class="robot-dev">${esc(robot.developer)}</span>
        <span class="robot-note">${esc(robot.summary)}</span>
        <span class="robot-get-sm">Get plans</span>
      </a>`;
}

function robotRow(title, robots) {
  const id = `row-${title.toLowerCase().replace(/\s+/g, '-')}`;
  return `  <section class="robot-row" aria-labelledby="${esc(id)}">
    <h2 id="${esc(id)}">${esc(title)}</h2>
    <div class="robot-scroll">
${robots.map(robotCard).join('\n')}
    </div>
  </section>`;
}

export function renderRobotsIndex({ site, robots }) {
  const categories = [...new Set(robots.map((robot) => robot.category))];
  const rows = robots.length
    ? [robotRow('Newest', [...robots].sort((a, b) => b.reviewed.localeCompare(a.reviewed)))]
        .concat(categories.map((category) => robotRow(category, robots.filter((robot) => robot.category === category))))
        .join('\n')
    : '  <p class="store-empty">No robots are listed yet.</p>';
  const featured = robots.find((robot) => robot.featured) ?? robots[0];
  const banner = featured
    ? `  <a class="store-banner" href="/robots/${esc(featured.slug)}/">
    <span class="kicker">Featured</span>
    <strong>${esc(featured.name)}</strong>
    <span>${esc(featured.summary)}</span>
  </a>`
    : `  <div class="store-banner">
    <span class="kicker">Robots built on TAIL OS</span>
    <strong>Build a robot with the instructions</strong>
    <span>Each robot lists its parts, its safety notes and its build steps.</span>
  </div>`;
  return storeShell({
    site,
    title: 'Robots built on TAIL OS — TAIL OS',
    description: 'Robots built on TAIL OS, each with its parts list, safety notes and build steps.',
    canonical: `${site.origin}/robots/`,
    active: 'robots',
    main: `${banner}
${rows}`,
  });
}

export function renderRobotPage({ site, robot }) {
  const safety = robot.safety.length
    ? `  <section class="robot-safety" aria-labelledby="safety">
    <h2 id="safety">Safety</h2>
    <ul>
${robot.safety.map((item) => `      <li data-level="${esc(item.level)}"><strong>${esc(LEVEL_LABEL[item.level])}</strong> ${esc(item.text)}</li>`).join('\n')}
    </ul>
  </section>`
    : '';
  const photos = (robot.photos ?? [])
    .map((src) => `    <img src="${esc(src)}" alt="${esc(robot.name)}" loading="lazy">`)
    .join('\n');
  const facts = [
    `Developer: ${robot.developer}`,
    `Category: ${robot.category}`,
    `Tested on: ${robot.board}`,
    `TAIL OS ${robot.tailosVersion} or later`,
    robot.buildMinutes ? `About ${robot.buildMinutes} minutes` : null,
  ].filter(Boolean).map((fact) => `<li>${esc(fact)}</li>`).join('');
  const needs = robot.needs
    .map((need) => `      <li><span>${esc(need.item)}</span><b>${esc(need.spec)}</b></li>`)
    .join('\n');
  const steps = robot.steps
    .map((step) => `      <li><h3>${esc(step.title)}</h3><p>${esc(step.body)}</p></li>`)
    .join('\n');
  return storeShell({
    site,
    title: `${robot.name} — Robots — TAIL OS`,
    description: robot.summary,
    canonical: `${site.origin}/robots/${robot.slug}/`,
    active: 'robots',
    main: `<article class="robot-page">
  <header class="robot-hero">
    ${thumbnail(robot, 'robot-icon-lg')}
    <div>
      <h1>${esc(robot.name)}</h1>
      <p class="robot-dev">${esc(robot.developer)}</p>
      <ul class="robot-facts">${facts}</ul>
      <div class="robot-actions"><a class="robot-get" href="#steps">Get the plans</a></div>
    </div>
  </header>
${photos ? `  <div class="robot-photos">\n${photos}\n  </div>` : ''}
  <section class="robot-block" aria-labelledby="about">
    <h2 id="about">About</h2>
    <p>${esc(robot.summary)}</p>
  </section>
${safety}
  <section class="robot-block robot-needs" aria-labelledby="needs">
    <h2 id="needs">What you need</h2>
    <ul>
${needs}
    </ul>
  </section>
  <section class="robot-block robot-steps" id="steps" aria-labelledby="steps-title">
    <h2 id="steps-title">Build steps</h2>
    <ol>
${steps}
    </ol>
  </section>
  <p class="robot-reviewed">Safety notes reviewed on ${esc(robot.reviewed)}. Example listing where marked.</p>
</article>`,
  });
}

export function renderDoc({ site, docs, doc, html }) {
  const onThisPage = doc.sections.length
    ? `<nav class="toc" aria-label="On this page">
  <span class="toc-h">On this page</span>
  <ul>
    ${doc.sections.map((s) => `<li><a href="#${esc(s.anchor)}">${esc(s.title)}</a></li>`).join('\n    ')}
  </ul>
</nav>`
    : '';

  return shell({
    site,
    docs,
    title: `${doc.title} — TAIL OS`,
    description: doc.summary,
    canonical: `${site.origin}/docs/${doc.slug}/`,
    activeSlug: doc.slug,
    main: `<div class="doc-wrap">
<article class="doc">
${html}
<footer class="doc-src">
  <span>Generated from <span class="mono">${esc(doc.path)}</span> in the TAIL OS repository.</span>
</footer>
</article>
${onThisPage}
</div>`,
  });
}
