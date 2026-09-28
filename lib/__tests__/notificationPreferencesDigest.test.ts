import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../notificationService';

const root = process.cwd();
const migrationName = readdirSync(join(root, 'supabase', 'migrations'))
  .find(name => name.endsWith('_notification_preferences_digest.sql'));
const migration = migrationName
  ? readFileSync(join(root, 'supabase', 'migrations', migrationName), 'utf8')
  : '';
const read = (file: string) => readFileSync(join(root, file), 'utf8');

describe('notification preferences and daily digest', () => {
  it('never lets business-area notices be muted', () => {
    expect(migrationName).toBeDefined();
    expect(migration).toContain("responsible_mode in ('instant', 'digest')");
    expect(migration).toContain("watching_mode in ('instant', 'digest', 'muted')");
  });

  it('keeps assigned work, mentions and critical notices instant', () => {
    expect(migration).toContain("coalesce(new.severity, 'info') <> 'critical'");
    expect(migration).toContain("new.delivery_reason in ('watching', 'responsible')");
  });

  it('sends one digest a day at the chosen time', () => {
    expect(migration).toContain("cron.schedule('notification-digests'");
    expect(migration).toContain('v_now::time >= p.digest_time');
    expect(migration).toContain("< v_now::date");
  });

  it('starts everyone on instant delivery', () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual({ watchingMode: 'instant', responsibleMode: 'instant', digestTime: '17:30' });
  });

  it('keeps digest notices off the bell badge and quiet', () => {
    expect(read('lib/notificationService.ts')).toContain(".eq('delivery_mode', 'instant')");
    expect(read('components/NotificationCenter.tsx')).toContain("n.deliveryMode !== 'instant'");
  });
});
