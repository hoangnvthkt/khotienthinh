import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Clock, Hash, Loader2, PackagePlus, Search, ShieldCheck, X, XCircle } from 'lucide-react';
import { InventoryItem, MaterialCodeRequest, Role } from '../types';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useModuleData } from '../hooks/useModuleData';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { materialCodeRequestService } from '../lib/materialCodeRequestService';
import { isGlobalWarehouseKeeper } from '../lib/wmsPermissions';
import SearchableSelect from '../components/common/SearchableSelect';

const statusLabel: Record<MaterialCodeRequest['status'], string> = {
  pending: 'Chờ cấp mã',
  approved: 'Đã cấp mã',
  rejected: 'Từ chối',
};

const statusClass: Record<MaterialCodeRequest['status'], string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
};

const MaterialCodeRequests: React.FC = () => {
  useModuleData('wms');
  const { user, items, categories, units, suppliers, addItem } = useApp();
  const toast = useToast();
  const canApprove = user.role === Role.ADMIN || isGlobalWarehouseKeeper(user);

  const [requests, setRequests] = useState<MaterialCodeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | MaterialCodeRequest['status']>('pending');
  const [form, setForm] = useState({
    proposedName: '',
    proposedUnit: '',
    proposedCategory: '',
    proposedSpecification: '',
    reason: '',
  });
  const [approving, setApproving] = useState<MaterialCodeRequest | null>(null);
  const [approvalForm, setApprovalForm] = useState({
    sku: '',
    name: '',
    category: '',
    unit: '',
    supplierId: '',
    priceIn: 0,
    priceOut: 0,
    minStock: 0,
    location: '',
  });

  const loadRequests = async () => {
    setLoading(true);
    try {
      const data = await materialCodeRequestService.list();
      setRequests(data);
    } catch (err: any) {
      logApiError('materialCodeRequests.list', err);
      toast.error('Không thể tải đề xuất cấp mã', getApiErrorMessage(err, 'Chưa tải được danh sách đề xuất cấp mã vật tư.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRequests();
  }, []);

  const filteredRequests = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return requests.filter(req => {
      const statusOk = statusFilter === 'all' || req.status === statusFilter;
      const searchOk = !q
        || req.code.toLowerCase().includes(q)
        || req.proposedName.toLowerCase().includes(q)
        || (req.approvedSku || '').toLowerCase().includes(q);
      return statusOk && searchOk;
    });
  }, [requests, searchTerm, statusFilter]);

  const pendingCount = requests.filter(req => req.status === 'pending').length;
  const approvedCount = requests.filter(req => req.status === 'approved').length;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.proposedName.trim() || !form.proposedUnit.trim() || !form.reason.trim()) {
      toast.warning('Thiếu thông tin', 'Vui lòng nhập tên vật tư, đơn vị dự kiến và lý do cần cấp mã.');
      return;
    }

    setSaving(true);
    try {
      const code = `MCR-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      const created = await materialCodeRequestService.create({
        id: `mcr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        code,
        requestedByUserId: user.id,
        requestedByName: user.name || user.username,
        proposedName: form.proposedName.trim(),
        proposedUnit: form.proposedUnit.trim(),
        proposedCategory: form.proposedCategory.trim() || null,
        proposedSpecification: form.proposedSpecification.trim() || null,
        proposedSupplierId: null,
        reason: form.reason.trim(),
        approvedSku: null,
        approvedItemId: null,
        approvedByUserId: null,
        approvedByName: null,
        approvedAt: null,
        rejectionReason: null,
      });
      setRequests(prev => [created, ...prev]);
      setForm({ proposedName: '', proposedUnit: '', proposedCategory: '', proposedSpecification: '', reason: '' });
      toast.success('Đã gửi đề xuất', `${code} đang chờ phòng vật tư cấp mã.`);
    } catch (err: any) {
      logApiError('materialCodeRequests.create', err);
      toast.error('Không thể gửi đề xuất', getApiErrorMessage(err, 'Không thể tạo đề xuất cấp mã vật tư.'));
    } finally {
      setSaving(false);
    }
  };

  const openApprove = (req: MaterialCodeRequest) => {
    setApproving(req);
    setApprovalForm({
      sku: '',
      name: req.proposedName,
      category: req.proposedCategory || categories[0]?.name || '',
      unit: req.proposedUnit || units[0]?.name || '',
      supplierId: '',
      priceIn: 0,
      priceOut: 0,
      minStock: 0,
      location: '',
    });
  };

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approving) return;
    if (!canApprove) {
      toast.error('Không có quyền', 'Chỉ Admin hoặc thủ kho tổng/phòng vật tư được cấp mã vật tư mới.');
      return;
    }
    if (!approvalForm.sku.trim() || !approvalForm.name.trim() || !approvalForm.category.trim() || !approvalForm.unit.trim()) {
      toast.warning('Thiếu thông tin', 'Vui lòng nhập SKU, tên, danh mục và đơn vị tính.');
      return;
    }
    const sku = approvalForm.sku.trim();
    if (items.some(item => item.sku.toLowerCase() === sku.toLowerCase())) {
      toast.warning('Trùng mã SKU', 'Mã SKU này đã tồn tại trong danh mục vật tư.');
      return;
    }

    setSaving(true);
    try {
      const newItem: InventoryItem = {
        id: `it-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sku,
        name: approvalForm.name.trim(),
        category: approvalForm.category.trim(),
        unit: approvalForm.unit.trim(),
        purchaseConversionFactor: 1,
        supplierId: approvalForm.supplierId || undefined,
        priceIn: Number(approvalForm.priceIn) || 0,
        priceOut: Number(approvalForm.priceOut) || 0,
        minStock: Number(approvalForm.minStock) || 0,
        location: approvalForm.location.trim() || undefined,
        stockByWarehouse: {},
      };
      await addItem(newItem);
      const updated = await materialCodeRequestService.approve(approving.id, {
        approvedSku: newItem.sku,
        approvedItemId: newItem.id,
        approvedByUserId: user.id,
        approvedByName: user.name || user.username,
      });
      setRequests(prev => prev.map(req => req.id === approving.id ? updated : req));
      setApproving(null);
      toast.success('Đã cấp mã vật tư', `${newItem.sku} - ${newItem.name} đã được thêm vào danh mục.`);
    } catch (err: any) {
      logApiError('materialCodeRequests.approve', err);
      toast.error('Không thể cấp mã', getApiErrorMessage(err, 'Không thể cấp mã vật tư mới.'));
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async (req: MaterialCodeRequest) => {
    if (!canApprove) {
      toast.error('Không có quyền', 'Chỉ Admin hoặc thủ kho tổng/phòng vật tư được từ chối đề xuất cấp mã.');
      return;
    }
    const reason = window.prompt(`Nhập lý do từ chối ${req.code}`);
    if (!reason?.trim()) return;

    setSaving(true);
    try {
      const updated = await materialCodeRequestService.reject(req.id, {
        reason: reason.trim(),
        rejectedByUserId: user.id,
        rejectedByName: user.name || user.username,
      });
      setRequests(prev => prev.map(item => item.id === req.id ? updated : item));
      toast.success('Đã từ chối', `${req.code} đã được cập nhật trạng thái.`);
    } catch (err: any) {
      logApiError('materialCodeRequests.reject', err);
      toast.error('Không thể từ chối', getApiErrorMessage(err, 'Không thể cập nhật đề xuất cấp mã.'));
    } finally {
      setSaving(false);
    }
  };

  const categoryOptions = Array.from(new Set([
    approvalForm.category,
    form.proposedCategory,
    'Khác',
    ...categories.map(cat => cat.name),
  ].filter(Boolean)));
  const unitOptions = Array.from(new Set([
    approvalForm.unit,
    form.proposedUnit,
    'Cái',
    ...units.map(unit => unit.name),
  ].filter(Boolean)));

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
              <Hash size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Đề xuất cấp mã vật tư/vật liệu</h1>
              <p className="text-sm text-slate-500">Công trường gửi yêu cầu cấp mã; phòng vật tư xác nhận trước khi MR/PO được phép dùng.</p>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="px-4 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-700">
            <div className="text-[10px] font-black uppercase">Chờ cấp mã</div>
            <div className="text-xl font-black">{pendingCount}</div>
          </div>
          <div className="px-4 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
            <div className="text-[10px] font-black uppercase">Đã cấp</div>
            <div className="text-xl font-black">{approvedCount}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4 h-fit">
          <div>
            <h2 className="font-black text-slate-800 flex items-center gap-2">
              <PackagePlus size={18} className="text-emerald-600" />
              Tạo đề xuất cấp mã
            </h2>
            <p className="text-xs text-slate-500 mt-1">Dùng khi vật tư/vật liệu chưa có mã trong danh mục kho.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-600">Tên vật tư/vật liệu đề xuất <span className="text-red-500">*</span></label>
            <input
              value={form.proposedName}
              onChange={e => setForm(prev => ({ ...prev, proposedName: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="VD: Keo chống thấm gốc PU"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-600">Đơn vị dự kiến <span className="text-red-500">*</span></label>
              <input
                value={form.proposedUnit}
                onChange={e => setForm(prev => ({ ...prev, proposedUnit: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Thùng, kg..."
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-600">Nhóm vật tư</label>
              <input
                value={form.proposedCategory}
                onChange={e => setForm(prev => ({ ...prev, proposedCategory: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Vật liệu phụ..."
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-600">Quy cách/thông số</label>
            <textarea
              value={form.proposedSpecification}
              onChange={e => setForm(prev => ({ ...prev, proposedSpecification: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              placeholder="Thông số kỹ thuật, hãng, kích thước..."
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-600">Lý do cần cấp mã <span className="text-red-500">*</span></label>
            <textarea
              value={form.reason}
              onChange={e => setForm(prev => ({ ...prev, reason: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              placeholder="Cần dùng cho hạng mục/công trường nào..."
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />}
            Gửi đề xuất
          </button>
        </form>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row gap-3 md:items-center justify-between">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Tìm theo mã phiếu, tên vật tư, SKU..."
                className="w-full pl-10 pr-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {[
                { id: 'all', label: 'Tất cả' },
                { id: 'pending', label: 'Chờ cấp mã' },
                { id: 'approved', label: 'Đã cấp' },
                { id: 'rejected', label: 'Từ chối' },
              ].map(option => (
                <button
                  key={option.id}
                  onClick={() => setStatusFilter(option.id as any)}
                  className={`px-3 py-2 rounded-lg text-xs font-black whitespace-nowrap ${statusFilter === option.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-10 flex items-center justify-center text-slate-400">
              <Loader2 size={24} className="animate-spin mr-2" />
              Đang tải đề xuất...
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="p-10 text-center text-slate-400">
              <Hash size={34} className="mx-auto mb-3 opacity-40" />
              <p className="font-bold">Chưa có đề xuất phù hợp</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredRequests.map(req => (
                <div key={req.id} className="p-4 hover:bg-slate-50 transition-colors">
                  <div className="flex flex-col lg:flex-row gap-4 lg:items-start justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="font-mono text-xs font-black text-slate-700 bg-slate-100 px-2 py-1 rounded">{req.code}</span>
                        <span className={`text-[10px] font-black uppercase px-2 py-1 rounded border ${statusClass[req.status]}`}>{statusLabel[req.status]}</span>
                        {req.approvedSku ? <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded">{req.approvedSku}</span> : null}
                      </div>
                      <h3 className="font-black text-slate-800 truncate">{req.proposedName}</h3>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>ĐVT: <b>{req.proposedUnit}</b></span>
                        {req.proposedCategory ? <span>Nhóm: <b>{req.proposedCategory}</b></span> : null}
                        <span>Người gửi: <b>{req.requestedByName || req.requestedByUserId}</b></span>
                      </div>
                      {req.proposedSpecification ? <p className="mt-2 text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{req.proposedSpecification}</p> : null}
                      <p className="mt-2 text-xs text-slate-500">Lý do: {req.reason}</p>
                      {req.rejectionReason ? <p className="mt-2 text-xs text-rose-600 font-bold">Lý do từ chối: {req.rejectionReason}</p> : null}
                    </div>

                    {req.status === 'pending' && canApprove ? (
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => openApprove(req)}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700"
                        >
                          <CheckCircle size={14} />
                          Cấp mã
                        </button>
                        <button
                          onClick={() => handleReject(req)}
                          disabled={saving}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-xs font-black hover:bg-rose-100 disabled:opacity-60"
                        >
                          <XCircle size={14} />
                          Từ chối
                        </button>
                      </div>
                    ) : req.status === 'pending' ? (
                      <span className="inline-flex items-center gap-2 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 h-fit">
                        <Clock size={14} />
                        Chờ phòng vật tư
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 h-fit">
                        <ShieldCheck size={14} />
                        Đã xử lý
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {approving ? (
        <div className="fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleApprove} className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-black text-slate-800">Cấp mã vật tư</h3>
                <p className="text-xs text-slate-500">{approving.code} - {approving.proposedName}</p>
              </div>
              <button type="button" onClick={() => setApproving(null)} className="p-2 rounded-lg hover:bg-slate-100">
                <X size={20} />
              </button>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-600">SKU mới <span className="text-red-500">*</span></label>
                <input
                  value={approvalForm.sku}
                  onChange={e => setApprovalForm(prev => ({ ...prev, sku: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  placeholder="VD: MAT-PU-001"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-600">Tên chuẩn <span className="text-red-500">*</span></label>
                <input
                  value={approvalForm.name}
                  onChange={e => setApprovalForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-600">Danh mục <span className="text-red-500">*</span></label>
                <select
                  value={approvalForm.category}
                  onChange={e => setApprovalForm(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                >
                  <option value="">Chọn danh mục</option>
                  {categoryOptions.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-600">Đơn vị tính <span className="text-red-500">*</span></label>
                <select
                  value={approvalForm.unit}
                  onChange={e => setApprovalForm(prev => ({ ...prev, unit: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                >
                  <option value="">Chọn đơn vị</option>
                  {unitOptions.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-bold text-slate-600">Nhà cung cấp mặc định</label>
                <SearchableSelect
                  value={approvalForm.supplierId}
                  options={suppliers}
                  onChange={supplier => setApprovalForm(prev => ({ ...prev, supplierId: supplier?.id || '' }))}
                  getOptionValue={supplier => supplier.id}
                  getOptionLabel={supplier => supplier.name}
                  getOptionSearchText={supplier => [
                    supplier.name,
                    supplier.phone,
                    supplier.taxCode,
                    supplier.contactPerson,
                    supplier.email,
                  ].filter(Boolean).join(' ')}
                  placeholder="Gõ tên NCC, MST, SĐT..."
                  inputClassName="py-2"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-600">Giá nhập tham khảo</label>
                <input
                  type="number"
                  min={0}
                  value={approvalForm.priceIn}
                  onChange={e => setApprovalForm(prev => ({ ...prev, priceIn: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-600">Giá xuất/tham chiếu</label>
                <input
                  type="number"
                  min={0}
                  value={approvalForm.priceOut}
                  onChange={e => setApprovalForm(prev => ({ ...prev, priceOut: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-600">Tồn tối thiểu</label>
                <input
                  type="number"
                  min={0}
                  value={approvalForm.minStock}
                  onChange={e => setApprovalForm(prev => ({ ...prev, minStock: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-600">Vị trí/kệ mặc định</label>
                <input
                  value={approvalForm.location}
                  onChange={e => setApprovalForm(prev => ({ ...prev, location: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50">
              <button type="button" onClick={() => setApproving(null)} className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 font-bold hover:bg-slate-100">
                Huỷ
              </button>
              <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-60">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                Xác nhận cấp mã
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
};

export default MaterialCodeRequests;
