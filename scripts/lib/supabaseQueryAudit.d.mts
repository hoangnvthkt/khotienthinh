export type QueryClassification = 'page' | 'all_pages' | 'detail' | 'catalog' | 'count' | 'mutation_return' | null;

export interface QueryFinding {
  fingerprint: string;
  file: string;
  line: number;
  table: string;
  projection: string;
  modifiers: string[];
  classification: QueryClassification;
  owner: string | null;
  rule: 'wildcard-list' | 'missing-result-policy';
  severity: 'error';
}

export interface QueryAuditReport {
  version: number;
  summary: {
    findings: number;
    errors: number;
    wildcardLists: number;
    missingResultPolicies: number;
    unclassified: number;
  };
  findings: QueryFinding[];
}

export function analyzeSource(source: string, filePath: string): QueryFinding[];
export function scanWorkspace(rootDir: string, policy?: { allowlist?: Array<Record<string, unknown>> }): QueryAuditReport;

