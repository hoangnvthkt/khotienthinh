import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle,
  Clock,
  Crosshair,
  LogIn,
  LogOut,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useCelebration } from '../../components/Celebration';
import { AttendanceRecord } from '../../types';
import { getApiErrorMessage } from '../../lib/apiError';
import { checkInService, CameraCheckInLocation } from '../../lib/checkInService';
import { xpService } from '../../lib/xpService';

type LocationOption = CameraCheckInLocation & {
  label: string;
  sourceLabel: string;
};

const todayLocal = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const timeLocal = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

const haversineDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const radius = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const finiteOrNull = (value: unknown): number | null => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const formatSyncError = (error: unknown): string => {
  const friendly = getApiErrorMessage(error, '');
  if (friendly) return friendly;
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    const detail = [err.message, err.details, err.hint, err.code, err.status]
      .filter(Boolean)
      .map(String)
      .join(' | ');
    if (detail) return detail;
  }
  return typeof error === 'string' && error.trim()
    ? error.trim()
    : 'Không rõ nguyên nhân. Vui lòng đăng nhập lại rồi thử lại.';
};

const calculateStreak = (records: AttendanceRecord[], employeeId: string) => {
  const dates = records
    .filter(record => record.employeeId === employeeId && record.status === 'present' && record.checkIn)
    .map(record => record.date)
    .filter((date, index, arr) => arr.indexOf(date) === index)
    .sort((a, b) => b.localeCompare(a));

  if (dates.length === 0) return { currentStreak: 0, totalDays: 0 };

  let streak = 0;
  const cursor = new Date();
  const today = todayLocal();
  if (!dates.includes(today)) cursor.setDate(cursor.getDate() - 1);

  while (true) {
    const day = cursor.getDay();
    if (day === 0 || day === 6) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }

    const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    if (!dates.includes(date)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { currentStreak: Math.max(streak, dates.includes(today) ? 1 : 0), totalDays: dates.length };
};

const CheckIn: React.FC = () => {
  const {
    user,
    employees,
    attendanceRecords,
    hrmConstructionSites,
    hrmOffices,
    loadModuleData,
  } = useApp();
  useModuleData('hrm');
  const { celebrate, showToast } = useCelebration();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLng, setGpsLng] = useState<number | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [processing, setProcessing] = useState<CameraCheckInLocation['type'] | 'check_in' | 'check_out' | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [lastSavedRecord, setLastSavedRecord] = useState<AttendanceRecord | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  const currentEmployee = useMemo(() => {
    return employees.find(employee => (
      employee.userId === user.id ||
      employee.email?.toLowerCase() === user.email?.toLowerCase()
    ));
  }, [employees, user.email, user.id]);

  const workDate = useMemo(todayLocal, []);
  const todayRecord = useMemo(() => {
    if (!currentEmployee) return null;
    return attendanceRecords.find(record => record.employeeId === currentEmployee.id && record.date === workDate) || null;
  }, [attendanceRecords, currentEmployee, workDate]);
  const effectiveTodayRecord = lastSavedRecord?.date === workDate ? lastSavedRecord : todayRecord;
  const currentEventCount = useMemo(() => {
    if (!effectiveTodayRecord) return 0;
    if (Number.isFinite(Number(effectiveTodayRecord.eventCount))) return Number(effectiveTodayRecord.eventCount);
    if (Array.isArray(effectiveTodayRecord.events)) return effectiveTodayRecord.events.length;
    return [effectiveTodayRecord.checkIn, effectiveTodayRecord.checkOut].filter(Boolean).length;
  }, [effectiveTodayRecord]);
  const eventLimitReached = currentEventCount >= 6;

  const baseLocations = useMemo<LocationOption[]>(() => {
    const sites = hrmConstructionSites.map<LocationOption>(site => ({
      id: site.id,
      name: site.name,
      label: site.name,
      sourceLabel: 'Cong truong',
      type: 'construction_site',
      lat: finiteOrNull(site.latitude),
      lng: finiteOrNull(site.longitude),
      radius: Number(site.checkInRadius || 200),
      distanceM: null,
      inRange: null,
    }));

    const offices = hrmOffices.map<LocationOption>(office => ({
      id: office.id,
      name: office.name,
      label: office.name,
      sourceLabel: 'Van phong',
      type: 'office',
      lat: finiteOrNull(office.latitude),
      lng: finiteOrNull(office.longitude),
      radius: Number(office.checkInRadius || 100),
      distanceM: null,
      inRange: null,
    }));

    return [...sites, ...offices];
  }, [hrmConstructionSites, hrmOffices]);

  const locations = useMemo<LocationOption[]>(() => {
    return baseLocations
      .map(location => {
        const hasGps = gpsLat !== null && gpsLng !== null;
        const hasLocationGps = location.lat !== null && location.lng !== null;
        const distanceM = hasGps && hasLocationGps
          ? haversineDistance(gpsLat, gpsLng, location.lat as number, location.lng as number)
          : null;
        return {
          ...location,
          distanceM,
          inRange: distanceM === null ? null : distanceM <= location.radius,
        };
      })
      .sort((a, b) => {
        if (a.distanceM === null && b.distanceM === null) return a.name.localeCompare(b.name);
        if (a.distanceM === null) return 1;
        if (b.distanceM === null) return -1;
        return a.distanceM - b.distanceM;
      });
  }, [baseLocations, gpsLat, gpsLng]);

  const nearestLocation = locations.find(location => location.distanceM !== null) || null;
  const selectedLocation = locations.find(location => location.id === selectedLocationId) || nearestLocation;
  const streak = useMemo(() => (
    currentEmployee ? calculateStreak(attendanceRecords, currentEmployee.id) : { currentStreak: 0, totalDays: 0 }
  ), [attendanceRecords, currentEmployee]);

  const todayAllRecords = useMemo(() => attendanceRecords
    .filter(record => record.date === workDate)
    .sort((a, b) => (a.checkIn || '').localeCompare(b.checkIn || '')),
    [attendanceRecords, workDate]);

  useEffect(() => {
    if (!selectedLocationId && nearestLocation) setSelectedLocationId(nearestLocation.id);
  }, [nearestLocation, selectedLocationId]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setCameraError('');
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (error: any) {
      setCameraReady(false);
      setCameraError(error?.name === 'NotAllowedError'
        ? 'Vui lòng cho phép truy cập camera.'
        : 'Không mở được camera trên thiết bị này.');
    }
  }, [stopCamera]);

  const refreshGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError('Trình duyệt không hỗ trợ GPS.');
      return;
    }
    setGpsLoading(true);
    setGpsError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsLat(position.coords.latitude);
        setGpsLng(position.coords.longitude);
        setGpsAccuracy(Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null);
        setGpsLoading(false);
      },
      (error) => {
        setGpsLoading(false);
        setGpsError(error.code === 1 ? 'Vui lòng cho phép truy cập vị trí GPS.' : 'Không lấy được vị trí GPS.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 },
    );
  }, []);

  useEffect(() => {
    startCamera();
    refreshGps();
    return () => stopCamera();
  }, [refreshGps, startCamera, stopCamera]);

  const capturePhotoBlob = useCallback(async (): Promise<Blob> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !cameraReady) throw new Error('Camera chưa sẵn sàng.');

    const width = video.videoWidth || 720;
    const height = video.videoHeight || 960;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Khong tao duoc anh check-in.');

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, width, height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(0, height - 72, width, 72);
    ctx.fillStyle = '#fff';
    ctx.font = '600 18px sans-serif';
    ctx.fillText(new Date().toLocaleString('vi-VN'), 18, height - 42);
    if (selectedLocation) ctx.fillText(selectedLocation.name, 18, height - 16);

    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', 0.72);
    });
    if (!blob?.size) throw new Error('Anh check-in rong.');
    return blob;
  }, [cameraReady, selectedLocation]);

  const assertReady = (action: 'check_in' | 'check_out') => {
    if (!currentEmployee) throw new Error('Tài khoản chưa liên kết hồ sơ nhân sự.');
    if (!selectedLocation) throw new Error('Chưa xác định được Công trường/Văn phòng gần nhất.');
    if (selectedLocation.lat === null || selectedLocation.lng === null) throw new Error('Địa điểm này chưa có tọa độ GPS.');
    if (gpsLat === null || gpsLng === null) throw new Error('Chưa lấy được GPS của thiết bị.');
    if (!cameraReady) throw new Error('Camera chưa sẵn sàng.');
    if (eventLimitReached) throw new Error('Hệ thống chỉ ghi nhận tối đa 6 lần chấm công trong ngày.');
    if (action === 'check_out' && !effectiveTodayRecord?.checkIn) throw new Error('Chưa có check-in để check-out.');
  };

  const submitAttendance = async (action: 'check_in' | 'check_out') => {
    setProcessing(action);
    setLastAction(null);
    try {
      assertReady(action);
      const imageBlob = await capturePhotoBlob();
      const saved = await checkInService.submit({
        action,
        employeeId: currentEmployee!.id,
        workDate,
        eventTime: timeLocal(),
        lat: gpsLat,
        lng: gpsLng,
        location: selectedLocation!,
        imageBlob,
      });

      setLastSavedRecord(saved);
      await loadModuleData('hrm', true);

      if (action === 'check_in') {
        setLastAction(`Da check-in luc ${timeLocal()} (${saved.eventCount || currentEventCount + 1}/6)`);
        xpService.awardXP(currentEmployee!.id, 'daily_checkin').catch(() => { });
        celebrate({
          variant: 'checkin',
          title: 'Check-in thanh cong',
          subtitle: selectedLocation!.name,
          confetti: false,
          duration: 1600,
        });
      } else {
        setLastAction(`Da check-out luc ${timeLocal()} (${saved.eventCount || currentEventCount + 1}/6)`);
        showToast({
          type: 'success',
          title: 'Check-out thanh cong',
          message: selectedLocation!.name,
        });
      }
    } catch (error) {
      console.error('Camera check-in failed:', error);
      setLastAction(`Chua luu duoc cham cong: ${formatSyncError(error)}`);
    } finally {
      setProcessing(null);
    }
  };

  if (!currentEmployee) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <AlertTriangle size={44} className="mx-auto mb-4 text-amber-500" />
        <h2 className="text-lg font-black text-slate-800 dark:text-white">Chưa có hồ sơ nhân sự</h2>
        <p className="mt-2 text-sm text-slate-500">Tài khoản này chưa được liên kết với nhân viên.</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <MapPin size={22} className="text-emerald-500" />
            Check-in
          </h1>
          <p className="text-xs font-bold text-slate-500 mt-1">{currentEmployee.fullName} - {currentEmployee.employeeCode}</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-black font-mono text-slate-900 dark:text-white">{currentTime.toLocaleTimeString('vi-VN')}</div>
          <div className="text-[10px] font-bold text-slate-400">{workDate}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <Clock size={15} className="text-blue-500 mb-1" />
          <p className="text-[10px] font-bold text-slate-400">Ngày công</p>
          <p className="text-lg font-black text-slate-900 dark:text-white">{streak.totalDays}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <ShieldCheck size={15} className="text-emerald-500 mb-1" />
          <p className="text-[10px] font-bold text-slate-400">Chuỗi</p>
          <p className="text-lg font-black text-slate-900 dark:text-white">{streak.currentStreak}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <Navigation size={15} className="text-amber-500 mb-1" />
          <p className="text-[10px] font-bold text-slate-400">Lần ghi</p>
          <p className="text-lg font-black text-slate-900 dark:text-white">{currentEventCount}/6</p>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-950">
        <div className="relative aspect-[3/4] flex items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${cameraReady ? '' : 'hidden'}`}
            style={{ transform: 'scaleX(-1)' }}
          />
          <canvas ref={canvasRef} className="hidden" />
          {!cameraReady && (
            <div className="px-6 text-center">
              {cameraError ? (
                <>
                  <CameraOff size={42} className="mx-auto mb-3 text-rose-400" />
                  <p className="text-sm font-bold text-rose-300">{cameraError}</p>
                  <button onClick={startCamera} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-black text-slate-900">
                    <RefreshCw size={14} />
                    Mở lại camera
                  </button>
                </>
              ) : (
                <>
                  <Camera size={42} className="mx-auto mb-3 text-slate-500" />
                  <p className="text-sm font-bold text-slate-400">Đang mở camera...</p>
                </>
              )}
            </div>
          )}
          <div className="absolute left-3 right-3 top-3 flex items-center justify-between gap-2">
            <div className={`rounded-lg px-2.5 py-1 text-[10px] font-black backdrop-blur ${gpsLat !== null ? 'bg-emerald-500/85 text-white' : 'bg-amber-500/85 text-white'}`}>
              {gpsLat !== null ? 'GPS sẵn sàng' : gpsLoading ? 'Đang lấy GPS' : 'Chưa có GPS'}
            </div>
            {selectedLocation?.distanceM !== null && selectedLocation && (
              <div className={`rounded-lg px-2.5 py-1 text-[10px] font-black backdrop-blur ${selectedLocation.inRange ? 'bg-emerald-500/85 text-white' : 'bg-amber-500/85 text-white'}`}>
                {selectedLocation.distanceM}m / {selectedLocation.radius}m
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400">Địa điểm theo GPS</p>
            <p className="text-sm font-black text-slate-800 dark:text-white">
              {selectedLocation ? selectedLocation.name : 'Chưa có địa điểm phù hợp'}
            </p>
            {selectedLocation && (
              <p className="text-[11px] font-bold text-slate-500">
                {selectedLocation.sourceLabel}
                {selectedLocation.distanceM !== null ? ` - ${selectedLocation.distanceM}m` : ''}
                {selectedLocation.inRange === false ? ' - ngoài phạm vi' : ''}
              </p>
            )}
          </div>
          <button
            onClick={refreshGps}
            disabled={gpsLoading}
            className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
            title="Lay lai GPS"
          >
            <Crosshair size={17} className={gpsLoading ? 'animate-spin text-amber-500' : 'text-slate-500'} />
          </button>
        </div>

        {locations.length > 1 && (
          <select
            value={selectedLocation?.id || ''}
            onChange={event => setSelectedLocationId(event.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {locations.map(location => (
              <option key={location.id} value={location.id}>
                {location.sourceLabel} - {location.name}
                {location.distanceM !== null ? ` (${location.distanceM}m)` : ' (chua co GPS)'}
              </option>
            ))}
          </select>
        )}

        {gpsError && <p className="text-xs font-bold text-rose-500">{gpsError}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => submitAttendance('check_in')}
          disabled={Boolean(processing) || !cameraReady || !selectedLocation || gpsLat === null || eventLimitReached}
          className="min-h-[84px] rounded-2xl bg-emerald-600 px-3 py-4 text-white shadow-lg shadow-emerald-600/20 disabled:opacity-40 disabled:shadow-none"
        >
          {processing === 'check_in' ? <RefreshCw size={24} className="mx-auto mb-1 animate-spin" /> : <LogIn size={24} className="mx-auto mb-1" />}
          <span className="block text-sm font-black">CHECK-IN</span>
          {effectiveTodayRecord?.checkIn && <span className="text-[10px] font-bold opacity-80">Đã vào {effectiveTodayRecord.checkIn}</span>}
        </button>

        <button
          onClick={() => submitAttendance('check_out')}
          disabled={Boolean(processing) || !cameraReady || !selectedLocation || !effectiveTodayRecord?.checkIn || eventLimitReached}
          className="min-h-[84px] rounded-2xl bg-orange-600 px-3 py-4 text-white shadow-lg shadow-orange-600/20 disabled:opacity-40 disabled:shadow-none"
        >
          {processing === 'check_out' ? <RefreshCw size={24} className="mx-auto mb-1 animate-spin" /> : <LogOut size={24} className="mx-auto mb-1" />}
          <span className="block text-sm font-black">CHECK-OUT</span>
          {effectiveTodayRecord?.checkOut && <span className="text-[10px] font-bold opacity-80">Đã ra {effectiveTodayRecord.checkOut}</span>}
        </button>
      </div>

      {lastAction && (
        <div className={`rounded-2xl border p-4 text-center ${lastAction.startsWith('Da ')
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
          : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300'
          }`}>
          {lastAction.startsWith('Da ') ? <CheckCircle size={22} className="mx-auto mb-1" /> : <AlertTriangle size={22} className="mx-auto mb-1" />}
          <p className="text-sm font-black">{lastAction}</p>
        </div>
      )}

      {effectiveTodayRecord && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase text-slate-400">Chấm công hôm nay</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${eventLimitReached ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`}>
              {currentEventCount}/6 lần
            </span>
          </div>
          <div className="flex items-center gap-3">
            {effectiveTodayRecord.checkInPhoto ? (
              <img src={effectiveTodayRecord.checkInPhoto} alt="Check-in" className="h-14 w-14 rounded-xl object-cover" />
            ) : (
              <div className="h-14 w-14 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Camera size={22} className="text-slate-400" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-black text-emerald-600">Vào {effectiveTodayRecord.checkIn || '-'}</span>
                <span className="font-black text-orange-600">Ra {effectiveTodayRecord.checkOut || '-'}</span>
              </div>
              <p className="mt-1 truncate text-xs font-bold text-slate-500">{effectiveTodayRecord.locationName || selectedLocation?.name || '-'}</p>
            </div>
          </div>
          {Array.isArray(effectiveTodayRecord.events) && effectiveTodayRecord.events.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {effectiveTodayRecord.events.map((event, index) => (
                <div key={`${event.action}_${event.time}_${index}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">
                  <p className={`font-black ${event.action === 'check_out' ? 'text-orange-600' : 'text-emerald-600'}`}>
                    {event.action === 'check_out' ? 'Ra' : 'Vào'} {event.time || '--:--'}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">{event.location_name || effectiveTodayRecord.locationName || '-'}</p>
                </div>
              ))}
            </div>
          )}
          {eventLimitReached && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              Hôm nay đã đủ 6 lần ghi nhận. Bảng công vẫn tính theo giờ vào sớm nhất và giờ ra muộn nhất.
            </p>
          )}
        </div>
      )}

      {todayAllRecords.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="mb-2 text-[10px] font-black uppercase text-slate-400">Danh sách hôm nay ({todayAllRecords.length})</p>
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {todayAllRecords.map(record => {
              const employee = employees.find(item => item.id === record.employeeId);
              return (
                <div key={record.id} className="flex items-center gap-2 border-b border-slate-100 py-2 last:border-0 dark:border-slate-800">
                  <div className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-black text-slate-500">
                    {employee?.fullName?.slice(0, 1) || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-black text-slate-700 dark:text-slate-200">{employee?.fullName || 'Nhân viên'}</p>
                    <p className="text-[10px] font-bold text-slate-400">
                      {record.checkIn ? `Vào ${record.checkIn}` : 'Chưa vào'}
                      {record.checkOut ? ` - Ra ${record.checkOut}` : ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default CheckIn;
