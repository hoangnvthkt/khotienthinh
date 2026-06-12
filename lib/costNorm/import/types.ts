export type CostNormResourceType = 'material' | 'labor' | 'machine' | 'adjustment' | 'other';
export type G8RowClassification = 'work_item' | 'group' | 'component' | 'ignored' | 'warning';
export type G8ImportIssueSeverity = 'info' | 'warning' | 'error';

export interface G8ColumnMapping {
  itemCodeCol: number;
  resourceCodeCol: number;
  nameCol: number;
  unitCol: number;
  coefficientCol: number;
}

export interface G8RawRow {
  sheetName: string;
  rowNumber: number;
  values: string[];
  rawValues: Record<string, string>;
  text: string;
}

export interface G8SheetPreview {
  name: string;
  rowCount: number;
  columnCount: number;
}

export interface G8ParseOptions {
  fileName?: string;
  fileSize?: number;
  sheetName?: string;
  columnMapping?: Partial<G8ColumnMapping>;
  parserVersion?: string;
}

export interface G8ImportIssue {
  sheetName: string;
  rowNumber: number;
  severity: G8ImportIssueSeverity;
  code: string;
  message: string;
  rawRow?: G8RawRow;
}

export interface ParsedNormComponent {
  id: string;
  itemCode: string;
  resourceCode: string;
  resourceName: string;
  resourceType: CostNormResourceType;
  unit: string;
  coefficient: number | null;
  lineIndex: number;
  sourceSheetName: string;
  sourceRowNumber: number;
  isAdjustment: boolean;
  note: string;
  rawData: Record<string, unknown>;
  confidenceScore: number;
  warnings: string[];
}

export interface ParsedNormItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  sourceSheetName: string;
  sourceRowStart: number;
  sourceRowEnd: number;
  searchText: string;
  rawData: Record<string, unknown>;
  confidenceScore: number;
  warnings: string[];
  components: ParsedNormComponent[];
}

export interface G8ParseResult {
  fileName: string;
  fileSize: number;
  sheetName: string;
  sheets: G8SheetPreview[];
  rows: G8RawRow[];
  detectedHeaderRow: number | null;
  columnMapping: G8ColumnMapping;
  parserVersion: string;
  totalRows: number;
  parsedItems: number;
  parsedComponents: number;
  ignoredRows: number;
  warningCount: number;
  errorCount: number;
  confidenceScore: number;
  items: ParsedNormItem[];
  issues: G8ImportIssue[];
}

export interface CostNormLibraryMetadata {
  name: string;
  code: string;
  source: string;
  version?: string;
  region?: string;
  decisionNo?: string;
  effectiveDate?: string;
  status?: 'draft' | 'active' | 'archived';
  description?: string;
}

export interface CostNormImportCommitResult {
  libraryId: string;
  importJobId: string;
  itemCount: number;
  componentCount: number;
  resourceCount: number;
  warningCount: number;
  errorCount: number;
}

export const DEFAULT_G8_COLUMN_MAPPING: G8ColumnMapping = {
  itemCodeCol: 0,
  resourceCodeCol: 1,
  nameCol: 2,
  unitCol: 3,
  coefficientCol: 4,
};

export const G8_PARSER_VERSION = 'g8-v1';
