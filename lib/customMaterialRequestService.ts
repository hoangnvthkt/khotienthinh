import { supabase } from './supabase';
import { fromDb, toDb } from './dbMapping';
import { loadXlsx } from './loadXlsx';
import { poService } from './projectService';
import { createPoQrToken } from './poQr';
import { customMaterialSmartImportService } from './customMaterialSmartImportService';
import {
  buildXaGoSpec,
  calculateXaGoWeightKg,
  CUSTOM_MATERIAL_PROFILE_LABELS,
  formatCustomMaterialLineSpec,
  formatCustomMaterialNumber,
  normalizeCustomMaterialTemplateKey,
} from './customMaterialTemplates';
import type {
  BusinessPartner,
  CustomMaterialAttachment,
  CustomMaterialDemandLine,
  CustomMaterialImportPreviewRow,
  CustomMaterialLineStatus,
  CustomMaterialProfileType,
  CustomMaterialRequest,
  CustomMaterialRequestLine,
  CustomMaterialRequestStatus,
  CustomMaterialRfq,
  CustomMaterialRfqSupplier,
  CustomMaterialSmartImportPreview,
  CustomMaterialTemplateKey,
  PurchaseOrder,
  PurchaseOrderItem,
} from '../types';

const REQUEST_TABLE = 'custom_material_requests';
const LINE_TABLE = 'custom_material_request_lines';
const ATTACHMENT_TABLE = 'custom_material_request_attachments';
const IMPORT_TABLE = 'custom_material_request_imports';
const EVENT_TABLE = 'custom_material_request_events';
const RFQ_TABLE = 'custom_material_rfqs';
const RFQ_LINE_TABLE = 'custom_material_rfq_lines';
const RFQ_SUPPLIER_TABLE = 'custom_material_rfq_suppliers';
const PO_LINE_TABLE = 'custom_material_po_lines';
const BUCKET = 'custom-material-attachments';

const PROFILE_LABELS = CUSTOM_MATERIAL_PROFILE_LABELS;

const PROFILE_KEYWORDS: Array<{ key: CustomMaterialProfileType; words: string[] }> = [
  { key: 'xa_go', words: ['xa go', 'xà gồ', 'xago', 'xct'] },
  { key: 'ton_seam_lock', words: ['seam', 'lock'] },
  { key: 'ton_5_song', words: ['5 song', '5 sóng', 'nam song'] },
  { key: 'ton_thung', words: ['thung', 'thưng'] },
  { key: 'phu_kien', words: ['phu kien', 'phụ kiện', 'diem', 'máng', 'mang', 'up', 'ốp'] },
  { key: 'ket_cau_thep', words: ['ket cau', 'kết cấu', 'ban ma', 'bản mã', 'thep', 'thép'] },
];

const toFiniteNumber = (value: unknown, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value ?? '').trim().replace(/\s/g, '');
  if (!raw) return fallback;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+(\.\d+)?$/.test(raw)
      ? raw.replace(/\./g, '')
      : raw;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeText = (value?: string | null) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const sanitizeFileName = (name: string) =>
  name.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 140) || 'file';

const newUuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const buildCode = (prefix: string) => {
  const now = new Date();
  const seq = String(Date.now() % 100000).padStart(5, '0');
  return `${prefix}-${now.getFullYear()}-${seq}`;
};

const buildRfqNo = () => {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  return `RFQ-CM-${stamp}-${String(Date.now()).slice(-5)}`;
};

const inferProfile = (text: string): CustomMaterialProfileType => {
  const normalized = normalizeText(text);
  const match = PROFILE_KEYWORDS.find(item => item.words.some(word => normalized.includes(normalizeText(word))));
  return match?.key || 'other';
};

const mapRequest = (
  row: any,
  lines: CustomMaterialRequestLine[] = [],
  attachments: CustomMaterialAttachment[] = [],
): CustomMaterialRequest => ({
  ...(fromDb(row) as CustomMaterialRequest),
  templateKey: normalizeCustomMaterialTemplateKey(row.template_key ?? row.templateKey),
  lines,
  attachments,
});

const mapLine = (row: any, attachments: CustomMaterialAttachment[] = []): CustomMaterialRequestLine => ({
  ...(fromDb(row) as CustomMaterialRequestLine),
  quantity: Number(row.quantity || 0),
  effectiveWidth: row.effective_width == null ? null : Number(row.effective_width),
  length: row.length == null ? null : Number(row.length),
  areaM2: row.area_m2 == null ? null : Number(row.area_m2),
  lengthMd: row.length_md == null ? null : Number(row.length_md),
  thickness: row.thickness == null ? null : Number(row.thickness),
  orderedQty: Number(row.ordered_qty || 0),
  receivedQty: Number(row.received_qty || 0),
  quoteUnitPrice: row.quote_unit_price == null ? null : Number(row.quote_unit_price),
  quoteAmount: row.quote_amount == null ? null : Number(row.quote_amount),
  specJson: row.spec_json || {},
  attachments,
});

const mapAttachment = (row: any): CustomMaterialAttachment => fromDb(row) as CustomMaterialAttachment;
const mapRfq = (row: any, lineIds: string[] = [], suppliers: CustomMaterialRfqSupplier[] = []): CustomMaterialRfq => ({
  ...(fromDb(row) as CustomMaterialRfq),
  lineIds,
  suppliers,
});

const mapRfqSupplier = (row: any): CustomMaterialRfqSupplier => ({
  ...(fromDb(row) as CustomMaterialRfqSupplier),
  quoteUnitPrice: row.quote_unit_price == null ? null : Number(row.quote_unit_price),
  quoteAmount: row.quote_amount == null ? null : Number(row.quote_amount),
});

const buildLineRows = (requestId: string, requestCode: string, lines: Partial<CustomMaterialRequestLine>[]) =>
  lines.map((line, index) => {
    const id = line.id || newUuid();
    const lineCode = line.lineCode || `${requestCode}-L${String(index + 1).padStart(3, '0')}`;
    const profileType = line.profileType || line.groupKey || inferProfile(line.description || '');
    const quantity = Number(line.quantity || 0);
    const specJson = profileType === 'xa_go' || line.groupKey === 'xa_go'
      ? buildXaGoSpec({ ...line, quantity })
      : line.specJson || {};
    const lengthMm = Number(specJson.length_mm || 0);
    const xaGoLength = lengthMm > 0 ? lengthMm / 1000 : null;
    const xaGoLengthMd = lengthMm > 0 && quantity > 0 ? quantity * (lengthMm / 1000) : null;
    return {
      id,
      requestId,
      lineCode,
      sortOrder: line.sortOrder ?? index,
      groupKey: line.groupKey || profileType,
      profileType,
      description: String(line.description || '').trim() || 'Dòng vật tư phi tiêu chuẩn',
      effectiveWidth: line.effectiveWidth ?? null,
      length: profileType === 'xa_go' ? xaGoLength : line.length ?? null,
      quantity,
      areaM2: line.areaM2 ?? null,
      lengthMd: profileType === 'xa_go' ? xaGoLengthMd : line.lengthMd ?? null,
      thickness: line.thickness ?? null,
      color: line.color || null,
      unit: profileType === 'xa_go' ? 'cấu kiện' : line.unit || 'tấm',
      technicalNote: line.technicalNote || null,
      specJson,
      status: line.status || 'draft',
      orderedQty: Number(line.orderedQty || 0),
      receivedQty: Number(line.receivedQty || 0),
      quoteUnitPrice: line.quoteUnitPrice ?? null,
      quoteAmount: line.quoteAmount ?? null,
      selectedSupplierId: line.selectedSupplierId || null,
      selectedSupplierName: line.selectedSupplierName || null,
    };
  });

const createEvent = async (requestId: string, eventType: string, input: {
  lineId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
}) => {
  const { error } = await supabase.from(EVENT_TABLE).insert(toDb({
    requestId,
    lineId: input.lineId || null,
    eventType,
    fromStatus: input.fromStatus || null,
    toStatus: input.toStatus || null,
    note: input.note || null,
    metadata: input.metadata || {},
  }));
  if (error) throw error;
};

const loadRequestBundle = async (requestRows: any[]): Promise<CustomMaterialRequest[]> => {
  const requestIds = requestRows.map(row => row.id).filter(Boolean);
  if (requestIds.length === 0) return [];

  const [{ data: lineRows, error: lineError }, { data: attachmentRows, error: attachmentError }] = await Promise.all([
    supabase.from(LINE_TABLE).select('*').in('request_id', requestIds).order('sort_order', { ascending: true }),
    supabase.from(ATTACHMENT_TABLE).select('*').in('request_id', requestIds).order('created_at', { ascending: false }),
  ]);
  if (lineError) throw lineError;
  if (attachmentError) throw attachmentError;

  const attachments = (attachmentRows || []).map(mapAttachment);
  const attachmentsByLine = new Map<string, CustomMaterialAttachment[]>();
  const attachmentsByRequest = new Map<string, CustomMaterialAttachment[]>();
  attachments.forEach(attachment => {
    attachmentsByRequest.set(attachment.requestId, [...(attachmentsByRequest.get(attachment.requestId) || []), attachment]);
    if (attachment.lineId) {
      attachmentsByLine.set(attachment.lineId, [...(attachmentsByLine.get(attachment.lineId) || []), attachment]);
    }
  });

  const linesByRequest = new Map<string, CustomMaterialRequestLine[]>();
  (lineRows || []).forEach(row => {
    const line = mapLine(row, attachmentsByLine.get(row.id) || []);
    linesByRequest.set(line.requestId, [...(linesByRequest.get(line.requestId) || []), line]);
  });

  return requestRows.map(row => mapRequest(row, linesByRequest.get(row.id) || [], attachmentsByRequest.get(row.id) || []));
};

const firstValue = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of Object.keys(row)) {
    const normalized = normalizeText(key);
    if (keys.some(candidate => normalized === normalizeText(candidate))) return row[key];
  }
  for (const key of Object.keys(row)) {
    const normalized = normalizeText(key);
    if (keys.some(candidate => normalized.includes(normalizeText(candidate)))) return row[key];
  }
  return '';
};

const rowToGenericPreviewLine = (row: Record<string, unknown>, index: number): CustomMaterialImportPreviewRow => {
  const description = String(firstValue(row, ['Diễn giải', 'Dien giai', 'Tên vật tư', 'Ten vat tu', 'Mô tả', 'Mo ta']) || '').trim();
  const profileRaw = String(firstValue(row, ['Chủng loại', 'Profile type', 'Nhóm', 'Nhom']) || '');
  const profileType = (profileRaw ? inferProfile(profileRaw) : inferProfile(description)) || 'other';
  const effectiveWidth = toFiniteNumber(firstValue(row, ['Khổ hiệu dụng', 'Kho hieu dung', 'Khổ', 'Kho']), 0);
  const length = toFiniteNumber(firstValue(row, ['Chiều dài', 'Chieu dai', 'Dài', 'Dai']), 0);
  const quantity = toFiniteNumber(firstValue(row, ['Số tấm', 'So tam', 'Số lượng', 'So luong', 'SL']), 0);
  const areaM2 = toFiniteNumber(firstValue(row, ['Khối lượng (M2)', 'Khoi luong (M2)', 'M2', 'm2']), 0);
  const lengthMd = toFiniteNumber(firstValue(row, ['Khối lượng (Md)', 'Khoi luong (Md)', 'Md', 'md']), 0);
  const thickness = toFiniteNumber(firstValue(row, ['Độ dày', 'Do day', 'Dày', 'Day']), 0);
  const color = String(firstValue(row, ['Màu sắc', 'Mau sac', 'Màu', 'Mau']) || '').trim();
  const technicalNote = String(firstValue(row, ['Ghi chú', 'Ghi chu', 'Ghi chú kỹ thuật', 'Ghi chu ky thuat']) || '').trim();
  const errors: string[] = [];
  if (!description) errors.push('Thiếu diễn giải.');
  if (quantity <= 0) errors.push('Thiếu số lượng/số tấm.');

  return {
    rowNumber: index + 2,
    status: errors.length > 0 ? 'error' : 'create',
    errors,
    warnings: [],
    line: {
      sortOrder: index,
      groupKey: profileType,
      profileType,
      description,
      effectiveWidth: effectiveWidth || null,
      length: length || null,
      quantity,
      areaM2: areaM2 || null,
      lengthMd: lengthMd || null,
      thickness: thickness || null,
      color: color || null,
      unit: 'tấm',
      technicalNote: technicalNote || null,
      specJson: {},
      attachments: [],
    },
  };
};

const rowToXaGoPreviewLine = (row: Record<string, unknown>, index: number): CustomMaterialImportPreviewRow => {
  const description = String(firstValue(row, ['Diễn giải', 'Dien giai', 'Tên cấu kiện', 'Ten cau kien', 'Mã cấu kiện', 'Ma cau kien']) || '').trim();
  const chungLoai = String(firstValue(row, ['Chủng loại', 'Chung loai', 'Loại', 'Loai']) || '').trim();
  const quyCach = String(firstValue(row, ['Quy cách', 'Quy cach', 'Tiết diện', 'Tiet dien']) || '').trim();
  const quantity = toFiniteNumber(firstValue(row, ['SL cấu kiện', 'SL cau kien', 'Số CK', 'So CK', 'Số cấu kiện', 'So cau kien', 'SL']), 0);
  const lengthMm = toFiniteNumber(firstValue(row, ['Dài (mm)', 'Dai (mm)', 'Dài', 'Dai', 'Chiều dài (mm)', 'Chieu dai (mm)']), 0);
  const kgPerM = toFiniteNumber(firstValue(row, ['Kg/m', 'kg/m', 'Kgm', 'Trọng lượng mét', 'Trong luong met']), 0);
  const importedWeightKg = toFiniteNumber(firstValue(row, ['Khối lượng (kg)', 'Khoi luong (kg)', 'Khối lượng', 'Khoi luong', 'KL', 'Kg']), 0);
  const technicalNote = String(firstValue(row, ['Ghi chú', 'Ghi chu', 'Ghi chú kỹ thuật', 'Ghi chu ky thuat']) || '').trim();
  const calculatedWeightKg = calculateXaGoWeightKg(quantity, lengthMm, kgPerM);
  const weightKg = importedWeightKg || calculatedWeightKg;
  const lengthM = lengthMm > 0 ? lengthMm / 1000 : 0;
  const lengthMd = quantity > 0 && lengthMm > 0 ? quantity * lengthM : 0;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!description) errors.push('Thiếu diễn giải.');
  if (quantity <= 0) errors.push('Thiếu SL cấu kiện.');
  if (lengthMm <= 0) errors.push('Thiếu Dài(mm).');
  if (kgPerM <= 0) errors.push('Thiếu Kg/m.');
  if (importedWeightKg > 0 && calculatedWeightKg > 0 && Math.abs(importedWeightKg - calculatedWeightKg) > 0.5) {
    warnings.push(`Khối lượng nhập ${formatCustomMaterialNumber(importedWeightKg)} kg lệch công thức ${formatCustomMaterialNumber(calculatedWeightKg)} kg.`);
  }

  return {
    rowNumber: index + 2,
    status: errors.length > 0 ? 'error' : 'create',
    errors,
    warnings,
    line: {
      sortOrder: index,
      groupKey: 'xa_go',
      profileType: 'xa_go',
      description,
      effectiveWidth: null,
      length: lengthM || null,
      quantity,
      areaM2: null,
      lengthMd: lengthMd || null,
      thickness: null,
      color: null,
      unit: 'cấu kiện',
      technicalNote: technicalNote || null,
      specJson: {
        templateKey: 'xa_go',
        chung_loai: chungLoai,
        quy_cach: quyCach,
        length_mm: lengthMm || null,
        kg_per_m: kgPerM || null,
        weight_kg: weightKg || null,
        calculated_weight_kg: calculatedWeightKg || null,
      },
      attachments: [],
    },
  };
};

const rowToPreviewLine = (
  row: Record<string, unknown>,
  index: number,
  templateKey: CustomMaterialTemplateKey,
): CustomMaterialImportPreviewRow => {
  if (templateKey === 'xa_go') return rowToXaGoPreviewLine(row, index);
  return rowToGenericPreviewLine(row, index);
};

const downloadWorkbookBlob = async (sheets: Array<{ name: string; rows: unknown[][] }>) => {
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  sheets.forEach(sheet => {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  });
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

const buildSupplierHeaderRows = (request: CustomMaterialRequest) => [
  ['Mã phiếu', request.code],
  ['Tên phiếu', request.title],
  ['Hạng mục', request.workPackage || ''],
  ['Mục', request.workSection || ''],
  ['Mẫu', request.templateKey === 'xa_go' ? 'Xà gồ' : 'Khác / Generic'],
  ['Phạm vi', request.requestScope || ''],
  ['Ngày cần hàng', request.neededDate || ''],
  ['Ghi chú', request.note || ''],
  [],
];

const buildXaGoRows = (lines: CustomMaterialRequestLine[], includeLineCode = true) => [
  includeLineCode
    ? ['STT', 'Diễn giải', 'Chủng loại', 'Quy cách', 'SL cấu kiện', 'Dài (mm)', 'Kg/m', 'Khối lượng (kg)', 'Ghi chú', 'Mã dòng']
    : ['STT', 'Diễn giải', 'Chủng loại', 'Quy cách', 'SL cấu kiện', 'Dài (mm)', 'Kg/m', 'Khối lượng (kg)', 'Ghi chú'],
  ...lines.map((line, index) => {
    const spec = buildXaGoSpec(line);
    const row = [
      index + 1,
      line.description,
      spec.chung_loai || '',
      spec.quy_cach || '',
      line.quantity || '',
      spec.length_mm || '',
      spec.kg_per_m || '',
      spec.weight_kg || '',
      line.technicalNote || '',
    ];
    return includeLineCode ? [...row, line.lineCode] : row;
  }),
];

const buildGenericSupplierRows = (request: CustomMaterialRequest) => [
  ['STT', 'Nhóm', 'Diễn giải', 'Khổ hiệu dụng (m)', 'Chiều dài (m)', 'Số lượng', 'M2', 'Md', 'Độ dày', 'Màu sắc', 'Ghi chú kỹ thuật', 'Mã dòng'],
  ...request.lines.map((line, index) => [
    index + 1,
    PROFILE_LABELS[line.groupKey] || line.groupKey,
    line.description,
    line.effectiveWidth || '',
    line.length || '',
    line.quantity || '',
    line.areaM2 || '',
    line.lengthMd || '',
    line.thickness || '',
    line.color || '',
    line.technicalNote || '',
    line.lineCode,
  ]),
];

export const customMaterialRequestService = {
  profileLabels: PROFILE_LABELS,

  async listByProject(projectId: string, constructionSiteId?: string | null): Promise<CustomMaterialRequest[]> {
    if (!projectId && !constructionSiteId) return [];
    let query = supabase
      .from(REQUEST_TABLE)
      .select('*')
      .order('created_at', { ascending: false });
    if (projectId) query = query.eq('project_id', projectId);
    if (constructionSiteId) query = query.eq('construction_site_id', constructionSiteId);
    const { data, error } = await query;
    if (error) throw error;
    return loadRequestBundle(data || []);
  },

  async getById(id: string): Promise<CustomMaterialRequest | null> {
    if (!id) return null;
    const { data, error } = await supabase.from(REQUEST_TABLE).select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    const bundle = await loadRequestBundle(data ? [data] : []);
    return bundle[0] || null;
  },

  async createDraft(input: {
    projectId?: string | null;
    constructionSiteId?: string | null;
    title: string;
    workPackage?: string | null;
    workSection?: string | null;
    requestScope?: string | null;
    templateKey?: CustomMaterialTemplateKey | null;
    requestingDepartment?: string | null;
    requestedByName?: string | null;
    neededDate?: string | null;
    note?: string | null;
    createdBy: string;
    lines: Partial<CustomMaterialRequestLine>[];
  }): Promise<CustomMaterialRequest> {
    const id = newUuid();
    const code = buildCode('CMR');
    const now = new Date().toISOString();
    const request = {
      id,
      code,
      title: input.title || 'Đề xuất vật tư phi tiêu chuẩn',
      projectId: input.projectId || null,
      constructionSiteId: input.constructionSiteId || null,
      workPackage: input.workPackage || null,
      workSection: input.workSection || null,
      requestScope: input.requestScope || null,
      templateKey: normalizeCustomMaterialTemplateKey(input.templateKey),
      requestingDepartment: input.requestingDepartment || null,
      requestedByName: input.requestedByName || null,
      neededDate: input.neededDate || null,
      note: input.note || null,
      status: 'draft' as CustomMaterialRequestStatus,
      revision: 1,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    const { error: requestError } = await supabase.from(REQUEST_TABLE).insert(toDb(request));
    if (requestError) throw requestError;
    const rows = buildLineRows(id, code, input.lines);
    if (rows.length > 0) {
      const { error: lineError } = await supabase.from(LINE_TABLE).insert(rows.map(toDb));
      if (lineError) throw lineError;
    }
    await createEvent(id, 'created', { toStatus: 'draft' });
    return (await this.getById(id))!;
  },

  async updateDraft(input: {
    id: string;
    title: string;
    workPackage?: string | null;
    workSection?: string | null;
    requestScope?: string | null;
    templateKey?: CustomMaterialTemplateKey | null;
    requestingDepartment?: string | null;
    requestedByName?: string | null;
    neededDate?: string | null;
    note?: string | null;
    updatedBy: string;
    lines: Partial<CustomMaterialRequestLine>[];
  }): Promise<CustomMaterialRequest> {
    const current = await this.getById(input.id);
    if (!current) throw new Error('Không tìm thấy phiếu CMR.');
    const patch = {
      title: input.title || current.title,
      workPackage: input.workPackage || null,
      workSection: input.workSection || null,
      requestScope: input.requestScope || null,
      templateKey: normalizeCustomMaterialTemplateKey(input.templateKey || current.templateKey),
      requestingDepartment: input.requestingDepartment || null,
      requestedByName: input.requestedByName || null,
      neededDate: input.neededDate || null,
      note: input.note || null,
      updatedBy: input.updatedBy,
    };
    const { error: requestError } = await supabase.from(REQUEST_TABLE).update(toDb(patch)).eq('id', input.id);
    if (requestError) throw requestError;
    const rows = buildLineRows(input.id, current.code, input.lines);
    const keepIds = rows.map(row => row.id);
    if (keepIds.length > 0) {
      const { error: deleteError } = await supabase.from(LINE_TABLE).delete().eq('request_id', input.id).not('id', 'in', `(${keepIds.join(',')})`);
      if (deleteError) throw deleteError;
      const { error: upsertError } = await supabase.from(LINE_TABLE).upsert(rows.map(toDb), { onConflict: 'id' });
      if (upsertError) throw upsertError;
    } else {
      const { error: deleteAllError } = await supabase.from(LINE_TABLE).delete().eq('request_id', input.id);
      if (deleteAllError) throw deleteAllError;
    }
    await createEvent(input.id, 'updated', { note: 'Cập nhật nội dung phiếu' });
    return (await this.getById(input.id))!;
  },

  async setStatus(id: string, status: CustomMaterialRequestStatus, actorUserId: string, note?: string | null): Promise<CustomMaterialRequest> {
    const current = await this.getById(id);
    if (!current) throw new Error('Không tìm thấy phiếu CMR.');
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status, updatedBy: actorUserId };
    if (status === 'submitted') patch.submittedAt = now;
    if (status === 'approved') {
      patch.approvedAt = now;
      patch.approvedBy = actorUserId;
    }
    if (status === 'returned') {
      patch.returnedAt = now;
      patch.returnedBy = actorUserId;
    }
    if (status === 'rejected') {
      patch.rejectedAt = now;
      patch.rejectedBy = actorUserId;
    }
    if (status === 'cancelled') {
      patch.cancelledAt = now;
      patch.cancelledBy = actorUserId;
    }
    const { error } = await supabase.from(REQUEST_TABLE).update(toDb(patch)).eq('id', id);
    if (error) throw error;

    const nextLineStatus: Partial<Record<CustomMaterialRequestStatus, CustomMaterialLineStatus>> = {
      submitted: 'submitted',
      approved: 'approved',
      rejected: 'cancelled',
      cancelled: 'cancelled',
    };
    if (nextLineStatus[status]) {
      const { error: lineError } = await supabase
        .from(LINE_TABLE)
        .update({ status: nextLineStatus[status] })
        .eq('request_id', id)
        .in('status', ['draft', 'submitted']);
      if (lineError) throw lineError;
    }
    await createEvent(id, status, { fromStatus: current.status, toStatus: status, note });
    return (await this.getById(id))!;
  },

  submit(id: string, actorUserId: string, note?: string | null) {
    return this.setStatus(id, 'submitted', actorUserId, note);
  },

  async uploadAttachment(input: {
    requestId: string;
    lineId?: string | null;
    file: File;
    fileType?: CustomMaterialAttachment['fileType'];
    isPrimary?: boolean;
    revision?: number;
  }): Promise<CustomMaterialAttachment> {
    const safeName = sanitizeFileName(input.file.name);
    const storagePath = `${input.requestId}/${input.lineId || 'request'}/${newUuid()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, input.file, {
      contentType: input.file.type || undefined,
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const row = {
      requestId: input.requestId,
      lineId: input.lineId || null,
      storageBucket: BUCKET,
      storagePath,
      fileName: input.file.name,
      fileType: input.fileType || 'other',
      mimeType: input.file.type || null,
      fileSize: input.file.size || null,
      revision: input.revision || 1,
      isPrimary: Boolean(input.isPrimary),
    };
    const { data, error } = await supabase.from(ATTACHMENT_TABLE).insert(toDb(row)).select('*').single();
    if (error) throw error;
    if (input.fileType === 'excel_source') {
      await supabase.from(REQUEST_TABLE).update({ source_excel_attachment_id: data.id }).eq('id', input.requestId);
    }
    return mapAttachment(data);
  },

  async getAttachmentUrl(attachment: CustomMaterialAttachment): Promise<string> {
    const { data, error } = await supabase.storage.from(attachment.storageBucket || BUCKET).createSignedUrl(attachment.storagePath, 60 * 10);
    if (error) throw error;
    return data.signedUrl;
  },

  async importExcelPreview(file: File, templateKey: CustomMaterialTemplateKey = 'generic'): Promise<CustomMaterialImportPreviewRow[]> {
    const normalizedTemplateKey = normalizeCustomMaterialTemplateKey(templateKey);
    if (normalizedTemplateKey === 'xa_go') {
      const sheet = await customMaterialSmartImportService.previewWorkbook(file);
      return customMaterialSmartImportService.suggestLocal(sheet, normalizedTemplateKey).rows;
    }

    const XLSX = await loadXlsx();
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', raw: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '', raw: false });
    return rows
      .filter(row => Object.values(row).some(value => String(value ?? '').trim() !== ''))
      .map((row, index) => rowToPreviewLine(row, index, normalizedTemplateKey));
  },

  async importExcelSmartPreview(file: File, templateKey: CustomMaterialTemplateKey = 'generic'): Promise<CustomMaterialSmartImportPreview> {
    return customMaterialSmartImportService.suggestSmart({ file, templateKey });
  },

  async applyImport(input: {
    requestId: string;
    fileName: string;
    sourceAttachmentId?: string | null;
    previewRows: CustomMaterialImportPreviewRow[];
  }): Promise<CustomMaterialRequest> {
    const request = await this.getById(input.requestId);
    if (!request) throw new Error('Không tìm thấy phiếu CMR.');
    const validRows = input.previewRows.filter(row => row.status !== 'error');
    const nextLines = [
      ...request.lines,
      ...validRows.map(row => row.line),
    ];
    const { error: importError } = await supabase.from(IMPORT_TABLE).insert(toDb({
      requestId: input.requestId,
      sourceAttachmentId: input.sourceAttachmentId || null,
      fileName: input.fileName,
      columnMapping: { templateKey: request.templateKey },
      previewRows: input.previewRows,
      applied: true,
    }));
    if (importError) throw importError;
    return this.updateDraft({
      id: input.requestId,
      title: request.title,
      workPackage: request.workPackage,
      workSection: request.workSection,
      requestScope: request.requestScope,
      templateKey: request.templateKey,
      requestingDepartment: request.requestingDepartment,
      requestedByName: request.requestedByName,
      neededDate: request.neededDate,
      note: request.note,
      updatedBy: request.createdBy,
      lines: nextLines,
    });
  },

  async exportSupplierWorkbook(request: CustomMaterialRequest): Promise<Blob> {
    const headerRows = buildSupplierHeaderRows(request);
    const lineRows = request.templateKey === 'xa_go'
      ? buildXaGoRows(request.lines)
      : buildGenericSupplierRows(request);
    const attachmentRows = [
      ['Mã dòng', 'Tên file', 'Loại file', 'Revision', 'File chính'],
      ...(request.attachments || []).map(attachment => [
        request.lines.find(line => line.id === attachment.lineId)?.lineCode || request.code,
        attachment.fileName,
        attachment.fileType,
        attachment.revision,
        attachment.isPrimary ? 'Có' : '',
      ]),
    ];
    return downloadWorkbookBlob([
      { name: 'Phieu_de_xuat', rows: [...headerRows, ...lineRows] },
      { name: 'File_dinh_kem', rows: attachmentRows },
    ]);
  },

  async exportTemplateWorkbook(templateKey: CustomMaterialTemplateKey): Promise<Blob> {
    if (templateKey === 'xa_go') {
      return downloadWorkbookBlob([{
        name: 'Mau_Xa_go',
        rows: [
          ['STT', 'Diễn giải', 'Chủng loại', 'Quy cách', 'SL cấu kiện', 'Dài (mm)', 'Kg/m', 'Khối lượng (kg)', 'Ghi chú'],
          [1, 'XCT1', 'Mạ kẽm', 'ZZ250-2-20-72-20-78', 48, 10345, 6.78, 3367.87, ''],
          [2, 'XCT2', 'Mạ kẽm', 'ZZ250-2-20-72-20-78', 12, 9660, 6.78, 786.22, ''],
        ],
      }]);
    }
    return downloadWorkbookBlob([{
      name: 'Mau_Generic',
      rows: [
        ['STT', 'Nhóm', 'Diễn giải', 'Khổ hiệu dụng (m)', 'Chiều dài (m)', 'Số lượng', 'M2', 'Md', 'Độ dày', 'Màu sắc', 'Ghi chú kỹ thuật'],
        [1, 'Tôn seam lock', 'Tôn mái S1', 0.49, 33.62, 78, 1285, 2622.36, 0.45, 'PH W01 - Trắng', ''],
      ],
    }]);
  },

  async listApprovedDemand(): Promise<CustomMaterialDemandLine[]> {
    const { data, error } = await supabase
      .from(REQUEST_TABLE)
      .select('*')
      .in('status', ['approved', 'rfq_created', 'po_created', 'partially_received'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    const requests = await loadRequestBundle(data || []);
    return requests.flatMap(request => request.lines
      .filter(line => !['draft', 'submitted', 'cancelled', 'closed', 'received'].includes(line.status))
      .map(line => ({
        key: `${request.id}:${line.id}`,
        request,
        line,
        projectId: request.projectId,
        constructionSiteId: request.constructionSiteId,
        openQty: Math.max(0, Number(line.quantity || 0) - Number(line.orderedQty || 0)),
        orderedQty: Number(line.orderedQty || 0),
        receivedQty: Number(line.receivedQty || 0),
      })));
  },

  async listRfqs(): Promise<CustomMaterialRfq[]> {
    const { data, error } = await supabase.from(RFQ_TABLE).select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const rfqIds = (data || []).map(row => row.id);
    if (rfqIds.length === 0) return [];
    const [{ data: lineRows, error: lineError }, { data: supplierRows, error: supplierError }] = await Promise.all([
      supabase.from(RFQ_LINE_TABLE).select('*').in('rfq_id', rfqIds),
      supabase.from(RFQ_SUPPLIER_TABLE).select('*').in('rfq_id', rfqIds),
    ]);
    if (lineError) throw lineError;
    if (supplierError) throw supplierError;
    const lineIdsByRfq = new Map<string, string[]>();
    (lineRows || []).forEach(row => {
      lineIdsByRfq.set(row.rfq_id, [...(lineIdsByRfq.get(row.rfq_id) || []), row.line_id]);
    });
    const suppliersByRfq = new Map<string, CustomMaterialRfqSupplier[]>();
    (supplierRows || []).forEach(row => {
      const supplier = mapRfqSupplier(row);
      suppliersByRfq.set(supplier.rfqId, [...(suppliersByRfq.get(supplier.rfqId) || []), supplier]);
    });
    return (data || []).map(row => mapRfq(row, lineIdsByRfq.get(row.id) || [], suppliersByRfq.get(row.id) || []));
  },

  async createRfq(input: {
    lines: CustomMaterialDemandLine[];
    suppliers: BusinessPartner[];
    title?: string | null;
    note?: string | null;
    actorUserId: string;
  }): Promise<CustomMaterialRfq> {
    if (!input.lines.length) throw new Error('Chưa chọn dòng phi tiêu chuẩn để tạo RFQ.');
    if (!input.suppliers.length) throw new Error('Chưa chọn nhà cung cấp.');
    const first = input.lines[0];
    const rfq = {
      id: newUuid(),
      rfqNo: buildRfqNo(),
      projectId: first.projectId || null,
      constructionSiteId: first.constructionSiteId || null,
      status: 'sent',
      title: input.title || `RFQ ${first.request.code}`,
      note: input.note || null,
      createdBy: input.actorUserId,
    };
    const { error: rfqError } = await supabase.from(RFQ_TABLE).insert(toDb(rfq));
    if (rfqError) throw rfqError;
    const lineRows = input.lines.map((line, index) => toDb({
      rfqId: rfq.id,
      requestId: line.request.id,
      lineId: line.line.id,
      sortOrder: index,
    }));
    const supplierRows = input.suppliers.map(supplier => toDb({
      rfqId: rfq.id,
      supplierId: supplier.id,
      supplierName: supplier.name,
      status: 'invited',
    }));
    const [{ error: lineError }, { error: supplierError }] = await Promise.all([
      supabase.from(RFQ_LINE_TABLE).insert(lineRows),
      supabase.from(RFQ_SUPPLIER_TABLE).insert(supplierRows),
    ]);
    if (lineError) throw lineError;
    if (supplierError) throw supplierError;
    const lineIds = input.lines.map(line => line.line.id);
    const requestIds = Array.from(new Set(input.lines.map(line => line.request.id)));
    await Promise.all([
      supabase.from(LINE_TABLE).update({ status: 'rfq_created' }).in('id', lineIds),
      supabase.from(REQUEST_TABLE).update({ status: 'rfq_created' }).in('id', requestIds).eq('status', 'approved'),
      ...requestIds.map(requestId => createEvent(requestId, 'rfq_created', { toStatus: 'rfq_created', metadata: { rfqId: rfq.id, rfqNo: rfq.rfqNo } })),
    ]);
    return mapRfq(rfq, lineIds, supplierRows.map(row => fromDb(row) as CustomMaterialRfqSupplier));
  },

  async addSupplierQuote(input: {
    rfqId: string;
    supplierId: string;
    supplierName?: string | null;
    quoteUnitPrice: number;
    quoteAmount?: number | null;
    deliveryDate?: string | null;
    note?: string | null;
  }): Promise<void> {
    const amount = Number(input.quoteAmount || 0);
    const { error } = await supabase
      .from(RFQ_SUPPLIER_TABLE)
      .update(toDb({
        status: 'quoted',
        supplierName: input.supplierName || null,
        quoteUnitPrice: Number(input.quoteUnitPrice || 0),
        quoteAmount: amount || null,
        deliveryDate: input.deliveryDate || null,
        note: input.note || null,
        quoteSnapshot: {
          quoteUnitPrice: Number(input.quoteUnitPrice || 0),
          quoteAmount: amount || null,
          deliveryDate: input.deliveryDate || null,
        },
      }))
      .eq('rfq_id', input.rfqId)
      .eq('supplier_id', input.supplierId);
    if (error) throw error;

    const { data: rfqLines, error: lineReadError } = await supabase.from(RFQ_LINE_TABLE).select('line_id').eq('rfq_id', input.rfqId);
    if (lineReadError) throw lineReadError;
    const lineIds = (rfqLines || []).map(row => row.line_id);
    if (lineIds.length > 0) {
      const { error: updateLinesError } = await supabase
        .from(LINE_TABLE)
        .update(toDb({
          status: 'quoted',
          quoteUnitPrice: Number(input.quoteUnitPrice || 0),
          quoteAmount: amount || null,
          selectedSupplierId: input.supplierId,
          selectedSupplierName: input.supplierName || null,
        }))
        .in('id', lineIds);
      if (updateLinesError) throw updateLinesError;
    }
    await supabase.from(RFQ_TABLE).update({ status: 'quoted' }).eq('id', input.rfqId);
  },

  async exportRfq(rfq: CustomMaterialRfq, demandLines: CustomMaterialDemandLine[]): Promise<Blob> {
    const selected = demandLines.filter(line => rfq.lineIds?.includes(line.line.id));
    return downloadWorkbookBlob([{
      name: 'RFQ',
      rows: [
        ['RFQ', rfq.rfqNo],
        ['Tiêu đề', rfq.title || ''],
        ['Ghi chú', rfq.note || ''],
        [],
        ['STT', 'Mã dòng', 'Công trình/Phiếu', 'Nhóm', 'Diễn giải', 'Quy cách', 'Số lượng', 'M2', 'Md', 'Màu', 'Ghi chú'],
        ...selected.map((item, index) => [
          index + 1,
          item.line.lineCode,
          item.request.code,
          PROFILE_LABELS[item.line.groupKey] || item.line.groupKey,
          item.line.description,
          formatCustomMaterialLineSpec(item.line),
          item.line.quantity,
          item.line.areaM2 || '',
          item.line.lengthMd || '',
          item.line.color || '',
          item.line.technicalNote || '',
        ]),
      ],
    }]);
  },

  async createPoFromQuotedLines(input: {
    lines: CustomMaterialDemandLine[];
    supplierId: string;
    supplierName: string;
    actorUserId: string;
    expectedDeliveryDate?: string | null;
    note?: string | null;
  }): Promise<PurchaseOrder> {
    const validLines = input.lines.filter(item => item.line.selectedSupplierId === input.supplierId && item.openQty > 0);
    if (!validLines.length) throw new Error('Chưa có dòng đã báo giá hợp lệ để tạo PO.');
    const poNumber = await poService.nextNumber();
    const poItems: PurchaseOrderItem[] = validLines.map(item => ({
      lineId: newUuid(),
      itemId: item.line.id,
      vendorId: input.supplierId,
      vendorName: input.supplierName,
      sku: item.line.lineCode,
      name: item.line.description,
      unit: item.line.unit || 'tấm',
      qty: item.openQty,
      unitPrice: Number(item.line.quoteUnitPrice || 0),
      neededDate: item.request.neededDate || undefined,
      note: item.line.technicalNote || undefined,
      sourceType: 'custom_material_line',
      customMaterialRequestId: item.request.id,
      customMaterialRequestCode: item.request.code,
      customMaterialLineId: item.line.id,
      customMaterialLineCode: item.line.lineCode,
      itemNameSnapshot: item.line.description,
      specification: formatCustomMaterialLineSpec(item.line),
      specs: item.line.profileType === 'xa_go' || item.line.groupKey === 'xa_go'
        ? {
            quyCach: { value: String(item.line.specJson?.quy_cach || ''), unit: '', label: 'Quy cách' },
            chungLoai: { value: String(item.line.specJson?.chung_loai || ''), unit: '', label: 'Chủng loại' },
            lengthMm: { value: Number(item.line.specJson?.length_mm || 0) || '', unit: 'mm', label: 'Dài' },
            kgPerM: { value: Number(item.line.specJson?.kg_per_m || 0) || '', unit: 'kg/m', label: 'Kg/m' },
            weightKg: { value: Number(item.line.specJson?.weight_kg || 0) || '', unit: 'kg', label: 'Khối lượng' },
          }
        : {
            length: { value: item.line.length || '', unit: 'm', label: 'Chiều dài' },
            width: { value: item.line.effectiveWidth || '', unit: 'm', label: 'Khổ hiệu dụng' },
            thickness: { value: item.line.thickness || '', unit: 'mm', label: 'Độ dày' },
            color: { value: item.line.color || '', unit: '', label: 'Màu sắc' },
          },
      attachments: item.line.attachments || [],
    }));
    const totalAmount = poItems.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0), 0);
    const po: PurchaseOrder = {
      id: newUuid(),
      projectId: validLines[0].projectId || null,
      constructionSiteId: validLines[0].constructionSiteId || null,
      vendorId: input.supplierId,
      vendorName: input.supplierName,
      poNumber,
      items: poItems,
      totalAmount,
      orderDate: new Date().toISOString().slice(0, 10),
      expectedDeliveryDate: input.expectedDeliveryDate || undefined,
      status: 'draft',
      sourceMode: 'company_consolidated',
      approvalRequestTitle: `Đề nghị duyệt PO phi tiêu chuẩn ${poNumber}`,
      procurementGroupId: newUuid(),
      procurementGroupNo: poNumber,
      qrToken: createPoQrToken(),
      note: input.note || 'Tạo từ đề xuất vật tư phi tiêu chuẩn',
      createdById: input.actorUserId,
      createdAt: new Date().toISOString(),
    };
    await poService.upsert(po);
    const poLineRows = validLines.map((item, index) => toDb({
      purchaseOrderId: po.id,
      purchaseOrderLineId: poItems[index].lineId,
      requestId: item.request.id,
      lineId: item.line.id,
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      orderedQty: item.openQty,
      receivedQty: 0,
      unit: item.line.unit || 'tấm',
      unitPrice: Number(item.line.quoteUnitPrice || 0),
      note: input.note || null,
    }));
    const [{ error: linkError }, ...lineUpdates] = await Promise.all([
      supabase.from(PO_LINE_TABLE).insert(poLineRows),
      ...validLines.map(item => supabase.from(LINE_TABLE).update(toDb({
        status: 'ordered',
        orderedQty: Number(item.line.orderedQty || 0) + item.openQty,
        selectedSupplierId: input.supplierId,
        selectedSupplierName: input.supplierName,
      })).eq('id', item.line.id)),
    ]);
    if (linkError) throw linkError;
    const lineError = lineUpdates.find(result => result.error)?.error;
    if (lineError) throw lineError;
    await supabase.from(REQUEST_TABLE).update({ status: 'po_created' }).in('id', Array.from(new Set(validLines.map(item => item.request.id))));
    return po;
  },

  async recordReceipt(input: {
    lineId: string;
    receivedQty: number;
  }): Promise<void> {
    const { data: lineRow, error: readError } = await supabase.from(LINE_TABLE).select('*').eq('id', input.lineId).single();
    if (readError) throw readError;
    const nextReceived = Number(lineRow.received_qty || 0) + Number(input.receivedQty || 0);
    const nextStatus: CustomMaterialLineStatus = nextReceived >= Number(lineRow.quantity || 0) ? 'received' : 'partially_received';
    const { error } = await supabase
      .from(LINE_TABLE)
      .update(toDb({ receivedQty: nextReceived, status: nextStatus }))
      .eq('id', input.lineId);
    if (error) throw error;
    await supabase
      .from(PO_LINE_TABLE)
      .update(toDb({ receivedQty: nextReceived }))
      .eq('line_id', input.lineId);
  },
};
