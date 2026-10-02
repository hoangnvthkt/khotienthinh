import { describe, expect, it } from 'vitest';
import { CODE_OPTIONS, EDITOR_META, REQUEST_KINDS, codeLabel, describePayload, missingRequired } from '../hrmProfileFields';

describe('hrmProfileFields', () => {
  it('lists the 34 provinces of the two-tier government, without districts', () => {
    expect(CODE_OPTIONS.provinceCode).toHaveLength(34);
    expect(new Set(CODE_OPTIONS.provinceCode.map(([code]) => code)).size).toBe(34);
    expect(codeLabel('provinceCode', 'HA_NOI')).toBe('TP. Hà Nội');
    expect(EDITOR_META.address.fields.map(field => field.key)).not.toContain('districtCode');
  });

  it('describes a request payload with labels instead of codes', () => {
    expect(describePayload('address', {
      addressType: 'CURRENT', provinceCode: 'HA_NOI', wardName: 'Phường Cầu Giấy', addressLine: 'Số 1',
    })).toEqual([
      ['Loại địa chỉ', 'Nơi ở hiện tại'], ['Tỉnh / thành phố', 'TP. Hà Nội'],
      ['Xã / phường', 'Phường Cầu Giấy'], ['Số nhà, đường, thôn / xóm', 'Số 1'],
    ]);
    expect(describePayload('identity', { documentTypeCode: 'CCCD', expiryDate: '2040-01-31', issuedPlace: '' }))
      .toEqual([['Loại giấy tờ', 'Căn cước / CCCD'], ['Ngày hết hạn', '31/01/2040']]);
  });

  it('reports missing required fields by label', () => {
    expect(missingRequired(EDITOR_META.bank.fields, { bankCode: 'VCB', accountNumber: ' ' }))
      .toEqual(['Số tài khoản', 'Chủ tài khoản']);
  });

  it('offers every request kind the server accepts, except tax which follows the ID number', () => {
    expect(REQUEST_KINDS.map(item => item.kind).sort()).toEqual(
      ['address', 'bank', 'certification', 'dependent', 'identity', 'insurance', 'other', 'qualification'],
    );
  });
});
