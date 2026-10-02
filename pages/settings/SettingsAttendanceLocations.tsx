import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building, CheckCircle2, Crosshair, ExternalLink, HardHat, MapPin, RefreshCw, Save, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { supabase } from '../../lib/supabase';
import { getApiErrorMessage } from '../../lib/apiError';
import { DEFAULT_OFFICE_RADIUS_M, DEFAULT_SITE_RADIUS_M, toCoordinate } from '../../lib/attendanceGeo';

type LocationTable = 'hrm_construction_sites' | 'hrm_offices';

interface AttendanceLocation {
  id: string;
  table: LocationTable;
  name: string;
  lat: number | null;
  lng: number | null;
  radius: number;
  approverId: string;
}

interface Draft {
  lat: string;
  lng: string;
  radius: string;
  approverId: string;
  capturedAccuracy: number | null;
}

const KIND: Record<LocationTable, { label: string; icon: typeof HardHat; defaultRadius: number }> = {
  hrm_construction_sites: { label: 'Công trường / nhà máy', icon: HardHat, defaultRadius: DEFAULT_SITE_RADIUS_M },
  hrm_offices: { label: 'Văn phòng', icon: Building, defaultRadius: DEFAULT_OFFICE_RADIUS_M },
};

const SELECT = 'id,name,latitude,longitude,"checkInRadius","managerId"';

/**
 * Where people may punch: coordinates, allowed radius and the person who approves
 * "chấm công bù" for the place (owner decision 6, 02/10/2026).
 */
const SettingsAttendanceLocations: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const { users } = useApp();
  const toast = useToast();
  const [locations, setLocations] = useState<AttendanceLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);

  const activeUsers = useMemo(
    () => users.filter(user => user.isActive !== false).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    [users],
  );
  const userName = (id: string) => users.find(user => user.id === id)?.name;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [sites, offices] = await Promise.all([
        supabase.from('hrm_construction_sites').select(SELECT).order('name').limit(500),
        supabase.from('hrm_offices').select(SELECT).order('name').limit(500),
      ]);
      if (sites.error) throw sites.error;
      if (offices.error) throw offices.error;
      const map = (table: LocationTable) => (row: Record<string, unknown>): AttendanceLocation => ({
        id: String(row.id),
        table,
        name: String(row.name || ''),
        lat: toCoordinate(row.latitude),
        lng: toCoordinate(row.longitude),
        radius: Number(row.checkInRadius) || KIND[table].defaultRadius,
        approverId: String(row.managerId || ''),
      });
      setLocations([
        ...(sites.data || []).map(map('hrm_construction_sites')),
        ...(offices.data || []).map(map('hrm_offices')),
      ]);
    } catch (error) {
      setLoadError(getApiErrorMessage(error, 'Không tải được danh sách địa điểm chấm công.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startEdit = (location: AttendanceLocation) => {
    setEditingId(location.id);
    setDraft({
      lat: location.lat === null ? '' : String(location.lat),
      lng: location.lng === null ? '' : String(location.lng),
      radius: String(location.radius),
      approverId: location.approverId,
      capturedAccuracy: null,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const captureHere = () => {
    if (!navigator.geolocation) {
      toast.error('Không lấy được vị trí', 'Thiết bị này không hỗ trợ GPS.');
      return;
    }
    setCapturing(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        setCapturing(false);
        setDraft(prev => prev && ({
          ...prev,
          lat: position.coords.latitude.toFixed(6),
          lng: position.coords.longitude.toFixed(6),
          capturedAccuracy: Math.round(position.coords.accuracy),
        }));
      },
      error => {
        setCapturing(false);
        toast.error('Không lấy được vị trí', error.code === 1 ? 'Hãy cho phép trình duyệt truy cập vị trí.' : 'Thử lại ở chỗ thoáng.');
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };

  const save = async (location: AttendanceLocation) => {
    if (!draft) return;
    const lat = toCoordinate(draft.lat);
    const lng = toCoordinate(draft.lng);
    const radius = Math.round(Number(draft.radius));
    if ((lat === null) !== (lng === null) || (lat !== null && (lat < -90 || lat > 90)) || (lng !== null && (lng < -180 || lng > 180))) {
      toast.error('Tọa độ chưa hợp lệ', 'Nhập đủ cả vĩ độ và kinh độ (ví dụ 20.447910 và 106.316350).');
      return;
    }
    if (!Number.isFinite(radius) || radius < 50 || radius > 2000) {
      toast.error('Bán kính chưa hợp lệ', 'Bán kính từ 50 m đến 2.000 m.');
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from(location.table)
        .update({ latitude: lat, longitude: lng, checkInRadius: radius, managerId: draft.approverId || null })
        .eq('id', location.id)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Tài khoản chưa có quyền sửa địa điểm chấm công (cần vai trò HR Manage).');
      toast.success('Đã lưu địa điểm chấm công', `${location.name}: bán kính ${radius} m${draft.approverId ? `, người duyệt ${userName(draft.approverId) || ''}` : ''}.`);
      cancelEdit();
      await load();
    } catch (error) {
      toast.error('Chưa lưu được địa điểm', getApiErrorMessage(error, 'Không cập nhật được địa điểm chấm công.'));
    } finally {
      setSaving(false);
    }
  };

  const missingCount = locations.filter(location => location.lat === null).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-800 dark:text-white">Địa điểm chấm công</h2>
          <p className="text-sm text-slate-500">
            Nhân viên chỉ chấm được khi đứng trong bán kính của một địa điểm. Người duyệt nhận các đề xuất chấm công bù của địa điểm đó.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Tải lại
        </button>
      </div>

      {missingCount > 0 && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>{missingCount} địa điểm chưa có tọa độ — nhân viên tại đó chưa chấm công được. Cách nhanh nhất: người quản lý đứng tại địa điểm, mở màn này trên điện thoại và bấm "Lấy vị trí tại đây".</span>
        </div>
      )}
      {!canEdit && (
        <p className="text-xs font-bold text-slate-500">Bạn đang xem. Chỉ HR Manage được sửa tọa độ, bán kính và người duyệt.</p>
      )}
      {loadError && <p className="text-sm font-bold text-rose-600">{loadError}</p>}

      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
        {loading && locations.length === 0 && <div className="p-6 text-center text-sm text-slate-400">Đang tải…</div>}
        {!loading && !loadError && locations.length === 0 && <div className="p-6 text-center text-sm text-slate-400">Chưa có địa điểm nào.</div>}
        {locations.map(location => {
          const Icon = KIND[location.table].icon;
          const editing = editingId === location.id && draft;
          return (
            <div key={`${location.table}-${location.id}`} className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-mint-100 text-mint-700 dark:bg-mint-900/40 dark:text-mint-300">
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-mint-700 dark:text-mint-300">{location.name}</p>
                  <p className="text-[11px] font-bold text-slate-500">
                    {KIND[location.table].label} · bán kính {location.radius} m · người duyệt: {userName(location.approverId) || 'chưa chọn'}
                  </p>
                </div>
                {location.lat !== null && location.lng !== null ? (
                  <a
                    href={`https://maps.google.com/?q=${location.lat},${location.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-leaf-50 px-2 py-1 text-[11px] font-bold text-leaf-700 dark:bg-leaf-900/30 dark:text-leaf-300"
                  >
                    <CheckCircle2 size={12} /> Đã có tọa độ <ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                    <AlertTriangle size={12} /> Chưa có tọa độ
                  </span>
                )}
                {canEdit && !editing && (
                  <button type="button" onClick={() => startEdit(location)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
                    Sửa
                  </button>
                )}
              </div>

              {editing && (
                <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60 sm:grid-cols-2">
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={captureHere}
                      disabled={capturing}
                      className="inline-flex items-center gap-2 rounded-xl bg-mint-600 px-3 py-2 text-xs font-black text-white hover:bg-mint-700 disabled:opacity-50"
                    >
                      <Crosshair size={14} className={capturing ? 'animate-spin' : ''} />
                      {capturing ? 'Đang lấy vị trí…' : 'Lấy vị trí tại đây'}
                    </button>
                    {draft.capturedAccuracy !== null && (
                      <span className={`text-[11px] font-bold ${draft.capturedAccuracy <= 30 ? 'text-leaf-700' : 'text-amber-700'}`}>
                        Sai số ±{draft.capturedAccuracy} m{draft.capturedAccuracy > 30 ? ' — nên ra chỗ thoáng và lấy lại' : ''}
                      </span>
                    )}
                  </div>
                  <label className="text-xs font-bold text-slate-500">
                    Vĩ độ
                    <input value={draft.lat} onChange={event => setDraft({ ...draft, lat: event.target.value })} inputMode="decimal" placeholder="20.447910"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold dark:border-slate-700 dark:bg-slate-900" />
                  </label>
                  <label className="text-xs font-bold text-slate-500">
                    Kinh độ
                    <input value={draft.lng} onChange={event => setDraft({ ...draft, lng: event.target.value })} inputMode="decimal" placeholder="106.316350"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold dark:border-slate-700 dark:bg-slate-900" />
                  </label>
                  <label className="text-xs font-bold text-slate-500">
                    Bán kính cho phép (m)
                    <input value={draft.radius} onChange={event => setDraft({ ...draft, radius: event.target.value })} inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold dark:border-slate-700 dark:bg-slate-900" />
                  </label>
                  <label className="text-xs font-bold text-slate-500">
                    Người duyệt chấm công bù
                    <select value={draft.approverId} onChange={event => setDraft({ ...draft, approverId: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold dark:border-slate-700 dark:bg-slate-900">
                      <option value="">— Chưa chọn —</option>
                      {activeUsers.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
                    </select>
                  </label>
                  <div className="sm:col-span-2 flex justify-end gap-2">
                    <button type="button" onClick={cancelEdit} className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-white dark:hover:bg-slate-900">
                      <X size={14} /> Hủy
                    </button>
                    <button type="button" onClick={() => void save(location)} disabled={saving}
                      className="inline-flex items-center gap-1 rounded-xl bg-leaf-600 px-4 py-2 text-xs font-black text-white hover:bg-leaf-700 disabled:opacity-50">
                      <Save size={14} /> {saving ? 'Đang lưu…' : 'Lưu'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="flex items-center gap-1 text-[11px] text-slate-400">
        <MapPin size={12} /> Mặc định: công trường 300 m, văn phòng / nhà máy 150 m. GPS điện thoại phải có sai số ≤ 100 m mới chấm được.
      </p>
    </div>
  );
};

export default SettingsAttendanceLocations;
