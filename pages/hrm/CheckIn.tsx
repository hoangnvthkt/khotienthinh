import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useTheme } from '../../context/ThemeContext';
import { useCelebration } from '../../components/Celebration';
import {
  MapPin, Camera, CameraOff, Clock, CheckCircle, LogIn, LogOut,
  AlertTriangle, Navigation, RefreshCw, Building2, HardHat, Flame, Trophy, Star, Zap
} from 'lucide-react';
import { AttendanceStatus, AttendanceRecord } from '../../types';
import { xpService } from '../../lib/xpService';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';

// ── T5: Upload selfie lên Supabase Storage (thay thế base64 trong DB) ──────
// Fallback: nếu upload lỗi → trả về base64 gốc để check-in vẫn hoạt động
const uploadSelfieToStorage = async (
  base64: string,
  employeeId: string,
  type: 'checkin' | 'checkout' = 'checkin'
): Promise<string> => {
  if (!isSupabaseConfigured || !base64.startsWith('data:')) return base64;
  try {
    const res = await fetch(base64);
    const blob = await res.blob();
    const today = new Date().toISOString().split('T')[0];
    const fileName = `${employeeId}/${today}_${type}_${Date.now()}.jpg`;
    const { data, error } = await supabase.storage
      .from('checkin-photos')
      .upload(fileName, blob, { upsert: true, contentType: 'image/jpeg' });
    if (error) {
      console.warn('Selfie upload warning (fallback to base64):', error.message);
      return base64; // fallback
    }
    const { data: { publicUrl } } = supabase.storage.from('checkin-photos').getPublicUrl(data.path);
    return publicUrl;
  } catch (err) {
    console.warn('Selfie upload failed (fallback to base64):', err);
    return base64; // fallback
  }
};


// Haversine formula — khoảng cách 2 toạ độ (mét)
const haversineDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371000; // m
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ── Streak Calculator ──
const calculateStreak = (records: AttendanceRecord[], employeeId: string): { currentStreak: number; longestStreak: number; totalDays: number; isMilestone: boolean } => {
  // Get unique check-in dates for this employee, sorted descending
  const dates = records
    .filter(r => r.employeeId === employeeId && r.status === 'present' && r.checkIn)
    .map(r => r.date)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => b.localeCompare(a)); // newest first

  if (dates.length === 0) return { currentStreak: 0, longestStreak: 0, totalDays: 0, isMilestone: false };

  const totalDays = dates.length;

  // Calculate current streak (consecutive days from today backwards)
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  let currentStreak = 0;
  let checkDate = new Date(today);
  
  // Start from today or yesterday
  const hasTodayRecord = dates.includes(todayStr);
  if (!hasTodayRecord) {
    // Check if yesterday had a record
    checkDate.setDate(checkDate.getDate() - 1);
  }

  while (true) {
    const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
    // Skip weekends (Sat=6, Sun=0)
    const day = checkDate.getDay();
    if (day === 0 || day === 6) {
      checkDate.setDate(checkDate.getDate() - 1);
      continue;
    }
    if (dates.includes(dateStr)) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  // If we just checked in today, add it to the streak
  if (hasTodayRecord && currentStreak === 0) currentStreak = 1;

  // Calculate longest streak
  let longestStreak = 0;
  let tempStreak = 0;
  const sortedAsc = [...dates].sort();
  for (let i = 0; i < sortedAsc.length; i++) {
    if (i === 0) { tempStreak = 1; }
    else {
      const prev = new Date(sortedAsc[i - 1]);
      const curr = new Date(sortedAsc[i]);
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
      // Account for weekends (gap of 3 = Friday to Monday)
      if (diffDays === 1 || diffDays === 3) tempStreak++;
      else tempStreak = 1;
    }
    longestStreak = Math.max(longestStreak, tempStreak);
  }

  const MILESTONES = [3, 5, 7, 10, 14, 21, 30, 50, 60, 90, 100];
  const isMilestone = MILESTONES.includes(currentStreak);

  return { currentStreak, longestStreak, totalDays, isMilestone };
};

// ── Streak Badge Component ──
const StreakBadge: React.FC<{ streak: number; longestStreak: number; totalDays: number; isMilestone: boolean }> = ({ streak, longestStreak, totalDays, isMilestone }) => {
  if (streak === 0 && totalDays === 0) return null;

  const getStreakTier = (s: number): { label: string; color: string; gradient: string; icon: React.ReactNode; emoji: string } => {
    if (s >= 30) return { label: 'Huyền thoại', color: 'text-yellow-500', gradient: 'from-yellow-500 via-amber-500 to-orange-500', icon: <Trophy size={20} />, emoji: '👑' };
    if (s >= 14) return { label: 'Siêu sao', color: 'text-purple-500', gradient: 'from-purple-500 via-pink-500 to-rose-500', icon: <Star size={20} />, emoji: '⭐' };
    if (s >= 7)  return { label: 'Xuất sắc', color: 'text-orange-500', gradient: 'from-orange-500 to-red-500', icon: <Flame size={20} />, emoji: '🔥' };
    if (s >= 3)  return { label: 'Tốt lắm!', color: 'text-emerald-500', gradient: 'from-emerald-500 to-teal-500', icon: <Zap size={20} />, emoji: '⚡' };
    return { label: 'Bắt đầu', color: 'text-blue-500', gradient: 'from-blue-500 to-cyan-500', icon: <CheckCircle size={20} />, emoji: '✅' };
  };

  const tier = getStreakTier(streak);
  const nextMilestones = [3, 5, 7, 10, 14, 21, 30, 50].filter(m => m > streak);
  const nextMilestone = nextMilestones[0];
  const progress = nextMilestone ? (streak / nextMilestone) * 100 : 100;

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      {/* Streak Header */}
      <div className={`relative bg-gradient-to-r ${tier.gradient} p-4 text-white`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center"
              style={{ animation: streak >= 7 ? 'streakPulse 2s ease-in-out infinite' : undefined }}>
              {tier.icon}
            </div>
            <div>
              <p className="text-xs font-bold opacity-80 uppercase tracking-wider">Chuỗi Check-in</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black">{streak}</span>
                <span className="text-sm font-bold opacity-80">ngày</span>
                <span className="text-lg">{tier.emoji}</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold opacity-70">{tier.label}</p>
            {isMilestone && (
              <span className="inline-block px-2 py-0.5 bg-white/25 rounded-full text-[10px] font-black mt-1"
                style={{ animation: 'celebrationBounce 0.6s ease-out' }}>
                🎉 MILESTONE!
              </span>
            )}
          </div>
        </div>

        {/* Progress to next milestone */}
        {nextMilestone && (
          <div className="mt-3">
            <div className="flex justify-between text-[10px] font-bold opacity-70 mb-1">
              <span>Tiến trình → {nextMilestone} ngày</span>
              <span>{streak}/{nextMilestone}</span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white/60 rounded-full transition-all duration-700"
                style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-px bg-slate-100 dark:bg-slate-700">
        <div className="bg-white dark:bg-slate-800 px-3 py-3 text-center">
          <p className="text-lg font-black text-slate-800 dark:text-white">{streak}</p>
          <p className="text-[9px] font-bold text-slate-400 uppercase">Hiện tại</p>
        </div>
        <div className="bg-white dark:bg-slate-800 px-3 py-3 text-center">
          <p className="text-lg font-black text-amber-500">{longestStreak}</p>
          <p className="text-[9px] font-bold text-slate-400 uppercase">Kỷ lục</p>
        </div>
        <div className="bg-white dark:bg-slate-800 px-3 py-3 text-center">
          <p className="text-lg font-black text-blue-500">{totalDays}</p>
          <p className="text-[9px] font-bold text-slate-400 uppercase">Tổng ngày</p>
        </div>
      </div>

      <style>{`
        @keyframes streakPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,255,255,0.4); }
          50% { transform: scale(1.05); box-shadow: 0 0 20px 5px rgba(255,255,255,0.2); }
        }
      `}</style>
    </div>
  );
};

const CheckIn: React.FC = () => {
  const { user, employees, attendanceRecords, hrmConstructionSites, hrmOffices, addHrmItem, updateHrmItem } = useApp();
  useModuleData('hrm');
  const { theme } = useTheme();
  const { celebrate, showToast: celebrationToast } = useCelebration();

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
  const today = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);
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
    return canvas.toDataURL('image/jpeg', 0.35); // Lower quality to reduce payload size for Supabase
  };

  // ── Streak Calculation ──
  const streakData = useMemo(() => {
    if (!currentEmployee) return { currentStreak: 0, longestStreak: 0, totalDays: 0, isMilestone: false };
    return calculateStreak(attendanceRecords, currentEmployee.id);
  }, [attendanceRecords, currentEmployee]);

  // Check-in
  const handleCheckIn = async () => {
    if (!currentEmployee || !selectedLocation) return;
    setProcessing(true);
    const rawPhoto = capturePhoto();
    // T5: Upload selfie lên Storage, fallback base64 nếu lỗi
    const photo = rawPhoto ? await uploadSelfieToStorage(rawPhoto, currentEmployee.id, 'checkin') : null;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let success = false;
    if (todayRecord) {
      // Already have record — update check-in
      try {
        await updateHrmItem('hrm_attendance', {
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
        success = true;
      } catch (err) {
        setLastAction(`⚠️ Check-in cục bộ OK, nhưng lỗi đồng bộ Supabase`);
      }
    } else {
      try {
        await addHrmItem('hrm_attendance', {
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
        success = true;
      } catch (err) {
        setLastAction(`⚠️ Check-in cục bộ OK, nhưng lỗi đồng bộ Supabase`);
      }
    }

    if (success) {
      setLastAction(`✅ Check-in lúc ${timeStr}`);
      // 🎮 XP: Award for daily check-in
      if (currentEmployee?.id) xpService.awardXP(currentEmployee.id, 'daily_checkin').catch(() => {});
      const newStreak = streakData.currentStreak + (todayRecord ? 0 : 1);
      const MILESTONES = [3, 5, 7, 10, 14, 21, 30, 50, 60, 90, 100];
      const hitMilestone = MILESTONES.includes(newStreak);

      if (hitMilestone) {
        celebrate({
          variant: newStreak >= 30 ? 'milestone' : 'streak',
          title: `🔥 Chuỗi ${newStreak} ngày liên tiếp!`,
          subtitle: newStreak >= 30 ? '👑 Bạn là Huyền thoại!' : newStreak >= 7 ? '⭐ Xuất sắc! Tiếp tục nhé!' : '⚡ Tốt lắm! Giữ vững nhé!',
          confetti: true,
          duration: 3000,
        });
      } else if (newStreak >= 2) {
        celebrationToast({
          type: 'success',
          title: `🔥 Chuỗi ${newStreak} ngày!`,
          message: `Check-in thành công lúc ${timeStr}`,
        });
      } else {
        celebrate({
          variant: 'checkin',
          title: '📍 Check-in Thành Công!',
          subtitle: `${timeStr} • ${selectedLocation.name.replace(/^[🏗️🏢]\s*/, '')}`,
          confetti: false,
          duration: 1800,
        });
      }
    }

    setProcessing(false);
  };

  // Check-out
  const handleCheckOut = async () => {
    if (!currentEmployee || !todayRecord) return;
    setProcessing(true);
    const rawPhoto = capturePhoto();
    // T5: Upload checkout selfie lên Storage
    const photo = rawPhoto ? await uploadSelfieToStorage(rawPhoto, currentEmployee.id, 'checkout') : null;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    try {
      await updateHrmItem('hrm_attendance', {
        ...todayRecord,
        checkOut: timeStr,
        checkOutPhoto: photo || undefined,
        checkOutLat: gpsLat ?? undefined,
        checkOutLng: gpsLng ?? undefined,
      });
      setLastAction(`✅ Check-out lúc ${timeStr}`);

      if (todayRecord.checkIn) {
        const [inH, inM] = todayRecord.checkIn.split(':').map(Number);
        const [outH, outM] = timeStr.split(':').map(Number);
        const totalMinutes = (outH * 60 + outM) - (inH * 60 + inM);
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        celebrationToast({
          type: 'success',
          title: '✅ Check-out Thành Công!',
          message: `Hôm nay: ${hours}h${mins > 0 ? ` ${mins}p` : ''} làm việc. Nghỉ ngơi nhé! 🌙`,
        });
      }
    } catch (err) {
      setLastAction(`⚠️ Check-out cục bộ OK, nhưng lỗi đồng bộ`);
    }

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

      {/* 🔥 Streak Badge */}
      <StreakBadge 
        streak={streakData.currentStreak} 
        longestStreak={streakData.longestStreak}
        totalDays={streakData.totalDays}
        isMilestone={streakData.isMilestone}
      />

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
