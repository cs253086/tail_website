// Uploads a download to R2 -- one too large for Pages, or one built rather than
// kept in tailos -- and records it in the allowlist.
//
//   node tools/upload-download.mjs [--compress] <file>
//
// With --compress the object is the file's gzip, served as <file>.gz, while the
// allowlist records the checksum of the file itself: what SHA256SUMS lists and
// what a reader verifies after gunzip. The file is recorded only after the
// uploaded object has been read back and hashes to what was uploaded (and, when
// compressed, gunzips to the file), so SHA256SUMS never publishes a checksum the
// served file would fail. Regenerate afterwards to publish it.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';

import { R2_DOWNLOAD_NAME, gzipDownload, publishedName } from './allowlist.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST = join(ROOT, 'content/allowlist.json');

// wrangler r2 object put refuses anything larger (its MAX_UPLOAD_SIZE).
export const WRANGLER_UPLOAD_LIMIT = 300 * 1024 * 1024;

export function bucketName(wranglerToml) {
  const match = /\[\[r2_buckets\]\][^[]*?bucket_name\s*=\s*"([^"]+)"/.exec(wranglerToml);
  if (!match) throw new Error('wrangler.toml binds no R2 bucket ([[r2_buckets]] bucket_name)');
  return match[1];
}

export function contentTypeFor(name) {
  return /\.(tar\.gz|tgz|gz)$/.test(name) ? 'application/gzip' : 'application/octet-stream';
}

// The object is stored with a content type and nothing else. A .gz stored with
// Content-Encoding: gzip would be unwrapped by the client as it arrives, and the
// launcher would then gunzip bytes that are no longer compressed.
export function putArgs(bucket, objectName, file) {
  return ['wrangler', 'r2', 'object', 'put', `${bucket}/${objectName}`, '--file', file, '--content-type', contentTypeFor(objectName)];
}

// `[--compress] <file>`, or null for anything else.
export function parseArgs(argv) {
  const compress = argv[0] === '--compress';
  const rest = compress ? argv.slice(1) : argv;
  if (rest.length !== 1 || rest[0].startsWith('--')) return null;
  return { compress, file: rest[0] };
}

// An uncompressed entry keeps the shape it always had, so re-uploading the SDK
// installer changes nothing in the allowlist but its checksum.
export function r2Entry(name, compress, sha256) {
  return compress ? { storage: 'r2', name, compress: true, sha256 } : { storage: 'r2', name, sha256 };
}

// Replaces the R2 entry of the same name where it stands, or appends one, so
// uploading a rebuilt file keeps the allowlist's order.
export function withR2Download(allowlist, entry) {
  const downloads = allowlist.downloads ?? [];
  const at = downloads.findIndex((download) => download.storage === 'r2' && download.name === entry.name);
  return {
    ...allowlist,
    downloads: at === -1 ? [...downloads, entry] : downloads.map((download, i) => (i === at ? entry : download)),
  };
}

function fail(message) {
  console.error(`upload-download: ${message}`);
  process.exit(1);
}

function sha256Of(stream) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    stream.on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolveHash(hash.digest('hex')));
  });
}

// The object's checksum as stored and, when it is compressed, as a reader holds it
// after gunzip. Both come from the one read.
async function readBack(bucket, objectName, compress) {
  const child = spawn('npx', ['wrangler', 'r2', 'object', 'get', `${bucket}/${objectName}`, '--pipe'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = new Promise((resolveExit) => child.on('close', resolveExit));
  const hashes = [sha256Of(child.stdout)];
  if (compress) hashes.push(sha256Of(child.stdout.pipe(createGunzip())));
  let stored;
  let content;
  try {
    [stored, content = stored] = await Promise.all(hashes);
  } catch (error) {
    fail(`reading ${bucket}/${objectName} back failed (${error.message}); the allowlist was not changed`);
  }
  const code = await exited;
  if (code !== 0) fail(`reading ${bucket}/${objectName} back failed (wrangler exited ${code}); the allowlist was not changed`);
  return { stored, content };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args) fail('usage: node tools/upload-download.mjs [--compress] <file>');
  const { compress, file } = args;
  const name = basename(file);
  if (!R2_DOWNLOAD_NAME.test(name)) fail(`${name} is not a plain file name`);
  const objectName = publishedName(name, compress);
  const bucket = bucketName(readFileSync(join(ROOT, 'wrangler.toml'), 'utf8'));

  // What SHA256SUMS will list: the file as a reader holds it.
  const content = await sha256Of(createReadStream(file));
  let upload = resolve(file);
  if (compress) {
    const staging = mkdtempSync(join(tmpdir(), 'upload-download-'));
    process.on('exit', () => rmSync(staging, { recursive: true, force: true }));
    upload = join(staging, objectName);
    writeFileSync(upload, gzipDownload(readFileSync(file)));
  }
  const { size } = statSync(upload);
  if (size > WRANGLER_UPLOAD_LIMIT) fail(`${objectName} is ${size} bytes, and wrangler uploads at most ${WRANGLER_UPLOAD_LIMIT}`);
  const stored = compress ? await sha256Of(createReadStream(upload)) : content;
  console.error(`upload-download: ${objectName}, ${size} bytes, sha256 ${stored}${compress ? `; ${name} sha256 ${content}` : ''}`);

  execFileSync('npx', putArgs(bucket, objectName, upload), { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
  const served = await readBack(bucket, objectName, compress);
  if (served.stored !== stored) fail(`${bucket}/${objectName} hashes to ${served.stored} after upload, not ${stored}; the allowlist was not changed`);
  if (served.content !== content) fail(`${bucket}/${objectName} gunzips to ${served.content}, not ${name}'s ${content}; the allowlist was not changed`);

  const allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
  writeFileSync(ALLOWLIST, `${JSON.stringify(withR2Download(allowlist, r2Entry(name, compress, content)), null, 2)}\n`);
  console.error(`upload-download: verified ${bucket}/${objectName} and recorded it in content/allowlist.json; regenerate to publish it`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
