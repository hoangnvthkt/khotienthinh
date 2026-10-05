import { describe, expect, it } from 'vitest';
import {
  describeWorkflowFiles,
  formatWorkflowFileSize,
  getWorkflowFileKind,
  normalizeWorkflowFiles,
  packWorkflowFiles,
  type WorkflowFileValue,
} from '../workflowFiles';

const file = (fileName: string, extra: Partial<WorkflowFileValue> = {}): WorkflowFileValue => ({ fileName, storagePath: `p/${fileName}`, ...extra });

describe('normalizeWorkflowFiles', () => {
  it('reads the legacy single object, an array, and ignores everything else', () => {
    expect(normalizeWorkflowFiles(file('a.pdf')).map(item => item.fileName)).toEqual(['a.pdf']);
    expect(normalizeWorkflowFiles([file('a.pdf'), file('b.png')]).map(item => item.fileName)).toEqual(['a.pdf', 'b.png']);
    expect(normalizeWorkflowFiles('')).toEqual([]);
    expect(normalizeWorkflowFiles(null)).toEqual([]);
    // A table field value is an array of rows, never files.
    expect(normalizeWorkflowFiles([['VT01', '2'], ['VT02', '5']])).toEqual([]);
  });
});

describe('packWorkflowFiles', () => {
  it('keeps one file as an object, several as an array, none as empty string', () => {
    expect(packWorkflowFiles([])).toBe('');
    expect(packWorkflowFiles([file('a.pdf')])).toEqual(file('a.pdf'));
    expect(packWorkflowFiles([file('a.pdf'), file('b.pdf')])).toHaveLength(2);
  });
});

describe('getWorkflowFileKind', () => {
  it('uses the mime type from either field name, falling back to the extension', () => {
    expect(getWorkflowFileKind({ fileName: 'x', fileType: 'image/png' })).toBe('image');
    expect(getWorkflowFileKind({ fileName: 'x', mimeType: 'application/pdf' })).toBe('pdf');
    expect(getWorkflowFileKind({ fileName: 'Bảng kê.XLSX' })).toBe('excel');
    expect(getWorkflowFileKind({ fileName: 'hop-dong.docx' })).toBe('other');
  });
});

describe('display helpers', () => {
  it('formats sizes and summaries', () => {
    expect(formatWorkflowFileSize(512)).toBe('512 B');
    expect(formatWorkflowFileSize(65_300)).toBe('63.8 KB');
    expect(formatWorkflowFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatWorkflowFileSize(undefined)).toBe('');
    expect(describeWorkflowFiles([file('a.pdf')])).toBe('a.pdf');
    expect(describeWorkflowFiles([file('a.pdf'), file('b.pdf')])).toBe('2 tệp');
  });
});
