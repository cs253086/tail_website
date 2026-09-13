import { describe, expect, it } from 'vitest';

import { buildNavTree } from './nav.mjs';

const doc = (slug, nav) => ({ slug, title: slug, nav });

// A readable shape: groups as { label: [...] }, pages as their slug.
function shape(nodes) {
  return nodes.map((node) => (node.type === 'page' ? node.doc.slug : { [node.label]: shape(node.children) }));
}

describe('buildNavTree', () => {
  it('places a document with no nav at the top level', () => {
    expect(shape(buildNavTree([doc('quick-start')]))).toEqual(['quick-start']);
  });

  it('builds the site hierarchy: pages, groups, and a group within a group', () => {
    const tree = buildNavTree([
      doc('quick-start'),
      doc('installation'),
      doc('qemu', ['BSP']),
      doc('raspberry-pi-3', ['BSP']),
      doc('periodic-rust', ['Development guide', 'Periodic']),
      doc('periodic-python', ['Development guide', 'Periodic']),
    ]);
    expect(shape(tree)).toEqual([
      'quick-start',
      'installation',
      { BSP: ['qemu', 'raspberry-pi-3'] },
      { 'Development guide': [{ Periodic: ['periodic-rust', 'periodic-python'] }] },
    ]);
  });

  it('keeps a group where its first document is, even if a later one rejoins it', () => {
    const tree = buildNavTree([doc('a', ['BSP']), doc('b'), doc('c', ['BSP'])]);
    expect(shape(tree)).toEqual([{ BSP: ['a', 'c'] }, 'b']);
  });

  it('treats one label under two different parents as two groups', () => {
    const tree = buildNavTree([doc('a', ['Rust', 'Examples']), doc('b', ['Python', 'Examples'])]);
    expect(shape(tree)).toEqual([{ Rust: [{ Examples: ['a'] }] }, { Python: [{ Examples: ['b'] }] }]);
  });

  it('never produces a group without a page beneath it', () => {
    const pagesUnder = (node) => (node.type === 'page' ? 1 : node.children.reduce((n, child) => n + pagesUnder(child), 0));
    const walk = (nodes) => nodes.flatMap((node) => (node.type === 'group' ? [node, ...walk(node.children)] : []));
    const tree = buildNavTree([doc('a', ['X', 'Y']), doc('b', ['X']), doc('c', ['Z'])]);
    for (const group of walk(tree)) expect(pagesUnder(group)).toBeGreaterThan(0);
  });
});
