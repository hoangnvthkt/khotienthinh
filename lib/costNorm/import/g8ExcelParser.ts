import { loadXlsx } from '../../loadXlsx';
import { buildSearchText, cleanG8Name, normalizeHeaderText, parseVietnameseNumber } from './normalize';
import {
  detectGroupType,
  detectResourceTypeFromCode,
  isHeaderNoise,
  isLikelyUnit,
  isResourceCode,
  isWorkItemCode,
} from './validators';
import {
  CostNormResourceType,
  DEFAULT_G8_COLUMN_MAPPING,
  G8ClassifiedRawRow,
  G8ColumnMapping,
  G8ImportIssue,
  G8_PARSER_VERSION,
  G8ParseOptions,
  G8ParseResult,
  G8RawRow,
  G8SheetPreview,
  ParsedNormComponent,
  ParsedNormItem,
} from './types';

const mergeMapping = (mapping?: Partial<G8ColumnMapping>): G8ColumnMapping => ({
  ...DEFAULT_G8_COLUMN_MAPPING,
  ...(mapping || {}),
});

const safeCol = (values: string[], col: number | undefined): string => {
  if (col === undefined || col < 0) return '';
  return String(values[col] ?? '').trim();
};

const uniqueCols = (...cols: Array<number | undefined>): number[] =>
  Array.from(new Set(cols.filter((col): col is number => Number.isInteger(col) && col >= 0)));

const compactText = (values: string[]) => values.map(value => value.trim()).filter(Boolean).join(' | ');

const makeIssue = (
  row: G8RawRow,
  severity: G8ImportIssue['severity'],
  code: string,
  message: string,
): G8ImportIssue => ({
  sheetName: row.sheetName,
  rowNumber: row.rowNumber,
  severity,
  code,
  message,
  rawRow: row,
});

const confidenceAverage = (values: number[]): number => {
  const usable = values.filter(value => Number.isFinite(value));
  if (!usable.length) return 0;
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 100) / 100;
};

const detectHeader = (rows: G8RawRow[]): { rowNumber: number | null; mapping: G8ColumnMapping } => {
  let best: { score: number; rowNumber: number; mapping: Partial<G8ColumnMapping> } | null = null;
  rows.slice(0, 80).forEach(row => {
    const mapping: Partial<G8ColumnMapping> = {};
    let score = 0;
    row.values.forEach((value, index) => {
      const normalized = normalizeHeaderText(value);
      if (!normalized) return;
      if (normalized === 'stt' || normalized === 'so_thu_tu') score += 1;
      if (['ma_hieu_don_gia', 'ma_hieu', 'ma_cong_tac', 'ma_dinh_muc'].includes(normalized)) {
        mapping.itemCodeCol = index;
        mapping.resourceCodeCol = index;
        score += 2;
      }
      if (['ten_cong_tac', 'thanh_phan_hao_phi', 'ten_thanh_phan', 'noi_dung_cong_viec'].includes(normalized)) {
        mapping.nameCol = index;
        score += 2;
      }
      if (normalized === 'don_vi' || normalized === 'dvt') {
        mapping.unitCol = index;
        score += 1;
      }
      if (normalized === 'dinh_muc' || normalized === 'he_so' || normalized === 'hao_phi') {
        mapping.coefficientCol = index;
        score += 1;
      }
    });
    if (score >= 3 && (!best || score > best.score)) best = { score, rowNumber: row.rowNumber, mapping };
  });

  if (!best) return { rowNumber: null, mapping: DEFAULT_G8_COLUMN_MAPPING };
  return { rowNumber: best.rowNumber, mapping: mergeMapping(best.mapping) };
};

const firstWorkCode = (row: G8RawRow, mapping: G8ColumnMapping): string => {
  const cols = uniqueCols(mapping.itemCodeCol, mapping.resourceCodeCol, 0, 1, 2);
  for (const col of cols) {
    const value = safeCol(row.values, col);
    if (isWorkItemCode(value)) return value.toUpperCase();
  }
  return '';
};

const firstResourceCode = (row: G8RawRow, mapping: G8ColumnMapping): string => {
  const cols = uniqueCols(mapping.resourceCodeCol, mapping.itemCodeCol, 1, 0, 2);
  for (const col of cols) {
    const value = safeCol(row.values, col);
    if (isResourceCode(value) && !isWorkItemCode(value)) return value.toUpperCase();
  }
  return '';
};

const detectName = (row: G8RawRow, mapping: G8ColumnMapping, code: string): string => {
  const mapped = cleanG8Name(safeCol(row.values, mapping.nameCol));
  if (mapped && mapped !== code && !isHeaderNoise(mapped) && !isLikelyUnit(mapped)) return mapped;
  return cleanG8Name(row.values.find(value => {
    const text = String(value || '').trim();
    if (!text || text === code) return false;
    if (isHeaderNoise(text) || isLikelyUnit(text) || isWorkItemCode(text) || isResourceCode(text)) return false;
    return parseVietnameseNumber(text) === null && text.length >= 3;
  }) || '');
};

const detectUnit = (row: G8RawRow, mapping: G8ColumnMapping): string => {
  const mapped = safeCol(row.values, mapping.unitCol);
  if (mapped && !isHeaderNoise(mapped)) return mapped;
  return row.values.find(isLikelyUnit)?.trim() || '';
};

const detectCoefficient = (row: G8RawRow, mapping: G8ColumnMapping): number | null => {
  const mapped = parseVietnameseNumber(safeCol(row.values, mapping.coefficientCol));
  if (mapped !== null) return mapped;
  const excluded = new Set(uniqueCols(mapping.itemCodeCol, mapping.resourceCodeCol, mapping.nameCol, mapping.unitCol));
  for (let index = row.values.length - 1; index >= 0; index -= 1) {
    if (excluded.has(index)) continue;
    const value = parseVietnameseNumber(row.values[index]);
    if (value !== null) return value;
  }
  return null;
};

const itemConfidence = (item: ParsedNormItem): number => {
  let score = 0.55;
  if (item.name) score += 0.2;
  if (item.unit) score += 0.1;
  if (item.warnings.length === 0) score += 0.1;
  return Math.max(0, Math.min(1, score));
};

const componentConfidence = (component: ParsedNormComponent, group: CostNormResourceType | null): number => {
  let score = 0.25;
  if (component.resourceCode) score += 0.2;
  if (component.resourceName) score += 0.2;
  if (component.unit) score += 0.15;
  if (component.coefficient !== null) score += 0.15;
  if (group) score += 0.05;
  return Math.max(0, Math.min(1, score));
};

export const detectG8HeaderRow = (rows: G8RawRow[]) => detectHeader(rows);

export const parseG8Rows = (
  rows: G8RawRow[],
  inputMapping?: Partial<G8ColumnMapping>,
  headerRowNumber?: number | null,
  parserVersion = G8_PARSER_VERSION,
): Omit<G8ParseResult, 'fileName' | 'fileSize' | 'sheets'> => {
  const mapping = mergeMapping(inputMapping);
  const issues: G8ImportIssue[] = [];
  const items: ParsedNormItem[] = [];
  const classifiedRows: G8ClassifiedRawRow[] = [];
  const itemsByCode = new Map<string, ParsedNormItem>();
  let currentItem: ParsedNormItem | null = null;
  let currentGroup: CostNormResourceType | null = null;
  let ignoredRows = 0;

  const addClassifiedRow = (
    row: G8RawRow,
    rowType: G8ClassifiedRawRow['rowType'],
    patch: Partial<Omit<G8ClassifiedRawRow, keyof G8RawRow | 'rowType'>> = {},
  ) => {
    classifiedRows.push({
      ...row,
      rowType,
      parsedData: patch.parsedData || {},
      warnings: patch.warnings || [],
      itemCode: patch.itemCode,
      parentItemCode: patch.parentItemCode,
      resourceCode: patch.resourceCode,
      resourceType: patch.resourceType,
      groupType: patch.groupType,
      coefficient: patch.coefficient,
    });
  };

  rows.forEach(row => {
    if (headerRowNumber && row.rowNumber <= headerRowNumber) {
      addClassifiedRow(row, 'ignored', {
        parsedData: { reason: 'header' },
      });
      ignoredRows += 1;
      return;
    }
    if (!row.text.trim()) {
      addClassifiedRow(row, 'ignored', {
        parsedData: { reason: 'blank' },
      });
      ignoredRows += 1;
      return;
    }

    const workCode = firstWorkCode(row, mapping);
    const resourceCode = firstResourceCode(row, mapping);
    const coefficient = detectCoefficient(row, mapping);
    const group = !workCode && !resourceCode && coefficient === null
      ? detectGroupType(row.text) || detectGroupType(safeCol(row.values, mapping.nameCol))
      : null;
    if (group) {
      currentGroup = group;
      addClassifiedRow(row, 'group', {
        groupType: group,
        parsedData: { groupType: group },
      });
      return;
    }

    if (workCode) {
      const duplicate = itemsByCode.get(workCode);
      if (duplicate) {
        duplicate.sourceRowEnd = Math.max(duplicate.sourceRowEnd, row.rowNumber);
        duplicate.warnings = Array.from(new Set([...duplicate.warnings, `Trùng mã công tác ${workCode} trong file.`]));
        issues.push(makeIssue(row, 'warning', 'duplicate_item_code', `Mã công tác ${workCode} đã xuất hiện trước đó; các dòng sau sẽ gộp vào công tác đầu tiên.`));
        addClassifiedRow(row, 'work_item', {
          itemCode: workCode,
          parsedData: { duplicateOf: duplicate.id },
          warnings: [`Trùng mã công tác ${workCode} trong file.`],
        });
        currentItem = duplicate;
        currentGroup = null;
        return;
      }

      const name = detectName(row, mapping, workCode);
      const unit = detectUnit(row, mapping);
      const warnings = [
        ...(!name ? ['Thiếu tên công tác.'] : []),
        ...(!unit ? ['Thiếu đơn vị công tác.'] : []),
      ];
      const item: ParsedNormItem = {
        id: `${row.sheetName}-${row.rowNumber}-${workCode}`,
        code: workCode,
        name,
        unit,
        sourceSheetName: row.sheetName,
        sourceRowStart: row.rowNumber,
        sourceRowEnd: row.rowNumber,
        searchText: buildSearchText(workCode, name, unit),
        rawData: { values: row.values, rawValues: row.rawValues },
        confidenceScore: 0,
        warnings,
        components: [],
      };
      item.confidenceScore = itemConfidence(item);
      warnings.forEach(message => issues.push(makeIssue(row, 'warning', 'work_item_incomplete', `${workCode}: ${message}`)));
      addClassifiedRow(row, 'work_item', {
        itemCode: workCode,
        parsedData: { name, unit, confidenceScore: item.confidenceScore },
        warnings,
      });
      items.push(item);
      itemsByCode.set(workCode, item);
      currentItem = item;
      currentGroup = null;
      return;
    }

    const hasComponentSignal = Boolean(resourceCode || coefficient !== null || currentGroup);
    if (!hasComponentSignal) {
      addClassifiedRow(row, 'ignored', {
        parsedData: { reason: 'no_component_signal' },
      });
      ignoredRows += 1;
      return;
    }

    if (!currentItem) {
      issues.push(makeIssue(row, 'warning', 'component_without_parent', 'Dòng hao phí không có công tác cha phía trước.'));
      addClassifiedRow(row, 'warning', {
        resourceCode,
        resourceType: currentGroup || detectResourceTypeFromCode(resourceCode) || 'other',
        coefficient,
        parsedData: { reason: 'component_without_parent' },
        warnings: ['Dòng hao phí không có công tác cha phía trước.'],
      });
      ignoredRows += 1;
      return;
    }

    const resourceName = detectName(row, mapping, resourceCode);
    const unit = detectUnit(row, mapping);
    const resourceType = currentGroup || detectResourceTypeFromCode(resourceCode) || 'other';
    const warnings = [
      ...(!resourceName ? ['Thiếu tên nguồn lực.'] : []),
      ...(!unit ? ['Thiếu đơn vị nguồn lực.'] : []),
      ...(coefficient === null ? ['Thiếu định mức/hệ số nguồn lực.'] : []),
    ];
    const component: ParsedNormComponent = {
      id: `${currentItem.id}-component-${row.rowNumber}`,
      itemCode: currentItem.code,
      resourceCode,
      resourceName: resourceName || resourceCode || row.text,
      resourceType,
      unit,
      coefficient,
      lineIndex: currentItem.components.length,
      sourceSheetName: row.sheetName,
      sourceRowNumber: row.rowNumber,
      isAdjustment: resourceType === 'adjustment',
      note: warnings.join(' '),
      rawData: { values: row.values, rawValues: row.rawValues },
      confidenceScore: 0,
      warnings,
    };
    component.confidenceScore = componentConfidence(component, currentGroup);
    currentItem.components.push(component);
    currentItem.sourceRowEnd = Math.max(currentItem.sourceRowEnd, row.rowNumber);
    addClassifiedRow(row, 'component', {
      parentItemCode: currentItem.code,
      resourceCode,
      resourceType,
      coefficient,
      parsedData: {
        resourceName: component.resourceName,
        unit,
        lineIndex: component.lineIndex,
        confidenceScore: component.confidenceScore,
      },
      warnings,
    });
    warnings.forEach(message => issues.push(makeIssue(row, 'warning', 'component_incomplete', `${currentItem?.code || ''}/${resourceCode || resourceName || row.rowNumber}: ${message}`)));
  });

  const parsedComponents = items.reduce((sum, item) => sum + item.components.length, 0);
  const warningCount = issues.filter(issue => issue.severity === 'warning').length;
  const errorCount = issues.filter(issue => issue.severity === 'error').length;
  const confidenceScore = confidenceAverage([
    ...items.map(item => item.confidenceScore),
    ...items.flatMap(item => item.components.map(component => component.confidenceScore)),
  ]);

  return {
    sheetName: rows[0]?.sheetName || '',
    rows,
    classifiedRows,
    detectedHeaderRow: headerRowNumber || null,
    columnMapping: mapping,
    parserVersion,
    totalRows: rows.length,
    parsedItems: items.length,
    parsedComponents,
    ignoredRows,
    warningCount,
    errorCount,
    confidenceScore,
    items,
    issues,
  };
};

const sheetPreview = (XLSX: any, name: string, sheet: any): G8SheetPreview => {
  const ref = sheet?.['!ref'];
  if (!ref) return { name, rowCount: 0, columnCount: 0 };
  const range = XLSX.utils.decode_range(ref);
  return {
    name,
    rowCount: range.e.r - range.s.r + 1,
    columnCount: range.e.c - range.s.c + 1,
  };
};

const sheetRows = (XLSX: any, sheetName: string, sheet: any): G8RawRow[] => {
  const ref = sheet?.['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rows: G8RawRow[] = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const values: string[] = [];
    const rawValues: Record<string, string> = {};
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = sheet[address];
      const text = cell?.w !== undefined ? String(cell.w) : cell?.v !== undefined ? String(cell.v) : '';
      values.push(text);
      if (text.trim()) rawValues[address] = text;
    }
    const text = compactText(values);
    if (text) rows.push({ sheetName, rowNumber: rowIndex + 1, values, rawValues, text });
  }
  return rows;
};

export const parseG8ExcelArrayBuffer = async (
  buffer: ArrayBuffer,
  options: G8ParseOptions = {},
): Promise<G8ParseResult> => {
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(buffer, { type: 'array', raw: false });
  const sheetName = options.sheetName && workbook.Sheets[options.sheetName]
    ? options.sheetName
    : workbook.SheetNames[0];
  const sheets = workbook.SheetNames.map(name => sheetPreview(XLSX, name, workbook.Sheets[name]));
  const rows = sheetRows(XLSX, sheetName, workbook.Sheets[sheetName]);
  const detected = options.columnMapping
    ? { rowNumber: detectHeader(rows).rowNumber, mapping: mergeMapping(options.columnMapping) }
    : detectHeader(rows);
  const parsed = parseG8Rows(rows, detected.mapping, detected.rowNumber, options.parserVersion || G8_PARSER_VERSION);
  return {
    ...parsed,
    fileName: options.fileName || '',
    fileSize: options.fileSize || buffer.byteLength,
    sheetName,
    sheets,
  };
};
