import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import {
  MapPin, Camera, CameraOff, Clock, CheckCircle, LogIn, LogOut,
  AlertTriangle, Navigation, RefreshCw, Building2, HardHat
} from 'lucide-react';
import { AttendanceStatus, AttendanceRecord } from '../../types';

// Haversine formula — khoảng cách 2 toạ độ (mét)
const haversineDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371000; // m
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const CheckIn: React.FC = () => {
  const { user, employees, attendanceRecords, hrmConstructionSites, hrmOffices, addHrmItem, updateHrmItem } = useApp();
  const { theme } = useTheme();

  // Find current employee
  const currentEmployee = useMemo(() => employees.find(e => e.userId === user.id), [employees, user.id]);

  // Location selection
  type LocationOption = { id: string; name: string; type: 'construction_site' | 'office'; lat?: number; lng?: number; radius: number };
  const locationOptions = useMemo<LocationOption[]>(() => {
    const sites: LocationOption[] = hrmConstructionSites.map(s => ({
      id: s.id, name: `🏗️ ${s.name}`, type: 'construction_site', lat: s.latitude, lng: s.longitude, radius: s.checkInRadius || 200,
    }));
    const offices: LocationOption[] = hrmOffices.map(o => ({
      id: o.id, name: `🏢 ${o.name}`, type: 'office', lat: o.latitude, lng: o.longitude, radius: o.checkInRadius || 100,
    }));
    return [...sites, ...offices];
  }, [hrmConstructionSites, hrmOffices]);

  const [selectedLocationId, setSelectedLocationId] = useState('');
  const selectedLocation = useMemo(() => locationOptions.find(l => l.id === selectedLocationId), [locationOptions, selectedLocationId]);

  // Camera
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const streamRef = useRef<MediaStream | null>(null);

  // GPS
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLng, setGpsLng] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);

  // Status
  const [processing, setProcessing] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  // Today's records for current employee
  const today = new Date().toISOString().split('T')[0];
  const todayRecord = useMemo(() => {
    if (!currentEmployee) return null;
    return attendanceRecords.find(r => r.employeeId === currentEmployee.id && r.date === today);
  }, [attendanceRecords, currentEmployee, today]);

  const todayAllRecords = useMemo(() => {
    return attendanceRecords.filter(r => r.date === today)
      .sort((a, b) => (a.checkIn || '').localeCompare(b.checkIn || ''));
  }, [attendanceRecords, today]);

  // Distance to selected location
  const distance = useMemo(() => {
    if (!selectedLocation?.lat || !selectedLocation?.lng || gpsLat === null || gpsLng === null) return null;
    return Math.round(haversineDistance(gpsLat, gpsLng, selectedLocation.lat, selectedLocation.lng));
  }, [selectedLocation, gpsLat, gpsLng]);

  const isInRange = distance !== null && selectedLocation ? distance <= selectedLocation.radius : null;

  // Start camera
  const startCamera = async () => {
    try {
      setCameraError('');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err: any) {
      setCameraError(err.name === 'NotAllowedError' ? 'Vui lòng cho phép truy cập camera' : 'Không thể mở camera');
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  // Get GPS
  const getGPS = useCallback(() => {
    setGpsLoading(true);
    setGpsError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLat(pos.coords.latitude);
        setGpsLng(pos.coords.longitude);
        setGpsLoading(false);
      },
      (err) => {
        setGpsError(err.code === 1 ? 'Vui lòng cho phép truy cập vị trí' : 'Không thể lấy vị trí GPS');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  // Auto-start camera + GPS
  useEffect(() => {
    startCamera();
    getGPS();
    return () => stopCamera();
  }, []);

  // Capture selfie as base64
  const capturePhoto = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 640;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // Mirror selfie
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Add timestamp overlay
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, canvas.height - 50, canvas.width, 50);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    const now = new Date();
    ctx.fillText(`${now.toLocaleDateString('vi-VN')} ${now.toLocaleTimeString('vi-VN')}`, 10, canvas.height - 30);
    if (selectedLocation) ctx.fillText(`📍 ${selectedLocation.name}`, 10, canvas.height - 10);
    return canvas.toDataURL('image/jpeg', 0.6);
  };

  // Check-in
  const handleCheckIn = async () => {
    if (!currentEmployee || !selectedLocation) return;
    setProcessing(true);
    const photo = capturePhoto();
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (todayRecord) {
      // Already have record — update check-in
      updateHrmItem('hrm_attendance', {
        ...todayRecord,
        checkIn: todayRecord.checkIn || timeStr,
        status: 'present' as AttendanceStatus,
        checkInPhoto: photo || todayRecord.checkInPhoto,
        checkInLat: gpsLat ?? todayRecord.checkInLat,
        checkInLng: gpsLng ?? todayRecord.checkInLng,
        constructionSiteId: selectedLocation.type === 'construction_site' ? selectedLocation.id : todayRecord.constructionSiteId,
        locationName: selectedLocation.name.replace(/^[🏗️🏢]\s*/, ''),
        locationType: selectedLocation.type,
        isOutOfRange: isInRange === false,
      });
    } else {
      addHrmItem('hrm_attendance', {
        id: crypto.randomUUID(),
        employeeId: currentEmployee.id,
        date: today,
        status: 'present' as AttendanceStatus,
        checkIn: timeStr,
        checkInPhoto: photo || undefined,
        checkInLat: gpsLat ?? undefined,
        checkInLng: gpsLng ?? undefined,
        constructionSiteId: selectedLocation.type === 'construction_site' ? selectedLocation.id : undefined,
        locationName: selectedLocation.name.replace(/^[🏗️🏢]\s*/, ''),
        locationType: selectedLocation.type,
        isOutOfRange: isInRange === false,
        createdAt: new Date().toISOString(),
      } as AttendanceRecord);
    }

    setLastAction(`Check-in lúc ${timeStr}`);
    setProcessing(false);
  };

  // Check-out
  const handleCheckOut = async () => {
    if (!currentEmployee || !todayRecord) return;
    setProcessing(true);
    const photo = capturePhoto();
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    updateHrmItem('hrm_attendance', {
      ...todayRecord,
      checkOut: timeStr,
      checkOutPhoto: photo || undefined,
      checkOutLat: gpsLat ?? undefined,
      checkOutLng: gpsLng ?? undefined,
    });

    setLastAction(`Check-out lúc ${timeStr}`);
    setProcessing(false);
  };

  // Format current time
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!currentEmployee) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle size={48} className="text-amber-400 mb-4" />
        <h2 className="text-lg font-black text-slate-700 dark:text-slate-300">Không tìm thấy hồ sơ nhân sự</h2>
        <p className="text-sm text-slate-500 mt-2">Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên.</p>
        <p className="text-xs text-slate-400 mt-1">Liên hệ quản trị viên để cập nhật.</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center justify-center gap-2">
          <MapPin className="text-blue-500" size={24} /> Check-in
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{currentEmployee.fullName} • {currentEmployee.employeeCode}</p>
        <div className="text-3xl font-black text-slate-800 dark:text-white mt-2 font-mono tracking-wider">
          {currentTime.toLocaleTimeString('vi-VN')}
        </div>
        <p className="text-xs text-slate-400">{currentTime.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      {/* Location Selector */}
      <div className="glass-card p-4 rounded-2xl">
        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">📍 Chọn địa điểm</label>
        <select value={selectedLocationId} onChange={e => setSelectedLocationId(e.target.value)}
          className="w-full px-4 py-3 text-sm font-bold border-2 border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:border-blue-400 transition">
          <option value="">— Chọn Công trường / Văn phòng —</option>
          {locationOptions.length === 0 && <option disabled>Chưa có địa điểm (thêm trong Dữ liệu gốc)</option>}
          {locationOptions.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      {/* Camera */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="relative aspect-[3/4] bg-slate-900 flex items-center justify-center">
          <video ref={videoRef} autoPlay playsInline muted
            className={`w-full h-full object-cover ${cameraActive ? '' : 'hidden'}`}
            style={{ transform: 'scaleX(-1)' }} />
          <canvas ref={canvasRef} className="hidden" />
          {!cameraActive && (
            <div className="text-center">
              {cameraError ? (
                <>
                  <CameraOff size={40} className="mx-auto text-red-400 mb-2" />
                  <p className="text-sm text-red-400 font-bold">{cameraError}</p>
                  <button onClick={startCamera} className="mt-3 px-4 py-2 bg-blue-500 text-white rounded-xl text-xs font-black">Thử lại</button>
                </>
              ) : (
                <>
                  <Camera size={40} className="mx-auto text-slate-500 mb-2" />
                  <p className="text-sm text-slate-500">Đang mở camera...</p>
                </>
              )}
            </div>
          )}
          {/* GPS Status Overlay */}
          {cameraActive && (
            <div className="absolute top-3 left-3 right-3 flex justify-between">
              <div className={`px-3 py-1.5 rounded-xl text-[10px] font-black backdrop-blur-md ${
                gpsLat !== null ? 'bg-emerald-500/80 text-white' : gpsLoading ? 'bg-amber-500/80 text-white' : 'bg-red-500/80 text-white'
              }`}>
                <Navigation size={10} className="inline mr-1" />
                {gpsLat !== null ? `GPS ✓` : gpsLoading ? 'Đang lấy GPS...' : 'GPS lỗi'}
              </div>
              {distance !== null && selectedLocation && (
                <div className={`px-3 py-1.5 rounded-xl text-[10px] font-black backdrop-blur-md ${
                  isInRange ? 'bg-emerald-500/80 text-white' : 'bg-amber-500/80 text-white'
                }`}>
                  📍 {distance}m {isInRange ? '✅' : '⚠️'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* GPS & Distance Info */}
      {selectedLocation && (
        <div className={`p-4 rounded-2xl border-2 ${
          isInRange === true ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-700' :
          isInRange === false ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700' :
          'border-slate-200 bg-slate-50 dark:bg-slate-800 dark:border-slate-700'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-black text-slate-500 uppercase">Vị trí</p>
              {distance !== null ? (
                <p className={`text-sm font-black ${isInRange ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {isInRange ? '✅ Trong phạm vi' : `⚠️ Ngoài phạm vi (${distance}m / ${selectedLocation.radius}m)`}
                </p>
              ) : (
                <p className="text-sm text-slate-400 font-bold">
                  {!selectedLocation.lat ? '⚠️ Chưa cài toạ độ GPS cho địa điểm' : 'Đang lấy vị trí...'}
                </p>
              )}
            </div>
            <button onClick={getGPS} disabled={gpsLoading}
              className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 transition">
              <RefreshCw size={16} className={`text-slate-500 ${gpsLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={handleCheckIn}
          disabled={processing || !selectedLocationId || !cameraActive}
          className="py-4 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-2xl text-sm font-black hover:from-emerald-600 hover:to-teal-600 transition disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center gap-1.5 shadow-lg shadow-emerald-500/20">
          <LogIn size={24} />
          <span>CHECK-IN</span>
          {todayRecord?.checkIn && <span className="text-[10px] opacity-70">Đã vào: {todayRecord.checkIn}</span>}
        </button>
        <button onClick={handleCheckOut}
          disabled={processing || !todayRecord?.checkIn || !!todayRecord?.checkOut || !cameraActive}
          className="py-4 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-2xl text-sm font-black hover:from-orange-600 hover:to-red-600 transition disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center gap-1.5 shadow-lg shadow-orange-500/20">
          <LogOut size={24} />
          <span>CHECK-OUT</span>
          {todayRecord?.checkOut && <span className="text-[10px] opacity-70">Đã ra: {todayRecord.checkOut}</span>}
        </button>
      </div>

      {/* Success message */}
      {lastAction && (
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 text-center animate-pulse">
          <CheckCircle size={24} className="text-emerald-500 mx-auto mb-1" />
          <p className="text-sm font-black text-emerald-700 dark:text-emerald-400">{lastAction}</p>
        </div>
      )}

      {/* Today's Status */}
      {todayRecord && (
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Hôm nay</p>
          <div className="flex items-center gap-4">
            {todayRecord.checkInPhoto && (
              <img src={todayRecord.checkInPhoto} alt="Check-in" className="w-12 h-12 rounded-xl object-cover border-2 border-emerald-300" />
            )}
            <div className="flex-1">
              <div className="flex items-center gap-3 text-sm">
                <div>
                  <span className="text-slate-400 font-bold text-xs">Vào: </span>
                  <span className="font-black text-emerald-600">{todayRecord.checkIn || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-bold text-xs">Ra: </span>
                  <span className="font-black text-orange-600">{todayRecord.checkOut || '-'}</span>
                </div>
              </div>
              {todayRecord.locationName && (
                <p className="text-[10px] text-slate-400 mt-1">
                  📍 {todayRecord.locationName}
                  {todayRecord.isOutOfRange && <span className="text-amber-500 ml-1">⚠️ Ngoài phạm vi</span>}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Today's all check-ins (for admin view) */}
      {todayAllRecords.length > 0 && (
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">
            Tất cả check-in hôm nay ({todayAllRecords.length})
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {todayAllRecords.map(r => {
              const emp = employees.find(e => e.id === r.employeeId);
              return (
                <div key={r.id} className="flex items-center gap-3 py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
                  {r.checkInPhoto ? (
                    <img src={r.checkInPhoto} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center text-white text-[10px] font-black shrink-0">
                      {emp?.fullName?.charAt(0) || '?'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-black text-slate-700 dark:text-slate-300 truncate">{emp?.fullName || 'N/A'}</div>
                    <div className="text-[9px] text-slate-400">
                      {r.checkIn && <span className="text-emerald-500 font-bold">Vào {r.checkIn}</span>}
                      {r.checkOut && <span className="text-orange-500 font-bold ml-2">Ra {r.checkOut}</span>}
                      {r.locationName && <span className="ml-1">• {r.locationName}</span>}
                      {r.isOutOfRange && <span className="text-amber-500 ml-1">⚠️</span>}
                    </div>
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
