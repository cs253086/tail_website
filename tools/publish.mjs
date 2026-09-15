// What a publish builds, and what it last built.
//
// The site publishes a handful of tailos files: the documents and downloads in
// content/allowlist.json. tailos asks for a publish on every push to its main,
// and most of those pushes touch nothing the site publishes, so a publish first
// compares the tailos commit it last built with the newest one. The list of
// published files lives only in the allowlist; neither workflow repeats it.
//
//   node tools/publish.mjs decide                    GitHub Actions outputs: sha, build, paths
//   node tools/publish.mjs downloads-key <tailos>     cache key for the download images
//   node tools/publish.mjs restore-downloads <tailos> restores each image from its LFS pointer
//   node tools/publish.mjs record <sha>              records the tailos commit a build used

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isLfsPointer } from './allowlist.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'generated/source.json');

// GitHub's compare API returns at most this many files. A list that long may
// have been cut short, so it cannot show that nothing published changed.
export const COMPARE_FILE_LIMIT = 300;

export function publishedPaths(allowlist) {
  return [
    ...allowlist.documents.map((document) => document.path),
    ...(allowlist.downloads ?? []).map((download) => download.path),
  ];
}

// A rename moves a published file as surely as an edit changes one.
export function changedPaths(files) {
  return files.flatMap((file) => [file.filename, file.previous_filename].filter(Boolean));
}

export function needsBuild({ event, lastBuilt, newest, comparison, allowlist }) {
  if (event === 'push') return true;
  if (!lastBuilt) return true;
  if (lastBuilt === newest) return false;
  // Anything but a plain fast-forward (a rewritten or reset main) cannot be
  // compared file by file with confidence.
  if (comparison.status !== 'ahead') return true;
  if (comparison.files.length >= COMPARE_FILE_LIMIT) return true;
  const published = new Set(publishedPaths(allowlist));
  return changedPaths(comparison.files).some((path) => published.has(path));
}

export function pointerOid(bytes) {
  return /^oid sha256:([0-9a-f]{64})$/m.exec(bytes.toString('latin1'))?.[1] ?? null;
}

// Keyed by the pointers, not the images: a pointer names its object's hash, so the
// key changes exactly when an image does, and computing it downloads nothing.
export function downloadsCacheKey(pointers) {
  const hash = createHash('sha256');
  for (const { path, bytes } of pointers) hash.update(path).update('\0').update(bytes).update('\0');
  return hash.digest('hex');
}

function fail(message) {
  console.error(`publish: ${message}`);
  process.exit(1);
}

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tail-os-publish',
    },
  });
  if (!response.ok) fail(`GitHub ${path} answered HTTP ${response.status}`);
  return response.json();
}

async function decide() {
  const repo = process.env.TAILOS_REPO;
  if (!repo) fail('TAILOS_REPO is not set');
  if (!process.env.GH_TOKEN) fail('GH_TOKEN is not set, so tailos cannot be read (set the TAILOS_READ_TOKEN secret)');
  const allowlist = JSON.parse(readFileSync(join(ROOT, 'content/allowlist.json'), 'utf8'));
  const event = process.env.EVENT ?? '';
  const lastBuilt = existsSync(SOURCE) ? JSON.parse(readFileSync(SOURCE, 'utf8')).tailosCommit : null;
  const newest = (await github(`/repos/${repo}/commits/main`)).sha;
  const comparison = event !== 'push' && lastBuilt && lastBuilt !== newest
    ? await github(`/repos/${repo}/compare/${lastBuilt}...${newest}`)
    : null;
  const build = needsBuild({ event, lastBuilt, newest, comparison, allowlist });
  console.error(
    `publish: ${event || 'no event'}, last built ${lastBuilt ?? 'nothing'}, newest ${newest}`
      + (comparison ? `, ${comparison.files.length} file(s) changed (${comparison.status})` : '')
      + ` -> ${build ? 'build' : 'nothing to publish'}`,
  );
  console.log(`sha=${newest}`);
  console.log(`build=${build}`);
  // Anchored, so the sparse checkout takes these paths and no same-named file elsewhere.
  console.log(['paths<<PUBLISHED_PATHS', '/.gitattributes', ...publishedPaths(allowlist).map((path) => `/${path}`), 'PUBLISHED_PATHS'].join('\n'));
}

function downloadPointers(root) {
  const allowlist = JSON.parse(readFileSync(join(ROOT, 'content/allowlist.json'), 'utf8'));
  return (allowlist.downloads ?? [])
    .map((download) => ({ path: download.path, bytes: readFileSync(join(root, download.path)) }))
    .filter(({ bytes }) => isLfsPointer(bytes));
}

// Each image comes from its own pointer. A command that scans the checkout for
// pointers (git lfs pull, git lfs ls-files) makes a blobless clone fetch every
// file in tailos just to look at it.
function restoreDownloads(root) {
  for (const { path, bytes } of downloadPointers(root)) {
    const oid = pointerOid(bytes);
    const content = execFileSync('git', ['-C', root, 'lfs', 'smudge', path], { input: bytes, maxBuffer: 1024 ** 3 });
    const actual = createHash('sha256').update(content).digest('hex');
    if (actual !== oid) fail(`${path}: restored content hashes to ${actual}, but its pointer names ${oid}`);
    writeFileSync(join(root, path), content);
    console.error(`publish: restored ${path} (${content.length} bytes, ${oid.slice(0, 12)})`);
  }
}

function record(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) fail(`record needs a full tailos commit id, got "${sha ?? ''}"`);
  writeFileSync(SOURCE, `${JSON.stringify({ tailosCommit: sha }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, argument] = process.argv.slice(2);
  if (command === 'decide') await decide();
  else if (command === 'downloads-key' && argument) console.log(`key=${downloadsCacheKey(downloadPointers(argument))}`);
  else if (command === 'restore-downloads' && argument) restoreDownloads(argument);
  else if (command === 'record') record(argument);
  else fail('usage: node tools/publish.mjs decide | downloads-key <tailos> | restore-downloads <tailos> | record <tailos-commit>');
}
