import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ALERT_RULES } from '../notificationAlertRules';

const root = process.cwd();
const migrationName = readdirSync(join(root, 'supabase', 'migrations'))
  .find(name => name.endsWith('_notification_p2_2_server_scheduled_alerts_group2.sql'));
const migration = migrationName
  ? readFileSync(join(root, 'supabase', 'migrations', migrationName), 'utf8')
  : '';
const read = (file: string) => readFileSync(join(root, file), 'utf8');

describe('server scheduled alerts (P2.2 group 2)', () => {
  it('evaluates every alert rule on the server', () => {
    expect(migrationName).toBeDefined();
    for (const rule of DEFAULT_ALERT_RULES) {
      expect(migration).toContain(`alert_key = '${rule.alertKey}'`);
    }
  });

  it('maps project alerts to their Rooms and finance viewers', () => {
    expect(migration).toContain("alert_resolve_recipients(v_rule, 'finance'");
    expect(migration).toContain("alert_resolve_recipients(v_rule, 'gantt'");
    expect(migration).toContain("alert_resolve_recipients(v_rule, 'material_planning'");
    expect(migration).toContain("alert_resolve_recipients(v_rule, 'safety'");
    expect(migration).toContain("grant_row.domain = 'finance'");
    expect(migration).toContain("action.action_code in ('edit', 'submit', 'verify', 'approve', 'confirm')");
    expect(migration).toContain("upper(i.status) in ('PENDING', 'IN_PROGRESS')");
  });

  it('no longer scans or sends alerts from the browser', () => {
    const service = read('lib/notificationService.ts');
    expect(service).not.toContain('runAlertChecks');
    expect(service).not.toContain('localStorage');
    expect(service).not.toContain('notifyAlert(');
    expect(service).toContain("rpc('run_scheduled_alerts_now')");
    expect(read('lib/safetyService.ts')).not.toContain('notifyAlert');
    expect(read('components/NotificationCenter.tsx')).not.toContain('runAlertChecks');
  });

  it('defaults waste recipients to material planning editors', () => {
    const waste = DEFAULT_ALERT_RULES.find(rule => rule.alertKey === 'material_waste');
    expect(waste?.recipientConfig.projectPermissionCodes).toEqual(['edit']);
  });
});
