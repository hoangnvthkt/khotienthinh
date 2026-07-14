import { describe, expect, it } from 'vitest';
import { isRecoverableAssetLoadError } from '../assetLoadRecovery';

describe('isRecoverableAssetLoadError', () => {
  it('recognizes a JavaScript MIME mismatch as a recoverable asset load failure', () => {
    expect(isRecoverableAssetLoadError(new Error("'text/html' is not a valid JavaScript MIME type."))).toBe(true);
  });

  it('does not reload for an unrelated application error', () => {
    expect(isRecoverableAssetLoadError(new Error('Không thể lưu dữ liệu.'))).toBe(false);
  });
});
