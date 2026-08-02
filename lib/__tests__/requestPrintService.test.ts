import { describe, expect, it } from 'vitest';
import { buildBrowserPrintModel, buildRequestPrintFileName, buildRequestPrintTokens } from '../requestPrintService';

const detail = {
  id: 'rq-1', code: 'RQ-2026-000001', title: 'Đề xuất mua máy tính', description: 'Nội dung',
  creator: { id: 'u-1', name: 'Nguyễn Văn A', avatarUrl: null, position: 'IT' },
  templateName: 'Mua sắm', createdAt: '2026-07-29T08:00:00.000Z',
  formSchema: [{ key: 'amount', label: 'Số tiền', fieldType: 'number', required: true, options: [], sortOrder: 1 }],
  formData: { amount: 25000000 }, approvalBlocks: [],
  timeline: [
    { id: 'event-1', eventType: 'APPROVED', actor: { id: 'u-2', name: 'Trần Thị B', avatarUrl: null, position: null }, comment: 'Đồng ý mua theo báo giá.', createdAt: '2026-07-30T09:00:00.000Z' },
    { id: 'event-2', eventType: 'SUBMITTED', actor: { id: 'u-1', name: 'Nguyễn Văn A', avatarUrl: null, position: 'IT' }, comment: '   ', createdAt: '2026-07-29T08:00:00.000Z' },
  ],
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

  it('includes non-empty workflow comments in the browser print model', () => {
    expect(buildBrowserPrintModel(detail).notes).toEqual([
      {
        eventType: 'APPROVED',
        actorName: 'Trần Thị B',
        comment: 'Đồng ý mua theo báo giá.',
        createdAt: '2026-07-30T09:00:00.000Z',
      },
    ]);
  });
});
