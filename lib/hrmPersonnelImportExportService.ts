import { supabase } from './supabase';
import {
  calculateFileSha256,
  HRM_PERSONNEL_WORKBOOK_SHEETS,
  type HrmImportStagingRow,
} from './hrmPersonnelWorkbook';

export interface HrmImportPreviewError {
  sheetCode: string;
  rowNumber: number;
  column: string;
  errorCode: string;
}

export interface HrmImportPreview {
  batchId: string;
  status: 'VALIDATED';
  totalRows: number;
  validRows: number;
  errorRows: number;
  fingerprint: string;
  errors: HrmImportPreviewError[];
}

const safeFileName = (name: string): string => name
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/gi, 'd')
  .replace(/[^a-zA-Z0-9._-]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'hrm-personnel.xlsx';

const requireData = <T>(
  data: T | null,
  error: { message?: string } | null,
  fallback: string,
): T => {
  if (error) throw new Error(error.message || fallback);
  if (data == null) throw new Error(fallback);
  return data;
};

export const hrmPersonnelImportExportService = {
  async uploadAndPreview(input: {
    appUserId: string;
    file: File;
    rows: HrmImportStagingRow[];
  }): Promise<HrmImportPreview> {
    const objectPath = `${input.appUserId}/${crypto.randomUUID()}/${safeFileName(input.file.name)}`;
    const storage = supabase.storage.from('hrm-private-imports');
    const { error: uploadError } = await storage.upload(objectPath, input.file, {
      cacheControl: '3600', contentType: input.file.type, upsert: false,
    });
    if (uploadError) throw new Error(uploadError.message || 'Không thể tải file import lên vùng lưu trữ riêng.');

    try {
      const sourceFileHash = await calculateFileSha256(input.file);
      const manifest = {
        formatVersion: 1,
        dataSheetCount: HRM_PERSONNEL_WORKBOOK_SHEETS.length,
        sourceFileName: safeFileName(input.file.name),
        sourceFileSize: input.file.size,
        rowCount: input.rows.length,
        sheetCodes: HRM_PERSONNEL_WORKBOOK_SHEETS.map(sheet => sheet.code),
      };
      const createResult = await supabase.rpc('create_hrm_import_batch', {
        p_source_file_path: objectPath,
        p_source_file_hash: sourceFileHash,
        p_manifest: manifest,
      });
      const created = requireData(
        createResult.data as { batchId: string } | null,
        createResult.error,
        'Không thể tạo batch import hồ sơ.',
      );
      const stageResult = await supabase.rpc('stage_hrm_import_rows', {
        p_batch_id: created.batchId,
        p_rows: input.rows,
      });
      requireData(stageResult.data, stageResult.error, 'Không thể đưa dữ liệu vào vùng kiểm tra.');
      const previewResult = await supabase.rpc('preview_hrm_import_batch', {
        p_batch_id: created.batchId,
      });
      return requireData(
        previewResult.data as HrmImportPreview | null,
        previewResult.error,
        'Không thể dry-run file hồ sơ.',
      );
    } catch (error) {
      await storage.remove([objectPath]).catch(() => undefined);
      throw error;
    }
  },

  async apply(batchId: string, reason: string, fingerprint: string): Promise<{
    batchId: string;
    status: 'APPLIED';
    appliedRows: number;
    idempotentReplay?: boolean;
  }> {
    const { data, error } = await supabase.rpc('apply_hrm_import_batch', {
      p_batch_id: batchId,
      p_reason: reason,
      p_expected_fingerprint: fingerprint,
    });
    return requireData(data as any, error, 'Không thể áp dụng batch import hồ sơ.');
  },

  async exportProfiles(employeeIds: string[], reason: string): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.rpc('export_hrm_employee_profiles', {
      p_employee_ids: employeeIds,
      p_reason: reason,
    });
    return requireData(data as Record<string, unknown> | null, error, 'Không thể xuất hồ sơ nhân sự.');
  },
};
