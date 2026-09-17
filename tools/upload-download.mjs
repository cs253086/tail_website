// Uploads a download too large for Pages to R2, and records it in the allowlist.
//
//   node tools/upload-download.mjs <file>
//
// The file is recorded only after the uploaded object has been read back and
// hashes to what was uploaded, so SHA256SUMS never publishes a checksum the
// served file would fail. Regenerate afterwards to publish it.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { R2_DOWNLOAD_NAME } from './allowlist.mjs';

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

async function readBack(bucket, name) {
  const child = spawn('npx', ['wrangler', 'r2', 'object', 'get', `${bucket}/${name}`, '--pipe'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = new Promise((resolveExit) => child.on('close', resolveExit));
  const hash = await sha256Of(child.stdout);
  const code = await exited;
  if (code !== 0) fail(`reading ${bucket}/${name} back failed (wrangler exited ${code}); the allowlist was not changed`);
  return hash;
}

async function main(file) {
  if (!file) fail('usage: node tools/upload-download.mjs <file>');
  const name = basename(file);
  if (!R2_DOWNLOAD_NAME.test(name)) fail(`${name} is not a plain file name`);
  const { size } = statSync(file);
  if (size > WRANGLER_UPLOAD_LIMIT) fail(`${name} is ${size} bytes, and wrangler uploads at most ${WRANGLER_UPLOAD_LIMIT}`);

  const bucket = bucketName(readFileSync(join(ROOT, 'wrangler.toml'), 'utf8'));
  const sha256 = await sha256Of(createReadStream(file));
  console.error(`upload-download: ${name}, ${size} bytes, sha256 ${sha256}`);

  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/${name}`, '--file', resolve(file), '--content-type', contentTypeFor(name)], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const served = await readBack(bucket, name);
  if (served !== sha256) fail(`${bucket}/${name} hashes to ${served} after upload, not ${sha256}; the allowlist was not changed`);

  const allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
  writeFileSync(ALLOWLIST, `${JSON.stringify(withR2Download(allowlist, { storage: 'r2', name, sha256 }), null, 2)}\n`);
  console.error(`upload-download: verified ${bucket}/${name} and recorded it in content/allowlist.json; regenerate to publish it`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv[2]);
