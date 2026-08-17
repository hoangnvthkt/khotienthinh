import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ExcelImportReviewModal from '../ExcelImportReviewModal';
import type { ExcelImportPreview } from '../../lib/excelImport';

const preview: ExcelImportPreview<Record<string, unknown>> = {
  mode: 'create',
  keyLabel: 'Mã SKU',
  rows: [],
  totalRows: 0,
  validRows: 0,
  errorRows: 0,
  duplicateRows: 0,
  missingRows: 0,
  conflictRows: 0,
  unchangedRows: 0,
  updateRows: 0,
  createRows: 0,
};

describe('ExcelImportReviewModal layering', () => {
  it('renders above the PO form modal layer', () => {
    const html = renderToStaticMarkup(
      <ExcelImportReviewModal
        title="Preview nhập mới dòng PO"
        preview={preview}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain('z-[1200]');
  });
});
