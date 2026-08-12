import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase/migrations');
const migrationName = readdirSync(migrationsDir)
  .find(name => name.endsWith('_vehicle_booking_phase3_public_rpc_hardening.sql'));
const sql = migrationName
  ? readFileSync(join(migrationsDir, migrationName), 'utf8').toLowerCase().replace(/\s+/g, ' ')
  : '';

const publicFunctions = [
  'get_vehicle_booking_analytics',
  'export_vehicle_booking_analytics',
  'get_vehicle_booking_issues',
  'get_vehicle_booking_audit_timeline',
] as const;

describe('vehicle booking phase 3 public RPC hardening', () => {
  it('moves privileged read implementations into app_private', () => {
    for (const functionName of publicFunctions) {
      expect(sql).toContain(`alter function public.${functionName}`);
      expect(sql).toContain('set schema app_private');
      expect(sql).toContain(`rename to ${functionName}_phase3_impl`);
    }
  });

  it('re-exposes stable public signatures only through security-invoker wrappers', () => {
    for (const functionName of publicFunctions) {
      const wrapper = sql.match(new RegExp(
        `create or replace function public\\.${functionName}[\\s\\S]+?\\$\\$;`,
      ))?.[0] || '';

      expect(wrapper).toContain('security invoker');
      expect(wrapper).not.toContain('security definer');
      expect(wrapper).toContain(`app_private.${functionName}_phase3_impl`);
    }
  });
});
