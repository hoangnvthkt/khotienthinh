import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Car, User, Clock, AlertTriangle, ShieldCheck, RefreshCw, Send, Check, Layers, ChevronRight } from 'lucide-react';
import {
  fetchWaitingDispatchBookings,
  fetchFleetVehicleProfiles,
  fetchFleetLocations,
  fetchDriverAuthorizationsEligible,
  fetchFleetSystemSettings,
  dispatchVehicleBooking,
  formatVietnamDateTime,
  getDispatchValidationError,
  getDispatchErrorMessage,
  isDriverCompatibleWithVehicle,
  selectCompatibleProfessionalDrivers,
  getOperatorOperationalStatus,
  getVehicleOperationalStatus,
} from '../../lib/vehicleBookingService';
import type {
  VehicleBooking,
  FleetLocation,
  FleetVehicleProfileView,
  VehicleDriverAuthorizationEligible,
  FulfillmentType
} from '../../types/vehicleBooking';
import { useToast } from '../../context/ToastContext';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';

const DispatcherWorkbenchPage: React.FC = () => {
  const toast = useToast();
  const { user } = useApp();
  const [loading, setLoading] = useState(true);
  const [waitingBookings, setWaitingBookings] = useState<VehicleBooking[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicleProfileView[]>([]);
  const [locations, setLocations] = useState<FleetLocation[]>([]);
  const [drivers, setDrivers] = useState<VehicleDriverAuthorizationEligible[]>([]);
  const [busyVehicleIds, setBusyVehicleIds] = useState<Set<string>>(new Set());
  const [busyOperatorIds, setBusyOperatorIds] = useState<Set<string>>(new Set());
  const [unavailableVehicleIds, setUnavailableVehicleIds] = useState<Set<string>>(new Set());
  const [unavailableOperatorIds, setUnavailableOperatorIds] = useState<Set<string>>(new Set());

  // Drag & Drop State
  const [draggedItem, setDraggedItem] = useState<{ type: 'VEHICLE' | 'DRIVER'; id: string } | null>(null);

  // Dispatch Drawer State
  const [selectedBooking, setSelectedBooking] = useState<VehicleBooking | null>(null);
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>('INTERNAL_WITH_DRIVER');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [selectedDriverUserId, setSelectedDriverUserId] = useState('');
  const [handoverOfficerUserId, setHandoverOfficerUserId] = useState('');
  const [allowNonHomeBaseReturn, setAllowNonHomeBaseReturn] = useState(false);
  const [nonHomeBaseReason, setNonHomeBaseReason] = useState('');
  const [dispatchReasonCode, setDispatchReasonCode] = useState('NORMAL');
  const [assignmentNote, setAssignmentNote] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [allowDispatchOverride, setAllowDispatchOverride] = useState(true);

  // External Transport Fields
  const [externalServiceType, setExternalServiceType] = useState('TAXI');
  const [externalProviderName, setExternalProviderName] = useState('Mai Linh Taxi');
  const [externalDriverName, setExternalDriverName] = useState('');
  const [externalDriverPhone, setExternalDriverPhone] = useState('');
  const [externalVehiclePlate, setExternalVehiclePlate] = useState('');
  const [externalEstimatedCost, setExternalEstimatedCost] = useState<number | ''>('');

  const [dispatching, setDispatching] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const nowIso = new Date().toISOString();
      const [bList, vList, dList, locationList, fleetSettings, activeAssignments, vehicleBlocks, operatorBlocks] = await Promise.all([
        fetchWaitingDispatchBookings(),
        fetchFleetVehicleProfiles(),
        fetchDriverAuthorizationsEligible(),
        fetchFleetLocations(),
        fetchFleetSystemSettings(),
        supabase
          .from('vehicle_booking_assignments')
          .select('vehicle_asset_id, operator_user_id')
          .eq('is_active', true)
          .lte('reserved_start_at', nowIso)
          .gt('reserved_end_at', nowIso),
        supabase
          .from('vehicle_unavailability_periods')
          .select('vehicle_asset_id')
          .lte('start_at', nowIso)
          .gt('end_at', nowIso),
        supabase
          .from('operator_unavailability_periods')
          .select('operator_user_id')
          .lte('start_at', nowIso)
          .gt('end_at', nowIso),
      ]);
      if (activeAssignments.error) throw activeAssignments.error;
      if (vehicleBlocks.error) throw vehicleBlocks.error;
      if (operatorBlocks.error) throw operatorBlocks.error;
      setWaitingBookings(bList);
      setVehicles(vList);
      setDrivers(dList);
      setLocations(locationList);
      setAllowDispatchOverride(fleetSettings.allow_dispatch_approval_override);
      setBusyVehicleIds(new Set((activeAssignments.data || []).flatMap(row => row.vehicle_asset_id ? [row.vehicle_asset_id] : [])));
      setBusyOperatorIds(new Set((activeAssignments.data || []).flatMap(row => row.operator_user_id ? [row.operator_user_id] : [])));
      setUnavailableVehicleIds(new Set((vehicleBlocks.data || []).map(row => row.vehicle_asset_id)));
      setUnavailableOperatorIds(new Set((operatorBlocks.data || []).map(row => row.operator_user_id)));
    } catch (err: any) {
      toast.error('Không thể tải dữ liệu Bảng điều phối!');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 15000);
    const channel = supabase
      .channel('vehicle-booking-dispatch-workbench')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_bookings' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_booking_assignments' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fleet_vehicle_profiles' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_unavailability_periods' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operator_unavailability_periods' }, loadData)
      .subscribe();
    return () => {
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, []);

  const openDispatchDrawer = (booking: VehicleBooking, prefilledAssetId?: string, prefilledDriverUserId?: string) => {
    setSelectedBooking(booking);
    setSelectedAssetId(prefilledAssetId || '');
    setSelectedDriverUserId(prefilledDriverUserId || '');
    setHandoverOfficerUserId('');
    setAllowNonHomeBaseReturn(false);
    setNonHomeBaseReason('');
    setDispatchReasonCode('NORMAL');
    setAssignmentNote('');
    setOverrideReason('');

    // Auto set fulfillment mode from request mode if prefilled
    if (booking.requested_mode === 'SELF_DRIVE') {
      setFulfillmentType('INTERNAL_SELF_DRIVE');
    } else {
      setFulfillmentType('INTERNAL_WITH_DRIVER');
    }
  };

  // Drag Handlers
  const handleDragStart = (type: 'VEHICLE' | 'DRIVER', id: string) => {
    setDraggedItem({ type, id });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropOnBooking = (booking: VehicleBooking) => {
    if (!draggedItem) return;
    if (draggedItem.type === 'VEHICLE') {
      openDispatchDrawer(booking, draggedItem.id, undefined);
    } else {
      openDispatchDrawer(booking, undefined, draggedItem.id);
    }
    setDraggedItem(null);
  };

  const handleExecuteDispatch = async () => {
    if (!selectedBooking) return;
    if (selectedBooking.status === 'PENDING_APPROVAL' && !allowDispatchOverride) {
      toast.error('Cấu hình hệ thống không cho phép duyệt thay khi điều phối.');
      return;
    }

    const operatorUserId = fulfillmentType === 'INTERNAL_SELF_DRIVE'
      ? selectedBooking.trip_owner_user_id || selectedBooking.requester_user_id
      : selectedDriverUserId || undefined;
    const effectiveHandoverOfficerId = fulfillmentType === 'INTERNAL_SELF_DRIVE'
      ? handoverOfficerUserId || user.id
      : undefined;
    const selectedVehicle = vehicles.find(vehicle => vehicle.asset_id === selectedAssetId);
    const selectedDriver = drivers.find(driver => driver.user_id === operatorUserId);
    if (fulfillmentType === 'INTERNAL_WITH_DRIVER'
        && selectedVehicle
        && selectedDriver
        && !isDriverCompatibleWithVehicle(selectedDriver, selectedVehicle.vehicle_type)) {
      toast.error(getDispatchErrorMessage(
        new Error('DRIVER_VEHICLE_TYPE_MISMATCH'),
        { driverName: selectedDriver.employee_name, vehicleType: selectedVehicle.vehicle_type },
      ));
      return;
    }
    const validationError = getDispatchValidationError({
      bookingStatus: selectedBooking.status,
      fulfillmentType,
      vehicleAssetId: selectedAssetId || undefined,
      operatorUserId,
      handoverOfficerUserId: effectiveHandoverOfficerId,
      overrideReason,
      externalServiceType,
    });
    if (validationError) {
      const messages: Record<string, string> = {
        OVERRIDE_REASON_REQUIRED: 'Vui lòng nhập lý do duyệt thay.',
        VEHICLE_REQUIRED: 'Vui lòng chọn xe nội bộ.',
        OPERATOR_REQUIRED: 'Vui lòng chọn tài xế.',
        HANDOVER_OFFICER_REQUIRED: 'Vui lòng chọn người bàn giao xe.',
        EXTERNAL_SERVICE_TYPE_REQUIRED: 'Vui lòng nhập loại dịch vụ xe ngoài.',
      };
      toast.error(messages[validationError] || validationError);
      return;
    }

    try {
      setDispatching(true);

      await dispatchVehicleBooking({
        booking_id: selectedBooking.id,
        fulfillment_type: fulfillmentType,
        vehicle_asset_id: selectedAssetId || undefined,
        operator_user_id: operatorUserId,
        handover_officer_user_id: effectiveHandoverOfficerId,
        allow_non_home_base_return: allowNonHomeBaseReturn,
        non_home_base_return_reason: nonHomeBaseReason || undefined,
        external_service_type: fulfillmentType === 'EXTERNAL_TRANSPORT' ? externalServiceType : undefined,
        external_provider_name: fulfillmentType === 'EXTERNAL_TRANSPORT' ? externalProviderName : undefined,
        external_driver_name: fulfillmentType === 'EXTERNAL_TRANSPORT' ? externalDriverName : undefined,
        external_driver_phone: fulfillmentType === 'EXTERNAL_TRANSPORT' ? externalDriverPhone : undefined,
        external_vehicle_plate: fulfillmentType === 'EXTERNAL_TRANSPORT' ? externalVehiclePlate : undefined,
        external_estimated_cost: fulfillmentType === 'EXTERNAL_TRANSPORT' && typeof externalEstimatedCost === 'number' ? externalEstimatedCost : undefined,
        dispatch_reason_code: dispatchReasonCode,
        assignment_note: assignmentNote || undefined,
        override_reason: overrideReason || undefined,
      });

      toast.success(`Đã điều phối thành công đơn ${selectedBooking.booking_code}!`);
      setSelectedBooking(null);
      setSelectedAssetId('');
      setSelectedDriverUserId('');
      loadData();
    } catch (err: any) {
      const selectedVehicle = vehicles.find(vehicle => vehicle.asset_id === selectedAssetId);
      const selectedDriver = drivers.find(driver => driver.user_id === operatorUserId);
      toast.error(getDispatchErrorMessage(err, {
        driverName: selectedDriver?.employee_name,
        vehicleType: selectedVehicle?.vehicle_type,
      }));
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* WORKBENCH TOP BAR */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
            <LayoutDashboard className="w-5 h-5 text-amber-500" />
            <span>Bảng Điều Phối Tập Trung & Bãi Xe Kéo-Thả</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Kéo card Xe / Tài xế thả vào Yêu cầu để xếp xe nhanh | Đồng bộ Realtime Supabase Cloud
          </p>
        </div>

        <button
          onClick={loadData}
          className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          title="Làm mới bảng điều phối"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ZONE A: BOOKING WAITING LIST (LEFT COLUMN - 5 COLS) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center space-x-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span>Yêu Cầu Chờ Điều Phối ({waitingBookings.length})</span>
            </h3>
          </div>

          {waitingBookings.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
              <Check className="w-8 h-8 text-emerald-500 mx-auto" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Không có đơn nào chờ xếp xe</p>
            </div>
          ) : (
            <div className="space-y-3">
              {waitingBookings.map((b) => (
                <div
                  key={b.id}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDropOnBooking(b)}
                  className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 hover:border-amber-500 transition-all shadow-xs space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                      {b.booking_code}
                    </span>

                    {b.status === 'PENDING_APPROVAL' ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        Chờ duyệt (Cần Override)
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                        Chờ xếp xe
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                    <p className="font-semibold flex items-center space-x-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{formatVietnamDateTime(b.requested_pickup_at)}</span>
                    </p>
                    <p className="truncate text-slate-500">{b.pickup_location_text} → {b.destination_text}</p>
                    <p className="italic text-slate-600 dark:text-slate-400">Mục đích: {b.purpose}</p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700 text-xs">
                    <span className="text-slate-400">
                      {b.requested_mode === 'WITH_DRIVER' ? 'Có tài xế' : b.requested_mode === 'SELF_DRIVE' ? 'Tự lái' : 'Linh hoạt'}
                    </span>

                    <button
                      disabled={b.status === 'PENDING_APPROVAL' && !allowDispatchOverride}
                      onClick={() => openDispatchDrawer(b)}
                      className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>{b.status === 'PENDING_APPROVAL' ? 'Duyệt Thay & Điều Phối' : 'Xếp Xe'}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ZONE B & C: VISUAL PARKING YARD & DRIVERS (RIGHT COLUMN - 7 COLS) */}
        <div className="lg:col-span-7 space-y-6">
          {/* VISUAL PARKING BAY GRID */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center space-x-2">
                <Car className="w-4 h-4 text-amber-500" />
                <span>Mô Hình Ô Đỗ Bãi Xe Trực Quan (Visual Parking Yard)</span>
              </h3>
              <span className="text-[11px] text-slate-400">Kéo card xe để gán</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from(new Set([
                ...locations.map(location => location.name),
                ...vehicles.map(vehicle => vehicle.parking_spot_code).filter((code): code is string => Boolean(code)),
              ])).map((bayCode) => {
                const vehicle = vehicles.find((v) => v.parking_spot_code === bayCode);
                const operationalStatus = vehicle
                  ? getVehicleOperationalStatus(vehicle, {
                      busy: busyVehicleIds.has(vehicle.asset_id),
                      unavailable: unavailableVehicleIds.has(vehicle.asset_id),
                    })
                  : null;
                const isAvailable = operationalStatus === 'AVAILABLE';

                return (
                  <div
                    key={bayCode}
                    draggable={Boolean(vehicle && isAvailable)}
                    onDragStart={() => vehicle && handleDragStart('VEHICLE', vehicle.asset_id)}
                    className={`rounded-2xl p-4 border transition-all duration-200 cursor-grab active:cursor-grabbing space-y-2 ${
                      operationalStatus === 'IN_CUSTODY' || operationalStatus === 'BUSY'
                        ? 'bg-rose-500/5 border-rose-500/30'
                        : isAvailable
                        ? 'bg-emerald-500/5 border-emerald-500/30 hover:border-amber-500 hover:shadow-md'
                        : vehicle
                        ? 'bg-amber-500/5 border-amber-500/30'
                        : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                        Ô ĐỖ: {bayCode}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        operationalStatus === 'IN_CUSTODY' || operationalStatus === 'BUSY'
                          ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                          : isAvailable
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : vehicle
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                          : 'bg-slate-200 text-slate-600'
                      }`}>
                        {operationalStatus === 'IN_CUSTODY' || operationalStatus === 'BUSY'
                          ? 'Đang chạy'
                          : operationalStatus === 'UNAVAILABLE'
                          ? 'Tạm khóa/Bảo dưỡng'
                          : operationalStatus === 'INACTIVE'
                          ? 'Ngừng hoạt động'
                          : vehicle
                          ? 'Sẵn sàng'
                          : 'Trống'}
                      </span>
                    </div>

                    {vehicle ? (
                      <div className="flex items-center gap-3 text-xs">
                        {vehicle.asset_image_url ? <img src={vehicle.asset_image_url} alt={vehicle.asset_name} className="h-14 w-20 rounded-xl object-cover" /> : <div className="flex h-14 w-20 items-center justify-center rounded-xl bg-slate-200 text-slate-400"><Car className="h-6 w-6" /></div>}
                        <div className="min-w-0 space-y-1">
                          <p className="truncate font-bold text-slate-900 dark:text-white">{vehicle.asset_code} · {vehicle.asset_name}</p>
                          <p className="text-slate-500">{vehicle.vehicle_type} • {vehicle.seat_count} chỗ</p>
                          <p className="text-[11px] text-slate-400">Odometer: {vehicle.current_odometer} km</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic py-2">Ô đỗ trống</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* DRIVERS WORKBENCH */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center space-x-2">
                <User className="w-4 h-4 text-indigo-500" />
                <span>Danh Sách Tài Xế Chuyên Trách & Phép Lái ({drivers.length})</span>
              </h3>
              <span className="text-[11px] text-slate-400">Kéo card tài xế để gán</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {drivers.map((d) => {
                const status = getOperatorOperationalStatus(d.is_eligible, {
                  busy: busyOperatorIds.has(d.user_id),
                  unavailable: unavailableOperatorIds.has(d.user_id),
                });
                return (
                <div
                  key={d.user_id}
                  draggable={status === 'AVAILABLE'}
                  onDragStart={() => status === 'AVAILABLE' && handleDragStart('DRIVER', d.user_id)}
                  className={`bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-3.5 border border-slate-200 dark:border-slate-700 transition-all space-y-1 text-xs ${status === 'AVAILABLE' ? 'cursor-grab active:cursor-grabbing hover:border-indigo-500' : 'cursor-not-allowed opacity-70'}`}
                >
                  <div className="flex items-center gap-3">
                    {d.employee_avatar_url ? <img src={d.employee_avatar_url} alt={d.employee_name || 'Tài xế'} className="h-10 w-10 rounded-full object-cover" /> : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">{(d.employee_name || 'TX').split(' ').slice(-2).map(word => word[0]).join('')}</div>}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between font-bold text-slate-900 dark:text-white">
                        <span className="truncate">{d.employee_name || `Tài xế ${d.license_class}`}</span>
                    <span className={`text-[10px] font-semibold ${status === 'AVAILABLE' ? 'text-emerald-600' : 'text-amber-600'}`}>
                      ● {status === 'AVAILABLE' ? 'Rảnh' : status === 'BUSY' ? 'Đang chạy' : status === 'UNAVAILABLE' ? 'Nghỉ/Không sẵn sàng' : 'Không đủ điều kiện'}
                    </span>
                      </div>
                      <p className="truncate text-slate-500">{d.employee_title || `Bằng ${d.license_class}`}</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400">Loại: {d.authorization_type}</p>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* DISPATCH DRAWER MODAL */}
      {selectedBooking && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-lg bg-white dark:bg-slate-800 h-full p-6 shadow-2xl overflow-y-auto space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Điều Phối Đơn {selectedBooking.booking_code}
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedBooking.pickup_location_text} → {selectedBooking.destination_text}
                </p>
              </div>
              <button
                onClick={() => setSelectedBooking(null)}
                className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">Phương thức xếp chuyến *</label>
                <select
                  value={fulfillmentType}
                  onChange={(e) => setFulfillmentType(e.target.value as FulfillmentType)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 font-medium"
                >
                  <option value="INTERNAL_WITH_DRIVER">Xe nội bộ + Tài xế chuyên trách</option>
                  <option value="INTERNAL_SELF_DRIVE">Xe nội bộ + Nhân viên tự lái</option>
                  <option value="EXTERNAL_TRANSPORT">Thuê xe ngoài / Taxi công nghệ</option>
                </select>
              </div>

              {fulfillmentType !== 'EXTERNAL_TRANSPORT' && (
                <>
                  <div>
                    <label className="block font-semibold mb-1">Chọn xe nội bộ *</label>
                    <select
                      value={selectedAssetId}
                      onChange={(e) => {
                        const nextAssetId = e.target.value;
                        const nextVehicle = vehicles.find(vehicle => vehicle.asset_id === nextAssetId);
                        const currentDriver = drivers.find(driver => driver.user_id === selectedDriverUserId);
                        setSelectedAssetId(nextAssetId);
                        if (currentDriver && !isDriverCompatibleWithVehicle(currentDriver, nextVehicle?.vehicle_type)) {
                          setSelectedDriverUserId('');
                        }
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 font-medium"
                    >
                      <option value="">-- Chọn xe sẵn sàng --</option>
                      {vehicles
                        .filter((v) => getVehicleOperationalStatus(v, {
                          busy: busyVehicleIds.has(v.asset_id),
                          unavailable: unavailableVehicleIds.has(v.asset_id),
                        }) === 'AVAILABLE')
                        .map((v) => (
                          <option key={v.asset_id} value={v.asset_id}>
                            {v.asset_code} · {v.asset_name} ({v.vehicle_type} - {v.seat_count} chỗ)
                          </option>
                        ))}
                    </select>
                  </div>

                  {fulfillmentType === 'INTERNAL_WITH_DRIVER' && (
                    <div>
                      <label className="block font-semibold mb-1">Chọn tài xế chuyên trách</label>
                      <select
                        value={selectedDriverUserId}
                        onChange={(e) => setSelectedDriverUserId(e.target.value)}
                        disabled={!selectedAssetId}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 font-medium"
                      >
                        <option value="">{selectedAssetId ? '-- Chọn tài xế phù hợp --' : '-- Chọn xe trước --'}</option>
                        {selectCompatibleProfessionalDrivers(
                          drivers,
                          vehicles.find(vehicle => vehicle.asset_id === selectedAssetId)?.vehicle_type,
                        )
                          .filter((d) => getOperatorOperationalStatus(d.is_eligible, {
                            busy: busyOperatorIds.has(d.user_id),
                            unavailable: unavailableOperatorIds.has(d.user_id),
                          }) === 'AVAILABLE')
                          .map((d) => (
                            <option key={d.user_id} value={d.user_id}>
                              {d.employee_name || `Tài xế ${d.license_class}`}{d.employee_title ? ` · ${d.employee_title}` : ''}
                            </option>
                          ))}
                      </select>
                      {selectedAssetId && selectCompatibleProfessionalDrivers(
                        drivers,
                        vehicles.find(vehicle => vehicle.asset_id === selectedAssetId)?.vehicle_type,
                      ).length === 0 && (
                        <p className="mt-1 text-[11px] text-amber-700">
                          Chưa có tài xế chuyên trách được ủy quyền cho loại xe này.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}

              {fulfillmentType === 'EXTERNAL_TRANSPORT' && (
                <div className="space-y-3 p-3 bg-amber-500/10 rounded-xl border border-amber-500/30">
                  <p className="font-bold text-amber-800 dark:text-amber-300">Thông tin xe ngoài / Taxi:</p>
                  <div>
                    <label className="block mb-1">Loại dịch vụ:</label>
                    <input
                      type="text"
                      value={externalServiceType}
                      onChange={(e) => setExternalServiceType(e.target.value)}
                      placeholder="VD: Taxi công nghệ / Thuê xe hợp đồng"
                      className="w-full bg-white dark:bg-slate-900 border rounded-lg p-2"
                    />
                  </div>

                  <div>
                    <label className="block mb-1">Tên nhà cung cấp / Hãng taxi:</label>
                    <input
                      type="text"
                      value={externalProviderName}
                      onChange={(e) => setExternalProviderName(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border rounded-lg p-2"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block mb-1">Tên tài xế:</label>
                      <input
                        type="text"
                        value={externalDriverName}
                        onChange={(e) => setExternalDriverName(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border rounded-lg p-2"
                      />
                    </div>
                    <div>
                      <label className="block mb-1">Biển số xe:</label>
                      <input
                        type="text"
                        value={externalVehiclePlate}
                        onChange={(e) => setExternalVehiclePlate(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border rounded-lg p-2"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold mb-1">Ghi chú điều phối / Override</label>
                <textarea
                  rows={2}
                  value={assignmentNote}
                  onChange={(e) => setAssignmentNote(e.target.value)}
                  placeholder="Ghi chú thêm về phương án xếp xe..."
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3"
                />
              </div>

              {selectedBooking.status === 'PENDING_APPROVAL' && (
                <div>
                  <label className="block font-semibold mb-1">Lý do duyệt thay *</label>
                  <textarea
                    rows={2}
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Nêu rõ lý do cần duyệt thay quản lý trực tiếp..."
                    className="w-full bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-700 rounded-xl p-3"
                    required
                  />
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
              <button
                disabled={dispatching}
                onClick={handleExecuteDispatch}
                className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-lg shadow-amber-500/20 transition"
              >
                {dispatching ? 'Đang điều phối...' : 'Xác Nhận Điều Phối Đơn Đặt Xe'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DispatcherWorkbenchPage;
