import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql=readFileSync(new URL('../../supabase/migrations/20260926113919_daily_log_source_quantity_entry_v2.sql',import.meta.url),'utf8');
describe('Whole source v2 quantity command boundary', () => {
  it('keeps the privileged implementation private and the public adapter invoker-only', () => {
    expect(sql).toContain('app_private.save_daily_log_source_document_impl_v2');
    expect(sql).toMatch(/create function public\.save_daily_log_source_document_v2[\s\S]*security invoker/);
    expect(sql).toContain('current_actor_has_effective_room_action');
    expect(sql).not.toMatch(/is_admin|user_metadata/);
  });
  it('validates version, baseline and forecast before atomic metadata/work/resource replacement', () => {
    expect(sql).toContain('ROW_VERSION_CONFLICT');
    expect(sql).toContain('SOURCE_CHANGED');
    expect(sql).toContain('FORECAST_CHANGE_REASON_REQUIRED');
    expect(sql).toContain('quantity_entry_mode');
    expect(sql).toContain('quantity_entered_value');
    expect(sql).toContain('source_fingerprint');
  });
  it('preserves unknown quantities, authenticates the actor and rejects monetary payloads', () => {
    expect(sql).toContain('DAILY_LOG_ENTRY_UNKNOWN_BASELINE');
    expect(sql).toContain('DAILY_LOG_ENTRY_QUANTITY_BASIS_REQUIRED');
    expect(sql).toContain('RESOURCE_PRICE_FIELDS_NOT_ALLOWED');
    expect(sql).toContain('current_app_user_id');
    expect(sql).not.toMatch(/greatest\([^;]+,\s*0\)/i);
  });
});
