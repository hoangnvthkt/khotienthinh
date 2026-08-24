import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = resolve(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(name => name.endsWith('_safety_card_readiness_completion.sql'));
const sql = migrationFile
  ? readFileSync(resolve(migrationDirectory, migrationFile), 'utf8').toLowerCase()
  : '';

const functionBody = (name: string): string => {
  const start = sql.indexOf(`create or replace function ${name}`);
  const end = sql.indexOf('create or replace function ', start + 1);
  return start < 0 ? '' : sql.slice(start, end < 0 ? sql.length : end);
};

describe('Safety card readiness completion migration', () => {
  it('defines a scoped manager-confirmed certificate command', () => {
    expect(migrationFile).toBeDefined();
    const privateBody = functionBody('app_private.upsert_safety_worker_certificate_for_site');
    const publicBody = functionBody('public.upsert_safety_worker_certificate_for_site');

    expect(privateBody).toContain('security definer');
    expect(privateBody).toContain("set search_path = ''");
    expect(privateBody).toContain('public.current_app_user_id()');
    expect(privateBody).toContain("status = 'approved'");
    expect(privateBody).toContain("'worker.certificate.upsert'");
    expect(publicBody).toContain('security invoker');
    expect(publicBody).toContain("set search_path = ''");
    expect(sql).toContain('revoke all on function public.upsert_safety_worker_certificate_for_site');
    expect(sql).toContain('grant execute on function public.upsert_safety_worker_certificate_for_site');
  });

  it('keeps active certificate options and canonical CCCD compatibility explicit', () => {
    expect(sql).toContain("'certificatetypes'");
    expect(sql).toContain('certificate_type.is_active');
    expect(sql).toContain("certificate.status in ('approved', 'submitted')");
    expect(sql).toContain("certificate.status not in ('rejected', 'revoked')");
    expect(sql).toContain("document.document_type in ('identity_front', 'identity_back')");
  });
});
