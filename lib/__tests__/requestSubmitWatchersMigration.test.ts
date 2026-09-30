import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260930200000_request_submit_watchers.sql'), 'utf8');

describe('request submit watchers migration', () => {
  it('keeps six-argument submit calls working through a defaulted p_options', () => {
    expect(sql).toContain('drop function if exists public.submit_request(uuid, text, text, jsonb, jsonb, text);');
    expect(sql).toMatch(/public\.submit_request\([\s\S]*?p_options jsonb default '\{\}'::jsonb/);
    expect(sql).toContain('grant execute on function public.submit_request(uuid, text, text, jsonb, jsonb, text, jsonb) to authenticated;');
    expect(sql).toContain('revoke all on function public.submit_request(uuid, text, text, jsonb, jsonb, text, jsonb) from public, anon;');
  });

  it('validates and registers submit-time watchers without touching approval routing', () => {
    expect(sql).toContain('REQUEST_WATCHER_INVALID');
    expect(sql).toContain("'WATCHER', 'request_manual', v_actor::text");
    expect(sql).not.toContain('__extra');
    expect(sql).not.toMatch(/function app_private\.act_on_request/);
  });

  it('exposes flow mode and fixed approvers so the create form can show the ordered flow', () => {
    expect(sql).toContain("'flowMode', version.flow_mode");
    expect(sql).toContain("'fixedApprovers'");
  });
});
