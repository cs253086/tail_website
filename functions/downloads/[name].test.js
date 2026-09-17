import { describe, expect, it, vi } from 'vitest';

const NAME = 'tail-sdk-installer-0.1.0.tar.gz';

vi.mock('../../generated/downloads.json', () => ({ default: { r2: [NAME] } }));
const { onRequest } = await import('./[name].js');

const BYTES = Uint8Array.from({ length: 32 }, (_, i) => i);
const ETAG = '"5d41402abc4b2a76b9719d911017c592"';

// Just enough of an R2 bucket binding: head() describes an object, get() returns
// it with a body, sliced when a range is asked for.
function fakeBucket(objects = { [NAME]: BYTES }) {
  const calls = { head: 0, get: [] };
  const describeObject = (key) => ({
    key,
    size: objects[key].length,
    httpEtag: ETAG,
    writeHttpMetadata: (headers) => headers.set('content-type', 'application/gzip'),
  });
  return {
    calls,
    async head(key) {
      calls.head += 1;
      return key in objects ? describeObject(key) : null;
    },
    async get(key, options) {
      calls.get.push(options);
      const { offset = 0, length = objects[key].length - offset } = options?.range ?? {};
      return { ...describeObject(key), body: new Blob([objects[key].slice(offset, offset + length)]).stream() };
    },
  };
}

const STATIC_SITE = new Response('static site');

const serve = ({ name = NAME, method = 'GET', headers = {}, bucket = fakeBucket() } = {}) => onRequest({
  request: new Request(`https://tail-os.com/downloads/${name}`, { method, headers }),
  env: { DOWNLOADS: bucket },
  params: { name },
  next: () => STATIC_SITE,
});

const bytesOf = async (response) => new Uint8Array(await response.arrayBuffer());

describe('downloads served from R2', () => {
  it('serves a published download whole, with what a client needs to resume it', async () => {
    const response = await serve();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/gzip');
    expect(response.headers.get('content-length')).toBe('32');
    expect(response.headers.get('etag')).toBe(ETAG);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(await bytesOf(response)).toEqual(BYTES);
  });

  it('leaves any other name to the static site without touching the bucket', async () => {
    const bucket = fakeBucket({ [NAME]: BYTES, 'private.tar.gz': BYTES });
    expect(await serve({ name: 'private.tar.gz', bucket })).toBe(STATIC_SITE);
    expect(bucket.calls.head).toBe(0);
  });

  it('answers 404 for a published name whose object was never uploaded', async () => {
    expect((await serve({ bucket: fakeBucket({}) })).status).toBe(404);
  });

  it('refuses a method other than GET or HEAD', async () => {
    const response = await serve({ method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('answers HEAD with the size and no body, without reading the object', async () => {
    const bucket = fakeBucket();
    const response = await serve({ method: 'HEAD', headers: { range: 'bytes=0-9' }, bucket });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('32');
    expect((await bytesOf(response)).length).toBe(0);
    expect(bucket.calls.get).toEqual([]);
  });

  it.each([
    ['a closed range', 'bytes=10-19', 10, 19],
    ['the rest of the file, as a resumed download asks', 'bytes=30-', 30, 31],
    ['the last bytes', 'bytes=-5', 27, 31],
    ['a range running past the end, cut at the end', 'bytes=28-99', 28, 31],
  ])('serves %s as partial content', async (_, range, first, last) => {
    const response = await serve({ headers: { range } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes ${first}-${last}/32`);
    expect(response.headers.get('content-length')).toBe(String(last - first + 1));
    expect(await bytesOf(response)).toEqual(BYTES.slice(first, last + 1));
  });

  it('answers 416 for a range starting past the end, as a finished download resumed again asks', async () => {
    const response = await serve({ headers: { range: 'bytes=32-' } });
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */32');
  });

  it.each([['several ranges', 'bytes=0-1,4-5'], ['a reversed range', 'bytes=9-2'], ['another unit', 'items=0-1']])(
    'ignores %s and serves the whole file',
    async (_, range) => {
      const response = await serve({ headers: { range } });
      expect(response.status).toBe(200);
      expect(await bytesOf(response)).toEqual(BYTES);
    },
  );

  it('resumes only from the same file: a stale If-Range gets the whole file', async () => {
    const stale = await serve({ headers: { range: 'bytes=10-', 'if-range': '"an-older-build"' } });
    expect(stale.status).toBe(200);
    expect(await bytesOf(stale)).toEqual(BYTES);

    const current = await serve({ headers: { range: 'bytes=10-', 'if-range': ETAG } });
    expect(current.status).toBe(206);
  });

  it.each([['its etag', ETAG], ['its weak etag', `W/${ETAG}`], ['a list holding it', `"other", ${ETAG}`], ['*', '*']])(
    'answers 304 when If-None-Match names %s',
    async (_, ifNoneMatch) => {
      const bucket = fakeBucket();
      const response = await serve({ headers: { 'if-none-match': ifNoneMatch }, bucket });
      expect(response.status).toBe(304);
      expect(bucket.calls.get).toEqual([]);
    },
  );

  it('serves the file when If-None-Match names another version', async () => {
    expect((await serve({ headers: { 'if-none-match': '"an-older-build"' } })).status).toBe(200);
  });
});
