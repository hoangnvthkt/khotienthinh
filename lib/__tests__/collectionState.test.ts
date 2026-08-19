import { describe, expect, it } from 'vitest';
import { upsertRowsById } from '../collectionState';

describe('collection state reconciliation', () => {
  it('keeps one row when local save and Realtime deliver the same id', () => {
    const realtimeRow = { id: 'user-1', name: 'Hà Đức Chuẩn', source: 'realtime' };
    const localRow = { id: 'user-1', name: 'Hà Đức Chuẩn', source: 'local' };

    const afterRealtime = upsertRowsById([], [realtimeRow]);
    const afterLocalSave = upsertRowsById(afterRealtime, [localRow]);

    expect(afterLocalSave).toEqual([localRow]);
  });

  it('repairs duplicate rows already present in client state', () => {
    const stale = { id: 'employee-1', employeeCode: '' };
    const canonical = { id: 'employee-1', employeeCode: 'TT060' };

    expect(upsertRowsById([stale, stale], [canonical])).toEqual([canonical]);
  });
});
