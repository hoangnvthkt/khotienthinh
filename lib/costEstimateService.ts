import {
  ContractItem,
  ContractItemType,
  CostTemplate,
  CostTemplateItem,
  CostTemplateParameter,
  CostTemplateSection,
  EstimateAdjustment,
  EstimateConversionBatch,
  EstimateConversionItem,
  EstimateConversionTargetTable,
  EstimateItem,
  EstimateParameterCode,
  EstimateScenario,
  EstimateScenarioStatus,
  EstimateVersion,
  InternalNorm,
  InternalPriceBookItem,
  MaterialBudgetItem,
  ProjectWorkBoqItem,
  User,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { isSupabaseConfigured, supabase } from './supabase';
import { contractItemService } from './contractItemService';
import { boqService, workBoqService } from './projectService';
import { loadXlsx } from './loadXlsx';

export interface CostTemplateDetails extends CostTemplate {
  sections: CostTemplateSection[];
  items: CostTemplateItem[];
  parameters: CostTemplateParameter[];
}

export interface EstimateScenarioDetails extends EstimateScenario {
  items: EstimateItem[];
  adjustments: EstimateAdjustment[];
  versions: EstimateVersion[];
}

export interface EstimateDraftInput {
  templateId: string;
  name: string;
  customerName?: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  inputParameters: Record<string, unknown>;
  marginPercent?: number;
  createdBy?: string;
}

export interface EstimateConversionInput {
  estimate: EstimateScenarioDetails;
  contractId: string;
  contractType: ContractItemType;
  projectId?: string | null;
  constructionSiteId?: string | null;
  actorId?: string;
}

export interface EstimateConversionPreview {
  contractItems: Omit<ContractItem, 'id' | 'createdAt'>[];
  workBoqItems: ProjectWorkBoqItem[];
  materialBudgetItems: MaterialBudgetItem[];
}

export type EstimateExportMode = 'external' | 'internal';

export interface EstimateComparisonResult {
  estimates: EstimateScenarioDetails[];
  rows: Array<{
    code: string;
    name: string;
    values: Record<string, { quantity: number; quoteAmount: number; amount: number }>;
    spreadAmount: number;
  }>;
}

export interface EstimateAiSuggestion {
  templateId?: string;
  templateName?: string;
  suggestedInputs: Record<string, unknown>;
  missingParameters: string[];
  assumptions: string[];
  riskWarnings: string[];
  confidenceScore: number;
}

export interface CostImportValidationIssue {
  rowNumber: number;
  level: 'error' | 'warning';
  field: string;
  message: string;
}

export type CostImportAction = 'create' | 'update';

export interface CostImportValidationResult<TPayload> {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  createRows: number;
  updateRows: number;
  staleRows: number;
  payloads: TPayload[];
  issues: CostImportValidationIssue[];
  hasErrors: boolean;
}

export type InternalPriceBookImportPayload = Partial<InternalPriceBookItem> & {
  itemCode: string;
  itemName: string;
  unit: string;
  unitPrice: number;
  importAction?: CostImportAction;
  isStale?: boolean;
};

export type InternalNormImportPayload = Partial<InternalNorm> & {
  normCode: string;
  resourceName: string;
  unit: string;
  normQuantity: number;
  importAction?: CostImportAction;
  isStale?: boolean;
};

export interface EstimateConversionAudit {
  batch: EstimateConversionBatch | null;
  items: EstimateConversionItem[];
}

export interface EstimateConversionRollbackResult {
  batchId: string;
  deletedTargets: number;
  blockedReasons: string[];
}

export interface EstimateVarianceReportRow {
  code: string;
  name: string;
  itemType: EstimateItem['itemType'];
  estimatedQty: number;
  actualQty: number;
  quantityVariance: number;
  quantityVariancePercent: number | null;
  estimatedAmount: number;
  actualAmount: number;
  amountVariance: number;
  recommendation: string;
}

export interface EstimateVarianceReport {
  rows: EstimateVarianceReportRow[];
  summary: {
    estimatedAmount: number;
    actualAmount: number;
    amountVariance: number;
    highVarianceRows: number;
    recommendations: string[];
  };
}

const cleanUndefined = <T extends Record<string, any>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

const money = (value: unknown) => Math.round(Number(value || 0));
const num = (value: unknown) => Number(value || 0);
const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const yesterday = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
};

const DEFAULT_PARAMETERS: Array<Pick<CostTemplateParameter, 'code' | 'label' | 'dataType' | 'unit' | 'isRequired' | 'sortOrder' | 'options' | 'defaultValue'>> = [
  { code: 'floor_area', label: 'Diện tích sàn', dataType: 'number', unit: 'm2', isRequired: true, sortOrder: 10 },
  { code: 'height', label: 'Chiều cao', dataType: 'number', unit: 'm', isRequired: true, sortOrder: 20 },
  { code: 'span', label: 'Khẩu độ', dataType: 'number', unit: 'm', isRequired: true, sortOrder: 30 },
  { code: 'foundation_type', label: 'Loại móng', dataType: 'select', unit: '', isRequired: false, sortOrder: 40, options: ['móng đơn', 'móng cọc', 'móng băng'] },
  { code: 'roof_type', label: 'Loại mái', dataType: 'select', unit: '', isRequired: false, sortOrder: 50, options: ['tôn thường', 'tôn cách nhiệt'] },
  { code: 'wall_type', label: 'Loại vách', dataType: 'select', unit: '', isRequired: false, sortOrder: 60, options: ['tôn', 'panel', 'xây tường'] },
  { code: 'crane_capacity', label: 'Cầu trục', dataType: 'number', unit: 'tấn', isRequired: false, sortOrder: 70 },
  { code: 'finish_level', label: 'Mức hoàn thiện', dataType: 'select', unit: '', isRequired: false, sortOrder: 80, options: ['cơ bản', 'trung bình', 'cao'] },
  { code: 'region', label: 'Khu vực', dataType: 'select', unit: '', isRequired: false, sortOrder: 90, options: ['all', 'mien_bac', 'mien_nam'] },
];

const TEMPLATE_TABLE = 'cost_templates';
const SECTION_TABLE = 'cost_template_sections';
const ITEM_TABLE = 'cost_template_items';
const PARAMETER_TABLE = 'cost_template_parameters';
const PRICE_TABLE = 'internal_price_book';
const NORM_TABLE = 'internal_norms';
const ESTIMATE_TABLE = 'estimate_scenarios';
const ESTIMATE_ITEM_TABLE = 'estimate_items';
const ADJUSTMENT_TABLE = 'estimate_adjustments';
const VERSION_TABLE = 'estimate_versions';
const CONVERSION_BATCH_TABLE = 'estimate_conversion_batches';
const CONVERSION_ITEM_TABLE = 'estimate_conversion_items';

const mapTemplate = (row: any): CostTemplate => fromDb(row) as CostTemplate;
const mapSection = (row: any): CostTemplateSection => fromDb(row) as CostTemplateSection;
const mapItem = (row: any): CostTemplateItem => fromDb(row) as CostTemplateItem;
const mapParameter = (row: any): CostTemplateParameter => fromDb(row) as CostTemplateParameter;
const mapPrice = (row: any): InternalPriceBookItem => fromDb(row) as InternalPriceBookItem;
const mapNorm = (row: any): InternalNorm => fromDb(row) as InternalNorm;
const mapEstimate = (row: any): EstimateScenario => fromDb(row) as EstimateScenario;
const mapEstimateItem = (row: any): EstimateItem => fromDb(row) as EstimateItem;
const mapAdjustment = (row: any): EstimateAdjustment => fromDb(row) as EstimateAdjustment;
const mapVersion = (row: any): EstimateVersion => fromDb(row) as EstimateVersion;
const mapConversionBatch = (row: any): EstimateConversionBatch => fromDb(row) as EstimateConversionBatch;
const mapConversionItem = (row: any): EstimateConversionItem => fromDb(row) as EstimateConversionItem;

const isActiveToday = (row: { status: string; effectiveFrom?: string; effectiveTo?: string | null }) => {
  const date = today();
  return row.status === 'active'
    && (!row.effectiveFrom || row.effectiveFrom <= date)
    && (!row.effectiveTo || row.effectiveTo >= date);
};

const matchesRegion = (rowRegion: string | null | undefined, requestedRegion?: string | null) => {
  const region = (requestedRegion || 'all').toLowerCase();
  const itemRegion = (rowRegion || 'all').toLowerCase();
  return itemRegion === 'all' || itemRegion === region || region === 'all';
};

const buildVariableMap = (input: Record<string, unknown>) => {
  const map: Record<string, number> = {};
  Object.entries(input).forEach(([key, value]) => {
    if (typeof value === 'boolean') map[key] = value ? 1 : 0;
    else if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) map[key] = Number(value);
  });
  return map;
};

const evaluateFormula = (formula: string | null | undefined, input: Record<string, unknown>) => {
  if (!formula?.trim()) return { value: 0, missing: [] as string[], ok: false };
  const variables = buildVariableMap(input);
  const names = Array.from(new Set(formula.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []));
  const missing = names.filter(name => variables[name] === undefined);
  if (missing.length > 0) return { value: 0, missing, ok: false };
  let expression = formula;
  names.forEach(name => {
    expression = expression.replace(new RegExp(`\\b${name}\\b`, 'g'), String(variables[name]));
  });
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) return { value: 0, missing: [], ok: false };
  try {
    const value = Function(`"use strict"; return (${expression});`)();
    return { value: Number.isFinite(Number(value)) ? Number(value) : 0, missing: [] as string[], ok: true };
  } catch {
    return { value: 0, missing: [], ok: false };
  }
};

const findPrice = (
  prices: InternalPriceBookItem[],
  keywordCandidates: Array<string | null | undefined>,
  region?: string | null,
) => {
  const candidates = keywordCandidates.map(value => (value || '').trim().toLowerCase()).filter(Boolean);
  return prices
    .filter(price => isActiveToday(price) && matchesRegion(price.region, region))
    .find(price => {
      const code = price.itemCode.toLowerCase();
      const name = price.itemName.toLowerCase();
      return candidates.some(candidate => code === candidate || name.includes(candidate) || candidate.includes(name));
    }) || null;
};

const findNorms = (norms: InternalNorm[], item: CostTemplateItem, region?: string | null) =>
  norms
    .filter(norm => isActiveToday(norm) && matchesRegion(norm.region, region))
    .filter(norm =>
      (!!norm.templateItemId && norm.templateItemId === item.id)
      || (!!item.workCode && norm.workCode === item.workCode)
      || (!!item.normGroupCode && norm.normCode.toLowerCase().includes(item.normGroupCode.toLowerCase()))
    );

const calculateQuoteAmount = (amount: number, item: CostTemplateItem, marginPercent = 0) => {
  const percent = num(item.overheadPercent) + num(item.profitPercent) + num(item.riskBufferPercent) + num(marginPercent);
  return money(amount * (1 + percent / 100));
};

const buildEstimateItem = (input: {
  estimateId: string;
  templateItem: CostTemplateItem;
  sectionId?: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  quoteAmount: number;
  price?: InternalPriceBookItem | null;
  norm?: InternalNorm | null;
  code?: string;
  name?: string;
  itemType?: EstimateItem['itemType'];
  unit?: string | null;
  sortOrder: number;
  assumptions?: unknown[];
  confidenceScore?: number | null;
}): EstimateItem => ({
  id: newId(),
  estimateId: input.estimateId,
  sectionId: input.sectionId || input.templateItem.sectionId || null,
  templateItemId: input.templateItem.id,
  code: input.code || input.templateItem.code,
  name: input.name || input.templateItem.name,
  itemType: input.itemType || input.templateItem.itemType,
  unit: input.unit || input.templateItem.unit || input.price?.unit || null,
  quantityFormula: input.templateItem.quantityFormula || null,
  originalQuantity: input.quantity,
  originalUnitPrice: input.unitPrice,
  originalAmount: input.amount,
  quantity: input.quantity,
  unitPrice: input.unitPrice,
  amount: input.amount,
  quoteUnitPrice: input.quantity > 0 ? Math.round(input.quoteAmount / input.quantity) : 0,
  quoteAmount: input.quoteAmount,
  priceBookItemId: input.price?.id || null,
  normId: input.norm?.id || null,
  sourceSnapshot: {
    templateItem: input.templateItem,
    price: input.price || null,
    norm: input.norm || null,
  },
  assumptions: input.assumptions || [],
  confidenceScore: input.confidenceScore ?? 0.8,
  manualOverride: false,
  overrideReason: '',
  sortOrder: input.sortOrder,
});

const recalculateTotals = (items: EstimateItem[]) => {
  const totals = {
    totalMaterialAmount: 0,
    totalLaborAmount: 0,
    totalMachineAmount: 0,
    totalSubcontractAmount: 0,
    totalOverheadAmount: 0,
    totalAmount: 0,
    quoteAmount: 0,
  };
  items.forEach(item => {
    const amount = money(item.amount);
    if (item.itemType === 'material') totals.totalMaterialAmount += amount;
    else if (item.itemType === 'labor') totals.totalLaborAmount += amount;
    else if (item.itemType === 'machine') totals.totalMachineAmount += amount;
    else if (item.itemType === 'subcontract') totals.totalSubcontractAmount += amount;
    else if (item.itemType === 'overhead') totals.totalOverheadAmount += amount;
    totals.totalAmount += amount;
    totals.quoteAmount += money(item.quoteAmount ?? item.amount);
  });
  return totals;
};

const normalizeHeader = (value: unknown) => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const pickRow = (row: Record<string, unknown>, keys: string[], fallback: unknown = '') => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
  }
  return fallback;
};

const parseWorkbookRows = async (file: File): Promise<Record<string, unknown>[]> => {
  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rawRows.map(row => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]),
  ));
};

const excelDateToIso = (value: unknown, fallback = ''): string | null => {
  if (value === null || value === undefined || value === '') return fallback || null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return fallback || null;
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (iso) return iso;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? (fallback || null) : parsed.toISOString().slice(0, 10);
};

const validPriceTypes = new Set(['material', 'labor', 'machine', 'subcontract', 'overhead', 'other']);
const validStatuses = new Set(['draft', 'active', 'archived']);
const validSensitivityLevels = new Set(['internal', 'restricted']);
const STALE_PRICE_DAYS = 180;
const STALE_NORM_DAYS = 365;

const buildImportResult = <TPayload>(
  totalRows: number,
  payloads: TPayload[],
  issues: CostImportValidationIssue[],
): CostImportValidationResult<TPayload> => {
  const errorRows = new Set(issues.filter(issue => issue.level === 'error').map(issue => issue.rowNumber));
  const duplicateRows = new Set(issues.filter(issue => issue.field === 'duplicate_key').map(issue => issue.rowNumber));
  return {
    totalRows,
    validRows: payloads.length,
    invalidRows: errorRows.size,
    duplicateRows: duplicateRows.size,
    createRows: payloads.filter((payload: any) => payload.importAction === 'create').length,
    updateRows: payloads.filter((payload: any) => payload.importAction === 'update').length,
    staleRows: payloads.filter((payload: any) => payload.isStale).length,
    payloads,
    issues,
    hasErrors: issues.some(issue => issue.level === 'error'),
  };
};

const isDateStale = (isoDate: string | null | undefined, staleDays: number) => {
  if (!isoDate) return false;
  const time = new Date(isoDate).getTime();
  if (!Number.isFinite(time)) return false;
  return Date.now() - time > staleDays * 86400000;
};

const parsePriceImportRows = (
  rows: Record<string, unknown>[],
  actorId?: string,
  existingRows: InternalPriceBookItem[] = [],
): CostImportValidationResult<InternalPriceBookImportPayload> => {
  const issues: CostImportValidationIssue[] = [];
  const seen = new Map<string, number>();
  const existingByKey = new Map(existingRows.map(row => [`${row.itemCode.toLowerCase()}|${row.region.toLowerCase()}|${row.versionNo}`, row]));
  const payloads: InternalPriceBookImportPayload[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const itemCode = String(pickRow(row, ['item_code', 'ma', 'ma_vat_tu', 'ma_nguon_luc'])).trim();
    const itemName = String(pickRow(row, ['item_name', 'ten', 'ten_vat_tu', 'ten_nguon_luc'])).trim();
    const itemType = String(pickRow(row, ['item_type', 'loai'], 'material') || 'material').trim() as InternalPriceBookItem['itemType'];
    const unit = String(pickRow(row, ['unit', 'dvt', 'don_vi'])).trim();
    const region = String(pickRow(row, ['region', 'khu_vuc'], 'all') || 'all').trim();
    const unitPrice = num(pickRow(row, ['unit_price', 'don_gia', 'gia']));
    const versionNo = num(pickRow(row, ['version_no', 'version', 'phien_ban'], 1)) || 1;
    const status = String(pickRow(row, ['status', 'trang_thai'], 'draft') || 'draft').trim() as InternalPriceBookItem['status'];
    const sensitivityLevel = String(pickRow(row, ['sensitivity_level', 'do_nhay_cam'], 'internal') || 'internal').trim() as InternalPriceBookItem['sensitivityLevel'];
    const effectiveFrom = excelDateToIso(pickRow(row, ['effective_from', 'ngay_hieu_luc'], today()), today()) || today();
    const effectiveTo = excelDateToIso(pickRow(row, ['effective_to', 'het_hieu_luc'])) || null;
    const key = `${itemCode.toLowerCase()}|${region.toLowerCase()}|${versionNo}`;
    const rowIssues: CostImportValidationIssue[] = [];
    const isStale = isDateStale(effectiveFrom, STALE_PRICE_DAYS);

    if (!itemCode) rowIssues.push({ rowNumber, level: 'error', field: 'item_code', message: 'Thiếu mã đơn giá.' });
    if (!itemName) rowIssues.push({ rowNumber, level: 'error', field: 'item_name', message: 'Thiếu tên vật tư/nguồn lực.' });
    if (!unit) rowIssues.push({ rowNumber, level: 'error', field: 'unit', message: 'Thiếu đơn vị tính.' });
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) rowIssues.push({ rowNumber, level: 'error', field: 'unit_price', message: 'Đơn giá phải lớn hơn 0.' });
    if (!validPriceTypes.has(itemType)) rowIssues.push({ rowNumber, level: 'error', field: 'item_type', message: `Loại không hợp lệ: ${itemType}.` });
    if (!validStatuses.has(status)) rowIssues.push({ rowNumber, level: 'error', field: 'status', message: `Trạng thái không hợp lệ: ${status}.` });
    if (!validSensitivityLevels.has(sensitivityLevel)) rowIssues.push({ rowNumber, level: 'error', field: 'sensitivity_level', message: `Độ nhạy cảm không hợp lệ: ${sensitivityLevel}.` });
    if (itemCode && seen.has(key)) {
      rowIssues.push({ rowNumber, level: 'error', field: 'duplicate_key', message: `Trùng mã/khu vực/version với dòng ${seen.get(key)}.` });
    } else if (itemCode) {
      seen.set(key, rowNumber);
    }

    const existing = existingByKey.get(key);
    if (existing) {
      rowIssues.push({ rowNumber, level: 'warning', field: 'existing_key', message: 'Sẽ cập nhật bản đơn giá hiện có cùng mã/khu vực/version.' });
    }
    if (isStale) {
      rowIssues.push({ rowNumber, level: 'warning', field: 'effective_from', message: `Đơn giá có ngày hiệu lực quá ${STALE_PRICE_DAYS} ngày.` });
    }

    issues.push(...rowIssues);
    if (rowIssues.some(issue => issue.level === 'error')) return;
    payloads.push({
      id: existing?.id,
      itemCode,
      itemName,
      itemType,
      category: String(pickRow(row, ['category', 'nhom', 'danh_muc'])).trim(),
      spec: String(pickRow(row, ['spec', 'quy_cach', 'mo_ta'])).trim(),
      unit,
      region,
      brand: String(pickRow(row, ['brand', 'thuong_hieu'])).trim(),
      supplierName: String(pickRow(row, ['supplier_name', 'nha_cung_cap'])).trim(),
      currency: String(pickRow(row, ['currency', 'tien_te'], 'VND') || 'VND').trim(),
      unitPrice,
      versionNo,
      effectiveFrom,
      effectiveTo,
      status,
      sensitivityLevel,
      source: String(pickRow(row, ['source', 'nguon'])).trim(),
      note: String(pickRow(row, ['note', 'ghi_chu'])).trim(),
      createdBy: existing?.createdBy || actorId,
      updatedBy: actorId,
      importAction: existing ? 'update' : 'create',
      isStale,
    });
  });

  return buildImportResult(rows.length, payloads, issues);
};

const parseNormImportRows = (
  rows: Record<string, unknown>[],
  actorId?: string,
  existingRows: InternalNorm[] = [],
): CostImportValidationResult<InternalNormImportPayload> => {
  const issues: CostImportValidationIssue[] = [];
  const seen = new Map<string, number>();
  const existingByKey = new Map(existingRows.map(row => [`${row.normCode.toLowerCase()}|${row.region.toLowerCase()}|${row.versionNo}`, row]));
  const payloads: InternalNormImportPayload[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const normCode = String(pickRow(row, ['norm_code', 'ma_dinh_muc', 'ma'])).trim();
    const resourceName = String(pickRow(row, ['resource_name', 'ten_nguon_luc', 'ten_vat_tu', 'ten'])).trim();
    const resourceType = String(pickRow(row, ['resource_type', 'loai'], 'material') || 'material').trim() as InternalNorm['resourceType'];
    const unit = String(pickRow(row, ['unit', 'dvt', 'don_vi'])).trim();
    const region = String(pickRow(row, ['region', 'khu_vuc'], 'all') || 'all').trim();
    const normQuantity = num(pickRow(row, ['norm_quantity', 'dinh_muc', 'khoi_luong']));
    const versionNo = num(pickRow(row, ['version_no', 'version', 'phien_ban'], 1)) || 1;
    const status = String(pickRow(row, ['status', 'trang_thai'], 'draft') || 'draft').trim() as InternalNorm['status'];
    const effectiveFrom = excelDateToIso(pickRow(row, ['effective_from', 'ngay_hieu_luc'], today()), today()) || today();
    const effectiveTo = excelDateToIso(pickRow(row, ['effective_to', 'het_hieu_luc'])) || null;
    const key = `${normCode.toLowerCase()}|${region.toLowerCase()}|${versionNo}`;
    const rowIssues: CostImportValidationIssue[] = [];
    const isStale = isDateStale(effectiveFrom, STALE_NORM_DAYS);

    if (!normCode) rowIssues.push({ rowNumber, level: 'error', field: 'norm_code', message: 'Thiếu mã định mức.' });
    if (!resourceName) rowIssues.push({ rowNumber, level: 'error', field: 'resource_name', message: 'Thiếu tên nguồn lực/vật tư.' });
    if (!unit) rowIssues.push({ rowNumber, level: 'error', field: 'unit', message: 'Thiếu đơn vị tính.' });
    if (!Number.isFinite(normQuantity) || normQuantity <= 0) rowIssues.push({ rowNumber, level: 'error', field: 'norm_quantity', message: 'Định mức phải lớn hơn 0.' });
    if (!validPriceTypes.has(resourceType)) rowIssues.push({ rowNumber, level: 'error', field: 'resource_type', message: `Loại nguồn lực không hợp lệ: ${resourceType}.` });
    if (!validStatuses.has(status)) rowIssues.push({ rowNumber, level: 'error', field: 'status', message: `Trạng thái không hợp lệ: ${status}.` });
    if (normCode && seen.has(key)) {
      rowIssues.push({ rowNumber, level: 'error', field: 'duplicate_key', message: `Trùng mã/khu vực/version với dòng ${seen.get(key)}.` });
    } else if (normCode) {
      seen.set(key, rowNumber);
    }

    const existing = existingByKey.get(key);
    if (existing) {
      rowIssues.push({ rowNumber, level: 'warning', field: 'existing_key', message: 'Sẽ cập nhật bản định mức hiện có cùng mã/khu vực/version.' });
    }
    if (isStale) {
      rowIssues.push({ rowNumber, level: 'warning', field: 'effective_from', message: `Định mức có ngày hiệu lực quá ${STALE_NORM_DAYS} ngày.` });
    }

    issues.push(...rowIssues);
    if (rowIssues.some(issue => issue.level === 'error')) return;
    payloads.push({
      id: existing?.id,
      normCode,
      templateItemId: String(pickRow(row, ['template_item_id', 'template_item'])).trim() || null,
      workCode: String(pickRow(row, ['work_code', 'ma_cong_viec'])).trim(),
      resourceCode: String(pickRow(row, ['resource_code', 'ma_nguon_luc', 'ma_vat_tu'])).trim(),
      resourceName,
      resourceType,
      unit,
      normQuantity,
      wastePercent: num(pickRow(row, ['waste_percent', 'hao_hut'], 0)),
      formula: String(pickRow(row, ['formula', 'cong_thuc'])).trim(),
      region,
      versionNo,
      effectiveFrom,
      effectiveTo,
      status,
      sourceNote: String(pickRow(row, ['source_note', 'nguon', 'ghi_chu'])).trim(),
      confidenceScore: pickRow(row, ['confidence_score', 'do_tin_cay'], '') === '' ? null : num(pickRow(row, ['confidence_score', 'do_tin_cay'])),
      createdBy: existing?.createdBy || actorId,
      updatedBy: actorId,
      importAction: existing ? 'update' : 'create',
      isStale,
    });
  });

  return buildImportResult(rows.length, payloads, issues);
};

const createWorkbookFromRows = async (sheetName: string, rows: unknown[][]): Promise<Blob> => {
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  await appendSheet(workbook, rows, sheetName);
  return workbookBlob(workbook);
};

const workbookBlob = async (workbook: any) => {
  const XLSX = await loadXlsx();
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

const appendSheet = async (workbook: any, rows: unknown[][], sheetName: string) => {
  const XLSX = await loadXlsx();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
};

const isMissingPriceWarning = (warning: unknown) => String(warning || '').toLowerCase().includes('chưa có đơn giá');
const isFormulaBlockingWarning = (warning: unknown) => {
  const text = String(warning || '').toLowerCase();
  return text.includes('thiếu tham số') || text.includes('chưa tính được khối lượng');
};

const isIgnorableRelationError = (error: any) =>
  ['42P01', '42703', 'PGRST106', 'PGRST204', 'PGRST205'].includes(String(error?.code || ''))
  || /does not exist|schema cache|column .* not found/i.test(String(error?.message || ''));

const countByColumn = async (table: string, column: string, value: string | null | undefined) => {
  if (!isSupabaseConfigured || !value) return 0;
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, value);
  if (error) {
    if (isIgnorableRelationError(error)) return 0;
    throw error;
  }
  return count || 0;
};

const buildRollbackBlockReasons = async (items: EstimateConversionItem[]) => {
  const reasons: string[] = [];
  for (const item of items) {
    if (item.targetTable === 'contract_items') {
      const [payments, acceptances, logs, taskLinks, reconciliation] = await Promise.all([
        countByColumn('payment_certificate_items', 'contract_item_id', item.targetId),
        countByColumn('quantity_acceptance_items', 'contract_item_id', item.targetId),
        countByColumn('daily_log_volumes', 'contract_item_id', item.targetId),
        countByColumn('task_contract_items', 'contract_item_id', item.targetId),
        countByColumn('boq_reconciliation_work_lines', 'contract_item_id', item.targetId),
      ]);
      if (payments > 0) reasons.push(`${item.targetName || item.targetCode}: đã có ${payments} dòng chứng chỉ thanh toán.`);
      if (acceptances > 0) reasons.push(`${item.targetName || item.targetCode}: đã có ${acceptances} dòng nghiệm thu khối lượng.`);
      if (logs > 0) reasons.push(`${item.targetName || item.targetCode}: đã có ${logs} dòng nhật ký.`);
      if (taskLinks > 0) reasons.push(`${item.targetName || item.targetCode}: đã gắn ${taskLinks} task tiến độ.`);
      if (reconciliation > 0) reasons.push(`${item.targetName || item.targetCode}: đã có ${reconciliation} dòng đối soát BOQ.`);
    }

    if (item.targetTable === 'project_work_boq_items') {
      const [logs, acceptances, materialBudgets, snapshots, reconciliation, issueLines] = await Promise.all([
        countByColumn('daily_log_volumes', 'work_boq_item_id', item.targetId),
        countByColumn('quantity_acceptance_items', 'work_boq_item_id', item.targetId),
        countByColumn('material_budget_items', 'work_boq_item_id', item.targetId),
        countByColumn('material_request_boq_line_snapshots', 'work_boq_item_id', item.targetId),
        countByColumn('boq_reconciliation_work_lines', 'work_boq_item_id', item.targetId),
        countByColumn('material_issue_lines', 'work_boq_item_id', item.targetId),
      ]);
      if (logs > 0) reasons.push(`${item.targetName || item.targetCode}: Work BOQ đã có ${logs} dòng nhật ký.`);
      if (acceptances > 0) reasons.push(`${item.targetName || item.targetCode}: Work BOQ đã có ${acceptances} dòng nghiệm thu nội bộ.`);
      if (materialBudgets > 0) reasons.push(`${item.targetName || item.targetCode}: Work BOQ đã có ${materialBudgets} vật tư kế hoạch liên kết.`);
      if (snapshots > 0) reasons.push(`${item.targetName || item.targetCode}: Work BOQ đã có ${snapshots} dòng đề xuất vật tư.`);
      if (reconciliation > 0) reasons.push(`${item.targetName || item.targetCode}: Work BOQ đã có ${reconciliation} dòng đối soát.`);
      if (issueLines > 0) reasons.push(`${item.targetName || item.targetCode}: Work BOQ đã có ${issueLines} dòng xuất vật tư.`);
    }

    if (item.targetTable === 'material_budget_items') {
      const [snapshots, fulfillments, poLines, issueLines] = await Promise.all([
        countByColumn('material_request_boq_line_snapshots', 'material_budget_item_id', item.targetId),
        countByColumn('material_request_fulfillment_lines', 'material_budget_item_id', item.targetId),
        countByColumn('purchase_order_request_lines', 'material_budget_item_id', item.targetId),
        countByColumn('material_issue_lines', 'material_budget_item_id', item.targetId),
      ]);
      if (snapshots > 0) reasons.push(`${item.targetName || item.targetCode}: vật tư đã có ${snapshots} dòng đề xuất.`);
      if (fulfillments > 0) reasons.push(`${item.targetName || item.targetCode}: vật tư đã có ${fulfillments} dòng fulfillment.`);
      if (poLines > 0) reasons.push(`${item.targetName || item.targetCode}: vật tư đã có ${poLines} dòng PO.`);
      if (issueLines > 0) reasons.push(`${item.targetName || item.targetCode}: vật tư đã có ${issueLines} dòng xuất kho.`);
    }
  }
  return reasons;
};

const isTemplateUsedInLockedEstimate = async (templateId: string) => {
  if (!isSupabaseConfigured) return false;
  const { count, error } = await supabase
    .from(ESTIMATE_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('template_id', templateId)
    .in('status', ['finalized', 'converted']);
  if (error) throw error;
  return (count || 0) > 0;
};

const isPriceUsedInLockedEstimate = async (priceId: string) => {
  if (!isSupabaseConfigured) return false;
  const { data: items, error: itemError } = await supabase
    .from(ESTIMATE_ITEM_TABLE)
    .select('estimate_id')
    .eq('price_book_item_id', priceId);
  if (itemError) throw itemError;
  const estimateIds = Array.from(new Set((items || []).map((row: any) => row.estimate_id).filter(Boolean)));
  if (estimateIds.length === 0) return false;
  const { count, error } = await supabase
    .from(ESTIMATE_TABLE)
    .select('id', { count: 'exact', head: true })
    .in('id', estimateIds)
    .in('status', ['finalized', 'converted']);
  if (error) throw error;
  return (count || 0) > 0;
};

const isNormUsedInLockedEstimate = async (normId: string) => {
  if (!isSupabaseConfigured) return false;
  const { data: items, error: itemError } = await supabase
    .from(ESTIMATE_ITEM_TABLE)
    .select('estimate_id')
    .eq('norm_id', normId);
  if (itemError) throw itemError;
  const estimateIds = Array.from(new Set((items || []).map((row: any) => row.estimate_id).filter(Boolean)));
  if (estimateIds.length === 0) return false;
  const { count, error } = await supabase
    .from(ESTIMATE_TABLE)
    .select('id', { count: 'exact', head: true })
    .in('id', estimateIds)
    .in('status', ['finalized', 'converted']);
  if (error) throw error;
  return (count || 0) > 0;
};

export const costTemplateService = {
  defaultParameters: DEFAULT_PARAMETERS,

  async list(includeArchived = false): Promise<CostTemplateDetails[]> {
    if (!isSupabaseConfigured) return [];
    let templateQuery = supabase.from(TEMPLATE_TABLE).select('*').order('updated_at', { ascending: false });
    if (!includeArchived) templateQuery = templateQuery.neq('status', 'archived');
    const { data: templateRows, error } = await templateQuery;
    if (error) throw error;
    const templates = (templateRows || []).map(mapTemplate);
    if (templates.length === 0) return [];
    const ids = templates.map(template => template.id);
    const [sectionsResult, itemsResult, paramsResult] = await Promise.all([
      supabase.from(SECTION_TABLE).select('*').in('template_id', ids).order('sort_order', { ascending: true }),
      supabase.from(ITEM_TABLE).select('*').in('template_id', ids).order('sort_order', { ascending: true }),
      supabase.from(PARAMETER_TABLE).select('*').in('template_id', ids).order('sort_order', { ascending: true }),
    ]);
    if (sectionsResult.error) throw sectionsResult.error;
    if (itemsResult.error) throw itemsResult.error;
    if (paramsResult.error) throw paramsResult.error;
    const sections = (sectionsResult.data || []).map(mapSection);
    const items = (itemsResult.data || []).map(mapItem);
    const params = (paramsResult.data || []).map(mapParameter);
    return templates.map(template => ({
      ...template,
      sections: sections.filter(row => row.templateId === template.id),
      items: items.filter(row => row.templateId === template.id),
      parameters: params.filter(row => row.templateId === template.id),
    }));
  },

  async get(id: string): Promise<CostTemplateDetails | null> {
    return (await this.list(true)).find(template => template.id === id) || null;
  },

  async upsertTemplate(input: Partial<CostTemplate> & { code: string; name: string }): Promise<CostTemplate> {
    if (input.id && isSupabaseConfigured) {
      const existing = await this.get(input.id);
      if (existing?.status === 'active' && await isTemplateUsedInLockedEstimate(input.id)) {
        const onlyArchiving = input.status === 'archived' || input.effectiveTo !== existing.effectiveTo;
        if (!onlyArchiving) {
          throw new Error('Template active đã dùng trong dự toán đã chốt. Vui lòng tạo version mới thay vì sửa đè.');
        }
      }
    }
    const payload = cleanUndefined(toDb({
      id: input.id || newId(),
      code: input.code.trim(),
      name: input.name.trim(),
      projectType: input.projectType || 'nha_xuong',
      description: input.description || '',
      status: input.status || 'draft',
      versionNo: input.versionNo || 1,
      parentTemplateId: input.parentTemplateId || null,
      effectiveFrom: input.effectiveFrom || today(),
      effectiveTo: input.effectiveTo || null,
      parametersSchema: input.parametersSchema || {},
      assumptions: input.assumptions || [],
      metadata: input.metadata || {},
      createdBy: input.createdBy,
      updatedBy: input.updatedBy,
      createdAt: input.createdAt,
      updatedAt: nowIso(),
    }));
    if (!isSupabaseConfigured) return mapTemplate(payload);
    const { data, error } = await supabase.from(TEMPLATE_TABLE).upsert(payload, { onConflict: 'id' }).select('*').single();
    if (error) throw error;
    return mapTemplate(data);
  },

  async createVersion(template: CostTemplateDetails, actorId?: string): Promise<CostTemplateDetails> {
    const nextVersion = Math.max(template.versionNo + 1, ...((await this.list(true))
      .filter(row => row.code === template.code)
      .map(row => row.versionNo + 1)));
    const next = await this.upsertTemplate({
      ...template,
      id: newId(),
      versionNo: nextVersion,
      parentTemplateId: template.parentTemplateId || template.id,
      status: 'draft',
      effectiveFrom: today(),
      effectiveTo: null,
      createdBy: actorId || template.createdBy || undefined,
      updatedBy: actorId || undefined,
      createdAt: undefined,
      updatedAt: undefined,
    });
    const sectionIdMap = new Map<string, string>();
    for (const section of template.sections) {
      const cloneId = newId();
      sectionIdMap.set(section.id, cloneId);
      await this.upsertSection({
        ...section,
        id: cloneId,
        templateId: next.id,
        parentId: section.parentId ? sectionIdMap.get(section.parentId) || null : null,
        createdAt: undefined,
        updatedAt: undefined,
      });
    }
    await Promise.all(template.parameters.map(param => this.upsertParameter({
      ...param,
      id: newId(),
      templateId: next.id,
      createdAt: undefined,
      updatedAt: undefined,
    })));
    await Promise.all(template.items.map(item => this.upsertItem({
      ...item,
      id: newId(),
      templateId: next.id,
      sectionId: item.sectionId ? sectionIdMap.get(item.sectionId) || null : null,
      createdAt: undefined,
      updatedAt: undefined,
    })));
    return await this.get(next.id) as CostTemplateDetails;
  },

  async activate(template: CostTemplate, actorId?: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const peers = (await this.list(true)).filter(row => row.code === template.code && row.id !== template.id && row.status === 'active');
    if (peers.length > 0) {
      const { error: peerError } = await supabase
        .from(TEMPLATE_TABLE)
        .update(toDb({ status: 'archived', effectiveTo: yesterday(), updatedBy: actorId || null, updatedAt: nowIso() }))
        .in('id', peers.map(row => row.id));
      if (peerError) throw peerError;
    }
    const { error } = await supabase
      .from(TEMPLATE_TABLE)
      .update(toDb({ status: 'active', effectiveFrom: template.effectiveFrom || today(), effectiveTo: null, updatedBy: actorId || null, updatedAt: nowIso() }))
      .eq('id', template.id);
    if (error) throw error;
  },

  async archive(template: CostTemplate, actorId?: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase
      .from(TEMPLATE_TABLE)
      .update(toDb({ status: 'archived', effectiveTo: template.effectiveTo || yesterday(), updatedBy: actorId || null, updatedAt: nowIso() }))
      .eq('id', template.id);
    if (error) throw error;
  },

  async upsertSection(input: Partial<CostTemplateSection> & { templateId: string; code: string; name: string }): Promise<CostTemplateSection> {
    const payload = cleanUndefined(toDb({
      id: input.id || newId(),
      templateId: input.templateId,
      parentId: input.parentId || null,
      code: input.code.trim(),
      name: input.name.trim(),
      description: input.description || '',
      unit: input.unit || '',
      calculationMethod: input.calculationMethod || '',
      sortOrder: input.sortOrder ?? 0,
      metadata: input.metadata || {},
      createdAt: input.createdAt,
      updatedAt: nowIso(),
    }));
    if (!isSupabaseConfigured) return mapSection(payload);
    const { data, error } = await supabase.from(SECTION_TABLE).upsert(payload, { onConflict: 'id' }).select('*').single();
    if (error) throw error;
    return mapSection(data);
  },

  async upsertItem(input: Partial<CostTemplateItem> & { templateId: string; code: string; name: string }): Promise<CostTemplateItem> {
    const payload = cleanUndefined(toDb({
      id: input.id || newId(),
      templateId: input.templateId,
      sectionId: input.sectionId || null,
      code: input.code.trim(),
      name: input.name.trim(),
      itemType: input.itemType || 'work',
      unit: input.unit || '',
      quantityFormula: input.quantityFormula || '',
      baseQuantity: input.baseQuantity ?? null,
      defaultWastePercent: input.defaultWastePercent ?? 0,
      laborRate: input.laborRate ?? 0,
      machineRate: input.machineRate ?? 0,
      overheadPercent: input.overheadPercent ?? 0,
      profitPercent: input.profitPercent ?? 0,
      riskBufferPercent: input.riskBufferPercent ?? 0,
      costCategory: input.costCategory || '',
      workCode: input.workCode || '',
      materialSku: input.materialSku || '',
      normGroupCode: input.normGroupCode || '',
      sortOrder: input.sortOrder ?? 0,
      assumptions: input.assumptions || [],
      metadata: input.metadata || {},
      createdAt: input.createdAt,
      updatedAt: nowIso(),
    }));
    if (!isSupabaseConfigured) return mapItem(payload);
    const { data, error } = await supabase.from(ITEM_TABLE).upsert(payload, { onConflict: 'id' }).select('*').single();
    if (error) throw error;
    return mapItem(data);
  },

  async upsertParameter(input: Partial<CostTemplateParameter> & { templateId: string; code: string; label: string }): Promise<CostTemplateParameter> {
    const payload = cleanUndefined(toDb({
      id: input.id || newId(),
      templateId: input.templateId,
      code: input.code.trim(),
      label: input.label.trim(),
      dataType: input.dataType || 'number',
      unit: input.unit || '',
      isRequired: input.isRequired ?? true,
      defaultValue: input.defaultValue ?? null,
      options: input.options || [],
      validationRules: input.validationRules || {},
      sortOrder: input.sortOrder ?? 0,
      description: input.description || '',
      createdAt: input.createdAt,
      updatedAt: nowIso(),
    }));
    if (!isSupabaseConfigured) return mapParameter(payload);
    const { data, error } = await supabase.from(PARAMETER_TABLE).upsert(payload, { onConflict: 'id' }).select('*').single();
    if (error) throw error;
    return mapParameter(data);
  },

  async removeChild(table: 'sections' | 'items' | 'parameters', id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const tableName = table === 'sections' ? SECTION_TABLE : table === 'items' ? ITEM_TABLE : PARAMETER_TABLE;
    const { error } = await supabase.from(tableName).delete().eq('id', id);
    if (error) throw error;
  },
};

export const internalPriceBookService = {
  async list(includeArchived = false): Promise<InternalPriceBookItem[]> {
    if (!isSupabaseConfigured) return [];
    let query = supabase.from(PRICE_TABLE).select('*').order('updated_at', { ascending: false });
    if (!includeArchived) query = query.neq('status', 'archived');
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapPrice);
  },

  async upsert(input: Partial<InternalPriceBookItem> & { itemCode: string; itemName: string; unit: string; unitPrice: number }): Promise<InternalPriceBookItem> {
    if (input.id && isSupabaseConfigured && await isPriceUsedInLockedEstimate(input.id)) {
      throw new Error('Đơn giá này đã dùng trong dự toán đã chốt. Vui lòng tạo version mới thay vì sửa đè.');
    }
    const payload = cleanUndefined(toDb({
      id: input.id || newId(),
      itemCode: input.itemCode.trim(),
      itemName: input.itemName.trim(),
      itemType: input.itemType || 'material',
      category: input.category || '',
      spec: input.spec || '',
      unit: input.unit.trim(),
      region: input.region || 'all',
      brand: input.brand || '',
      supplierName: input.supplierName || '',
      currency: input.currency || 'VND',
      unitPrice: input.unitPrice || 0,
      versionNo: input.versionNo || 1,
      effectiveFrom: input.effectiveFrom || today(),
      effectiveTo: input.effectiveTo || null,
      status: input.status || 'draft',
      sensitivityLevel: input.sensitivityLevel || 'internal',
      source: input.source || '',
      note: input.note || '',
      createdBy: input.createdBy,
      updatedBy: input.updatedBy,
      createdAt: input.createdAt,
      updatedAt: nowIso(),
    }));
    if (!isSupabaseConfigured) return mapPrice(payload);
    const { data, error } = await supabase.from(PRICE_TABLE).upsert(payload, { onConflict: 'id' }).select('*').single();
    if (error) throw error;
    return mapPrice(data);
  },

  async createVersion(item: InternalPriceBookItem, actorId?: string): Promise<InternalPriceBookItem> {
    const peers = (await this.list(true)).filter(row => row.itemCode === item.itemCode && row.region === item.region);
    const nextVersion = Math.max(item.versionNo + 1, ...peers.map(row => row.versionNo + 1));
    return this.upsert({
      ...item,
      id: newId(),
      versionNo: nextVersion,
      status: 'draft',
      effectiveFrom: today(),
      effectiveTo: null,
      createdBy: actorId || item.createdBy || undefined,
      updatedBy: actorId || undefined,
      createdAt: undefined,
      updatedAt: undefined,
    });
  },

  async activate(item: InternalPriceBookItem, actorId?: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const peers = (await this.list(true)).filter(row => row.itemCode === item.itemCode && row.region === item.region && row.id !== item.id && row.status === 'active');
    if (peers.length > 0) {
      const { error: peerError } = await supabase
        .from(PRICE_TABLE)
        .update(toDb({ status: 'archived', effectiveTo: yesterday(), updatedBy: actorId || null, updatedAt: nowIso() }))
        .in('id', peers.map(row => row.id));
      if (peerError) throw peerError;
    }
    const { error } = await supabase
      .from(PRICE_TABLE)
      .update(toDb({ status: 'active', effectiveFrom: item.effectiveFrom || today(), effectiveTo: null, updatedBy: actorId || null, updatedAt: nowIso() }))
      .eq('id', item.id);
    if (error) throw error;
  },

  async archive(item: InternalPriceBookItem, actorId?: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase
      .from(PRICE_TABLE)
      .update(toDb({ status: 'archived', effectiveTo: item.effectiveTo || yesterday(), updatedBy: actorId || null, updatedAt: nowIso() }))
      .eq('id', item.id);
    if (error) throw error;
  },

  async validateImport(file: File, actorId?: string): Promise<CostImportValidationResult<InternalPriceBookImportPayload>> {
    const rows = await parseWorkbookRows(file);
    const existing = isSupabaseConfigured ? await this.list(true) : [];
    return parsePriceImportRows(rows, actorId, existing);
  },

  async importFromExcel(file: File, actorId?: string): Promise<number> {
    const result = await this.validateImport(file, actorId);
    if (result.hasErrors) {
      throw new Error(`File đơn giá còn ${result.invalidRows} dòng lỗi. Vui lòng kiểm tra preview trước khi import.`);
    }
    for (const payload of result.payloads) await this.upsert(payload);
    return result.payloads.length;
  },

  async createImportTemplate(): Promise<Blob> {
    return createWorkbookFromRows('Don_gia_noi_bo', [
      ['item_code', 'item_name', 'item_type', 'category', 'spec', 'unit', 'region', 'unit_price', 'version_no', 'effective_from', 'status', 'sensitivity_level', 'source', 'note'],
      ['STEEL_STRUCTURE', 'Thép kết cấu', 'material', 'Kết cấu thép', 'Q235/Q345', 'kg', 'all', 0, 1, today(), 'draft', 'internal', '', ''],
      ['LABOR_BASIC', 'Nhân công cơ bản', 'labor', 'Nhân công', '', 'công', 'all', 0, 1, today(), 'draft', 'internal', '', ''],
    ]);
  },

  async remove(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from(PRICE_TABLE).delete().eq('id', id);
    if (error) throw error;
  },
};

export const internalNormService = {
  async list(includeArchived = false): Promise<InternalNorm[]> {
    if (!isSupabaseConfigured) return [];
    let query = supabase.from(NORM_TABLE).select('*').order('updated_at', { ascending: false });
    if (!includeArchived) query = query.neq('status', 'archived');
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapNorm);
  },

  async upsert(input: Partial<InternalNorm> & { normCode: string; resourceName: string; unit: string; normQuantity: number }): Promise<InternalNorm> {
    if (input.id && isSupabaseConfigured && await isNormUsedInLockedEstimate(input.id)) {
      throw new Error('Định mức này đã dùng trong dự toán đã chốt. Vui lòng tạo version mới thay vì sửa đè.');
    }
    const payload = cleanUndefined(toDb({
      id: input.id || newId(),
      normCode: input.normCode.trim(),
      templateItemId: input.templateItemId || null,
      workCode: input.workCode || '',
      resourceCode: input.resourceCode || '',
      resourceName: input.resourceName.trim(),
      resourceType: input.resourceType || 'material',
      unit: input.unit.trim(),
      normQuantity: input.normQuantity || 0,
      wastePercent: input.wastePercent || 0,
      formula: input.formula || '',
      applicableParameters: input.applicableParameters || {},
      region: input.region || 'all',
      versionNo: input.versionNo || 1,
      effectiveFrom: input.effectiveFrom || today(),
      effectiveTo: input.effectiveTo || null,
      status: input.status || 'draft',
      sourceProjectId: input.sourceProjectId || null,
      sourceNote: input.sourceNote || '',
      confidenceScore: input.confidenceScore ?? null,
      createdBy: input.createdBy,
      updatedBy: input.updatedBy,
      createdAt: input.createdAt,
      updatedAt: nowIso(),
    }));
    if (!isSupabaseConfigured) return mapNorm(payload);
    const { data, error } = await supabase.from(NORM_TABLE).upsert(payload, { onConflict: 'id' }).select('*').single();
    if (error) throw error;
    return mapNorm(data);
  },

  async createVersion(norm: InternalNorm, actorId?: string): Promise<InternalNorm> {
    const peers = (await this.list(true)).filter(row => row.normCode === norm.normCode && row.region === norm.region);
    const nextVersion = Math.max(norm.versionNo + 1, ...peers.map(row => row.versionNo + 1));
    return this.upsert({
      ...norm,
      id: newId(),
      versionNo: nextVersion,
      status: 'draft',
      effectiveFrom: today(),
      effectiveTo: null,
      createdBy: actorId || norm.createdBy || undefined,
      updatedBy: actorId || undefined,
      createdAt: undefined,
      updatedAt: undefined,
    });
  },

  async activate(norm: InternalNorm, actorId?: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const peers = (await this.list(true)).filter(row => row.normCode === norm.normCode && row.region === norm.region && row.id !== norm.id && row.status === 'active');
    if (peers.length > 0) {
      const { error: peerError } = await supabase
        .from(NORM_TABLE)
        .update(toDb({ status: 'archived', effectiveTo: yesterday(), updatedBy: actorId || null, updatedAt: nowIso() }))
        .in('id', peers.map(row => row.id));
      if (peerError) throw peerError;
    }
    const { error } = await supabase
      .from(NORM_TABLE)
      .update(toDb({ status: 'active', effectiveFrom: norm.effectiveFrom || today(), effectiveTo: null, updatedBy: actorId || null, updatedAt: nowIso() }))
      .eq('id', norm.id);
    if (error) throw error;
  },

  async archive(norm: InternalNorm, actorId?: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase
      .from(NORM_TABLE)
      .update(toDb({ status: 'archived', effectiveTo: norm.effectiveTo || yesterday(), updatedBy: actorId || null, updatedAt: nowIso() }))
      .eq('id', norm.id);
    if (error) throw error;
  },

  async validateImport(file: File, actorId?: string): Promise<CostImportValidationResult<InternalNormImportPayload>> {
    const rows = await parseWorkbookRows(file);
    const existing = isSupabaseConfigured ? await this.list(true) : [];
    return parseNormImportRows(rows, actorId, existing);
  },

  async importFromExcel(file: File, actorId?: string): Promise<number> {
    const result = await this.validateImport(file, actorId);
    if (result.hasErrors) {
      throw new Error(`File định mức còn ${result.invalidRows} dòng lỗi. Vui lòng kiểm tra preview trước khi import.`);
    }
    for (const payload of result.payloads) await this.upsert(payload);
    return result.payloads.length;
  },

  async createImportTemplate(): Promise<Blob> {
    return createWorkbookFromRows('Dinh_muc_noi_bo', [
      ['norm_code', 'template_item_id', 'work_code', 'resource_code', 'resource_name', 'resource_type', 'unit', 'norm_quantity', 'waste_percent', 'region', 'version_no', 'effective_from', 'status', 'confidence_score', 'source_note'],
      ['STEEL_FRAME_KG', '', 'STEEL_FRAME', 'STEEL_STRUCTURE', 'Thép kết cấu', 'material', 'kg', 35, 3, 'all', 1, today(), 'draft', 0.7, ''],
      ['ROOF_SHEET_M2', '', 'ROOF', 'ROOF_SHEET', 'Tôn mái', 'material', 'm2', 1.16, 2, 'all', 1, today(), 'draft', 0.7, ''],
    ]);
  },

  async remove(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from(NORM_TABLE).delete().eq('id', id);
    if (error) throw error;
  },
};

export const estimateCalculationService = {
  calculate(input: {
    template: CostTemplateDetails;
    prices: InternalPriceBookItem[];
    norms: InternalNorm[];
    estimateId?: string;
    scenarioName: string;
    customerName?: string;
    projectId?: string | null;
    constructionSiteId?: string | null;
    inputParameters: Record<string, unknown>;
    marginPercent?: number;
    createdBy?: string;
  }): EstimateScenarioDetails {
    const estimateId = input.estimateId || newId();
    const region = String(input.inputParameters.region || 'all');
    const missingParameters = input.template.parameters
      .filter(param => param.isRequired && (input.inputParameters[param.code] === undefined || input.inputParameters[param.code] === ''))
      .map(param => param.code);
    const riskWarnings: string[] = [];
    const assumptions: string[] = [];
    const usedPrices: InternalPriceBookItem[] = [];
    const usedNorms: InternalNorm[] = [];
    const items: EstimateItem[] = [];

    input.template.items.forEach((templateItem, index) => {
      const formula = evaluateFormula(templateItem.quantityFormula, input.inputParameters);
      const quantity = formula.ok ? formula.value : num(templateItem.baseQuantity);
      if (formula.missing.length > 0) riskWarnings.push(`${templateItem.name}: thiếu tham số ${formula.missing.join(', ')}`);
      if (!formula.ok && !templateItem.baseQuantity) riskWarnings.push(`${templateItem.name}: chưa tính được khối lượng`);
      const price = findPrice(input.prices, [templateItem.materialSku, templateItem.workCode, templateItem.code, templateItem.name], region);
      if (!price) riskWarnings.push(`${templateItem.name}: chưa có đơn giá nội bộ active`);
      else usedPrices.push(price);
      const unitPrice = price?.unitPrice || 0;
      const wasteAmount = quantity * unitPrice * (num(templateItem.defaultWastePercent) / 100);
      const directAmount = quantity * unitPrice + wasteAmount;
      const extraCost = quantity * (num(templateItem.laborRate) + num(templateItem.machineRate));
      const amount = money(directAmount + extraCost);
      const quoteAmount = calculateQuoteAmount(amount, templateItem, input.marginPercent);
      items.push(buildEstimateItem({
        estimateId,
        templateItem,
        sectionId: templateItem.sectionId,
        quantity,
        unitPrice,
        amount,
        quoteAmount,
        price,
        sortOrder: index * 100,
        assumptions: [
          templateItem.quantityFormula ? `Công thức: ${templateItem.quantityFormula}` : 'Khối lượng nhập/cấu hình thủ công',
          price ? `Đơn giá: ${price.itemCode} v${price.versionNo}` : 'Chưa có đơn giá',
        ],
        confidenceScore: formula.ok && price ? 0.85 : 0.45,
      }));

      findNorms(input.norms, templateItem, region).forEach((norm, normIndex) => {
        usedNorms.push(norm);
        const normPrice = findPrice(input.prices, [norm.resourceCode, norm.resourceName], region);
        if (normPrice) usedPrices.push(normPrice);
        else riskWarnings.push(`${templateItem.name} / ${norm.resourceName}: chưa có đơn giá nội bộ active`);
        const normQuantity = quantity * num(norm.normQuantity) * (1 + num(norm.wastePercent) / 100);
        const normAmount = money(normQuantity * (normPrice?.unitPrice || 0));
        const normTemplateItem = { ...templateItem, itemType: norm.resourceType, unit: norm.unit };
        items.push(buildEstimateItem({
          estimateId,
          templateItem: normTemplateItem,
          sectionId: templateItem.sectionId,
          quantity: normQuantity,
          unitPrice: normPrice?.unitPrice || 0,
          amount: normAmount,
          quoteAmount: calculateQuoteAmount(normAmount, templateItem, input.marginPercent),
          price: normPrice,
          norm,
          code: `${templateItem.code}.${norm.normCode}`,
          name: `${templateItem.name} - ${norm.resourceName}`,
          itemType: norm.resourceType,
          unit: norm.unit,
          sortOrder: index * 100 + normIndex + 1,
          assumptions: [`Định mức: ${norm.normQuantity} ${norm.unit}/${templateItem.unit || 'đơn vị'}`],
          confidenceScore: norm.confidenceScore ?? (normPrice ? 0.8 : 0.5),
        }));
      });
    });

    if (missingParameters.length > 0) {
      assumptions.push('Dự toán đang thiếu tham số bắt buộc, cần bổ sung trước khi chốt.');
    }
    if (items.length === 0) {
      riskWarnings.push('Template chưa có hạng mục dự toán.');
    }

    const totals = recalculateTotals(items);
    const avgConfidence = items.length
      ? items.reduce((sum, item) => sum + num(item.confidenceScore), 0) / items.length
      : 0;
    const scenario: EstimateScenario = {
      id: estimateId,
      code: `EST-${new Date().getFullYear()}-${estimateId.slice(0, 6).toUpperCase()}`,
      name: input.scenarioName,
      projectId: input.projectId || null,
      constructionSiteId: input.constructionSiteId || null,
      customerName: input.customerName || '',
      projectType: input.template.projectType || '',
      status: 'draft',
      templateId: input.template.id,
      templateVersionNo: input.template.versionNo,
      inputParameters: input.inputParameters,
      missingParameters,
      assumptions,
      riskWarnings,
      confidenceScore: Math.round(avgConfidence * 100) / 100,
      totalMaterialAmount: totals.totalMaterialAmount,
      totalLaborAmount: totals.totalLaborAmount,
      totalMachineAmount: totals.totalMachineAmount,
      totalSubcontractAmount: totals.totalSubcontractAmount,
      totalOverheadAmount: totals.totalOverheadAmount,
      manualAdjustmentAmount: 0,
      totalAmount: totals.totalAmount,
      quoteAmount: totals.quoteAmount,
      currency: 'VND',
      marginPercent: input.marginPercent || 0,
      profitAmount: Math.max(0, totals.quoteAmount - totals.totalAmount),
      templateSnapshot: input.template as unknown as Record<string, unknown>,
      priceBookSnapshot: Array.from(new Map(usedPrices.map(price => [price.id, price])).values()),
      normsSnapshot: Array.from(new Map(usedNorms.map(norm => [norm.id, norm])).values()),
      calculationSnapshot: { generatedAt: nowIso(), inputParameters: input.inputParameters, itemCount: items.length },
      quoteSnapshot: { mode: 'external_quote_hides_internal_margin', quoteAmount: totals.quoteAmount },
      createdBy: input.createdBy || null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    return { ...scenario, items, adjustments: [], versions: [] };
  },
};

export const estimateScenarioService = {
  async list(): Promise<EstimateScenario[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase.from(ESTIMATE_TABLE).select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapEstimate);
  },

  async get(id: string): Promise<EstimateScenarioDetails | null> {
    if (!isSupabaseConfigured) return null;
    const [scenarioResult, itemsResult, adjustmentsResult, versionsResult] = await Promise.all([
      supabase.from(ESTIMATE_TABLE).select('*').eq('id', id).maybeSingle(),
      supabase.from(ESTIMATE_ITEM_TABLE).select('*').eq('estimate_id', id).order('sort_order', { ascending: true }),
      supabase.from(ADJUSTMENT_TABLE).select('*').eq('estimate_id', id).order('created_at', { ascending: true }),
      supabase.from(VERSION_TABLE).select('*').eq('estimate_id', id).order('version_no', { ascending: false }),
    ]);
    if (scenarioResult.error) throw scenarioResult.error;
    if (itemsResult.error) throw itemsResult.error;
    if (adjustmentsResult.error) throw adjustmentsResult.error;
    if (versionsResult.error) throw versionsResult.error;
    if (!scenarioResult.data) return null;
    return {
      ...mapEstimate(scenarioResult.data),
      items: (itemsResult.data || []).map(mapEstimateItem),
      adjustments: (adjustmentsResult.data || []).map(mapAdjustment),
      versions: (versionsResult.data || []).map(mapVersion),
    };
  },

  async createDraft(input: EstimateDraftInput): Promise<EstimateScenarioDetails> {
    const [template, prices, norms] = await Promise.all([
      costTemplateService.get(input.templateId),
      internalPriceBookService.list(),
      internalNormService.list(),
    ]);
    if (!template) throw new Error('Không tìm thấy template dự toán.');
    const draft = estimateCalculationService.calculate({
      template,
      prices,
      norms,
      scenarioName: input.name,
      customerName: input.customerName,
      projectId: input.projectId,
      constructionSiteId: input.constructionSiteId,
      inputParameters: input.inputParameters,
      marginPercent: input.marginPercent,
      createdBy: input.createdBy,
    });
    if (!isSupabaseConfigured) return draft;

    const scenarioPayload = toDb({ ...draft });
    delete scenarioPayload.items;
    delete scenarioPayload.adjustments;
    delete scenarioPayload.versions;
    const { error: scenarioError } = await supabase.from(ESTIMATE_TABLE).insert(scenarioPayload);
    if (scenarioError) throw scenarioError;
    const { error: itemsError } = await supabase.from(ESTIMATE_ITEM_TABLE).insert(draft.items.map(item => toDb(item)));
    if (itemsError) throw itemsError;
    return draft;
  },

  async updateItemOverride(
    item: EstimateItem,
    updates: { quantity: number; unitPrice: number; quoteUnitPrice?: number; overrideReason: string; actorId?: string; actorName?: string },
  ): Promise<void> {
    const quantity = num(updates.quantity);
    const unitPrice = num(updates.unitPrice);
    const quoteUnitPrice = updates.quoteUnitPrice ?? unitPrice;
    const payload = toDb({
      quantity,
      unitPrice,
      amount: money(quantity * unitPrice),
      quoteUnitPrice,
      quoteAmount: money(quantity * quoteUnitPrice),
      manualOverride: true,
      overrideReason: updates.overrideReason.trim(),
      overrideBy: updates.actorId || null,
      overrideByName: updates.actorName || '',
      overrideAt: nowIso(),
      updatedAt: nowIso(),
    });
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from(ESTIMATE_ITEM_TABLE).update(payload).eq('id', item.id);
    if (error) throw error;
    await this.refreshTotals(item.estimateId);
  },

  async refreshTotals(estimateId: string): Promise<void> {
    const detail = await this.get(estimateId);
    if (!detail || !isSupabaseConfigured) return;
    const totals = recalculateTotals(detail.items);
    const { error } = await supabase
      .from(ESTIMATE_TABLE)
      .update(toDb({ ...totals, profitAmount: Math.max(0, totals.quoteAmount - totals.totalAmount), updatedAt: nowIso() }))
      .eq('id', estimateId);
    if (error) throw error;
  },

  async updateStatus(
    estimate: EstimateScenarioDetails,
    status: EstimateScenarioStatus,
    actorId?: string,
    note?: string,
    options?: { allowMissingPriceOverride?: boolean; missingPriceOverrideReason?: string; actorCanOverride?: boolean },
  ): Promise<void> {
    if (status === 'finalized' && estimate.missingParameters.length > 0) {
      throw new Error('Dự toán còn thiếu tham số bắt buộc, chưa thể chốt.');
    }
    const formulaWarnings = (estimate.riskWarnings || []).filter(isFormulaBlockingWarning);
    if (status === 'finalized' && formulaWarnings.length > 0) {
      throw new Error('Dự toán còn dòng thiếu tham số hoặc chưa tính được khối lượng, chưa thể chốt.');
    }
    const missingPriceWarnings = (estimate.riskWarnings || []).filter(isMissingPriceWarning);
    if (status === 'finalized' && missingPriceWarnings.length > 0) {
      const allowed = options?.actorCanOverride && options?.allowMissingPriceOverride && options.missingPriceOverrideReason?.trim();
      if (!allowed) {
        throw new Error('Dự toán còn dòng thiếu đơn giá nội bộ active. HD admin cần nhập lý do ngoại lệ nếu vẫn muốn chốt.');
      }
      note = `${note || ''}\nNgoại lệ thiếu đơn giá: ${options.missingPriceOverrideReason}`.trim();
    }
    if (!isSupabaseConfigured) return;
    const versionNo = (estimate.versions?.[0]?.versionNo || 0) + 1;
    const patch: Partial<EstimateScenario> = { status, updatedAt: nowIso() };
    if (status === 'reviewed') patch.reviewedBy = actorId || null;
    if (status === 'finalized') patch.finalizedBy = actorId || null;
    const { error: updateError } = await supabase.from(ESTIMATE_TABLE).update(toDb(patch)).eq('id', estimate.id);
    if (updateError) throw updateError;
    const { error: versionError } = await supabase.from(VERSION_TABLE).insert(toDb({
      id: newId(),
      estimateId: estimate.id,
      versionNo,
      status,
      snapshot: estimate,
      changeNote: note || `Chuyển trạng thái ${status}`,
      createdBy: actorId || null,
      createdAt: nowIso(),
    }));
    if (versionError) throw versionError;
  },

  exportQuoteCsv(estimate: EstimateScenarioDetails): string {
    const rows = [
      ['Mã', 'Hạng mục', 'Đơn vị', 'Khối lượng', 'Đơn giá chào', 'Thành tiền chào', 'Ghi chú'],
      ...estimate.items.map(item => [
        item.code || '',
        item.name,
        item.unit || '',
        String(item.quantity || 0),
        String(item.quoteUnitPrice ?? item.unitPrice ?? 0),
        String(item.quoteAmount ?? item.amount ?? 0),
        item.manualOverride ? 'Đã chỉnh tay' : '',
      ]),
    ];
    return rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  },

  async exportExcel(estimate: EstimateScenarioDetails, mode: EstimateExportMode, canSeeInternalCost: boolean): Promise<Blob> {
    if (mode === 'external' && !['reviewed', 'finalized', 'converted'].includes(estimate.status)) {
      throw new Error('Báo giá gửi khách chỉ export khi phương án đã rà soát hoặc đã chốt.');
    }
    if (mode === 'internal' && !canSeeInternalCost) {
      throw new Error('Chỉ HD admin/Admin được export workbook nội bộ.');
    }
    const XLSX = await loadXlsx();
    const workbook = XLSX.utils.book_new();
    const quoteAmount = estimate.quoteAmount || estimate.totalAmount;
    const floorArea = num(estimate.inputParameters?.floor_area);
    const workRows = estimate.items.filter(item => !['material', 'overhead'].includes(item.itemType));
    const materialRows = estimate.items.filter(item => item.itemType === 'material');
    const manualRows = estimate.items.filter(item => item.manualOverride);

    await appendSheet(workbook, [
      ['Mã phương án', estimate.code || estimate.id],
      ['Tên phương án', estimate.name],
      ['Khách hàng', estimate.customerName || ''],
      ['Trạng thái', estimate.status],
      ['Tổng giá chào', quoteAmount],
      ['Đơn giá bình quân/m2', floorArea > 0 ? Math.round(quoteAmount / floorArea) : ''],
      ['Confidence', estimate.confidenceScore ?? ''],
      ...(mode === 'internal' ? [
        ['Giá vốn nội bộ', estimate.totalAmount],
        ['Lợi nhuận dự kiến', estimate.profitAmount || Math.max(0, quoteAmount - estimate.totalAmount)],
        ['Margin %', estimate.marginPercent ?? ''],
      ] : []),
      ['Ngày export', nowIso()],
    ], 'Tong_hop');

    await appendSheet(workbook, [
      ['Mã', 'Hạng mục', 'ĐVT', 'Khối lượng', 'Đơn giá chào', 'Thành tiền chào', 'Ghi chú'],
      ...estimate.items
        .filter(item => item.itemType !== 'overhead')
        .map(item => [
          item.code || '',
          item.name,
          item.unit || '',
          item.quantity,
          item.quoteUnitPrice ?? item.unitPrice,
          item.quoteAmount ?? item.amount,
          item.manualOverride ? 'Đã chỉnh theo review' : '',
        ]),
    ], 'Hang_muc_chao_gia');

    await appendSheet(workbook, [
      ['Mã', 'Vật tư', 'ĐVT', 'Khối lượng sơ bộ', 'Ghi chú'],
      ...materialRows.map(item => [item.code || '', item.name, item.unit || '', item.quantity, 'BOQ sơ bộ từ estimate']),
    ], 'BOQ_so_bo');

    await appendSheet(workbook, [
      ['Mã', 'Phạm vi công việc', 'ĐVT', 'Khối lượng dự kiến'],
      ...workRows.map(item => [item.code || '', item.name, item.unit || '', item.quantity]),
    ], 'Pham_vi');

    await appendSheet(workbook, [
      ['Loại', 'Nội dung'],
      ...estimate.assumptions.map(value => ['Giả định', String(value)]),
      ...estimate.riskWarnings.map(value => ['Cảnh báo rủi ro', String(value)]),
      ['Loại trừ', 'Các điều kiện thương mại, thuế/phí và phạm vi phát sinh sẽ theo hợp đồng/chào giá chính thức.'],
      ['Bảo mật', 'Bản gửi khách không bao gồm giá vốn, margin, profit và ghi chú nội bộ.'],
    ], 'Gia_dinh_Loai_tru');

    if (mode === 'internal') {
      await appendSheet(workbook, [
        ['Mã', 'Hạng mục', 'Loại', 'ĐVT', 'Khối lượng', 'Đơn giá vốn', 'Thành tiền vốn', 'Đơn giá chào', 'Thành tiền chào', 'Margin dòng', 'Chỉnh tay', 'Lý do'],
        ...estimate.items.map(item => {
          const quoteLineAmount = money(item.quoteAmount ?? item.amount);
          const costLineAmount = money(item.amount);
          return [
            item.code || '',
            item.name,
            item.itemType,
            item.unit || '',
            item.quantity,
            item.unitPrice,
            item.amount,
            item.quoteUnitPrice ?? item.unitPrice,
            item.quoteAmount ?? item.amount,
            quoteLineAmount - costLineAmount,
            item.manualOverride ? 'Có' : '',
            item.overrideReason || '',
          ];
        }),
      ], 'Noi_bo');

      await appendSheet(workbook, [
        ['Mã', 'Hạng mục', 'KL gốc', 'Đơn giá gốc', 'GT gốc', 'KL sau chỉnh', 'Đơn giá vốn sau chỉnh', 'Đơn giá chào sau chỉnh', 'Người chỉnh', 'Thời điểm', 'Lý do'],
        ...manualRows.map(item => [
          item.code || '',
          item.name,
          item.originalQuantity ?? '',
          item.originalUnitPrice ?? '',
          item.originalAmount ?? '',
          item.quantity,
          item.unitPrice,
          item.quoteUnitPrice ?? item.unitPrice,
          item.overrideByName || item.overrideBy || '',
          item.overrideAt || '',
          item.overrideReason || '',
        ]),
      ], 'Dong_chinh_tay');

      await appendSheet(workbook, [
        ['Loại', 'Nội dung'],
        ...estimate.riskWarnings.map(value => ['Risk', String(value)]),
        ...estimate.assumptions.map(value => ['Assumption', String(value)]),
      ], 'Risk_Warnings');
    }

    return workbookBlob(workbook);
  },

  async compare(ids: string[]): Promise<EstimateComparisonResult> {
    const uniqueIds = Array.from(new Set(ids)).slice(0, 3);
    const estimates = (await Promise.all(uniqueIds.map(id => this.get(id)))).filter(Boolean) as EstimateScenarioDetails[];
    const rowMap = new Map<string, EstimateComparisonResult['rows'][number]>();
    estimates.forEach(estimate => {
      estimate.items.forEach(item => {
        const key = item.code || item.name;
        const current = rowMap.get(key) || { code: item.code || key, name: item.name, values: {}, spreadAmount: 0 };
        current.values[estimate.id] = {
          quantity: num(item.quantity),
          quoteAmount: money(item.quoteAmount ?? item.amount),
          amount: money(item.amount),
        };
        rowMap.set(key, current);
      });
    });
    const rows = Array.from(rowMap.values()).map(row => {
      const amounts = Object.values(row.values).map(value => value.quoteAmount);
      return { ...row, spreadAmount: amounts.length ? Math.max(...amounts) - Math.min(...amounts) : 0 };
    }).sort((a, b) => b.spreadAmount - a.spreadAmount);
    return { estimates, rows };
  },

  async getConversionBatch(estimateId: string): Promise<EstimateConversionBatch | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from(CONVERSION_BATCH_TABLE)
      .select('*')
      .eq('estimate_id', estimateId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? mapConversionBatch(data) : null;
  },

  async listConversionItems(batchId: string): Promise<EstimateConversionItem[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from(CONVERSION_ITEM_TABLE)
      .select('*')
      .eq('batch_id', batchId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapConversionItem);
  },

  async getConversionAudit(estimateId: string): Promise<EstimateConversionAudit> {
    const batch = await this.getConversionBatch(estimateId);
    const items = batch ? await this.listConversionItems(batch.id) : [];
    return { batch, items };
  },

  buildConversionPreview(input: EstimateConversionInput): EstimateConversionPreview {
    const workItems = input.estimate.items.filter(item => ['work', 'subcontract', 'labor', 'machine'].includes(item.itemType));
    const materialItems = input.estimate.items.filter(item => item.itemType === 'material');
    return {
      contractItems: workItems.map((item, index) => ({
        contractId: input.contractId,
        contractType: input.contractType,
        projectId: input.projectId || input.estimate.projectId || null,
        constructionSiteId: input.constructionSiteId || input.estimate.constructionSiteId || null,
        parentId: undefined,
        code: item.code || `${index + 1}`,
        name: item.name,
        unit: item.unit || '',
        quantity: item.quantity,
        unitPrice: item.quoteUnitPrice ?? item.unitPrice,
        totalPrice: money(item.quoteAmount ?? item.amount),
        originalQuantity: item.quantity,
        originalUnitPrice: item.quoteUnitPrice ?? item.unitPrice,
        originalTotalPrice: money(item.quoteAmount ?? item.amount),
        revisedUnitPrice: item.quoteUnitPrice ?? item.unitPrice,
        revisedQuantity: item.quantity,
        revisedTotalPrice: money(item.quoteAmount ?? item.amount),
        description: `Từ estimate ${input.estimate.code || input.estimate.name}`,
        category: item.itemType,
        workCode: item.code || undefined,
        completedQuantity: 0,
        completedPercent: 0,
        order: index,
        note: item.overrideReason || '',
      })),
      workBoqItems: workItems.map((item, index) => ({
        id: newId(),
        projectId: input.projectId || input.estimate.projectId || null,
        constructionSiteId: input.constructionSiteId || input.estimate.constructionSiteId || null,
        sourceTaskId: null,
        parentId: null,
        wbsCode: item.code || `${index + 1}`,
        name: item.name,
        unit: item.unit || '',
        plannedQty: item.quantity,
        unitPrice: item.quoteUnitPrice ?? item.unitPrice,
        sortOrder: index,
        syncStatus: 'manual',
        notes: `Từ estimate ${input.estimate.code || input.estimate.name}`,
      })),
      materialBudgetItems: materialItems.map((item, index) => ({
        id: newId(),
        projectId: input.projectId || input.estimate.projectId || null,
        constructionSiteId: input.constructionSiteId || input.estimate.constructionSiteId || null,
        workBoqItemId: null,
        inventoryItemId: undefined,
        materialCode: item.code || '',
        category: item.itemType,
        itemName: item.name,
        unit: item.unit || '',
        budgetQty: item.quantity,
        budgetUnitPrice: item.unitPrice,
        budgetTotal: item.amount,
        actualQty: 0,
        wasteThreshold: 0,
        sortOrder: index,
        notes: `Từ estimate ${input.estimate.code || input.estimate.name}`,
      })),
    };
  },

  previewConversion(input: EstimateConversionInput): EstimateConversionPreview {
    if (input.estimate.status !== 'finalized') throw new Error('Chỉ xem preview chuyển đổi cho dự toán đã chốt.');
    if (input.estimate.convertedAt) throw new Error('Dự toán này đã được chuyển đổi.');
    return this.buildConversionPreview(input);
  },

  async convertToProjectDraft(input: EstimateConversionInput): Promise<EstimateConversionPreview> {
    if (input.estimate.status !== 'finalized') throw new Error('Chỉ chuyển đổi dự toán đã chốt.');
    if (input.estimate.convertedAt) throw new Error('Dự toán này đã được chuyển đổi.');
    const preview = this.previewConversion(input);
    if (!isSupabaseConfigured) return preview;
    const existingBatch = await this.getConversionBatch(input.estimate.id);
    if (existingBatch && existingBatch.status !== 'cancelled') throw new Error('Dự toán này đã có batch chuyển đổi, không thể chuyển đổi lại.');

    const workItems = input.estimate.items.filter(item => ['work', 'subcontract', 'labor', 'machine'].includes(item.itemType));
    const materialItems = input.estimate.items.filter(item => item.itemType === 'material');
    const createdContractItems = preview.contractItems.length > 0
      ? await contractItemService.batchCreate(preview.contractItems)
      : [];
    if (preview.workBoqItems.length > 0) await workBoqService.upsertMany(preview.workBoqItems);
    for (const material of preview.materialBudgetItems) {
      await boqService.upsert(material);
    }

    const batchId = newId();
    const batch: EstimateConversionBatch = {
      id: batchId,
      estimateId: input.estimate.id,
      contractId: input.contractId,
      contractType: input.contractType,
      projectId: input.projectId || input.estimate.projectId || null,
      constructionSiteId: input.constructionSiteId || input.estimate.constructionSiteId || null,
      status: 'completed',
      summary: {
        contractItems: preview.contractItems.length,
        workBoqItems: preview.workBoqItems.length,
        materialBudgetItems: preview.materialBudgetItems.length,
      },
      createdBy: input.actorId || input.estimate.createdBy || null,
      createdAt: nowIso(),
    };
    const mappingRows: EstimateConversionItem[] = [];
    const pushMapping = (
      estimateItemId: string | null | undefined,
      targetTable: EstimateConversionTargetTable,
      targetId: string,
      targetCode: string | null | undefined,
      targetName: string | null | undefined,
      targetSnapshot: Record<string, unknown>,
    ) => {
      mappingRows.push({
        id: newId(),
        batchId,
        estimateId: input.estimate.id,
        estimateItemId: estimateItemId || null,
        targetTable,
        targetId,
        targetCode: targetCode || '',
        targetName: targetName || '',
        targetSnapshot,
        createdAt: nowIso(),
      });
    };

    createdContractItems.forEach((target, index) => {
      pushMapping(workItems[index]?.id, 'contract_items', target.id, target.code, target.name, target as unknown as Record<string, unknown>);
    });
    preview.workBoqItems.forEach((target, index) => {
      pushMapping(workItems[index]?.id, 'project_work_boq_items', target.id, target.wbsCode, target.name, target as unknown as Record<string, unknown>);
    });
    preview.materialBudgetItems.forEach((target, index) => {
      pushMapping(materialItems[index]?.id, 'material_budget_items', target.id, target.materialCode, target.itemName, target as unknown as Record<string, unknown>);
    });

    const { error: batchError } = await supabase.from(CONVERSION_BATCH_TABLE).insert(toDb(batch));
    if (batchError) throw batchError;
    if (mappingRows.length > 0) {
      const { error: itemError } = await supabase.from(CONVERSION_ITEM_TABLE).insert(mappingRows.map(row => toDb(row)));
      if (itemError) throw itemError;
    }

    const { error } = await supabase.from(ESTIMATE_TABLE).update(toDb({
      status: 'converted',
      convertedContractId: input.contractId,
      convertedProjectId: input.projectId || input.estimate.projectId || null,
      convertedAt: nowIso(),
      updatedAt: nowIso(),
    })).eq('id', input.estimate.id);
    if (error) throw error;
    return preview;
  },

  async rollbackConversionBatch(
    estimate: EstimateScenarioDetails,
    actorId?: string,
  ): Promise<EstimateConversionRollbackResult> {
    if (!isSupabaseConfigured) return { batchId: '', deletedTargets: 0, blockedReasons: [] };
    const batch = await this.getConversionBatch(estimate.id);
    if (!batch) throw new Error('Không tìm thấy batch chuyển đổi để rollback.');
    if (batch.status === 'cancelled') throw new Error('Batch chuyển đổi này đã rollback.');
    const items = await this.listConversionItems(batch.id);
    const blockedReasons = await buildRollbackBlockReasons(items);
    if (blockedReasons.length > 0) {
      return { batchId: batch.id, deletedTargets: 0, blockedReasons };
    }

    let deletedTargets = 0;
    const materialItems = items.filter(item => item.targetTable === 'material_budget_items');
    const workBoqItems = items.filter(item => item.targetTable === 'project_work_boq_items');
    const contractItems = items.filter(item => item.targetTable === 'contract_items');

    for (const item of materialItems) {
      await boqService.remove(item.targetId);
      deletedTargets += 1;
    }
    for (const item of workBoqItems) {
      await workBoqService.remove(item.targetId);
      deletedTargets += 1;
    }
    for (const item of contractItems) {
      await contractItemService.remove(item.targetId);
      deletedTargets += 1;
    }

    const { error: batchError } = await supabase
      .from(CONVERSION_BATCH_TABLE)
      .update(toDb({
        status: 'cancelled',
        summary: {
          ...(batch.summary || {}),
          rollbackAt: nowIso(),
          rollbackBy: actorId || null,
          deletedTargets,
        },
      }))
      .eq('id', batch.id);
    if (batchError) throw batchError;

    const { error: estimateError } = await supabase
      .from(ESTIMATE_TABLE)
      .update(toDb({
        status: 'finalized',
        convertedContractId: null,
        convertedProjectId: null,
        convertedAt: null,
        updatedAt: nowIso(),
      }))
      .eq('id', estimate.id);
    if (estimateError) throw estimateError;

    return { batchId: batch.id, deletedTargets, blockedReasons: [] };
  },
};

export const estimateAiSuggestionService = {
  suggestInputs(input: {
    prompt: string;
    templates: CostTemplateDetails[];
    currentInput: Record<string, unknown>;
    selectedTemplateId?: string;
  }): EstimateAiSuggestion {
    const prompt = input.prompt.toLowerCase();
    const candidates = input.templates.filter(template => template.status !== 'archived');
    const selected = candidates.find(template => template.id === input.selectedTemplateId)
      || candidates.find(template =>
        prompt.includes(String(template.projectType || '').toLowerCase())
        || prompt.includes(template.name.toLowerCase())
        || prompt.includes(template.code.toLowerCase()))
      || candidates[0];

    const suggestedInputs: Record<string, unknown> = { ...input.currentInput };
    const numberMatches = Array.from(input.prompt.matchAll(/(\d+(?:[.,]\d+)?)\s*(m2|m²|m|tấn|tan)/gi));
    const firstArea = numberMatches.find(match => /m2|m²/i.test(match[2]));
    if (firstArea && !suggestedInputs.floor_area) suggestedInputs.floor_area = Number(firstArea[1].replace(',', '.'));
    const firstHeight = numberMatches.find(match => /^m$/i.test(match[2]));
    if (firstHeight && !suggestedInputs.height) suggestedInputs.height = Number(firstHeight[1].replace(',', '.'));
    const crane = numberMatches.find(match => /tấn|tan/i.test(match[2]));
    if (crane && !suggestedInputs.crane_capacity) suggestedInputs.crane_capacity = Number(crane[1].replace(',', '.'));

    if (prompt.includes('móng cọc')) suggestedInputs.foundation_type = 'móng cọc';
    else if (prompt.includes('móng băng')) suggestedInputs.foundation_type = 'móng băng';
    else if (prompt.includes('móng đơn')) suggestedInputs.foundation_type = 'móng đơn';
    if (prompt.includes('panel')) suggestedInputs.wall_type = 'panel';
    if (prompt.includes('tôn cách nhiệt')) suggestedInputs.roof_type = 'tôn cách nhiệt';
    if (prompt.includes('miền nam') || prompt.includes('mien nam')) suggestedInputs.region = 'mien_nam';
    if (prompt.includes('miền bắc') || prompt.includes('mien bac')) suggestedInputs.region = 'mien_bac';

    const params = selected?.parameters?.length ? selected.parameters : DEFAULT_PARAMETERS;
    const missingParameters = params
      .filter(param => param.isRequired && (suggestedInputs[param.code] === undefined || suggestedInputs[param.code] === ''))
      .map(param => param.code);
    return {
      templateId: selected?.id,
      templateName: selected?.name,
      suggestedInputs,
      missingParameters,
      assumptions: [
        'AI chỉ gợi ý điền form từ mô tả và Cost Library, không tự tạo dự toán.',
        selected ? `Template đề xuất: ${selected.name}` : 'Chưa có template phù hợp trong Cost Library.',
      ],
      riskWarnings: missingParameters.length > 0 ? [`Còn thiếu tham số bắt buộc: ${missingParameters.join(', ')}`] : [],
      confidenceScore: selected ? (missingParameters.length > 0 ? 0.62 : 0.78) : 0.3,
    };
  },
};

export const estimateHistoricalLearningService = {
  buildVarianceReport(input: {
    estimate: EstimateScenarioDetails;
    contractItems?: ContractItem[];
    materialBudgetItems?: MaterialBudgetItem[];
  }): EstimateVarianceReport {
    const contractByCode = new Map((input.contractItems || []).map(item => [item.code || item.workCode || item.name, item]));
    const materialByCode = new Map((input.materialBudgetItems || []).map(item => [item.materialCode || item.itemName, item]));
    const rows: EstimateVarianceReportRow[] = input.estimate.items.map(item => {
      const contract = contractByCode.get(item.code || item.name);
      const material = materialByCode.get(item.code || item.name);
      const actualQty = num(contract?.revisedQuantity ?? material?.actualQty ?? material?.budgetQty ?? 0);
      const estimatedQty = num(item.quantity);
      const estimatedAmount = money(item.quoteAmount ?? item.amount);
      const actualAmount = money(
        contract?.revisedTotalPrice
        ?? material?.actualTotal
        ?? (actualQty * num(contract?.revisedUnitPrice ?? material?.budgetUnitPrice ?? item.quoteUnitPrice ?? item.unitPrice)),
      );
      const quantityVariance = actualQty - estimatedQty;
      const amountVariance = actualAmount - estimatedAmount;
      const quantityVariancePercent = estimatedQty > 0 ? Math.round((quantityVariance / estimatedQty) * 10000) / 100 : null;
      const highVariance = Math.abs(quantityVariance) > Math.max(1, estimatedQty * 0.1)
        || Math.abs(amountVariance) > Math.max(1_000_000, estimatedAmount * 0.1);
      return {
        code: item.code || '',
        name: item.name,
        itemType: item.itemType,
        estimatedQty,
        actualQty,
        quantityVariance,
        quantityVariancePercent,
        estimatedAmount,
        actualAmount,
        amountVariance,
        recommendation: highVariance
          ? 'Cần HD admin review định mức/template cho version sau.'
          : 'Chênh lệch trong ngưỡng theo dõi.',
      };
    });
    const summary = rows.reduce((acc, row) => {
      acc.estimatedAmount += row.estimatedAmount;
      acc.actualAmount += row.actualAmount;
      if (row.recommendation.includes('review')) acc.highVarianceRows += 1;
      return acc;
    }, { estimatedAmount: 0, actualAmount: 0, highVarianceRows: 0 });
    const amountVariance = summary.actualAmount - summary.estimatedAmount;
    return {
      rows,
      summary: {
        estimatedAmount: summary.estimatedAmount,
        actualAmount: summary.actualAmount,
        amountVariance,
        highVarianceRows: summary.highVarianceRows,
        recommendations: summary.highVarianceRows > 0
          ? ['Có dòng chênh lệch cao, HD admin nên tạo version định mức/template mới sau khi review.']
          : ['Chưa có chênh lệch lớn; tiếp tục theo dõi khi dữ liệu thực tế đầy đủ hơn.'],
      },
    };
  },
};

export const estimatePermissionService = {
  canManageCostLibrary(user: User) {
    return user.role === 'ADMIN' ||
      (user.adminModules || []).includes('HD') ||
      (user.adminSubModules?.HD || []).includes('/hd/cost-library');
  },
  canCreateEstimate(user: User) {
    return user.role === 'ADMIN' ||
      (user.allowedModules || []).includes('HD') ||
      (user.allowedSubModules?.HD || []).includes('/hd/cost-library') ||
      (user.adminModules || []).includes('HD') ||
      (user.adminSubModules?.HD || []).includes('/hd/cost-library');
  },
  canSeeInternalCost(user: User) {
    return user.role === 'ADMIN' ||
      (user.adminModules || []).includes('HD') ||
      (user.adminSubModules?.HD || []).includes('/hd/cost-library');
  },
};

export const estimateParameterLabels: Record<EstimateParameterCode | string, string> = {
  floor_area: 'Diện tích sàn',
  height: 'Chiều cao',
  span: 'Khẩu độ',
  foundation_type: 'Loại móng',
  roof_type: 'Loại mái',
  wall_type: 'Loại vách',
  crane_capacity: 'Cầu trục',
  finish_level: 'Mức hoàn thiện',
  region: 'Khu vực',
};
