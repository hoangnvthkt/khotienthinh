import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20260923083354_project_v2_cohort_visibility.sql', 'utf8').toLowerCase();

describe('Project V2 legacy-picker cohort visibility', () => {
  it('returns only requested active cohort IDs through a guarded RPC', () => {
    expect(sql).toContain('function public.list_project_v2_cohort_ids_v1');
    expect(sql).toContain('public.current_app_user_id()');
    expect(sql).toContain('w.project_id = any(p_project_ids)');
    expect(sql).toContain("lifecycle in ('pilot', 'active')");
    expect(sql).toContain('array_length(p_project_ids, 1) > 100');
  });
  it('adds compact project and site metadata to the scoped workspace read', () => {
    expect(sql).toContain('function public.list_project_v2_workspaces_v1');
    expect(sql).toContain('p.code as project_code');
    expect(sql).toContain('p.client_name');
    expect(sql).toContain('site.name as construction_site_name');
  });
});
