# Vehicle Booking Readable Details and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the main agent. Workspace policy prohibits sub-agents unless the user explicitly changes that policy. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace technical vehicle/driver IDs with business names in Booking details and enrich every Booking notification with requester, one-line purpose, driver, pickup, and destination.

**Architecture:** Supabase remains the canonical enrichment boundary. A scoped read RPC returns safe assignment presentation data, while one private notification-context helper feeds both outbox delivery paths and historical backfill. Frontend code consumes typed presentation models and one shared Booking notification component, without performing ad-hoc HRM/Asset joins.

**Tech Stack:** React 18, TypeScript 5.8, Vitest 4, Supabase PostgreSQL 17, Supabase JS 2, Tailwind utility classes, Supabase Cloud CLI workflow.

## Global Constraints

- Use Supabase Cloud configured by `.env`; do not use Supabase local or Docker.
- Create every schema change with `supabase migration new`; do not edit an applied migration.
- Public RPC wrappers must use `SECURITY INVOKER`; privileged implementations must stay in `app_private` with `search_path = ''`.
- Do not expose license data, private HRM fields, raw audit data, or technical UUIDs in the UI.
- Preserve canonical deep-links in the form `/booking/vehicle/my?booking=<uuid>`.
- Backfill existing Booking notifications without changing recipient, read state, timestamps, link/action URL, or sending another push.
- Do not use `--include-all` or `migration repair`.
- `supabase/.temp/cli-latest` must not be committed.
- Preserve unrelated user changes and stage only named files or reviewed hunks.
- Workspace policy prohibits sub-agents unless the user explicitly changes that policy; execute this plan inline by default.

---

## File Structure

### Existing completed driver-compatibility work to checkpoint first

- `lib/vehicleBookingService.ts` — existing driver/vehicle compatibility helpers and new feature service additions.
- `pages/booking/DispatcherWorkbenchPage.tsx` — existing compatible-driver filtering.
- `pages/booking/FleetDriversManagement.tsx` — existing Fleet-based driver type picker.
- `types/vehicleBooking.ts` — existing Fleet type and new assignment display types.
- `lib/__tests__/vehicleBookingOperationalRules.test.ts` — existing driver compatibility regression tests.
- `lib/__tests__/vehicleBookingFleetCompletion.test.ts` — existing Fleet type RPC contract tests.
- `supabase/migrations/20260812081545_vehicle_booking_driver_vehicle_compatibility.sql` — already applied Cloud migration that must be committed locally.

### New or extended files for this feature

- Create `lib/vehicleBookingPresentation.ts` — pure fulfillment and display-label helpers.
- Create `lib/vehicleBookingNotificationPresentation.ts` — normalize structured notification metadata into a safe view model.
- Create `components/VehicleBookingNotificationContent.tsx` — shared Booking notification body with the existing plain-message fallback for other categories or incomplete legacy metadata.
- Create `lib/__tests__/vehicleBookingPresentation.test.ts` — pure assignment label tests.
- Create `lib/__tests__/vehicleBookingNotificationPresentation.test.tsx` — view-model and server-rendered component tests.
- Modify `types/vehicleBooking.ts` — add `VehicleBookingAssignmentDisplay`.
- Modify `lib/vehicleBookingService.ts` — fetch the scoped assignment display RPC with booking details.
- Modify `lib/__tests__/vehicleBookingServiceContract.test.ts` — verify the new RPC boundary and response merge.
- Modify `pages/booking/MyVehicleBookingsPage.tsx` — display labels, asset identity, and driver identity instead of UUIDs.
- Modify `components/NotificationCenter.tsx` — render structured Booking content in the notification dropdown.
- Modify `pages/Notifications.tsx` — render the same structured content on the full notification page.
- Modify `lib/__tests__/vehicleBookingNotificationMigrationContract.test.ts` — locate the forward migration and check stable public/private boundaries.
- Create `supabase/tests/vehicle_booking_readable_notifications_smoke.sql` — transactional SQL assertions.
- Create via CLI one migration ending in `vehicle_booking_readable_details_notifications.sql` — RPC, delivery helper, both delivery paths, and backfill.

---

### Task 0: Checkpoint the Completed Driver Compatibility Fix

**Files:**
- Commit: `lib/vehicleBookingService.ts`
- Commit: `pages/booking/DispatcherWorkbenchPage.tsx`
- Commit: `pages/booking/FleetDriversManagement.tsx`
- Commit: `types/vehicleBooking.ts`
- Commit: `lib/__tests__/vehicleBookingOperationalRules.test.ts`
- Commit: `lib/__tests__/vehicleBookingFleetCompletion.test.ts`
- Commit: `supabase/migrations/20260812081545_vehicle_booking_driver_vehicle_compatibility.sql`

**Interfaces:**
- Consumes: current working tree produced by the prior approved fix.
- Produces: a clean, reviewable baseline commit before files shared with the new feature are edited again.

- [ ] **Step 1: Confirm only the known prior-fix files are dirty**

Run:

```bash
git status --short
git diff --check
```

Expected: the seven paths listed above are the only uncommitted prior implementation files; the design and plan documents are already committed separately.

- [ ] **Step 2: Re-run the focused prior-fix tests**

Run:

```bash
npx vitest run \
  lib/__tests__/vehicleBookingOperationalRules.test.ts \
  lib/__tests__/vehicleBookingFleetCompletion.test.ts
```

Expected: both files pass.

- [ ] **Step 3: Stage exactly the prior-fix files and inspect the index**

Run:

```bash
git add \
  lib/vehicleBookingService.ts \
  pages/booking/DispatcherWorkbenchPage.tsx \
  pages/booking/FleetDriversManagement.tsx \
  types/vehicleBooking.ts \
  lib/__tests__/vehicleBookingOperationalRules.test.ts \
  lib/__tests__/vehicleBookingFleetCompletion.test.ts \
  supabase/migrations/20260812081545_vehicle_booking_driver_vehicle_compatibility.sql
git diff --cached --check
git diff --cached --stat
```

Expected: no documentation or unrelated files are staged.

- [ ] **Step 4: Commit the checkpoint**

Run:

```bash
git commit -m "fix: align booking drivers with fleet vehicle types"
```

Expected: one local commit; do not push Git in this task.

---

### Task 1: Add Pure Assignment Presentation Rules

**Files:**
- Create: `lib/vehicleBookingPresentation.ts`
- Create: `lib/__tests__/vehicleBookingPresentation.test.ts`
- Modify: `types/vehicleBooking.ts`

**Interfaces:**
- Consumes: `FulfillmentType` from `types/vehicleBooking.ts`.
- Produces:
  - `VehicleBookingAssignmentDisplay`
  - `getVehicleFulfillmentLabel(type: FulfillmentType): string`
  - `getAssignedVehicleLabel(display?: VehicleBookingAssignmentDisplay | null): string`
  - `getAssignedDriverLabel(display?: VehicleBookingAssignmentDisplay | null): string`

- [ ] **Step 1: Write failing presentation tests**

Create `lib/__tests__/vehicleBookingPresentation.test.ts` with literal expectations:

```ts
import { describe, expect, it } from 'vitest';
import {
  getAssignedDriverLabel,
  getAssignedVehicleLabel,
  getVehicleFulfillmentLabel,
} from '../vehicleBookingPresentation';

describe('vehicle booking presentation', () => {
  it('translates fulfillment types into Vietnamese business labels', () => {
    expect(getVehicleFulfillmentLabel('INTERNAL_WITH_DRIVER'))
      .toBe('Xe nội bộ + tài xế chuyên trách');
    expect(getVehicleFulfillmentLabel('INTERNAL_SELF_DRIVE'))
      .toBe('Xe nội bộ + nhân viên tự lái');
    expect(getVehicleFulfillmentLabel('EXTERNAL_TRANSPORT'))
      .toBe('Xe ngoài / Taxi');
  });

  it('uses asset and HRM names without exposing IDs', () => {
    const display = {
      assignment_id: 'assignment-uuid',
      fulfillment_type: 'INTERNAL_WITH_DRIVER' as const,
      vehicle_code: 'TS-002',
      vehicle_name: 'Xe tải thùng',
      operator_name: 'Nguyễn Văn Hoàng',
    };
    expect(getAssignedVehicleLabel(display)).toBe('TS-002 · Xe tải thùng');
    expect(getAssignedDriverLabel(display)).toBe('Nguyễn Văn Hoàng');
  });

  it('uses external snapshots and safe missing-data labels', () => {
    expect(getAssignedVehicleLabel({
      assignment_id: 'external-assignment',
      fulfillment_type: 'EXTERNAL_TRANSPORT',
      external_provider_name: 'Mai Linh',
      external_vehicle_plate: '29A-123.45',
      external_driver_name: 'Trần Văn Bình',
    })).toBe('Mai Linh · 29A-123.45');
    expect(getAssignedDriverLabel({
      assignment_id: 'external-assignment',
      fulfillment_type: 'EXTERNAL_TRANSPORT',
      external_provider_name: 'Mai Linh',
    })).toBe('Theo nhà cung cấp');
    expect(getAssignedVehicleLabel(null)).toBe('Chưa có thông tin');
    expect(getAssignedDriverLabel(null)).toBe('Chưa có thông tin');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx vitest run lib/__tests__/vehicleBookingPresentation.test.ts
```

Expected: FAIL because `vehicleBookingPresentation.ts` and its exports do not exist.

- [ ] **Step 3: Add the typed assignment display contract**

Append to `types/vehicleBooking.ts`:

```ts
export interface VehicleBookingAssignmentDisplay {
  assignment_id: string;
  fulfillment_type: FulfillmentType;
  vehicle_code?: string | null;
  vehicle_name?: string | null;
  vehicle_image_url?: string | null;
  operator_name?: string | null;
  operator_title?: string | null;
  operator_avatar_url?: string | null;
  external_provider_name?: string | null;
  external_driver_name?: string | null;
  external_vehicle_plate?: string | null;
}
```

- [ ] **Step 4: Implement the minimal pure helpers**

Create `lib/vehicleBookingPresentation.ts`:

```ts
import type {
  FulfillmentType,
  VehicleBookingAssignmentDisplay,
} from '../types/vehicleBooking';

const fulfillmentLabels: Record<FulfillmentType, string> = {
  INTERNAL_WITH_DRIVER: 'Xe nội bộ + tài xế chuyên trách',
  INTERNAL_SELF_DRIVE: 'Xe nội bộ + nhân viên tự lái',
  EXTERNAL_TRANSPORT: 'Xe ngoài / Taxi',
};

export const getVehicleFulfillmentLabel = (type: FulfillmentType) =>
  fulfillmentLabels[type];

export function getAssignedVehicleLabel(
  display?: VehicleBookingAssignmentDisplay | null,
): string {
  if (!display) return 'Chưa có thông tin';
  const values = display.fulfillment_type === 'EXTERNAL_TRANSPORT'
    ? [display.external_provider_name, display.external_vehicle_plate]
    : [display.vehicle_code, display.vehicle_name];
  return values.filter(Boolean).join(' · ') || 'Chưa có thông tin';
}

export function getAssignedDriverLabel(
  display?: VehicleBookingAssignmentDisplay | null,
): string {
  if (!display) return 'Chưa có thông tin';
  if (display.fulfillment_type === 'EXTERNAL_TRANSPORT') {
    return display.external_driver_name || 'Theo nhà cung cấp';
  }
  return display.operator_name || 'Chưa có thông tin';
}
```

- [ ] **Step 5: Run the test and verify GREEN**

Run:

```bash
npx vitest run lib/__tests__/vehicleBookingPresentation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the pure presentation boundary**

Run:

```bash
git add \
  types/vehicleBooking.ts \
  lib/vehicleBookingPresentation.ts \
  lib/__tests__/vehicleBookingPresentation.test.ts
git commit -m "feat: add readable booking assignment presentation"
```

---

### Task 2: Add Structured Booking Notification Presentation

**Files:**
- Create: `lib/vehicleBookingNotificationPresentation.ts`
- Create: `components/VehicleBookingNotificationContent.tsx`
- Create: `lib/__tests__/vehicleBookingNotificationPresentation.test.tsx`

**Interfaces:**
- Consumes: `AppNotification` from `lib/notificationService.ts`.
- Produces:
  - `VehicleBookingNotificationView`
  - `getVehicleBookingNotificationView(notification): VehicleBookingNotificationView | null`
  - `<VehicleBookingNotificationContent notification />`

- [ ] **Step 1: Write failing view-model and render tests**

Create `lib/__tests__/vehicleBookingNotificationPresentation.test.tsx`:

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import VehicleBookingNotificationContent from '../../components/VehicleBookingNotificationContent';
import { getVehicleBookingNotificationView } from '../vehicleBookingNotificationPresentation';

const notification = {
  id: 'notification-1',
  type: 'info' as const,
  category: 'vehicle_booking',
  title: 'Đã xếp phương án chuyến xe',
  message: 'legacy message',
  isRead: false,
  isDismissed: false,
  severity: 'info' as const,
  metadata: {
    booking_code: 'CAR-260812-0003',
    requester_name: 'Nguyễn Văn Hoàng',
    purpose: 'Đi đàm phán hợp đồng dài cần rút gọn bằng giao diện',
    driver_name: 'Nguyễn Văn Hoàng',
    pickup_location: 'Văn phòng Hưng Yên',
    destination: 'Trụ sở Vioo ERP',
  },
  createdAt: '2026-08-12T09:33:00.000Z',
};

describe('vehicle booking notification presentation', () => {
  it('normalizes structured Booking metadata', () => {
    expect(getVehicleBookingNotificationView(notification)).toEqual({
      bookingCode: 'CAR-260812-0003',
      requesterName: 'Nguyễn Văn Hoàng',
      purpose: 'Đi đàm phán hợp đồng dài cần rút gọn bằng giao diện',
      driverName: 'Nguyễn Văn Hoàng',
      pickupLocation: 'Văn phòng Hưng Yên',
      destination: 'Trụ sở Vioo ERP',
    });
  });

  it('renders five labeled fields and a one-line purpose', () => {
    const html = renderToStaticMarkup(
      <VehicleBookingNotificationContent notification={notification} />,
    );
    expect(html).toContain('CAR-260812-0003');
    expect(html).toContain('Người đặt');
    expect(html).toContain('Nội dung');
    expect(html).toContain('Tài xế');
    expect(html).toContain('Điểm đi');
    expect(html).toContain('Điểm đến');
    expect(html).toContain('truncate');
  });

  it('returns no structured view for non-Booking notifications', () => {
    expect(getVehicleBookingNotificationView({
      ...notification,
      category: 'system',
      metadata: {},
    })).toBeNull();
  });

  it('keeps the plain message for non-Booking notifications', () => {
    const html = renderToStaticMarkup(
      <VehicleBookingNotificationContent notification={{
        ...notification,
        category: 'system',
        message: 'Bảo trì lúc 22:00',
        metadata: {},
      }} />,
    );
    expect(html).toContain('Bảo trì lúc 22:00');
  });

  it('falls back to the legacy message when Booking metadata is incomplete', () => {
    const html = renderToStaticMarkup(
      <VehicleBookingNotificationContent notification={{
        ...notification,
        message: 'Thông tin chuyến xe đang được cập nhật',
        metadata: { booking_code: 'CAR-260812-0003' },
      }} />,
    );
    expect(html).toContain('Thông tin chuyến xe đang được cập nhật');
    expect(html).not.toContain('Chưa có thông tin');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx vitest run lib/__tests__/vehicleBookingNotificationPresentation.test.tsx
```

Expected: FAIL because both production modules are missing.

- [ ] **Step 3: Implement the metadata normalizer**

Create `lib/vehicleBookingNotificationPresentation.ts` with this contract:

```ts
import type { AppNotification } from './notificationService';

export interface VehicleBookingNotificationView {
  bookingCode: string;
  requesterName: string;
  purpose: string;
  driverName: string;
  pickupLocation: string;
  destination: string;
}

const text = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

export function getVehicleBookingNotificationView(
  notification: Pick<AppNotification, 'category' | 'sourceType' | 'entityType' | 'metadata'>,
): VehicleBookingNotificationView | null {
  const isBooking = notification.category === 'vehicle_booking'
    || notification.sourceType === 'vehicle_booking'
    || notification.entityType === 'vehicle_booking';
  if (!isBooking) return null;
  const metadata = notification.metadata || {};
  const required = [
    metadata.booking_code ?? metadata.bookingCode,
    metadata.requester_name,
    metadata.purpose,
    metadata.driver_name,
    metadata.pickup_location,
    metadata.destination,
  ];
  if (required.some((value) => typeof value !== 'string' || !value.trim())) {
    return null;
  }
  return {
    bookingCode: text(metadata.booking_code ?? metadata.bookingCode, 'Booking xe'),
    requesterName: text(metadata.requester_name, 'Chưa có thông tin'),
    purpose: text(metadata.purpose, 'Chưa có nội dung'),
    driverName: text(metadata.driver_name, 'Chưa phân công'),
    pickupLocation: text(metadata.pickup_location, 'Chưa có thông tin'),
    destination: text(metadata.destination, 'Chưa có thông tin'),
  };
}
```

- [ ] **Step 4: Implement the shared component**

Create `components/VehicleBookingNotificationContent.tsx`. It must:

- Call `getVehicleBookingNotificationView` once.
- Render the existing plain `notification.message` when the notification is not Booking or its structured metadata is incomplete.
- Render the booking code as a muted subtitle.
- Render labels and values in a compact grid.
- Put the purpose value in an element with `truncate`, `min-w-0`, and a `title` containing the full purpose.
- Render pickup and destination as separate rows.
- Avoid rendering IDs from `sourceId`, `entityId`, or metadata.

Use this prop contract:

```tsx
type Props = {
  notification: Pick<
    AppNotification,
    'category' | 'sourceType' | 'entityType' | 'metadata' | 'message'
  >;
};
```

- [ ] **Step 5: Run the test and verify GREEN**

Run:

```bash
npx vitest run lib/__tests__/vehicleBookingNotificationPresentation.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the shared notification presentation**

Run:

```bash
git add \
  lib/vehicleBookingNotificationPresentation.ts \
  components/VehicleBookingNotificationContent.tsx \
  lib/__tests__/vehicleBookingNotificationPresentation.test.tsx
git commit -m "feat: add structured booking notification content"
```

---

### Task 3: Add the Scoped Assignment Display RPC and Notification Context Migration

**Files:**
- Create via CLI: the single file produced by `supabase migration new vehicle_booking_readable_details_notifications`
- Create: `supabase/tests/vehicle_booking_readable_notifications_smoke.sql`
- Modify: `lib/__tests__/vehicleBookingNotificationMigrationContract.test.ts`

**Interfaces:**
- Consumes:
  - `app_private.vehicle_user_can_view_booking(uuid, uuid)`
  - `public.current_app_user_id()`
  - existing outbox delivery functions and canonical notification trigger.
- Produces:
  - `public.get_vehicle_booking_assignment_display(p_booking_id uuid)`
  - `app_private.get_vehicle_booking_assignment_display_impl(p_actor_user_id uuid, p_booking_id uuid)`
  - `app_private.build_vehicle_booking_notification_context(p_booking_id uuid, p_assignment_id uuid, p_recipient_user_id uuid, p_event_type text)`
  - `app_private.insert_vehicle_booking_notification(p_outbox_id uuid)`
  - `app_private.backfill_vehicle_booking_notification_context()`

- [ ] **Step 1: Create the failing SQL smoke contract**

Create `supabase/tests/vehicle_booking_readable_notifications_smoke.sql` inside `begin`/`rollback`. The script must:

1. Resolve booking `CAR-260812-0003` and an active ADMIN fixture.
2. Set `request.jwt.claims` to that ADMIN's `auth_id` and `set local role authenticated`.
3. Call `public.get_vehicle_booking_assignment_display(booking_id)`.
4. Assert the result contains `TS-002`, `Xe tải thùng`, and `Nguyễn Văn Hoàng`.
5. Resolve or create an active outsider with an auth identity, switch to that authenticated claim, and assert the same RPC is denied without leaking booking data.
6. Assert no result column contains license number, license class, or authorization note.
7. As postgres, call `app_private.build_vehicle_booking_notification_context` for the current assignment and assert these exact keys exist: `booking_id`, `booking_code`, `event_type`, `requester_name`, `purpose`, `driver_name`, `pickup_location`, `destination`.
8. Create transactional fixtures covering all presentation branches and assert notification context resolves the correct driver for:
   - an internal vehicle with a dedicated driver;
   - an internal self-drive assignment;
   - an external provider/driver snapshot;
   - a booking without any assignment, which must produce `driver_name = 'Chưa phân công'`.
9. Create an old/new reassignment fixture and assert `BOOKING_REASSIGNED_OLD_OPERATOR` uses the superseded assignment belonging to the recipient, never the new active driver's name.
10. Exercise both delivery paths with transactional outbox rows: one claimed row through `deliver_vehicle_notification` under a service-role claim and one pending row through `process_vehicle_notification_outbox` as postgres. Assert both notifications contain the eight metadata keys, enriched `message`/`body`, canonical deep-link, and a `DELIVERED` outbox state.
11. Insert one transactional legacy Booking notification, snapshot its recipient, `is_read`, `created_at`, `link`, and `action_url`, call `app_private.backfill_vehicle_booking_notification_context()`, then assert those protected fields do not change, the row count remains the same, and the eight metadata fields are populated.
12. Assert `anon` has no execute privilege on the public RPC, `authenticated` does, and the three notification-only `app_private` helpers remain owner-only.

- [ ] **Step 2: Run the SQL smoke and verify RED**

Run against Supabase Cloud using the configured pooler and read credentials from `.env`:

```bash
set -a
source .env
set +a
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql \
  "host=aws-1-ap-southeast-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.ftciqmqhmfvjtwoycswe sslmode=require" \
  -v ON_ERROR_STOP=1 \
  -f supabase/tests/vehicle_booking_readable_notifications_smoke.sql
```

Expected: FAIL because the new public/private functions do not exist.

- [ ] **Step 3: Create the migration with Supabase CLI**

Run:

```bash
npx supabase migration new vehicle_booking_readable_details_notifications
```

Expected: one new file ending in `_vehicle_booking_readable_details_notifications.sql`. Record that exact path and use it for the remaining steps.

- [ ] **Step 4: Implement the scoped read RPC**

In the new migration:

- Start with `begin;` and end with `commit;`.
- Implement the private function with `STABLE`, `SECURITY DEFINER`, and `search_path = ''`.
- Reject actor mismatch using `p_actor_user_id is distinct from public.current_app_user_id()`.
- Reject access unless `app_private.vehicle_user_can_view_booking(p_actor_user_id, p_booking_id)` is true.
- Select only the active assignment.
- Join `assets` for `code`, `name`, and `image_url`.
- Join `employees` by `employee.user_id = assignment.operator_user_id` for name/title/avatar.
- Return the external provider, driver, and plate snapshots.
- Implement the public SQL wrapper as `STABLE SECURITY INVOKER` and pass `public.current_app_user_id()`.
- Revoke public/anon; grant the public wrapper only to `authenticated`.
- Revoke the private implementation from `public` and `anon`, then grant it to `authenticated` because a `SECURITY INVOKER` SQL wrapper executes nested calls with the caller's privileges. Its actor/session equality check and `vehicle_user_can_view_booking` remain the authorization boundary.

Use this exact return signature in both functions:

```sql
returns table (
  assignment_id uuid,
  fulfillment_type text,
  vehicle_code text,
  vehicle_name text,
  vehicle_image_url text,
  operator_name text,
  operator_title text,
  operator_avatar_url text,
  external_provider_name text,
  external_driver_name text,
  external_vehicle_plate text
)
```

- [ ] **Step 5: Implement one canonical notification-context helper**

Implement `app_private.build_vehicle_booking_notification_context` as `STABLE SECURITY DEFINER` with `search_path = ''` and this selection order:

1. Exact assignment matching both `p_booking_id` and `p_assignment_id` when supplied.
2. For `BOOKING_REASSIGNED_OLD_OPERATOR`, the most recently superseded assignment whose `operator_user_id = p_recipient_user_id`.
3. Otherwise, the active assignment.

Build JSONB with full values and these fallbacks:

```sql
jsonb_build_object(
  'booking_id', booking.id,
  'booking_code', booking.booking_code,
  'event_type', p_event_type,
  'requester_name', coalesce(
    nullif(trim(requester_employee.full_name), ''),
    nullif(trim(requester_user.name), ''),
    'Chưa có thông tin'
  ),
  'purpose', coalesce(nullif(trim(booking.purpose), ''), 'Chưa có nội dung'),
  'driver_name', coalesce(
    nullif(trim(selected_assignment.external_driver_name), ''),
    nullif(trim(driver_employee.full_name), ''),
    nullif(trim(driver_user.name), ''),
    'Chưa phân công'
  ),
  'pickup_location', coalesce(nullif(trim(booking.pickup_location_text), ''), 'Chưa có thông tin'),
  'destination', coalesce(nullif(trim(booking.destination_text), ''), 'Chưa có thông tin')
)
```

Do not include employee IDs, user IDs, asset IDs, license data, comments, or notes.

- [ ] **Step 6: Implement one private insert helper and route both workers through it**

Implement `app_private.insert_vehicle_booking_notification(p_outbox_id uuid) returns uuid`:

- Keep it owner-only: revoke it from `public`, `anon`, `authenticated`, and `service_role`. Both caller functions are `SECURITY DEFINER`, so neither the external worker nor cron needs direct access to this helper. Do not call `require_vehicle_notification_worker()` inside it because the cron batch path runs as the database owner rather than a JWT service-role session.
- Load the outbox row.
- Extract `booking_id` and optional `assignment_id` from payload using guarded UUID casts.
- Call `build_vehicle_booking_notification_context`.
- Build a compact legacy message in this exact field order:

```text
Người đặt: <requester> · Nội dung: <purpose> · Tài xế: <driver> · <pickup> → <destination>
```

- Use the complete purpose in metadata.
- Limit only the legacy message purpose segment to 80 characters and append `…` when longer.
- Insert into `public.notifications`, merging `outbox.payload`, the context JSON, and `eventKey`.
- Keep category/source/entity values as `vehicle_booking` so the existing canonical deep-link trigger remains authoritative.
- Return the inserted notification ID.

Replace the duplicated `insert into public.notifications` blocks in both:

- `app_private.deliver_vehicle_notification`
- `app_private.process_vehicle_notification_outbox`

Each path must call the insert helper and retain its existing locking, retry, delivery status, and error semantics.

`deliver_vehicle_notification` must retain its existing explicit worker check. `process_vehicle_notification_outbox` must remain callable only by its existing cron/database-owner boundary; do not broaden its grants.

- [ ] **Step 7: Implement idempotent historical backfill**

In the same migration, update existing `public.notifications` rows identified by any of:

- `category = 'vehicle_booking'`
- `source_type = 'vehicle_booking'`
- `entity_type = 'vehicle_booking'`

Implement `app_private.backfill_vehicle_booking_notification_context() returns bigint`. For each resolvable booking notification it must:

- Build context with metadata `assignment_id` when valid, otherwise the event-aware fallback.
- Merge context into metadata without removing existing keys.
- Set `message` and `body` to the compact legacy message.
- Do not update any other columns.
- Do not insert a row or touch the outbox.

Revoke this helper from `public`, `anon`, and `authenticated`. Call it once inside the migration after both delivery functions have been replaced. Keeping the operation behind a callable private helper makes the backfill idempotent and testable without resending notifications.

- [ ] **Step 8: Add Vitest migration boundary checks**

Extend `lib/__tests__/vehicleBookingNotificationMigrationContract.test.ts` so it finds the migration by suffix and asserts:

- the scoped public RPC exists and is `security invoker`;
- privileged helpers are in `app_private`;
- both delivery functions call `insert_vehicle_booking_notification`;
- the migration updates existing `public.notifications`;
- `anon` is revoked; `authenticated` can execute the public read RPC and its actor-bound private implementation, while notification helpers remain owner-only;
- the SQL includes all eight metadata keys and does not add license fields.

- [ ] **Step 9: Compile migration and run smoke in one rollback-only Cloud transaction**

Create a temporary combined stream that strips the migration's outer `begin`/`commit` and the smoke file's `begin`/`rollback`, surrounds both with one transaction, and pipes it to Cloud `psql`:

```bash
set -a
source .env
set +a
{
  printf 'begin;\n'
  awk 'tolower($0) !~ /^[[:space:]]*(begin|commit);[[:space:]]*$/' \
    supabase/migrations/*_vehicle_booking_readable_details_notifications.sql
  awk 'tolower($0) !~ /^[[:space:]]*(begin|rollback);[[:space:]]*$/' \
    supabase/tests/vehicle_booking_readable_notifications_smoke.sql
  printf 'rollback;\n'
} | PGPASSWORD="$SUPABASE_DB_PASSWORD" psql \
  "host=aws-1-ap-southeast-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.ftciqmqhmfvjtwoycswe sslmode=require" \
  -v ON_ERROR_STOP=1
```

Expected: all assertions pass and the final result is `ROLLBACK`; Cloud schema/data remain unchanged.

- [ ] **Step 10: Run the migration contract test**

Run:

```bash
npx vitest run lib/__tests__/vehicleBookingNotificationMigrationContract.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit database work**

Run:

```bash
git add \
  supabase/migrations/*_vehicle_booking_readable_details_notifications.sql \
  supabase/tests/vehicle_booking_readable_notifications_smoke.sql \
  lib/__tests__/vehicleBookingNotificationMigrationContract.test.ts
git commit -m "feat: enrich booking assignment and notification data"
```

---

### Task 4: Wire the Assignment Display RPC into Booking Details

**Files:**
- Modify: `lib/vehicleBookingService.ts`
- Modify: `lib/__tests__/vehicleBookingServiceContract.test.ts`
- Modify: `pages/booking/MyVehicleBookingsPage.tsx`

**Interfaces:**
- Consumes:
  - `public.get_vehicle_booking_assignment_display(p_booking_id uuid)` from Task 3.
  - presentation helpers from Task 1.
- Produces: `fetchVehicleBookingDetails()` result with `assignmentDisplay: VehicleBookingAssignmentDisplay | null`.

- [ ] **Step 1: Extend the service contract test first**

Update the Supabase mock so `rpc('get_vehicle_booking_assignment_display')` returns:

```ts
{
  data: [{
    assignment_id: 'assignment-1',
    fulfillment_type: 'INTERNAL_WITH_DRIVER',
    vehicle_code: 'TS-002',
    vehicle_name: 'Xe tải thùng',
    operator_name: 'Nguyễn Văn Hoàng',
  }],
  error: null,
}
```

Add a test that calls `fetchVehicleBookingDetails('booking-1')` and asserts:

```ts
expect(supabaseMocks.rpc).toHaveBeenCalledWith(
  'get_vehicle_booking_assignment_display',
  { p_booking_id: 'booking-1' },
);
expect(result.assignmentDisplay).toMatchObject({
  vehicle_code: 'TS-002',
  vehicle_name: 'Xe tải thùng',
  operator_name: 'Nguyễn Văn Hoàng',
});
```

- [ ] **Step 2: Run the service contract and verify RED**

Run:

```bash
npx vitest run lib/__tests__/vehicleBookingServiceContract.test.ts
```

Expected: FAIL because `fetchVehicleBookingDetails` does not call or return the display RPC.

- [ ] **Step 3: Add the RPC call to the existing detail fetch**

Modify `fetchVehicleBookingDetails` to:

- Add `VehicleBookingAssignmentDisplay` to its return type.
- Call `supabase.rpc('get_vehicle_booking_assignment_display', { p_booking_id: bookingId })` in the existing `Promise.all`.
- Throw when the display RPC returns an error.
- Return the first row or `null` as `assignmentDisplay`.

Do not remove the raw assignment list because trip execution and audit behavior still use it.

- [ ] **Step 4: Run the service contract and verify GREEN**

Run:

```bash
npx vitest run lib/__tests__/vehicleBookingServiceContract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Replace ID rendering in My Booking details**

In `pages/booking/MyVehicleBookingsPage.tsx`:

- Import the three helpers from `lib/vehicleBookingPresentation.ts`.
- Use `details.assignmentDisplay` for the active assignment card.
- Render:
  - `Hình thức: ${getVehicleFulfillmentLabel(activeAssignment.fulfillment_type)}`
  - `Xe phân công: ${getAssignedVehicleLabel(details.assignmentDisplay)}`
  - `Tài xế / Người lái: ${getAssignedDriverLabel(details.assignmentDisplay)}`
- Show the vehicle image when `vehicle_image_url` exists.
- Do not fallback to `vehicle_asset_id` or `operator_user_id` anywhere in this card.
- Keep external plate/provider information without duplicating the value already included in the vehicle label.

- [ ] **Step 6: Run focused tests and TypeScript**

Run:

```bash
npx vitest run \
  lib/__tests__/vehicleBookingPresentation.test.ts \
  lib/__tests__/vehicleBookingServiceContract.test.ts
npm run lint
```

Expected: all pass with no TypeScript errors.

- [ ] **Step 7: Commit detail integration**

Run:

```bash
git add \
  lib/vehicleBookingService.ts \
  lib/__tests__/vehicleBookingServiceContract.test.ts \
  pages/booking/MyVehicleBookingsPage.tsx
git commit -m "feat: show assigned vehicle and driver identities"
```

---

### Task 5: Use the Shared Booking Notification Content Everywhere

**Files:**
- Modify: `components/NotificationCenter.tsx`
- Modify: `pages/Notifications.tsx`
- Modify: `lib/__tests__/vehicleBookingNotificationPresentation.test.tsx`

**Interfaces:**
- Consumes: `<VehicleBookingNotificationContent notification />` from Task 2.
- Produces: matching structured notification UI in both dropdown and full page.

- [ ] **Step 1: Confirm the shared component covers both branches**

Run:

```bash
npx vitest run lib/__tests__/vehicleBookingNotificationPresentation.test.tsx
```

Expected: Booking structured content and non-Booking plain-message fallback both pass before the two trivial consumers are changed.

- [ ] **Step 2: Integrate the dropdown**

In `components/NotificationCenter.tsx`:

- Import `VehicleBookingNotificationContent`.
- Keep `n.title` as the title.
- Replace the current message paragraph with `<VehicleBookingNotificationContent notification={n} />`.
- Preserve unread styling, category badge, time, click behavior, and browser Notification API behavior.

- [ ] **Step 3: Integrate the full Notifications page**

In `pages/Notifications.tsx` apply the same conditional body. Keep the page title, severity/work-group badges, actions, and deep-link behavior unchanged.

- [ ] **Step 4: Run focused tests and lint**

Run:

```bash
npx vitest run lib/__tests__/vehicleBookingNotificationPresentation.test.tsx
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit notification UI integration**

Run:

```bash
git add \
  components/NotificationCenter.tsx \
  pages/Notifications.tsx \
  lib/__tests__/vehicleBookingNotificationPresentation.test.tsx
git commit -m "feat: display booking notification context"
```

---

### Task 6: Full Local Verification

**Files:**
- Verify all changed files; no new production files in this task.

**Interfaces:**
- Consumes: Tasks 0–5.
- Produces: release candidate validated before Cloud mutation.

- [ ] **Step 1: Run all Vitest suites**

Run:

```bash
npm test
```

Expected: every test passes with zero failures.

- [ ] **Step 2: Run TypeScript and production build**

Run:

```bash
npm run lint
npm run build
```

Expected: both exit successfully. Existing Vite chunk-size warnings are informational; no new error is acceptable.

- [ ] **Step 3: Check patch hygiene**

Run:

```bash
git status --short
git diff --check
git log -6 --oneline
```

Expected:

- no `supabase/.temp/cli-latest` change;
- no untracked build output;
- only intentional commits/files are present.

---

### Task 7: Curated Supabase Cloud Rollout and Postflight

**Files:**
- Apply: `supabase/migrations/*_vehicle_booking_readable_details_notifications.sql`
- Run: `supabase/tests/vehicle_booking_readable_notifications_smoke.sql`
- Run: `supabase/tests/vehicle_booking_phase1_smoke.sql`
- Run: `supabase/tests/vehicle_booking_phase3_smoke.sql`

**Interfaces:**
- Consumes: verified release candidate and `.env` Cloud credentials.
- Produces: one applied migration, enriched existing notification rows, live RPC, and postflight evidence.

- [ ] **Step 1: Check migration history and identify the new version**

Run:

```bash
set -a
source .env
set +a
npx supabase migration list --linked
```

Expected: no remote-only version. Historical local-only versions may remain and must not be pushed.

- [ ] **Step 2: Build a curated temporary Supabase workdir**

Use `mktemp -d`. Copy:

- `supabase/config.toml`;
- exactly one local migration file for every version returned by `supabase_migrations.schema_migrations`;
- the one new readable-details/notifications migration.

Validate `curated file count = remote ledger count + 1`. Stop if a remote version has zero or multiple matching local files.

- [ ] **Step 3: Link the curated workdir**

Run with the actual temporary path:

```bash
npx supabase --workdir "$ROLLOUT_DIR" link \
  --project-ref ftciqmqhmfvjtwoycswe \
  --password "$SUPABASE_DB_PASSWORD"
```

Expected: link succeeds.

- [ ] **Step 4: Run guarded dry-run**

Run:

```bash
npx supabase --workdir "$ROLLOUT_DIR" db push \
  --linked \
  --dry-run \
  --password "$SUPABASE_DB_PASSWORD"
```

Expected: exactly one migration, ending in `_vehicle_booking_readable_details_notifications.sql`. Stop on any other output.

- [ ] **Step 5: Push exactly the approved migration**

Run:

```bash
npx supabase --workdir "$ROLLOUT_DIR" db push \
  --linked \
  --password "$SUPABASE_DB_PASSWORD" \
  --yes
```

Expected: one migration applied successfully.

- [ ] **Step 6: Reload schema cache and run SQL smoke**

Run `notify pgrst, 'reload schema';` through Cloud `psql`, then:

```bash
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql \
  "host=aws-1-ap-southeast-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.ftciqmqhmfvjtwoycswe sslmode=require" \
  -v ON_ERROR_STOP=1 \
  -f supabase/tests/vehicle_booking_readable_notifications_smoke.sql
```

Expected: all assertions pass and the script rolls back its fixtures.

- [ ] **Step 7: Verify the real existing notification backfill**

Query the notification for `CAR-260812-0003` and assert:

- `metadata.requester_name = 'Nguyễn Văn Hoàng'`;
- `metadata.driver_name = 'Nguyễn Văn Hoàng'`;
- `metadata.pickup_location = 'Văn phòng Hưng Yên'`;
- destination and purpose are populated;
- title remains `Đã xếp phương án chuyến xe`;
- recipient, `is_read`, `created_at`, `link`, and `action_url` remain unchanged.

- [ ] **Step 8: Run regression smoke**

Run Phase 1 and Phase 3 SQL smoke against Cloud using `psql -v ON_ERROR_STOP=1`.

Expected: both pass. If either fails after migration, stop frontend release and fix with a forward migration; do not mark the applied migration as unapplied.

- [ ] **Step 9: Confirm final ledger and schema cache**

Run curated `db push --dry-run` again and call the public RPC as an authenticated allowed user.

Expected:

- `Remote database is up to date`;
- RPC returns `TS-002`, `Xe tải thùng`, and `Nguyễn Văn Hoàng` for `CAR-260812-0003`;
- an unauthorized user receives permission denied without booking data.

- [ ] **Step 10: Remove only the explicit temporary rollout directory**

Use `find "$ROLLOUT_DIR" -depth -delete` after first validating that the path starts with `/tmp/` and contains `vehicle-booking`. Do not delete repository files.

---

## Completion Checklist

- [ ] My Booking details contain no asset/user UUID fallback.
- [ ] Fulfillment type is a Vietnamese business label.
- [ ] Internal and external vehicle/driver labels are correct.
- [ ] Every Booking notification carries all eight canonical metadata keys.
- [ ] Purpose is visually one line with ellipsis and remains complete in metadata.
- [ ] Pre-assignment notifications say `Chưa phân công`.
- [ ] Old-operator reassignment notifications do not show the new driver's name.
- [ ] Dropdown and full Notifications page share one presentation component.
- [ ] Existing Booking notifications are backfilled without re-sending or changing read/link/timestamp state.
- [ ] RPC follows current booking visibility rules and exposes no sensitive fields.
- [ ] Full Vitest, TypeScript, build, new smoke, Phase 1 smoke, and Phase 3 smoke pass.
- [ ] Curated Cloud dry-run and postflight both report no pending migration.
- [ ] `supabase/.temp/cli-latest` is absent from all commits.
