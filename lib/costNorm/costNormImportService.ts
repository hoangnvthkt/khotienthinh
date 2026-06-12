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
} from './import/types';

const LIBRARY_TABLE = 'cost_norm_libraries';
const ITEM_TABLE = 'cost_norm_items';
const RESOURCE_TABLE = 'cost_norm_resources';
const COMPONENT_TABLE = 'cost_norm_item_components';
const IMPORT_JOB_TABLE = 'cost_norm_import_jobs';
const IMPORT_ERROR_TABLE = 'cost_norm_import_errors';
const BATCH_SIZE = 500;

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

const sha256File = async (file: File): Promise<string> => {
  if (!crypto?.subtle) return '';
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const resourceKey = (type: CostNormResourceType, code: string) => `${type}|${code.toUpperCase()}`;

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
      resultSummary: {
        sheetName: input.parseResult.sheetName,
        detectedHeaderRow: input.parseResult.detectedHeaderRow,
        columnMapping: input.parseResult.columnMapping,
        confidenceScore: input.parseResult.confidenceScore,
        ignoredRows: input.parseResult.ignoredRows,
      },
      createdBy: input.actorId || null,
    }));
    const { error: jobError } = await supabase.from(IMPORT_JOB_TABLE).insert(jobPayload);
    if (jobError) throw jobError;

    try {
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
            ...jobPayload.result_summary,
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

  async listLibraries(limit = 20) {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from(LIBRARY_TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(fromDb);
  },
};
