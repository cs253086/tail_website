import { describe, expect, it } from 'vitest';
import { AllowlistError, assertAllowlisted, assertNotLfsPointer, rewriteLink, validateAllowlist, validateDownloads, validateOrigin } from './allowlist.mjs';

const SOURCE_ROOT = '/src/tailos';
const exists = () => true;
const entry = (path, slug) => ({ path, slug, title: 'T', summary: 'S' });

describe('validateAllowlist', () => {
  it('accepts a place in the hierarchy and a navigation title', () => {
    const list = { documents: [{ ...entry('doc/a.md', 'a'), nav: ['BSP'], navTitle: 'QEMU' }] };
    expect(() => validateAllowlist(list, SOURCE_ROOT, exists)).not.toThrow();
  });

  it('refuses nav written as a string, which would nest the page one group per character', () => {
    const list = { documents: [{ ...entry('doc/a.md', 'a'), nav: 'BSP' }] };
    expect(() => validateAllowlist(list, SOURCE_ROOT, exists)).toThrow(/nav must be a list/);
  });

  it('refuses a blank group name', () => {
    const list = { documents: [{ ...entry('doc/a.md', 'a'), nav: ['Development guide', ' '] }] };
    expect(() => validateAllowlist(list, SOURCE_ROOT, exists)).toThrow(/nav must be a list/);
  });

  it('refuses a blank navigation title, which would publish a link with no text', () => {
    const list = { documents: [{ ...entry('doc/a.md', 'a'), navTitle: '' }] };
    expect(() => validateAllowlist(list, SOURCE_ROOT, exists)).toThrow(/navTitle/);
  });

  it('accepts a well-formed list', () => {
    const map = validateAllowlist({ documents: [entry('doc/a.md', 'a')] }, SOURCE_ROOT, exists);
    expect(map.get('doc/a.md').absolute).toBe('/src/tailos/doc/a.md');
  });

  it('refuses an entry that escapes the source root', () => {
    const list = { documents: [entry('../../etc/passwd', 'leak')] };
    expect(() => validateAllowlist(list, SOURCE_ROOT, exists)).toThrow(/escapes the source root/);
  });

  it('refuses an absolute path outside the source root', () => {
    const list = { documents: [entry('/etc/shadow', 'leak')] };
    expect(() => validateAllowlist(list, SOURCE_ROOT, exists)).toThrow(AllowlistError);
  });

  it('refuses duplicate paths and duplicate slugs', () => {
    expect(() => validateAllowlist(
      { documents: [entry('doc/a.md', 'a'), entry('doc/a.md', 'b')] }, SOURCE_ROOT, exists,
    )).toThrow(/duplicate allowlist entry/);

    expect(() => validateAllowlist(
      { documents: [entry('doc/a.md', 'a'), entry('doc/b.md', 'a')] }, SOURCE_ROOT, exists,
    )).toThrow(/duplicate slug/);
  });

  it('refuses an entry missing required metadata', () => {
    expect(() => validateAllowlist({ documents: [{ path: 'doc/a.md' }] }, SOURCE_ROOT, exists))
      .toThrow(/missing slug/);
  });

  it('refuses a file that does not exist', () => {
    expect(() => validateAllowlist({ documents: [entry('doc/a.md', 'a')] }, SOURCE_ROOT, () => false))
      .toThrow(/does not exist/);
  });

  it('refuses an empty list rather than publishing nothing silently', () => {
    expect(() => validateAllowlist({ documents: [] }, SOURCE_ROOT, exists)).toThrow(/no documents/);
  });
});

describe('assertAllowlisted', () => {
  it('is the last gate before a file is published', () => {
    const allowed = new Map([['doc/a.md', {}]]);
    expect(() => assertAllowlisted('doc/a.md', allowed)).not.toThrow();
    expect(() => assertAllowlisted('kernel/doc/kernel_design_internal.md', allowed))
      .toThrow(/not on the allowlist/);
  });
});

describe('rewriteLink', () => {
  const allowed = new Map([
    ['doc/install_qemu.md', { slug: 'qemu' }],
    ['doc/get_started.md', { slug: 'getting-started' }],
  ]);

  it('turns a link to an allowlisted document into an internal link', () => {
    expect(rewriteLink('install_qemu.md', 'doc/install_rpi3.md', allowed)).toBe('/docs/qemu/');
  });

  it('preserves the fragment on an internal link', () => {
    expect(rewriteLink('get_started.md#developer-setup', 'doc/install_qemu.md', allowed))
      .toBe('/docs/getting-started/#developer-setup');
  });

  // The repository is private, so an unpublished file has no reachable URL.
  // Unlinking leaves the text; pointing at a repository nobody can open would not.
  it('unlinks a repository file that is not published', () => {
    expect(rewriteLink('../utility/host/dev_setup/dev_setup.sh', 'doc/get_started.md', allowed)).toBeNull();
    expect(rewriteLink('buildsystem.md', 'doc/install_qemu.md', allowed)).toBeNull();
  });

  it('unlinks a path that climbs above the repository root', () => {
    expect(rewriteLink('../../secrets.md', 'doc/a.md', allowed)).toBeNull();
  });

  it('leaves absolute, mail and in-page links untouched', () => {
    expect(rewriteLink('https://example.test/x', 'doc/a.md', allowed)).toBe('https://example.test/x');
    expect(rewriteLink('#prerequisites', 'doc/a.md', allowed)).toBe('#prerequisites');
    expect(rewriteLink('mailto:x@example.test', 'doc/a.md', allowed)).toBe('mailto:x@example.test');
  });
});

describe('validateOrigin', () => {
  it('accepts a bare https origin', () => {
    expect(validateOrigin('https://tail-os.com')).toBe('https://tail-os.com');
  });

  it('normalises away a trailing slash, so paths are never doubled', () => {
    expect(validateOrigin('https://tail-os.com/')).toBe('https://tail-os.com');
  });

  it('rejects a missing origin rather than emitting undefined URLs', () => {
    expect(() => validateOrigin(undefined)).toThrow(AllowlistError);
    expect(() => validateOrigin('')).toThrow(/missing origin/);
  });

  it('rejects a non-URL', () => {
    expect(() => validateOrigin('tail-os.com')).toThrow(/not a URL/);
  });

  it('rejects http, which would publish canonical URLs the site cannot serve', () => {
    expect(() => validateOrigin('http://tail-os.com')).toThrow(/must be https/);
  });

  it('rejects an origin carrying a path', () => {
    expect(() => validateOrigin('https://tail-os.com/docs')).toThrow(/bare scheme and host/);
    expect(() => validateOrigin('https://tail-os.com/?a=1')).toThrow(/bare scheme and host/);
  });
});

describe('validateDownloads', () => {
  const downloads = (list, exist = exists) => validateDownloads({ downloads: list }, SOURCE_ROOT, exist);

  it('treats a missing list as no downloads', () => {
    expect(validateDownloads({}, SOURCE_ROOT, exists)).toEqual([]);
  });

  it('publishes a compressed file with .gz and a plain one under its own name', () => {
    expect(downloads([{ path: 'tail_disk.img', compress: true }, { path: 'scripts/run_tailos_qemu.sh' }])
      .map(({ name, published, compress }) => ({ name, published, compress })))
      .toEqual([
        { name: 'tail_disk.img', published: 'tail_disk.img.gz', compress: true },
        { name: 'run_tailos_qemu.sh', published: 'run_tailos_qemu.sh', compress: false },
      ]);
  });

  it('refuses a download that escapes the source root', () => {
    expect(() => downloads([{ path: '../elsewhere/secret.img' }])).toThrow(/escapes the source root/);
  });

  it('refuses a download that does not exist, rather than publishing nothing', () => {
    expect(() => downloads([{ path: 'tail_qemu.rfs' }], () => false)).toThrow(/does not exist/);
  });

  it('refuses two downloads that would publish to one URL', () => {
    expect(() => downloads([{ path: 'a/README.md' }, { path: 'b/README.md' }])).toThrow(/would publish as README.md/);
  });

  it('refuses a compress flag that is not a boolean', () => {
    expect(() => downloads([{ path: 'tail_disk.img', compress: 'yes' }])).toThrow(/compress must be true or false/);
  });
});

describe('assertNotLfsPointer', () => {
  const pointer = Buffer.from(
    'version https://git-lfs.github.com/spec/v1\n'
      + 'oid sha256:a58d3d552fef0112070f4fda10bb6772a702dbd5707f902297e3af531adccc77\n'
      + 'size 6713264\n',
  );

  it('refuses a download that is still a Git LFS pointer', () => {
    expect(() => assertNotLfsPointer(pointer, 'tail_qemu.rfs')).toThrow(/tail_qemu\.rfs is a Git LFS pointer/);
  });

  it('accepts the files a download actually holds', () => {
    expect(() => assertNotLfsPointer(Buffer.from('#!/usr/bin/env bash\n# TailOS QEMU one-command launcher.\n'), 'scripts/run_tailos_qemu.sh')).not.toThrow();
    expect(() => assertNotLfsPointer(Buffer.alloc(4096), 'tail_disk.img')).not.toThrow();
  });
});
