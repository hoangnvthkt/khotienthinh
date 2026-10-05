/**
 * A file attached to a ticket, either through a "file" custom field or the description's
 * document list. Older tickets store a field's single file as an object; several files
 * are stored as an array of the same objects.
 */
export interface WorkflowFileValue {
  id?: string;
  fileName: string;
  fileType?: string;
  mimeType?: string;
  fileSize?: number;
  storageBucket?: string;
  storagePath?: string;
  /** Legacy base64 payload from before files moved to Storage. */
  data?: string;
  excelData?: Record<string, any[][]>;
  sheetNames?: string[];
}

export type WorkflowFileKind = 'image' | 'pdf' | 'excel' | 'other';

const isFile = (value: unknown): value is WorkflowFileValue =>
  typeof value === 'object' && value !== null && typeof (value as WorkflowFileValue).fileName === 'string' && Boolean((value as WorkflowFileValue).fileName);

/** Single legacy object, array of files or nothing (incl. table values, which never carry `fileName`). */
export const normalizeWorkflowFiles = (value: unknown): WorkflowFileValue[] => {
  if (Array.isArray(value)) return value.filter(isFile);
  return isFile(value) ? [value] : [];
};

/** One file stays a plain object so older readers keep working; several become an array. */
export const packWorkflowFiles = (files: WorkflowFileValue[]): WorkflowFileValue | WorkflowFileValue[] | '' =>
  files.length === 0 ? '' : files.length === 1 ? files[0] : files;

export const sameWorkflowFile = (a: WorkflowFileValue, b: WorkflowFileValue): boolean =>
  Boolean(a.storagePath && a.storagePath === b.storagePath) || a === b;

export const getWorkflowFileKind = (file: Pick<WorkflowFileValue, 'fileName' | 'fileType' | 'mimeType'>): WorkflowFileKind => {
  const mime = (file.fileType || file.mimeType || '').toLowerCase();
  const name = (file.fileName || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/.test(name)) return 'image';
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (/\.(xlsx|xls|csv)$/.test(name) || mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') return 'excel';
  return 'other';
};

export const formatWorkflowFileSize = (bytes?: number): string => {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/** Short text for cards and summaries: one name, or "n tệp". */
export const describeWorkflowFiles = (files: WorkflowFileValue[]): string =>
  files.length === 0 ? '' : files.length === 1 ? files[0].fileName : `${files.length} tệp`;
