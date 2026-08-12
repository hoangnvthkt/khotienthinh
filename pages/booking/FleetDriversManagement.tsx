import React, { useEffect, useMemo, useState } from 'react';
import { CalendarOff, Plus, RefreshCw, ShieldCheck, UserRoundCog, X } from 'lucide-react';
import type {
  OperatorUnavailabilityPeriod,
  OperatorUnavailabilityReason,
  FleetVehicleTypeOption,
  VehicleDriverAuthorizationAdminView,
  VehicleDriverCandidate,
} from '../../types/vehicleBooking';
import {
  cancelOperatorUnavailability,
  createOperatorUnavailability,
  fetchOperatorUnavailabilityPeriods,
  fetchFleetVehicleTypeOptions,
  fetchVehicleDriverAuthorizationsAdmin,
  uploadEvidenceImage,
  upsertDriverAuthorization,
} from '../../lib/vehicleBookingService';
import { useToast } from '../../context/ToastContext';

type Props = { fetchCandidates: () => Promise<VehicleDriverCandidate[]> };

type DriverDraft = {
  userId: string;
  employeeId: string;
  authorizationType: 'PROFESSIONAL_DRIVER' | 'SELF_DRIVE';
  licenseNumber: string;
  licenseClass: string;
  licenseExpiry: string;
  healthCheckExpiryDate: string;
  allowedVehicleTypes: string[];
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  note: string;
};

const emptyDraft = (): DriverDraft => ({
  userId: '', employeeId: '', authorizationType: 'PROFESSIONAL_DRIVER', licenseNumber: '',
  licenseClass: 'B2', licenseExpiry: '', healthCheckExpiryDate: '', allowedVehicleTypes: [],
  status: 'ACTIVE', note: '',
});

const toInputDateTime = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const Avatar: React.FC<{ url?: string | null; name?: string | null; size?: string }> = ({ url, name, size = 'h-12 w-12' }) => url
  ? <img src={url} alt={name || 'Nhân sự'} className={`${size} rounded-full object-cover`} />
  : <div className={`${size} flex items-center justify-center rounded-full bg-amber-100 font-bold text-amber-700`}>{(name || '?').split(' ').slice(-2).map(word => word[0]).join('').toUpperCase()}</div>;

const FleetDriversManagement: React.FC<Props> = ({ fetchCandidates }) => {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drivers, setDrivers] = useState<VehicleDriverAuthorizationAdminView[]>([]);
  const [candidates, setCandidates] = useState<VehicleDriverCandidate[]>([]);
  const [periods, setPeriods] = useState<OperatorUnavailabilityPeriod[]>([]);
  const [vehicleTypeOptions, setVehicleTypeOptions] = useState<FleetVehicleTypeOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<VehicleDriverAuthorizationAdminView | null>(null);
  const [draft, setDraft] = useState<DriverDraft>(emptyDraft);
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [search, setSearch] = useState('');
  const [awayUserId, setAwayUserId] = useState('');
  const [awayStart, setAwayStart] = useState(toInputDateTime(new Date()));
  const [awayEnd, setAwayEnd] = useState(toInputDateTime(new Date(Date.now() + 8 * 3600000)));
  const [awayReason, setAwayReason] = useState<OperatorUnavailabilityReason>('LEAVE');
  const [awayNote, setAwayNote] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      const [driverRows, candidateRows, periodRows, typeOptions] = await Promise.all([
        fetchVehicleDriverAuthorizationsAdmin(),
        fetchCandidates(),
        fetchOperatorUnavailabilityPeriods(),
        fetchFleetVehicleTypeOptions(),
      ]);
      setDrivers(driverRows);
      setCandidates(candidateRows);
      setPeriods(periodRows);
      setVehicleTypeOptions(typeOptions);
    } catch (error: any) {
      toast.error(error.message || 'Không thể tải danh sách tài xế.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, []);

  const filteredCandidates = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi');
    if (!query) return candidates;
    return candidates.filter(candidate => [candidate.employee_code, candidate.employee_name, candidate.employee_title]
      .some(value => value?.toLocaleLowerCase('vi').includes(query)));
  }, [candidates, search]);

  const selectedCandidate = candidates.find(candidate => candidate.user_id === draft.userId);

  const openCreate = () => {
    setEditing(null); setDraft(emptyDraft()); setFrontFile(null); setBackFile(null); setShowForm(true);
  };

  const openEdit = (driver: VehicleDriverAuthorizationAdminView) => {
    setEditing(driver);
    setDraft({
      userId: driver.user_id,
      employeeId: driver.employee_id || '',
      authorizationType: driver.authorization_type,
      licenseNumber: driver.license_number,
      licenseClass: driver.license_class,
      licenseExpiry: driver.license_expiry,
      healthCheckExpiryDate: driver.health_check_expiry_date || '',
      allowedVehicleTypes: driver.allowed_vehicle_types || [],
      status: driver.status,
      note: driver.note || '',
    });
    setFrontFile(null); setBackFile(null); setShowForm(true);
  };

  const saveDriver = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.userId || !draft.employeeId || !draft.licenseNumber || !draft.licenseExpiry) {
      toast.error('Vui lòng chọn nhân sự HRM và nhập đầy đủ thông tin bằng lái.');
      return;
    }
    if (draft.allowedVehicleTypes.length === 0) {
      toast.error('Vui lòng chọn ít nhất một loại xe được phép lái.');
      return;
    }
    if (draft.allowedVehicleTypes.some(value => !vehicleTypeOptions.some(option => option.vehicle_type === value))) {
      toast.error('Hồ sơ còn loại xe cũ không thuộc danh mục Fleet. Vui lòng xóa giá trị cũ trước khi lưu.');
      return;
    }
    try {
      setSaving(true);
      const frontPath = frontFile ? await uploadEvidenceImage(frontFile, `licenses/${draft.userId}`, 5) : editing?.license_front_photo_path || undefined;
      const backPath = backFile ? await uploadEvidenceImage(backFile, `licenses/${draft.userId}`, 5) : editing?.license_back_photo_path || undefined;
      await upsertDriverAuthorization({
        target_user_id: draft.userId,
        employee_id: draft.employeeId,
        authorization_type: draft.authorizationType,
        license_number: draft.licenseNumber.trim(),
        license_class: draft.licenseClass.trim(),
        license_expiry: draft.licenseExpiry,
        license_front_photo_path: frontPath,
        license_back_photo_path: backPath,
        health_check_expiry_date: draft.healthCheckExpiryDate || undefined,
        allowed_vehicle_types: draft.allowedVehicleTypes,
        status: draft.status,
        note: draft.note || undefined,
      });
      toast.success(editing ? 'Đã cập nhật ủy quyền tài xế.' : 'Đã thêm tài xế từ HRM.');
      setShowForm(false);
      await loadData();
    } catch (error: any) {
      toast.error(error.message || 'Không thể lưu ủy quyền tài xế.');
    } finally {
      setSaving(false);
    }
  };

  const createAwayPeriod = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await createOperatorUnavailability({
        operator_user_id: awayUserId,
        start_at: new Date(awayStart).toISOString(),
        end_at: new Date(awayEnd).toISOString(),
        reason_code: awayReason,
        note: awayNote || undefined,
      });
      toast.success('Đã tạo lịch nghỉ/không khả dụng.');
      setAwayNote('');
      await loadData();
    } catch (error: any) {
      toast.error(error.message || 'Không thể tạo lịch nghỉ.');
    }
  };

  return <div className="space-y-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 text-base font-bold"><UserRoundCog className="h-5 w-5 text-amber-500" />Quản lý tài xế</h2><p className="mt-1 text-xs text-slate-500">Ủy quyền lái xe cho nhân sự HRM đang làm việc và đã có tài khoản.</p></div><div className="flex gap-2"><button onClick={() => void loadData()} className="rounded-xl border p-2"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button><button onClick={openCreate} className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white"><Plus className="h-4 w-4" />Thêm tài xế từ HRM</button></div></header>

    {!loading && drivers.length === 0 ? <div className="rounded-2xl border border-dashed bg-white p-10 text-center dark:bg-slate-800"><UserRoundCog className="mx-auto h-10 w-10 text-slate-300" /><h3 className="mt-3 text-sm font-bold">Chưa có tài xế được ủy quyền</h3><button onClick={openCreate} className="mt-4 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white">Chọn từ HRM</button></div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{drivers.map(driver => <article key={driver.id} className="rounded-2xl border bg-white p-4 dark:bg-slate-800"><div className="flex items-center gap-3"><Avatar url={driver.employee_avatar_url} name={driver.employee_name} /><div className="min-w-0 flex-1"><div className="truncate font-bold">{driver.employee_name || driver.user_id}</div><div className="truncate text-xs text-slate-500">{driver.employee_code} · {driver.employee_title}</div></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${driver.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{driver.status}</span></div><div className="mt-4 space-y-1 text-xs"><p>{driver.authorization_type === 'PROFESSIONAL_DRIVER' ? 'Tài xế chuyên trách' : 'Nhân viên tự lái'}</p><p>Bằng {driver.license_class} · {driver.license_number}</p><p>Hết hạn: {new Date(driver.license_expiry).toLocaleDateString('vi-VN')}</p></div><button onClick={() => openEdit(driver)} className="mt-4 w-full rounded-xl border py-2 text-xs font-bold"><ShieldCheck className="mr-1 inline h-4 w-4" />Sửa / đình chỉ</button></article>)}</div>}

    <section className="rounded-2xl border bg-white p-5 dark:bg-slate-800"><h3 className="flex items-center gap-2 text-sm font-bold"><CalendarOff className="h-4 w-4 text-amber-500" />Lịch nghỉ và không khả dụng</h3><form onSubmit={createAwayPeriod} className="mt-4 grid gap-3 md:grid-cols-5"><select required value={awayUserId} onChange={event => setAwayUserId(event.target.value)} className="rounded-xl border p-2 text-xs"><option value="">Chọn tài xế</option>{drivers.filter(driver => driver.status === 'ACTIVE').map(driver => <option key={driver.user_id} value={driver.user_id}>{driver.employee_name || driver.user_id}</option>)}</select><input required type="datetime-local" value={awayStart} onChange={event => setAwayStart(event.target.value)} className="rounded-xl border p-2 text-xs" /><input required type="datetime-local" value={awayEnd} onChange={event => setAwayEnd(event.target.value)} className="rounded-xl border p-2 text-xs" /><select value={awayReason} onChange={event => setAwayReason(event.target.value as OperatorUnavailabilityReason)} className="rounded-xl border p-2 text-xs"><option value="LEAVE">Nghỉ phép</option><option value="SICK">Nghỉ ốm</option><option value="OFFLINE">Không trực</option><option value="OTHER">Khác</option></select><button className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">Tạo lịch</button><input value={awayNote} onChange={event => setAwayNote(event.target.value)} placeholder="Ghi chú" className="rounded-xl border p-2 text-xs md:col-span-5" /></form><div className="mt-4 space-y-2">{periods.map(period => <div key={period.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-900"><span>{drivers.find(driver => driver.user_id === period.operator_user_id)?.employee_name || period.operator_user_id} · {new Date(period.start_at).toLocaleString('vi-VN')} – {new Date(period.end_at).toLocaleString('vi-VN')} · {period.reason_code}</span><button onClick={async () => { await cancelOperatorUnavailability(period.id, 'Hủy từ màn hình quản lý'); await loadData(); }} className="font-bold text-rose-600">Hủy</button></div>)}</div></section>

    {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"><form onSubmit={saveDriver} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 dark:bg-slate-800"><div className="mb-5 flex items-center justify-between"><h3 className="font-bold">{editing ? 'Cập nhật ủy quyền tài xế' : 'Thêm tài xế từ HRM'}</h3><button type="button" onClick={() => setShowForm(false)}><X /></button></div>
      {!editing && <><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm theo tên, mã nhân viên hoặc chức danh" className="mb-2 w-full rounded-xl border p-2.5 text-xs" /><div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border p-2">{filteredCandidates.map(candidate => <button type="button" key={candidate.user_id} onClick={() => setDraft(previous => ({ ...previous, userId: candidate.user_id, employeeId: candidate.employee_id }))} className={`flex w-full items-center gap-3 rounded-xl p-2 text-left ${draft.userId === candidate.user_id ? 'bg-amber-50 ring-1 ring-amber-300' : 'hover:bg-slate-50'}`}><Avatar url={candidate.employee_avatar_url} name={candidate.employee_name} size="h-9 w-9" /><span className="min-w-0"><span className="block truncate text-xs font-bold">{candidate.employee_name}</span><span className="block truncate text-[10px] text-slate-500">{candidate.employee_code} · {candidate.employee_title}</span></span></button>)}</div></>}
      {(editing || selectedCandidate) && <div className="mt-3 flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900"><Avatar url={editing?.employee_avatar_url || selectedCandidate?.employee_avatar_url} name={editing?.employee_name || selectedCandidate?.employee_name} /><div><div className="font-bold">{editing?.employee_name || selectedCandidate?.employee_name}</div><div className="text-xs text-slate-500">{editing?.employee_code || selectedCandidate?.employee_code} · {editing?.employee_title || selectedCandidate?.employee_title}</div></div></div>}
      <div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-xs font-bold">Loại ủy quyền<select value={draft.authorizationType} onChange={event => setDraft(previous => ({ ...previous, authorizationType: event.target.value as DriverDraft['authorizationType'] }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal"><option value="PROFESSIONAL_DRIVER">Tài xế chuyên trách</option><option value="SELF_DRIVE">Nhân viên tự lái</option></select></label><label className="text-xs font-bold">Trạng thái<select value={draft.status} onChange={event => setDraft(previous => ({ ...previous, status: event.target.value as DriverDraft['status'] }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal"><option value="ACTIVE">Đang hoạt động</option><option value="SUSPENDED">Đình chỉ</option><option value="EXPIRED">Hết hạn</option></select></label><label className="text-xs font-bold">Số bằng lái<input required value={draft.licenseNumber} onChange={event => setDraft(previous => ({ ...previous, licenseNumber: event.target.value }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal" /></label><label className="text-xs font-bold">Hạng bằng<input required value={draft.licenseClass} onChange={event => setDraft(previous => ({ ...previous, licenseClass: event.target.value }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal" /></label><label className="text-xs font-bold">Hạn bằng<input required type="date" value={draft.licenseExpiry} onChange={event => setDraft(previous => ({ ...previous, licenseExpiry: event.target.value }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal" /></label><label className="text-xs font-bold">Hạn khám sức khỏe<input type="date" value={draft.healthCheckExpiryDate} onChange={event => setDraft(previous => ({ ...previous, healthCheckExpiryDate: event.target.value }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal" /></label><fieldset className="text-xs font-bold md:col-span-2"><legend>Loại xe được lái *</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{vehicleTypeOptions.map(option => { const checked = draft.allowedVehicleTypes.includes(option.vehicle_type); return <label key={option.vehicle_type} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 font-normal ${checked ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-700'}`}><input type="checkbox" checked={checked} onChange={() => setDraft(previous => ({ ...previous, allowedVehicleTypes: checked ? previous.allowedVehicleTypes.filter(value => value !== option.vehicle_type) : [...previous.allowedVehicleTypes, option.vehicle_type] }))} /><span>{option.vehicle_type} <span className="text-slate-400">({option.vehicle_count} xe)</span></span></label>; })}</div>{vehicleTypeOptions.length === 0 && <p className="mt-2 rounded-xl bg-amber-50 p-3 font-normal text-amber-700">Chưa có loại xe trong Fleet. Vui lòng cấu hình hồ sơ xe trước.</p>}{draft.allowedVehicleTypes.filter(value => !vehicleTypeOptions.some(option => option.vehicle_type === value)).length > 0 && <div className="mt-2 rounded-xl bg-rose-50 p-3 font-normal text-rose-700"><p>Giá trị cũ không còn thuộc danh mục Fleet: {draft.allowedVehicleTypes.filter(value => !vehicleTypeOptions.some(option => option.vehicle_type === value)).join(', ')}.</p><button type="button" onClick={() => setDraft(previous => ({ ...previous, allowedVehicleTypes: previous.allowedVehicleTypes.filter(value => vehicleTypeOptions.some(option => option.vehicle_type === value)) }))} className="mt-2 rounded-lg border border-rose-300 px-3 py-1 font-bold">Xóa giá trị cũ</button></div>}</fieldset><label className="text-xs font-bold">Ảnh mặt trước bằng lái<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setFrontFile(event.target.files?.[0] || null)} className="mt-1 w-full rounded-xl border p-2 text-xs font-normal" /></label><label className="text-xs font-bold">Ảnh mặt sau bằng lái<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setBackFile(event.target.files?.[0] || null)} className="mt-1 w-full rounded-xl border p-2 text-xs font-normal" /></label><label className="text-xs font-bold md:col-span-2">Ghi chú<textarea value={draft.note} onChange={event => setDraft(previous => ({ ...previous, note: event.target.value }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal" /></label></div>
      <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setShowForm(false)} className="rounded-xl border px-4 py-2 text-xs font-bold">Hủy</button><button disabled={saving} className="rounded-xl bg-amber-500 px-5 py-2 text-xs font-bold text-white">{saving ? 'Đang lưu...' : 'Lưu ủy quyền'}</button></div>
    </form></div>}
  </div>;
};

export default FleetDriversManagement;
