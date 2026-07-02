import { supabase, isSupabaseConfigured } from './supabase';
import { fromDb, toDb } from './dbMapping';
import { loadXlsx } from './loadXlsx';
import {
  calculateXaGoWeightKg,
  formatCustomMaterialNumber,
  normalizeCustomMaterialTemplateKey,
} from './customMaterialTemplates';
import type {
  CustomMaterialImportPreviewRow,
  CustomMaterialSmartImportColumnMapping,
  CustomMaterialSmartImportField,
  CustomMaterialSmartImportMapping,
  CustomMaterialSmartImportPreview,
  CustomMaterialSmartImportSource,
  CustomMaterialTemplateKey,
  CustomMaterialWorkbookMergedRange,
  CustomMaterialWorkbookRowPreview,
  CustomMaterialWorkbookSheetPreview,
} from '../types';

const MAPPING_PROFILE_TABLE = 'custom_material_import_mapping_profiles';

export const CUSTOM_MATERIAL_SMART_IMPORT_FIELDS: Array<{
  key: CustomMaterialSmartImportField;
  label: string;
  required: boolean;
}> = [
  { key: 'description', label: 'Diễn giải', required: true },
  { key: 'chungLoai', label: 'Chủng loại', required: false },
  { key: 'quyCach', label: 'Quy cách', required: false },
  { key: 'quantity', label: 'SL cấu kiện', required: true },
  { key: 'lengthMm', label: 'Dài(mm)', required: true },
  { key: 'kgPerM', label: 'Kg/m', required: true },
  { key: 'weightKg', label: 'Khối lượng(kg)', required: false },
  { key: 'technicalNote', label: 'Ghi chú', required: false },
];

const REQUIRED_XA_GO_FIELDS: CustomMaterialSmartImportField[] = ['description', 'quantity', 'lengthMm', 'kgPerM'];

const FIELD_ALIASES: Record<CustomMaterialSmartImportField, string[]> = {
  description: ['diễn giải', 'dien giai', 'mã cấu kiện', 'ma cau kien', 'tên cấu kiện', 'ten cau kien'],
  chungLoai: ['chủng loại', 'chung loai', 'loại', 'loai'],
  quyCach: ['quy cách', 'quy cach', 'tiết diện', 'tiet dien'],
  quantity: ['sl cấu kiện', 'sl cau kien', 'số ck', 'so ck', 'sl ck', 'số cấu kiện', 'so cau kien'],
  lengthMm: ['dài mm', 'dài (mm)', 'dai mm', 'dai (mm)', 'chiều dài mm', 'chieu dai mm'],
  kgPerM: ['kg/m', 'kg m', 'kg trên m', 'kg tren m'],
  weightKg: ['khối lượng kg', 'khoi luong kg', 'khối lượng', 'khoi luong', 'kl kg'],
  technicalNote: ['ghi chú', 'ghi chu', 'ghi chú kỹ thuật', 'ghi chu ky thuat'],
};

type MappingProfile = {
  id: string;
  templateKey: CustomMaterialTemplateKey;
  signatureHash: string;
  mappingJson: CustomMaterialSmartImportMapping;
  sampleHeaders: string[];
  confidenceScore: number;
  successCount: number;
};

const normalizeText = (value?: string | null) =>
  String(value || '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim();

const normalizeLoose = (value?: string | null) => normalizeText(value).replace(/\//g, ' ');

const cleanCellText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

const columnName = (index: number) => {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - mod) / 26);
  }
  return name;
};

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

const clampScore = (value: number) => Math.max(0, Math.min(1, value));

const hashString = (input: string) => {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return `cmr_${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const hasTemplateKeyword = (sheet: CustomMaterialWorkbookSheetPreview) => {
  const sample = sheet.rows.slice(0, 30).map(row => row.text).join(' ');
  const normalized = normalizeLoose(`${sheet.selectedSheetName} ${sample}`);
  return normalized.includes('xa go') || normalized.includes('xago') || normalized.includes('xct');
};

const fillMergedValues = (sheet: CustomMaterialWorkbookSheetPreview): CustomMaterialWorkbookRowPreview[] => {
  const rows = sheet.rows.map(row => ({
    ...row,
    values: [...row.values],
    rawValues: [...row.rawValues],
  }));
  const byRowNumber = new Map(rows.map(row => [row.rowNumber, row]));

  sheet.mergedRanges.forEach(range => {
    const source = byRowNumber.get(range.startRow)?.values[range.startCol] || range.value || '';
    if (!source) return;
    for (let rowNumber = range.startRow; rowNumber <= range.endRow; rowNumber += 1) {
      const row = byRowNumber.get(rowNumber);
      if (!row) continue;
      for (let col = range.startCol; col <= range.endCol; col += 1) {
        if (!row.values[col]) row.values[col] = source;
      }
    }
  });

  return rows;
};

const flattenHeaders = (
  rows: CustomMaterialWorkbookRowPreview[],
  headerRowIndexes: number[],
  columnCount: number,
) => Array.from({ length: columnCount }, (_, col) => {
  const parts: string[] = [];
  headerRowIndexes.forEach(rowIndex => {
    const value = cleanCellText(rows[rowIndex]?.values[col]);
    if (value && !parts.some(part => normalizeLoose(part) === normalizeLoose(value))) {
      parts.push(value);
    }
  });
  return parts.join(' ').trim();
});

const fieldMatchScore = (field: CustomMaterialSmartImportField, label: string) => {
  const normalized = normalizeLoose(label);
  if (!normalized) return 0;
  if (field === 'quantity' && normalized.includes('sl') && (normalized.includes('ck') || normalized.includes('cau kien'))) return 0.98;
  if (field === 'lengthMm' && normalized.includes('dai') && normalized.includes('mm')) return 0.96;
  if (field === 'kgPerM' && normalized.includes('kg') && normalized.includes('m') && !normalized.includes('khoi luong')) return 0.96;
  if (field === 'weightKg' && (normalized.includes('khoi luong') || normalized === 'kl kg' || normalized.endsWith(' kl'))) return 0.94;

  return FIELD_ALIASES[field].reduce((best, alias) => {
    const candidate = normalizeLoose(alias);
    if (normalized === candidate) return Math.max(best, 1);
    if (normalized.includes(candidate)) return Math.max(best, 0.9);
    const tokens = candidate.split(' ').filter(Boolean);
    if (tokens.length && tokens.every(token => normalized.includes(token))) return Math.max(best, 0.78);
    return best;
  }, 0);
};

const buildMapping = (headers: string[]): CustomMaterialSmartImportMapping => {
  const mapping: CustomMaterialSmartImportMapping = {};
  CUSTOM_MATERIAL_SMART_IMPORT_FIELDS.forEach(field => {
    let best: CustomMaterialSmartImportColumnMapping | null = null;
    headers.forEach((label, columnIndex) => {
      const confidence = fieldMatchScore(field.key, label);
      if (confidence > (best?.confidence || 0)) {
        best = {
          columnIndex,
          label: label || `Cột ${columnName(columnIndex)}`,
          confidence,
        };
      }
    });
    if (best && (best.confidence || 0) >= 0.72) {
      mapping[field.key] = best;
    }
  });
  return mapping;
};

const mappingCompleteness = (mapping: CustomMaterialSmartImportMapping) => ({
  required: REQUIRED_XA_GO_FIELDS.filter(field => Boolean(mapping[field])).length,
  optional: CUSTOM_MATERIAL_SMART_IMPORT_FIELDS.filter(field => !REQUIRED_XA_GO_FIELDS.includes(field.key) && Boolean(mapping[field.key])).length,
});

const scoreMapping = (mapping: CustomMaterialSmartImportMapping, rowCount: number, sheet: CustomMaterialWorkbookSheetPreview) => {
  const completeness = mappingCompleteness(mapping);
  return clampScore(
    (completeness.required / REQUIRED_XA_GO_FIELDS.length) * 0.68
    + Math.min(1, completeness.optional / 4) * 0.12
    + Math.min(1, rowCount / 8) * 0.12
    + (hasTemplateKeyword(sheet) ? 0.08 : 0),
  );
};

const makeSignatureHash = (sheet: CustomMaterialWorkbookSheetPreview, sampleHeaders: string[]) =>
  hashString([
    sheet.selectedSheetName,
    sheet.columnCount,
    ...sampleHeaders.map(normalizeLoose),
  ].join('|'));

const readMappedCell = (
  row: CustomMaterialWorkbookRowPreview,
  mapping: CustomMaterialSmartImportMapping,
  field: CustomMaterialSmartImportField,
) => {
  const columnIndex = mapping[field]?.columnIndex;
  if (columnIndex === undefined || columnIndex < 0) return '';
  return cleanCellText(row.values[columnIndex]);
};

const isRepeatedHeaderRow = (text: string) => {
  const normalized = normalizeLoose(text);
  return normalized.includes('dien giai')
    && (normalized.includes('quy cach') || normalized.includes('chu chung loai') || normalized.includes('chung loai'));
};

const buildXaGoPreviewRow = (
  input: {
    rowNumber: number;
    description: string;
    chungLoai: string;
    quyCach: string;
    quantity: number;
    lengthMm: number;
    kgPerM: number;
    weightKg?: number;
    hasImportedWeight?: boolean;
    technicalNote: string;
    sourceWarnings?: string[];
  },
  sortOrder: number,
): CustomMaterialImportPreviewRow => {
  const calculatedWeightKg = calculateXaGoWeightKg(input.quantity, input.lengthMm, input.kgPerM);
  const importedWeightKg = input.hasImportedWeight ? Number(input.weightKg || 0) : 0;
  const weightKg = importedWeightKg || calculatedWeightKg;
  const lengthM = input.lengthMm > 0 ? input.lengthMm / 1000 : 0;
  const lengthMd = input.quantity > 0 && input.lengthMm > 0 ? input.quantity * lengthM : 0;
  const errors: string[] = [];
  const warnings = [...(input.sourceWarnings || [])];

  if (!input.description) errors.push('Thiếu diễn giải.');
  if (input.quantity <= 0) errors.push('Thiếu SL cấu kiện.');
  if (input.lengthMm <= 0) errors.push('Thiếu Dài(mm).');
  if (input.kgPerM <= 0) errors.push('Thiếu Kg/m.');
  if (importedWeightKg > 0 && calculatedWeightKg > 0 && Math.abs(importedWeightKg - calculatedWeightKg) > 0.5) {
    warnings.push(`Khối lượng nhập ${formatCustomMaterialNumber(importedWeightKg)} kg lệch công thức ${formatCustomMaterialNumber(calculatedWeightKg)} kg.`);
  }

  return {
    rowNumber: input.rowNumber,
    status: errors.length > 0 ? 'error' : 'create',
    errors,
    warnings,
    line: {
      sortOrder,
      groupKey: 'xa_go',
      profileType: 'xa_go',
      description: input.description,
      effectiveWidth: null,
      length: lengthM || null,
      quantity: input.quantity,
      areaM2: null,
      lengthMd: lengthMd || null,
      thickness: null,
      color: null,
      unit: 'cấu kiện',
      technicalNote: input.technicalNote || null,
      specJson: {
        templateKey: 'xa_go',
        chung_loai: input.chungLoai,
        quy_cach: input.quyCach,
        length_mm: input.lengthMm || null,
        kg_per_m: input.kgPerM || null,
        weight_kg: weightKg || null,
        calculated_weight_kg: calculatedWeightKg || null,
      },
      attachments: [],
    },
  };
};

const rowLooksLikeXaGoLine = (row: CustomMaterialWorkbookRowPreview, mapping: CustomMaterialSmartImportMapping) => {
  const text = row.text.trim();
  if (!text || isRepeatedHeaderRow(text)) return false;
  const normalized = normalizeLoose(text);
  if (normalized.includes('tong cong') || normalized === 'tong' || normalized.startsWith('cong trinh')) return false;

  const description = readMappedCell(row, mapping, 'description');
  const chungLoai = readMappedCell(row, mapping, 'chungLoai');
  const quyCach = readMappedCell(row, mapping, 'quyCach');
  const quantity = toFiniteNumber(readMappedCell(row, mapping, 'quantity'), 0);
  const lengthMm = toFiniteNumber(readMappedCell(row, mapping, 'lengthMm'), 0);
  const kgPerM = toFiniteNumber(readMappedCell(row, mapping, 'kgPerM'), 0);

  if (!description && !chungLoai && !quyCach && quantity <= 0 && lengthMm <= 0 && kgPerM <= 0) return false;
  if (description && !chungLoai && !quyCach && lengthMm <= 0 && kgPerM <= 0) return false;
  return Boolean(description || quyCach || (quantity > 0 && (lengthMm > 0 || kgPerM > 0)));
};

const buildRowsFromMapping = (
  sheet: CustomMaterialWorkbookSheetPreview,
  mapping: CustomMaterialSmartImportMapping,
  dataStartRowNumber: number,
) => {
  const filledRows = fillMergedValues(sheet);
  const previewRows: CustomMaterialImportPreviewRow[] = [];

  filledRows
    .filter(row => row.rowNumber >= dataStartRowNumber)
    .forEach(row => {
      if (!rowLooksLikeXaGoLine(row, mapping)) return;
      const weightRaw = readMappedCell(row, mapping, 'weightKg');
      previewRows.push(buildXaGoPreviewRow({
        rowNumber: row.rowNumber,
        description: readMappedCell(row, mapping, 'description'),
        chungLoai: readMappedCell(row, mapping, 'chungLoai'),
        quyCach: readMappedCell(row, mapping, 'quyCach'),
        quantity: toFiniteNumber(readMappedCell(row, mapping, 'quantity'), 0),
        lengthMm: toFiniteNumber(readMappedCell(row, mapping, 'lengthMm'), 0),
        kgPerM: toFiniteNumber(readMappedCell(row, mapping, 'kgPerM'), 0),
        weightKg: toFiniteNumber(weightRaw, 0),
        hasImportedWeight: weightRaw.trim() !== '',
        technicalNote: readMappedCell(row, mapping, 'technicalNote'),
      }, previewRows.length));
    });

  return previewRows;
};

const buildPreviewFromMapping = (
  sheet: CustomMaterialWorkbookSheetPreview,
  templateKey: CustomMaterialTemplateKey,
  mapping: CustomMaterialSmartImportMapping,
  options: {
    source: CustomMaterialSmartImportSource;
    headerRows: number[];
    sampleHeaders: string[];
    signatureHash?: string;
    confidenceScore?: number;
    warnings?: string[];
  },
): CustomMaterialSmartImportPreview => {
  const headerEndRow = Math.max(...options.headerRows, 0);
  const rows = buildRowsFromMapping(sheet, mapping, headerEndRow + 1);
  const endRow = rows.length ? rows[rows.length - 1].rowNumber : headerEndRow;
  return {
    templateKey,
    source: options.source,
    confidenceScore: clampScore(options.confidenceScore ?? scoreMapping(mapping, rows.filter(row => row.status !== 'error').length, sheet)),
    warnings: options.warnings || [],
    detectedSheet: sheet.selectedSheetName,
    headerRows: options.headerRows,
    dataRange: { startRow: headerEndRow + 1, endRow },
    mapping,
    rows,
    signatureHash: options.signatureHash || makeSignatureHash(sheet, options.sampleHeaders),
    sampleHeaders: options.sampleHeaders,
    workbookSheet: sheet,
  };
};

const detectLocalXaGo = (sheet: CustomMaterialWorkbookSheetPreview): CustomMaterialSmartImportPreview => {
  const filledRows = fillMergedValues(sheet);
  const searchLimit = Math.min(filledRows.length, 80);
  let best: {
    score: number;
    mapping: CustomMaterialSmartImportMapping;
    headerRows: number[];
    sampleHeaders: string[];
  } | null = null;

  for (let endIndex = 0; endIndex < searchLimit; endIndex += 1) {
    const headerIndexes = Array.from(
      { length: Math.min(3, endIndex + 1) },
      (_, offset) => endIndex - Math.min(2, endIndex) + offset,
    );
    const sampleHeaders = flattenHeaders(filledRows, headerIndexes, sheet.columnCount);
    const mapping = buildMapping(sampleHeaders);
    const completeness = mappingCompleteness(mapping);
    const score = completeness.required * 12 + completeness.optional * 2 + (hasTemplateKeyword(sheet) ? 3 : 0);
    if (!best || score > best.score) {
      best = {
        score,
        mapping,
        headerRows: headerIndexes.map(index => filledRows[index]?.rowNumber).filter(Boolean),
        sampleHeaders,
      };
    }
  }

  const fallbackHeaders = flattenHeaders(filledRows, [0], sheet.columnCount);
  const headerRows = best?.headerRows.length ? best.headerRows : [sheet.rows[0]?.rowNumber || 1];
  const sampleHeaders = best?.sampleHeaders || fallbackHeaders;
  const mapping = best?.mapping || {};
  const preview = buildPreviewFromMapping(sheet, 'xa_go', mapping, {
    source: 'local',
    headerRows,
    sampleHeaders,
  });
  const missingFields = REQUIRED_XA_GO_FIELDS.filter(field => !mapping[field]);
  return {
    ...preview,
    warnings: [
      ...preview.warnings,
      ...missingFields.map(field => `Chưa nhận diện được cột ${CUSTOM_MATERIAL_SMART_IMPORT_FIELDS.find(item => item.key === field)?.label || field}.`),
      ...(preview.rows.length === 0 ? ['Chưa tìm thấy dòng cấu kiện Xà gồ trong vùng dữ liệu đã nhận diện.'] : []),
    ],
    confidenceScore: scoreMapping(mapping, preview.rows.filter(row => row.status !== 'error').length, sheet),
  };
};

const sanitizeMapping = (raw: any, headers: string[] = []): CustomMaterialSmartImportMapping => {
  const mapping: CustomMaterialSmartImportMapping = {};
  const source = raw && typeof raw === 'object' ? raw : {};
  const aliases: Record<string, CustomMaterialSmartImportField> = {
    description: 'description',
    dienGiai: 'description',
    dien_giai: 'description',
    chungLoai: 'chungLoai',
    chung_loai: 'chungLoai',
    profileType: 'chungLoai',
    quyCach: 'quyCach',
    quy_cach: 'quyCach',
    specification: 'quyCach',
    quantity: 'quantity',
    soCk: 'quantity',
    slCauKien: 'quantity',
    sl_cau_kien: 'quantity',
    lengthMm: 'lengthMm',
    length_mm: 'lengthMm',
    daiMm: 'lengthMm',
    kgPerM: 'kgPerM',
    kg_per_m: 'kgPerM',
    weightKg: 'weightKg',
    weight_kg: 'weightKg',
    technicalNote: 'technicalNote',
    technical_note: 'technicalNote',
    note: 'technicalNote',
  };

  Object.entries(source).forEach(([rawKey, rawValue]) => {
    const field = aliases[rawKey] || (CUSTOM_MATERIAL_SMART_IMPORT_FIELDS.some(item => item.key === rawKey) ? rawKey as CustomMaterialSmartImportField : null);
    if (!field) return;
    const columnIndex = typeof rawValue === 'number'
      ? rawValue
      : Number((rawValue as any)?.columnIndex ?? (rawValue as any)?.index ?? -1);
    if (!Number.isInteger(columnIndex) || columnIndex < 0) return;
    mapping[field] = {
      columnIndex,
      label: String((rawValue as any)?.label || headers[columnIndex] || `Cột ${columnName(columnIndex)}`),
      confidence: clampScore(Number((rawValue as any)?.confidence ?? 0.85)),
    };
  });
  return mapping;
};

const sanitizeAiPreview = (
  raw: any,
  localPreview: CustomMaterialSmartImportPreview,
): CustomMaterialSmartImportPreview | null => {
  const parsed = raw?.preview || raw;
  if (!parsed || typeof parsed !== 'object') return null;
  const aiLines = Array.isArray(parsed.lines) ? parsed.lines.slice(0, 600) : [];
  const mapping = Object.keys(parsed.mapping || {}).length
    ? sanitizeMapping(parsed.mapping, localPreview.sampleHeaders)
    : localPreview.mapping;
  const rows = aiLines.map((line: any, index: number) => buildXaGoPreviewRow({
    rowNumber: Math.max(1, Number(line.rowNumber ?? line.sourceRowNumber ?? index + 1)),
    description: cleanCellText(line.description ?? line.dienGiai ?? line.dien_giai),
    chungLoai: cleanCellText(line.chungLoai ?? line.chung_loai ?? line.profileType),
    quyCach: cleanCellText(line.quyCach ?? line.quy_cach ?? line.specification),
    quantity: toFiniteNumber(line.quantity ?? line.slCauKien ?? line.sl_cau_kien, 0),
    lengthMm: toFiniteNumber(line.lengthMm ?? line.length_mm ?? line.daiMm, 0),
    kgPerM: toFiniteNumber(line.kgPerM ?? line.kg_per_m, 0),
    weightKg: toFiniteNumber(line.weightKg ?? line.weight_kg, 0),
    hasImportedWeight: line.weightKg !== undefined || line.weight_kg !== undefined,
    technicalNote: cleanCellText(line.technicalNote ?? line.technical_note ?? line.note),
    sourceWarnings: Array.isArray(line.warnings) ? line.warnings.map(String).slice(0, 4) : [],
  }, index));

  if (rows.length === 0) return null;
  const headerRows = Array.isArray(parsed.headerRows)
    ? parsed.headerRows.map(Number).filter(Number.isFinite)
    : localPreview.headerRows;
  const dataStartRow = Math.max(1, Number(parsed.dataStartRow || rows[0]?.rowNumber || localPreview.dataRange.startRow));
  const dataEndRow = Math.max(dataStartRow, Number(parsed.dataEndRow || rows[rows.length - 1]?.rowNumber || dataStartRow));
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 12) : [];

  return {
    ...localPreview,
    source: 'ai',
    confidenceScore: clampScore(Number(parsed.confidenceScore ?? 0.68)),
    warnings,
    detectedSheet: String(parsed.sheetName || localPreview.detectedSheet),
    headerRows,
    dataRange: { startRow: dataStartRow, endRow: dataEndRow },
    mapping,
    rows,
  };
};

const toMappingProfile = (row: any): MappingProfile => {
  const mapped = fromDb(row) as MappingProfile;
  return {
    ...mapped,
    templateKey: normalizeCustomMaterialTemplateKey(mapped.templateKey),
    mappingJson: sanitizeMapping(mapped.mappingJson, Array.isArray(mapped.sampleHeaders) ? mapped.sampleHeaders : []),
    sampleHeaders: Array.isArray(mapped.sampleHeaders) ? mapped.sampleHeaders.map(String) : [],
    confidenceScore: Number(mapped.confidenceScore || 0),
    successCount: Number(mapped.successCount || 0),
  };
};

const listMappingProfiles = async (templateKey: CustomMaterialTemplateKey, signatureHash: string): Promise<MappingProfile[]> => {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from(MAPPING_PROFILE_TABLE)
    .select('*')
    .eq('scope_type', 'company')
    .eq('scope_id', 'default')
    .eq('template_key', templateKey)
    .eq('signature_hash', signatureHash)
    .order('success_count', { ascending: false })
    .order('last_used_at', { ascending: false })
    .limit(3);
  if (error) throw error;
  return (data || []).map(toMappingProfile);
};

const callAiFallback = async (input: {
  fileName: string;
  templateKey: CustomMaterialTemplateKey;
  sheet: CustomMaterialWorkbookSheetPreview;
  localPreview: CustomMaterialSmartImportPreview;
  knownMappingProfiles: MappingProfile[];
}) => {
  if (!isSupabaseConfigured) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const localGuess = {
    source: input.localPreview.source,
    confidenceScore: input.localPreview.confidenceScore,
    warnings: input.localPreview.warnings,
    headerRows: input.localPreview.headerRows,
    dataRange: input.localPreview.dataRange,
    mapping: input.localPreview.mapping,
    rows: input.localPreview.rows.slice(0, 80).map(row => ({
      rowNumber: row.rowNumber,
      errors: row.errors,
      warnings: row.warnings,
      description: row.line.description,
      quantity: row.line.quantity,
      specJson: row.line.specJson,
    })),
  };
  const { data, error } = await supabase.functions.invoke('ai-assistant', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: {
      action: 'custom_material_smart_import_excel',
      fileName: input.fileName,
      sheetName: input.sheet.selectedSheetName,
      templateKey: input.templateKey,
      rows: input.sheet.rows.slice(0, 600).map(row => ({
        rowNumber: row.rowNumber,
        values: row.values.slice(0, 80),
        text: row.text,
      })),
      mergedRanges: input.sheet.mergedRanges.slice(0, 200),
      localGuess,
      knownMappingProfiles: input.knownMappingProfiles.slice(0, 5).map(profile => ({
        templateKey: profile.templateKey,
        signatureHash: profile.signatureHash,
        mapping: profile.mappingJson,
        sampleHeaders: profile.sampleHeaders,
        successCount: profile.successCount,
      })),
    },
  });
  if (error) throw error;
  return sanitizeAiPreview(data, input.localPreview);
};

export const customMaterialSmartImportService = {
  async previewWorkbook(file: File, sheetName?: string): Promise<CustomMaterialWorkbookSheetPreview> {
    const XLSX = await loadXlsx();
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, cellFormula: true, cellText: true });
    const sheetNames = workbook.SheetNames || [];
    const selectedSheetName = sheetName && workbook.Sheets[sheetName]
      ? sheetName
      : sheetNames.find(name => {
        const sheet = workbook.Sheets[name];
        return Boolean(sheet?.['!ref']);
      }) || sheetNames[0] || '';
    const sheet = workbook.Sheets[selectedSheetName];
    if (!sheet || !sheet['!ref']) {
      return {
        fileName: file.name,
        sheetNames,
        selectedSheetName,
        rows: [],
        mergedRanges: [],
        columnCount: 0,
      };
    }

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const columnCount = Math.max(0, range.e.c + 1);
    const rows: CustomMaterialWorkbookRowPreview[] = [];
    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
      const values: string[] = [];
      const rawValues: string[] = [];
      for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        const cell = sheet[address];
        values[colIndex] = cleanCellText(cell?.w ?? cell?.v ?? '');
        rawValues[colIndex] = cleanCellText(cell?.v ?? cell?.w ?? '');
      }
      rows.push({
        rowNumber: rowIndex + 1,
        values,
        rawValues,
        text: values.filter(Boolean).join(' '),
      });
    }

    const mergedRanges: CustomMaterialWorkbookMergedRange[] = (sheet['!merges'] || []).map((merge: any) => {
      const startRow = Number(merge.s.r) + 1;
      const startCol = Number(merge.s.c);
      const sourceRow = rows.find(row => row.rowNumber === startRow);
      return {
        startRow,
        endRow: Number(merge.e.r) + 1,
        startCol,
        endCol: Number(merge.e.c),
        value: sourceRow?.values[startCol] || '',
      };
    });

    return {
      fileName: file.name,
      sheetNames,
      selectedSheetName,
      rows,
      mergedRanges,
      columnCount,
    };
  },

  suggestLocal(sheet: CustomMaterialWorkbookSheetPreview, templateKey: CustomMaterialTemplateKey): CustomMaterialSmartImportPreview {
    const normalizedTemplateKey = normalizeCustomMaterialTemplateKey(templateKey);
    if (normalizedTemplateKey !== 'xa_go') {
      return {
        templateKey: normalizedTemplateKey,
        source: 'local',
        confidenceScore: 0,
        warnings: ['Smart import hiện chỉ hỗ trợ mẫu Xà gồ.'],
        detectedSheet: sheet.selectedSheetName,
        headerRows: [],
        dataRange: { startRow: 0, endRow: 0 },
        mapping: {},
        rows: [],
        signatureHash: makeSignatureHash(sheet, []),
        sampleHeaders: [],
        workbookSheet: sheet,
      };
    }
    return detectLocalXaGo(sheet);
  },

  async suggestSmart(input: {
    file: File;
    templateKey: CustomMaterialTemplateKey;
    sheetName?: string;
  }): Promise<CustomMaterialSmartImportPreview> {
    const templateKey = normalizeCustomMaterialTemplateKey(input.templateKey);
    const sheet = await this.previewWorkbook(input.file, input.sheetName);
    const localPreview = this.suggestLocal(sheet, templateKey);
    let profiles: MappingProfile[] = [];

    try {
      profiles = await listMappingProfiles(templateKey, localPreview.signatureHash);
      const profile = profiles[0];
      if (profile?.mappingJson && Object.keys(profile.mappingJson).length > 0) {
        const memoryPreview = buildPreviewFromMapping(sheet, templateKey, profile.mappingJson, {
          source: 'memory',
          headerRows: localPreview.headerRows,
          sampleHeaders: localPreview.sampleHeaders,
          signatureHash: localPreview.signatureHash,
          confidenceScore: Math.max(0.82, profile.confidenceScore || localPreview.confidenceScore),
          warnings: ['Đã dùng mapping đã nhớ từ lần import trước.'],
        });
        if (memoryPreview.rows.length > 0) return memoryPreview;
      }
    } catch (error) {
      console.warn('custom material mapping profile lookup failed:', (error as Error)?.message || error);
    }

    const missingRequired = REQUIRED_XA_GO_FIELDS.some(field => !localPreview.mapping[field]);
    if (templateKey === 'xa_go' && (localPreview.confidenceScore < 0.7 || missingRequired)) {
      try {
        const aiPreview = await callAiFallback({
          fileName: input.file.name,
          templateKey,
          sheet,
          localPreview,
          knownMappingProfiles: profiles,
        });
        if (aiPreview && aiPreview.rows.length > 0) return aiPreview;
      } catch (error) {
        return {
          ...localPreview,
          warnings: [
            ...localPreview.warnings,
            `AI fallback không khả dụng: ${(error as Error)?.message || 'Không rõ lỗi'}.`,
          ],
        };
      }
    }

    return localPreview;
  },

  rebuildPreviewFromMapping(
    preview: CustomMaterialSmartImportPreview,
    mapping: CustomMaterialSmartImportMapping,
  ): CustomMaterialSmartImportPreview {
    if (!preview.workbookSheet) {
      return {
        ...preview,
        mapping,
        warnings: [...preview.warnings, 'Không còn dữ liệu workbook gốc để dựng lại preview từ mapping.'],
      };
    }
    return buildPreviewFromMapping(preview.workbookSheet, preview.templateKey, mapping, {
      source: preview.source,
      headerRows: preview.headerRows,
      sampleHeaders: preview.sampleHeaders,
      signatureHash: preview.signatureHash,
      confidenceScore: Math.max(preview.confidenceScore, 0.72),
      warnings: ['Mapping đã được chỉnh thủ công.'],
    });
  },

  applyPreviewToLines(preview: CustomMaterialSmartImportPreview) {
    return preview.rows.filter(row => row.status !== 'error').map(row => row.line);
  },

  async saveMappingProfile(
    preview: CustomMaterialSmartImportPreview,
    correctedMapping: CustomMaterialSmartImportMapping = preview.mapping,
  ): Promise<void> {
    if (!isSupabaseConfigured || !preview.signatureHash || Object.keys(correctedMapping).length === 0) return;
    const { data: existing, error: existingError } = await supabase
      .from(MAPPING_PROFILE_TABLE)
      .select('id, success_count')
      .eq('scope_type', 'company')
      .eq('scope_id', 'default')
      .eq('template_key', preview.templateKey)
      .eq('signature_hash', preview.signatureHash)
      .maybeSingle();
    if (existingError) throw existingError;

    const payload = toDb({
      id: existing?.id,
      scopeType: 'company',
      scopeId: 'default',
      templateKey: preview.templateKey,
      signatureHash: preview.signatureHash,
      mappingJson: correctedMapping,
      sampleHeaders: preview.sampleHeaders,
      confidenceScore: preview.confidenceScore,
      successCount: Number(existing?.success_count || 0) + 1,
      lastUsedAt: new Date().toISOString(),
    });
    const { error } = await supabase
      .from(MAPPING_PROFILE_TABLE)
      .upsert(payload, { onConflict: 'scope_type,scope_id,template_key,signature_hash' });
    if (error) throw error;
  },
};
