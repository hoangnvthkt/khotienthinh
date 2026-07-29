import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('request notification delivery boundary', () => {
  it('claims bounded jobs, delivers atomically, and retries with a capped backoff', () => {
    const sql = readFileSync('supabase/migrations/20260729073147_request_notification_delivery_phase1.sql', 'utf8');
    expect(sql).toContain('for update skip locked');
    expect(sql).toContain('least(greatest(coalesce(p_limit, 50), 1), 50)');
    expect(sql).toContain('app_private.deliver_request_notification');
    expect(sql).toContain("least(3600, 60 * power(2");
  });

  it('keeps service-role delivery in the edge worker instead of the React bundle', () => {
    const source = readFileSync('supabase/functions/process-request-notifications/index.ts', 'utf8');
    expect(source).toContain("withSupabase({ auth: 'secret' }");
    expect(source).toContain("claim_request_notification_outbox");
    expect(source).toContain("deliver_request_notification");
    expect(source).toContain("searchParams.has('health')");
    expect(source).toContain("Unable to claim request notification jobs");
  });

  it('accepts the Vault-held secret key at the worker boundary without gateway JWT validation', () => {
    const config = readFileSync('supabase/config.toml', 'utf8');

    expect(config).toMatch(
      /\[functions\.process-request-notifications\][\s\S]*?verify_jwt\s*=\s*false/,
    );
  });
});
