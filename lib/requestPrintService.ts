import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { supabase } from './supabase';
import type { RequestDetail } from './requestRuntimeService';
import { escapeHtml } from './safeHtml';

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

export const buildRequestPrintHtml = (detail: RequestDetail): string => {
  const model = buildBrowserPrintModel(detail);
  const scalarFields = model.fields.filter(f => !f.isTable);
  const tableFields = model.fields.filter(f => f.isTable);
  const formattedDate = model.createdAt ? new Date(model.createdAt).toLocaleString('vi-VN') : '';

  const scalarRowsHtml = scalarFields.length > 0 ? `
    <div class="summary-box">
      <table class="field-table">
        <tbody>
          ${scalarFields.map(f => `
            <tr>
              <td class="field-label">${escapeHtml(f.label)}</td>
              <td class="field-value">${escapeHtml(f.value || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : '';

  const tableFieldsHtml = tableFields.map(field => {
    const cols = field.tableColumns && field.tableColumns.length > 0 ? field.tableColumns : ['Nội dung'];
    const rows = field.tableRows || [];
    return `
      <div class="table-section">
        <h4 class="table-title">${escapeHtml(field.label)}</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 45px; text-align: center;">STT</th>
              ${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0 ? `
              <tr><td colspan="${cols.length + 1}" style="text-align: center; color: #94a3b8; font-style: italic; padding: 12px;">Không có dữ liệu</td></tr>
            ` : rows.map((row, rIdx) => `
              <tr>
                <td style="text-align: center; color: #64748b;">${rIdx + 1}</td>
                ${cols.map(c => `<td>${escapeHtml(row[c] !== undefined && row[c] !== '' ? String(row[c]) : '—')}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }).join('');

  const approvalsHtml = model.approvals.length > 0 ? `
    <div class="approval-section">
      <h3 class="section-title">Kết quả phê duyệt</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 45px; text-align: center;">STT</th>
            <th>Bước duyệt</th>
            <th>Trạng thái</th>
            <th>Người duyệt / Người xử lý</th>
            <th>Ý kiến & Thời gian</th>
          </tr>
        </thead>
        <tbody>
          ${model.approvals.map((item, idx) => {
            const assignmentDetails = item.assignments && item.assignments.length > 0
              ? item.assignments.map(a => `<div><b>${escapeHtml(a.approverName)}</b> (${escapeHtml(a.statusLabel)})${a.comment ? `: ${escapeHtml(a.comment)}` : ''}${a.actedAt ? ` - <small style="color: #64748b;">${new Date(a.actedAt).toLocaleString('vi-VN')}</small>` : ''}</div>`).join('')
              : escapeHtml(item.approvers);
            return `
              <tr>
                <td style="text-align: center; color: #64748b;">${idx + 1}</td>
                <td><b>${escapeHtml(item.blockName)}</b></td>
                <td><span class="badge ${item.status === 'COMPLETED' ? 'badge-success' : item.status === 'ACTIVE' ? 'badge-warning' : 'badge-default'}">${escapeHtml(item.statusLabel || item.status)}</span></td>
                <td>${escapeHtml(item.approvers)}</td>
                <td>${assignmentDetails}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  ` : '';

  const notesHtml = model.notes.length > 0 ? `
    <div class="notes-section">
      <h3 class="section-title">Bình luận & Ghi chú</h3>
      <div class="notes-list">
        ${model.notes.map(note => `
          <div class="note-item">
            <div class="note-header">
              <b>${escapeHtml(note.eventType)}</b> · ${escapeHtml(note.actorName)}
              <span class="note-date">${note.createdAt ? new Date(note.createdAt).toLocaleString('vi-VN') : ''}</span>
            </div>
            <div class="note-body">${escapeHtml(note.comment)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(model.code)} - ${escapeHtml(model.title)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 15mm 15mm 15mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #fff;
      margin: 0;
      padding: 16px;
      font-size: 13px;
      line-height: 1.5;
    }
    @media screen {
      body {
        max-width: 860px;
        margin: 20px auto;
        box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        border-radius: 8px;
        padding: 32px;
      }
    }
    .header-top {
      border-bottom: 2px solid #047857;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .brand-tag {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      color: #047857;
    }
    h1.doc-title {
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
      margin: 6px 0 8px;
      line-height: 1.3;
    }
    .meta-line {
      font-size: 12px;
      color: #64748b;
    }
    .meta-line b {
      color: #1e293b;
    }
    .section-title {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #047857;
      margin: 18px 0 8px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
    }
    .desc-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 14px;
      white-space: pre-wrap;
      font-size: 13px;
      color: #334155;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0 16px;
      font-size: 12px;
    }
    thead {
      display: table-header-group;
    }
    tr {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 7px 10px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f1f5f9;
      font-weight: 700;
      color: #334155;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .summary-box {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      overflow: hidden;
      margin-bottom: 12px;
    }
    .field-table {
      margin: 0;
    }
    .field-table td {
      border: none;
      border-bottom: 1px solid #e2e8f0;
    }
    .field-table tr:last-child td {
      border-bottom: none;
    }
    .field-table td.field-label {
      width: 32%;
      font-weight: 600;
      color: #475569;
      background: #f8fafc;
    }
    .field-table td.field-value {
      font-weight: 600;
      color: #0f172a;
    }
    .table-section {
      margin-top: 14px;
    }
    .table-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: #0f172a;
      margin: 0 0 4px;
    }
    .badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
    }
    .badge-success { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
    .badge-warning { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
    .badge-default { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
    .note-item {
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      border-radius: 6px;
      padding: 8px 12px;
      margin-bottom: 8px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .note-header { font-size: 11px; color: #64748b; margin-bottom: 3px; }
    .note-header b { color: #1e293b; }
    .note-date { float: right; font-size: 10px; }
    .note-body { font-size: 12px; color: #334155; white-space: pre-wrap; }
    .signatures-block {
      margin-top: 28px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      text-align: center;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .sig-col h5 {
      margin: 0;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      color: #1e293b;
    }
    .sig-col p {
      margin: 2px 0 0;
      font-size: 10px;
      color: #64748b;
      font-style: italic;
    }
    .sig-space {
      height: 70px;
    }
    .footer-doc {
      margin-top: 24px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      font-size: 10px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
      page-break-inside: avoid;
      break-inside: avoid;
    }
  </style>
</head>
<body>
  <div class="header-top">
    <div class="brand-tag">Vioo · Phiếu đề xuất</div>
    <h1 class="doc-title">${escapeHtml(model.title)}</h1>
    <div class="meta-line">
      Mã đề xuất: <b>${escapeHtml(model.code)}</b> · Người tạo: <b>${escapeHtml(model.creatorName)}</b> · Ngày tạo: <b>${escapeHtml(formattedDate)}</b>
    </div>
  </div>

  <div class="desc-section">
    <h3 class="section-title">Nội dung đề xuất</h3>
    <div class="desc-box">${escapeHtml(model.description || 'Không có mô tả.')}</div>
  </div>

  ${(scalarFields.length > 0 || tableFields.length > 0) ? `
    <div class="fields-section">
      <h3 class="section-title">Thông tin chi tiết</h3>
      ${scalarRowsHtml}
      ${tableFieldsHtml}
    </div>
  ` : ''}

  ${approvalsHtml}
  ${notesHtml}

  <div class="signatures-block">
    <div class="sig-col">
      <h5>Người lập đề xuất</h5>
      <p>(Ký, ghi rõ họ tên)</p>
      <div class="sig-space"></div>
      <b>${escapeHtml(model.creatorName)}</b>
    </div>
    <div class="sig-col">
      <h5>Người kiểm tra</h5>
      <p>(Ký, ghi rõ họ tên)</p>
      <div class="sig-space"></div>
    </div>
    <div class="sig-col">
      <h5>Người phê duyệt</h5>
      <p>(Ký, ghi rõ họ tên)</p>
      <div class="sig-space"></div>
    </div>
  </div>

  <div class="footer-doc">
    <span>In từ hệ thống Vioo · ${escapeHtml(model.code)}</span>
    <span>Ngày in: ${new Date().toLocaleString('vi-VN')}</span>
  </div>

  <script>
    window.addEventListener('load', function() {
      window.focus();
      setTimeout(function() {
        window.print();
      }, 250);
    });
  </script>
</body>
</html>`;
};

export const printRequestDocument = (detail: RequestDetail): void => {
  const html = buildRequestPrintHtml(detail);
  const printWindow = window.open('', '_blank', 'width=900,height=750');
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
  } else {
    // Hidden iframe fallback if popup blocker intercepts
    let iframe = document.getElementById('request-print-iframe') as HTMLIFrameElement | null;
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'request-print-iframe';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);
    }
    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      setTimeout(() => {
        iframe?.contentWindow?.focus();
        iframe?.contentWindow?.print();
      }, 250);
    }
  }
};
