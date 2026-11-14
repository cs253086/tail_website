// Mermaid diagrams, drawn at build time.
//
// The site's Content-Security-Policy allows no script and no inline style, so a
// diagram cannot be drawn in the reader's browser. Each ```mermaid block in a
// published document is instead rendered to SVG here, once, and inlined. A
// diagram that cannot be drawn fails the build: the page never falls back to
// showing the diagram's source as if it were the figure.
//
// Mermaid styles its SVG with a <style> element and style attributes, both of
// which the policy would drop and leave an unstyled drawing. They are removed
// here and the site stylesheet styles the same class names (assets/css/style.css,
// "Diagrams"). Labels are drawn as SVG text, never as HTML in a foreignObject,
// because HTML labels size themselves with inline style.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export class DiagramError extends Error {}

// Mermaid measures each label in this font and size, then places the text by
// that width. The stylesheet must draw it in the same font and size, or labels
// sit off-centre in their boxes (assets/css/style.css, "Diagrams").
const FONT_FAMILY = 'Arial, Helvetica, sans-serif';

const MERMAID_CONFIG = {
  theme: 'neutral',
  fontFamily: FONT_FAMILY,
  themeVariables: { fontFamily: FONT_FAMILY, fontSize: '16px' },
  securityLevel: 'strict',
  htmlLabels: false,
  flowchart: { htmlLabels: false },
};

const CHROME_CANDIDATES = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(packageRoot, 'node_modules', '.cache', 'diagrams');

function mermaidVersion() {
  const manifest = join(packageRoot, 'node_modules', '@mermaid-js', 'mermaid-cli', 'package.json');
  return JSON.parse(readFileSync(manifest, 'utf8')).version;
}

// The same source under the same renderer and configuration always draws the
// same SVG, so a rebuild with unchanged diagrams never starts a browser.
function cacheKey(source) {
  return createHash('sha256').update(mermaidVersion()).update(JSON.stringify(MERMAID_CONFIG)).update(source).digest('hex');
}

// Throws on anything the page could not safely or faithfully inline.
export function sanitizeSvg(svg, where) {
  if (/<script|<foreignObject|javascript:|\son[a-z]+\s*=/i.test(svg)) {
    throw new DiagramError(`${where}: the drawn diagram contains script or HTML content`);
  }
  const bare = svg
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/\sstyle="[^"]*"/g, '')
    .replace(/<\?xml[^>]*\?>\s*/, '');
  if (!/^<svg[\s>]/.test(bare)) throw new DiagramError(`${where}: the renderer returned no SVG`);
  // The drawing is a figure, not decoration: give it a role and keep the width
  // fluid. A diagram with no accTitle is labelled generically; the caption that
  // follows it in the document is the text equivalent.
  return bare
    .replace(/<svg\b([^>]*)>/, (_, attributes) => {
      const cleaned = attributes.replace(/\s(?:width|height)="[^"]*"/g, '').replace(/\srole="[^"]*"/, '');
      const label = /aria-labelledby/.test(cleaned) ? '' : ' aria-label="Diagram; the text below it says the same"';
      // The drawing's own width, which mermaid put in a style attribute, so a
      // small diagram is not stretched to the column.
      const viewBox = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) [\d.]+"/.exec(cleaned);
      const width = viewBox ? ` width="${Math.ceil(Number(viewBox[1]))}"` : '';
      return `<svg${cleaned}${width} role="img"${label}>`;
    });
}

// Ids inside an SVG are page-global; two diagrams on one page must not share
// them, or the second one's arrowheads and labels point at the first.
function svgId(source) {
  return `diagram-${createHash('sha256').update(source).digest('hex').slice(0, 10)}`;
}

async function drawWithBrowser(sources) {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH ?? CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!executablePath) {
    throw new DiagramError('drawing diagrams needs Chrome: install it or set PUPPETEER_EXECUTABLE_PATH');
  }
  const { default: puppeteer } = await import('puppeteer');
  const { renderMermaid } = await import('@mermaid-js/mermaid-cli');
  // CI runners forbid the user namespaces Chrome's sandbox needs. The only page
  // Chrome opens is mermaid's own, fed diagram text from our reviewed documents.
  const args = process.env.CI ? ['--no-sandbox'] : [];
  const browser = await puppeteer.launch({ executablePath, headless: true, args });
  try {
    const drawn = [];
    for (const source of sources) {
      const { data } = await renderMermaid(browser, source, 'svg', { mermaidConfig: MERMAID_CONFIG, svgId: svgId(source) });
      drawn.push(new TextDecoder().decode(data));
    }
    return drawn;
  } finally {
    await browser.close();
  }
}

// Draws every distinct source once. `draw` is the browser by default; tests hand
// in their own.
export async function renderDiagrams(sources, { draw = drawWithBrowser, cache = cacheDir } = {}) {
  const wanted = [...new Set(sources)];
  const svgs = new Map();
  const missing = [];
  mkdirSync(cache, { recursive: true });
  for (const source of wanted) {
    const file = join(cache, `${cacheKey(source)}.svg`);
    if (existsSync(file)) svgs.set(source, readFileSync(file, 'utf8'));
    else missing.push({ source, file });
  }
  if (missing.length) {
    let drawn;
    try {
      drawn = await draw(missing.map((entry) => entry.source));
    } catch (error) {
      if (error instanceof DiagramError) throw error;
      throw new DiagramError(`a diagram could not be drawn: ${error.message.split('\n')[0]}`);
    }
    missing.forEach((entry, index) => {
      const svg = sanitizeSvg(drawn[index], `diagram ${index + 1} of ${missing.length}`);
      writeFileSync(entry.file, svg);
      svgs.set(entry.source, svg);
    });
  }
  return svgs;
}

export function isDiagramFence(token) {
  return token.type === 'fence' && token.info.trim() === 'mermaid';
}

// Mermaid fences in a document, in order, as the source the renderer will see.
export function diagramSources(tokens) {
  return tokens.filter(isDiagramFence).map((token) => token.content);
}

export function diagramFenceRule(svgs, fallback) {
  return (tokens, i, options, env, self) => {
    const token = tokens[i];
    if (!isDiagramFence(token)) return fallback(tokens, i, options, env, self);
    const svg = svgs.get(token.content);
    if (!svg) throw new DiagramError('a diagram reached the renderer undrawn');
    return `<figure class="diagram">${svg}</figure>\n`;
  };
}
