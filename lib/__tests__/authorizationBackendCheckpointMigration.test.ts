import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(dir)
  .filter(file => file.endsWith('_authorization_backend_checkpoint_hardening.sql'))
  .sort();
const sql = files.length === 1 ? readFileSync(join(dir, files[0]), 'utf8') : '';
const normalized = sql.replace(/\s+/g, ' ').trim();

describe('authorization backend checkpoint hardening migration', () => {
  it('treats every stored active direct grant as revokeable history', () => {
    expect(files).toHaveLength(1);
    expect(normalized).toMatch(/create or replace function app_private\.replace_user_permission_grants_v2_impl/i);
    expect(normalized).toMatch(/from public\.user_permission_grants grant_row where grant_row\.user_id = p_user_id and grant_row\.is_active;/i);
    expect(normalized).not.toMatch(/where grant_row\.user_id = p_user_id and grant_row\.is_active and \( grant_row\.expires_at is null or grant_row\.expires_at > now\(\) \)/i);
  });
});
