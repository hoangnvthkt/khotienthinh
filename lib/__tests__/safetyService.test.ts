import { describe, expect, it } from 'vitest';
import { getSafetyEquipmentDocumentsStatus } from '../safetyService';

describe('safetyService helpers', () => {
  it('computes equipment document status from checklist completion', () => {
    expect(getSafetyEquipmentDocumentsStatus([])).toBe('missing');
    expect(getSafetyEquipmentDocumentsStatus([{ isDone: false }, { isDone: false }])).toBe('partial');
    expect(getSafetyEquipmentDocumentsStatus([{ isDone: true }, { isDone: false }])).toBe('partial');
    expect(getSafetyEquipmentDocumentsStatus([{ isDone: true }, { isDone: true }])).toBe('complete');
  });
});
