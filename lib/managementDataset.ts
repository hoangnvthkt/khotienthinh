export const MANAGEMENT_DATASET_VERSION = 'g8.management.dataset.v1' as const;

export type ManagementViewId = 'M01' | 'M02' | 'M03' | 'M04' | 'M05';
export type ManagementSeverity = 'critical' | 'warning' | 'info';
export type ManagementCompleteness = 'complete' | 'partial' | 'unknown';
export type ManagementVatBasis = 'not_applicable' | 'net' | 'gross' | 'mixed';

export interface ManagementMetricDefinition {
  id: string;
  viewId: ManagementViewId;
  definitionVersion: string;
  label: string;
  unit: string;
  currency: string | null;
  vatBasis: ManagementVatBasis;
  availability: 'available' | 'restricted' | 'unavailable';
  unavailableReason: string | null;
}

export interface ManagementDatasetSource {
  type: string;
  id: string;
  label: string;
  inferred: boolean;
}

export interface ManagementDatasetDrill {
  type: string;
  id: string;
  path: string;
}

export interface ManagementDatasetRow {
  id: string;
  viewId: ManagementViewId;
  metricId: string;
  metricDefinitionVersion: string;
  title: string;
  description?: string | null;
  severity: ManagementSeverity;
  projectId: string | null;
  constructionSiteId: string | null;
  projectName?: string | null;
  ownerId: string | null;
  ownerName: string | null;
  dueAt: string | null;
  value: number | null;
  unit: string;
  currency: string | null;
  vatBasis: ManagementVatBasis;
  completeness: ManagementCompleteness;
  qualityIssues: string[];
  source: ManagementDatasetSource;
  drill: ManagementDatasetDrill;
}

export interface ManagementSummary {
  rowCount: number;
  criticalCount: number;
  warningCount: number;
  unknownCount: number;
}

export interface ManagementDatasetFilter {
  viewId: ManagementViewId;
  projectId?: string;
  constructionSiteId?: string;
  warehouseId?: string;
  supplierId?: string;
  ownerId?: string;
  severity?: ManagementSeverity;
  search?: string;
}

export interface ManagementDatasetPage {
  metricVersion: typeof MANAGEMENT_DATASET_VERSION;
  asOf: string;
  staleAfter: string;
  filter: Record<string, unknown>;
  capabilities: { canViewFinancials: boolean; canExport: boolean };
  options: { projects: Array<{ id: string; name: string; constructionSiteId: string | null }> };
  catalog: ManagementMetricDefinition[];
  totals: ManagementSummary;
  rows: ManagementDatasetRow[];
  nextCursor: string | null;
}

export const buildManagementSummary = (rows: ManagementDatasetRow[]): ManagementSummary => ({
  rowCount: rows.length,
  criticalCount: rows.filter(row => row.severity === 'critical').length,
  warningCount: rows.filter(row => row.severity === 'warning').length,
  unknownCount: rows.filter(row => row.completeness !== 'complete' || row.value == null).length,
});

export const canAggregateMetricRows = (rows: ManagementDatasetRow[]): boolean => {
  if (rows.length < 2) return rows.every(row => row.completeness === 'complete' && row.value != null);
  const first = rows[0];
  return rows.every(row =>
    row.metricId === first.metricId
    && row.metricDefinitionVersion === first.metricDefinitionVersion
    && row.unit === first.unit
    && row.currency === first.currency
    && row.vatBasis === first.vatBasis
    && row.completeness === 'complete'
    && row.value != null
  );
};
