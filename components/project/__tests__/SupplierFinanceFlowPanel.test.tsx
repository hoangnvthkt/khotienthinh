import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SupplierFinanceFlowPanel } from '../SupplierFinanceFlowPanel';

describe('SupplierFinanceFlowPanel', () => {
  it('keeps unknown valuation visible instead of rendering zero', () => {
    const html = renderToStaticMarkup(<SupplierFinanceFlowPanel loading={false} error={null} onRetry={() => undefined} snapshot={{
      asOf: '2026-09-21T00:00:00Z', projectId: 'p-1', authoritative: false,
      issues: ['CONSUMPTION_VALUATION_SOURCE_MISSING'],
      layers: [{ layer: 'consumption', amount: null, currency: 'VND', completeness: 'unknown', source: 'inventory_ledger_entries', documentCount: 2, issues: ['VALUATION_SOURCE_MISSING'] }],
    }} />);
    expect(html).toContain('Chưa xác định');
    expect(html).toContain('Một số bút toán tiêu hao thiếu nguồn giá');
    expect(html).not.toContain('CONSUMPTION_VALUATION_SOURCE_MISSING');
    expect(html).not.toContain('>0 ₫<');
  });

  it('renders denied/error independently from the main finance workspace', () => {
    const html = renderToStaticMarkup(<SupplierFinanceFlowPanel loading={false} error="Không có quyền xem giá trị kho." snapshot={null} onRetry={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Không có quyền xem giá trị kho.');
  });
});
