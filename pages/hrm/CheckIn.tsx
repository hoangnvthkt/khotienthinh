import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CameraOff,
  CheckCircle,
  Crosshair,
  FilePlus2,
  Fingerprint,
  MapPin,
  RefreshCw,
} from 'lucide-react';
import { useCelebration } from '../../components/Celebration';
import { AttendanceRecord } from '../../types';
import { getApiErrorMessage } from '../../lib/apiError';
import { checkInService, MyCheckInContext } from '../../lib/checkInService';
import {
  CheckInPlace,
  DEFAULT_OFFICE_RADIUS_M,
  DEFAULT_SITE_RADIUS_M,
  formatDistance,
  matchPlace,
  MAX_GPS_ACCURACY_M,
  PlaceDistance,
  toCoordinate,
} from '../../lib/attendanceGeo';
import { xpService } from '../../lib/xpService';
import AttendancePhoto from '../../components/hrm/AttendancePhoto';

const PHOTO_MAX_EDGE = 720;
const PHOTO_QUALITY = 0.6;
const GPS_GOOD_ACCURACY_M = 30;
const GPS_SETTLE_MS = 12000;
const PROPOSAL_LINK = '/hrm/attendance?tab=proposals';

const todayLocal = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

const formatSyncError = (error: unknown): string => {
  const friendly = getApiErrorMessage(error, '');
  if (friendly) return friendly;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return typeof error === 'string' && error.trim()
    ? error.trim()
    : 'Không rõ nguyên nhân. Vui lòng đăng nhập lại rồi thử lại.';
};

type GpsState =
  | { status: 'locating' }
  | { status: 'denied' }
  | { status: 'unavailable' }
  | { status: 'ready'; lat: number; lng: number; accuracy: number };

const CheckIn: React.FC = () => {
  const { celebrate, showToast } = useCelebration();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [gps, setGps] = useState<GpsState>({ status: 'locating' });
  const [chosenPlaceId, setChosenPlaceId] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [lastSavedRecord, setLastSavedRecord] = useState<AttendanceRecord | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [checkInContext, setCheckInContext] = useState<MyCheckInContext | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState('');

  const loadCheckInContext = useCallback(async () => {
    setContextLoading(true);
    setContextError('');
    try {
      setCheckInContext(await checkInService.loadMyContext());
    } catch (error) {
      setContextError(formatSyncError(error));
    } finally {
      setContextLoading(false);
    }
  }, []);

  useEffect(() => { void loadCheckInContext(); }, [loadCheckInContext]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const currentEmployee = checkInContext?.employee || null;

  // The work day follows the clock, so an app left open overnight starts a new day.
  const workDate = todayLocal(currentTime);
  const todayRecord = useMemo(() => {
    if (lastSavedRecord?.date === workDate) return lastSavedRecord;
    if (!currentEmployee) return null;
    return (checkInContext?.attendanceRecords || [])
      .find(record => record.employeeId === currentEmployee.id && record.date === workDate) || null;
  }, [checkInContext, currentEmployee, lastSavedRecord, workDate]);
  const nextAction: 'check_in' | 'check_out' = todayRecord?.checkIn ? 'check_out' : 'check_in';

  const places = useMemo<CheckInPlace[]>(() => [
    ...(checkInContext?.constructionSites || []).map(site => ({
      id: site.id,
      name: site.name,
      type: 'construction_site' as const,
      lat: toCoordinate(site.latitude),
      lng: toCoordinate(site.longitude),
      radius: Number(site.checkInRadius) || DEFAULT_SITE_RADIUS_M,
    })),
    ...(checkInContext?.offices || []).map(office => ({
      id: office.id,
      name: office.name,
      type: 'office' as const,
      lat: toCoordinate(office.latitude),
      lng: toCoordinate(office.longitude),
      radius: Number(office.checkInRadius) || DEFAULT_OFFICE_RADIUS_M,
    })),
  ], [checkInContext]);

  const preferredIds = useMemo(() => new Set([
    ...(checkInContext?.assignedSiteIds || []),
    ...[currentEmployee?.officeId, currentEmployee?.constructionSiteId].filter((id): id is string => Boolean(id)),
  ]), [checkInContext, currentEmployee]);

  const match = useMemo(() => (
    gps.status === 'ready' ? matchPlace(places, gps, preferredIds) : null
  ), [gps, places, preferredIds]);

  const insidePlaces: PlaceDistance[] = match?.status === 'inside' ? [match.place, ...match.alternatives] : [];
  const selectedPlace = insidePlaces.find(place => place.id === chosenPlaceId) || insidePlaces[0] || null;
  const accuracyOk = gps.status === 'ready' && gps.accuracy <= MAX_GPS_ACCURACY_M;

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
    } catch (error: unknown) {
      setCameraReady(false);
      setCameraError((error as { name?: string })?.name === 'NotAllowedError'
        ? 'Chưa cho phép dùng camera. Mở cài đặt trình duyệt để cấp quyền camera.'
        : 'Không mở được camera trên thiết bị này.');
    }
  }, [stopCamera]);

  const stopGps = useCallback(() => {
    if (watchIdRef.current !== null) navigator.geolocation?.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
  }, []);

  // Follow the position for a few seconds and keep the most accurate reading.
  const startGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGps({ status: 'unavailable' });
      return;
    }
    stopGps();
    setGps({ status: 'locating' });
    let best: { lat: number; lng: number; accuracy: number } | null = null;
    watchIdRef.current = navigator.geolocation.watchPosition(
      position => {
        const reading = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy || 9999),
        };
        if (!best || reading.accuracy <= best.accuracy) {
          best = reading;
          setGps({ status: 'ready', ...reading });
        }
        if (reading.accuracy <= GPS_GOOD_ACCURACY_M) stopGps();
      },
      error => {
        stopGps();
        setGps(error.code === 1 ? { status: 'denied' } : { status: 'unavailable' });
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
    settleTimerRef.current = window.setTimeout(stopGps, GPS_SETTLE_MS);
  }, [stopGps]);

  useEffect(() => {
    if (!currentEmployee) return undefined;
    void startCamera();
    startGps();
    return () => {
      stopCamera();
      stopGps();
    };
  }, [currentEmployee, startCamera, startGps, stopCamera, stopGps]);

  // Downscaled, compressed JPEG: about 40–80 KB instead of the full camera frame.
  const capturePhotoBlob = useCallback(async (placeName: string): Promise<Blob> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !cameraReady) throw new Error('Camera chưa sẵn sàng.');

    const sourceWidth = video.videoWidth || 720;
    const sourceHeight = video.videoHeight || 960;
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
    const width = Math.round(sourceWidth * scale);
    const height = Math.round(sourceHeight * scale);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không tạo được ảnh chấm công.');

    ctx.setTransform(-1, 0, 0, 1, width, 0);
    ctx.drawImage(video, 0, 0, width, height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(0, height - 56, width, 56);
    ctx.fillStyle = '#fff';
    ctx.font = '600 15px sans-serif';
    ctx.fillText(new Date().toLocaleString('vi-VN'), 14, height - 33);
    ctx.fillText(placeName, 14, height - 12);

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
    if (!blob?.size) throw new Error('Ảnh chấm công rỗng.');
    return blob;
  }, [cameraReady]);

  const punch = async () => {
    if (!currentEmployee || !selectedPlace || gps.status !== 'ready') return;
    setProcessing(true);
    setResult(null);
    try {
      const imageBlob = await capturePhotoBlob(selectedPlace.name);
      const saved = await checkInService.punch({
        employeeId: currentEmployee.id,
        lat: gps.lat,
        lng: gps.lng,
        accuracyM: gps.accuracy,
        location: { id: selectedPlace.id, type: selectedPlace.type },
        imageBlob,
      });
      setLastSavedRecord(saved);
      const isFirst = Number(saved.eventCount) <= 1;
      const time = isFirst ? saved.checkIn : saved.checkOut;
      setResult({ ok: true, message: `${isFirst ? 'Đã chấm công vào' : 'Đã chấm công ra'} lúc ${time} tại ${selectedPlace.name}` });
      if (isFirst) {
        xpService.awardDailyXP('daily_checkin', saved.id).catch(() => { });
        celebrate({ variant: 'checkin', title: 'Chấm công vào thành công', subtitle: selectedPlace.name, confetti: false, duration: 1600 });
      } else {
        showToast({ type: 'success', title: 'Chấm công ra thành công', message: selectedPlace.name });
      }
      void loadCheckInContext();
    } catch (error) {
      setResult({ ok: false, message: formatSyncError(error) });
    } finally {
      setProcessing(false);
    }
  };

  if (contextLoading && !checkInContext) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <RefreshCw size={40} className="mx-auto mb-4 animate-spin text-mint-500" />
        <h2 className="text-lg font-black text-slate-800 dark:text-white">Đang tải thông tin chấm công</h2>
      </div>
    );
  }

  if (contextError && !checkInContext) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <AlertTriangle size={44} className="mx-auto mb-4 text-rose-500" />
        <h2 className="text-lg font-black text-slate-800 dark:text-white">Không tải được thông tin chấm công</h2>
        <p className="mt-2 text-sm text-slate-500">{contextError}</p>
        <button
          type="button"
          onClick={() => void loadCheckInContext()}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-leaf-600 px-4 py-2 text-sm font-black text-white hover:bg-leaf-700"
        >
          <RefreshCw size={16} />
          Thử lại
        </button>
      </div>
    );
  }

  if (!currentEmployee) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <AlertTriangle size={44} className="mx-auto mb-4 text-amber-500" />
        <h2 className="text-lg font-black text-slate-800 dark:text-white">Chưa có hồ sơ nhân sự</h2>
        <p className="mt-2 text-sm text-slate-500">Tài khoản này chưa được liên kết với nhân viên. Liên hệ phòng HCNS.</p>
      </div>
    );
  }

  // Why the button cannot be used right now, in the order the person can fix it.
  const blocker: { text: string; proposal?: boolean } | null =
    cameraError ? { text: cameraError }
      : gps.status === 'denied' ? { text: 'Chưa cho phép truy cập vị trí. Mở cài đặt trình duyệt để cấp quyền vị trí.' }
        : gps.status === 'unavailable' ? { text: 'Không lấy được vị trí GPS. Bật định vị rồi bấm làm mới.' }
          : gps.status === 'locating' ? { text: 'Đang xác định vị trí…' }
            : !accuracyOk ? { text: `GPS chưa đủ chính xác (±${gps.accuracy} m). Ra chỗ thoáng rồi bấm làm mới.` }
              : match?.status === 'no_places' ? { text: 'Chưa có địa điểm chấm công nào được cấu hình tọa độ. Liên hệ HCNS.' }
                : match?.status === 'outside' ? {
                  text: match.nearest
                    ? `Bạn đang ngoài phạm vi chấm công (cách ${match.nearest.name} ${formatDistance(match.nearest.distanceM as number)}).`
                    : 'Bạn đang ngoài phạm vi chấm công.',
                  proposal: true,
                }
                  : !cameraReady ? { text: 'Đang mở camera…' }
                    : null;

  const actionLabel = nextAction === 'check_in' ? 'Chấm công vào' : 'Chấm công ra';

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-3 pb-2">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-black text-slate-900 dark:text-white">Chấm công</h1>
          <p className="truncate text-xs font-bold text-slate-500">{currentEmployee.fullName} · {currentEmployee.employeeCode}</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-black font-mono text-slate-900 dark:text-white">{currentTime.toLocaleTimeString('vi-VN')}</div>
          <div className="text-[11px] font-bold text-slate-400">{currentTime.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 h-9 w-9 shrink-0 rounded-xl flex items-center justify-center ${selectedPlace ? 'bg-mint-100 text-mint-700 dark:bg-mint-900/40 dark:text-mint-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}>
            <MapPin size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black text-slate-800 dark:text-white">
              {selectedPlace ? selectedPlace.name : match?.status === 'outside' ? 'Ngoài phạm vi chấm công' : 'Đang xác định địa điểm'}
            </p>
            <p className="text-[11px] font-bold text-slate-500">
              {selectedPlace
                ? `Trong phạm vi · cách ${formatDistance(selectedPlace.distanceM as number)}`
                : match?.status === 'outside' && match.nearest
                  ? `Gần nhất: ${match.nearest.name} · ${formatDistance(match.nearest.distanceM as number)}`
                  : 'Đang lấy GPS'}
              {gps.status === 'ready' && ` · GPS ±${gps.accuracy} m`}
            </p>
          </div>
          <button
            type="button"
            onClick={startGps}
            className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
            title="Lấy lại vị trí"
            aria-label="Lấy lại vị trí"
          >
            <Crosshair size={16} className={gps.status === 'locating' ? 'animate-spin text-mint-500' : 'text-slate-500'} />
          </button>
        </div>
        {insidePlaces.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {insidePlaces.map(place => (
              <button
                key={place.id}
                type="button"
                onClick={() => setChosenPlaceId(place.id)}
                className={`rounded-full px-3 py-1 text-[11px] font-bold border ${place.id === selectedPlace?.id
                  ? 'border-mint-500 bg-mint-50 text-mint-700 dark:bg-mint-900/30 dark:text-mint-300'
                  : 'border-slate-200 text-slate-500 dark:border-slate-700'}`}
              >
                {place.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative h-[36svh] min-h-[220px] max-h-[420px] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-950">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${cameraReady ? '' : 'hidden'}`}
          style={{ transform: 'scaleX(-1)' }}
        />
        <canvas ref={canvasRef} className="hidden" />
        {cameraReady ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[72%] aspect-[3/4] rounded-[50%] border-2 border-white/70 shadow-[0_0_0_9999px_rgba(2,6,23,0.25)]" />
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <CameraOff size={36} className={cameraError ? 'text-rose-400 mb-2' : 'text-slate-500 mb-2'} />
            <p className={`text-sm font-bold ${cameraError ? 'text-rose-300' : 'text-slate-400'}`}>{cameraError || 'Đang mở camera…'}</p>
            {cameraError && (
              <button type="button" onClick={() => void startCamera()} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-black text-slate-900">
                <RefreshCw size={14} />
                Mở lại camera
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2">
        {todayRecord?.checkInPhoto && (
          <AttendancePhoto url={todayRecord.checkInPhoto} alt="Ảnh chấm công vào" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
        )}
        <div className="flex flex-1 items-center justify-between gap-3 text-sm">
          <span className="font-black text-leaf-700 dark:text-leaf-400">Vào {todayRecord?.checkIn || '--:--'}</span>
          <span className="font-black text-mint-700 dark:text-mint-400">Ra {todayRecord?.checkOut || '--:--'}</span>
          <span className="text-[11px] font-bold text-slate-400">{todayRecord?.eventCount || 0} lượt hôm nay</span>
        </div>
      </div>

      {result && (
        <div className={`flex items-start gap-2 rounded-2xl border p-3 text-sm font-bold ${result.ok
          ? 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-800 dark:bg-leaf-900/30 dark:text-leaf-300'
          : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300'}`}
        >
          {result.ok ? <CheckCircle size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}

      <div className="sticky bottom-24 lg:bottom-4 z-10 space-y-2 rounded-2xl bg-white/95 p-2 shadow-lg backdrop-blur dark:bg-slate-900/95">
        {blocker && (
          <p className={`px-1 text-xs font-bold ${blocker.proposal ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>
            {blocker.text}
          </p>
        )}
        {nextAction === 'check_in' && !blocker && (todayRecord === null) && currentTime.getHours() >= 12 && (
          <p className="px-1 text-[11px] font-bold text-slate-500">
            Hôm nay bạn chưa chấm vào. Lượt này sẽ ghi là giờ vào; nếu quên chấm buổi sáng, hãy gửi đề xuất chấm công bù.
          </p>
        )}
        {blocker?.proposal ? (
          <Link
            to={PROPOSAL_LINK}
            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 text-sm font-black text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <FilePlus2 size={18} />
            Gửi đề xuất chấm công bù
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => void punch()}
            disabled={processing || Boolean(blocker) || !selectedPlace}
            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-leaf-600 px-4 text-base font-black text-white shadow-lg shadow-leaf-600/20 hover:bg-leaf-700 disabled:opacity-40 disabled:shadow-none"
          >
            {processing ? <RefreshCw size={20} className="animate-spin" /> : <Fingerprint size={20} />}
            {processing ? 'Đang ghi nhận…' : actionLabel}
          </button>
        )}
      </div>
    </div>
  );
};

export default CheckIn;
