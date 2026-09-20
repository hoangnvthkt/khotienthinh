import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260920081244_procurement_identity_revision_registry.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('procurement identity revision migration', () => {
  it('creates one typed owner and line registry with protected public tables', () => {
    expect(sql).toContain('create table public.procurement_owner_contexts');
    expect(sql).toContain('create table public.procurement_source_documents');
    expect(sql).toContain('create table public.procurement_source_line_registry');
    expect(sql).toContain('unique (source_document_id, source_line_id)');
    expect(sql).toMatch(/alter table public\.procurement_source_line_registry enable row level security/);
    expect(sql).toMatch(/revoke all on public\.procurement_source_line_registry from public, anon, authenticated/);
  });

  it('binds material request approval to a canonical content revision and hash', () => {
    expect(sql).toMatch(/alter table public\.requests[\s\S]*content_revision bigint[\s\S]*content_hash text[\s\S]*approved_content_revision bigint[\s\S]*approved_content_hash text/);
    expect(sql).toContain('procurement_project_request_content_hash');
    expect(sql).toContain('procurement_guard_project_request_revision');
    expect(sql).toContain("new.approved_content_revision := new.content_revision");
    expect(sql).toContain("new.approved_content_hash := new.content_hash");
    expect(sql).toContain("new.approved_content_revision := null");
  });

  it('synchronizes line identities in the same request transaction and blocks changed locked identities', () => {
    expect(sql).toContain('procurement_sync_project_request_registry');
    expect(sql).toContain('source_line_id_duplicate');
    expect(sql).toContain('source_line_identity_locked');
    expect(sql).toMatch(/create trigger trg_procurement_sync_project_request_registry[\s\S]*after insert or update/);
  });

  it('keeps private helpers private and pins every privileged search path', () => {
    const definers = [...sql.matchAll(/create(?: or replace)? function ([^(]+)\([^;]+?security definer[\s\S]*?\$\$;/g)];
    expect(definers.length).toBeGreaterThan(0);
    for (const definition of definers) expect(definition[0]).toContain("set search_path = ''");
    expect(sql).toMatch(/revoke all on function app_private\.procurement_project_request_content_hash\(jsonb\) from public, anon, authenticated/);
  });
});
