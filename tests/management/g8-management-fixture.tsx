import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../../index.css';
import { PortfolioDashboardContent } from '../../pages/PortfolioDashboard';
import type { ManagementDatasetPage, ManagementViewId } from '../../lib/managementDataset';

const makePage = (viewId: ManagementViewId): ManagementDatasetPage => ({
  metricVersion: 'g8.management.dataset.v1',
  asOf: '2026-09-21T08:00:00.000Z', staleAfter: '2099-09-21T08:05:00.000Z',
  filter: { viewId }, capabilities: { canViewFinancials: true, canExport: true },
  options: { projects: [{ id: 'project-a', name: 'Khu phức hợp An Phú', constructionSiteId: 'site-a' }, { id: 'project-b', name: 'Nhà máy Bắc Ninh', constructionSiteId: 'site-b' }] },
  catalog: [
    { id: 'executive.intervention.count', viewId: 'M05', definitionVersion: '1.0.0', label: 'Dự án cần can thiệp', unit: 'record', currency: null, vatBasis: 'not_applicable', availability: 'available', unavailableReason: null },
    { id: 'executive.cost-forecast', viewId: 'M05', definitionVersion: '1.0.0', label: 'Dự báo chi phí', unit: 'currency', currency: null, vatBasis: 'mixed', availability: 'unavailable', unavailableReason: 'D13_COST_POLICY_NOT_AUTHORITATIVE' },
    { id: 'procurement.late-delivery.count', viewId: 'M02', definitionVersion: '1.0.0', label: 'Đợt giao trễ', unit: 'record', currency: null, vatBasis: 'not_applicable', availability: 'available', unavailableReason: null },
  ],
  totals: { rowCount: 2, criticalCount: 1, warningCount: 1, unknownCount: 1 },
  rows: viewId === 'M02' ? [{
    id: 'M02:delivery:1', viewId: 'M02', metricId: 'procurement.late-delivery.count', metricDefinitionVersion: '1.0.0', title: 'Đợt giao hàng đã quá ngày hẹn', description: 'PO-360 · NCC An Phát', severity: 'critical', projectId: 'project-a', constructionSiteId: 'site-a', projectName: 'Khu phức hợp An Phú', ownerId: 'buyer-1', ownerName: 'Nguyễn Minh', dueAt: '2026-09-19T00:00:00Z', value: 1, unit: 'record', currency: null, vatBasis: 'not_applicable', completeness: 'complete', qualityIssues: [], source: { type: 'purchase_delivery_batch', id: 'batch-1', label: 'PO-360-01', inferred: false }, drill: { type: 'purchase_order', id: 'po-1', path: '/da?tab=material' },
  }] : [
    { id: 'M05:project-a', viewId: 'M05', metricId: 'executive.intervention.count', metricDefinitionVersion: '1.0.0', title: 'Khu phức hợp An Phú', description: '4 việc cần can thiệp', severity: 'critical', projectId: 'project-a', constructionSiteId: 'site-a', projectName: 'Khu phức hợp An Phú', ownerId: null, ownerName: null, dueAt: '2026-09-19T00:00:00Z', value: 4, unit: 'record', currency: null, vatBasis: 'not_applicable', completeness: 'complete', qualityIssues: [], source: { type: 'management_dataset', id: 'project-a', label: 'Khu phức hợp An Phú', inferred: false }, drill: { type: 'project', id: 'project-a', path: '/da?projectId=project-a' } },
    { id: 'M05:project-b', viewId: 'M05', metricId: 'executive.intervention.count', metricDefinitionVersion: '1.0.0', title: 'Nhà máy Bắc Ninh', description: 'Nguồn kho đang đối soát', severity: 'warning', projectId: 'project-b', constructionSiteId: 'site-b', projectName: 'Nhà máy Bắc Ninh', ownerId: null, ownerName: null, dueAt: null, value: null, unit: 'record', currency: null, vatBasis: 'not_applicable', completeness: 'unknown', qualityIssues: ['SOURCE_NOT_COMPLETE'], source: { type: 'management_dataset', id: 'project-b', label: 'Nhà máy Bắc Ninh', inferred: false }, drill: { type: 'project', id: 'project-b', path: '/da?projectId=project-b' } },
  ],
  nextCursor: null,
});

const dataSource = {
  list: async (input: { viewId: ManagementViewId; search?: string }) => {
    if (input.search === 'slow') await new Promise(resolve => setTimeout(resolve, 250));
    const page = makePage(input.viewId);
    if (!input.search) return page;
    return {
      ...page,
      totals: { rowCount: 1, criticalCount: 1, warningCount: 0, unknownCount: 0 },
      rows: [{ ...page.rows[0], id: `search-${input.search}`, title: `Kết quả ${input.search}` }],
    };
  },
  listAllForExport: async (input: { viewId: ManagementViewId }) => makePage(input.viewId),
  invalidate: () => undefined,
  setActor: () => undefined,
  bindRealtimeInvalidation: () => () => undefined,
};

createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/da/portfolio?view=M05']}><main className="mx-auto max-w-[1600px] p-3 sm:p-6"><PortfolioDashboardContent actorId="g8-fixture-user" dataSource={dataSource as any} /></main></MemoryRouter>);
