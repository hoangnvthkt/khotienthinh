import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Download,
  FileImage,
  FileSpreadsheet,
  Loader2,
  Paperclip,
  Plus,
  Printer,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  Send,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import type {
  CustomMaterialAttachment,
  CustomMaterialImportPreviewRow,
  CustomMaterialLineStatus,
  CustomMaterialProfileType,
  CustomMaterialRequest,
  CustomMaterialRequestLine,
  CustomMaterialRequestStatus,
  CustomMaterialSmartImportField,
  CustomMaterialSmartImportPreview,
  CustomMaterialTemplateKey,
} from '../../../types';
import { customMaterialRequestService } from '../../../lib/customMaterialRequestService';
import {
  CUSTOM_MATERIAL_SMART_IMPORT_FIELDS,
  customMaterialSmartImportService,
} from '../../../lib/customMaterialSmartImportService';
import {
  buildXaGoSpec,
  calculateXaGoWeightKg,
  CUSTOM_MATERIAL_PROFILE_LABELS,
  CUSTOM_MATERIAL_TEMPLATE_OPTIONS,
  formatCustomMaterialLineSpec,
  formatCustomMaterialNumber,
  getCustomMaterialTemplateOption,
  getSpecNumber,
  normalizeCustomMaterialTemplateKey,
} from '../../../lib/customMaterialTemplates';
import { useToast } from '../../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../../lib/apiError';

type Props = {
  projectId?: string;
  constructionSiteId?: string;
  currentUserId: string;
  currentUserName?: string;
  canManage: boolean;
};

type DraftLine = Partial<CustomMaterialRequestLine> & {
  id?: string;
  specDraft?: string;
};

type DraftForm = {
  title: string;
  workPackage: string;
  workSection: string;
  templateKey: CustomMaterialTemplateKey;
  requestScope: string;
  requestingDepartment: string;
  requestedByName: string;
  neededDate: string;
  note: string;
  lines: DraftLine[];
};

const PROFILE_OPTIONS: Array<{ key: CustomMaterialProfileType; label: string }> = [
  { key: 'xa_go', label: CUSTOM_MATERIAL_PROFILE_LABELS.xa_go },
  { key: 'ton_seam_lock', label: 'Tôn seam lock' },
  { key: 'ton_5_song', label: 'Tôn 5 sóng' },
  { key: 'ton_thung', label: 'Tôn thưng' },
  { key: 'phu_kien', label: 'Phụ kiện' },
  { key: 'ket_cau_thep', label: 'Kết cấu thép' },
  { key: 'other', label: 'Khác' },
];

const STATUS_LABEL: Record<CustomMaterialRequestStatus, string> = {
  draft: 'Nháp',
  submitted: 'Chờ duyệt',
  approved: 'Đã duyệt',
  returned: 'Trả lại',
  rejected: 'Từ chối',
  cancelled: 'Đã huỷ',
  rfq_created: 'Đã tạo RFQ',
  po_created: 'Đã tạo PO',
  partially_received: 'Nhận một phần',
  completed: 'Hoàn tất',
};

const LINE_STATUS_LABEL: Record<CustomMaterialLineStatus, string> = {
  draft: 'Nháp',
  submitted: 'Chờ duyệt',
  approved: 'Chờ RFQ',
  rfq_created: 'Đã RFQ',
  quoted: 'Đã báo giá',
  ordered: 'Đã đặt',
  partially_received: 'Nhận một phần',
  received: 'Đã nhận',
  closed: 'Đã đóng',
  cancelled: 'Huỷ',
};

const statusTone = (status: string) => {
  if (['approved', 'quoted', 'received', 'completed'].includes(status)) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (['submitted', 'rfq_created', 'po_created', 'partially_received', 'ordered'].includes(status)) return 'border-amber-200 bg-amber-50 text-amber-700';
  if (['rejected', 'cancelled'].includes(status)) return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === 'returned') return 'border-orange-200 bg-orange-50 text-orange-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
};

const emptyForm = (userName?: string): DraftForm => ({
  title: 'Đề xuất vật tư phi tiêu chuẩn',
  workPackage: '',
  workSection: '',
  templateKey: 'generic',
  requestScope: '',
  requestingDepartment: '',
  requestedByName: userName || '',
  neededDate: '',
  note: '',
  lines: [],
});

const makeBlankLine = (index: number, templateKey: CustomMaterialTemplateKey = 'generic'): DraftLine => {
  if (templateKey === 'xa_go') {
    const specJson = {
      templateKey: 'xa_go',
      chung_loai: '',
      quy_cach: '',
      length_mm: null,
      kg_per_m: null,
      weight_kg: null,
      calculated_weight_kg: null,
    };
    return {
      sortOrder: index,
      groupKey: 'xa_go',
      profileType: 'xa_go',
      description: '',
      effectiveWidth: null,
      length: null,
      quantity: 1,
      areaM2: null,
      lengthMd: null,
      thickness: null,
      color: '',
      unit: 'cấu kiện',
      technicalNote: '',
      specJson,
      specDraft: JSON.stringify(specJson, null, 2),
      attachments: [],
    };
  }
  return {
    sortOrder: index,
    groupKey: 'other',
    profileType: 'other',
    description: '',
    effectiveWidth: null,
    length: null,
    quantity: 1,
    areaM2: null,
    lengthMd: null,
    thickness: null,
    color: '',
    unit: 'tấm',
    technicalNote: '',
    specJson: {},
    specDraft: '{}',
    attachments: [],
  };
};

const numberOrNull = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) && num !== 0 ? num : null;
};

const smartImportSourceLabel = {
  local: 'Local',
  ai: 'AI',
  memory: 'Đã nhớ mapping',
};

const rebuildXaGoPreviewRow = (
  row: CustomMaterialImportPreviewRow,
  linePatch: Partial<CustomMaterialImportPreviewRow['line']> = {},
  specPatch: Record<string, unknown> = {},
): CustomMaterialImportPreviewRow => {
  const nextLine = {
    ...row.line,
    ...linePatch,
    groupKey: 'xa_go',
    profileType: 'xa_go',
    unit: 'cấu kiện',
    specJson: {
      ...(row.line.specJson || {}),
      ...specPatch,
    },
  };
  const specJson = buildXaGoSpec(nextLine);
  const quantity = Number(nextLine.quantity || 0);
  const lengthMm = getSpecNumber(specJson, 'length_mm');
  const kgPerM = getSpecNumber(specJson, 'kg_per_m');
  const lengthM = lengthMm > 0 ? lengthMm / 1000 : 0;
  const calculatedWeight = calculateXaGoWeightKg(quantity, lengthMm, kgPerM);
  const weightKg = getSpecNumber(specJson, 'weight_kg');
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!String(nextLine.description || '').trim()) errors.push('Thiếu diễn giải.');
  if (quantity <= 0) errors.push('Thiếu SL cấu kiện.');
  if (lengthMm <= 0) errors.push('Thiếu Dài(mm).');
  if (kgPerM <= 0) errors.push('Thiếu Kg/m.');
  if (weightKg > 0 && calculatedWeight > 0 && Math.abs(weightKg - calculatedWeight) > 0.5) {
    warnings.push(`Khối lượng nhập ${formatCustomMaterialNumber(weightKg)} kg lệch công thức ${formatCustomMaterialNumber(calculatedWeight)} kg.`);
  }

  return {
    ...row,
    status: errors.length ? 'error' : 'create',
    errors,
    warnings,
    line: {
      ...nextLine,
      description: String(nextLine.description || '').trim(),
      effectiveWidth: null,
      length: lengthM || null,
      quantity,
      areaM2: null,
      lengthMd: quantity > 0 && lengthM > 0 ? quantity * lengthM : null,
      thickness: null,
      color: null,
      technicalNote: nextLine.technicalNote || null,
      specJson,
    },
  };
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const buildPrintHtml = (request: CustomMaterialRequest) => {
  const isXaGo = request.templateKey === 'xa_go';
  const rows = request.lines.map((line, index) => {
    if (isXaGo) {
      const spec = buildXaGoSpec(line);
      return `
        <tr>
          <td class="center">${index + 1}</td>
          <td>${escapeHtml(line.description)}</td>
          <td>${escapeHtml(spec.chung_loai || '')}</td>
          <td>${escapeHtml(spec.quy_cach || '')}</td>
          <td class="num">${escapeHtml(line.quantity || '')}</td>
          <td class="num">${escapeHtml(spec.length_mm || '')}</td>
          <td class="num">${escapeHtml(spec.kg_per_m || '')}</td>
          <td class="num">${escapeHtml(spec.weight_kg || '')}</td>
          <td>${escapeHtml(line.technicalNote || '')}</td>
        </tr>
      `;
    }
    return `
      <tr>
        <td class="center">${index + 1}</td>
        <td>${escapeHtml(line.description)}</td>
        <td class="center">${escapeHtml(line.effectiveWidth || '')}</td>
        <td class="center">${escapeHtml(line.length || '')}</td>
        <td class="num">${escapeHtml(line.quantity || '')}</td>
        <td class="num">${escapeHtml(line.areaM2 || '')}</td>
        <td class="num">${escapeHtml(line.lengthMd || '')}</td>
        <td>${escapeHtml(line.color || '')}</td>
        <td>${escapeHtml(line.technicalNote || '')}</td>
      </tr>
    `;
  }).join('');
  const totalQty = request.lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const totalArea = request.lines.reduce((sum, line) => sum + Number(line.areaM2 || 0), 0);
  const totalMd = request.lines.reduce((sum, line) => sum + Number(line.lengthMd || 0), 0);
  const totalWeight = request.lines.reduce((sum, line) => sum + getSpecNumber(line.specJson, 'weight_kg'), 0);
  const headerHtml = isXaGo
    ? '<th>STT</th><th>Diễn giải</th><th>Chủng loại</th><th>Quy cách</th><th>SL CK</th><th>Dài (mm)</th><th>Kg/m</th><th>Khối lượng (kg)</th><th>Ghi chú</th>'
    : '<th>STT</th><th>Diễn giải</th><th>Khổ hiệu dụng</th><th>Chiều dài</th><th>Số lượng</th><th>M2</th><th>Md</th><th>Màu</th><th>Ghi chú</th>';
  const footerHtml = isXaGo
    ? `<tr><td colspan="4" class="num">Tổng</td><td class="num">${formatCustomMaterialNumber(totalQty)}</td><td></td><td></td><td class="num">${formatCustomMaterialNumber(totalWeight)}</td><td></td></tr>`
    : `<tr><td colspan="5" class="num">Tổng</td><td class="num">${totalArea.toLocaleString('vi-VN')}</td><td class="num">${totalMd.toLocaleString('vi-VN')}</td><td colspan="2"></td></tr>`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(request.code)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
    h1 { text-align: center; font-size: 22px; margin: 12px 0 20px; }
    .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; font-size: 12px; }
    .box { border: 1px solid #cbd5e1; padding: 8px; min-height: 46px; }
    .label { color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 700; }
    .value { font-weight: 700; margin-top: 3px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #111827; padding: 6px; font-size: 11px; vertical-align: top; }
    th { text-align: center; background: #f1f5f9; }
    .center { text-align: center; }
    .num { text-align: right; }
    tfoot td { font-weight: 700; }
    .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; margin-top: 42px; text-align: center; font-weight: 700; }
    @media print { body { margin: 12mm; } }
  </style>
</head>
<body>
  <h1>DỰ TRÙ VẬT TƯ PHI TIÊU CHUẨN</h1>
  <div class="meta">
    <div class="box"><div class="label">Mã phiếu</div><div class="value">${escapeHtml(request.code)}</div></div>
    <div class="box"><div class="label">Hạng mục</div><div class="value">${escapeHtml(request.workPackage || '')}</div></div>
    <div class="box"><div class="label">Ngày cần hàng</div><div class="value">${escapeHtml(request.neededDate || '')}</div></div>
    <div class="box"><div class="label">Mục</div><div class="value">${escapeHtml(request.workSection || '')}</div></div>
    <div class="box"><div class="label">Mẫu</div><div class="value">${escapeHtml(request.templateKey === 'xa_go' ? 'Xà gồ' : 'Khác / Generic')}</div></div>
    <div class="box"><div class="label">Bộ phận đề xuất</div><div class="value">${escapeHtml(request.requestingDepartment || '')}</div></div>
    <div class="box"><div class="label">Người lập</div><div class="value">${escapeHtml(request.requestedByName || '')}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        ${headerHtml}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      ${footerHtml}
    </tfoot>
  </table>
  <div class="sign"><div>Người lập</div><div>Phòng vật tư</div><div>Ban giám đốc</div></div>
</body>
</html>`;
};

const AttachmentButton: React.FC<{ attachment: CustomMaterialAttachment }> = ({ attachment }) => {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    try {
      const url = await customMaterialRequestService.getAttachmentUrl(attachment);
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setOpening(false);
    }
  };
  return (
    <button
      type="button"
      onClick={open}
      className="inline-flex max-w-[180px] items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 hover:border-blue-200 hover:text-blue-600"
      title={attachment.fileName}
    >
      {opening ? <Loader2 size={12} className="animate-spin" /> : attachment.fileType === 'image' ? <FileImage size={12} /> : <Paperclip size={12} />}
      <span className="truncate">{attachment.fileName}</span>
    </button>
  );
};

export const CustomMaterialRequestTab: React.FC<Props> = ({
  projectId,
  constructionSiteId,
  currentUserId,
  currentUserName,
  canManage,
}) => {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [requests, setRequests] = useState<CustomMaterialRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<DraftForm>(() => emptyForm(currentUserName));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [activeAttachmentLineId, setActiveAttachmentLineId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<CustomMaterialImportPreviewRow[]>([]);
  const [smartImportPreview, setSmartImportPreview] = useState<CustomMaterialSmartImportPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const selectedRequest = useMemo(
    () => requests.find(request => request.id === selectedId) || null,
    [requests, selectedId],
  );
  const canEdit = !selectedRequest || ['draft', 'returned'].includes(selectedRequest.status);
  const canApprove = Boolean(selectedRequest && selectedRequest.status === 'submitted' && canManage);
  const currentTemplate = normalizeCustomMaterialTemplateKey(form.templateKey);
  const isXaGoTemplate = currentTemplate === 'xa_go';
  const filteredRequests = useMemo(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return requests;
    return requests.filter(request => [
      request.code,
      request.title,
      request.workPackage,
      request.workSection,
      request.requestScope,
      request.lines.map(line => `${line.description} ${formatCustomMaterialLineSpec(line)}`).join(' '),
    ].filter(Boolean).join(' ').toLowerCase().includes(lower));
  }, [query, requests]);
  const totals = useMemo(() => form.lines.reduce((acc, line) => ({
    qty: acc.qty + Number(line.quantity || 0),
    area: acc.area + Number(line.areaM2 || 0),
    md: acc.md + Number(line.lengthMd || 0),
    kg: acc.kg + getSpecNumber(line.specJson, 'weight_kg'),
  }), { qty: 0, area: 0, md: 0, kg: 0 }), [form.lines]);

  const hydrateForm = (request: CustomMaterialRequest | null) => {
    if (!request) {
      setForm(emptyForm(currentUserName));
      return;
    }
    setForm({
      title: request.title || 'Đề xuất vật tư phi tiêu chuẩn',
      workPackage: request.workPackage || '',
      workSection: request.workSection || '',
      templateKey: normalizeCustomMaterialTemplateKey(request.templateKey),
      requestScope: request.requestScope || '',
      requestingDepartment: request.requestingDepartment || '',
      requestedByName: request.requestedByName || currentUserName || '',
      neededDate: request.neededDate || '',
      note: request.note || '',
      lines: request.lines.map(line => ({
        ...line,
        specDraft: JSON.stringify(line.specJson || {}, null, 2),
      })),
    });
  };

  const loadRequests = async (keepSelection = true) => {
    setLoading(true);
    try {
      const rows = await customMaterialRequestService.listByProject(projectId || '', constructionSiteId || null);
      setRequests(rows);
      const nextSelected = keepSelection
        ? rows.find(item => item.id === selectedId) || rows[0] || null
        : rows[0] || null;
      setSelectedId(nextSelected?.id || null);
      hydrateForm(nextSelected);
    } catch (err: any) {
      logApiError('customMaterialRequest.list', err);
      toast.error('Không tải được phiếu phi tiêu chuẩn', getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRequests(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, constructionSiteId]);

  const selectRequest = (request: CustomMaterialRequest | null) => {
    setSelectedId(request?.id || null);
    hydrateForm(request);
    setImportPreview([]);
    setSmartImportPreview(null);
    setPreviewOpen(false);
  };

  const addLine = () => {
    setForm(prev => ({ ...prev, lines: [...prev.lines, makeBlankLine(prev.lines.length, prev.templateKey)] }));
  };

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    setForm(prev => ({
      ...prev,
      lines: prev.lines.map((line, idx) => idx === index ? { ...line, ...patch } : line),
    }));
  };

  const changeTemplate = (templateKey: CustomMaterialTemplateKey) => {
    const option = getCustomMaterialTemplateOption(templateKey);
    setForm(prev => ({
      ...prev,
      templateKey,
      workSection: option.workSection,
      lines: prev.lines.map(line => templateKey === 'xa_go'
        ? (() => {
            const specJson = buildXaGoSpec({ ...line, groupKey: 'xa_go', profileType: 'xa_go' });
            return {
            ...line,
            groupKey: 'xa_go',
            profileType: 'xa_go',
            unit: 'cấu kiện',
            specJson,
            specDraft: JSON.stringify(specJson, null, 2),
          };
        })()
        : line),
    }));
  };

  const updateXaGoLine = (
    index: number,
    linePatch: Partial<DraftLine> = {},
    specPatch: Record<string, unknown> = {},
  ) => {
    setForm(prev => ({
      ...prev,
      lines: prev.lines.map((line, idx) => {
        if (idx !== index) return line;
        const next: DraftLine = {
          ...line,
          ...linePatch,
          groupKey: 'xa_go',
          profileType: 'xa_go',
          unit: 'cấu kiện',
          specJson: {
            ...(line.specJson || {}),
            ...specPatch,
          },
        };
        const specJson = buildXaGoSpec(next);
        const lengthMm = getSpecNumber(specJson, 'length_mm');
        const quantity = Number(next.quantity || 0);
        const lengthM = lengthMm > 0 ? lengthMm / 1000 : null;
        const lengthMd = lengthM && quantity > 0 ? quantity * lengthM : null;
        return {
          ...next,
          length: lengthM,
          lengthMd,
          specJson,
          specDraft: JSON.stringify(specJson, null, 2),
        };
      }),
    }));
  };

  const removeLine = (index: number) => {
    setForm(prev => ({ ...prev, lines: prev.lines.filter((_, idx) => idx !== index) }));
  };

  const normalizeLinesForSave = () => form.lines.map((line, index) => {
    if (isXaGoTemplate) {
      const specJson = buildXaGoSpec({
        ...line,
        groupKey: 'xa_go',
        profileType: 'xa_go',
        unit: 'cấu kiện',
      });
      const lengthMm = getSpecNumber(specJson, 'length_mm');
      const quantity = Number(line.quantity || 0);
      const lengthM = lengthMm > 0 ? lengthMm / 1000 : null;
      return {
        ...line,
        sortOrder: index,
        groupKey: 'xa_go',
        profileType: 'xa_go',
        description: String(line.description || '').trim(),
        effectiveWidth: null,
        length: lengthM,
        quantity,
        areaM2: null,
        lengthMd: lengthM && quantity > 0 ? quantity * lengthM : null,
        thickness: null,
        color: null,
        technicalNote: line.technicalNote || null,
        unit: 'cấu kiện',
        specJson,
      };
    }
    let specJson = line.specJson || {};
    if (line.specDraft) {
      try {
        specJson = JSON.parse(line.specDraft);
      } catch {
        throw new Error(`Spec JSON dòng ${index + 1} không hợp lệ.`);
      }
    }
    return {
      ...line,
      sortOrder: index,
      groupKey: line.groupKey || 'other',
      profileType: line.profileType || line.groupKey || 'other',
      description: String(line.description || '').trim(),
      effectiveWidth: numberOrNull(line.effectiveWidth),
      length: numberOrNull(line.length),
      quantity: Number(line.quantity || 0),
      areaM2: numberOrNull(line.areaM2),
      lengthMd: numberOrNull(line.lengthMd),
      thickness: numberOrNull(line.thickness),
      color: line.color || null,
      technicalNote: line.technicalNote || null,
      unit: line.unit || 'tấm',
      specJson,
    };
  });

  const validateBeforeSave = () => {
    if (!form.title.trim()) {
      toast.warning('Thiếu tên phiếu', 'Vui lòng nhập tên phiếu đề xuất.');
      return false;
    }
    if (!projectId && !constructionSiteId) {
      toast.warning('Thiếu phạm vi dự án', 'Phiếu cần thuộc một dự án hoặc công trường.');
      return false;
    }
    if (isXaGoTemplate) {
      const invalidLineIndex = form.lines.findIndex(line => {
        const spec = line.specJson || {};
        return !String(line.description || '').trim()
          || Number(line.quantity || 0) <= 0
          || getSpecNumber(spec, 'length_mm') <= 0
          || getSpecNumber(spec, 'kg_per_m') <= 0;
      });
      if (invalidLineIndex >= 0) {
        toast.warning('Dòng Xà gồ chưa hợp lệ', `Dòng ${invalidLineIndex + 1} cần có diễn giải, SL cấu kiện, Dài(mm), Kg/m.`);
        return false;
      }
      return true;
    }
    const invalidLine = form.lines.find(line => !String(line.description || '').trim() || Number(line.quantity || 0) <= 0);
    if (invalidLine) {
      toast.warning('Dòng chưa hợp lệ', 'Mỗi dòng cần có diễn giải và số lượng lớn hơn 0.');
      return false;
    }
    return true;
  };

  const saveDraft = async () => {
    if (!canEdit || saving || !validateBeforeSave()) return;
    setSaving(true);
    try {
      const lines = normalizeLinesForSave();
      const saved = selectedRequest
        ? await customMaterialRequestService.updateDraft({
            id: selectedRequest.id,
            title: form.title.trim(),
            workPackage: form.workPackage.trim() || null,
            workSection: form.workSection.trim() || null,
            requestScope: form.requestScope.trim() || null,
            templateKey: currentTemplate,
            requestingDepartment: form.requestingDepartment.trim() || null,
            requestedByName: form.requestedByName.trim() || null,
            neededDate: form.neededDate || null,
            note: form.note.trim() || null,
            updatedBy: currentUserId,
            lines,
          })
        : await customMaterialRequestService.createDraft({
            projectId: projectId || null,
            constructionSiteId: constructionSiteId || null,
            title: form.title.trim(),
            workPackage: form.workPackage.trim() || null,
            workSection: form.workSection.trim() || null,
            requestScope: form.requestScope.trim() || null,
            templateKey: currentTemplate,
            requestingDepartment: form.requestingDepartment.trim() || null,
            requestedByName: form.requestedByName.trim() || null,
            neededDate: form.neededDate || null,
            note: form.note.trim() || null,
            createdBy: currentUserId,
            lines,
          });
      setRequests(prev => {
        const exists = prev.some(item => item.id === saved.id);
        return exists ? prev.map(item => item.id === saved.id ? saved : item) : [saved, ...prev];
      });
      setSelectedId(saved.id);
      hydrateForm(saved);
      toast.success('Đã lưu phiếu', saved.code);
      return saved;
    } catch (err: any) {
      logApiError('customMaterialRequest.save', err);
      toast.error('Không lưu được phiếu', getApiErrorMessage(err));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status: CustomMaterialRequestStatus, message: string) => {
    if (!selectedRequest || saving) return;
    setSaving(true);
    try {
      const saved = await customMaterialRequestService.setStatus(selectedRequest.id, status, currentUserId, message);
      setRequests(prev => prev.map(item => item.id === saved.id ? saved : item));
      setSelectedId(saved.id);
      hydrateForm(saved);
      toast.success('Đã cập nhật trạng thái', `${saved.code} - ${STATUS_LABEL[saved.status]}`);
    } catch (err: any) {
      logApiError('customMaterialRequest.status', err);
      toast.error('Không cập nhật được trạng thái', getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const submitRequest = async () => {
    const saved = await saveDraft();
    if (!saved) return;
    setSaving(true);
    try {
      const submitted = await customMaterialRequestService.submit(saved.id, currentUserId, 'Gửi duyệt phiếu vật tư phi tiêu chuẩn');
      setRequests(prev => prev.map(item => item.id === submitted.id ? submitted : item));
      setSelectedId(submitted.id);
      hydrateForm(submitted);
      toast.success('Đã gửi duyệt', submitted.code);
    } catch (err: any) {
      logApiError('customMaterialRequest.submit', err);
      toast.error('Không gửi duyệt được phiếu', getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const exportWorkbook = async () => {
    const request = selectedRequest;
    if (!request) return;
    const blob = await customMaterialRequestService.exportSupplierWorkbook(request);
    downloadBlob(blob, `${request.code}-phieu-vat-tu-phi-tieu-chuan.xlsx`);
  };

  const exportTemplateWorkbook = async () => {
    const blob = await customMaterialRequestService.exportTemplateWorkbook(currentTemplate);
    downloadBlob(blob, `mau-import-${currentTemplate}.xlsx`);
  };

  const printRequest = () => {
    if (!selectedRequest) return;
    const win = window.open('', '_blank', 'width=1200,height=900');
    if (!win) return;
    win.document.write(buildPrintHtml(selectedRequest));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  };

  const handleImportFile = async (file?: File | null) => {
    if (!file) return;
    setImportFile(file);
    setSmartImportPreview(null);
    try {
      if (currentTemplate === 'xa_go') {
        const preview = await customMaterialRequestService.importExcelSmartPreview(file, currentTemplate);
        setSmartImportPreview(preview);
        setImportPreview(preview.rows);
      } else {
        const preview = await customMaterialRequestService.importExcelPreview(file, currentTemplate);
        setImportPreview(preview);
      }
      setPreviewOpen(true);
    } catch (err: any) {
      logApiError('customMaterialRequest.importPreview', err);
      toast.error('Không đọc được Excel', getApiErrorMessage(err));
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const updateSmartImportRows = (rows: CustomMaterialImportPreviewRow[]) => {
    setImportPreview(rows);
    setSmartImportPreview(prev => prev ? { ...prev, rows } : prev);
  };

  const updatePreviewXaGoRow = (
    rowIndex: number,
    linePatch: Partial<CustomMaterialImportPreviewRow['line']> = {},
    specPatch: Record<string, unknown> = {},
  ) => {
    const rows = importPreview.map((row, index) => index === rowIndex ? rebuildXaGoPreviewRow(row, linePatch, specPatch) : row);
    updateSmartImportRows(rows);
  };

  const changeSmartMapping = (field: CustomMaterialSmartImportField, columnIndexRaw: string) => {
    if (!smartImportPreview) return;
    const columnIndex = columnIndexRaw === '' ? -1 : Number(columnIndexRaw);
    const mapping = { ...smartImportPreview.mapping };
    if (columnIndex < 0 || !Number.isFinite(columnIndex)) {
      delete mapping[field];
    } else {
      mapping[field] = {
        columnIndex,
        label: smartImportPreview.sampleHeaders[columnIndex] || `Cột ${columnIndex + 1}`,
        confidence: 1,
      };
    }
    const rebuilt = customMaterialSmartImportService.rebuildPreviewFromMapping(smartImportPreview, mapping);
    setSmartImportPreview(rebuilt);
    setImportPreview(rebuilt.rows);
  };

  const rememberSmartMapping = async () => {
    if (!smartImportPreview) return;
    try {
      await customMaterialSmartImportService.saveMappingProfile({ ...smartImportPreview, rows: importPreview }, smartImportPreview.mapping);
    } catch (err) {
      console.warn('custom material mapping profile save failed:', (err as Error)?.message || err);
    }
  };

  const applyImport = async () => {
    if (importPreview.length === 0) return;
    const validRows = importPreview.filter(row => row.status !== 'error');
    if (validRows.length === 0) {
      toast.warning('Chưa có dòng hợp lệ', 'Vui lòng sửa file hoặc mapping trước khi áp dụng.');
      return;
    }
    if (smartImportPreview && smartImportPreview.confidenceScore < 0.7) {
      const confirmed = window.confirm('Độ tin cậy nhận diện Excel đang thấp. Anh/chị đã rà mapping và dữ liệu preview trước khi áp dụng chưa?');
      if (!confirmed) return;
    }
    if (!selectedRequest) {
      setForm(prev => ({
        ...prev,
        lines: [
          ...prev.lines,
          ...validRows.map(row => ({
            ...row.line,
            specDraft: JSON.stringify(row.line.specJson || {}, null, 2),
          })),
        ],
      }));
      void rememberSmartMapping();
      setPreviewOpen(false);
      setSmartImportPreview(null);
      toast.success('Đã đưa dữ liệu vào phiếu nháp', `${validRows.length} dòng đã sẵn sàng để lưu.`);
      return;
    }
    setSaving(true);
    try {
      let sourceAttachmentId: string | null = null;
      if (importFile) {
        const attachment = await customMaterialRequestService.uploadAttachment({
          requestId: selectedRequest.id,
          file: importFile,
          fileType: 'excel_source',
          isPrimary: false,
        });
        sourceAttachmentId = attachment.id;
      }
      const saved = await customMaterialRequestService.applyImport({
        requestId: selectedRequest.id,
        fileName: importFile?.name || 'import.xlsx',
        sourceAttachmentId,
        previewRows: importPreview,
      });
      setRequests(prev => prev.map(item => item.id === saved.id ? saved : item));
      hydrateForm(saved);
      await rememberSmartMapping();
      setPreviewOpen(false);
      setImportPreview([]);
      setSmartImportPreview(null);
      setImportFile(null);
      toast.success('Đã import Excel', `${validRows.length} dòng đã được thêm vào ${saved.code}.`);
    } catch (err: any) {
      logApiError('customMaterialRequest.applyImport', err);
      toast.error('Không áp dụng được import', getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAttachmentUpload = async (file?: File | null) => {
    if (!file || !selectedRequest || !activeAttachmentLineId) return;
    setSaving(true);
    try {
      await customMaterialRequestService.uploadAttachment({
        requestId: selectedRequest.id,
        lineId: activeAttachmentLineId,
        file,
        fileType: file.type.startsWith('image/') ? 'image' : /\.pdf$/i.test(file.name) ? 'pdf' : /\.(dwg|dxf)$/i.test(file.name) ? 'cad' : 'drawing',
        isPrimary: false,
      });
      const fresh = await customMaterialRequestService.getById(selectedRequest.id);
      if (fresh) {
        setRequests(prev => prev.map(item => item.id === fresh.id ? fresh : item));
        hydrateForm(fresh);
      }
      toast.success('Đã tải file', file.name);
    } catch (err: any) {
      logApiError('customMaterialRequest.uploadAttachment', err);
      toast.error('Không tải được file', getApiErrorMessage(err));
    } finally {
      setSaving(false);
      setActiveAttachmentLineId(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 p-4 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-black text-slate-800 dark:text-white">Phi tiêu chuẩn</h3>
              <p className="mt-1 text-[11px] font-bold text-slate-400">Quy cách, bản vẽ, RFQ/PO theo công trình</p>
            </div>
            <button
              type="button"
              onClick={() => selectRequest(null)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-black text-white hover:bg-blue-700"
            >
              <Plus size={14} /> Tạo
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
            <Search size={14} className="text-slate-400" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Tìm mã phiếu, hạng mục, diễn giải..."
              className="min-w-0 flex-1 bg-transparent text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-100"
            />
            <button type="button" onClick={() => loadRequests()} className="text-slate-400 hover:text-blue-600" title="Tải lại">
              <RefreshCcw size={14} />
            </button>
          </div>
        </div>
        <div className="max-h-[720px] overflow-y-auto p-2">
          {loading ? (
            <div className="flex h-36 items-center justify-center text-xs font-bold text-slate-400">
              <Loader2 size={16} className="mr-2 animate-spin" /> Đang tải phiếu...
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="p-8 text-center text-xs font-bold text-slate-400">Chưa có phiếu phi tiêu chuẩn</div>
          ) : filteredRequests.map(request => (
            <button
              key={request.id}
              type="button"
              onClick={() => selectRequest(request)}
              className={`mb-2 w-full rounded-lg border p-3 text-left transition ${selectedId === request.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs font-black text-blue-700">{request.code}</div>
                  <div className="mt-1 truncate text-xs font-black text-slate-800 dark:text-white">{request.title}</div>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black ${statusTone(request.status)}`}>
                  {STATUS_LABEL[request.status]}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-bold text-slate-500">
                <span>{request.lines.length} dòng</span>
                <span>{request.workPackage || 'Chưa có hạng mục'}</span>
                <span>{request.neededDate || 'Chưa có ngày'}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-black text-slate-800 dark:text-white">{selectedRequest?.code || 'Phiếu mới'}</h3>
                {selectedRequest && (
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${statusTone(selectedRequest.status)}`}>
                    {STATUS_LABEL[selectedRequest.status]}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] font-bold text-slate-400">Dữ liệu dòng là spec theo công trình, không tạo SKU/tồn kho chuẩn.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => importInputRef.current?.click()} disabled={!canEdit || saving}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <Upload size={14} /> Import Excel
              </button>
              <button type="button" onClick={exportTemplateWorkbook}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50">
                <FileSpreadsheet size={14} /> File mẫu
              </button>
              <button type="button" onClick={exportWorkbook} disabled={!selectedRequest}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <Download size={14} /> Excel NCC
              </button>
              <button type="button" onClick={printRequest} disabled={!selectedRequest}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <Printer size={14} /> In/PDF
              </button>
              <button type="button" onClick={saveDraft} disabled={!canEdit || saving}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu
              </button>
              <button type="button" onClick={submitRequest} disabled={!canEdit || saving || form.lines.length === 0}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-50">
                <Send size={14} /> Gửi duyệt
              </button>
              {canApprove && (
                <>
                  <button type="button" onClick={() => changeStatus('approved', 'Phòng vật tư duyệt phiếu')} disabled={saving}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white hover:bg-emerald-700">
                    <CheckCircle2 size={14} /> Duyệt
                  </button>
                  <button type="button" onClick={() => changeStatus('returned', 'Trả lại để bổ sung quy cách')} disabled={saving}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-black text-orange-700 hover:bg-orange-100">
                    <RotateCcw size={14} /> Trả lại
                  </button>
                  <button type="button" onClick={() => changeStatus('rejected', 'Từ chối phiếu')} disabled={saving}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-700 hover:bg-rose-100">
                    <XCircle size={14} /> Từ chối
                  </button>
                </>
              )}
            </div>
            <input ref={importInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={event => handleImportFile(event.target.files?.[0])} />
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf" className="hidden" onChange={event => handleAttachmentUpload(event.target.files?.[0])} />
          </div>

          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-500">Tên phiếu</span>
              <input value={form.title} onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))} disabled={!canEdit}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-500">Hạng mục</span>
              <input value={form.workPackage} onChange={event => setForm(prev => ({ ...prev, workPackage: event.target.value }))} disabled={!canEdit}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-500">Mục</span>
              <select value={form.templateKey} onChange={event => changeTemplate(event.target.value as CustomMaterialTemplateKey)} disabled={!canEdit}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50">
                {CUSTOM_MATERIAL_TEMPLATE_OPTIONS.map(option => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-500">Ngày cần hàng</span>
              <input type="date" value={form.neededDate || ''} onChange={event => setForm(prev => ({ ...prev, neededDate: event.target.value }))} disabled={!canEdit}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-500">Phạm vi</span>
              <input value={form.requestScope} onChange={event => setForm(prev => ({ ...prev, requestScope: event.target.value }))} disabled={!canEdit}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-500">Bộ phận đề xuất</span>
              <input value={form.requestingDepartment} onChange={event => setForm(prev => ({ ...prev, requestingDepartment: event.target.value }))} disabled={!canEdit}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-500">Người lập</span>
              <input value={form.requestedByName} onChange={event => setForm(prev => ({ ...prev, requestedByName: event.target.value }))} disabled={!canEdit}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-500">Ghi chú chung</span>
              <input value={form.note} onChange={event => setForm(prev => ({ ...prev, note: event.target.value }))} disabled={!canEdit}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
            </label>
          </div>
        </div>

        {previewOpen && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h4 className="text-sm font-black text-amber-900">Preview import Excel</h4>
                <p className="text-xs font-bold text-amber-700">
                  {importPreview.filter(row => row.status !== 'error').length} dòng hợp lệ, {importPreview.filter(row => row.status === 'error').length} dòng lỗi
                  {smartImportPreview ? ` • Sheet ${smartImportPreview.detectedSheet} • Tin cậy ${Math.round(smartImportPreview.confidenceScore * 100)}%` : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={applyImport} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-black text-white">
                  <FileSpreadsheet size={14} /> Áp dụng
                </button>
                <button type="button" onClick={() => { setPreviewOpen(false); setSmartImportPreview(null); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 text-xs font-black text-amber-700">
                  <Ban size={14} /> Đóng
                </button>
              </div>
            </div>

            {smartImportPreview && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-black">
                  <span className={`rounded-full border px-2.5 py-1 ${smartImportPreview.source === 'ai' ? 'border-violet-200 bg-violet-50 text-violet-700' : smartImportPreview.source === 'memory' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600'}`}>
                    {smartImportSourceLabel[smartImportPreview.source]}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 ${smartImportPreview.confidenceScore < 0.7 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-white text-amber-700'}`}>
                    Confidence {Math.round(smartImportPreview.confidenceScore * 100)}%
                  </span>
                  <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-amber-700">
                    Dữ liệu: dòng {smartImportPreview.dataRange.startRow}-{smartImportPreview.dataRange.endRow}
                  </span>
                </div>
                {smartImportPreview.warnings.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-[11px] font-bold text-amber-800">
                    {smartImportPreview.warnings.slice(0, 4).join(' ')}
                  </div>
                )}
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {CUSTOM_MATERIAL_SMART_IMPORT_FIELDS.map(field => (
                    <label key={field.key} className="block">
                      <span className="text-[10px] font-black uppercase text-amber-800">
                        {field.label}{field.required ? ' *' : ''}
                      </span>
                      <select
                        value={smartImportPreview.mapping[field.key]?.columnIndex ?? ''}
                        onChange={event => changeSmartMapping(field.key, event.target.value)}
                        className="mt-1 h-9 w-full rounded-lg border border-amber-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-amber-400"
                      >
                        <option value="">Không map</option>
                        {smartImportPreview.sampleHeaders.map((header, index) => (
                          <option key={`${field.key}-${index}`} value={index}>
                            {`Cột ${index + 1}: ${header || '(trống)'}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-amber-200 bg-white">
              <table className={`w-full text-xs ${isXaGoTemplate ? 'min-w-[1550px]' : 'min-w-[820px]'}`}>
                {isXaGoTemplate ? (
                  <thead className="bg-amber-100 text-[10px] uppercase text-amber-800">
                    <tr>
                      <th className="px-3 py-2 text-left w-12">Dòng</th>
                      <th className="px-3 py-2 text-left w-36">Diễn giải</th>
                      <th className="px-3 py-2 text-left w-32">Chủng loại</th>
                      <th className="px-3 py-2 text-left w-48">Quy cách</th>
                      <th className="px-3 py-2 text-right w-28">SL CK</th>
                      <th className="px-3 py-2 text-right w-28">Dài(mm)</th>
                      <th className="px-3 py-2 text-right w-24">Kg/m</th>
                      <th className="px-3 py-2 text-right w-32">KL(kg)</th>
                      <th className="px-3 py-2 text-left w-40">Ghi chú</th>
                      <th className="px-3 py-2 text-left min-w-[200px] whitespace-normal">Trạng thái</th>
                    </tr>
                  </thead>
                ) : (
                  <thead className="bg-amber-100 text-[10px] uppercase text-amber-800">
                    <tr><th className="px-3 py-2 text-left">Dòng</th><th className="px-3 py-2 text-left">Diễn giải</th><th className="px-3 py-2 text-right">SL</th><th className="px-3 py-2 text-left">Màu</th><th className="px-3 py-2 text-left">Trạng thái</th></tr>
                  </thead>
                )}
                <tbody>
                  {importPreview.map((row, rowIndex) => {
                    const spec = row.line.specJson || {};
                    return (
                      <tr key={`${row.rowNumber}-${rowIndex}`} className="border-t border-amber-100 align-top">
                        <td className="px-3 py-2 font-mono">{row.rowNumber}</td>
                        <td className="px-3 py-2 font-bold">
                          {isXaGoTemplate ? (
                            <textarea value={row.line.description || ''} onChange={event => updatePreviewXaGoRow(rowIndex, { description: event.target.value })}
                              className="min-h-[38px] w-32 rounded-lg border border-amber-200 px-2 py-1 text-xs font-bold outline-none focus:border-amber-400" />
                          ) : row.line.description}
                        </td>
                        {isXaGoTemplate && (
                          <>
                            <td className="px-3 py-2">
                              <input value={String(spec.chung_loai || '')} onChange={event => updatePreviewXaGoRow(rowIndex, {}, { chung_loai: event.target.value })}
                                className="h-9 w-28 rounded-lg border border-amber-200 px-2 text-xs font-bold outline-none focus:border-amber-400" />
                            </td>
                            <td className="px-3 py-2">
                              <input value={String(spec.quy_cach || '')} onChange={event => updatePreviewXaGoRow(rowIndex, {}, { quy_cach: event.target.value })}
                                className="h-9 w-44 rounded-lg border border-amber-200 px-2 text-xs font-bold outline-none focus:border-amber-400" />
                            </td>
                          </>
                        )}
                        <td className="px-3 py-2 text-right">
                          {isXaGoTemplate ? (
                            <input type="number" value={row.line.quantity || ''} onChange={event => updatePreviewXaGoRow(rowIndex, { quantity: event.target.value === '' ? 0 : Number(event.target.value) })}
                              className="h-9 w-24 rounded-lg border border-amber-200 px-2 text-right text-xs font-bold outline-none focus:border-amber-400" />
                          ) : row.line.quantity}
                        </td>
                        {isXaGoTemplate ? (
                          <>
                            <td className="px-3 py-2 text-right">
                              <input type="number" value={String(spec.length_mm || '')} onChange={event => updatePreviewXaGoRow(rowIndex, {}, { length_mm: event.target.value === '' ? null : Number(event.target.value) })}
                                className="h-9 w-24 rounded-lg border border-amber-200 px-2 text-right text-xs font-bold outline-none focus:border-amber-400" />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input type="number" step="0.001" value={String(spec.kg_per_m || '')} onChange={event => updatePreviewXaGoRow(rowIndex, {}, { kg_per_m: event.target.value === '' ? null : Number(event.target.value) })}
                                className="h-9 w-20 rounded-lg border border-amber-200 px-2 text-right text-xs font-bold outline-none focus:border-amber-400" />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input type="number" step="0.01" value={String(spec.weight_kg || '')} onChange={event => updatePreviewXaGoRow(rowIndex, {}, { weight_kg: event.target.value === '' ? null : Number(event.target.value) })}
                                className="h-9 w-28 rounded-lg border border-amber-200 px-2 text-right text-xs font-bold outline-none focus:border-amber-400" />
                            </td>
                            <td className="px-3 py-2">
                              <textarea value={row.line.technicalNote || ''} onChange={event => updatePreviewXaGoRow(rowIndex, { technicalNote: event.target.value })}
                                className="min-h-[38px] w-36 rounded-lg border border-amber-200 px-2 py-1 text-xs font-bold outline-none focus:border-amber-400" />
                            </td>
                          </>
                        ) : (
                          <td className="px-3 py-2">{row.line.color || ''}</td>
                        )}
                        <td className={`px-3 py-2 font-bold ${row.status === 'error' ? 'text-rose-600' : 'text-emerald-700'}`}>
                          {row.errors.join('; ') || row.warnings?.join('; ') || 'Hợp lệ'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 dark:border-slate-800 md:flex-row md:items-center md:justify-between">
            <div>
              <h4 className="text-sm font-black text-slate-800 dark:text-white">Bảng quy cách</h4>
              <p className="text-[11px] font-bold text-slate-400">
                {isXaGoTemplate
                  ? `Tổng SL ${totals.qty.toLocaleString('vi-VN')} • Md ${totals.md.toLocaleString('vi-VN')} • Kg ${totals.kg.toLocaleString('vi-VN')}`
                  : `Tổng SL ${totals.qty.toLocaleString('vi-VN')} • M2 ${totals.area.toLocaleString('vi-VN')} • Md ${totals.md.toLocaleString('vi-VN')}`}
              </p>
            </div>
            <button type="button" onClick={addLine} disabled={!canEdit}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-black text-blue-700 hover:bg-blue-100 disabled:opacity-50">
              <Plus size={14} /> Thêm dòng
            </button>
          </div>
          <div className="overflow-x-auto">
            {isXaGoTemplate ? (
            <table className="w-full min-w-[1550px] text-xs">
              <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-3 text-left w-12">STT</th>
                  <th className="px-2 py-3 text-left w-40">Diễn giải</th>
                  <th className="px-2 py-3 text-left w-32">Chủng loại</th>
                  <th className="px-2 py-3 text-left w-48">Quy cách</th>
                  <th className="px-2 py-3 text-right w-28">SL cấu kiện</th>
                  <th className="px-2 py-3 text-right w-28">Dài(mm)</th>
                  <th className="px-2 py-3 text-right w-24">Kg/m</th>
                  <th className="px-2 py-3 text-right w-32">Khối lượng(kg)</th>
                  <th className="px-2 py-3 text-left w-44">Ghi chú</th>
                  <th className="px-2 py-3 text-left w-44">File</th>
                  <th className="px-2 py-3 text-center w-20">TT</th>
                  <th className="px-2 py-3 text-center w-12">Xóa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {form.lines.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-12 text-center text-xs font-bold text-slate-400">Chưa có dòng Xà gồ. Nhập trực tiếp hoặc import Excel mẫu Xà gồ.</td>
                  </tr>
                ) : form.lines.map((line, index) => {
                  const spec = buildXaGoSpec(line);
                  const calculatedWeight = calculateXaGoWeightKg(Number(line.quantity || 0), getSpecNumber(spec, 'length_mm'), getSpecNumber(spec, 'kg_per_m'));
                  const warning = getSpecNumber(spec, 'weight_kg') > 0 && calculatedWeight > 0 && Math.abs(getSpecNumber(spec, 'weight_kg') - calculatedWeight) > 0.5;
                  return (
                    <tr key={line.id || index} className="align-top hover:bg-slate-50/80 dark:hover:bg-slate-800/60">
                      <td className="px-2 py-2 font-mono font-bold text-slate-500">{index + 1}</td>
                      <td className="px-2 py-2">
                        <textarea value={line.description || ''} disabled={!canEdit} onChange={event => updateXaGoLine(index, { description: event.target.value })}
                          className="min-h-[42px] w-36 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
                      </td>
                      <td className="px-2 py-2">
                        <input value={String(spec.chung_loai || '')} disabled={!canEdit} onChange={event => updateXaGoLine(index, {}, { chung_loai: event.target.value })}
                          className="h-9 w-28 rounded-lg border border-slate-200 px-2 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
                      </td>
                      <td className="px-2 py-2">
                        <input value={String(spec.quy_cach || '')} disabled={!canEdit} onChange={event => updateXaGoLine(index, {}, { quy_cach: event.target.value })}
                          className="h-9 w-44 rounded-lg border border-slate-200 px-2 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" value={line.quantity ?? ''} disabled={!canEdit} onChange={event => updateXaGoLine(index, { quantity: event.target.value === '' ? 0 : Number(event.target.value) })}
                          className="h-9 w-24 rounded-lg border border-slate-200 px-2 text-right text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" value={getSpecNumber(spec, 'length_mm') || ''} disabled={!canEdit} onChange={event => updateXaGoLine(index, {}, { length_mm: event.target.value === '' ? null : Number(event.target.value) })}
                          className="h-9 w-24 rounded-lg border border-slate-200 px-2 text-right text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" step="0.001" value={getSpecNumber(spec, 'kg_per_m') || ''} disabled={!canEdit} onChange={event => updateXaGoLine(index, {}, { kg_per_m: event.target.value === '' ? null : Number(event.target.value) })}
                          className="h-9 w-20 rounded-lg border border-slate-200 px-2 text-right text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" step="0.01" value={getSpecNumber(spec, 'weight_kg') || ''} disabled={!canEdit} onChange={event => updateXaGoLine(index, {}, { weight_kg: event.target.value === '' ? null : Number(event.target.value) })}
                          className={`h-9 w-28 rounded-lg border px-2 text-right text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50 ${warning ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`} />
                        {warning && <div className="mt-1 text-[10px] font-bold text-amber-700">CT: {formatCustomMaterialNumber(calculatedWeight)} kg</div>}
                      </td>
                      <td className="px-2 py-2">
                        <textarea value={line.technicalNote || ''} disabled={!canEdit} onChange={event => updateXaGoLine(index, { technicalNote: event.target.value })}
                          className="min-h-[42px] w-40 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex max-w-[180px] flex-col gap-1">
                          {(line.attachments || []).slice(0, 3).map(attachment => <AttachmentButton key={attachment.id} attachment={attachment} />)}
                          {selectedRequest && line.id && (
                            <button type="button" disabled={saving} onClick={() => { setActiveAttachmentLineId(line.id!); fileInputRef.current?.click(); }}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-black text-slate-600 hover:bg-slate-50">
                              <Paperclip size={12} /> Thêm file
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black whitespace-nowrap ${statusTone(line.status || selectedRequest?.status || 'draft')}`}>
                          {LINE_STATUS_LABEL[(line.status || 'draft') as CustomMaterialLineStatus] || line.status || 'Nháp'}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button type="button" onClick={() => removeLine(index)} disabled={!canEdit}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            ) : (
            <table className="w-full min-w-[1320px] text-xs">
              <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-3 text-left">STT</th>
                  <th className="px-2 py-3 text-left">Nhóm</th>
                  <th className="px-2 py-3 text-left">Diễn giải</th>
                  <th className="px-2 py-3 text-right">Khổ</th>
                  <th className="px-2 py-3 text-right">Dài</th>
                  <th className="px-2 py-3 text-right">SL</th>
                  <th className="px-2 py-3 text-right">M2</th>
                  <th className="px-2 py-3 text-right">Md</th>
                  <th className="px-2 py-3 text-right">Dày</th>
                  <th className="px-2 py-3 text-left">Màu</th>
                  <th className="px-2 py-3 text-left">Ghi chú kỹ thuật</th>
                  <th className="px-2 py-3 text-left">File</th>
                  <th className="px-2 py-3 text-center">TT</th>
                  <th className="px-2 py-3 text-center">Xóa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {form.lines.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-3 py-12 text-center text-xs font-bold text-slate-400">Chưa có dòng quy cách. Nhập trực tiếp hoặc import Excel.</td>
                  </tr>
                ) : form.lines.map((line, index) => (
                  <tr key={line.id || index} className="align-top hover:bg-slate-50/80 dark:hover:bg-slate-800/60">
                    <td className="px-2 py-2 font-mono font-bold text-slate-500">{index + 1}</td>
                    <td className="px-2 py-2">
                      <select value={String(line.groupKey || 'other')} disabled={!canEdit} onChange={event => updateLine(index, { groupKey: event.target.value, profileType: event.target.value })}
                        className="h-9 w-32 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none disabled:bg-slate-50">
                        {PROFILE_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <textarea value={line.description || ''} disabled={!canEdit} onChange={event => updateLine(index, { description: event.target.value })}
                        className="min-h-[42px] w-56 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
                    </td>
                    {(['effectiveWidth', 'length', 'quantity', 'areaM2', 'lengthMd', 'thickness'] as const).map(key => (
                      <td key={key} className="px-2 py-2">
                        <input type="number" value={(line as any)[key] ?? ''} disabled={!canEdit} onChange={event => updateLine(index, { [key]: event.target.value === '' ? null : Number(event.target.value) } as Partial<DraftLine>)}
                          className="h-9 w-20 rounded-lg border border-slate-200 px-2 text-right text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
                      </td>
                    ))}
                    <td className="px-2 py-2">
                      <input value={line.color || ''} disabled={!canEdit} onChange={event => updateLine(index, { color: event.target.value })}
                        className="h-9 w-28 rounded-lg border border-slate-200 px-2 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
                    </td>
                    <td className="px-2 py-2">
                      <textarea value={line.technicalNote || ''} disabled={!canEdit} onChange={event => updateLine(index, { technicalNote: event.target.value })}
                        className="min-h-[42px] w-56 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold outline-none focus:border-blue-400 disabled:bg-slate-50" />
                      <textarea value={line.specDraft || '{}'} disabled={!canEdit} onChange={event => updateLine(index, { specDraft: event.target.value })}
                        className="mt-1 min-h-[42px] w-56 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[10px] text-slate-600 outline-none focus:border-blue-400 disabled:opacity-70" />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex max-w-[220px] flex-col gap-1">
                        {(line.attachments || []).slice(0, 3).map(attachment => <AttachmentButton key={attachment.id} attachment={attachment} />)}
                        {selectedRequest && line.id && (
                          <button type="button" disabled={saving} onClick={() => { setActiveAttachmentLineId(line.id!); fileInputRef.current?.click(); }}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-black text-slate-600 hover:bg-slate-50">
                            <Paperclip size={12} /> Thêm file
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black whitespace-nowrap ${statusTone(line.status || selectedRequest?.status || 'draft')}`}>
                        {LINE_STATUS_LABEL[(line.status || 'draft') as CustomMaterialLineStatus] || line.status || 'Nháp'}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button type="button" onClick={() => removeLine(index)} disabled={!canEdit}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
