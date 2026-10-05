import { describe, expect, it } from 'vitest';
import { getClipboardFiles } from '../clipboardFiles';

const clipboard = (files: File[], items: Array<{ kind: string; file?: File }> = []) => ({
  files,
  items: items.map(item => ({ kind: item.kind, getAsFile: () => item.file ?? null })),
}) as unknown as DataTransfer;

const now = new Date(2026, 9, 5, 9, 7, 3);

describe('getClipboardFiles', () => {
  it('returns nothing for a plain-text paste', () => {
    expect(getClipboardFiles(clipboard([], [{ kind: 'string' }]), now)).toEqual([]);
    expect(getClipboardFiles(null, now)).toEqual([]);
  });

  it('renames generic screenshot names and keeps real file names', () => {
    const files = getClipboardFiles(clipboard([
      new File(['a'], 'image.png', { type: 'image/png' }),
      new File(['b'], 'Bản vẽ móng.pdf', { type: 'application/pdf' }),
    ]), now);

    expect(files.map(file => file.name)).toEqual(['anh-dan-20261005-090703-1.png', 'Bản vẽ móng.pdf']);
    expect(files[0].type).toBe('image/png');
  });

  it('falls back to clipboard items when the file list is empty', () => {
    const files = getClipboardFiles(clipboard([], [{ kind: 'file', file: new File(['c'], 'image.jpeg', { type: 'image/jpeg' }) }]), now);

    expect(files.map(file => file.name)).toEqual(['anh-dan-20261005-090703.jpg']);
  });
});
