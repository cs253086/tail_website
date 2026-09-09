// HTML for every generated page. Two layouts: the home page (search hero, no
// sidebar) and the documentation shell (persistent section nav) used by /ask/
// and every /docs/ page.

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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${esc(site.assets)}/css/style.css">
${extraHead}</head>`;
}

function header({ site, compact }) {
  const searchBox = compact
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
    </nav>
  </div>
</header>`;
}

function sidebar({ docs, activeSlug }) {
  const groups = docs.map((doc) => {
    const isActive = doc.slug === activeSlug;
    const sections = doc.sections
      .map((section) => `<li><a href="/docs/${esc(doc.slug)}/#${esc(section.anchor)}">${esc(section.title)}</a></li>`)
      .join('\n        ');
    return `<li class="nav-group">
      <a class="nav-doc" href="/docs/${esc(doc.slug)}/"${isActive ? ' aria-current="page"' : ''}>${esc(doc.title)}</a>
      <ul class="nav-sections">
        ${sections}
      </ul>
    </li>`;
  }).join('\n    ');

  return `<aside class="side">
  <nav aria-label="Documentation">
    <ul class="nav-docs">
    ${groups}
    </ul>
  </nav>
</aside>`;
}

function footer({ site }) {
  return `<footer class="ftr">
  <span>TAIL OS &mdash; real-time microkernel in Rust</span>
  <span class="ftr-sep">/</span>
  <span class="mono">${esc(site.version)}</span>
</footer>`;
}

export function renderHome({ site, docs, questions, home = {} }) {
  // Links, not submit buttons: a button named `q` inside a form whose input is
  // also named `q` submits both, and URLSearchParams.get() takes the first.
  const chips = questions
    .map((q) => `<a class="chip" href="/ask/?q=${encodeURIComponent(q)}">${esc(q)}</a>`)
    .join('\n        ');

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
    <pre class="term"><code>${home.quickstart.commands.map((line) => `<span class="pr">$</span> ${esc(line)}`).join('\n')}</code></pre>
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
    description: 'TAIL OS is Real-Time & Microkernel, by RUST, for Robot & Safety. Ask anything about TAIL OS.',
    canonical: `${site.origin}/`,
  })}
<body class="page-home">
${header({ site, compact: false })}
<main>
  <section class="hero">
    <h1>Ask anything about TAIL OS</h1>
    <p class="lede">TAIL OS is <strong class="kw-realtime">Real-Time</strong> &amp; <strong class="kw-kernel">Microkernel</strong>, by <strong class="kw-rust">RUST</strong>, for <strong class="kw-robot">Robot</strong> &amp; <strong class="kw-safety">Safety</strong></p>

    <form class="ask" action="/ask/" method="get" role="search">
      <label class="ask-field">
        ${SEARCH_GLYPH}
        <input type="search" name="q" placeholder="How do I run TAIL OS on QEMU?" aria-label="Ask a question about TAIL OS" autocomplete="off" autofocus>
      </label>
      <button class="ask-go" type="submit" aria-label="Ask">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </button>
      <div class="chips">
        ${chips}
      </div>
    </form>
  </section>

${highlights}${quickstart}
  <section class="docs-cards" aria-label="Documentation">
      ${cards}
  </section>
</main>
${footer({ site })}
</body>
</html>`;
}

function shell({ site, docs, title, description, canonical, activeSlug, main, extraHead = '', scripts = '' }) {
  return `${head({ site, title, description, canonical, extraHead })}
<body class="page-shell">
${header({ site, compact: true })}
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
  const chips = questions
    .map((q) => `<a class="chip" href="/ask/?q=${encodeURIComponent(q)}">${esc(q)}</a>`)
    .join('\n      ');

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
    <div class="chips">
      ${chips}
    </div>
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

export function renderDocsIndex({ site, docs }) {
  const items = docs
    .map((doc) => `<li>
      <a class="idx-t" href="/docs/${esc(doc.slug)}/">${esc(doc.title)}</a>
      <p class="idx-d">${esc(doc.summary)}</p>
    </li>`)
    .join('\n    ');

  return shell({
    site,
    docs,
    title: 'Documentation — TAIL OS',
    description: 'Published TAIL OS documentation: getting started, running under QEMU, and installing on a Raspberry Pi 3B.',
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
