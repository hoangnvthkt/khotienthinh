import { loadXlsx } from './loadXlsx';

export type ExcelImportMode = 'create' | 'update';
export type ExcelImportRowStatus = 'create' | 'update' | 'unchanged' | 'error';

export interface ExcelImportField<TRecord> {
  key: keyof TRecord & string;
  label: string;
  aliases: string[];
  requiredOnCreate?: boolean;
  clearable?: boolean;
  normalize?: (value: string, row: Record<string, unknown>) => unknown;
  validate?: (value: unknown, row: Record<string, unknown>) => string | undefined;
  format?: (value: unknown) => string;
}

export interface ExcelImportChange {
  fieldKey: string;
  fieldLabel: string;
  oldValue: unknown;
  newValue: unknown;
  oldDisplay: string;
  newDisplay: string;
}

export interface ExcelImportPreviewRow<TRecord> {
  rowNumber: number;
  keyValue: string;
  status: ExcelImportRowStatus;
  errors: string[];
  warnings: string[];
  changes: ExcelImportChange[];
  source: Record<string, unknown>;
  existingRecord?: TRecord;
  nextRecord?: TRecord;
}

export interface ExcelImportPreview<TRecord> {
  mode: ExcelImportMode;
  keyLabel: string;
  rows: ExcelImportPreviewRow<TRecord>[];
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  missingRows: number;
  conflictRows: number;
  unchangedRows: number;
  updateRows: number;
  createRows: number;
}

export interface ExcelImportConfig<TRecord> {
  mode: ExcelImportMode;
  keyLabel: string;
  keyAliases: string[];
  existingRecords: TRecord[];
  getRecordKey: (record: TRecord) => string;
  fields: Array<ExcelImportField<TRecord>>;
  createBaseRecord: (keyValue: string, row: Record<string, unknown>, rowNumber: number) => TRecord;
  isEmptyRow?: (row: Record<string, unknown>) => boolean;
  validateKey?: (keyValue: string, row: Record<string, unknown>, rowNumber: number) => string | undefined;
}

export const CLEAR_TOKEN = '__CLEAR__';

export const normalizeImportKey = (value: unknown): string =>
  String(value || '').trim().toLowerCase();

export const defaultImportFormat = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('vi-VN') : '-';
  return String(value);
};

export const getExcelCell = (row: Record<string, unknown>, aliases: string[]): string => {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
};

const hasExcelColumn = (row: Record<string, unknown>, aliases: string[]): boolean =>
  aliases.some(alias => Object.prototype.hasOwnProperty.call(row, alias));

const valuesEqual = (a: unknown, b: unknown): boolean =>
  String(a ?? '').trim() === String(b ?? '').trim();

export const parseExcelRows = async (file: File, preferredSheetName?: string): Promise<Record<string, unknown>[]> => {
  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = preferredSheetName && workbook.Sheets[preferredSheetName]
    ? preferredSheetName
    : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
};

export const buildImportPreview = <TRecord extends Record<string, any>>(
  config: ExcelImportConfig<TRecord>,
  sourceRows: Record<string, unknown>[],
): ExcelImportPreview<TRecord> => {
  const existingByKey = new Map<string, TRecord>();
  config.existingRecords.forEach(record => existingByKey.set(normalizeImportKey(config.getRecordKey(record)), record));

  const nonEmptyRows = sourceRows.map((row, index) => ({ row, rowNumber: index + 2 })).filter(({ row }) => {
    if (config.isEmptyRow) return !config.isEmptyRow(row);
    return Object.values(row).some(value => String(value ?? '').trim() !== '');
  });

  const seenKeys = new Map<string, number>();
  const rows = nonEmptyRows.map<ExcelImportPreviewRow<TRecord>>(({ row, rowNumber }) => {
    const keyValue = getExcelCell(row, config.keyAliases);
    const key = normalizeImportKey(keyValue);
    const errors: string[] = [];
    const warnings: string[] = [];
    const changes: ExcelImportChange[] = [];
    let duplicate = false;

    if (!keyValue) errors.push(`Thiếu ${config.keyLabel}.`);
    const keyError = keyValue ? config.validateKey?.(keyValue, row, rowNumber) : undefined;
    if (keyError) errors.push(keyError);
    if (key) {
      const firstRow = seenKeys.get(key);
      if (firstRow) {
        duplicate = true;
        errors.push(`${config.keyLabel} "${keyValue}" bị trùng với dòng ${firstRow}.`);
      } else {
        seenKeys.set(key, rowNumber);
      }
    }

    const existing = key ? existingByKey.get(key) : undefined;
    if (config.mode === 'update' && key && !existing) {
      errors.push(`${config.keyLabel} "${keyValue}" không tồn tại.`);
    }
    if (config.mode === 'create' && key && existing) {
      errors.push(`${config.keyLabel} "${keyValue}" đã tồn tại.`);
    }

    const baseRecord = existing || config.createBaseRecord(keyValue, row, rowNumber);
    const nextRecord: TRecord = { ...baseRecord };

    config.fields.forEach(field => {
      const columnExists = hasExcelColumn(row, field.aliases);
      const rawValue = getExcelCell(row, field.aliases);
      const shouldReadValue = config.mode === 'create'
        ? (columnExists || field.requiredOnCreate)
        : columnExists;
      if (!shouldReadValue) return;

      if (config.mode === 'create' && field.requiredOnCreate && !rawValue) {
        errors.push(`Thiếu ${field.label}.`);
        return;
      }
      if (config.mode === 'create' && !field.requiredOnCreate && !rawValue) return;
      if (config.mode === 'update' && !rawValue) return;

      let nextValue: unknown;
      if (rawValue === CLEAR_TOKEN) {
        if (!field.clearable) {
          errors.push(`${field.label} không cho phép xoá bằng ${CLEAR_TOKEN}.`);
          return;
        }
        nextValue = undefined;
      } else {
        nextValue = field.normalize ? field.normalize(rawValue, row) : rawValue;
      }

      const validationError = field.validate?.(nextValue, row);
      if (validationError) {
        errors.push(validationError);
        return;
      }

      const oldValue = baseRecord[field.key];
      nextRecord[field.key] = nextValue as TRecord[typeof field.key];
      if (!valuesEqual(oldValue, nextValue)) {
        const formatter = field.format || defaultImportFormat;
        changes.push({
          fieldKey: field.key,
          fieldLabel: field.label,
          oldValue,
          newValue: nextValue,
          oldDisplay: formatter(oldValue),
          newDisplay: formatter(nextValue),
        });
      }
    });

    const status: ExcelImportRowStatus = errors.length > 0
      ? 'error'
      : config.mode === 'create'
        ? 'create'
        : changes.length > 0
          ? 'update'
          : 'unchanged';

    return {
      rowNumber,
      keyValue,
      status,
      errors,
      warnings: duplicate ? [...warnings, 'Trùng mã trong file'] : warnings,
      changes,
      source: row,
      existingRecord: existing,
      nextRecord: errors.length > 0 ? undefined : nextRecord,
    };
  });

  const errorRows = rows.filter(row => row.status === 'error').length;
  return {
    mode: config.mode,
    keyLabel: config.keyLabel,
    rows,
    totalRows: rows.length,
    validRows: rows.length - errorRows,
    errorRows,
    duplicateRows: rows.filter(row => row.errors.some(error => error.includes('bị trùng'))).length,
    missingRows: rows.filter(row => row.errors.some(error => error.includes('không tồn tại'))).length,
    conflictRows: rows.filter(row => row.errors.some(error => error.includes('đã tồn tại'))).length,
    unchangedRows: rows.filter(row => row.status === 'unchanged').length,
    updateRows: rows.filter(row => row.status === 'update').length,
    createRows: rows.filter(row => row.status === 'create').length,
  };
};

export const applyImportChanges = <TRecord extends Record<string, any>>(
  preview: ExcelImportPreview<TRecord>,
): TRecord[] => preview.rows
  .filter(row => row.nextRecord && (row.status === 'create' || row.status === 'update'))
  .map(row => row.nextRecord as TRecord);
