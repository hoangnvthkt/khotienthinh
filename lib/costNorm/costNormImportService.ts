import { fromDb, toDb } from '../dbMapping';
import { isSupabaseConfigured, supabase } from '../supabase';
import { buildSearchText } from './import/normalize';
import { parseG8ExcelArrayBuffer } from './import/g8ExcelParser';
import {
  CostNormImportCommitResult,
  CostNormLibraryMetadata,
  CostNormResourceType,
  G8ImportIssue,
  G8ParseOptions,
  G8ParseResult,
  ParsedNormComponent,
  ParsedNormItem,
} from './import/types';

const LIBRARY_TABLE = 'cost_norm_libraries';
const ITEM_TABLE = 'cost_norm_items';
const RESOURCE_TABLE = 'cost_norm_resources';
const COMPONENT_TABLE = 'cost_norm_item_components';
const IMPORT_JOB_TABLE = 'cost_norm_import_jobs';
const IMPORT_ERROR_TABLE = 'cost_norm_import_errors';
const IMPORT_RAW_ROW_TABLE = 'cost_norm_import_raw_rows';
const CHANGE_LOG_TABLE = 'cost_norm_change_logs';
const BATCH_SIZE = 500;
const READ_PAGE_SIZE = 1000;

export interface CostNormLibraryRecord extends CostNormLibraryMetadata {
  id: string;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CostNormResourceRecord {
  id: string;
  code: string;
  name: string;
  type: CostNormResourceType;
  unit?: string | null;
  searchText?: string | null;
  rawData?: Record<string, unknown>;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CostNormComponentRecord {
  id: string;
  normItemId: string;
  resourceId?: string | null;
  resource?: CostNormResourceRecord | null;
  resourceType: CostNormResourceType;
  rawResourceCode?: string | null;
  rawResourceName: string;
  unit?: string | null;
  coefficient?: number | null;
  lineIndex: number;
  sourceSheetName?: string | null;
  sourceRowNumber?: number | null;
  isAdjustment: boolean;
  note?: string | null;
  rawData?: Record<string, unknown>;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CostNormItemRecord extends Omit<ParsedNormItem, 'id' | 'components'> {
  id: string;
  libraryId: string;
  components: CostNormComponentRecord[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CostNormImportJobRecord {
  id: string;
  libraryId?: string | null;
  fileName: string;
  fileUrl?: string | null;
  fileSize?: number | null;
  fileHash?: string | null;
  status: string;
  totalRows: number;
  parsedItems: number;
  parsedComponents: number;
  warningCount: number;
  errorCount: number;
  parserVersion: string;
  resultSummary?: Record<string, unknown>;
  createdBy?: string | null;
  createdAt?: string;
  completedAt?: string | null;
}

export interface CostNormImportRawRowRecord {
  id: string;
  importJobId: string;
  libraryId?: string | null;
  sheetName: string;
  rowNumber: number;
  rowType: string;
  rowText?: string | null;
  rawValues?: Record<string, string>;
  values?: string[];
  workItemCode?: string | null;
  parentItemCode?: string | null;
  resourceCode?: string | null;
  resourceType?: CostNormResourceType | null;
  coefficient?: number | null;
  parsedData?: Record<string, unknown>;
  warnings?: string[];
}

export interface CostNormLibraryDetails {
  library: CostNormLibraryRecord;
  items: CostNormItemRecord[];
  importJobs: CostNormImportJobRecord[];
  importErrors: Array<Record<string, unknown>>;
  rawRows: CostNormImportRawRowRecord[];
  changeLogs: CostNormChangeLogRecord[];
}

export interface CostNormChangeLogRecord {
  id: string;
  libraryId?: string | null;
  normItemId?: string | null;
  componentId?: string | null;
  action: string;
  actorId?: string | null;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  createdAt?: string;
}

export interface CostNormItemInput {
  code: string;
  name: string;
  unit?: string | null;
}

export interface CostNormComponentInput {
  resourceType: CostNormResourceType;
  rawResourceCode?: string | null;
  rawResourceName: string;
  unit?: string | null;
  coefficient?: number | null;
  note?: string | null;
  lineIndex?: number | null;
}

const newId = () => crypto.randomUUID();

const cleanUndefined = <T extends Record<string, any>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

const chunk = <T>(items: T[], size = BATCH_SIZE): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const fetchPaged = async <T>(buildQuery: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>): Promise<T[]> => {
  const rows: T[] = [];
  for (let from = 0; ; from += READ_PAGE_SIZE) {
    const to = from + READ_PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < READ_PAGE_SIZE) break;
  }
  return rows;
};

const sha256File = async (file: File): Promise<string> => {
  if (!crypto?.subtle) return '';
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const resourceKey = (type: CostNormResourceType, code: string) => `${type}|${code.toUpperCase()}`;

const normalizeCodeValue = (value: unknown) => String(value ?? '').trim().toUpperCase();

const normalizeOptionalText = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return text || null;
};

const assertSupabaseConfigured = () => {
  if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
};

const normalizeCoefficient = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Định mức/hệ số không hợp lệ.');
  return parsed;
};

const normalizeItemInput = (input: CostNormItemInput) => {
  const code = normalizeCodeValue(input.code);
  const name = String(input.name ?? '').trim();
  const unit = normalizeOptionalText(input.unit);
  if (!code) throw new Error('Thiếu mã công tác.');
  if (!name) throw new Error('Thiếu tên công tác.');
  return { code, name, unit };
};

const normalizeComponentInput = (input: CostNormComponentInput) => {
  const rawResourceCode = normalizeCodeValue(input.rawResourceCode || '');
  const rawResourceName = String(input.rawResourceName ?? '').trim();
  const unit = normalizeOptionalText(input.unit);
  const coefficient = normalizeCoefficient(input.coefficient);
  if (!rawResourceName && !rawResourceCode) throw new Error('Thiếu tên hoặc mã nguồn lực.');
  return {
    resourceType: input.resourceType || 'other',
    rawResourceCode: rawResourceCode || null,
    rawResourceName: rawResourceName || rawResourceCode,
    unit,
    coefficient,
    note: normalizeOptionalText(input.note),
    lineIndex: Number.isFinite(Number(input.lineIndex)) ? Number(input.lineIndex) : null,
  };
};

const insertChangeLog = async (input: {
  libraryId?: string | null;
  normItemId?: string | null;
  componentId?: string | null;
  action: string;
  actorId?: string | null;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
}) => {
  const { error } = await supabase.from(CHANGE_LOG_TABLE).insert(cleanUndefined(toDb({
    id: newId(),
    libraryId: input.libraryId || null,
    normItemId: input.normItemId || null,
    componentId: input.componentId || null,
    action: input.action,
    actorId: input.actorId || null,
    beforeData: input.beforeData || null,
    afterData: input.afterData || null,
  })));
  if (error) throw error;
};

const componentResourceRows = (parseResult: G8ParseResult) => {
  const resources = new Map<string, { code: string; name: string; type: CostNormResourceType; unit: string; rawData: Record<string, unknown>; searchText: string }>();
  parseResult.items.forEach(item => {
    item.components.forEach(component => {
      if (!component.resourceCode) return;
      const key = resourceKey(component.resourceType, component.resourceCode);
      if (resources.has(key)) return;
      resources.set(key, {
        code: component.resourceCode,
        name: component.resourceName,
        type: component.resourceType,
        unit: component.unit,
        rawData: {
          sourceSheetName: component.sourceSheetName,
          sourceRowNumber: component.sourceRowNumber,
          importedFrom: 'g8_excel_parser',
        },
        searchText: buildSearchText(component.resourceCode, component.resourceName, component.unit, component.resourceType),
      });
    });
  });
  return Array.from(resources.values());
};

const resourceMismatchIssues = (parseResult: G8ParseResult): G8ImportIssue[] => {
  const seen = new Map<string, ParsedNormComponent>();
  const issues: G8ImportIssue[] = [];
  parseResult.items.forEach(item => {
    item.components.forEach(component => {
      if (!component.resourceCode) return;
      const key = resourceKey(component.resourceType, component.resourceCode);
      const first = seen.get(key);
      if (!first) {
        seen.set(key, component);
        return;
      }
      if (first.resourceName !== component.resourceName || first.unit !== component.unit) {
        issues.push({
          sheetName: component.sourceSheetName,
          rowNumber: component.sourceRowNumber,
          severity: 'warning',
          code: 'resource_canonical_mismatch',
          message: `Mã nguồn lực ${component.resourceCode} có tên/đơn vị khác dòng trước; giữ canonical resource và lưu raw ở component.`,
        });
      }
    });
  });
  return issues;
};

const insertRawRows = async (jobId: string, libraryId: string, parseResult: G8ParseResult) => {
  if (!parseResult.classifiedRows.length) return;
  const rows = parseResult.classifiedRows.map(row => cleanUndefined(toDb({
    id: newId(),
    importJobId: jobId,
    libraryId,
    sheetName: row.sheetName,
    rowNumber: row.rowNumber,
    rowType: row.rowType,
    rowText: row.text,
    rawValues: row.rawValues,
    values: row.values,
    workItemCode: row.itemCode || null,
    parentItemCode: row.parentItemCode || null,
    resourceCode: row.resourceCode || null,
    resourceType: row.resourceType || row.groupType || null,
    coefficient: row.coefficient ?? null,
    parsedData: {
      ...row.parsedData,
      groupType: row.groupType || undefined,
    },
    warnings: row.warnings || [],
  })));

  for (const part of chunk(rows)) {
    const { error } = await supabase.from(IMPORT_RAW_ROW_TABLE).insert(part);
    if (error) throw error;
  }
};

const insertImportIssues = async (jobId: string, issues: G8ImportIssue[]) => {
  if (!issues.length) return;
  const rows = issues.map(issue => cleanUndefined(toDb({
    id: newId(),
    importJobId: jobId,
    sheetName: issue.sheetName,
    rowNumber: issue.rowNumber,
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    rawRow: issue.rawRow ? { values: issue.rawRow.values, rawValues: issue.rawRow.rawValues } : {},
  })));
  for (const part of chunk(rows)) {
    const { error } = await supabase.from(IMPORT_ERROR_TABLE).insert(part);
    if (error) throw error;
  }
};

const ensureResources = async (parseResult: G8ParseResult): Promise<Map<string, string>> => {
  const rows = componentResourceRows(parseResult);
  const codes = Array.from(new Set(rows.map(row => row.code)));
  if (!codes.length) return new Map();

  const { data: existing, error: existingError } = await supabase
    .from(RESOURCE_TABLE)
    .select('*')
    .in('code', codes);
  if (existingError) throw existingError;

  const existingRows = (existing || []).map(fromDb);
  const existingKeys = new Set(existingRows.map((row: any) => resourceKey(row.type, row.code)));
  const missingRows = rows
    .filter(row => !existingKeys.has(resourceKey(row.type, row.code)))
    .map(row => cleanUndefined(toDb(row)));

  for (const part of chunk(missingRows)) {
    if (!part.length) continue;
    const { error } = await supabase
      .from(RESOURCE_TABLE)
      .upsert(part, { onConflict: 'type,code', ignoreDuplicates: true });
    if (error) throw error;
  }

  const { data: finalRows, error: finalError } = await supabase
    .from(RESOURCE_TABLE)
    .select('*')
    .in('code', codes);
  if (finalError) throw finalError;

  const byKey = new Map<string, string>();
  (finalRows || []).map(fromDb).forEach((row: any) => {
    byKey.set(resourceKey(row.type, row.code), row.id);
  });
  return byKey;
};

const ensureComponentResource = async (
  component: ReturnType<typeof normalizeComponentInput>,
  actorId?: string | null,
): Promise<string | null> => {
  if (!component.rawResourceCode) return null;
  const key = resourceKey(component.resourceType, component.rawResourceCode);
  const { data: existing, error: existingError } = await supabase
    .from(RESOURCE_TABLE)
    .select('*')
    .eq('type', component.resourceType)
    .eq('code', component.rawResourceCode)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) return existing.id;

  const payload = cleanUndefined(toDb({
    id: newId(),
    code: component.rawResourceCode,
    name: component.rawResourceName,
    type: component.resourceType,
    unit: component.unit,
    searchText: buildSearchText(component.rawResourceCode, component.rawResourceName, component.unit, component.resourceType),
    rawData: {
      source: 'g8_manual_editor',
      resourceKey: key,
    },
    updatedBy: actorId || null,
  }));
  const { data, error } = await supabase
    .from(RESOURCE_TABLE)
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data.id;
};

const upsertItems = async (libraryId: string, parseResult: G8ParseResult): Promise<Map<string, string>> => {
  const rows = parseResult.items.map(item => cleanUndefined(toDb({
    id: newId(),
    libraryId,
    code: item.code,
    name: item.name,
    unit: item.unit,
    sourceSheetName: item.sourceSheetName,
    sourceRowStart: item.sourceRowStart,
    sourceRowEnd: item.sourceRowEnd,
    searchText: item.searchText || buildSearchText(item.code, item.name, item.unit),
    rawData: {
      ...item.rawData,
      confidenceScore: item.confidenceScore,
      warnings: item.warnings,
    },
  })));

  const itemMap = new Map<string, string>();
  for (const part of chunk(rows)) {
    const { data, error } = await supabase
      .from(ITEM_TABLE)
      .upsert(part, { onConflict: 'library_id,code' })
      .select('*');
    if (error) throw error;
    (data || []).map(fromDb).forEach((row: any) => itemMap.set(row.code, row.id));
  }
  return itemMap;
};

const insertComponents = async (
  parseResult: G8ParseResult,
  itemIds: Map<string, string>,
  resourceIds: Map<string, string>,
) => {
  const rows = parseResult.items.flatMap(item => {
    const itemId = itemIds.get(item.code);
    if (!itemId) return [];
    return item.components.map(component => cleanUndefined(toDb({
      id: newId(),
      normItemId: itemId,
      resourceId: component.resourceCode ? resourceIds.get(resourceKey(component.resourceType, component.resourceCode)) || null : null,
      resourceType: component.resourceType,
      rawResourceCode: component.resourceCode || null,
      rawResourceName: component.resourceName,
      unit: component.unit,
      coefficient: component.coefficient,
      lineIndex: component.lineIndex,
      sourceSheetName: component.sourceSheetName,
      sourceRowNumber: component.sourceRowNumber,
      isAdjustment: component.isAdjustment,
      note: component.note || null,
      rawData: {
        ...component.rawData,
        confidenceScore: component.confidenceScore,
        warnings: component.warnings,
      },
    })));
  });

  for (const part of chunk(rows)) {
    const { error } = await supabase.from(COMPONENT_TABLE).insert(part);
    if (error) throw error;
  }
};

export const g8CostNormImportService = {
  async parseImportFile(file: File, options: G8ParseOptions = {}): Promise<G8ParseResult> {
    const buffer = await file.arrayBuffer();
    return parseG8ExcelArrayBuffer(buffer, {
      ...options,
      fileName: file.name,
      fileSize: file.size,
    });
  },

  async commitParsedCostNormLibrary(input: {
    metadata: CostNormLibraryMetadata;
    parseResult: G8ParseResult;
    file?: File | null;
    actorId?: string | null;
  }): Promise<CostNormImportCommitResult> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
    if (!input.parseResult.items.length) throw new Error('Chưa có công tác G8 hợp lệ để commit.');

    const extraIssues = resourceMismatchIssues(input.parseResult);
    const issues = [...input.parseResult.issues, ...extraIssues];
    const warningCount = issues.filter(issue => issue.severity === 'warning').length;
    const errorCount = issues.filter(issue => issue.severity === 'error').length;
    const fileHash = input.file ? await sha256File(input.file) : '';

    const libraryPayload = cleanUndefined(toDb({
      id: newId(),
      name: input.metadata.name.trim(),
      code: input.metadata.code.trim(),
      source: input.metadata.source || 'G8',
      version: input.metadata.version || null,
      region: input.metadata.region || null,
      decisionNo: input.metadata.decisionNo || null,
      effectiveDate: input.metadata.effectiveDate || null,
      status: input.metadata.status || 'draft',
      description: input.metadata.description || null,
      createdBy: input.actorId || null,
    }));
    const { data: libraryRow, error: libraryError } = await supabase
      .from(LIBRARY_TABLE)
      .insert(libraryPayload)
      .select('*')
      .single();
    if (libraryError) throw libraryError;
    const library = fromDb(libraryRow) as { id: string };

    const importJobId = newId();
    const initialResultSummary = {
      sheetName: input.parseResult.sheetName,
      detectedHeaderRow: input.parseResult.detectedHeaderRow,
      columnMapping: input.parseResult.columnMapping,
      confidenceScore: input.parseResult.confidenceScore,
      ignoredRows: input.parseResult.ignoredRows,
      rawRowCount: input.parseResult.classifiedRows.length,
    };
    const jobPayload = cleanUndefined(toDb({
      id: importJobId,
      libraryId: library.id,
      fileName: input.parseResult.fileName || input.file?.name || 'G8.xlsx',
      fileUrl: null,
      fileSize: input.parseResult.fileSize || input.file?.size || null,
      fileHash: fileHash || null,
      status: 'committing',
      totalRows: input.parseResult.totalRows,
      parsedItems: input.parseResult.parsedItems,
      parsedComponents: input.parseResult.parsedComponents,
      warningCount,
      errorCount,
      parserVersion: input.parseResult.parserVersion,
      resultSummary: initialResultSummary,
      createdBy: input.actorId || null,
    }));
    const { error: jobError } = await supabase.from(IMPORT_JOB_TABLE).insert(jobPayload);
    if (jobError) throw jobError;

    try {
      await insertRawRows(importJobId, library.id, input.parseResult);
      await insertImportIssues(importJobId, issues);
      const resourceIds = await ensureResources(input.parseResult);
      const itemIds = await upsertItems(library.id, input.parseResult);
      await insertComponents(input.parseResult, itemIds, resourceIds);

      const { error: updateError } = await supabase
        .from(IMPORT_JOB_TABLE)
        .update(toDb({
          status: 'committed',
          completedAt: new Date().toISOString(),
          resultSummary: {
            ...initialResultSummary,
            resourceCount: resourceIds.size,
          },
        }))
        .eq('id', importJobId);
      if (updateError) throw updateError;

      return {
        libraryId: library.id,
        importJobId,
        itemCount: input.parseResult.parsedItems,
        componentCount: input.parseResult.parsedComponents,
        resourceCount: resourceIds.size,
        warningCount,
        errorCount,
      };
    } catch (error) {
      await supabase
        .from(IMPORT_JOB_TABLE)
        .update(toDb({
          status: 'failed',
          completedAt: new Date().toISOString(),
          resultSummary: {
            error: error instanceof Error ? error.message : String(error),
          },
        }))
        .eq('id', importJobId);
      throw error;
    }
  },

  async listLibraries(limit = 50): Promise<CostNormLibraryRecord[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from(LIBRARY_TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(fromDb) as CostNormLibraryRecord[];
  },

  async listImportJobs(libraryId: string): Promise<CostNormImportJobRecord[]> {
    if (!isSupabaseConfigured || !libraryId) return [];
    const rows = await fetchPaged<any>((from, to) => supabase
      .from(IMPORT_JOB_TABLE)
      .select('*')
      .eq('library_id', libraryId)
      .order('created_at', { ascending: false })
      .range(from, to) as any);
    return rows.map(fromDb) as CostNormImportJobRecord[];
  },

  async updateLibraryStatus(libraryId: string, status: CostNormLibraryMetadata['status'], actorId?: string | null): Promise<CostNormLibraryRecord> {
    assertSupabaseConfigured();
    if (!libraryId || !status) throw new Error('Thiếu thư viện hoặc trạng thái.');
    const { data: beforeRow, error: beforeError } = await supabase
      .from(LIBRARY_TABLE)
      .select('*')
      .eq('id', libraryId)
      .single();
    if (beforeError) throw beforeError;

    const { data, error } = await supabase
      .from(LIBRARY_TABLE)
      .update(toDb({ status, updatedBy: actorId || null }))
      .eq('id', libraryId)
      .select('*')
      .single();
    if (error) throw error;
    await insertChangeLog({
      libraryId,
      action: 'library_update',
      actorId,
      beforeData: fromDb(beforeRow),
      afterData: fromDb(data),
    });
    return fromDb(data) as CostNormLibraryRecord;
  },

  async updateLibraryMetadata(libraryId: string, patch: Partial<CostNormLibraryMetadata>, actorId?: string | null): Promise<CostNormLibraryRecord> {
    assertSupabaseConfigured();
    if (!libraryId) throw new Error('Thiếu thư viện.');
    const { data: beforeRow, error: beforeError } = await supabase
      .from(LIBRARY_TABLE)
      .select('*')
      .eq('id', libraryId)
      .single();
    if (beforeError) throw beforeError;

    const payload = cleanUndefined(toDb({
      name: patch.name !== undefined ? String(patch.name || '').trim() : undefined,
      code: patch.code !== undefined ? normalizeCodeValue(patch.code) : undefined,
      source: patch.source !== undefined ? String(patch.source || 'G8').trim() : undefined,
      version: patch.version !== undefined ? normalizeOptionalText(patch.version) : undefined,
      region: patch.region !== undefined ? normalizeOptionalText(patch.region) : undefined,
      decisionNo: patch.decisionNo !== undefined ? normalizeOptionalText(patch.decisionNo) : undefined,
      effectiveDate: patch.effectiveDate !== undefined ? normalizeOptionalText(patch.effectiveDate) : undefined,
      status: patch.status !== undefined ? patch.status : undefined,
      description: patch.description !== undefined ? normalizeOptionalText(patch.description) : undefined,
      updatedBy: actorId || null,
    }));
    if ('name' in payload && !payload.name) throw new Error('Thiếu tên thư viện.');
    if ('code' in payload && !payload.code) throw new Error('Thiếu mã thư viện.');

    const { data, error } = await supabase
      .from(LIBRARY_TABLE)
      .update(payload)
      .eq('id', libraryId)
      .select('*')
      .single();
    if (error) throw error;
    await insertChangeLog({
      libraryId,
      action: 'library_update',
      actorId,
      beforeData: fromDb(beforeRow),
      afterData: fromDb(data),
    });
    return fromDb(data) as CostNormLibraryRecord;
  },

  async createNormItem(libraryId: string, input: CostNormItemInput, actorId?: string | null): Promise<CostNormItemRecord> {
    assertSupabaseConfigured();
    if (!libraryId) throw new Error('Thiếu thư viện.');
    const item = normalizeItemInput(input);
    const payload = cleanUndefined(toDb({
      id: newId(),
      libraryId,
      code: item.code,
      name: item.name,
      unit: item.unit,
      searchText: buildSearchText(item.code, item.name, item.unit),
      rawData: {
        source: 'g8_manual_editor',
        editedBy: actorId || null,
        editedAt: new Date().toISOString(),
      },
      updatedBy: actorId || null,
    }));
    const { data, error } = await supabase
      .from(ITEM_TABLE)
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    await insertChangeLog({
      libraryId,
      normItemId: data.id,
      action: 'item_create',
      actorId,
      afterData: fromDb(data),
    });
    return { ...(fromDb(data) as any), components: [] } as CostNormItemRecord;
  },

  async updateNormItem(itemId: string, input: CostNormItemInput, actorId?: string | null): Promise<CostNormItemRecord> {
    assertSupabaseConfigured();
    if (!itemId) throw new Error('Thiếu công tác.');
    const item = normalizeItemInput(input);
    const { data: beforeRow, error: beforeError } = await supabase
      .from(ITEM_TABLE)
      .select('*')
      .eq('id', itemId)
      .single();
    if (beforeError) throw beforeError;
    const before = fromDb(beforeRow) as any;
    const payload = cleanUndefined(toDb({
      code: item.code,
      name: item.name,
      unit: item.unit,
      searchText: buildSearchText(item.code, item.name, item.unit),
      rawData: {
        ...(before.rawData || {}),
        editedBy: actorId || null,
        editedAt: new Date().toISOString(),
      },
      updatedBy: actorId || null,
    }));
    const { data, error } = await supabase
      .from(ITEM_TABLE)
      .update(payload)
      .eq('id', itemId)
      .select('*')
      .single();
    if (error) throw error;
    await insertChangeLog({
      libraryId: before.libraryId,
      normItemId: itemId,
      action: 'item_update',
      actorId,
      beforeData: before,
      afterData: fromDb(data),
    });
    return { ...(fromDb(data) as any), components: [] } as CostNormItemRecord;
  },

  async deleteNormItem(itemId: string, actorId?: string | null): Promise<void> {
    assertSupabaseConfigured();
    if (!itemId) throw new Error('Thiếu công tác.');
    const { data: beforeRow, error: beforeError } = await supabase
      .from(ITEM_TABLE)
      .select('*')
      .eq('id', itemId)
      .single();
    if (beforeError) throw beforeError;
    const before = fromDb(beforeRow) as any;
    await insertChangeLog({
      libraryId: before.libraryId,
      normItemId: itemId,
      action: 'item_delete',
      actorId,
      beforeData: before,
    });
    const { error } = await supabase.from(ITEM_TABLE).delete().eq('id', itemId);
    if (error) throw error;
  },

  async createComponent(normItemId: string, input: CostNormComponentInput, actorId?: string | null): Promise<CostNormComponentRecord> {
    assertSupabaseConfigured();
    if (!normItemId) throw new Error('Thiếu công tác cha.');
    const { data: itemRow, error: itemError } = await supabase
      .from(ITEM_TABLE)
      .select('*')
      .eq('id', normItemId)
      .single();
    if (itemError) throw itemError;
    const item = fromDb(itemRow) as any;
    const component = normalizeComponentInput(input);
    const resourceId = await ensureComponentResource(component, actorId);
    let lineIndex = component.lineIndex;
    if (lineIndex === null) {
      const { data: lastRows, error: lastError } = await supabase
        .from(COMPONENT_TABLE)
        .select('line_index')
        .eq('norm_item_id', normItemId)
        .order('line_index', { ascending: false })
        .limit(1);
      if (lastError) throw lastError;
      lineIndex = ((lastRows?.[0]?.line_index ?? -1) as number) + 1;
    }
    const payload = cleanUndefined(toDb({
      id: newId(),
      normItemId,
      resourceId,
      resourceType: component.resourceType,
      rawResourceCode: component.rawResourceCode,
      rawResourceName: component.rawResourceName,
      unit: component.unit,
      coefficient: component.coefficient,
      lineIndex,
      isAdjustment: component.resourceType === 'adjustment',
      note: component.note,
      rawData: {
        source: 'g8_manual_editor',
        editedBy: actorId || null,
        editedAt: new Date().toISOString(),
      },
      updatedBy: actorId || null,
    }));
    const { data, error } = await supabase
      .from(COMPONENT_TABLE)
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    await insertChangeLog({
      libraryId: item.libraryId,
      normItemId,
      componentId: data.id,
      action: 'component_create',
      actorId,
      afterData: fromDb(data),
    });
    return fromDb(data) as CostNormComponentRecord;
  },

  async updateComponent(componentId: string, input: CostNormComponentInput, actorId?: string | null): Promise<CostNormComponentRecord> {
    assertSupabaseConfigured();
    if (!componentId) throw new Error('Thiếu hao phí.');
    const { data: beforeRow, error: beforeError } = await supabase
      .from(COMPONENT_TABLE)
      .select('*')
      .eq('id', componentId)
      .single();
    if (beforeError) throw beforeError;
    const before = fromDb(beforeRow) as any;
    const { data: itemRow, error: itemError } = await supabase
      .from(ITEM_TABLE)
      .select('*')
      .eq('id', before.normItemId)
      .single();
    if (itemError) throw itemError;
    const item = fromDb(itemRow) as any;
    const component = normalizeComponentInput(input);
    const resourceId = await ensureComponentResource(component, actorId);
    const payload = cleanUndefined(toDb({
      resourceId,
      resourceType: component.resourceType,
      rawResourceCode: component.rawResourceCode,
      rawResourceName: component.rawResourceName,
      unit: component.unit,
      coefficient: component.coefficient,
      lineIndex: component.lineIndex ?? before.lineIndex,
      isAdjustment: component.resourceType === 'adjustment',
      note: component.note,
      rawData: {
        ...(before.rawData || {}),
        editedBy: actorId || null,
        editedAt: new Date().toISOString(),
      },
      updatedBy: actorId || null,
    }));
    const { data, error } = await supabase
      .from(COMPONENT_TABLE)
      .update(payload)
      .eq('id', componentId)
      .select('*')
      .single();
    if (error) throw error;
    await insertChangeLog({
      libraryId: item.libraryId,
      normItemId: before.normItemId,
      componentId,
      action: 'component_update',
      actorId,
      beforeData: before,
      afterData: fromDb(data),
    });
    return fromDb(data) as CostNormComponentRecord;
  },

  async deleteComponent(componentId: string, actorId?: string | null): Promise<void> {
    assertSupabaseConfigured();
    if (!componentId) throw new Error('Thiếu hao phí.');
    const { data: beforeRow, error: beforeError } = await supabase
      .from(COMPONENT_TABLE)
      .select('*')
      .eq('id', componentId)
      .single();
    if (beforeError) throw beforeError;
    const before = fromDb(beforeRow) as any;
    const { data: itemRow, error: itemError } = await supabase
      .from(ITEM_TABLE)
      .select('*')
      .eq('id', before.normItemId)
      .single();
    if (itemError) throw itemError;
    const item = fromDb(itemRow) as any;
    await insertChangeLog({
      libraryId: item.libraryId,
      normItemId: before.normItemId,
      componentId,
      action: 'component_delete',
      actorId,
      beforeData: before,
    });
    const { error } = await supabase.from(COMPONENT_TABLE).delete().eq('id', componentId);
    if (error) throw error;
  },

  async getLibraryDetails(libraryId: string): Promise<CostNormLibraryDetails | null> {
    if (!isSupabaseConfigured || !libraryId) return null;

    const { data: libraryRow, error: libraryError } = await supabase
      .from(LIBRARY_TABLE)
      .select('*')
      .eq('id', libraryId)
      .single();
    if (libraryError) throw libraryError;

    const itemRows = await fetchPaged<any>((from, to) => supabase
      .from(ITEM_TABLE)
      .select('*')
      .eq('library_id', libraryId)
      .order('code', { ascending: true })
      .range(from, to) as any);
    const itemIds = itemRows.map(row => row.id).filter(Boolean);

    const componentRows = (await Promise.all(chunk(itemIds, 200).map(ids =>
      fetchPaged<any>((from, to) => supabase
        .from(COMPONENT_TABLE)
        .select('*')
        .in('norm_item_id', ids)
        .order('line_index', { ascending: true })
        .range(from, to) as any)
    ))).flat();

    const resourceIds = Array.from(new Set(componentRows.map(row => row.resource_id).filter(Boolean)));
    const resourceRows = (await Promise.all(chunk(resourceIds, 200).map(ids =>
      fetchPaged<any>((from, to) => supabase
        .from(RESOURCE_TABLE)
        .select('*')
        .in('id', ids)
        .range(from, to) as any)
    ))).flat();
    const resourcesById = new Map<string, CostNormResourceRecord>();
    resourceRows.map(fromDb).forEach((row: any) => resourcesById.set(row.id, row));

    const importJobs = await fetchPaged<any>((from, to) => supabase
      .from(IMPORT_JOB_TABLE)
      .select('*')
      .eq('library_id', libraryId)
      .order('created_at', { ascending: false })
      .range(from, to) as any).then(rows => rows.map(fromDb) as CostNormImportJobRecord[]);
    const jobIds = importJobs.map(job => job.id);
    const importErrors = (await Promise.all(chunk(jobIds, 200).map(ids =>
      fetchPaged<any>((from, to) => supabase
        .from(IMPORT_ERROR_TABLE)
        .select('*')
        .in('import_job_id', ids)
        .order('row_number', { ascending: true })
        .range(from, to) as any)
    ))).flat().map(fromDb);

    const changeLogs = await fetchPaged<any>((from, to) => supabase
      .from(CHANGE_LOG_TABLE)
      .select('*')
      .eq('library_id', libraryId)
      .order('created_at', { ascending: false })
      .range(from, to) as any).then(rows => rows.map(fromDb) as CostNormChangeLogRecord[]);

    const latestJobId = importJobs[0]?.id;
    let rawRows: any[] = [];
    if (latestJobId) {
      const { data: rawData, error: rawError } = await supabase
        .from(IMPORT_RAW_ROW_TABLE)
        .select('*')
        .eq('import_job_id', latestJobId)
        .order('row_number', { ascending: true })
        .limit(500);
      if (rawError) throw rawError;
      rawRows = rawData || [];
    }

    const componentsByItem = new Map<string, CostNormComponentRecord[]>();
    componentRows.map(fromDb).forEach((component: any) => {
      const row: CostNormComponentRecord = {
        ...component,
        resource: component.resourceId ? resourcesById.get(component.resourceId) || null : null,
      };
      const rows = componentsByItem.get(row.normItemId) || [];
      rows.push(row);
      componentsByItem.set(row.normItemId, rows);
    });

    const items = itemRows.map(row => {
      const item = fromDb(row) as any;
      return {
        ...item,
        components: componentsByItem.get(item.id) || [],
      };
    }) as CostNormItemRecord[];

    return {
      library: fromDb(libraryRow) as CostNormLibraryRecord,
      items,
      importJobs,
      importErrors,
      rawRows: rawRows.map(fromDb) as CostNormImportRawRowRecord[],
      changeLogs,
    };
  },
};
