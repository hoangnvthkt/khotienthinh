import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ALERT_RULES } from '../notificationAlertRules';

const root = process.cwd();
const migrationName = readdirSync(join(root, 'supabase', 'migrations'))
  .find(name => name.endsWith('_notification_site_command_recipients.sql'));
const migration = migrationName
  ? readFileSync(join(root, 'supabase', 'migrations', migrationName), 'utf8')
  : '';

describe('site command (BCH) as alert recipients', () => {
  it('seeds BCH as the owner defined it: CHT, CHP and KTT positions', () => {
    expect(migrationName).toBeDefined();
    expect(migration).toContain("p.code in ('VT015', 'VT016', 'VT024', 'VT025', 'VT076')");
  });

  it('adds the site command only for rules that opt in, within the project', () => {
    expect(migration).toContain("(v_config ->> 'includeSiteCommand')::boolean");
    expect(migration).toContain('staff.project_id = p_project_id');
    expect(migration).toContain('staff.end_date is null');
  });

  it('lets only Admins change BCH or preview recipients', () => {
    expect(migration).toContain("raise exception 'SITE_COMMAND_ADMIN_REQUIRED'");
    expect(migration).toContain("raise exception 'ALERT_PREVIEW_ADMIN_REQUIRED'");
    expect(migration).toContain('revoke all on public.notification_site_command_positions from anon, authenticated');
    expect(migration).toContain("insert into public.audit_trail");
  });

  it('sends safety alerts to the Safety Room and site command, Admins only as fallback', () => {
    const safety = DEFAULT_ALERT_RULES.find(rule => rule.alertKey === 'safety_critical');
    expect(safety?.recipientConfig.includeSiteCommand).toBe(true);
    expect(safety?.recipientConfig.includeAdmins).toBe(false);
    expect(migration).toMatch(/"includeSiteCommand":true,"includeAdmins":false,"fallbackToAdmin":true}'::jsonb[\s\S]*where alert_key = 'safety_critical'/);
  });

  it('previews the rule as edited on screen', () => {
    const service = readFileSync(join(root, 'lib', 'notificationAlertRules.ts'), 'utf8');
    expect(service).toContain("rpc('preview_alert_recipients'");
    expect(service).toContain('p_recipient_config: recipientConfig');
  });
});
