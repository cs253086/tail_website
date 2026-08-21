// Publication boundary. Every published byte traces to an entry here; nothing
// is globbed, and an entry that escapes the source root fails the build rather
// than leaking a file that was never meant to be public.

import { posix, relative, resolve } from 'node:path';

export class AllowlistError extends Error {}

export function validateAllowlist(allowlist, sourceRoot, exists) {
  if (!Array.isArray(allowlist.documents) || allowlist.documents.length === 0) {
    throw new AllowlistError('allowlist contains no documents');
  }

  const bySourcePath = new Map();
  const slugs = new Set();

  for (const entry of allowlist.documents) {
    for (const field of ['path', 'slug', 'title', 'summary']) {
      if (!entry[field]) throw new AllowlistError(`allowlist entry is missing ${field}: ${JSON.stringify(entry)}`);
    }

    const absolute = resolve(sourceRoot, entry.path);
    const inside = relative(sourceRoot, absolute);
    if (inside === '' || inside.startsWith('..') || resolve(sourceRoot, inside) !== absolute) {
      throw new AllowlistError(`allowlist entry escapes the source root: ${entry.path}`);
    }
    if (bySourcePath.has(entry.path)) {
      throw new AllowlistError(`duplicate allowlist entry: ${entry.path}`);
    }
    if (slugs.has(entry.slug)) {
      throw new AllowlistError(`duplicate slug: ${entry.slug}`);
    }
    if (!exists(absolute)) {
      throw new AllowlistError(`allowlist entry does not exist: ${entry.path}`);
    }

    slugs.add(entry.slug);
    bySourcePath.set(entry.path, { ...entry, absolute });
  }

  return bySourcePath;
}

export function assertAllowlisted(sourcePath, allowed) {
  if (!allowed.has(sourcePath)) {
    throw new AllowlistError(`refusing to publish a file that is not on the allowlist: ${sourcePath}`);
  }
}

// Links in the source documents point at repository paths. Anything
// allowlisted becomes an internal link. Everything else returns null, meaning
// "unlink": the repository is private, so there is nowhere to send a reader,
// and a link they cannot follow is worse than plain text.
export function rewriteLink(href, currentDocPath, allowed) {
  if (!href) return href;
  if (/^(https?:|mailto:|#)/i.test(href)) return href;

  const [pathPart, hash = ''] = href.split('#');
  const suffix = hash ? `#${hash}` : '';
  if (!pathPart) return href;

  const resolved = posix.normalize(posix.join(posix.dirname(currentDocPath), pathPart));
  const target = allowed.get(resolved);
  return target ? `/docs/${target.slug}/${suffix}` : null;
}
