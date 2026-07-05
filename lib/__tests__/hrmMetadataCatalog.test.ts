import { describe, expect, it } from 'vitest';
import {
  dedupeHrmCatalogRows,
  findHrmCatalogItem,
  normalizeHrmMetadataKey,
  validateHrmCatalogReference,
} from '../hrmMetadataCatalog';

describe('hrmMetadataCatalog', () => {
  it('normalizes metadata codes and Vietnamese names for stable matching', () => {
    expect(normalizeHrmMetadataKey('  Phó phòng QLĐA  ')).toBe('pho phong qlda');
    expect(normalizeHrmMetadataKey('36T')).toBe('36t');
  });

  it('dedupes exact catalog rows by catalog key, code and normalized name', () => {
    const rows = dedupeHrmCatalogRows([
      { catalogKey: 'labor_contract_type', code: '36T', name: '36 tháng' },
      { catalogKey: 'labor_contract_type', code: '36T', name: '36 tháng' },
      { catalogKey: 'labor_contract_type', code: '24T', name: '24 tháng' },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.code)).toEqual(['36T', '24T']);
  });

  it('finds active catalog items by code first and then normalized name', () => {
    const items = [
      { id: '1', catalogKey: 'employment_status', code: 'DL', name: 'Đang làm' },
      { id: '2', catalogKey: 'employment_status', code: 'NV', name: 'Nghỉ việc' },
      { id: '3', catalogKey: 'education_level', code: 'DH', name: 'Đại học' },
    ];

    expect(findHrmCatalogItem(items, 'employment_status', 'NV')?.id).toBe('2');
    expect(findHrmCatalogItem(items, 'education_level', 'dai hoc')?.id).toBe('3');
    expect(findHrmCatalogItem([{ ...items[0], isActive: false }], 'employment_status', 'DL')).toBeUndefined();
  });

  it('validates metadata references with a clear import error', () => {
    const items = [
      { id: '1', catalogKey: 'social_insurance_status', code: 'TG', name: 'Tham gia' },
    ];

    expect(validateHrmCatalogReference(items, 'social_insurance_status', 'TG', 'Mã BHXH')).toEqual({ id: '1' });
    expect(validateHrmCatalogReference(items, 'social_insurance_status', 'SAI', 'Mã BHXH')).toEqual({
      error: 'Mã BHXH "SAI" không tồn tại trong metadata HRM.',
    });
  });
});
