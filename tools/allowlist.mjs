// Publication boundary. Every published byte traces to an entry here; nothing
// is globbed, and an entry that escapes the source root fails the build rather
// than leaking a file that was never meant to be public.

import { posix, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

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
// A download stored in R2 is published under this name, so it must be one plain
// path segment.
export const R2_DOWNLOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// A compressed download is published as the gzip of the file, under the file's
// name plus .gz. Its checksum stays that of the file itself: a reader verifies
// what they hold after gunzip, and so does the launcher's cache.
export function publishedName(name, compress) {
  return compress ? `${name}.gz` : name;
}

// Level 6 rather than 9: measured on the QEMU disk image, 9 saved 0.04 MiB of 8.6 and
// cost a second on every run. Deterministic, so the same file always compresses to
// the same bytes.
export function gzipDownload(bytes) {
  return gzipSync(bytes, { level: 6 });
}

export function validateDownloads(allowlist, sourceRoot, exists) {
  const entries = allowlist.downloads ?? [];
  if (!Array.isArray(entries)) throw new AllowlistError('downloads must be a list');

  const publishedNames = new Set();
  // Two files with one name would publish to one URL, and the second would
  // silently replace the first.
  const claim = (published) => {
    if (publishedNames.has(published)) throw new AllowlistError(`two downloads would publish as ${published}`);
    publishedNames.add(published);
  };
  return entries.map((entry) => {
    if (entry?.storage === 'r2') return validateR2Download(entry, claim);
    if (entry?.storage !== undefined) {
      throw new AllowlistError(`unknown download storage: ${JSON.stringify(entry)}`);
    }
    if (!entry?.path) throw new AllowlistError(`download entry is missing path: ${JSON.stringify(entry)}`);
    if (entry.compress !== undefined && typeof entry.compress !== 'boolean') {
      throw new AllowlistError(`compress must be true or false: ${entry.path}`);
    }
    const absolute = insideSourceRoot(sourceRoot, entry.path);
    if (!absolute) throw new AllowlistError(`download escapes the source root: ${entry.path}`);
    if (!exists(absolute)) throw new AllowlistError(`download does not exist: ${entry.path}`);

    const name = posix.basename(entry.path);
    const published = publishedName(name, entry.compress === true);
    claim(published);
    return { path: entry.path, absolute, name, published, compress: entry.compress === true };
  });
}

// A download too large for Pages, or built rather than kept in tailos, is stored in
// R2 and served by functions/downloads/[name].js. Its bytes are not in tailos, so
// the entry carries the checksum tools/upload-download.mjs verified the uploaded
// object against, and SHA256SUMS publishes that. `compress` means what it means
// for a tailos download: the object is the gzip of the file, served as name.gz,
// and the checksum is of the file as a reader holds it after gunzip.
function validateR2Download(entry, claim) {
  if (entry.path !== undefined) {
    throw new AllowlistError(`an R2 download has a name, not a path: ${JSON.stringify(entry)}`);
  }
  if (entry.compress !== undefined && typeof entry.compress !== 'boolean') {
    throw new AllowlistError(`compress must be true or false: ${entry.name}`);
  }
  if (typeof entry.name !== 'string' || !R2_DOWNLOAD_NAME.test(entry.name)) {
    throw new AllowlistError(`an R2 download needs a plain file name: ${JSON.stringify(entry)}`);
  }
  if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
    throw new AllowlistError(`R2 download ${entry.name} needs its sha256 as 64 lowercase hex digits`);
  }
  const compress = entry.compress === true;
  const published = publishedName(entry.name, compress);
  claim(published);
  return { storage: 'r2', name: entry.name, published, compress, sha256: entry.sha256 };
}

// A clone made without Git LFS content holds a short text pointer where each large
// file should be. Published, a pointer would be checksummed and served as though it
// were the image, and only a reader booting it would find out.
export function isLfsPointer(bytes) {
  return bytes.length < 1024 && bytes.subarray(0, 64).toString('latin1').startsWith('version https://git-lfs.github.com/spec/');
}

export function assertNotLfsPointer(bytes, path) {
  if (isLfsPointer(bytes)) {
    throw new AllowlistError(`download ${path} is a Git LFS pointer, not the file: fetch its content (git lfs pull) before generating`);
  }
}
