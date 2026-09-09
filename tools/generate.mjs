// Generates the entire public site from an explicit allowlist of tailos files.
//
// This runs on a maintainer's machine, where both repositories exist, and its
// output is committed. Cloudflare never holds credentials for the source
// repository and never sees a file that was not generated here, so `git diff`
// before a push is the publication review.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, cpSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

import { assertAllowlisted, rewriteLink, validateAllowlist, validateOrigin } from './allowlist.mjs';
import { assertRedacted, compileRules, redact } from './redact.mjs';
import { buildIndex } from './bm25.mjs';
import { chunkMarkdown } from './chunk.mjs';
import { renderAsk, renderDoc, renderDocsIndex, renderHome, renderNotFound } from './render.mjs';
import { sectionsFrom } from './sections.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Redirectable so a test can build somewhere disposable instead of overwriting
// the committed output that `git diff` is supposed to review.
const PUBLIC = process.env.SITE_OUT ? resolve(process.env.SITE_OUT) : join(ROOT, 'public');
const GENERATED = process.env.CORPUS_OUT ? resolve(process.env.CORPUS_OUT) : join(ROOT, 'generated');

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
let origin;
try {
  bySourcePath = validateAllowlist(allowlist, sourceRoot, existsSync);
  origin = validateOrigin(allowlist.origin);
} catch (error) {
  fail(error.message);
}
const allowedPaths = new Set(bySourcePath.keys());

// --- markdown --------------------------------------------------------------

const site = {
  origin,
  version: allowlist.version,
};

const redactionRules = compileRules(allowlist.redact);
const redactions = [];

function makeRenderer(currentDocPath, headings) {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

  // Ids come from the chunker's allocation, consumed in document order, so a
  // citation anchor and the heading it points at are the same string by
  // construction rather than by two slugifiers happening to agree.
  let headingIndex = 0;
  md.renderer.rules.heading_open = (tokens, i, options, env, self) => {
    const anchor = headings[headingIndex]?.anchor;
    headingIndex += 1;
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

  const { chunks, headings } = chunkMarkdown(markdown, { docSlug: entry.slug, docTitle: entry.title });
  const md = makeRenderer(entry.path, headings);
  const tokens = md.parse(markdown, {});

  // The chunker and markdown-it are separate parsers. If they ever disagree on
  // how many headings a document has, every id after the divergence is wrong;
  // stop rather than publish silently misaligned anchors.
  const parsed = tokens.filter((token) => token.type === 'heading_open').length;
  if (parsed !== headings.length) {
    fail(`heading mismatch in ${entry.path}: chunker saw ${headings.length}, renderer saw ${parsed}`);
  }

  const sections = sectionsFrom(tokens, headings);

  const html = md.renderer.render(tokens, md.options, {});
  assertRedacted(html, redactionRules, entry.path);

  docs.push({ ...entry, sections, html });
  allChunks.push(...chunks);
}

// Assets are part of the build hash because the hash is what makes their
// year-long immutable cache safe. Sorted so the digest is order-independent.
function hashTree(dir, into) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) hashTree(full, into);
    else if (!entry.endsWith('.test.js')) into.update(entry).update(readFileSync(full));
  }
}
hashTree(join(ROOT, 'assets'), hash);
hash.update(readFileSync(join(ROOT, 'tools/bm25.mjs')));

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
write(join(PUBLIC, 'index.html'), renderHome({ site, docs, questions, home: allowlist.home ?? {} }));
write(join(PUBLIC, '404.html'), renderNotFound({ site, docs }));
write(join(PUBLIC, 'ask', 'index.html'), renderAsk({ site, docs, questions }));
write(join(PUBLIC, 'docs', 'index.html'), renderDocsIndex({ site, docs }));

// Two views of one build: the browser gets chunk metadata for keyword search,
// the Function gets full text for retrieval. Both carry the same buildId.
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
    chunks: meta,
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
${urls.map((url) => `  <url><loc>${origin}${url}</loc><changefreq>weekly</changefreq></url>`).join('\n')}
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

Sitemap: ${origin}/sitemap.xml
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
