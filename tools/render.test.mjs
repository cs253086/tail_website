import { describe, expect, it } from 'vitest';
import { renderAsk, renderDoc, renderDocsIndex, renderHome, renderNotFound } from './render.mjs';

const site = { origin: 'https://tail-os.com', version: 'v0.9.0', assets: '/assets/abc', buildId: 'abc' };
const docs = [{ slug: 'qemu', title: 'Running TAIL OS in QEMU', summary: 'Boot under QEMU.', sections: [] }];

describe('renderHome', () => {
  const html = renderHome({ site, docs, questions: ['How do I run TAIL OS on QEMU?'] });

  // A suggested question used to be a submit button named `q` inside a form
  // whose input is also named `q`. Both submitted, and the empty input won.
  it('links each suggested question straight to its answer', () => {
    expect(html).toContain('href="/ask/?q=How%20do%20I%20run%20TAIL%20OS%20on%20QEMU%3F"');
    expect(html).not.toMatch(/<button[^>]*name="q"/);
  });

  it('carries exactly one control named q, so no submission is ambiguous', () => {
    expect([...html.matchAll(/name="q"/g)]).toHaveLength(1);
  });

  it('publishes no reference to the private repository', () => {
    expect(html).not.toMatch(/github|cs253086/i);
  });
});

describe('documentation navigation', () => {
  const page = (slug, nav, navTitle, sections) => ({
    slug, title: `Title of ${slug}`, summary: `About ${slug}.`, path: `doc/${slug}.md`, nav, navTitle, sections,
  });
  const docs = [
    page('getting-started', undefined, undefined, [{ title: 'Prerequisites', anchor: 'prerequisites' }]),
    page('qemu', ['BSP'], 'QEMU', [{ title: 'Try the Shell', anchor: 'try-the-shell' }]),
    page('periodic-framework-rust', ['Development guide', 'Periodic'], 'Rust', [{ title: 'Quick start', anchor: 'quick-start' }]),
  ];
  const sidebarOf = (html) => /<aside class="side">([\s\S]*?)<\/aside>/.exec(html)[1];
  const reading = (doc) => sidebarOf(renderDoc({ site, docs, doc, html: '<h1>x</h1>' }));

  it('lists sections for the page being read and for no other', () => {
    // Every document's sections at once would bury the groups under headings
    // from pages nobody has opened.
    const html = reading(docs[1]);
    expect(html).toContain('/docs/qemu/#try-the-shell');
    expect(html).not.toContain('#prerequisites');
    expect(html).not.toContain('/docs/periodic-framework-rust/#quick-start');
  });

  it('names a page by its navigation title, so a leaf does not repeat its ancestors', () => {
    expect(reading(docs[0])).toMatch(/<a class="nav-link" href="\/docs\/periodic-framework-rust\/">Rust<\/a>/);
  });

  it('renders groups as labels, nested and in allowlist order', () => {
    const labels = [...reading(docs[0]).matchAll(/<span class="nav-label">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(['BSP', 'Development guide', 'Periodic']);
  });

  it('marks the page being read as current', () => {
    expect(reading(docs[1])).toMatch(/href="\/docs\/qemu\/" aria-current="page">QEMU</);
  });

  it('lists no sections on the documentation index, where no page is being read', () => {
    expect(sidebarOf(renderDocsIndex({ site, docs }))).not.toContain('nav-sections');
  });

  it('groups the documentation index the same way as the sidebar', () => {
    const html = renderDocsIndex({ site, docs });
    const main = html.slice(html.indexOf('<article'));
    expect(main.indexOf('BSP')).toBeLessThan(main.indexOf('Development guide'));
    expect(main.indexOf('Development guide')).toBeLessThan(main.indexOf('Periodic'));
    expect(main).toContain('href="/docs/qemu/"');
  });
});

describe('copy buttons', () => {
  const script = '<script type="module" src="/assets/abc/js/copy.js"></script>';

  it('loads the copy script once on every page, since any page may show code', () => {
    const doc = { ...docs[0], path: 'doc/install_qemu.md' };
    const pages = {
      home: renderHome({ site, docs, questions: [] }),
      doc: renderDoc({ site, docs, doc, html: '<pre><code>make run\n</code></pre>' }),
      index: renderDocsIndex({ site, docs }),
      ask: renderAsk({ site, docs, questions: [] }),
      notFound: renderNotFound({ site, docs }),
    };
    for (const [page, html] of Object.entries(pages)) {
      expect({ page, loads: html.split(script).length - 1 }).toEqual({ page, loads: 1 });
    }
  });

  it('gives the home command box its bare commands to copy, without the prompts it shows', () => {
    const commands = [
      'sudo apt-get install -y qemu-system-arm qemu-utils',
      'curl -sSL https://tail-os.com/downloads/run_tailos_qemu.sh | bash',
    ];
    const quickstart = { title: 'Quick start', doc: 'quick-start', commands, note: 'Exit with Ctrl-A then X.' };
    const html = renderHome({ site, docs, questions: [], home: { quickstart } });
    expect(html).toContain(`<pre class="term" data-copy="${commands.join('\n')}"><code>`);
  });
});
