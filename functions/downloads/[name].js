// Downloads too large for Pages, served from R2.
//
// Pages refuses any file over 25 MiB, so the SDK installer is kept in the
// tail-os-downloads bucket. Only names the generator published are served:
// public/_routes.json routes just those here, and the manifest check below keeps
// every other object in the bucket unreachable even if that routing widened.

import published from '../../generated/downloads.json';

const listed = new Set(published.r2);
const UNSATISFIABLE = Symbol('unsatisfiable');

export async function onRequest({ request, env, params, next }) {
  const { name } = params;
  if (!listed.has(name)) return next();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }

  const object = await env.DOWNLOADS.head(name);
  // Published but not uploaded: the allowlist entry went live before its object.
  if (!object) {
    return new Response('Not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  // Revalidated like every other download (DESIGN.md §9.1): a rebuilt file keeps
  // its name, and the etag makes revalidating it cheap.
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  headers.set('accept-ranges', 'bytes');
  headers.set('x-content-type-options', 'nosniff');

  if (etagListMatches(request.headers.get('if-none-match'), object.httpEtag)) {
    return new Response(null, { status: 304, headers });
  }

  const range = request.method === 'GET' ? requestedRange(request, object) : null;
  if (range === UNSATISFIABLE) {
    headers.set('content-range', `bytes */${object.size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set('content-length', String(range ? range.length : object.size));
  if (range) headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  const status = range ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });

  const { body } = await env.DOWNLOADS.get(name, range ? { range } : {});
  return new Response(body, { status, headers });
}

function etagListMatches(header, etag) {
  if (header === null) return false;
  if (header.trim() === '*') return true;
  // If-None-Match compares weakly: W/"x" matches "x".
  const opaque = (tag) => tag.trim().replace(/^W\//, '');
  return header.split(',').some((tag) => opaque(tag) === opaque(etag));
}

// One byte range, the kind a resumed download asks for. A multi-range or
// malformed Range is ignored and the whole file sent, which RFC 9110 permits.
function requestedRange(request, object) {
  // A resuming client sends If-Range with the etag its first part came from. If
  // the file was rebuilt since, stitching the two would corrupt it, so the client
  // gets the whole new file instead.
  const ifRange = request.headers.get('if-range');
  if (ifRange !== null && ifRange.trim() !== object.httpEtag) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range')?.trim() ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return null;
  const { size } = object;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return UNSATISFIABLE;
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const offset = Number(match[1]);
  if (offset >= size) return UNSATISFIABLE;
  const last = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (last < offset) return null;
  return { offset, length: last - offset + 1 };
}
