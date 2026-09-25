import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMPARE_FILE_LIMIT, changedPaths, needsBuild, publishedPaths } from './publish.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const allowlist = {
  documents: [{ path: 'doc/quick_start_public.md' }, { path: 'framework/periodic/doc/periodic_python_public.md' }],
  downloads: [
    { path: 'tail_disk.img' },
    { path: 'scripts/run_tailos_qemu.sh' },
    { storage: 'r2', name: 'tail-sdk-installer-0.1.0.tar.gz', sha256: '0'.repeat(64) },
  ],
};
const lastBuilt = '4621c0b13a1f0c2d9e8b7a6f5e4d3c2b1a0f9e8d';
const newest = 'f51d0274890ab1c2d3e4f5a6b7c8d9e0f1a2b3c4';
const ahead = (...filenames) => ({ status: 'ahead', files: filenames.map((filename) => ({ filename })) });
const decide = (overrides) =>
  needsBuild({ event: 'workflow_dispatch', lastBuilt, newest, comparison: ahead(), allowlist, ...overrides });

describe('publishedPaths', () => {
  it('lists every document and tailos download, in allowlist order, and no R2 download', () => {
    expect(publishedPaths(allowlist)).toEqual([
      'doc/quick_start_public.md',
      'framework/periodic/doc/periodic_python_public.md',
      'tail_disk.img',
      'scripts/run_tailos_qemu.sh',
    ]);
  });

  it('covers everything the real allowlist publishes from tailos', () => {
    const real = JSON.parse(readFileSync(join(ROOT, 'content/allowlist.json'), 'utf8'));
    const fromTailos = (real.downloads ?? []).filter((download) => download.path);
    expect(publishedPaths(real)).toHaveLength(real.documents.length + fromTailos.length);
  });
});

describe('changedPaths', () => {
  it('counts both sides of a rename', () => {
    expect(changedPaths([{ filename: 'doc/quick_start.md', previous_filename: 'doc/quick_start_public.md' }]))
      .toEqual(['doc/quick_start.md', 'doc/quick_start_public.md']);
  });
});

describe('needsBuild', () => {
  it('builds whenever the site repository itself was pushed', () => {
    expect(decide({ event: 'push', newest: lastBuilt, comparison: null })).toBe(true);
  });

  it('builds when no earlier publish was recorded', () => {
    expect(decide({ lastBuilt: null, comparison: null })).toBe(true);
  });

  it('has nothing to publish when tailos has not moved', () => {
    expect(decide({ newest: lastBuilt, comparison: null })).toBe(false);
  });

  it('skips a tailos push that touches nothing the site publishes', () => {
    expect(decide({ comparison: ahead('kernel/src/main.rs', 'doc/qemu.md') })).toBe(false);
  });

  it('builds when a published document changed', () => {
    expect(decide({ comparison: ahead('kernel/src/main.rs', 'framework/periodic/doc/periodic_python_public.md') })).toBe(true);
  });

  it('builds when a download changed', () => {
    expect(decide({ comparison: ahead('tail_disk.img') })).toBe(true);
  });

  it('builds when a published file was renamed away', () => {
    const files = [{ filename: 'doc/quick_start.md', previous_filename: 'doc/quick_start_public.md' }];
    expect(decide({ comparison: { status: 'ahead', files } })).toBe(true);
  });

  it('builds when the comparison may have been cut short', () => {
    const files = Array.from({ length: COMPARE_FILE_LIMIT }, (_, i) => `toolchain/rust_tail/file_${i}.rs`);
    expect(decide({ comparison: ahead(...files) })).toBe(true);
  });

  it('builds when main was rewritten rather than moved forward', () => {
    expect(decide({ comparison: { status: 'diverged', files: [] } })).toBe(true);
  });
});
