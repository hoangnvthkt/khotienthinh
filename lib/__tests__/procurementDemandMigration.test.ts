import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260920082411_procurement_revisioned_demand_intake.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('revisioned procurement demand migration', () => {
  it('creates one demand and immutable revision model over the shared source registry', () => {
    expect(sql).toContain('create table public.procurement_demands');
    expect(sql).toContain('create table public.procurement_demand_lines');
    expect(sql).toContain('create table public.procurement_demand_revisions');
    expect(sql).toMatch(/source_document_id uuid not null references public\.procurement_source_documents/);
    expect(sql).toMatch(/source_line_registry_id uuid not null references public\.procurement_source_line_registry/);
    expect(sql).toContain('source_changed');
    expect(sql).toContain('procurement_demand_revision_immutable');
  });

  it('implements strict idempotent intake and explicit source disposition', () => {
    expect(sql).toContain('create table app_private.procurement_commands');
    expect(sql).toContain('procurement_idempotency_conflict');
    expect(sql).toContain('source_revision_stale');
    expect(sql).toContain('sync_project_material_request_demand_v1');
    expect(sql).toContain('resolve_procurement_source_change_v1');
    expect(sql).toContain('accept_current_revision');
    expect(sql).toContain('p_expected_version');
  });

  it('derives actor, owner, scope and approval from server state', () => {
    expect(sql).toContain('public.current_app_user_id()');
    expect(sql).toContain("logical_key = 'company_default'");
    expect(sql).toContain('approved_content_revision is distinct from v_request.content_revision');
    expect(sql).toContain('approved_content_hash is distinct from v_request.content_hash');
    expect(sql).toContain("'material_request', 'view'");
    expect(sql).toContain("'material_po', 'edit'");
  });

  it('exposes only invoker wrappers and no direct authenticated DML', () => {
    expect(sql).toMatch(/create function public\.sync_project_material_request_demand_v1[\s\S]*security invoker[\s\S]*set search_path = ''/);
    expect(sql).toMatch(/revoke all on public\.procurement_demands from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.sync_project_material_request_demand_v1[^;]+to authenticated/);
  });
});
