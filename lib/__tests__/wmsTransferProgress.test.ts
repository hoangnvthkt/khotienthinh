import { describe, expect, it } from 'vitest';
import { deriveTransferProgress } from '../wmsTransferProgress';

describe('deriveTransferProgress', () => {
  it('keeps partial receipts in transit and closes after the final receipt', () => {
    expect(deriveTransferProgress({ dispatched: '10', received: '6', returned: '0', lost: '0' })).toEqual({
      inTransit: '4',
      complete: false,
    });
    expect(deriveTransferProgress({ dispatched: '10', received: '10', returned: '0', lost: '0' })).toEqual({
      inTransit: '0',
      complete: true,
    });
  });

  it('rejects a disposition total greater than dispatched', () => {
    expect(() => deriveTransferProgress({ dispatched: '10', received: '6', returned: '3', lost: '2' }))
      .toThrow('WMS_TRANSFER_DISPOSITION_EXCEEDED');
  });
});
