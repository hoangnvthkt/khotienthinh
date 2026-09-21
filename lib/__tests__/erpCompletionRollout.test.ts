import { describe, expect, it } from 'vitest';
import { mapErpCompletionCommandError } from '../erpCompletionRollout';

describe('ERP completion rollout errors', () => {
  it('turns the server gate code into actionable pilot copy', () => {
    const error = mapErpCompletionCommandError({
      code: '42501', message: 'ERP_COMPLETION_PILOT_COMMAND_DISABLED', details: 'hidden',
    }) as Error & { code?: string };

    expect(error.message).toContain('chưa được mở hoặc đang tạm dừng');
    expect(error.message).toContain('Dữ liệu chưa thay đổi');
    expect(error.code).toBe('ERP_COMPLETION_PILOT_COMMAND_DISABLED');
  });

  it('preserves unrelated errors for their existing domain mapper', () => {
    const source = { code: '40001', message: 'STALE_VERSION' };
    expect(mapErpCompletionCommandError(source)).toBe(source);
  });
});
