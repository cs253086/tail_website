import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { DiagramError, diagramFenceRule, diagramSources, renderDiagrams, sanitizeSvg } from './diagram.mjs';

const DRAWN = '<svg id="d" viewBox="0 0 120.4 40" style="max-width: 120px" width="100%"><style>#d .node{fill:red}</style><g class="node"><rect style="fill:red"/></g></svg>';
const freshCache = () => mkdtempSync(join(tmpdir(), 'diagrams-'));

describe('sanitizeSvg', () => {
  it('removes the styling the page policy would drop, and keeps the drawing', () => {
    const svg = sanitizeSvg(DRAWN, 'test');
    expect(svg).not.toMatch(/<style|style=/);
    expect(svg).toContain('<g class="node"><rect/></g>');
  });

  it('gives the drawing its own width, a role and a generic label when it has no title', () => {
    const svg = sanitizeSvg(DRAWN, 'test');
    expect(svg).toMatch(/^<svg[^>]* width="121"/);
    expect(svg).not.toContain('width="100%"');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label=');
  });

  it('keeps the title a diagram declared instead of overwriting it', () => {
    const svg = sanitizeSvg('<svg viewBox="0 0 10 10" aria-labelledby="t"><title id="t">Nodes</title></svg>', 'test');
    expect(svg).toContain('<title id="t">Nodes</title>');
    expect(svg).not.toContain('aria-label=');
  });

  it.each(['<svg viewBox="0 0 1 1"><script>x()</script></svg>', '<svg viewBox="0 0 1 1"><foreignObject/></svg>', '<svg viewBox="0 0 1 1" onload="x()"></svg>'])(
    'refuses a drawing that carries script or HTML: %s', (svg) => {
      expect(() => sanitizeSvg(svg, 'test')).toThrow(DiagramError);
    });

  it('refuses output that is not an SVG', () => {
    expect(() => sanitizeSvg('<html></html>', 'test')).toThrow(/no SVG/);
  });
});

describe('renderDiagrams', () => {
  it('draws each distinct source once, and not again on the next build', async () => {
    const cache = freshCache();
    const calls = [];
    const draw = async (sources) => { calls.push(sources); return sources.map(() => DRAWN); };
    await renderDiagrams(['graph LR\n a-->b', 'graph LR\n a-->b', 'graph LR\n c-->d'], { draw, cache });
    await renderDiagrams(['graph LR\n a-->b', 'graph LR\n c-->d'], { draw, cache });
    expect(calls).toEqual([['graph LR\n a-->b', 'graph LR\n c-->d']]);
  });

  it('fails the build, naming the cause, when a diagram cannot be drawn', async () => {
    const draw = async () => { throw new Error('Parse error on line 2\n  details'); };
    await expect(renderDiagrams(['graph LR\n a--b'], { draw, cache: freshCache() })).rejects.toThrow(/could not be drawn: Parse error on line 2/);
  });

  it('draws a real diagram in a browser, with no styling left for the policy to drop', async () => {
    const source = 'flowchart LR\n  accTitle: Two nodes\n  a["lidar node"] -->|sensor/range| b["brake node"]\n';
    const svg = (await renderDiagrams([source], { cache: freshCache() })).get(source);
    expect(svg).toContain('<title id="chart-title-');
    expect(svg).toContain('sensor/range');
    expect(svg).toContain('lidar');
    expect(svg).not.toMatch(/<style|\sstyle=|foreignObject/);
  }, 60000);
});

describe('the markdown fence rule', () => {
  const md = new MarkdownIt();
  const markdown = '```mermaid\ngraph LR\n  a-->b\n```\n\n```rust\nfn main() {}\n```\n';
  const tokens = md.parse(markdown, {});

  it('finds only mermaid blocks', () => {
    expect(diagramSources(tokens)).toEqual(['graph LR\n  a-->b\n']);
  });

  it('inlines the drawing for a mermaid block and leaves other code blocks alone', () => {
    md.renderer.rules.fence = diagramFenceRule(new Map([['graph LR\n  a-->b\n', '<svg></svg>']]), md.renderer.rules.fence);
    const html = md.renderer.render(tokens, md.options, {});
    expect(html).toContain('<figure class="diagram"><svg></svg></figure>');
    expect(html).toContain('<pre><code class="language-rust">');
    expect(html).not.toContain('a-->b');
  });

  it('refuses to render a diagram nobody drew', () => {
    const rule = diagramFenceRule(new Map(), md.renderer.rules.fence);
    expect(() => rule(tokens, 0, md.options, {}, md.renderer)).toThrow(DiagramError);
  });
});
