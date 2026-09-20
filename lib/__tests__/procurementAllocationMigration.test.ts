import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260920083241_procurement_quantity_allocation.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('procurement quantity allocation migration', () => {
  it('creates revision-bound allocations, signed attributions and an unallocated queue', () => {
    expect(sql).toContain('create table public.procurement_supply_allocations');
    expect(sql).toContain('create table public.procurement_fulfillment_attributions');
    expect(sql).toContain('create table public.procurement_unallocated_effects');
    expect(sql).toMatch(/source_revision_id uuid not null references public\.procurement_source_revisions/);
    expect(sql).toContain('reverses_attribution_id');
    expect(sql).toContain('canonical_effect_id');
  });

  it('locks and recalculates the authoritative balance before saving', () => {
    expect(sql).toContain('save_procurement_allocation_v1');
    expect(sql).toContain('for update');
    expect(sql).toContain('procurement_available_exceeded');
    expect(sql).toContain('source_revision_stale');
    expect(sql).toContain('material_request_line_need_closures');
  });

  it('prevents over-attribution and preserves explicit unknown legacy effects', () => {
    expect(sql).toContain('record_procurement_fulfillment_attribution_v1');
    expect(sql).toContain('procurement_effect_quantity_exceeded');
    expect(sql).toContain('list_procurement_unallocated_v1');
    expect(sql).toContain('legacy_identity_missing');
  });

  it('denies direct authenticated DML and pins private function search paths', () => {
    expect(sql).toMatch(/revoke all on public\.procurement_supply_allocations from public, anon, authenticated/);
    expect(sql).toMatch(/security definer set search_path = ''/);
    expect(sql).toMatch(/security invoker set search_path = ''/);
  });
});
