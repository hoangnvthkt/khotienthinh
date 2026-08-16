import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    rpc: supabaseMocks.rpc,
    from: supabaseMocks.from,
    auth: {
      getUser: supabaseMocks.getUser,
    },
  },
}));

import {
  approveVehicleBooking,
  cancelOperatorUnavailability,
  cancelVehicleBooking,
  cancelVehicleUnavailability,
  completeExternalTransport,
  confirmVehicleHandover,
  confirmVehicleReturn,
  createOperatorUnavailability,
  createVehicleBooking,
  createVehicleUnavailability,
  dispatchVehicleBooking,
  finishVehicleTrip,
  fetchMyBookings,
  fetchDriverTodayAssignments,
  fetchVehicleBookingDetails,
  markVehicleBookingNoShow,
  reassignVehicleBooking,
  recordVehicleTripCheckpoint,
  rejectVehicleBooking,
  replaceVehicleBookingParticipants,
  respondToVehicleAssignment,
  startVehicleTrip,
  submitVehicleBooking,
  submitVehicleFeedback,
  updateFleetSystemSettings,
  upsertDriverAuthorization,
  upsertFleetLocation,
  upsertFleetVehicleProfile,
} from '../vehicleBookingService';
import * as bookingServiceModule from '../vehicleBookingService';

const routingService = bookingServiceModule as typeof bookingServiceModule & {
  previewVehicleBookingSubmissionRoute?: () => Promise<{
    route: 'MANAGER' | 'CONFIG_DISABLED' | 'MISSING_MANAGER_CONFIRMATION_REQUIRED';
    managerUserId: string | null;
    dispatcherCount: number;
  }>;
  reassignVehicleBookingManager?: (input: {
    bookingId: string;
    managerUserId: string;
    reason: string;
    expectedUpdatedAt: string;
  }) => Promise<unknown>;
};

const callArgs = (name: string) =>
  supabaseMocks.rpc.mock.calls.find(([rpcName]) => rpcName === name)?.[1];

describe('vehicle booking RPC contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMocks.rpc.mockResolvedValue({ data: { success: true }, error: null });
    supabaseMocks.getUser.mockResolvedValue({
      data: { user: { id: 'auth-user-id' } },
      error: null,
    });
    supabaseMocks.order.mockResolvedValue({
      data: [{ id: 'booking-1', requester_user_id: 'app-user-id' }],
      error: null,
    });
    supabaseMocks.eq.mockReturnValue({ order: supabaseMocks.order });
    supabaseMocks.select.mockReturnValue({ eq: supabaseMocks.eq });
    supabaseMocks.from.mockReturnValue({ select: supabaseMocks.select });
  });

  it('filters personal bookings with the public app user id, not the auth id', async () => {
    const result = await fetchMyBookings('app-user-id');

    expect(result).toEqual([{ id: 'booking-1', requester_user_id: 'app-user-id' }]);
    expect(supabaseMocks.eq).toHaveBeenCalledWith('requester_user_id', 'app-user-id');
    expect(supabaseMocks.getUser).not.toHaveBeenCalled();
  });

  it('previews manager routing, confirms bypass, and reassigns with a stale-state token', async () => {
    expect(routingService.previewVehicleBookingSubmissionRoute).toBeTypeOf('function');
    expect(routingService.reassignVehicleBookingManager).toBeTypeOf('function');
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: {
        route: 'MANAGER',
        manager_user_id: 'manager-1',
        dispatcher_count: 1,
      },
      error: null,
    }).mockResolvedValueOnce({
      data: {
        success: true,
        status: 'PENDING_APPROVAL',
        manager_approval_route: 'MANAGER',
        manager_user_id: 'manager-1',
        dispatcher_count: 0,
      },
      error: null,
    });

    await expect(routingService.previewVehicleBookingSubmissionRoute!()).resolves.toEqual({
      route: 'MANAGER',
      managerUserId: 'manager-1',
      dispatcherCount: 1,
    });
    await expect(submitVehicleBooking('booking-1', {
      confirmMissingManagerBypass: true,
    })).resolves.toEqual({
      success: true,
      status: 'PENDING_APPROVAL',
      managerApprovalRoute: 'MANAGER',
      managerUserId: 'manager-1',
      dispatcherCount: 0,
    });
    await routingService.reassignVehicleBookingManager!({
      bookingId: 'booking-1',
      managerUserId: 'manager-2',
      reason: 'Thay đổi quản lý phụ trách',
      expectedUpdatedAt: '2026-08-15T01:00:00.000Z',
    });

    expect(callArgs('submit_vehicle_booking')).toEqual({
      p_booking_id: 'booking-1',
      p_confirm_missing_manager_bypass: true,
    });
    expect(callArgs('reassign_vehicle_booking_manager')).toEqual({
      p_booking_id: 'booking-1',
      p_manager_user_id: 'manager-2',
      p_reason: 'Thay đổi quản lý phụ trách',
      p_expected_updated_at: '2026-08-15T01:00:00.000Z',
    });
  });

  it('filters today trips with the public app user id, not the auth id', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      gte: vi.fn(),
      lt: vi.fn(),
      order: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.gte.mockReturnValue(query);
    query.lt.mockReturnValue(query);
    query.order.mockResolvedValue({ data: [], error: null });
    supabaseMocks.from.mockReturnValue(query);

    const result = await fetchDriverTodayAssignments('app-user-id');

    expect(result).toEqual([]);
    expect(query.eq).toHaveBeenCalledWith('operator_user_id', 'app-user-id');
    expect(query.gte).not.toHaveBeenCalled();
    expect(supabaseMocks.getUser).not.toHaveBeenCalled();
  });

  it('enriches today trips with readable vehicle and requester identities', async () => {
    const assignment = {
      id: 'assignment-1',
      booking_id: 'booking-1',
      operator_user_id: 'app-user-id',
      is_active: true,
    };
    const booking = {
      id: 'booking-1',
      booking_code: 'CAR-1',
      requester_user_id: 'requester-1',
      status: 'IN_PROGRESS',
    };
    const tripLog = {
      id: 'trip-1',
      booking_id: 'booking-1',
      trip_status: 'IN_PROGRESS',
    };

    supabaseMocks.from.mockImplementation((table: string) => {
      if (table === 'vehicle_booking_assignments') {
        const query: any = {};
        query.select = vi.fn().mockReturnValue(query);
        query.eq = vi.fn().mockReturnValue(query);
        query.gte = vi.fn().mockReturnValue(query);
        query.lt = vi.fn().mockReturnValue(query);
        query.order = vi.fn().mockResolvedValue({ data: [assignment], error: null });
        return query;
      }

      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: table === 'vehicle_bookings'
              ? [booking]
              : table === 'vehicle_trip_logs'
                ? [tripLog]
                : table === 'employees'
                  ? [{ user_id: 'requester-1', full_name: 'Nguyễn Văn An', avatar_url: 'employee.jpg' }]
                  : [{ id: 'requester-1', name: 'Admin An', avatar: 'requester.jpg' }],
            error: null,
          }),
        }),
      };
    });
    supabaseMocks.rpc.mockResolvedValue({
      data: [{
        assignment_id: 'assignment-1',
        fulfillment_type: 'INTERNAL_WITH_DRIVER',
        vehicle_code: 'TS-002',
        vehicle_name: 'Xe tải thùng',
      }],
      error: null,
    });

    const [result] = await fetchDriverTodayAssignments('app-user-id');

    expect(result.assignmentDisplay).toMatchObject({
      vehicle_code: 'TS-002',
      vehicle_name: 'Xe tải thùng',
    });
    expect(result.requester).toEqual({
      id: 'requester-1',
      name: 'Nguyễn Văn An',
      avatar: 'employee.jpg',
    });
  });

  it('loads readable assignment identity through the scoped display RPC', async () => {
    const rowsByTable: Record<string, { data: any; error: null }> = {
      vehicle_bookings: { data: { id: 'booking-1', booking_code: 'CAR-1' }, error: null },
      vehicle_booking_participants: { data: [], error: null },
      vehicle_booking_assignments: { data: [{ id: 'assignment-1', is_active: true }], error: null },
      vehicle_trip_logs: { data: null, error: null },
      vehicle_handover_logs: { data: [], error: null },
      vehicle_booking_feedback: { data: null, error: null },
    };

    supabaseMocks.from.mockImplementation((table: string) => ({
      select: () => ({
        eq: () => {
          const result = rowsByTable[table];
          if (table === 'vehicle_bookings') {
            return { single: vi.fn().mockResolvedValue(result) };
          }
          if (table === 'vehicle_trip_logs' || table === 'vehicle_booking_feedback') {
            return { maybeSingle: vi.fn().mockResolvedValue(result) };
          }
          if (table === 'vehicle_booking_assignments' || table === 'vehicle_handover_logs') {
            return { order: vi.fn().mockResolvedValue(result) };
          }
          return Promise.resolve(result);
        },
      }),
    }));
    supabaseMocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'get_vehicle_booking_assignment_display') {
        return {
          data: [{
            assignment_id: 'assignment-1',
            fulfillment_type: 'INTERNAL_WITH_DRIVER',
            vehicle_code: 'TS-002',
            vehicle_name: 'Xe tải thùng',
            operator_name: 'Nguyễn Văn Hoàng',
          }],
          error: null,
        };
      }
      return { data: { success: true }, error: null };
    });

    const result = await fetchVehicleBookingDetails('booking-1');

    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      'get_vehicle_booking_assignment_display',
      { p_booking_id: 'booking-1' },
    );
    expect(result.assignmentDisplay).toMatchObject({
      vehicle_code: 'TS-002',
      vehicle_name: 'Xe tải thùng',
      operator_name: 'Nguyễn Văn Hoàng',
    });
  });

  it('calls all 25 authenticated booking RPCs', async () => {
    supabaseMocks.rpc.mockImplementation(async (name: string) => ({
      data: name === 'submit_vehicle_booking'
        ? {
            success: true,
            status: 'PENDING_APPROVAL',
            manager_approval_route: 'MANAGER',
            manager_user_id: 'manager-1',
            dispatcher_count: 0,
          }
        : { success: true },
      error: null,
    }));

    await createVehicleBooking({
      requested_pickup_at: '2026-08-12T01:00:00.000Z',
      expected_return_at: '2026-08-12T03:00:00.000Z',
      trip_type: 'ROUND_TRIP',
      pickup_location_text: 'A',
      destination_text: 'B',
      purpose: 'Họp',
      passenger_count: 2,
      requested_mode: 'WITH_DRIVER',
    });
    await replaceVehicleBookingParticipants('booking-1', []);
    await submitVehicleBooking('booking-1');
    await approveVehicleBooking('booking-1');
    await rejectVehicleBooking('booking-1', 'Không phù hợp');
    await dispatchVehicleBooking({
      booking_id: 'booking-1',
      fulfillment_type: 'INTERNAL_WITH_DRIVER',
      vehicle_asset_id: 'CAR-1',
      operator_user_id: 'driver-1',
    });
    await reassignVehicleBooking({
      booking_id: 'booking-1',
      reassign_reason: 'Đổi xe',
      fulfillment_type: 'INTERNAL_WITH_DRIVER',
      vehicle_asset_id: 'CAR-2',
      operator_user_id: 'driver-2',
    });
    await respondToVehicleAssignment('booking-1', 'CONFIRMED');
    await confirmVehicleHandover('booking-1', 'OUTBOUND_HANDOVER');
    await recordVehicleTripCheckpoint('booking-1', 'DEPARTED_HOME_BASE');
    await startVehicleTrip({ booking_id: 'booking-1', start_odometer: 100, start_photo_path: 'booking-1/trips/start.jpg' });
    await finishVehicleTrip({ booking_id: 'booking-1', end_odometer: 120, end_photo_path: 'booking-1/trips/end.jpg' });
    await confirmVehicleReturn('booking-1');
    await completeExternalTransport({ booking_id: 'booking-1', external_actual_cost: 100_000 });
    await submitVehicleFeedback({ booking_id: 'booking-1', is_issue: false, rating: 5 });
    await cancelVehicleBooking('booking-1', 'Thay đổi kế hoạch');
    await markVehicleBookingNoShow('booking-1', 'Khách không xuất hiện');
    await upsertFleetVehicleProfile({
      asset_id: 'CAR-1',
      home_base_id: 'base-1',
      vehicle_type: 'SUV',
      seat_count: 7,
      availability_status: 'AVAILABLE',
      allow_self_drive: true,
    });
    await upsertDriverAuthorization({
      target_user_id: 'driver-1',
      authorization_type: 'PROFESSIONAL_DRIVER',
      license_number: 'B2-123',
      license_class: 'B2',
      license_expiry: '2027-08-12',
      status: 'ACTIVE',
    });
    await upsertFleetLocation({ location_id: 'base-1', name: 'Bãi chính', source_type: 'CUSTOM' });
    await createVehicleUnavailability({
      vehicle_asset_id: 'CAR-1',
      start_at: '2026-08-12T01:00:00.000Z',
      end_at: '2026-08-12T03:00:00.000Z',
      reason_code: 'MAINTENANCE',
    });
    await cancelVehicleUnavailability('vehicle-away-1', 'Kế hoạch thay đổi');
    await createOperatorUnavailability({
      operator_user_id: 'driver-1',
      start_at: '2026-08-12T01:00:00.000Z',
      end_at: '2026-08-12T03:00:00.000Z',
      reason_code: 'LEAVE',
    });
    await cancelOperatorUnavailability('operator-away-1', 'Đi làm lại');
    await updateFleetSystemSettings({
      booking_buffer_minutes: 30,
      late_cancellation_cutoff_minutes: 120,
      feedback_auto_close_hours: 24,
      home_base_warning_radius_meters: 500,
      on_time_tolerance_minutes: 15,
      max_evidence_image_mb: 5,
      trip_reminder_minutes: 60,
      require_handover_for_self_drive: true,
      allow_dispatch_approval_override: true,
      require_direct_manager_approval: true,
    });

    expect(supabaseMocks.rpc.mock.calls.map(([name]) => name).sort()).toEqual([
      'approve_vehicle_booking',
      'cancel_operator_unavailability',
      'cancel_vehicle_booking',
      'cancel_vehicle_unavailability',
      'complete_external_transport',
      'confirm_vehicle_handover',
      'confirm_vehicle_return',
      'create_operator_unavailability',
      'create_vehicle_booking',
      'create_vehicle_unavailability',
      'dispatch_vehicle_booking',
      'finish_vehicle_trip',
      'mark_vehicle_booking_no_show',
      'reassign_vehicle_booking',
      'record_vehicle_trip_checkpoint',
      'reject_vehicle_booking',
      'replace_vehicle_booking_participants',
      'respond_to_vehicle_assignment',
      'start_vehicle_trip',
      'submit_vehicle_booking',
      'submit_vehicle_feedback',
      'update_fleet_system_settings',
      'upsert_driver_authorization',
      'upsert_fleet_location',
      'upsert_fleet_vehicle_profile',
    ].sort());
  });

  it('uses the exact Cloud argument names for corrected command payloads', async () => {
    await rejectVehicleBooking('booking-1', 'Không phù hợp');
    await dispatchVehicleBooking({
      booking_id: 'booking-1',
      fulfillment_type: 'EXTERNAL_TRANSPORT',
      external_service_type: 'TAXI',
      external_provider_name: 'Mai Linh',
      override_reason: 'Khẩn cấp',
    });
    await reassignVehicleBooking({
      booking_id: 'booking-1',
      reassign_reason: 'Xe hỏng',
      fulfillment_type: 'INTERNAL_WITH_DRIVER',
      vehicle_asset_id: 'CAR-2',
      operator_user_id: 'driver-2',
    });
    await respondToVehicleAssignment('booking-1', 'DECLINED', 'Bị ốm');
    await recordVehicleTripCheckpoint('booking-1', 'PICKED_UP_PASSENGER');
    await completeExternalTransport({
      booking_id: 'booking-1',
      external_actual_cost: 125_000,
      external_receipt_path: 'booking-1/external/receipt.jpg',
      completion_note: 'Đã về',
    });
    await submitVehicleFeedback({
      booking_id: 'booking-1',
      is_issue: true,
      rating: 2,
      issue_category: 'LATE',
      comment: 'Xe đến muộn',
    });
    await cancelVehicleBooking('booking-1', 'Đổi kế hoạch');
    await markVehicleBookingNoShow('booking-1', 'Khách không đến');
    await upsertDriverAuthorization({
      target_user_id: 'driver-1',
      authorization_type: 'PROFESSIONAL_DRIVER',
      license_number: 'B2-123',
      license_class: 'B2',
      license_expiry: '2027-08-12',
      status: 'ACTIVE',
    });
    await cancelVehicleUnavailability('vehicle-away-1', 'Kế hoạch thay đổi');
    await cancelOperatorUnavailability('operator-away-1', 'Đi làm lại');

    expect(callArgs('reject_vehicle_booking')).toEqual({
      p_booking_id: 'booking-1',
      p_reject_reason: 'Không phù hợp',
    });
    expect(callArgs('dispatch_vehicle_booking')).not.toHaveProperty('p_external_currency');
    expect(callArgs('dispatch_vehicle_booking')).toMatchObject({
      p_booking_id: 'booking-1',
      p_override_reason: 'Khẩn cấp',
    });
    expect(callArgs('reassign_vehicle_booking')).toMatchObject({
      p_booking_id: 'booking-1',
      p_reassign_reason: 'Xe hỏng',
    });
    expect(callArgs('respond_to_vehicle_assignment')).toEqual({
      p_booking_id: 'booking-1',
      p_response: 'DECLINED',
      p_decline_reason: 'Bị ốm',
    });
    expect(callArgs('record_vehicle_trip_checkpoint')).toEqual({
      p_booking_id: 'booking-1',
      p_checkpoint_type: 'PICKED_UP_PASSENGER',
    });
    expect(callArgs('complete_external_transport')).toEqual({
      p_booking_id: 'booking-1',
      p_external_actual_cost: 125_000,
      p_external_receipt_path: 'booking-1/external/receipt.jpg',
      p_completion_note: 'Đã về',
    });
    expect(callArgs('submit_vehicle_feedback')).toEqual({
      p_booking_id: 'booking-1',
      p_is_issue: true,
      p_rating: 2,
      p_positive_tags: [],
      p_issue_category: 'LATE',
      p_comment: 'Xe đến muộn',
    });
    expect(callArgs('cancel_vehicle_booking')).toEqual({
      p_booking_id: 'booking-1',
      p_cancel_reason: 'Đổi kế hoạch',
    });
    expect(callArgs('mark_vehicle_booking_no_show')).toEqual({
      p_booking_id: 'booking-1',
      p_reason: 'Khách không đến',
    });
    expect(callArgs('upsert_driver_authorization')).not.toHaveProperty('p_authorization_id');
    expect(callArgs('cancel_vehicle_unavailability')).toEqual({
      p_unavailability_id: 'vehicle-away-1',
      p_reason: 'Kế hoạch thay đổi',
    });
    expect(callArgs('cancel_operator_unavailability')).toEqual({
      p_unavailability_id: 'operator-away-1',
      p_reason: 'Đi làm lại',
    });
  });
});
