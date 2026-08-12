import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260812000015_vehicle_booking_phase3_notification_links.sql';
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8').toLowerCase().replace(/\s+/g, ' ')
  : '';
const readableMigrationName = readdirSync('supabase/migrations')
  .find((name) => name.endsWith('_vehicle_booking_readable_details_notifications.sql'));
const readableMigration = readableMigrationName
  ? readFileSync(`supabase/migrations/${readableMigrationName}`, 'utf8').toLowerCase().replace(/\s+/g, ' ')
  : '';

describe('vehicle booking notification migration contract', () => {
  it('canonicalizes new and existing notification links at the database boundary', () => {
    expect(migration).toContain('canonicalize_vehicle_booking_notification');
    expect(migration).toContain("'/booking/vehicle/my?booking='");
    expect(migration).toContain('create trigger');
    expect(migration).toContain('update public.notifications');
  });

  it('adds the resolved-issue notification title', () => {
    expect(migration).toContain("when 'issue_resolved'");
  });

  it('adds an actor-bound security-invoker assignment display RPC', () => {
    expect(readableMigration).toContain('public.get_vehicle_booking_assignment_display');
    expect(readableMigration).toContain('app_private.get_vehicle_booking_assignment_display_impl');
    expect(readableMigration).toContain('security invoker');
    expect(readableMigration).toContain('vehicle_user_can_view_booking');
    expect(readableMigration).toContain('vehicle_actor_mismatch');
  });

  it('routes both notification delivery paths through one private helper', () => {
    expect(readableMigration).toContain('app_private.insert_vehicle_booking_notification');
    expect(readableMigration.match(/insert_vehicle_booking_notification/g)?.length).toBeGreaterThanOrEqual(3);
    expect(readableMigration).toContain('app_private.deliver_vehicle_notification');
    expect(readableMigration).toContain('app_private.process_vehicle_notification_outbox');
  });

  it('backfills canonical context without exposing sensitive driver fields', () => {
    for (const key of [
      'booking_id',
      'booking_code',
      'event_type',
      'requester_name',
      'purpose',
      'driver_name',
      'pickup_location',
      'destination',
    ]) {
      expect(readableMigration).toContain(`'${key}'`);
    }
    expect(readableMigration).toContain('backfill_vehicle_booking_notification_context');
    expect(readableMigration).toContain('update public.notifications');
    expect(readableMigration).not.toContain('license_number');
    expect(readableMigration).not.toContain('license_class');
    expect(readableMigration).not.toContain('authorization_note');
  });

  it('keeps notification helpers owner-only and exposes only the scoped read boundary', () => {
    expect(readableMigration).toContain(
      'grant execute on function public.get_vehicle_booking_assignment_display(uuid) to authenticated',
    );
    expect(readableMigration).toContain(
      'grant execute on function app_private.get_vehicle_booking_assignment_display_impl(uuid, uuid) to authenticated',
    );
    expect(readableMigration).toContain(
      'revoke all on function app_private.insert_vehicle_booking_notification(uuid) from public, anon, authenticated, service_role',
    );
    expect(readableMigration).toContain(
      'revoke all on function app_private.backfill_vehicle_booking_notification_context() from public, anon, authenticated, service_role',
    );
  });
});
