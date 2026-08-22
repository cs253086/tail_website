import { describe, expect, it } from 'vitest';
import { renderHome } from './render.mjs';

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
