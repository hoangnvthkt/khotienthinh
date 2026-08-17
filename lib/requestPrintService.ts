import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { supabase } from './supabase';
import type { RequestDetail } from './requestRuntimeService';

export interface RequestPrintDocument { fileName: string; mimeType: string; bytes: Uint8Array; }
export interface RequestPrintModelField {
  key: string;
  label: string;
  fieldType: string;
  value: string;
  isTable: boolean;
  tableColumns: string[];
  tableRows: Array<Record<string, string>>;
}
export interface RequestPrintModel {
  code: string; title: string; description: string; creatorName: string; createdAt: string;
  fields: RequestPrintModelField[];
  approvals: Array<{
    blockName: string;
    status: string;
    statusLabel: string;
    approvers: string;
    assignments?: Array<{
      approverName: string;
      status: string;
      statusLabel: string;
      comment: string | null;
      actedAt: string | null;
    }>;
  }>;
  notes: Array<{ eventType: string; actorName: string; comment: string; createdAt: string }>;
}

const tokenValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    return value.map(row => typeof row === 'object' && row !== null ? Object.values(row).join(' | ') : String(row)).join('\n');
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

export const buildRequestPrintTokens = (detail: Pick<RequestDetail, 'code' | 'title' | 'description' | 'creator' | 'templateName' | 'createdAt' | 'formSchema' | 'formData' | 'approvalBlocks'>): Record<string, string> => {
  const approvalSummary = detail.approvalBlocks.map(block => `${block.name}: ${block.assignments.map(assignment => `${assignment.approver.name} (${assignment.status})`).join(', ') || block.status}`).join('\n');
  return {
    code: detail.code, title: detail.title, description: detail.description, creator_name: detail.creator.name,
    template_name: detail.templateName, created_at: detail.createdAt, approval_summary: approvalSummary,
    ...Object.fromEntries(detail.formSchema.map(field => [`field_${field.key}`, tokenValue(detail.formData[field.key])])),
  };
};

export const buildRequestPrintFileName = (code: string, title: string): string => {
  const normalized = title.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'de-xuat';
  return `${code}-${normalized}.docx`;
};

export const buildBrowserPrintModel = (detail: RequestDetail): RequestPrintModel => ({
  code: detail.code,
  title: detail.title,
  description: detail.description,
  creatorName: detail.creator.name,
  createdAt: detail.createdAt,
  fields: [...detail.formSchema].sort((a, b) => a.sortOrder - b.sortOrder).map(field => {
    const rawValue = detail.formData[field.key];
    const isTable = field.fieldType === 'table' || Array.isArray(rawValue);
    let tableColumns: string[] = [];
    let tableRows: Array<Record<string, string>> = [];

    if (isTable) {
      let rowsArray: unknown[] = [];
      if (Array.isArray(rawValue)) {
        rowsArray = rawValue;
      } else if (typeof rawValue === 'string' && rawValue.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(rawValue);
          if (Array.isArray(parsed)) rowsArray = parsed;
        } catch {
          // ignore JSON parse error
        }
      }

      const configuredColumns = (field.options && Array.isArray(field.options))
        ? field.options.map(opt => typeof opt === 'string' ? opt.trim() : String(opt)).filter(Boolean)
        : [];

      if (configuredColumns.length > 0) {
        tableColumns = configuredColumns;
      } else {
        const keySet = new Set<string>();
        for (const r of rowsArray) {
          if (typeof r === 'object' && r !== null) {
            Object.keys(r).forEach(k => keySet.add(k));
          }
        }
        tableColumns = Array.from(keySet);
      }

      if (tableColumns.length === 0 && rowsArray.length > 0) {
        tableColumns = ['Nội dung'];
      }

      tableRows = rowsArray.map(r => {
        if (typeof r === 'object' && r !== null) {
          return r as Record<string, string>;
        }
        return { [tableColumns[0] || 'Nội dung']: String(r ?? '') };
      });
    }

    return {
      key: field.key,
      label: field.label,
      fieldType: field.fieldType,
      value: tokenValue(rawValue) || '—',
      isTable,
      tableColumns,
      tableRows,
    };
  }),
  approvals: detail.approvalBlocks.map(block => {
    const statusLabel = block.status === 'COMPLETED' ? 'Đã duyệt'
      : block.status === 'ACTIVE' ? 'Đang chờ duyệt'
      : block.status === 'RETURNED' ? 'Trả lại'
      : block.status === 'CANCELLED' ? 'Đã hủy'
      : 'Chưa kích hoạt';

    const assignments = block.assignments.map(assignment => {
      const aStatusLabel = assignment.status === 'APPROVED' ? 'Đã duyệt'
        : assignment.status === 'REJECTED' ? 'Từ chối'
        : 'Chờ duyệt';
      return {
        approverName: assignment.approver.name,
        status: assignment.status,
        statusLabel: aStatusLabel,
        comment: assignment.comment,
        actedAt: assignment.actedAt,
      };
    });

    const approvers = assignments.length > 0
      ? assignments.map(a => `${a.approverName} · ${a.status}`).join(', ')
      : 'Chưa có người duyệt';

    return {
      blockName: block.name,
      status: block.status,
      statusLabel,
      approvers,
      assignments,
    };
  }),
  notes: detail.timeline.flatMap(event => {
    const comment = event.comment?.trim();
    if (!comment) return [];
    return [{
      eventType: event.eventType,
      actorName: event.actor?.name ?? 'Hệ thống',
      comment,
      createdAt: event.createdAt,
    }];
  }),
});

export const renderRequestDocx = async (detail: RequestDetail, templateBytes: ArrayBuffer): Promise<RequestPrintDocument> => {
  const zip = new PizZip(templateBytes);
  const document = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '${', end: '}' } });
  document.render(buildRequestPrintTokens(detail));
  return { fileName: buildRequestPrintFileName(detail.code, detail.title), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: document.getZip().generate({ type: 'uint8array', compression: 'DEFLATE' }) };
};

export const getRequestDocxTemplateBytes = async (requestId: string): Promise<ArrayBuffer> => {
  const { data, error } = await supabase.functions.invoke('request-print-docx-url', { body: { requestId } });
  if (error || !data || typeof data.signedUrl !== 'string') throw error || new Error('Không thể lấy mẫu DOCX.');
  const response = await fetch(data.signedUrl);
  if (!response.ok) throw new Error('Không thể tải mẫu DOCX.');
  return response.arrayBuffer();
};

export const recordRequestExportAudit = async (input: { requestId: string; format: 'PRINT' | 'PDF' | 'WORD'; result: 'SUCCEEDED' | 'FAILED'; errorMessage?: string; clientActionId: string }): Promise<void> => {
  const { error } = await supabase.rpc('record_request_export_audit', { p_request_id: input.requestId, p_format: input.format, p_result: input.result, p_error_message: input.errorMessage ?? null, p_client_action_id: input.clientActionId });
  if (error) throw error;
};
