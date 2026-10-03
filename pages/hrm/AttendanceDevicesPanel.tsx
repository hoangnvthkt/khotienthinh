import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, ShieldOff, Smartphone, UserX, XCircle } from 'lucide-react';
import { Employee } from '../../types';
import { supabase } from '../../lib/supabase';
import { getApiErrorMessage } from '../../lib/apiError';
import { useToast } from '../../context/ToastContext';
import { useReasonConfirm } from '../../context/ConfirmContext';
import AttendancePhoto from '../../components/hrm/AttendancePhoto';
import SearchableSelect from '../../components/common/SearchableSelect';

interface DeviceRow {
  id: string;
  employee_id: string;
  status: 'ACTIVE' | 'PENDING' | 'REVOKED';
  pending_reason: string | null;
  device_label: string | null;
  registered_at: string;
  last_used_at: string | null;
}

interface FlaggedRow {
  id: string;
  employeeId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  locationName: string | null;
  checkInPhoto: string | null;
  suspicionFlags: string[] | null;
}

interface ExemptionRow {
  employee_id: string;
  reason: string;
  valid_until: string | null;
}

const FLAG_LABELS: Record<string, string> = {
  shared_device: 'Cùng một điện thoại với người khác',
  same_gps_fix: 'Trùng hệt tọa độ với người khác trong 1 phút',
  no_passkey: 'Chấm không qua vân tay / Face ID (được miễn)',
};

const formatDateTime = (value: string | null) => (value ? new Date(value).toLocaleString('vi-VN') : '—');

/** HR view for G1 anti buddy punching: phones, suspicious punches, exemptions. */
const AttendanceDevicesPanel: React.FC<{ employees: Employee[]; canManageSettings: boolean }> = ({ employees, canManageSettings }) => {
  const toast = useToast();
  const reasonConfirm = useReasonConfirm();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [flagged, setFlagged] = useState<FlaggedRow[]>([]);
  const [exemptions, setExemptions] = useState<ExemptionRow[]>([]);
  const [required, setRequired] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newExemptEmployee, setNewExemptEmployee] = useState('');
  const [newExemptUntil, setNewExemptUntil] = useState('');

  const employeeName = useMemo(() => {
    const names = new Map(employees.map(employee => [employee.id, `${employee.fullName} (${employee.employeeCode})`]));
    return (id: string) => names.get(id) || 'Nhân viên';
  }, [employees]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const since = new Date(Date.now() - 30 * 86400000).toLocaleDateString('sv-SE');
      const [deviceResult, attendanceResult, exemptionResult, settingResult] = await Promise.all([
        supabase.from('hrm_attendance_devices')
          .select('id,employee_id,status,pending_reason,device_label,registered_at,last_used_at')
          .neq('status', 'REVOKED').order('registered_at', { ascending: false }).limit(1000),
        supabase.from('hrm_attendance')
          .select('id,"employeeId",date,"checkIn","checkOut","locationName","checkInPhoto","suspicionFlags"')
          .gte('date', since).order('date', { ascending: false }).limit(5000),
        supabase.from('hrm_attendance_passkey_exemptions').select('employee_id,reason,valid_until').limit(1000),
        supabase.from('hrm_attendance_settings').select('require_device_passkey').limit(1).maybeSingle(),
      ]);
      if (deviceResult.error) throw deviceResult.error;
      if (attendanceResult.error) throw attendanceResult.error;
      if (exemptionResult.error) throw exemptionResult.error;
      setDevices((deviceResult.data || []) as DeviceRow[]);
      setFlagged(((attendanceResult.data || []) as FlaggedRow[]).filter(row => (row.suspicionFlags || []).some(flag => flag !== 'no_passkey')));
      setExemptions((exemptionResult.data || []) as ExemptionRow[]);
      setRequired(settingResult.data ? settingResult.data.require_device_passkey !== false : null);
    } catch (error) {
      setLoadError(getApiErrorMessage(error, 'Không tải được thiết bị chấm công.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (device: DeviceRow, decision: 'approve' | 'revoke') => {
    const reason = await reasonConfirm({
      title: decision === 'approve' ? 'Duyệt điện thoại chấm công' : 'Thu hồi điện thoại chấm công',
      targetName: `${employeeName(device.employee_id)} · ${device.device_label || 'Điện thoại'}`,
      subtitle: decision === 'approve'
        ? 'Điện thoại này sẽ thay điện thoại cũ của nhân viên (nếu có).'
        : 'Nhân viên sẽ phải đăng ký lại điện thoại trước khi chấm công.',
      reasonLabel: 'Lý do',
      reasonPlaceholder: decision === 'approve' ? 'Ví dụ: đổi điện thoại mới, đã xác nhận trực tiếp' : 'Ví dụ: điện thoại bị mất',
      actionLabel: decision === 'approve' ? 'Duyệt' : 'Thu hồi',
      intent: decision === 'approve' ? 'success' : 'danger',
    });
    if (reason === null) return;
    setBusyId(device.id);
    try {
      const { error } = await supabase.rpc('decide_hrm_attendance_device', { p_device_id: device.id, p_decision: decision, p_reason: reason });
      if (error) throw error;
      toast.success(decision === 'approve' ? 'Đã duyệt điện thoại' : 'Đã thu hồi điện thoại', employeeName(device.employee_id));
      await load();
    } catch (error) {
      toast.error('Chưa lưu được', getApiErrorMessage(error, 'Không cập nhật được thiết bị.'));
    } finally {
      setBusyId(null);
    }
  };

  const toggleRequired = async () => {
    if (required === null) return;
    setBusyId('setting');
    try {
      const { data, error } = await supabase.from('hrm_attendance_settings')
        .update({ require_device_passkey: !required, updated_at: new Date().toISOString() })
        .eq('singleton', true).select('require_device_passkey');
      if (error) throw error;
      if (!data?.length) throw new Error('Chỉ HR Manage được đổi cài đặt này.');
      setRequired(!required);
      toast.success(!required ? 'Đã bật xác thực vân tay / Face ID khi chấm công' : 'Đã tắt xác thực vân tay / Face ID khi chấm công');
    } catch (error) {
      toast.error('Chưa đổi được cài đặt', getApiErrorMessage(error, 'Không cập nhật được cài đặt.'));
    } finally {
      setBusyId(null);
    }
  };

  const addExemption = async () => {
    if (!newExemptEmployee) return;
    const reason = await reasonConfirm({
      title: 'Miễn xác thực vân tay / Face ID',
      targetName: employeeName(newExemptEmployee),
      subtitle: 'Người này chấm công không cần vân tay / Face ID; các lượt chấm sẽ được gắn nhãn để theo dõi.',
      reasonLabel: 'Lý do',
      reasonPlaceholder: 'Ví dụ: điện thoại đời cũ không hỗ trợ',
      actionLabel: 'Miễn',
      intent: 'warning',
      minLength: 5,
    });
    if (reason === null) return;
    setBusyId('exempt');
    try {
      const { error } = await supabase.from('hrm_attendance_passkey_exemptions').upsert({
        employee_id: newExemptEmployee, reason, valid_until: newExemptUntil || null, granted_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.success('Đã miễn xác thực', employeeName(newExemptEmployee));
      setNewExemptEmployee('');
      setNewExemptUntil('');
      await load();
    } catch (error) {
      toast.error('Chưa lưu được', getApiErrorMessage(error, 'Không lưu được miễn xác thực.'));
    } finally {
      setBusyId(null);
    }
  };

  const removeExemption = async (employeeId: string) => {
    setBusyId(`exempt-${employeeId}`);
    try {
      const { error } = await supabase.from('hrm_attendance_passkey_exemptions').delete().eq('employee_id', employeeId);
      if (error) throw error;
      toast.success('Đã bỏ miễn xác thực', employeeName(employeeId));
      await load();
    } catch (error) {
      toast.error('Chưa lưu được', getApiErrorMessage(error, 'Không bỏ được miễn xác thực.'));
    } finally {
      setBusyId(null);
    }
  };

  const pending = devices.filter(device => device.status === 'PENDING');
  const active = devices.filter(device => device.status === 'ACTIVE');
  const withoutPhone = employees.filter(employee =>
    employee.status === 'Đang làm việc'
    && !active.some(device => device.employee_id === employee.id)
    && !exemptions.some(exemption => exemption.employee_id === employee.id));

  const exemptCandidates = employees.filter(employee =>
    employee.status === 'Đang làm việc' && !exemptions.some(exemption => exemption.employee_id === employee.id));

  const card = 'rounded-2xl border border-border bg-card p-4';

  return (
    <div className="space-y-4">
      <div className={`${card} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mint-100 text-mint-700 dark:bg-mint-900/40 dark:text-mint-300">
            <ShieldCheck size={20} />
          </div>
          <div>
            <p className="text-sm font-black text-foreground">Chống chấm công hộ</p>
            <p className="text-xs text-muted-foreground">
              Mỗi người một điện thoại; mỗi lần chấm mở khóa bằng vân tay / Face ID của chính máy đó. Công ty không lưu vân tay hay khuôn mặt.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-lg px-2 py-1 text-[11px] font-black ${required ? 'bg-leaf-100 text-leaf-800 dark:bg-leaf-900/40 dark:text-leaf-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
            {required === null ? 'Chưa rõ' : required ? 'Đang bắt buộc' : 'Đang tắt'}
          </span>
          {canManageSettings && required !== null && (
            <button type="button" onClick={() => void toggleRequired()} disabled={busyId === 'setting'}
              className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-50">
              {required ? 'Tắt' : 'Bật'}
            </button>
          )}
          <button type="button" onClick={() => void load()} className="rounded-xl border border-border p-2 text-muted-foreground hover:bg-muted" aria-label="Tải lại">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loadError && <p className="text-sm font-bold text-rose-600">{loadError}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Chờ duyệt', value: pending.length, tone: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300', icon: Smartphone },
          { label: 'Lượt nghi vấn (30 ngày)', value: flagged.length, tone: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300', icon: AlertTriangle },
          { label: 'Đã đăng ký', value: active.length, tone: 'bg-leaf-50 text-leaf-700 dark:bg-leaf-900/30 dark:text-leaf-300', icon: CheckCircle2 },
          { label: 'Chưa đăng ký', value: withoutPhone.length, tone: 'bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300', icon: UserX },
        ].map(tile => (
          <div key={tile.label} className={`rounded-2xl p-3 ${tile.tone}`}>
            <tile.icon size={16} />
            <p className="mt-1 text-[11px] font-bold">{tile.label}</p>
            <p className="text-2xl font-black">{loading ? '…' : tile.value}</p>
          </div>
        ))}
      </div>

      <section className={card}>
        <h3 className="mb-3 text-sm font-black text-foreground">Điện thoại chờ duyệt</h3>
        {pending.length === 0 ? (
          <p className="text-xs text-muted-foreground">Không có điện thoại nào chờ duyệt.</p>
        ) : (
          <div className="divide-y divide-border">
            {pending.map(device => (
              <div key={device.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-mint-700 dark:text-mint-300">{employeeName(device.employee_id)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {device.device_label || 'Điện thoại'} · đăng ký {formatDateTime(device.registered_at)}
                  </p>
                  {device.pending_reason === 'shared_device' && (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-rose-600">
                      <AlertTriangle size={12} /> Điện thoại này đã được đăng ký cho người khác — kiểm tra trực tiếp trước khi duyệt
                    </p>
                  )}
                  {device.pending_reason === 'new_device' && (
                    <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">Đổi sang điện thoại mới</p>
                  )}
                </div>
                <button type="button" disabled={busyId === device.id} onClick={() => void decide(device, 'approve')}
                  className="inline-flex items-center gap-1 rounded-xl bg-leaf-600 px-3 py-2 text-xs font-black text-white hover:bg-leaf-700 disabled:opacity-50">
                  <CheckCircle2 size={14} /> Duyệt
                </button>
                <button type="button" disabled={busyId === device.id} onClick={() => void decide(device, 'revoke')}
                  className="inline-flex items-center gap-1 rounded-xl border border-rose-200 px-3 py-2 text-xs font-black text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                  <XCircle size={14} /> Từ chối
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={card}>
        <h3 className="mb-3 text-sm font-black text-foreground">Lượt chấm nghi vấn — 30 ngày</h3>
        {flagged.length === 0 ? (
          <p className="text-xs text-muted-foreground">Chưa có lượt chấm nào bị gắn cờ.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {flagged.map(row => (
              <div key={row.id} className="flex gap-3 rounded-xl border border-border p-2">
                <AttendancePhoto url={row.checkInPhoto} alt="Ảnh chấm công" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-black text-mint-700 dark:text-mint-300">{employeeName(row.employeeId)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(row.date).toLocaleDateString('vi-VN')} · Vào {row.checkIn || '--:--'} · Ra {row.checkOut || '--:--'}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">{row.locationName || '—'}</p>
                  {(row.suspicionFlags || []).filter(flag => flag !== 'no_passkey').map(flag => (
                    <p key={flag} className="text-[11px] font-bold text-rose-600">{FLAG_LABELS[flag] || flag}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={card}>
        <h3 className="mb-3 text-sm font-black text-foreground">Điện thoại đang dùng ({active.length})</h3>
        {active.length === 0 ? (
          <p className="text-xs text-muted-foreground">Chưa ai đăng ký điện thoại. Nhân viên đăng ký ngay ở lần chấm công đầu tiên.</p>
        ) : (
          <div className="divide-y divide-border">
            {active.map(device => (
              <div key={device.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-mint-700 dark:text-mint-300">{employeeName(device.employee_id)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {device.device_label || 'Điện thoại'} · dùng gần nhất {formatDateTime(device.last_used_at)}
                  </p>
                </div>
                <button type="button" disabled={busyId === device.id} onClick={() => void decide(device, 'revoke')}
                  className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-muted disabled:opacity-50">
                  <ShieldOff size={14} /> Thu hồi
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={card}>
        <h3 className="mb-1 text-sm font-black text-foreground">Miễn xác thực vân tay / Face ID</h3>
        <p className="mb-3 text-xs text-muted-foreground">Dành cho điện thoại đời cũ không hỗ trợ. Các lượt chấm của người được miễn vẫn có ảnh, GPS và được gắn nhãn để theo dõi.</p>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <SearchableSelect
            value={newExemptEmployee || null}
            options={exemptCandidates}
            onChange={employee => setNewExemptEmployee(employee?.id || '')}
            getOptionValue={employee => employee.id}
            getOptionLabel={employee => `${employee.fullName}${employee.employeeCode ? ` (${employee.employeeCode})` : ''}`}
            getOptionSearchText={employee => [employee.fullName, employee.employeeCode].filter(Boolean).join(' ')}
            placeholder="Gõ tên hoặc mã nhân viên…"
            emptyLabel="Không tìm thấy nhân viên"
            className="flex-1"
          />
          <input type="date" value={newExemptUntil} onChange={event => setNewExemptUntil(event.target.value)} title="Miễn đến ngày (để trống = không thời hạn)"
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm" />
          <button type="button" onClick={() => void addExemption()} disabled={!newExemptEmployee || busyId === 'exempt'}
            className="rounded-xl bg-mint-600 px-4 py-2 text-xs font-black text-white hover:bg-mint-700 disabled:opacity-40">
            Miễn
          </button>
        </div>
        {exemptions.length > 0 && (
          <div className="divide-y divide-border">
            {exemptions.map(exemption => (
              <div key={exemption.employee_id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-mint-700 dark:text-mint-300">{employeeName(exemption.employee_id)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {exemption.reason} · {exemption.valid_until ? `đến ${new Date(exemption.valid_until).toLocaleDateString('vi-VN')}` : 'không thời hạn'}
                  </p>
                </div>
                <button type="button" disabled={busyId === `exempt-${exemption.employee_id}`} onClick={() => void removeExemption(exemption.employee_id)}
                  className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-muted disabled:opacity-50">
                  Bỏ miễn
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default AttendanceDevicesPanel;
