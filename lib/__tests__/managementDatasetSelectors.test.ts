import { describe, expect, it } from 'vitest';
import {
  buildManagementSummary,
  canAggregateMetricRows,
  type ManagementDatasetRow,
} from '../managementDataset';

const row = (input: Partial<ManagementDatasetRow> = {}): ManagementDatasetRow => ({
  id: 'row-1',
  viewId: 'M01',
  metricId: 'project.material-risk.count',
  metricDefinitionVersion: '1.0.0',
  title: 'Thiếu vật tư',
  severity: 'critical',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  ownerId: null,
  ownerName: null,
  dueAt: null,
  value: 1,
  unit: 'record',
  currency: null,
  vatBasis: 'not_applicable',
  completeness: 'complete',
  qualityIssues: [],
  source: { type: 'project_task', id: 'task-1', label: 'Task 1', inferred: false },
  drill: { type: 'project_task', id: 'task-1', path: '/da' },
  ...input,
});

describe('management dataset selectors', () => {
  it('counts complete exception records without summing business quantities', () => {
    const summary = buildManagementSummary([
      row(),
      row({ id: 'row-2', severity: 'warning', metricId: 'procurement.delivery-late.count' }),
      row({ id: 'row-3', severity: 'info', completeness: 'unknown', value: null }),
    ]);

    expect(summary).toEqual({ rowCount: 3, criticalCount: 1, warningCount: 1, unknownCount: 1 });
  });

  it('rejects aggregation across incompatible metric, UOM, currency, VAT, or completeness', () => {
    expect(canAggregateMetricRows([row(), row({ id: 'row-2' })])).toBe(true);
    expect(canAggregateMetricRows([row(), row({ metricId: 'other' })])).toBe(false);
    expect(canAggregateMetricRows([row(), row({ unit: 'kg' })])).toBe(false);
    expect(canAggregateMetricRows([
      row({ unit: 'VND', currency: 'VND', vatBasis: 'gross' }),
      row({ unit: 'USD', currency: 'USD', vatBasis: 'gross' }),
    ])).toBe(false);
    expect(canAggregateMetricRows([row(), row({ completeness: 'unknown', value: null })])).toBe(false);
  });
});
