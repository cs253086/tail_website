import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publishedName } from './allowlist.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowlist = JSON.parse(readFileSync(join(ROOT, 'content/allowlist.json'), 'utf8'));
const sourceRoot = resolve(ROOT, process.env.TAILOS_ROOT ?? allowlist.sourceRoot);
const fromTailos = (allowlist.downloads ?? []).filter((download) => download.path);
const fromR2 = (allowlist.downloads ?? []).filter((download) => download.storage === 'r2');

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

  it('publishes nothing under /downloads but the allowlisted tailos files and their checksums', () => {
    const dir = join(ROOT, 'public/downloads');
    const expected = fromTailos.map(({ path, compress }) => {
      const name = path.split('/').pop();
      return compress ? `${name}.gz` : name;
    });
    const present = existsSync(dir) ? readdirSync(dir).sort() : [];
    expect(present).toEqual([...expected, ...((allowlist.downloads ?? []).length ? ['SHA256SUMS'] : [])].sort());
  });

  it('routes only the API and the R2 downloads to Functions, so every other download stays static', () => {
    const names = fromR2.map(({ name, compress }) => publishedName(name, compress === true));
    expect(JSON.parse(read(join(ROOT, 'public/_routes.json'))))
      .toEqual({ version: 1, include: ['/api/*', ...names.map((name) => `/downloads/${name}`)], exclude: [] });
    expect(JSON.parse(read(join(ROOT, 'generated/downloads.json')))).toEqual({ r2: names });
  });

  it('lists every R2 download in SHA256SUMS with the checksum its upload was verified against', () => {
    const sums = fromR2.length ? read(join(ROOT, 'public/downloads/SHA256SUMS')) : '';
    for (const { name, sha256 } of fromR2) expect(sums).toContain(`${sha256}  ${name}\n`);
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

  it('publishes each download as its source bytes, compressed where the allowlist says', () => {
    for (const { path, compress } of fromTailos) {
      const name = path.split('/').pop();
      const published = readFileSync(join(out, 'downloads', compress ? `${name}.gz` : name));
      const reader = compress ? gunzipSync(published) : published;
      expect({ path, identical: reader.equals(readFileSync(join(sourceRoot, path))) }).toEqual({ path, identical: true });
    }
  });

  it('lists the checksum of every download as a reader holds it after decompressing', () => {
    const downloads = allowlist.downloads ?? [];
    const manifest = join(out, 'downloads', 'SHA256SUMS');
    if (downloads.length === 0) {
      expect(existsSync(manifest)).toBe(false);
      return;
    }
    const sums = readFileSync(manifest, 'utf8');
    for (const { path } of fromTailos) {
      const hash = createHash('sha256').update(readFileSync(join(sourceRoot, path))).digest('hex');
      expect(sums).toContain(`${hash}  ${path.split('/').pop()}\n`);
    }
  });

  it('reproduces the committed downloads byte for byte, so an unchanged image never churns', () => {
    // gzip output must be deterministic: if compressing the same image twice gave
    // different bytes, every regeneration would commit another copy of it.
    const dir = join(out, 'downloads');
    for (const file of existsSync(dir) ? readdirSync(dir) : []) {
      const identical = readFileSync(join(dir, file)).equals(readFileSync(join(ROOT, 'public/downloads', file)));
      expect({ file, identical }).toEqual({ file, identical: true });
    }
  });

  it('fails the build when a download carries a private repository URL', () => {
    // Downloads are copied or compressed, never rendered, so the redaction that
    // guards documents never sees them. Building from a copy of the source root
    // with one URL planted in the launcher is what shows the scan is wired in,
    // rather than merely written.
    const root = mkdtempSync(join(tmpdir(), 'tailos-leak-'));
    const site = mkdtempSync(join(tmpdir(), 'tailos-leak-site-'));
    try {
      const listed = [...allowlist.documents, ...fromTailos].map((entry) => entry.path);
      for (const path of listed) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        symlinkSync(join(sourceRoot, path), join(root, path));
      }
      const launcher = fromTailos.find((entry) => entry.path.endsWith('.sh'));
      expect(launcher).toBeDefined();
      rmSync(join(root, launcher.path));
      writeFileSync(join(root, launcher.path),
        `${readFileSync(join(sourceRoot, launcher.path), 'utf8')}\n# mirror: https://github.com/cs253086/tailos/releases\n`);

      let failure;
      try {
        execFileSync('node', [join(ROOT, 'tools/generate.mjs')], {
          cwd: ROOT,
          stdio: 'pipe',
          env: { ...process.env, TAILOS_ROOT: root, SITE_OUT: join(site, 'public'), CORPUS_OUT: join(site, 'generated') },
        });
      } catch (error) {
        failure = String(error.stderr);
      }
      expect(failure).toMatch(/redaction escaped into scripts\/run_tailos_qemu\.sh: https:\/\/github\.com\/cs253086\/tailos/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(site, { recursive: true, force: true });
    }
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
    // A document's sections are listed only in its own page's sidebar, so each
    // page is where its titles are read -- and with one list per page, the list
    // found is necessarily that document's.
    let checked = 0;
    for (const doc of allowlist.documents) {
      const html = readFileSync(join(out, `docs/${doc.slug}/index.html`), 'utf8');
      const nav = /<ul class="nav-sections">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
      const titles = [...nav.matchAll(/>([^<]+)<\/a>/g)].map(([, title]) => title
        .replaceAll('&lt;', '<').replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"'));
      checked += titles.length;

      // Backticks are legitimately gone from a title: the delimiters of a code
      // span are not part of its text. Everything else must have survived.
      const source = readFileSync(join(sourceRoot, doc.path), 'utf8').replaceAll('`', '');
      expect({ slug: doc.slug, absent: titles.filter((title) => !source.includes(title)) })
        .toEqual({ slug: doc.slug, absent: [] });
    }
    expect(checked).toBeGreaterThan(0);
  });
});
