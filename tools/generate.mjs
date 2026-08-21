// Generates the entire public site from an explicit allowlist of tailos files.
//
// This runs on a maintainer's machine, where both repositories exist, and its
// output is committed. Cloudflare never holds credentials for the source
// repository and never sees a file that was not generated here, so `git diff`
// before a push is the publication review.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

import { assertAllowlisted, rewriteLink, validateAllowlist } from './allowlist.mjs';
import { assertRedacted, compileRules, redact } from './redact.mjs';
import { buildIndex } from './bm25.mjs';
import { chunkMarkdown, slugify } from './chunk.mjs';
import { renderAsk, renderDoc, renderDocsIndex, renderHome } from './render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const GENERATED = join(ROOT, 'generated');
const ORIGIN = 'https://tail-os.com';

function fail(message) {
  console.error(`generate: ${message}`);
  process.exit(1);
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

// --- allowlist -------------------------------------------------------------

const allowlist = JSON.parse(readFileSync(join(ROOT, 'content/allowlist.json'), 'utf8'));
const sourceRoot = resolve(ROOT, process.env.TAILOS_ROOT ?? allowlist.sourceRoot);

if (!existsSync(sourceRoot)) {
  fail(`source root not found: ${sourceRoot}\n  set TAILOS_ROOT or fix sourceRoot in content/allowlist.json`);
}

let bySourcePath;
try {
  bySourcePath = validateAllowlist(allowlist, sourceRoot, existsSync);
} catch (error) {
  fail(error.message);
}
const allowedPaths = new Set(bySourcePath.keys());

// --- markdown --------------------------------------------------------------

const site = {
  origin: ORIGIN,
  version: allowlist.version,
};

const redactionRules = compileRules(allowlist.redact);
const redactions = [];

function makeRenderer(currentDocPath) {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

  // Heading ids must match chunk.mjs slugs so a citation can deep-link to the
  // exact section the answer was drawn from.
  md.renderer.rules.heading_open = (tokens, i, options, env, self) => {
    const inline = tokens[i + 1];
    const text = inline && inline.type === 'inline' ? inline.content : '';
    const anchor = slugify(text.replace(/[*_`]/g, ''));
    if (anchor) tokens[i].attrSet('id', anchor);
    return self.renderToken(tokens, i, options);
  };

  const defaultLink = md.renderer.rules.link_open
    ?? ((tokens, i, options, env, self) => self.renderToken(tokens, i, options));

  // A link whose target is not published is dropped, leaving its text in place.
  // Links cannot nest in markdown, but a stack keeps open and close in step.
  const dropped = [];

  md.renderer.rules.link_open = (tokens, i, options, env, self) => {
    const token = tokens[i];
    const href = rewriteLink(token.attrGet('href') ?? '', currentDocPath, bySourcePath);
    dropped.push(href === null);
    if (href === null) return '';

    token.attrSet('href', href);
    if (/^https?:/i.test(href)) {
      token.attrSet('rel', 'noopener');
    }
    return defaultLink(tokens, i, options, env, self);
  };

  md.renderer.rules.link_close = () => (dropped.pop() ? '' : '</a>');

  return md;
}

// --- build -----------------------------------------------------------------

const docs = [];
const allChunks = [];
const hash = createHash('sha256');
hash.update(JSON.stringify(allowlist));

for (const entry of bySourcePath.values()) {
  assertAllowlisted(entry.path, allowedPaths);

  const source = readFileSync(entry.absolute, 'utf8');
  const { text: markdown, hits } = redact(source, redactionRules);
  redactions.push(...hits.map((hit) => ({ ...hit, path: entry.path })));
  hash.update(entry.path).update(markdown);

  const md = makeRenderer(entry.path);
  const tokens = md.parse(markdown, {});

  const sections = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== 'heading_open' || tokens[i].tag !== 'h2') continue;
    const title = tokens[i + 1]?.content?.replace(/[*_`]/g, '') ?? '';
    if (title) sections.push({ title, anchor: slugify(title) });
  }

  const html = md.render(markdown);
  assertRedacted(html, redactionRules, entry.path);

  const doc = { ...entry, sections, html };
  docs.push(doc);
  allChunks.push(...chunkMarkdown(markdown, { docSlug: entry.slug, docTitle: entry.title }));
}

const buildId = hash.digest('hex').slice(0, 12);
// Assets are served from a build-hashed path so the year-long immutable cache
// in _headers is actually safe: a new build is a new URL, never a stale hit.
site.buildId = buildId;
site.assets = `/assets/${buildId}`;
const questions = docs.flatMap((doc) => doc.questions ?? []).slice(0, 5);
const index = buildIndex(allChunks.map((chunk) => ({ id: chunk.id, heading: chunk.heading, body: chunk.text })));

rmSync(PUBLIC, { recursive: true, force: true });

for (const doc of docs) {
  write(join(PUBLIC, 'docs', doc.slug, 'index.html'), renderDoc({ site, docs, doc, html: doc.html }));
}
write(join(PUBLIC, 'index.html'), renderHome({ site, docs, questions }));
write(join(PUBLIC, 'ask', 'index.html'), renderAsk({ site, docs, questions }));
write(join(PUBLIC, 'docs', 'index.html'), renderDocsIndex({ site, docs }));

// Two views of one build: the browser gets previews for keyword search, the
// Function gets full text for retrieval. Both carry the same buildId.
const meta = allChunks.map((chunk) => ({
  id: chunk.id,
  docSlug: chunk.docSlug,
  docTitle: chunk.docTitle,
  headingPath: chunk.headingPath,
  anchor: chunk.anchor,
}));

write(
  join(PUBLIC, 'search-index.json'),
  JSON.stringify({
    buildId,
    index,
    chunks: meta.map((chunk, i) => ({
      ...chunk,
      preview: allChunks[i].text.replace(/[`*#>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220),
    })),
  }),
);

write(
  join(GENERATED, 'chunks.json'),
  JSON.stringify({
    buildId,
    index,
    chunks: meta.map((chunk, i) => ({ ...chunk, text: allChunks[i].text })),
    coverage: docs.map((doc) => ({ slug: doc.slug, title: doc.title, summary: doc.summary })),
  }),
);

const urls = ['/', '/docs/', ...docs.map((doc) => `/docs/${doc.slug}/`)];
write(
  join(PUBLIC, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${ORIGIN}${url}</loc><changefreq>weekly</changefreq></url>`).join('\n')}
</urlset>
`,
);

// /ask/ is disallowed: a crawler walking generated answers would drain the
// daily model quota for pages that are noindex anyway.
write(
  join(PUBLIC, 'robots.txt'),
  `User-agent: *
Allow: /
Disallow: /ask/

Sitemap: ${ORIGIN}/sitemap.xml
`,
);

write(
  join(PUBLIC, '_headers'),
  `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);

// Tests live beside the code they cover; they are not part of the site.
cpSync(join(ROOT, 'assets'), join(PUBLIC, 'assets', buildId), {
  recursive: true,
  filter: (source) => !source.endsWith('.test.js'),
});
// The browser searches with the same ranking code the Function retrieves with.
cpSync(join(ROOT, 'tools/bm25.mjs'), join(PUBLIC, 'assets', buildId, 'js/bm25.js'));

console.log(
  `generate: ${docs.length} documents, ${allChunks.length} chunks, ` +
  `${Object.keys(index.postings).length} terms, build ${buildId}`,
);

// Printed every build, not buried: a redaction means a published document still
// contains instructions written for a repository readers cannot reach.
if (redactions.length) {
  console.log(`generate: redacted ${redactions.length} private reference(s):`);
  const seen = new Set();
  for (const hit of redactions) {
    const line = `  ${hit.path}: ${hit.match}`;
    if (!seen.has(line)) { seen.add(line); console.log(line); }
  }
}
