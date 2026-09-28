import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getInboxTabReasons,
  getNotificationInboxTab,
  NOTIFICATION_INBOX_TABS,
  NOTIFICATION_REASON_LABELS,
  type NotificationDeliveryReason,
} from '../notificationReasons';

const root = process.cwd();
const migrationName = readdirSync(join(root, 'supabase', 'migrations'))
  .find(name => name.endsWith('_notification_delivery_reason.sql'));
const migration = migrationName
  ? readFileSync(join(root, 'supabase', 'migrations', migrationName), 'utf8')
  : '';
const REASONS = Object.keys(NOTIFICATION_REASON_LABELS) as NotificationDeliveryReason[];

describe('notification delivery reason', () => {
  it('matches the reasons the database accepts', () => {
    expect(migrationName).toBeDefined();
    const check = migration.match(/check \(delivery_reason in \(([^)]*)\)\)/)?.[1] || '';
    expect(check.split(',').map(value => value.trim().replace(/'/g, '')).sort()).toEqual([...REASONS].sort());
    expect(migration).toContain('before insert on public.notifications');
    expect(migration).toContain('alter column delivery_reason set not null');
  });

  it('puts every reason in exactly one inbox tab', () => {
    const tabbed = NOTIFICATION_INBOX_TABS.flatMap(tab => tab.reasons || []);
    expect([...tabbed].sort()).toEqual([...REASONS].sort());
    for (const reason of REASONS) {
      expect(getInboxTabReasons(getNotificationInboxTab(reason))).toContain(reason);
    }
    expect(getInboxTabReasons('all')).toBeNull();
  });

  it('keeps assigned work and mentions together as "my work"', () => {
    expect(getNotificationInboxTab('assigned')).toBe('mine');
    expect(getNotificationInboxTab('mentioned')).toBe('mine');
    expect(getNotificationInboxTab(undefined)).toBe('watching');
  });

  it('reads the reason with every notification', () => {
    const service = readFileSync(join(root, 'lib', 'notificationService.ts'), 'utf8');
    expect(service).toMatch(/NOTIFICATION_LIST_SELECT = '[^']*delivery_reason/);
    expect(service).toContain("in('delivery_reason', reasons)");
  });
});
