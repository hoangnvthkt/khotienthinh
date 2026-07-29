import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { supabase } from './supabase';
import type { RequestDetail } from './requestRuntimeService';

export interface RequestPrintDocument { fileName: string; mimeType: string; bytes: Uint8Array; }
export interface RequestPrintModel {
  code: string; title: string; description: string; creatorName: string; createdAt: string;
  fields: Array<{ label: string; value: string }>;
  approvals: Array<{ blockName: string; status: string; approvers: string }>;
}

const tokenValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
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
  code: detail.code, title: detail.title, description: detail.description, creatorName: detail.creator.name, createdAt: detail.createdAt,
  fields: [...detail.formSchema].sort((a, b) => a.sortOrder - b.sortOrder).map(field => ({ label: field.label, value: tokenValue(detail.formData[field.key]) || '—' })),
  approvals: detail.approvalBlocks.map(block => ({ blockName: block.name, status: block.status, approvers: block.assignments.map(assignment => `${assignment.approver.name} · ${assignment.status}`).join(', ') || 'Chưa có người duyệt' })),
});

export const renderRequestDocx = async (detail: RequestDetail, templateBytes: ArrayBuffer): Promise<RequestPrintDocument> => {
  const zip = new PizZip(templateBytes);
  const document = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '${', end: '}' } });
  document.render(buildRequestPrintTokens(detail));
  return { fileName: buildRequestPrintFileName(detail.code, detail.title), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: document.getZip().generate({ type: 'uint8array', compression: 'DEFLATE' }) };
};

export const recordRequestExportAudit = async (input: { requestId: string; format: 'PRINT' | 'PDF' | 'WORD'; result: 'SUCCEEDED' | 'FAILED'; errorMessage?: string; clientActionId: string }): Promise<void> => {
  const { error } = await supabase.rpc('record_request_export_audit', { p_request_id: input.requestId, p_format: input.format, p_result: input.result, p_error_message: input.errorMessage ?? null, p_client_action_id: input.clientActionId });
  if (error) throw error;
};
