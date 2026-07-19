import { isSupabaseConfigured, supabase } from '../supabase';
import type { PermissionScopeType } from './permissionTypes';

export interface PermissionScopeLookupOption {
  id: string;
  label: string;
  subtitle?: string;
  searchText: string;
}

export type LookupScopeType = Extract<PermissionScopeType, 'project' | 'construction_site' | 'warehouse' | 'department'>;

export type PermissionScopeLookupOptionsByType = Partial<Record<LookupScopeType, PermissionScopeLookupOption[]>>;

interface RawLookupRow {
  id?: string | null;
  code?: string | null;
  name?: string | null;
  clientName?: string | null;
  client_name?: string | null;
  type?: string | null;
}

export interface PermissionScopeLookupRowsInput {
  projects?: RawLookupRow[];
  warehouses?: RawLookupRow[];
  constructionSites?: RawLookupRow[];
  departments?: RawLookupRow[];
}

const compact = (values: Array<string | null | undefined>): string[] =>
  values.map(value => String(value || '').trim()).filter(Boolean);

const toOption = (
  row: RawLookupRow,
  subtitleValues: Array<string | null | undefined> = [],
): PermissionScopeLookupOption | null => {
  const id = String(row.id || '').trim();
  if (!id) return null;
  const code = String(row.code || '').trim();
  const name = String(row.name || '').trim();
  const label = compact([code, name]).join(' · ') || id;
  const subtitle = compact(subtitleValues)[0];

  return {
    id,
    label,
    subtitle,
    searchText: compact([id, code, name, subtitle]).join(' '),
  };
};

const mapRows = (
  rows: RawLookupRow[] | undefined,
  subtitle: (row: RawLookupRow) => Array<string | null | undefined> = () => [],
): PermissionScopeLookupOption[] => (rows || [])
  .map(row => toOption(row, subtitle(row)))
  .filter((option): option is PermissionScopeLookupOption => Boolean(option))
  .sort((left, right) => left.label.localeCompare(right.label, 'vi'));

export const mapPermissionScopeLookupRows = (
  input: PermissionScopeLookupRowsInput,
): PermissionScopeLookupOptionsByType => ({
  project: mapRows(input.projects, row => [row.clientName || row.client_name]),
  warehouse: mapRows(input.warehouses, row => [row.type]),
  construction_site: mapRows(input.constructionSites),
  department: mapRows(
    (input.departments || []).filter(row => !row.type || row.type === 'department'),
    row => [row.type],
  ),
});

const safeSelect = async (table: string, columns: string) => {
  const { data, error } = await supabase.from(table).select(columns);
  if (error) return [];
  return data || [];
};

export const permissionScopeLookupService = {
  async listLookupOptions(): Promise<PermissionScopeLookupOptionsByType> {
    if (!isSupabaseConfigured) return {};
    const [projects, warehouses, constructionSites, departments] = await Promise.all([
      safeSelect('projects', 'id,code,name,client_name'),
      safeSelect('warehouses', 'id,code,name,type'),
      safeSelect('hrm_construction_sites', 'id,code,name'),
      safeSelect('org_units', 'id,code,name,type'),
    ]);

    return mapPermissionScopeLookupRows({
      projects,
      warehouses,
      constructionSites,
      departments,
    });
  },
};
