import { describe, expect, it } from 'vitest';
import { textToCopy } from './copy-text.js';

describe('textToCopy', () => {
  it('copies a block as shown, without the newline markdown leaves after it', () => {
    const block = { dataset: {}, textContent: '[dependencies]\nperiodic = { path = "<relative path to>/framework/periodic/lib" }\n' };
    expect(textToCopy(block)).toBe('[dependencies]\nperiodic = { path = "<relative path to>/framework/periodic/lib" }');
  });

  it('keeps blank lines and trailing blank lines inside the block', () => {
    expect(textToCopy({ dataset: {}, textContent: 'make run\n\nmake test\n\n' })).toBe('make run\n\nmake test\n');
  });

  it('copies data-copy instead when the block shows more than should be pasted', () => {
    const block = {
      dataset: { copy: 'curl -sSL https://tail-os.com/downloads/run_tailos_qemu.sh | bash' },
      textContent: '$ curl -sSL https://tail-os.com/downloads/run_tailos_qemu.sh | bash',
    };
    expect(textToCopy(block)).toBe('curl -sSL https://tail-os.com/downloads/run_tailos_qemu.sh | bash');
  });
});
