import { beforeEach, describe, expect, it, vi } from 'vitest';

const upload = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn(() => ({ upload, remove })));
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ supabase: { storage: { from }, rpc } }));

import { hrmPersonnelImportExportService } from '../hrmPersonnelImportExportService';

describe('hrmPersonnelImportExportService', () => {
  beforeEach(() => {
    upload.mockReset(); remove.mockReset(); from.mockClear(); rpc.mockReset();
  });

  it('uploads privately then creates, stages and previews one governed batch', async () => {
    upload.mockResolvedValueOnce({ error: null });
    rpc
      .mockResolvedValueOnce({ data: { batchId: 'batch-1' }, error: null })
      .mockResolvedValueOnce({ data: { status: 'STAGED' }, error: null })
      .mockResolvedValueOnce({ data: { batchId: 'batch-1', status: 'VALIDATED', validRows: 1, errorRows: 0, fingerprint: 'fp' }, error: null });
    const file = new File(['workbook'], 'Hồ sơ nhân sự.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const result = await hrmPersonnelImportExportService.uploadAndPreview({
      appUserId: 'user-1', file, rows: [{
        sheetCode: 'OVERVIEW', rowNumber: 2, employeeCode: 'TT194',
        recordCode: null, recordType: 'EMPLOYEE_CORE', payload: { phone: '0901' },
      }],
    });

    expect(from).toHaveBeenCalledWith('hrm-private-imports');
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(/^user-1\/.+\/Ho_so_nhan_su\.xlsx$/), file, expect.objectContaining({ upsert: false }));
    expect(rpc).toHaveBeenNthCalledWith(1, 'create_hrm_import_batch', expect.objectContaining({
      p_manifest: expect.objectContaining({ formatVersion: 1, dataSheetCount: 8, rowCount: 1 }),
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'stage_hrm_import_rows', {
      p_batch_id: 'batch-1', p_rows: expect.any(Array),
    });
    expect(rpc).toHaveBeenNthCalledWith(3, 'preview_hrm_import_batch', { p_batch_id: 'batch-1' });
    expect(result.fingerprint).toBe('fp');
  });

  it('applies only with reason and the preview fingerprint', async () => {
    rpc.mockResolvedValueOnce({ data: { batchId: 'batch-1', status: 'APPLIED', appliedRows: 2 }, error: null });

    await hrmPersonnelImportExportService.apply('batch-1', 'Đối chiếu hồ sơ nhân sự đợt 1', 'fingerprint-1');

    expect(rpc).toHaveBeenCalledWith('apply_hrm_import_batch', {
      p_batch_id: 'batch-1', p_reason: 'Đối chiếu hồ sơ nhân sự đợt 1',
      p_expected_fingerprint: 'fingerprint-1',
    });
  });

  it('uses the governed export projection with an audit reason', async () => {
    rpc.mockResolvedValueOnce({ data: { manifestHash: 'hash', employees: [] }, error: null });

    await hrmPersonnelImportExportService.exportProfiles(['employee-1'], 'Xuất để đối soát hồ sơ tháng 8');

    expect(rpc).toHaveBeenCalledWith('export_hrm_employee_profiles', {
      p_employee_ids: ['employee-1'], p_reason: 'Xuất để đối soát hồ sơ tháng 8',
    });
  });
});
