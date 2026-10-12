import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const modal = readFileSync(join(process.cwd(), 'components/RequestModal.tsx'), 'utf8');

describe('material request return reason contract', () => {
  it('asks for the return reason in its own dialog instead of the locked note field', () => {
    expect(modal).toContain('<ReasonConfirmModal');
    expect(modal).toContain('onConfirm={confirmReturnRequest}');
    expect(modal).not.toContain("toast.warning('Thiếu lý do trả lại'");
  });

  it('sends the typed reason back to the requester as a returned draft', () => {
    expect(modal).toContain("updateRequestStatus(request.id, RequestStatus.DRAFT, reason, undefined, undefined, undefined, 'RETURNED')");
    expect(modal).toContain('Trả về người lập:');
  });
});
