// The documentation's navigation, as a tree built from the allowlist.
//
// Each document names its place with `nav`, a path of group labels from the
// top: ["BSP"], ["Development guide", "Periodic"], or nothing for a page that
// stands at the top level. A group exists only because a document is in it, so
// an empty group cannot be built -- there is nothing to render for one and
// nothing here to prevent.
//
// Order is allowlist order: a group appears where its first document does, and
// its pages keep the order they were listed in. The allowlist is already the one
// place publication is decided; it is also the one place order is.

export function buildNavTree(docs) {
  const root = [];
  for (const doc of docs) {
    let children = root;
    for (const label of doc.nav ?? []) {
      let group = children.find((node) => node.type === 'group' && node.label === label);
      if (!group) {
        group = { type: 'group', label, children: [] };
        children.push(group);
      }
      children = group.children;
    }
    children.push({ type: 'page', doc });
  }
  return root;
}
