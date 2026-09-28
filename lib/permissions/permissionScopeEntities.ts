import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import type { PermissionScopeType } from './permissionTypes';

// Named choices for permission scopes, so admins pick a project, site or
// warehouse instead of typing its id, and saved scopes read as names.

export interface PermissionScopeEntity {
  id: string;
  label: string;
}

export type PermissionScopeEntityMap = Partial<Record<PermissionScopeType, PermissionScopeEntity[]>>;

type EntitySource = {
  table: string;
  select: string;
  toEntity: (row: any) => PermissionScopeEntity;
};

const byName = (row: any): PermissionScopeEntity => ({ id: String(row.id), label: row.name || String(row.id) });
const withCode = (row: any): PermissionScopeEntity => ({
  id: String(row.id),
  label: row.code && row.name ? `${row.code} · ${row.name}` : row.name || row.code || String(row.id),
});

const ENTITY_SOURCES: Partial<Record<PermissionScopeType, EntitySource>> = {
  project: { table: 'projects', select: 'id,code,name', toEntity: withCode },
  construction_site: { table: 'hrm_construction_sites', select: 'id,name', toEntity: byName },
  warehouse: { table: 'warehouses', select: 'id,name', toEntity: byName },
  department: { table: 'org_units', select: 'id,code,name', toEntity: withCode },
  org_unit: { table: 'org_units', select: 'id,code,name', toEntity: withCode },
};

/** Scope types an admin chooses from a list (others have no picker yet). */
export const hasScopeEntityPicker = (scopeType: PermissionScopeType): boolean => Boolean(ENTITY_SOURCES[scopeType]);

let cached: Promise<PermissionScopeEntityMap> | null = null;

export const loadPermissionScopeEntities = (): Promise<PermissionScopeEntityMap> => {
  if (!cached) {
    const entries = Object.entries(ENTITY_SOURCES) as Array<[PermissionScopeType, EntitySource]>;
    cached = Promise.all(entries.map(async ([scopeType, source]) => {
      const { data, error } = await supabase.from(source.table).select(source.select).order('name').limit(2000);
      if (error) throw error;
      const entities = (data || []).map(source.toEntity).sort((a, b) => a.label.localeCompare(b.label, 'vi'));
      return [scopeType, entities] as const;
    }))
      .then(results => Object.fromEntries(results) as PermissionScopeEntityMap)
      .catch(error => {
        cached = null;
        throw error;
      });
  }
  return cached;
};

export const resetPermissionScopeEntityCache = () => {
  cached = null;
};

/** Readable name of a scope id; falls back to the id when unknown. */
export const getScopeEntityLabel = (
  entities: PermissionScopeEntityMap | null | undefined,
  scopeType: PermissionScopeType | string | undefined,
  scopeId: string | undefined,
): string => {
  if (!scopeId || scopeId === '*') return 'Tất cả';
  const match = entities?.[scopeType as PermissionScopeType]?.find(entity => entity.id === scopeId);
  return match?.label || scopeId;
};

export const usePermissionScopeEntities = () => {
  const [entities, setEntities] = useState<PermissionScopeEntityMap | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    loadPermissionScopeEntities()
      .then(result => {
        if (cancelled) return;
        setEntities(result);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => { cancelled = true; };
  }, [reload]);

  return { entities, state, retry: () => setReload(value => value + 1) };
};
