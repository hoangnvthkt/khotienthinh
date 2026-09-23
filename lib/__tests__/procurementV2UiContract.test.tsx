import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ProcurementV2DossierList } from '../../components/procurement-v2/ProcurementV2DossierList';
import { ProcurementV2DemandLines } from '../../components/procurement-v2/ProcurementV2DemandLines';
import { ProcurementV2SupplyDialog } from '../../components/procurement-v2/ProcurementV2SupplyDialog';
import { ProcurementV2InboxContent } from '../../pages/procurement-v2/ProcurementV2Inbox';
import { parseProcurementV2Query, serializeProcurementV2Query } from '../procurement/procurementV2Query';
import type { ProcurementV2DossierCard, ProcurementV2DossierLine } from '../../types/procurementV2';

const plan: ProcurementV2DossierCard = { id: 'd1', sourceAdapter: 'material_plan',
  sourceCode: 'VT-01', sourceDocumentId: 'plan-1', projectId: 'p1', constructionSiteId: null,
  assigneeUserId: null, assigneeName: null, earliestNeededDate: '2026-10-08',
  destinationSummary: 'Công trường A', lineCount: 2, stage: 'plan_supply',
  nextAction: 'plan_supply', issueCount: 0, version: '1' };
const request = { ...plan, id: 'd2', sourceAdapter: 'project_material_request' as const,
  sourceCode: 'MR-01' };

describe('Procurement V2 first-use UI contract', () => {
  const shell = (state: 'ready' | 'loading' | 'denied' | 'error' | 'stale',
    items: ProcurementV2DossierCard[] = []) => renderToStaticMarkup(<MemoryRouter>
      <ProcurementV2InboxContent state={state} page={state === 'loading' ? null : {
        items, nextCursor: null, snapshotToken: 'hash', asOf: '2026-09-23', stale: false,
        counters: [{ key: 'dossiers', count: items.length, grain: 'document' }],
      }} filter={{}} projects={[]} onFilterChange={() => {}} onOpen={() => {}}
      onRefresh={() => {}} onMore={() => {}} /></MemoryRouter>);

  it('puts the buyer task and document count in the first viewport', () => {
    const html = shell('ready', [plan, request]);
    expect(html).toContain('Hồ sơ cần xử lý');
    expect(html).toContain('Kế hoạch vật tư và đề xuất vật tư đã được duyệt');
    expect(html).toContain('Đếm theo hồ sơ');
    expect(html).not.toContain('B/I/O/C');
  });

  it('distinguishes loading, denied, error, stale, and empty states', () => {
    expect(shell('loading')).toContain('Đang tải hồ sơ');
    expect(shell('denied')).toContain('chưa được cấp phạm vi');
    expect(shell('error')).toContain('Chưa tải được hồ sơ');
    expect(shell('stale')).toContain('Danh sách đã thay đổi');
    expect(shell('ready')).toContain('Chưa có hồ sơ cần xử lý');
  });

  it('shows one dossier action, business source badges and document counts', () => {
    const html = renderToStaticMarkup(<MemoryRouter><ProcurementV2DossierList
      dossiers={[plan, request]} onOpen={() => {}} /></MemoryRouter>);
    expect(html).toContain('Kế hoạch vật tư');
    expect(html).toContain('Đề xuất vật tư');
    expect(html.match(/Mở hồ sơ/g)).toHaveLength(2);
    expect(html).toContain('2 vật tư');
    expect(html).not.toContain('material_plan');
    expect(html).not.toContain('project_material_request');
    expect(html).not.toContain('d1');
  });

  it('keeps unknown quantities visible and names the buyer decision columns', () => {
    const line: ProcurementV2DossierLine = { id: 'line-1', sourceLineId: 'source-1',
      itemId: 'item-1', title: 'Xi măng', unit: 'kg', approvedQty: null,
      reservedQty: null, committedQty: null, fulfilledQty: null, closedQty: null,
      availableToPlanQty: null, neededDate: null, destinationId: null,
      balanceKnown: false, diagnostics: ['source_revision_unresolved'], documentRefs: [] };
    const html = renderToStaticMarkup(<ProcurementV2DemandLines lines={[line]} />);
    expect(html).toContain('Nhu cầu đã duyệt');
    expect(html).toContain('Đã bố trí');
    expect(html).toContain('Còn phải bố trí');
    expect(html).toContain('Cần đối chiếu');
    expect(html).not.toContain('>0<');
  });

  it('uses URL-owned filters and honest supply methods', () => {
    const query = parseProcurementV2Query('?search=xi&projectId=p1&source=material_plan&stage=reconcile&neededFrom=2026-10-01');
    expect(serializeProcurementV2Query(query).get('source')).toBe('material_plan');
    const html = renderToStaticMarkup(<ProcurementV2SupplyDialog open demandLabel="VT-01"
      canPurchase={false} onClose={() => {}} onPurchase={() => {}} />);
    for (const label of ['Cấp từ kho', 'Điều chuyển', 'Gọi theo hợp đồng', 'Mua theo PO'])
      expect(html).toContain(label);
    expect(html).toContain('Hồ sơ cần đối chiếu trước khi lập PO.');
  });
});
