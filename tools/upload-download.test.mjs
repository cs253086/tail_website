import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bucketName, contentTypeFor, parseArgs, putArgs, r2Entry, withR2Download } from './upload-download.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = 'dd7d551749e1f69ca0209045d836fe4651fff0013149966cb3682bb5bf3457e6';

describe('bucketName', () => {
  it('reads the bucket the Pages project binds', () => {
    expect(bucketName(readFileSync(join(ROOT, 'wrangler.toml'), 'utf8'))).toBe('tail-os-downloads');
  });

  it('refuses a configuration that binds no bucket', () => {
    expect(() => bucketName('name = "tail-os"\n[[kv_namespaces]]\nbinding = "ANSWER_CACHE"\n')).toThrow(/binds no R2 bucket/);
  });
});

describe('contentTypeFor', () => {
  it('names a gzip archive as one', () => {
    expect(contentTypeFor('tail-sdk-installer-0.1.0.tar.gz')).toBe('application/gzip');
    expect(contentTypeFor('tail_disk.img.gz')).toBe('application/gzip');
  });

  it('falls back to bytes for anything else', () => {
    expect(contentTypeFor('bsp-rpi3.zip')).toBe('application/octet-stream');
  });
});

describe('putArgs', () => {
  it('stores a compressed image with its content type and no content encoding', () => {
    // With Content-Encoding: gzip the client would unwrap the image as it arrived,
    // and the launcher's gzip -dc would then fail on bytes no longer compressed.
    const args = putArgs('tail-os-downloads', 'tail_disk.img.gz', '/tmp/stage/tail_disk.img.gz');
    expect(args).toEqual([
      'wrangler', 'r2', 'object', 'put', 'tail-os-downloads/tail_disk.img.gz',
      '--file', '/tmp/stage/tail_disk.img.gz', '--content-type', 'application/gzip',
    ]);
    expect(args.join(' ')).not.toMatch(/content-encoding/i);
  });
});

describe('parseArgs', () => {
  it('reads a plain upload and a compressed one', () => {
    expect(parseArgs(['tail-sdk-installer-0.1.0.tar.gz'])).toEqual({ compress: false, file: 'tail-sdk-installer-0.1.0.tar.gz' });
    expect(parseArgs(['--compress', 'tail_disk.img'])).toEqual({ compress: true, file: 'tail_disk.img' });
  });

  it.each([[[]], [['--compress']], [['tail_disk.img', 'tail_qemu.rfs']], [['--gzip', 'tail_disk.img']], [['--compress', '--force']]])(
    'refuses %j rather than guessing',
    (argv) => {
      expect(parseArgs(argv)).toBeNull();
    },
  );
});

describe('r2Entry', () => {
  it('records a compressed upload with the checksum of the file itself', () => {
    expect(r2Entry('tail_disk.img', true, SHA)).toEqual({ storage: 'r2', name: 'tail_disk.img', compress: true, sha256: SHA });
  });

  it('keeps an uncompressed entry in the shape it always had', () => {
    expect(r2Entry('tail-sdk-installer-0.1.0.tar.gz', false, SHA)).toEqual({ storage: 'r2', name: 'tail-sdk-installer-0.1.0.tar.gz', sha256: SHA });
  });
});

describe('withR2Download', () => {
  const allowlist = {
    documents: [],
    downloads: [
      { path: 'tail_disk.img', compress: true },
      { storage: 'r2', name: 'tail-sdk-installer-0.1.0.tar.gz', sha256: '0'.repeat(64) },
      { path: 'scripts/run_tailos_qemu.sh' },
    ],
  };

  it('replaces a rebuilt file where it stands', () => {
    const entry = { storage: 'r2', name: 'tail-sdk-installer-0.1.0.tar.gz', sha256: SHA };
    expect(withR2Download(allowlist, entry).downloads).toEqual([allowlist.downloads[0], entry, allowlist.downloads[2]]);
  });

  it('appends a new file after the existing downloads', () => {
    const entry = { storage: 'r2', name: 'tail-sdk-installer-0.2.0.tar.gz', sha256: SHA };
    expect(withR2Download(allowlist, entry).downloads).toEqual([...allowlist.downloads, entry]);
  });

  it('does not mistake a tailos file of the same name for the R2 entry', () => {
    const entry = { storage: 'r2', name: 'tail_disk.img', sha256: SHA };
    expect(withR2Download({ downloads: [{ path: 'tail_disk.img' }] }, entry).downloads).toHaveLength(2);
  });
});
