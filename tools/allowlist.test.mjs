import { describe, expect, it } from 'vitest';
import { AllowlistError, assertAllowlisted, rewriteLink, validateAllowlist } from './allowlist.mjs';

const SOURCE_ROOT = '/src/tailos';
const exists = () => true;
const entry = (path, slug) => ({ path, slug, title: 'T', summary: 'S' });

describe('validateAllowlist', () => {
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
