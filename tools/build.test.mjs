import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowlist = JSON.parse(readFileSync(join(ROOT, 'content/allowlist.json'), 'utf8'));
const sourceRoot = resolve(ROOT, process.env.TAILOS_ROOT ?? allowlist.sourceRoot);

// The generator reads a sibling checkout of tailos. Where that is absent this
// suite reports as skipped rather than passing vacuously.
const canBuild = existsSync(sourceRoot);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe.skipIf(!canBuild)('generated site', () => {
  let files;
  let corpus;

  beforeAll(() => {
    execFileSync('node', [join(ROOT, 'tools/generate.mjs')], { cwd: ROOT, stdio: 'pipe' });
    files = walk(join(ROOT, 'public'));
    corpus = JSON.parse(readFileSync(join(ROOT, 'generated/chunks.json'), 'utf8'));
  });

  it('emits a page for every allowlisted document and nothing else under /docs', () => {
    const pages = files
      .filter((file) => file.includes('/public/docs/') && file.endsWith('index.html'))
      .map((file) => file.replace(/.*\/public\/docs\/?/, '').replace(/index\.html$/, '').replace(/\/$/, ''));

    expect(new Set(pages)).toEqual(new Set(['', ...allowlist.documents.map((doc) => doc.slug)]));
  });

  it('lists every document in the sitemap', () => {
    const sitemap = readFileSync(join(ROOT, 'public/sitemap.xml'), 'utf8');
    for (const doc of allowlist.documents) {
      expect(sitemap).toContain(`/docs/${doc.slug}/`);
    }
  });

  it('never publishes a test file', () => {
    expect(files.filter((file) => file.includes('.test.'))).toEqual([]);
  });

  // _headers caches /assets/* immutably for a year, which is only safe because
  // the build hash is in the path. If these drift apart, returning visitors are
  // served stale CSS and JavaScript indefinitely.
  it('serves assets from a path carrying the current build hash', () => {
    const home = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
    expect(home).toContain(`/assets/${corpus.buildId}/css/style.css`);
    expect(existsSync(join(ROOT, 'public/assets', corpus.buildId, 'js/ask.js'))).toBe(true);
  });

  // TAIL OS is not a public project: no page may carry a URL that would take a
  // reader to the repository, whether from site chrome or from document text.
  it('publishes no reference to the private repository', () => {
    const offenders = [];
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      for (const needle of ['cs253086', 'githubusercontent', 'github.com/cs253086']) {
        if (contents.includes(needle)) offenders.push(`${file}: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps unpublished repository files out of the output', () => {
    const forbidden = ['kernel_design_internal', 'kernel_design.md', 'ROADMAP.md', 'TODO.md', 'OVERVIEW_AND_VISION'];
    const offenders = [];
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      for (const needle of forbidden) {
        if (contents.includes(needle)) offenders.push(`${file}: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('disallows crawling the answering route, which would drain the daily quota', () => {
    expect(readFileSync(join(ROOT, 'public/robots.txt'), 'utf8')).toContain('Disallow: /ask/');
  });

  it('indexes every document into the retrieval corpus', () => {
    const slugs = new Set(corpus.chunks.map((chunk) => chunk.docSlug));
    expect(slugs).toEqual(new Set(allowlist.documents.map((doc) => doc.slug)));
  });
});
