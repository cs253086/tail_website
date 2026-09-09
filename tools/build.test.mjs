import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowlist = JSON.parse(readFileSync(join(ROOT, 'content/allowlist.json'), 'utf8'));
const sourceRoot = resolve(ROOT, process.env.TAILOS_ROOT ?? allowlist.sourceRoot);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// These run against the committed output, which is what actually ships. They
// need no source checkout and therefore never skip: the publication boundary is
// the one thing that must not become optional because a machine is unusual.
describe('published output', () => {
  const files = walk(join(ROOT, 'public'));
  const corpus = JSON.parse(readFileSync(join(ROOT, 'generated/chunks.json'), 'utf8'));
  const read = (file) => readFileSync(file, 'utf8');

  it('publishes no reference to the private repository', () => {
    const offenders = files.flatMap((file) => {
      const contents = read(file);
      return ['cs253086', 'githubusercontent'].filter((n) => contents.includes(n)).map((n) => `${file}: ${n}`);
    });
    expect(offenders).toEqual([]);
  });

  it('keeps unpublished repository files out of the output', () => {
    const forbidden = ['kernel_design_internal', 'kernel_design.md', 'ROADMAP.md', 'TODO.md', 'OVERVIEW_AND_VISION'];
    const offenders = files.flatMap((file) => {
      const contents = read(file);
      return forbidden.filter((n) => contents.includes(n)).map((n) => `${file}: ${n}`);
    });
    expect(offenders).toEqual([]);
  });

  it('never publishes a test file', () => {
    expect(files.filter((file) => file.includes('.test.'))).toEqual([]);
  });

  it('emits a page for every allowlisted document and nothing else under /docs', () => {
    const pages = files
      .filter((file) => file.includes('/public/docs/') && file.endsWith('index.html'))
      .map((file) => file.replace(/.*\/public\/docs\/?/, '').replace(/index\.html$/, '').replace(/\/$/, ''));
    expect(new Set(pages)).toEqual(new Set(['', ...allowlist.documents.map((doc) => doc.slug)]));
  });

  it('lists every document in the sitemap', () => {
    const sitemap = read(join(ROOT, 'public/sitemap.xml'));
    for (const doc of allowlist.documents) expect(sitemap).toContain(`/docs/${doc.slug}/`);
  });

  it('serves assets from a path carrying the current build hash', () => {
    expect(read(join(ROOT, 'public/index.html'))).toContain(`/assets/${corpus.buildId}/css/style.css`);
    expect(existsSync(join(ROOT, 'public/assets', corpus.buildId, 'js/ask.js'))).toBe(true);
  });

  it('replaces the error document the old Apache config provided', () => {
    expect(existsSync(join(ROOT, 'public/404.html'))).toBe(true);
  });

  it('disallows crawling the answering route, which would drain the daily quota', () => {
    expect(read(join(ROOT, 'public/robots.txt'))).toContain('Disallow: /ask/');
  });

  it('indexes every document into the retrieval corpus', () => {
    expect(new Set(corpus.chunks.map((chunk) => chunk.docSlug)))
      .toEqual(new Set(allowlist.documents.map((doc) => doc.slug)));
  });

  it('gives every chunk a unique id, so no citation resolves to another section', () => {
    expect(new Set(corpus.chunks.map((chunk) => chunk.id)).size).toBe(corpus.chunks.length);
  });

  it('resolves every in-page link to a heading that exists', () => {
    // A document carries its own cross-references. One pointing at a heading the
    // renderer never allocated is a dead link on a published page, and nothing
    // else in the build would notice.
    for (const doc of allowlist.documents) {
      const html = readFileSync(join(ROOT, `public/docs/${doc.slug}/index.html`), 'utf8');
      const ids = new Set([...html.matchAll(/<h[1-6][^>]*id="([^"]+)"/g)].map((m) => m[1]));
      const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
      expect({ slug: doc.slug, broken: targets.filter((id) => !ids.has(id)) })
        .toEqual({ slug: doc.slug, broken: [] });
    }
  });
});

// Running the generator needs the tailos checkout, so this half may skip. It
// builds somewhere disposable rather than overwriting the committed output.
describe.skipIf(!existsSync(sourceRoot))('generator', () => {
  let out;
  let corpusOut;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'tailos-site-'));
    out = join(dir, 'public');
    corpusOut = join(dir, 'generated');
    execFileSync('node', [join(ROOT, 'tools/generate.mjs')], {
      cwd: ROOT,
      stdio: 'pipe',
      env: { ...process.env, SITE_OUT: out, CORPUS_OUT: corpusOut },
    });
  });

  afterAll(() => out && rmSync(dirname(out), { recursive: true, force: true }));

  it('reproduces the committed output byte for byte', () => {
    const built = readFileSync(join(out, 'index.html'), 'utf8');
    expect(built).toBe(readFileSync(join(ROOT, 'public/index.html'), 'utf8'));
  });

  it('redacts every private URL out of the rendered documents', () => {
    for (const file of walk(out)) {
      expect(readFileSync(file, 'utf8')).not.toContain('githubusercontent');
    }
  });

  it('names sections with text the document actually contains', () => {
    // A navigation entry that names something the document does not say is a
    // reader following a link to text that is not there. The extraction itself
    // is pinned in sections.test.mjs; this is the end-to-end shape of it, and
    // it names no document's content so it holds for whatever is allowlisted
    // next.
    //
    // One page carries the section list of every document, so the slug in each
    // link is what says which source to check a title against.
    const html = readFileSync(join(out, 'docs/index.html'), 'utf8');
    const links = [...html.matchAll(/href="\/docs\/([^/"]+)\/#[^"]*">([^<]+)</g)];
    expect(links.length).toBeGreaterThan(0);

    const bySlug = new Map();
    for (const [, slug, title] of links) {
      const text = title
        .replaceAll('&lt;', '<').replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"');
      bySlug.set(slug, [...(bySlug.get(slug) ?? []), text]);
    }

    for (const doc of allowlist.documents) {
      // Backticks are legitimately gone from a title: the delimiters of a code
      // span are not part of its text. Everything else must have survived.
      const source = readFileSync(join(sourceRoot, doc.path), 'utf8').replaceAll('`', '');
      const titles = bySlug.get(doc.slug) ?? [];
      expect({ slug: doc.slug, absent: titles.filter((title) => !source.includes(title)) })
        .toEqual({ slug: doc.slug, absent: [] });
    }
  });
});
