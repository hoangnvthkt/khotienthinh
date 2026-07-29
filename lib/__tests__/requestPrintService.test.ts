import { describe, expect, it } from 'vitest';
import { buildRequestPrintFileName, buildRequestPrintTokens } from '../requestPrintService';

const detail = {
  id: 'rq-1', code: 'RQ-2026-000001', title: 'Đề xuất mua máy tính', description: 'Nội dung',
  creator: { id: 'u-1', name: 'Nguyễn Văn A', avatarUrl: null, position: 'IT' },
  templateName: 'Mua sắm', createdAt: '2026-07-29T08:00:00.000Z',
  formSchema: [{ key: 'amount', label: 'Số tiền', fieldType: 'number', required: true, options: [], sortOrder: 1 }],
  formData: { amount: 25000000 }, approvalBlocks: [],
} as any;

describe('request print service', () => {
  it('projects stable scalar and custom-field tokens', () => {
    expect(buildRequestPrintTokens(detail)).toMatchObject({
      code: 'RQ-2026-000001', title: 'Đề xuất mua máy tính', field_amount: '25000000',
    });
  });

  it('sanitizes the downloaded filename', () => {
    expect(buildRequestPrintFileName('RQ-2026-000001', 'Mua máy / văn phòng'))
      .toBe('RQ-2026-000001-Mua-may-van-phong.docx');
  });
});
