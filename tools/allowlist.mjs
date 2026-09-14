// Publication boundary. Every published byte traces to an entry here; nothing
// is globbed, and an entry that escapes the source root fails the build rather
// than leaking a file that was never meant to be public.

import { posix, relative, resolve } from 'node:path';

export class AllowlistError extends Error {}

// The one test of whether a listed path lies inside the checkout. Documents and
// downloads cross the same boundary, so they share it rather than each holding a
// copy that could come to disagree.
function insideSourceRoot(sourceRoot, path) {
  const absolute = resolve(sourceRoot, path);
  const inside = relative(sourceRoot, absolute);
  return inside !== '' && !inside.startsWith('..') && resolve(sourceRoot, inside) === absolute ? absolute : null;
}

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

    // Refused rather than coerced. `"nav": "BSP"` is the natural slip, and a
    // string iterates by character: it would publish a sidebar nesting the page
    // under groups named B, S and P, and nothing downstream would object.
    const isLabel = (value) => typeof value === 'string' && value.trim() !== '';
    if (entry.nav !== undefined && !(Array.isArray(entry.nav) && entry.nav.every(isLabel))) {
      throw new AllowlistError(`nav must be a list of group names, e.g. ["BSP"]: ${entry.path}`);
    }
    if (entry.navTitle !== undefined && !isLabel(entry.navTitle)) {
      throw new AllowlistError(`navTitle must be a non-empty string: ${entry.path}`);
    }

    const absolute = insideSourceRoot(sourceRoot, entry.path);
    if (!absolute) {
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

// The site's own origin. Every canonical URL, Open Graph URL, sitemap entry
// and the robots.txt Sitemap line is this string with a root-relative path
// appended, so it is normalised to a bare scheme+host: a trailing slash or a
// stray path segment here would corrupt every absolute URL on the site.
export function validateOrigin(origin) {
  if (typeof origin !== 'string' || origin === '') {
    throw new AllowlistError('allowlist is missing origin');
  }

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new AllowlistError(`origin is not a URL: ${origin}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new AllowlistError(`origin must be https: ${origin}`);
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new AllowlistError(`origin must be a bare scheme and host: ${origin}`);
  }

  return parsed.origin;
}

// Files published for download cross the same boundary as documents: nothing is
// published unless it is listed here, and a listed file that escapes the source
// root or does not exist fails the build rather than publishing nothing.
export function validateDownloads(allowlist, sourceRoot, exists) {
  const entries = allowlist.downloads ?? [];
  if (!Array.isArray(entries)) throw new AllowlistError('downloads must be a list');

  const publishedNames = new Set();
  return entries.map((entry) => {
    if (!entry?.path) throw new AllowlistError(`download entry is missing path: ${JSON.stringify(entry)}`);
    if (entry.compress !== undefined && typeof entry.compress !== 'boolean') {
      throw new AllowlistError(`compress must be true or false: ${entry.path}`);
    }
    const absolute = insideSourceRoot(sourceRoot, entry.path);
    if (!absolute) throw new AllowlistError(`download escapes the source root: ${entry.path}`);
    if (!exists(absolute)) throw new AllowlistError(`download does not exist: ${entry.path}`);

    const name = posix.basename(entry.path);
    const published = entry.compress ? `${name}.gz` : name;
    // Two files with one basename would publish to one URL, and the second
    // would silently replace the first.
    if (publishedNames.has(published)) {
      throw new AllowlistError(`two downloads would publish as ${published}`);
    }
    publishedNames.add(published);
    return { path: entry.path, absolute, name, published, compress: entry.compress === true };
  });
}
