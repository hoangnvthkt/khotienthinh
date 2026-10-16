import { describe, expect, it } from 'vitest';
import {
  canReadProfileCustomFields, formatCustomValue, groupProfileCustomFields, rosterBatchLink, rosterPersonLink,
  summarizeProfileCustomFields, type ProfileCustomField,
} from '../hrmProfileCustomFields';

const field = (patch: Partial<ProfileCustomField>): ProfileCustomField => ({
  id: 'f1', key: 'custom:abc123', label: 'Size áo', group: 'other', type: 'text', options: [], required: false,
  payOnly: false, hint: null, value: null, updatedAt: null, pending: null, ...patch,
});

describe('Thông tin thêm on a profile', () => {
  it('lets only the person and HR read the columns', () => {
    expect(['SELF', 'HR', 'HR_MANAGE'].map(canReadProfileCustomFields)).toEqual([true, true, true]);
    expect(['MANAGER', 'DIRECTORY', 'NONE', null, undefined].map(canReadProfileCustomFields)).toEqual([false, false, false, false, false]);
  });

  it('groups columns in the Bảng nhân sự order and leaves empty groups out', () => {
    const groups = groupProfileCustomFields([
      field({ id: 'a', group: 'other' }),
      field({ id: 'b', group: 'pay', payOnly: true }),
      field({ id: 'c', group: 'position' }),
      field({ id: 'd', group: 'position' }),
    ]);
    expect(groups.map(group => [group.key, group.fields.map(item => item.id)])).toEqual([
      ['position', ['c', 'd']], ['pay', ['b']], ['other', ['a']],
    ]);
    expect(groups[0].label).toBe('Vị trí công việc');
  });

  it('shows values the way people read them, never an empty value as 0', () => {
    expect(formatCustomValue('money', 6500000)).toBe('6.500.000 đ');
    expect(formatCustomValue('number', 12.5)).toBe('12,5');
    expect(formatCustomValue('date', '2026-10-16')).toBe('16/10/2026');
    expect(formatCustomValue('boolean', 'Có')).toBe('Có');
    expect(formatCustomValue('money', null)).toBe('');
    expect(formatCustomValue('number', '  ')).toBe('');
    expect(formatCustomValue('text', 'Biển số 29A-12345')).toBe('Biển số 29A-12345');
  });

  it('counts missing required columns and waiting changes', () => {
    expect(summarizeProfileCustomFields([
      field({ id: 'a', required: true, value: null }),
      field({ id: 'b', required: true, value: 'M', pending: { batchId: 'x', batchCode: 'PTD-2610-0001', value: 'L' } }),
      field({ id: 'c', required: false, value: null }),
    ])).toEqual({ total: 3, missing: 1, pending: 1 });
  });

  it('links to the person and the request in Bảng nhân sự', () => {
    expect(rosterPersonLink('e-1')).toBe('/hrm/employees?view=roster&person=e-1');
    expect(rosterBatchLink('b-1')).toBe('/hrm/employees?view=roster&tab=batches&batch=b-1');
  });
});
