import { CostTemplateItem, InternalNorm, InternalPriceBookItem, Role, User } from '../types';
import { CostTemplateDetails } from './costEstimateService';
import { fromDb, toDb } from './dbMapping';
import { loadXlsx } from './loadXlsx';
import { isSupabaseConfigured, supabase } from './supabase';

export type TenderPackageStatus =
  | 'uploaded'
  | 'parsed'
  | 'mapping_review'
  | 'priced'
  | 'risk_review'
  | 'approved_for_bid'
  | 'exported'
  | 'submitted'
  | 'won'
  | 'lost'
  | 'cancelled';

export type TenderLineType = 'section' | 'subsection' | 'work' | 'material' | 'total' | 'note' | 'empty' | 'other';
export type TenderMappingStatus = 'matched' | 'needs_review' | 'unmatched' | 'ignored';
export type TenderSource = 'ai' | 'user' | 'rule' | 'local';
export type TenderPricingSource = 'system' | 'manual' | 'missing';
export type TenderRiskSeverity = 'low' | 'medium' | 'high' | 'critical';
export type TenderExportType = 'external_quote' | 'internal_workbook';

export type TenderBoqColumnKey =
  | 'lineNo'
  | 'itemCode'
  | 'name'
  | 'description'
  | 'unit'
  | 'quantity'
  | 'ownerUnitPrice'
  | 'ownerAmount'
  | 'note';

export type TenderColumnMapping = Partial<Record<TenderBoqColumnKey, number>>;

export interface TenderPackage {
  id: string;
  code: string;
  name: string;
  customerName?: string | null;
  projectType?: string | null;
  sourceProjectId?: string | null;
  sourceTemplateId?: string | null;
  status: TenderPackageStatus;
  currency: string;
  totalOwnerAmount: number;
  totalQuoteAmount: number;
  lineCount: number;
  mappedLineCount: number;
  confidenceScore?: number | null;
  resultNote?: string | null;
  wonProjectId?: string | null;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
  updatedBy?: string | null;
  submittedAt?: string | null;
  decidedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TenderDocument {
  id: string;
  packageId: string;
  fileName: string;
  fileType: string;
  fileSize?: number | null;
  storagePath?: string | null;
  selectedSheet?: string | null;
  workbookMetadata?: Record<string, unknown>;
  status: 'uploaded' | 'parsed' | 'archived';
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TenderColumnMappingRecord {
  id: string;
  documentId: string;
  sheetName: string;
  headerRow?: number | null;
  mapping: TenderColumnMapping;
  source: 'ai' | 'user' | 'local';
  confidenceScore?: number | null;
  notes?: string[];
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TenderExternalBoqLine {
  id: string;
  packageId: string;
  documentId: string;
  sheetName: string;
  rowNumber: number;
  lineNo?: string | null;
  parentLineId?: string | null;
  itemCode?: string | null;
  name?: string | null;
  description?: string | null;
  unit?: string | null;
  quantity?: number | null;
  ownerUnitPrice?: number | null;
  ownerAmount?: number | null;
  note?: string | null;
  lineType: TenderLineType;
  normalizedText?: string | null;
  rawValues?: Record<string, unknown>;
  aiClassification?: Record<string, unknown>;
  confidenceScore?: number | null;
  status: 'parsed' | 'classified' | 'ignored' | 'mapped' | 'priced';
  createdAt?: string;
  updatedAt?: string;
}

export interface TenderInternalMapping {
  id: string;
  packageId: string;
  externalLineId: string;
  templateId?: string | null;
  templateSectionId?: string | null;
  templateItemId?: string | null;
  workCode?: string | null;
  normGroupCode?: string | null;
  mappingStatus: TenderMappingStatus;
  mappingSource: TenderSource;
  confidenceScore?: number | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TenderPricingLine {
  id: string;
  packageId: string;
  externalLineId?: string | null;
  mappingId?: string | null;
  itemType: 'work' | 'material' | 'labor' | 'machine' | 'subcontract' | 'overhead' | 'risk' | 'other';
  costCode?: string | null;
  description: string;
  unit?: string | null;
  quantity: number;
  unitCost: number;
  costAmount: number;
  quoteUnitPrice?: number | null;
  quoteAmount?: number | null;
  priceBookItemId?: string | null;
  normId?: string | null;
  wastePercent: number;
  overheadPercent: number;
  profitPercent: number;
  riskBufferPercent: number;
  pricingSource: TenderPricingSource;
  missingReason?: string | null;
  isInternalOnly: boolean;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TenderRisk {
  id: string;
  packageId: string;
  externalLineId?: string | null;
  riskType: string;
  severity: TenderRiskSeverity;
  title: string;
  description?: string | null;
  suggestedRfi?: string | null;
  status: 'open' | 'accepted' | 'ignored' | 'resolved';
  source: 'ai' | 'user' | 'system';
  confidenceScore?: number | null;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TenderExportAudit {
  id: string;
  packageId: string;
  exportType: TenderExportType;
  fileName: string;
  summary?: Record<string, unknown>;
  createdBy?: string | null;
  createdAt?: string;
}

export interface TenderPackageDetails extends TenderPackage {
  documents: TenderDocument[];
  columnMappings: TenderColumnMappingRecord[];
  lines: TenderExternalBoqLine[];
  mappings: TenderInternalMapping[];
  pricingLines: TenderPricingLine[];
  risks: TenderRisk[];
  exports: TenderExportAudit[];
}

export interface TenderWorkbookSheetPreview {
  name: string;
  rowCount: number;
  columnCount: number;
  rows: string[][];
  merges: number;
}

export interface TenderWorkbookPreview {
  fileName: string;
  fileSize: number;
  sheets: TenderWorkbookSheetPreview[];
  suggestedSheetName: string;
  suggestedHeaderRow: number;
  suggestedMapping: TenderColumnMapping;
  confidenceScore: number;
  notes: string[];
}

export interface TenderColumnSuggestion {
  sheetName: string;
  headerRow: number;
  mapping: TenderColumnMapping;
  confidenceScore: number;
  notes: string[];
  source: 'remote' | 'local';
}

export interface TenderLineDraft {
  sheetName: string;
  rowNumber: number;
  lineNo?: string | null;
  itemCode?: string | null;
  name?: string | null;
  description?: string | null;
  unit?: string | null;
  quantity?: number | null;
  ownerUnitPrice?: number | null;
  ownerAmount?: number | null;
  note?: string | null;
  lineType: TenderLineType;
  normalizedText: string;
  rawValues: Record<string, unknown>;
  confidenceScore?: number | null;
  status?: TenderExternalBoqLine['status'];
}

export interface TenderMappingDraft {
  externalLineId: string;
  templateId?: string | null;
  templateSectionId?: string | null;
  templateItemId?: string | null;
  workCode?: string | null;
  normGroupCode?: string | null;
  mappingStatus: TenderMappingStatus;
  mappingSource: TenderSource;
  confidenceScore: number;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface TenderRiskDraft {
  externalLineId?: string | null;
  riskType: string;
  severity: TenderRiskSeverity;
  title: string;
  description?: string | null;
  suggestedRfi?: string | null;
  source: 'ai' | 'user' | 'system';
  confidenceScore: number;
  metadata?: Record<string, unknown>;
}

export interface TenderCreateInput {
  name: string;
  customerName?: string;
  projectType?: string;
  sourceProjectId?: string;
  sourceTemplateId?: string;
  file: File;
  preview: TenderWorkbookPreview;
  selectedSheetName: string;
  headerRow: number;
  columnMapping: TenderColumnMapping;
  createdBy?: string;
}

type XlsxModule = Awaited<ReturnType<typeof loadXlsx>>;

const PACKAGE_TABLE = 'tender_packages';
const DOCUMENT_TABLE = 'tender_documents';
const COLUMN_MAPPING_TABLE = 'tender_column_mappings';
const LINE_TABLE = 'tender_external_boq_lines';
const INTERNAL_MAPPING_TABLE = 'tender_internal_mappings';
const PRICING_TABLE = 'tender_pricing_lines';
const RISK_TABLE = 'tender_risks';
const EXPORT_TABLE = 'tender_exports';

const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const nowIso = () => new Date().toISOString();
const todayCode = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const mapPackage = (row: any): TenderPackage => fromDb(row) as TenderPackage;
const mapDocument = (row: any): TenderDocument => fromDb(row) as TenderDocument;
const mapColumnMapping = (row: any): TenderColumnMappingRecord => fromDb(row) as TenderColumnMappingRecord;
const mapLine = (row: any): TenderExternalBoqLine => fromDb(row) as TenderExternalBoqLine;
const mapInternalMapping = (row: any): TenderInternalMapping => fromDb(row) as TenderInternalMapping;
const mapPricingLine = (row: any): TenderPricingLine => fromDb(row) as TenderPricingLine;
const mapRisk = (row: any): TenderRisk => fromDb(row) as TenderRisk;
const mapExport = (row: any): TenderExportAudit => fromDb(row) as TenderExportAudit;

const cleanUndefined = <T extends Record<string, any>>(obj: T): T => {
  Object.keys(obj).forEach(key => obj[key] === undefined && delete obj[key]);
  return obj;
};

const normalizeText = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const parseNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  let text = String(value).trim();
  if (!text || text === '-') return null;
  text = text.replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  if (!text || text === '-' || text === ',') return null;
  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  if (hasComma && hasDot) {
    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    text = lastComma > lastDot
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (hasComma) {
    const commaParts = text.split(',');
    text = commaParts.length === 2 && commaParts[1].length <= 3
      ? text.replace(',', '.')
      : text.replace(/,/g, '');
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const valueAt = (row: string[], index?: number) => {
  if (index === undefined || index === null || index < 0) return '';
  return String(row[index] ?? '').trim();
};

const columnAliases: Record<TenderBoqColumnKey, string[]> = {
  lineNo: ['stt', 'tt', 'no', 'item no', 'so thu tu'],
  itemCode: ['ma', 'ma hieu', 'ma cv', 'ma cong viec', 'code', 'item code', 'wbs'],
  name: ['noi dung cong viec', 'ten cong viec', 'hang muc', 'dien giai', 'mo ta cong viec', 'description', 'work item', 'ten vat tu'],
  description: ['mo ta', 'quy cach', 'spec', 'specification', 'description'],
  unit: ['don vi', 'dvt', 'unit', 'uom'],
  quantity: ['khoi luong', 'kl', 'so luong', 'quantity', 'qty', 'vol'],
  ownerUnitPrice: ['don gia', 'unit price', 'rate', 'gia'],
  ownerAmount: ['thanh tien', 'amount', 'total', 'gia tri'],
  note: ['ghi chu', 'note', 'remark', 'remarks'],
};

const scoreHeaderCell = (cell: string, key: TenderBoqColumnKey) => {
  const normalized = normalizeText(cell);
  if (!normalized) return 0;
  return columnAliases[key].reduce((score, alias) => {
    const normalizedAlias = normalizeText(alias);
    if (normalized === normalizedAlias) return Math.max(score, 4);
    if (normalized.includes(normalizedAlias)) return Math.max(score, 2);
    return score;
  }, 0);
};

const detectColumnsForRows = (rows: string[][]): { headerRow: number; mapping: TenderColumnMapping; confidenceScore: number; notes: string[] } => {
  let best = { headerRow: 0, score: -1, mapping: {} as TenderColumnMapping };
  const scanRows = rows.slice(0, Math.min(40, rows.length));
  for (let rowIndex = 0; rowIndex < scanRows.length; rowIndex += 1) {
    const row = scanRows[rowIndex];
    const mapping: TenderColumnMapping = {};
    let score = 0;
    (Object.keys(columnAliases) as TenderBoqColumnKey[]).forEach(key => {
      let bestCol = -1;
      let bestScore = 0;
      row.forEach((cell, colIndex) => {
        const cellScore = scoreHeaderCell(cell, key);
        if (cellScore > bestScore) {
          bestScore = cellScore;
          bestCol = colIndex;
        }
      });
      if (bestCol >= 0) {
        mapping[key] = bestCol;
        score += bestScore;
      }
    });
    if (score > best.score) best = { headerRow: rowIndex, score, mapping };
  }
  const required = ['name', 'unit', 'quantity'] as TenderBoqColumnKey[];
  const missing = required.filter(key => best.mapping[key] === undefined);
  const confidenceScore = Math.max(0.2, Math.min(0.92, best.score / 24));
  return {
    headerRow: best.headerRow,
    mapping: best.mapping,
    confidenceScore,
    notes: missing.length ? [`Thiếu cột quan trọng: ${missing.join(', ')}`] : ['Đã nhận diện được các cột chính.'],
  };
};

const chooseSuggestedSheet = (sheets: TenderWorkbookSheetPreview[]) => {
  return sheets
    .map(sheet => {
      const detection = detectColumnsForRows(sheet.rows);
      const nonEmptyRows = sheet.rows.filter(row => row.some(cell => String(cell || '').trim())).length;
      return {
        sheet,
        detection,
        score: detection.confidenceScore * 100 + Math.min(nonEmptyRows, 300) + Math.min(sheet.columnCount, 20),
      };
    })
    .sort((a, b) => b.score - a.score)[0];
};

const detectLineType = (draft: Pick<TenderLineDraft, 'name' | 'unit' | 'quantity' | 'ownerAmount' | 'lineNo' | 'rawValues'>): TenderLineType => {
  const text = normalizeText([draft.lineNo, draft.name].filter(Boolean).join(' '));
  const hasQuantity = Number(draft.quantity || 0) > 0;
  const hasAmount = Number(draft.ownerAmount || 0) > 0;
  if (!text && !hasQuantity && !hasAmount) return 'empty';
  if (text.includes('tong cong') || text === 'tong' || text.includes('cong tien') || text.includes('thanh tien')) return 'total';
  if (text.includes('ghi chu') || text.includes('note')) return 'note';
  if (!hasQuantity && !draft.unit && text.length > 0) {
    if (/^[ivx]+\b/.test(text) || /^[a-z]\b/.test(text) || text.length < 90) return 'section';
    return 'subsection';
  }
  if (text.includes('vat tu') || text.includes('thep') || text.includes('ton') || text.includes('be tong')) return 'material';
  return 'work';
};

const getLineSearchText = (line: Pick<TenderExternalBoqLine, 'itemCode' | 'name' | 'description' | 'unit'> | TenderLineDraft) =>
  normalizeText([line.itemCode, line.name, line.description, line.unit].filter(Boolean).join(' '));

const wordOverlapScore = (source: string, target: string) => {
  const sourceWords = new Set(source.split(' ').filter(word => word.length >= 2));
  const targetWords = target.split(' ').filter(word => word.length >= 2);
  if (!sourceWords.size || !targetWords.length) return 0;
  const matches = targetWords.filter(word => sourceWords.has(word)).length;
  return matches / Math.max(sourceWords.size, targetWords.length);
};

const chunked = async <T>(rows: T[], fn: (chunk: T[]) => Promise<void>, size = 500) => {
  for (let index = 0; index < rows.length; index += size) {
    await fn(rows.slice(index, index + size));
  }
};

const toXlsxRows = (rows: unknown[][]) => rows.map(row => row.map(value => value ?? ''));

export const tenderPermissionService = {
  canUseTenderAi(user: User) {
    return user.role === Role.ADMIN ||
      (user.allowedModules || []).includes('HD') ||
      (user.allowedSubModules?.HD || []).some(route => ['/hd/tender-ai', '/hd/cost-library', '/hd'].includes(route)) ||
      (user.adminModules || []).includes('HD') ||
      (user.adminSubModules?.HD || []).some(route => ['/hd/tender-ai', '/hd/cost-library', '/hd'].includes(route));
  },
  canManageTenderPricing(user: User) {
    return user.role === Role.ADMIN ||
      (user.adminModules || []).includes('HD') ||
      (user.adminSubModules?.HD || []).some(route => ['/hd/tender-ai', '/hd/cost-library', '/hd'].includes(route));
  },
};

export const externalBoqParserService = {
  async parseWorkbook(file: File): Promise<TenderWorkbookPreview> {
    const XLSX = await loadXlsx();
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellFormula: true, cellDates: true });
    const sheets = workbook.SheetNames.map(name => {
      const worksheet = workbook.Sheets[name];
      const rows = (XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false }) as unknown[][])
        .map(row => row.map(cell => String(cell ?? '').trim()));
      const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null;
      return {
        name,
        rowCount: rows.length,
        columnCount: range ? range.e.c + 1 : Math.max(0, ...rows.map(row => row.length)),
        rows,
        merges: Array.isArray(worksheet['!merges']) ? worksheet['!merges'].length : 0,
      };
    });
    const suggested = chooseSuggestedSheet(sheets);
    return {
      fileName: file.name,
      fileSize: file.size,
      sheets,
      suggestedSheetName: suggested?.sheet.name || sheets[0]?.name || '',
      suggestedHeaderRow: suggested?.detection.headerRow || 0,
      suggestedMapping: suggested?.detection.mapping || {},
      confidenceScore: suggested?.detection.confidenceScore || 0.3,
      notes: suggested?.detection.notes || ['Chưa đọc được sheet BOQ phù hợp.'],
    };
  },

  detectColumnsLocal(preview: TenderWorkbookPreview, sheetName?: string): TenderColumnSuggestion {
    const sheet = preview.sheets.find(row => row.name === (sheetName || preview.suggestedSheetName)) || preview.sheets[0];
    const detected = detectColumnsForRows(sheet?.rows || []);
    return {
      sheetName: sheet?.name || '',
      headerRow: detected.headerRow,
      mapping: detected.mapping,
      confidenceScore: detected.confidenceScore,
      notes: detected.notes,
      source: 'local',
    };
  },

  buildLineDrafts(preview: TenderWorkbookPreview, sheetName: string, mapping: TenderColumnMapping, headerRow: number): TenderLineDraft[] {
    const sheet = preview.sheets.find(row => row.name === sheetName);
    if (!sheet) return [];
    const rows = sheet.rows.slice(Math.max(0, headerRow + 1));
    return rows.map((row, index) => {
      const rowNumber = headerRow + index + 2;
      const quantity = parseNumber(valueAt(row, mapping.quantity));
      const ownerUnitPrice = parseNumber(valueAt(row, mapping.ownerUnitPrice));
      const ownerAmount = parseNumber(valueAt(row, mapping.ownerAmount));
      const name = valueAt(row, mapping.name);
      const description = valueAt(row, mapping.description);
      const draft: TenderLineDraft = {
        sheetName,
        rowNumber,
        lineNo: valueAt(row, mapping.lineNo) || null,
        itemCode: valueAt(row, mapping.itemCode) || null,
        name: name || description || null,
        description: description || null,
        unit: valueAt(row, mapping.unit) || null,
        quantity,
        ownerUnitPrice,
        ownerAmount,
        note: valueAt(row, mapping.note) || null,
        lineType: 'work',
        normalizedText: '',
        rawValues: Object.fromEntries(row.map((cell, colIndex) => [`col_${colIndex + 1}`, cell])),
        confidenceScore: null,
        status: 'parsed',
      };
      draft.lineType = detectLineType(draft);
      draft.normalizedText = getLineSearchText(draft);
      draft.confidenceScore = draft.lineType === 'empty' ? 0.2 : 0.65;
      return draft;
    }).filter(line => line.lineType !== 'empty' && (line.name || line.itemCode || line.quantity || line.ownerAmount));
  },
};

export const tenderDocumentService = {
  async suggestColumnsRemote(preview: TenderWorkbookPreview): Promise<TenderColumnSuggestion> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token || '';
    const summary = {
      fileName: preview.fileName,
      sheets: preview.sheets.map(sheet => ({
        name: sheet.name,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        sampleRows: sheet.rows.slice(0, 25),
      })),
      localSuggestion: {
        sheetName: preview.suggestedSheetName,
        headerRow: preview.suggestedHeaderRow,
        mapping: preview.suggestedMapping,
      },
    };
    const { data, error } = await supabase.functions.invoke('ai-assistant', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: { action: 'tender_detect_columns', workbook: summary },
    });
    if (error) throw error;
    const suggestion = (data as any)?.suggestion || data;
    return {
      sheetName: String(suggestion.sheetName || preview.suggestedSheetName || ''),
      headerRow: Math.max(0, Number(suggestion.headerRow ?? preview.suggestedHeaderRow ?? 0)),
      mapping: suggestion.mapping || preview.suggestedMapping || {},
      confidenceScore: Math.max(0, Math.min(1, Number(suggestion.confidenceScore ?? 0.5))),
      notes: Array.isArray(suggestion.notes) ? suggestion.notes.map(String) : ['AI đã gợi ý mapping cột.'],
      source: 'remote',
    };
  },
};

export const tenderPackageService = {
  async list(): Promise<TenderPackage[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase.from(PACKAGE_TABLE).select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapPackage);
  },

  async get(id: string, includePricing = true): Promise<TenderPackageDetails | null> {
    if (!isSupabaseConfigured) return null;
    const { data: pkg, error } = await supabase.from(PACKAGE_TABLE).select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!pkg) return null;
    const [documents, columnMappings, lines, mappings, risks, exports] = await Promise.all([
      supabase.from(DOCUMENT_TABLE).select('*').eq('package_id', id).order('created_at', { ascending: true }),
      supabase.from(COLUMN_MAPPING_TABLE).select('*').in('document_id', []),
      supabase.from(LINE_TABLE).select('*').eq('package_id', id).order('sheet_name').order('row_number'),
      supabase.from(INTERNAL_MAPPING_TABLE).select('*').eq('package_id', id).order('created_at'),
      supabase.from(RISK_TABLE).select('*').eq('package_id', id).order('severity', { ascending: false }).order('created_at'),
      supabase.from(EXPORT_TABLE).select('*').eq('package_id', id).order('created_at', { ascending: false }),
    ]);
    if (documents.error) throw documents.error;
    const documentRows = documents.data || [];
    const documentIds = documentRows.map(row => row.id);
    const columnRows = documentIds.length
      ? await supabase.from(COLUMN_MAPPING_TABLE).select('*').in('document_id', documentIds)
      : { data: [], error: null };
    if (columnRows.error) throw columnRows.error;
    if (lines.error) throw lines.error;
    if (mappings.error) throw mappings.error;
    if (risks.error) throw risks.error;
    if (exports.error) throw exports.error;

    let pricingRows: any[] = [];
    if (includePricing) {
      const pricing = await supabase.from(PRICING_TABLE).select('*').eq('package_id', id).order('external_line_id');
      if (!pricing.error) pricingRows = pricing.data || [];
    }

    return {
      ...mapPackage(pkg),
      documents: documentRows.map(mapDocument),
      columnMappings: (columnRows.data || []).map(mapColumnMapping),
      lines: (lines.data || []).map(mapLine),
      mappings: (mappings.data || []).map(mapInternalMapping),
      pricingLines: pricingRows.map(mapPricingLine),
      risks: (risks.data || []).map(mapRisk),
      exports: (exports.data || []).map(mapExport),
    };
  },

  async createFromExcel(input: TenderCreateInput): Promise<TenderPackageDetails> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
    const code = `TDR-${todayCode()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const lineDrafts = externalBoqParserService.buildLineDrafts(
      input.preview,
      input.selectedSheetName,
      input.columnMapping,
      input.headerRow,
    );
    const totalOwnerAmount = lineDrafts.reduce((sum, line) => sum + Number(line.ownerAmount || 0), 0);
    const packagePayload = cleanUndefined(toDb({
      code,
      name: input.name.trim(),
      customerName: input.customerName || null,
      projectType: input.projectType || 'nha_xuong_cong_nghiep',
      sourceProjectId: input.sourceProjectId || null,
      sourceTemplateId: input.sourceTemplateId || null,
      status: 'parsed',
      totalOwnerAmount,
      lineCount: lineDrafts.length,
      confidenceScore: input.preview.confidenceScore,
      metadata: {
        source: 'owner_excel_upload',
        parserVersion: 'tender_ai_excel_v1',
        previewNotes: input.preview.notes,
      },
      createdBy: input.createdBy || null,
      updatedBy: input.createdBy || null,
    }));
    const { data: pkg, error: packageError } = await supabase.from(PACKAGE_TABLE).insert(packagePayload).select('*').single();
    if (packageError) throw packageError;
    const packageId = pkg.id;
    const documentPayload = cleanUndefined(toDb({
      packageId,
      fileName: input.file.name,
      fileType: input.file.name.split('.').pop()?.toLowerCase() || 'xlsx',
      fileSize: input.file.size,
      selectedSheet: input.selectedSheetName,
      workbookMetadata: {
        sheetNames: input.preview.sheets.map(sheet => sheet.name),
        sheetStats: input.preview.sheets.map(sheet => ({
          name: sheet.name,
          rowCount: sheet.rowCount,
          columnCount: sheet.columnCount,
          merges: sheet.merges,
        })),
      },
      status: 'parsed',
      createdBy: input.createdBy || null,
    }));
    const { data: document, error: documentError } = await supabase.from(DOCUMENT_TABLE).insert(documentPayload).select('*').single();
    if (documentError) throw documentError;
    const columnPayload = cleanUndefined(toDb({
      documentId: document.id,
      sheetName: input.selectedSheetName,
      headerRow: input.headerRow,
      mapping: input.columnMapping,
      source: 'user',
      confidenceScore: input.preview.confidenceScore,
      notes: input.preview.notes,
      confirmedBy: input.createdBy || null,
      confirmedAt: nowIso(),
    }));
    const { error: columnError } = await supabase.from(COLUMN_MAPPING_TABLE).insert(columnPayload);
    if (columnError) throw columnError;
    const rows = lineDrafts.map(line => cleanUndefined(toDb({
      packageId,
      documentId: document.id,
      ...line,
      status: line.status || 'parsed',
    })));
    await chunked(rows, async chunk => {
      const { error } = await supabase.from(LINE_TABLE).insert(chunk);
      if (error) throw error;
    });
    return await this.get(packageId) as TenderPackageDetails;
  },

  async updateStatus(packageId: string, status: TenderPackageStatus, patch: Partial<TenderPackage> = {}) {
    const { error } = await supabase
      .from(PACKAGE_TABLE)
      .update(toDb({ ...patch, status, updatedAt: nowIso() }))
      .eq('id', packageId);
    if (error) throw error;
  },
};

export const externalBoqMappingService = {
  suggestMappingsLocal(lines: TenderExternalBoqLine[], templates: CostTemplateDetails[]): TenderMappingDraft[] {
    const candidates = templates.flatMap(template => template.items.map(item => ({ template, item })));
    return lines
      .filter(line => !['empty', 'note', 'total'].includes(line.lineType))
      .map(line => {
        const source = getLineSearchText(line);
        const best = candidates
          .map(candidate => {
            const target = normalizeText([candidate.item.code, candidate.item.workCode, candidate.item.name, candidate.item.unit].filter(Boolean).join(' '));
            const nameScore = wordOverlapScore(source, target);
            const codeScore = line.itemCode && candidate.item.code && normalizeText(line.itemCode) === normalizeText(candidate.item.code) ? 0.35 : 0;
            const unitScore = line.unit && candidate.item.unit && normalizeText(line.unit) === normalizeText(candidate.item.unit) ? 0.15 : 0;
            return { ...candidate, score: Math.min(1, nameScore + codeScore + unitScore) };
          })
          .sort((a, b) => b.score - a.score)[0];
        const score = best?.score || 0;
        return {
          externalLineId: line.id,
          templateId: best?.template.id || null,
          templateSectionId: best?.item.sectionId || null,
          templateItemId: best?.item.id || null,
          workCode: best?.item.workCode || null,
          normGroupCode: best?.item.normGroupCode || null,
          mappingStatus: score >= 0.72 ? 'matched' : score >= 0.42 ? 'needs_review' : 'unmatched',
          mappingSource: 'local',
          confidenceScore: Math.max(0.1, Math.round(score * 100) / 100),
          reason: best ? `So khớp với ${best.template.name} / ${best.item.name}` : 'Không tìm thấy item nội bộ phù hợp.',
          metadata: {
            lineName: line.name,
            lineUnit: line.unit,
          },
        } as TenderMappingDraft;
      });
  },

  async suggestMappingsRemote(packageId: string, lines: TenderExternalBoqLine[], templates: CostTemplateDetails[]): Promise<TenderMappingDraft[]> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token || '';
    const payload = {
      packageId,
      lines: lines
        .filter(line => !['empty', 'note', 'total'].includes(line.lineType))
        .slice(0, 300)
        .map(line => ({
          id: line.id,
          itemCode: line.itemCode,
          name: line.name,
          description: line.description,
          unit: line.unit,
          quantity: line.quantity,
          lineType: line.lineType,
        })),
      templates: templates.slice(0, 15).map(template => ({
        id: template.id,
        code: template.code,
        name: template.name,
        projectType: template.projectType,
        sections: template.sections.slice(0, 80).map(section => ({ id: section.id, code: section.code, name: section.name })),
        items: template.items.slice(0, 500).map(item => ({
          id: item.id,
          sectionId: item.sectionId,
          code: item.code,
          name: item.name,
          itemType: item.itemType,
          unit: item.unit,
          workCode: item.workCode,
          normGroupCode: item.normGroupCode,
        })),
      })),
    };
    const { data, error } = await supabase.functions.invoke('ai-assistant', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: { action: 'tender_suggest_mapping', ...payload },
    });
    if (error) throw error;
    const rawMappings = (data as any)?.mappings || [];
    if (!Array.isArray(rawMappings)) return [];
    return rawMappings.map((row: any) => ({
      externalLineId: String(row.externalLineId || row.lineId || ''),
      templateId: row.templateId || null,
      templateSectionId: row.templateSectionId || null,
      templateItemId: row.templateItemId || null,
      workCode: row.workCode || null,
      normGroupCode: row.normGroupCode || null,
      mappingStatus: ['matched', 'needs_review', 'unmatched', 'ignored'].includes(row.mappingStatus) ? row.mappingStatus : 'needs_review',
      mappingSource: 'ai',
      confidenceScore: Math.max(0, Math.min(1, Number(row.confidenceScore ?? 0.5))),
      reason: String(row.reason || 'AI đề xuất mapping từ BOQ CĐT sang template nội bộ.'),
      metadata: { assumptions: Array.isArray(row.assumptions) ? row.assumptions : [] },
    })).filter((row: TenderMappingDraft) => row.externalLineId);
  },

  async saveMappings(packageId: string, mappings: TenderMappingDraft[], actorId?: string): Promise<void> {
    if (!mappings.length) return;
    const rows = mappings.map(mapping => cleanUndefined(toDb({
      packageId,
      ...mapping,
      reviewedBy: actorId || null,
      reviewedAt: mapping.mappingStatus === 'matched' || mapping.mappingStatus === 'ignored' ? nowIso() : null,
      updatedAt: nowIso(),
    })));
    const { error } = await supabase.from(INTERNAL_MAPPING_TABLE).upsert(rows, { onConflict: 'external_line_id' });
    if (error) throw error;
    const lineUpdates = mappings.map(mapping =>
      supabase
        .from(LINE_TABLE)
        .update(toDb({
          status: mapping.mappingStatus === 'ignored'
            ? 'ignored'
            : mapping.mappingStatus === 'unmatched'
              ? 'classified'
              : 'mapped',
          updatedAt: nowIso(),
        }))
        .eq('id', mapping.externalLineId),
    );
    await Promise.all(lineUpdates);
    const mappedLineCount = mappings.filter(row => row.mappingStatus === 'matched').length;
    await tenderPackageService.updateStatus(packageId, 'mapping_review', { mappedLineCount });
  },
};

const getActivePrice = (prices: InternalPriceBookItem[], keyword?: string | null, unit?: string | null, region = 'all') => {
  const search = normalizeText(keyword || '');
  const unitKey = normalizeText(unit || '');
  return prices
    .filter(price => price.status === 'active')
    .filter(price => !region || region === 'all' || price.region === region || price.region === 'all')
    .map(price => {
      const text = normalizeText([price.itemCode, price.itemName, price.spec, price.category].filter(Boolean).join(' '));
      const score = (price.itemCode && normalizeText(price.itemCode) === search ? 0.6 : 0)
        + wordOverlapScore(search, text)
        + (unitKey && normalizeText(price.unit) === unitKey ? 0.2 : 0);
      return { price, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.price || null;
};

const getItemPercent = (item: CostTemplateItem | undefined, key: keyof Pick<CostTemplateItem, 'overheadPercent' | 'profitPercent' | 'riskBufferPercent'>, fallback: number) =>
  Number(item?.[key] ?? fallback) || 0;

export const tenderPricingService = {
  buildPricingPreview(input: {
    packageId: string;
    lines: TenderExternalBoqLine[];
    mappings: TenderInternalMapping[];
    templates: CostTemplateDetails[];
    prices: InternalPriceBookItem[];
    norms: InternalNorm[];
    region?: string;
    actorId?: string;
  }): TenderPricingLine[] {
    const lineById = new Map(input.lines.map(line => [line.id, line]));
    const itemById = new Map(input.templates.flatMap(template => template.items.map(item => [item.id, item])));
    const activeNorms = input.norms.filter(norm => norm.status === 'active');
    const rows: TenderPricingLine[] = [];
    input.mappings
      .filter(mapping => mapping.mappingStatus === 'matched')
      .forEach(mapping => {
        const line = lineById.get(mapping.externalLineId);
        const item = mapping.templateItemId ? itemById.get(mapping.templateItemId) : undefined;
        if (!line) return;
        const baseQty = Number(line.quantity || 0);
        const overhead = getItemPercent(item, 'overheadPercent', 8);
        const profit = getItemPercent(item, 'profitPercent', 10);
        const risk = getItemPercent(item, 'riskBufferPercent', 3);
        const matchedNorms = activeNorms.filter(norm =>
          (mapping.templateItemId && norm.templateItemId === mapping.templateItemId)
          || (mapping.workCode && norm.workCode === mapping.workCode)
          || (mapping.normGroupCode && norm.normCode === mapping.normGroupCode)
        );

        if (matchedNorms.length > 0) {
          matchedNorms.forEach(norm => {
            const resourceQty = baseQty * Number(norm.normQuantity || 0) * (1 + Number(norm.wastePercent || 0) / 100);
            const price = getActivePrice(input.prices, norm.resourceCode || norm.resourceName, norm.unit, input.region || norm.region || 'all');
            const unitCost = Number(price?.unitPrice || 0);
            const costAmount = resourceQty * unitCost;
            const quoteAmount = costAmount * (1 + (overhead + profit + risk) / 100);
            rows.push({
              id: uid('tender-price'),
              packageId: input.packageId,
              externalLineId: line.id,
              mappingId: mapping.id,
              itemType: norm.resourceType as TenderPricingLine['itemType'],
              costCode: norm.resourceCode || norm.normCode,
              description: norm.resourceName || line.name || 'Dòng định mức',
              unit: norm.unit || price?.unit || line.unit || '',
              quantity: resourceQty,
              unitCost,
              costAmount,
              quoteUnitPrice: resourceQty > 0 ? quoteAmount / resourceQty : 0,
              quoteAmount,
              priceBookItemId: price?.id || null,
              normId: norm.id,
              wastePercent: Number(norm.wastePercent || 0),
              overheadPercent: overhead,
              profitPercent: profit,
              riskBufferPercent: risk,
              pricingSource: price ? 'system' : 'missing',
              missingReason: price ? null : `Thiếu đơn giá active cho ${norm.resourceCode || norm.resourceName}`,
              isInternalOnly: true,
              metadata: { sourceLineName: line.name, ownerQuantity: line.quantity },
              createdBy: input.actorId || null,
            });
          });
          return;
        }

        const priceKeyword = item?.materialSku || item?.workCode || item?.name || line.name;
        const price = getActivePrice(input.prices, priceKeyword, item?.unit || line.unit, input.region || 'all');
        const unitCost = Number(price?.unitPrice || 0);
        const costAmount = baseQty * unitCost;
        const quoteAmount = costAmount * (1 + (overhead + profit + risk) / 100);
        rows.push({
          id: uid('tender-price'),
          packageId: input.packageId,
          externalLineId: line.id,
          mappingId: mapping.id,
          itemType: (item?.itemType as TenderPricingLine['itemType']) || 'work',
          costCode: item?.materialSku || item?.workCode || item?.code || line.itemCode || '',
          description: item?.name || line.name || 'Dòng BOQ CĐT',
          unit: item?.unit || line.unit || '',
          quantity: baseQty,
          unitCost,
          costAmount,
          quoteUnitPrice: baseQty > 0 ? quoteAmount / baseQty : 0,
          quoteAmount,
          priceBookItemId: price?.id || null,
          normId: null,
          wastePercent: Number(item?.defaultWastePercent || 0),
          overheadPercent: overhead,
          profitPercent: profit,
          riskBufferPercent: risk,
          pricingSource: price ? 'system' : 'missing',
          missingReason: price ? null : `Thiếu định mức hoặc đơn giá active cho ${priceKeyword || line.name}`,
          isInternalOnly: true,
          metadata: { sourceLineName: line.name, ownerQuantity: line.quantity, fallbackPricing: true },
          createdBy: input.actorId || null,
        });
      });
    return rows;
  },

  async savePricing(packageId: string, rows: TenderPricingLine[], actorId?: string): Promise<void> {
    const { error: deleteError } = await supabase.from(PRICING_TABLE).delete().eq('package_id', packageId);
    if (deleteError) throw deleteError;
    if (rows.length) {
      await chunked(rows.map(row => cleanUndefined(toDb({ ...row, createdBy: actorId || row.createdBy || null }))), async chunk => {
        const { error } = await supabase.from(PRICING_TABLE).insert(chunk);
        if (error) throw error;
      });
    }
    const totalQuoteAmount = rows.reduce((sum, row) => sum + Number(row.quoteAmount || 0), 0);
    await tenderPackageService.updateStatus(packageId, 'priced', { totalQuoteAmount });
  },
};

export const tenderRiskRfiService = {
  buildRisksLocal(details: TenderPackageDetails): TenderRiskDraft[] {
    const mappingByLine = new Map(details.mappings.map(mapping => [mapping.externalLineId, mapping]));
    const pricingByLine = new Map<string, TenderPricingLine[]>();
    details.pricingLines.forEach(row => {
      if (!row.externalLineId) return;
      pricingByLine.set(row.externalLineId, [...(pricingByLine.get(row.externalLineId) || []), row]);
    });
    const risks: TenderRiskDraft[] = [];
    details.lines.forEach(line => {
      if (['section', 'subsection', 'note', 'total'].includes(line.lineType)) return;
      const mapping = mappingByLine.get(line.id);
      const pricing = pricingByLine.get(line.id) || [];
      if (!line.unit || !line.quantity) {
        risks.push({
          externalLineId: line.id,
          riskType: 'missing_scope_data',
          severity: 'high',
          title: 'Thiếu đơn vị hoặc khối lượng',
          description: `${line.name || line.itemCode || 'Dòng BOQ'} thiếu đơn vị/khối lượng nên chưa thể tính giá chắc chắn.`,
          suggestedRfi: `Đề nghị CĐT làm rõ đơn vị và khối lượng cho dòng: ${line.name || line.itemCode || ''}`,
          source: 'system',
          confidenceScore: 0.9,
        });
      }
      if (!mapping || mapping.mappingStatus !== 'matched') {
        risks.push({
          externalLineId: line.id,
          riskType: 'mapping',
          severity: 'medium',
          title: 'Chưa map chắc sang template nội bộ',
          description: 'Dòng BOQ chưa được xác nhận mapping, cần HD review trước khi chốt giá.',
          suggestedRfi: null,
          source: 'system',
          confidenceScore: 0.75,
        });
      }
      if (pricing.some(row => row.pricingSource === 'missing')) {
        risks.push({
          externalLineId: line.id,
          riskType: 'missing_price',
          severity: 'high',
          title: 'Thiếu đơn giá/định mức nội bộ',
          description: pricing.map(row => row.missingReason).filter(Boolean).join('; '),
          suggestedRfi: null,
          source: 'system',
          confidenceScore: 0.85,
        });
      }
    });
    return risks;
  },

  async suggestRisksRemote(details: TenderPackageDetails): Promise<TenderRiskDraft[]> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token || '';
    const { data, error } = await supabase.functions.invoke('ai-assistant', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: {
        action: 'tender_risk_rfi',
        packageId: details.id,
        lines: details.lines.slice(0, 300).map(line => ({
          id: line.id,
          itemCode: line.itemCode,
          name: line.name,
          description: line.description,
          unit: line.unit,
          quantity: line.quantity,
          lineType: line.lineType,
        })),
        mappings: details.mappings.map(mapping => ({
          externalLineId: mapping.externalLineId,
          mappingStatus: mapping.mappingStatus,
          confidenceScore: mapping.confidenceScore,
          reason: mapping.reason,
        })),
        pricingGaps: details.pricingLines
          .filter(row => row.pricingSource === 'missing')
          .map(row => ({
            externalLineId: row.externalLineId,
            description: row.description,
            missingReason: row.missingReason,
          })),
      },
    });
    if (error) throw error;
    const risks = (data as any)?.risks || [];
    return Array.isArray(risks)
      ? risks.map((row: any) => ({
        externalLineId: row.externalLineId || null,
        riskType: String(row.riskType || 'scope'),
        severity: ['low', 'medium', 'high', 'critical'].includes(row.severity) ? row.severity : 'medium',
        title: String(row.title || 'Rủi ro BOQ'),
        description: row.description ? String(row.description) : null,
        suggestedRfi: row.suggestedRfi ? String(row.suggestedRfi) : null,
        source: 'ai',
        confidenceScore: Math.max(0, Math.min(1, Number(row.confidenceScore ?? 0.5))),
        metadata: { assumptions: Array.isArray(row.assumptions) ? row.assumptions : [] },
      }))
      : [];
  },

  async saveRisks(packageId: string, risks: TenderRiskDraft[], actorId?: string): Promise<void> {
    const { error: deleteError } = await supabase.from(RISK_TABLE).delete().eq('package_id', packageId);
    if (deleteError) throw deleteError;
    if (risks.length) {
      const rows = risks.map(risk => cleanUndefined(toDb({
        id: uid('tender-risk'),
        packageId,
        ...risk,
        status: 'open',
        createdBy: actorId || null,
      })));
      const { error } = await supabase.from(RISK_TABLE).insert(rows);
      if (error) throw error;
    }
    await tenderPackageService.updateStatus(packageId, 'risk_review');
  },
};

const aggregateQuoteByLine = (pricingLines: TenderPricingLine[]) => {
  const map = new Map<string, { quoteAmount: number; costAmount: number }>();
  pricingLines.forEach(row => {
    if (!row.externalLineId) return;
    const current = map.get(row.externalLineId) || { quoteAmount: 0, costAmount: 0 };
    current.quoteAmount += Number(row.quoteAmount || 0);
    current.costAmount += Number(row.costAmount || 0);
    map.set(row.externalLineId, current);
  });
  return map;
};

export const tenderExportService = {
  async createExternalQuote(details: TenderPackageDetails): Promise<Blob> {
    const XLSX = await loadXlsx();
    const quoteByLine = aggregateQuoteByLine(details.pricingLines);
    const rows = [
      ['STT', 'Mã', 'Nội dung công việc', 'Đơn vị', 'Khối lượng', 'Đơn giá chào', 'Thành tiền chào', 'Ghi chú'],
      ...details.lines.map(line => {
        const quote = quoteByLine.get(line.id);
        const quoteAmount = quote?.quoteAmount || 0;
        const quoteUnitPrice = Number(line.quantity || 0) > 0 ? quoteAmount / Number(line.quantity || 1) : 0;
        return [
          line.lineNo || line.rowNumber,
          line.itemCode || '',
          line.name || line.description || '',
          line.unit || '',
          line.quantity || '',
          quoteAmount > 0 ? Math.round(quoteUnitPrice) : '',
          quoteAmount > 0 ? Math.round(quoteAmount) : '',
          line.note || '',
        ];
      }),
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(toXlsxRows(rows)), 'Bao gia CDT');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Hồ sơ', details.name],
      ['Khách hàng', details.customerName || ''],
      ['Mã hồ sơ', details.code],
      ['Ngày xuất', new Date().toLocaleString('vi-VN')],
      ['Lưu ý', 'File gửi khách không chứa giá vốn, margin, profit hoặc ghi chú nội bộ.'],
    ]), 'Thong tin');
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    return new Blob([output], { type: EXCEL_MIME });
  },

  async createInternalWorkbook(details: TenderPackageDetails): Promise<Blob> {
    const XLSX = await loadXlsx();
    const lineById = new Map(details.lines.map(line => [line.id, line]));
    const mappingByLine = new Map(details.mappings.map(mapping => [mapping.externalLineId, mapping]));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(toXlsxRows([
      ['Mã hồ sơ', details.code],
      ['Tên hồ sơ', details.name],
      ['Khách hàng', details.customerName || ''],
      ['Trạng thái', details.status],
      ['Tổng giá CĐT', details.totalOwnerAmount],
      ['Tổng giá chào', details.totalQuoteAmount],
    ])), 'Tong hop');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(toXlsxRows([
      ['Row', 'Mã CĐT', 'Dòng CĐT', 'Đơn vị', 'KL', 'Mapping', 'Confidence', 'Lý do'],
      ...details.lines.map(line => {
        const mapping = mappingByLine.get(line.id);
        return [
          line.rowNumber,
          line.itemCode || '',
          line.name || '',
          line.unit || '',
          line.quantity || '',
          mapping?.mappingStatus || '',
          mapping?.confidenceScore || '',
          mapping?.reason || '',
        ];
      }),
    ])), 'Mapping');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(toXlsxRows([
      ['Row CĐT', 'Dòng CĐT', 'Cost code', 'Diễn giải', 'Đơn vị', 'KL', 'Unit cost', 'Cost amount', 'Quote amount', 'Missing'],
      ...details.pricingLines.map(row => {
        const line = row.externalLineId ? lineById.get(row.externalLineId) : null;
        return [
          line?.rowNumber || '',
          line?.name || '',
          row.costCode || '',
          row.description,
          row.unit || '',
          row.quantity,
          row.unitCost,
          row.costAmount,
          row.quoteAmount || '',
          row.missingReason || '',
        ];
      }),
    ])), 'Noi bo');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(toXlsxRows([
      ['Mức độ', 'Loại', 'Tiêu đề', 'Mô tả', 'RFI đề xuất'],
      ...details.risks.map(risk => [risk.severity, risk.riskType, risk.title, risk.description || '', risk.suggestedRfi || '']),
    ])), 'Risk RFI');
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    return new Blob([output], { type: EXCEL_MIME });
  },

  async recordExport(packageId: string, exportType: TenderExportType, fileName: string, actorId?: string, summary: Record<string, unknown> = {}) {
    const { error } = await supabase.from(EXPORT_TABLE).insert(toDb({
      packageId,
      exportType,
      fileName,
      summary,
      createdBy: actorId || null,
    }));
    if (error) throw error;
    await tenderPackageService.updateStatus(packageId, 'exported');
  },
};
