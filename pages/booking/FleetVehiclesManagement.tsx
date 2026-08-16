import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus, Camera, Car, Eye, MapPin, Plus, RefreshCw, Wrench, X } from 'lucide-react';
import type {
  FleetLocation,
  FleetVehicleCandidate,
  FleetVehicleProfileView,
  VehicleAvailabilityStatus,
  VehicleUnavailabilityPeriod,
  VehicleUnavailabilityReason,
} from '../../types/vehicleBooking';
import {
  cancelVehicleUnavailability,
  createVehicleUnavailability,
  fetchFleetLocations,
  fetchFleetVehicleProfiles,
  fetchVehicleUnavailabilityPeriods,
  getFleetInspectionEvidenceValidationError,
  resolvePrivateEvidencePreviewItems,
  setFleetVehicleAssetImage,
  uploadEvidenceImage,
  upsertFleetLocation,
  upsertFleetVehicleProfile,
} from '../../lib/vehicleBookingService';
import { deleteAssetImage, uploadAssetImage, validateAssetImageFile } from '../../lib/assetImageService';
import { useToast } from '../../context/ToastContext';
import PrivateEvidencePreviewModal, { type PrivateEvidencePreviewItem } from '../../components/booking/PrivateEvidencePreviewModal';

type Props = { fetchCandidates: () => Promise<FleetVehicleCandidate[]> };

type VehicleDraft = {
  assetId: string;
  vehicleType: string;
  seatCount: number;
  status: VehicleAvailabilityStatus;
  allowSelfDrive: boolean;
  homeBaseId: string;
  parkingSpotCode: string;
  inspectionCertificateNumber: string;
  inspectionExpiryDate: string;
  insuranceExpiryDate: string;
};

const emptyDraft = (): VehicleDraft => ({
  assetId: '',
  vehicleType: 'Xe con',
  seatCount: 5,
  status: 'AVAILABLE',
  allowSelfDrive: false,
  homeBaseId: '',
  parkingSpotCode: '',
  inspectionCertificateNumber: '',
  inspectionExpiryDate: '',
  insuranceExpiryDate: '',
});

const toInputDateTime = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const FleetVehiclesManagement: React.FC<Props> = ({ fetchCandidates }) => {
  const toast = useToast();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const inspectionInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vehicles, setVehicles] = useState<FleetVehicleProfileView[]>([]);
  const [candidates, setCandidates] = useState<FleetVehicleCandidate[]>([]);
  const [locations, setLocations] = useState<FleetLocation[]>([]);
  const [periods, setPeriods] = useState<VehicleUnavailabilityPeriod[]>([]);
  const [editing, setEditing] = useState<FleetVehicleProfileView | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<VehicleDraft>(emptyDraft);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [inspectionFile, setInspectionFile] = useState<File | null>(null);
  const [newLocationName, setNewLocationName] = useState('');
  const [blockAssetId, setBlockAssetId] = useState('');
  const [blockStart, setBlockStart] = useState(toInputDateTime(new Date()));
  const [blockEnd, setBlockEnd] = useState(toInputDateTime(new Date(Date.now() + 2 * 3600000)));
  const [blockReason, setBlockReason] = useState<VehicleUnavailabilityReason>('MAINTENANCE');
  const [blockNote, setBlockNote] = useState('');
  const [evidencePreview, setEvidencePreview] = useState<{
    title: string;
    items: PrivateEvidencePreviewItem[];
    error?: string;
  } | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [vehicleRows, candidateRows, locationRows, periodRows] = await Promise.all([
        fetchFleetVehicleProfiles(),
        fetchCandidates(),
        fetchFleetLocations(),
        fetchVehicleUnavailabilityPeriods(),
      ]);
      setVehicles(vehicleRows);
      setCandidates(candidateRows);
      setLocations(locationRows);
      setPeriods(periodRows);
    } catch (error: any) {
      toast.error(error.message || 'Không thể tải danh mục xe.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, []);

  const candidate = candidates.find(item => item.asset_id === draft.assetId);
  const parkingSpots = useMemo(() => Array.from(new Set(vehicles
    .map(vehicle => vehicle.parking_spot_code)
    .filter((value): value is string => Boolean(value)))), [vehicles]);

  const openCreate = () => {
    setEditing(null);
    setDraft(emptyDraft());
    setImageFile(null);
    setImagePreview('');
    setInspectionFile(null);
    setShowForm(true);
  };

  const openEdit = (vehicle: FleetVehicleProfileView) => {
    setEditing(vehicle);
    setDraft({
      assetId: vehicle.asset_id,
      vehicleType: vehicle.vehicle_type,
      seatCount: vehicle.seat_count,
      status: vehicle.availability_status,
      allowSelfDrive: vehicle.allow_self_drive,
      homeBaseId: vehicle.home_base_id || '',
      parkingSpotCode: vehicle.parking_spot_code || '',
      inspectionCertificateNumber: vehicle.inspection_certificate_number || '',
      inspectionExpiryDate: vehicle.inspection_expiry_date || '',
      insuranceExpiryDate: vehicle.insurance_expiry_date || '',
    });
    setImageFile(null);
    setImagePreview(vehicle.asset_image_url || '');
    setInspectionFile(null);
    setShowForm(true);
  };

  const openInspectionPreview = async (vehicle: FleetVehicleProfileView) => {
    const title = `Ảnh đăng kiểm ${vehicle.asset_code} · ${vehicle.asset_name}`;
    setEvidencePreview({ title, items: [] });
    try {
      const items = await resolvePrivateEvidencePreviewItems([
        { label: 'Ảnh đăng kiểm', path: vehicle.inspection_photo_path },
      ]);
      setEvidencePreview({
        title,
        items,
        error: items.length === 0 ? 'Không thể tải ảnh đăng kiểm. Vui lòng kiểm tra quyền truy cập hoặc thử lại.' : undefined,
      });
    } catch {
      setEvidencePreview({ title, items: [], error: 'Không thể tải ảnh đăng kiểm. Vui lòng thử lại.' });
    }
  };

  const chooseImage = (file?: File) => {
    if (!file) return;
    const validationError = validateAssetImageFile(file);
    if (validationError) {
      toast.error(validationError === 'INVALID_ASSET_IMAGE_TYPE'
        ? 'Ảnh xe chỉ nhận JPG, PNG hoặc WebP.'
        : 'Ảnh xe không được vượt quá 5 MB.');
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const saveVehicle = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.assetId || !draft.homeBaseId || !draft.vehicleType.trim() || draft.seatCount < 1) {
      toast.error('Vui lòng chọn tài sản xe, bãi xe, loại xe và số chỗ hợp lệ.');
      return;
    }
    const inspectionEvidenceError = getFleetInspectionEvidenceValidationError({
      inspectionCertificateNumber: draft.inspectionCertificateNumber,
      inspectionExpiryDate: draft.inspectionExpiryDate,
      inspectionPhotoPath: inspectionFile ? 'pending-upload' : editing?.inspection_photo_path,
    });
    if (inspectionEvidenceError) {
      toast.error('Vui lòng đính kèm ảnh đăng kiểm trước khi lưu hồ sơ xe.');
      return;
    }
    let newImageUrl: string | null = null;
    const previousImageUrl = editing?.asset_image_url || candidate?.asset_image_url || '';
    try {
      setSaving(true);
      if (imageFile) {
        newImageUrl = (await uploadAssetImage(imageFile, draft.assetId)).url;
        await setFleetVehicleAssetImage(draft.assetId, newImageUrl);
      }
      const inspectionPhotoPath = inspectionFile
        ? await uploadEvidenceImage(inspectionFile, `fleet/${draft.assetId}`, 5)
        : editing?.inspection_photo_path || undefined;
      await upsertFleetVehicleProfile({
        asset_id: draft.assetId,
        home_base_id: draft.homeBaseId || undefined,
        vehicle_type: draft.vehicleType.trim(),
        seat_count: draft.seatCount,
        availability_status: draft.status,
        allow_self_drive: draft.allowSelfDrive,
        inspection_certificate_number: draft.inspectionCertificateNumber || undefined,
        inspection_expiry_date: draft.inspectionExpiryDate || undefined,
        inspection_photo_path: inspectionPhotoPath,
        insurance_expiry_date: draft.insuranceExpiryDate || undefined,
        parking_spot_code: draft.parkingSpotCode || undefined,
      });
      if (newImageUrl && editing?.asset_image_url && editing.asset_image_url !== newImageUrl) {
        await deleteAssetImage(editing.asset_image_url).catch(() => undefined);
      }
      toast.success(editing ? 'Đã cập nhật hồ sơ xe.' : 'Đã đưa tài sản vào đội xe.');
      setShowForm(false);
      await loadData();
    } catch (error: any) {
      if (newImageUrl) {
        await setFleetVehicleAssetImage(draft.assetId, previousImageUrl).catch(() => undefined);
        await deleteAssetImage(newImageUrl).catch(() => undefined);
      }
      toast.error(error.message === 'ASSET_IMAGE_TOO_LARGE'
        ? 'Ảnh xe vẫn vượt quá 5 MB sau khi nén.'
        : error.message || 'Không thể lưu hồ sơ xe.');
    } finally {
      setSaving(false);
    }
  };

  const createLocation = async () => {
    if (!newLocationName.trim()) return;
    try {
      const result = await upsertFleetLocation({ name: newLocationName.trim(), source_type: 'CUSTOM' });
      setNewLocationName('');
      const refreshed = await fetchFleetLocations();
      setLocations(refreshed);
      setDraft(previous => ({ ...previous, homeBaseId: result.id }));
    } catch (error: any) {
      toast.error(error.message || 'Không thể tạo bãi xe.');
    }
  };

  const createBlock = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await createVehicleUnavailability({
        vehicle_asset_id: blockAssetId,
        start_at: new Date(blockStart).toISOString(),
        end_at: new Date(blockEnd).toISOString(),
        reason_code: blockReason,
        note: blockNote || undefined,
      });
      toast.success('Đã tạo lịch bảo dưỡng/khóa xe.');
      setBlockNote('');
      await loadData();
    } catch (error: any) {
      toast.error(error.message || 'Không thể tạo lịch không khả dụng.');
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="flex items-center gap-2 text-base font-bold"><Car className="h-5 w-5 text-amber-500" />Quản lý xe</h2><p className="mt-1 text-xs text-slate-500">Đội xe được liên kết từ danh mục Tài sản.</p></div>
        <div className="flex gap-2"><button onClick={() => void loadData()} className="rounded-xl border p-2" title="Làm mới"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button><button onClick={openCreate} className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white"><Plus className="h-4 w-4" />Thêm xe từ Tài sản</button></div>
      </header>

      {!loading && vehicles.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center dark:bg-slate-800"><Car className="mx-auto h-10 w-10 text-slate-300" /><h3 className="mt-3 text-sm font-bold">Chưa có xe trong đội xe Booking</h3><p className="mt-1 text-xs text-slate-500">Chọn một tài sản thuộc nhóm Phương tiện để bắt đầu.</p><button onClick={openCreate} className="mt-4 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white">Thêm xe</button></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {vehicles.map(vehicle => <article key={vehicle.asset_id} className="overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-slate-800">
            {vehicle.asset_image_url ? <img src={vehicle.asset_image_url} alt={vehicle.asset_name} className="h-40 w-full object-cover" /> : <div className="flex h-40 items-center justify-center bg-slate-100 dark:bg-slate-700"><Car className="h-12 w-12 text-slate-300" /></div>}
            <div className="space-y-3 p-4"><div className="flex items-start justify-between"><div><div className="font-bold">{vehicle.asset_code} · {vehicle.asset_name}</div><div className="text-xs text-slate-500">{vehicle.asset_brand} {vehicle.asset_model}</div></div><span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700">{vehicle.availability_status}</span></div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300"><span>{vehicle.vehicle_type} · {vehicle.seat_count} chỗ</span><span>{vehicle.parking_spot_code || 'Chưa có ô đỗ'}</span><span>{vehicle.home_base_name || 'Chưa có bãi xe'}</span><span>{vehicle.current_odometer} km</span><span className={vehicle.inspection_photo_path ? 'text-emerald-600' : 'text-rose-600'}>{vehicle.inspection_photo_path ? 'Đã lưu ảnh đăng kiểm' : 'Chưa có ảnh đăng kiểm'}</span></div>
              <div className="grid grid-cols-2 gap-2">{vehicle.inspection_photo_path && <button type="button" onClick={() => void openInspectionPreview(vehicle)} className="rounded-xl border py-2 text-xs font-bold text-amber-700"><Eye className="mr-1 inline h-4 w-4" />Xem đăng kiểm</button>}<button onClick={() => openEdit(vehicle)} className={`${vehicle.inspection_photo_path ? '' : 'col-span-2'} rounded-xl border py-2 text-xs font-bold`}><Wrench className="mr-1 inline h-4 w-4" />Cập nhật hồ sơ</button></div>
            </div>
          </article>)}
        </div>
      )}

      <section className="rounded-2xl border bg-white p-5 dark:bg-slate-800"><h3 className="flex items-center gap-2 text-sm font-bold"><CalendarPlus className="h-4 w-4 text-amber-500" />Lịch bảo dưỡng và khóa xe</h3>
        <form onSubmit={createBlock} className="mt-4 grid gap-3 md:grid-cols-5"><select required value={blockAssetId} onChange={event => setBlockAssetId(event.target.value)} className="rounded-xl border p-2 text-xs"><option value="">Chọn xe</option>{vehicles.map(vehicle => <option key={vehicle.asset_id} value={vehicle.asset_id}>{vehicle.asset_code} · {vehicle.asset_name}</option>)}</select><input required type="datetime-local" value={blockStart} onChange={event => setBlockStart(event.target.value)} className="rounded-xl border p-2 text-xs" /><input required type="datetime-local" value={blockEnd} onChange={event => setBlockEnd(event.target.value)} className="rounded-xl border p-2 text-xs" /><select value={blockReason} onChange={event => setBlockReason(event.target.value as VehicleUnavailabilityReason)} className="rounded-xl border p-2 text-xs"><option value="MAINTENANCE">Bảo dưỡng</option><option value="REPAIR">Sửa chữa</option><option value="LOCKED">Khóa xe</option><option value="OTHER">Khác</option></select><button className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">Tạo lịch</button><input value={blockNote} onChange={event => setBlockNote(event.target.value)} placeholder="Ghi chú" className="rounded-xl border p-2 text-xs md:col-span-5" /></form>
        <div className="mt-4 space-y-2">{periods.map(period => <div key={period.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-900"><span>{vehicles.find(vehicle => vehicle.asset_id === period.vehicle_asset_id)?.asset_code || period.vehicle_asset_id} · {new Date(period.start_at).toLocaleString('vi-VN')} – {new Date(period.end_at).toLocaleString('vi-VN')} · {period.reason_code}</span><button onClick={async () => { await cancelVehicleUnavailability(period.id, 'Hủy từ màn hình quản lý'); await loadData(); }} className="font-bold text-rose-600">Hủy</button></div>)}</div>
      </section>

      {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"><form onSubmit={saveVehicle} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 dark:bg-slate-800"><div className="mb-5 flex items-center justify-between"><h3 className="font-bold">{editing ? `Cập nhật ${editing.asset_code}` : 'Thêm xe từ Module Tài sản'}</h3><button type="button" onClick={() => setShowForm(false)}><X /></button></div>
        {!editing && <label className="block text-xs font-bold">Tài sản xe<select required value={draft.assetId} onChange={event => { const next = candidates.find(item => item.asset_id === event.target.value); setDraft(previous => ({ ...previous, assetId: event.target.value, vehicleType: next?.asset_name || previous.vehicleType })); setImagePreview(next?.asset_image_url || ''); }} className="mt-1 w-full rounded-xl border p-2.5 font-normal"><option value="">Chọn tài sản thuộc nhóm Phương tiện</option>{candidates.map(item => <option key={item.asset_id} value={item.asset_id}>{item.asset_code} · {item.asset_name}</option>)}</select></label>}
        {(editing || candidate) && <div className="mt-4 flex gap-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-900">{imagePreview ? <img src={imagePreview} alt="Ảnh xe" className="h-24 w-32 rounded-lg object-cover" /> : <div className="flex h-24 w-32 items-center justify-center rounded-lg bg-slate-200"><Car /></div>}<div><div className="font-bold">{editing?.asset_code || candidate?.asset_code} · {editing?.asset_name || candidate?.asset_name}</div><input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => chooseImage(event.target.files?.[0])} /><button type="button" onClick={() => imageInputRef.current?.click()} className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold"><Camera className="h-4 w-4" />{imagePreview ? 'Thay ảnh xe' : 'Thêm ảnh xe'}</button></div></div>}
        <div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-xs font-bold">Loại xe<input required value={draft.vehicleType} onChange={event => setDraft(previous => ({ ...previous, vehicleType: event.target.value }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal" /></label><label className="text-xs font-bold">Số chỗ<input required type="number" min={1} value={draft.seatCount} onChange={event => setDraft(previous => ({ ...previous, seatCount: Number(event.target.value) }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal" /></label><label className="text-xs font-bold">Trạng thái<select value={draft.status} onChange={event => setDraft(previous => ({ ...previous, status: event.target.value as VehicleAvailabilityStatus }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal"><option value="AVAILABLE">Sẵn sàng</option><option value="MAINTENANCE">Bảo dưỡng</option><option value="LOCKED">Khóa</option></select></label><label className="flex items-center gap-2 pt-6 text-xs font-bold"><input type="checkbox" checked={draft.allowSelfDrive} onChange={event => setDraft(previous => ({ ...previous, allowSelfDrive: event.target.checked }))} />Cho phép tự lái</label>
          <label className="text-xs font-bold">Bãi xe<select required value={draft.homeBaseId} onChange={event => setDraft(previous => ({ ...previous, homeBaseId: event.target.value }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal"><option value="">Chọn bãi xe</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="text-xs font-bold">Ô đỗ<input list="parking-spots" value={draft.parkingSpotCode} onChange={event => setDraft(previous => ({ ...previous, parkingSpotCode: event.target.value }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal" /><datalist id="parking-spots">{parkingSpots.map(spot => <option key={spot} value={spot} />)}</datalist></label>
          <div className="flex gap-2 md:col-span-2"><input value={newLocationName} onChange={event => setNewLocationName(event.target.value)} placeholder="Tên bãi xe mới" className="flex-1 rounded-xl border p-2.5 text-xs" /><button type="button" onClick={() => void createLocation()} className="rounded-xl border px-3 text-xs font-bold"><MapPin className="mr-1 inline h-4 w-4" />Thêm bãi</button></div>
          <label className="text-xs font-bold">Số đăng kiểm<input value={draft.inspectionCertificateNumber} onChange={event => setDraft(previous => ({ ...previous, inspectionCertificateNumber: event.target.value }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal" /></label><label className="text-xs font-bold">Hạn đăng kiểm<input type="date" value={draft.inspectionExpiryDate} onChange={event => setDraft(previous => ({ ...previous, inspectionExpiryDate: event.target.value }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal" /></label><label className="text-xs font-bold">Hạn bảo hiểm<input type="date" value={draft.insuranceExpiryDate} onChange={event => setDraft(previous => ({ ...previous, insuranceExpiryDate: event.target.value }))} className="mt-1 w-full rounded-xl border p-2.5 font-normal" /></label><label className="text-xs font-bold">Ảnh đăng kiểm<input ref={inspectionInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setInspectionFile(event.target.files?.[0] || null)} className="mt-1 w-full rounded-xl border p-2 text-xs font-normal" /><span className={inspectionFile || editing?.inspection_photo_path ? 'mt-1 block text-emerald-600' : 'mt-1 block text-rose-600'}>{inspectionFile ? `Đã chọn: ${inspectionFile.name}` : editing?.inspection_photo_path ? 'Đã lưu trên hệ thống' : 'Chưa có ảnh'}</span>{editing?.inspection_photo_path && <button type="button" onClick={() => void openInspectionPreview(editing)} className="mt-2 block text-amber-700 hover:underline">Xem ảnh đang lưu</button>}</label></div>
        <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setShowForm(false)} className="rounded-xl border px-4 py-2 text-xs font-bold">Hủy</button><button disabled={saving} className="rounded-xl bg-amber-500 px-5 py-2 text-xs font-bold text-white">{saving ? 'Đang lưu...' : 'Lưu hồ sơ xe'}</button></div>
      </form></div>}
      {evidencePreview && <PrivateEvidencePreviewModal title={evidencePreview.title} items={evidencePreview.items} error={evidencePreview.error} onClose={() => setEvidencePreview(null)} />}
    </div>
  );
};

export default FleetVehiclesManagement;
