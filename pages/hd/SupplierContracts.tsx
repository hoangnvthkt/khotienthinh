import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, Filter, ChevronDown, Loader2, FileSignature,
  Building2, Edit2, Trash2, Eye, Upload, X, Download, File,
  AlertTriangle, CheckCircle, Clock, XCircle, FileText, Calendar,
  DollarSign, User, Save, ChevronUp, Paperclip, ExternalLink
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { SupplierContract, HdContractStatus, ContractAttachment } from '../../types';

// ─── helpers ─────────────────────────────────────────────────────────────────
const formatCurrency = (v: number, currency = 'VND') =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);

const formatDate = (d?: string) => d ? new Date(d).toLocaleDateString('vi-VN') : '—';

const daysUntil = (d?: string) => {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
};

const sanitizeFileName = (name: string) =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');

const STATUS_CONFIG: Record<HdContractStatus, { label: string; color: string }> = {
  draft:       { label: 'Nháp',           color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  negotiating: { label: 'Đang đàm phán',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  signed:      { label: 'Đã ký',          color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  active:      { label: 'Đang thực hiện', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  completed:   { label: 'Hoàn thành',     color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' },
  expired:     { label: 'Hết hạn',        color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  cancelled:   { label: 'Đã hủy',         color: 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400' },
} satisfies Record<HdContractStatus, { label: string; color: string }>;

const CONTRACT_TYPES = [
  { value: 'purchase', label: 'Mua hàng' },
  { value: 'supply',   label: 'Cung ứng vật tư' },
  { value: 'service',  label: 'Dịch vụ' },
  { value: 'technical',label: 'Kỹ thuật' },
];

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Chuyển khoản' },
  { value: 'cash',          label: 'Tiền mặt' },
  { value: 'credit',        label: 'Công nợ' },
];

const EMPTY_FORM: Omit<SupplierContract, 'id' | 'attachments' | 'createdAt' | 'updatedAt'> = {
  code: '', name: '', type: 'purchase', supplierId: '', supplierName: '',
  supplierRepresentative: '', value: 0, currency: 'VND', paymentMethod: 'bank_transfer',
  paymentTerms: '', guaranteeInfo: '', purchaseOrderNumber: '',
  signedDate: '', effectiveDate: '', expiryDate: '',
  managedByUserId: '', managedByName: '', status: 'draft', note: '',
};

// ─── Main Component ────────────────────────────────────────────────────────────
const SupplierContracts: React.FC = () => {
  const { user, suppliers } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [contracts, setContracts] = useState<SupplierContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Modal states
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Detail modal
  const [selectedContract, setSelectedContract] = useState<SupplierContract | null>(null);
  const [detailTab, setDetailTab] = useState<'info' | 'docs'>('info');

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // ── fetch ────────────────────────────────────────────────────────────────────
  const fetchContracts = async () => {
    setLoading(true);
    if (!isSupabaseConfigured) {
      setContracts([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('supplier_contracts')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) {
      setContracts(data.map((r: any) => ({
        id: r.id, code: r.code, name: r.name, type: r.type,
        supplierId: r.supplier_id, supplierName: r.supplier_name,
        supplierRepresentative: r.supplier_representative,
        value: Number(r.value), currency: r.currency,
        paymentMethod: r.payment_method, paymentTerms: r.payment_terms,
        guaranteeInfo: r.guarantee_info, purchaseOrderNumber: r.purchase_order_number,
        signedDate: r.signed_date, effectiveDate: r.effective_date, expiryDate: r.expiry_date,
        managedByUserId: r.managed_by_user_id, managedByName: r.managed_by_name,
        status: r.status, note: r.note,
        attachments: r.attachments || [],
        createdAt: r.created_at, updatedAt: r.updated_at,
      })));
    }
    setLoading(false);
  };

  useEffect(() => { fetchContracts(); }, []);

  // ── save (add / edit) ────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim()) return;
    setSaving(true);
    const payload = {
      id: editingId || crypto.randomUUID(),
      code: form.code.trim(), name: form.name.trim(), type: form.type,
      supplier_id: form.supplierId || null, supplier_name: form.supplierName || null,
      supplier_representative: form.supplierRepresentative || null,
      value: form.value, currency: form.currency,
      payment_method: form.paymentMethod || null, payment_terms: form.paymentTerms || null,
      guarantee_info: form.guaranteeInfo || null, purchase_order_number: form.purchaseOrderNumber || null,
      signed_date: form.signedDate || null, effective_date: form.effectiveDate || null, expiry_date: form.expiryDate || null,
      managed_by_user_id: form.managedByUserId || null, managed_by_name: form.managedByName || null,
      status: form.status, note: form.note || null,
      attachments: editingId ? (contracts.find(c => c.id === editingId)?.attachments || []) : [],
      updated_at: new Date().toISOString(),
    };

    if (isSupabaseConfigured) {
      try {
        if (editingId) {
          await supabase.from('supplier_contracts').update(payload).eq('id', editingId);
        } else {
          await supabase.from('supplier_contracts').insert({ ...payload, created_at: new Date().toISOString() });
        }
        await fetchContracts();
        toast.success(editingId ? 'Cập nhật thành công' : 'Thêm hợp đồng NCC thành công', `HĐ ${payload.code} đã được lưu`);
      } catch (e: any) {
        toast.error('Lỗi lưu hợp đồng', e?.message);
      }
    }
    setSaving(false);
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleEdit = (c: SupplierContract) => {
    setForm({
      code: c.code, name: c.name, type: c.type,
      supplierId: c.supplierId || '', supplierName: c.supplierName || '',
      supplierRepresentative: c.supplierRepresentative || '',
      value: c.value, currency: c.currency,
      paymentMethod: c.paymentMethod || 'bank_transfer',
      paymentTerms: c.paymentTerms || '', guaranteeInfo: c.guaranteeInfo || '',
      purchaseOrderNumber: c.purchaseOrderNumber || '',
      signedDate: c.signedDate || '', effectiveDate: c.effectiveDate || '', expiryDate: c.expiryDate || '',
      managedByUserId: c.managedByUserId || '', managedByName: c.managedByName || '',
      status: c.status, note: c.note || '',
    });
    setEditingId(c.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    const c = contracts.find(x => x.id === id);
    const ok = await confirm({ targetName: c?.name || 'hợp đồng này', title: 'Xoá hợp đồng NCC' });
    if (!ok) return;
    try {
      if (isSupabaseConfigured) await supabase.from('supplier_contracts').delete().eq('id', id);
      await fetchContracts();
      if (selectedContract?.id === id) setSelectedContract(null);
      toast.success('Xoá thành công');
    } catch (e: any) {
      toast.error('Lỗi xoá', e?.message);
    }
  };

  // ── file upload ──────────────────────────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedContract || !e.target.files?.length || !isSupabaseConfigured) return;
    setUploading(true);
    setUploadError('');
    const file = e.target.files[0];
    const safeName = sanitizeFileName(file.name);
    const path = `supplier/${selectedContract.id}/${Date.now()}_${safeName}`;
    const { error } = await supabase.storage.from('contract-files').upload(path, file);
    if (error) { setUploadError(error.message); setUploading(false); return; }

    const attachment: ContractAttachment = {
      id: crypto.randomUUID(), name: file.name, fileName: safeName,
      storagePath: path, fileType: file.type || safeName.split('.').pop() || '',
      fileSize: file.size, uploadedAt: new Date().toISOString(),
      uploadedBy: user.name || user.email || '',
    };
    const newAttachments = [...(selectedContract.attachments || []), attachment];
    await supabase.from('supplier_contracts')
      .update({ attachments: newAttachments }).eq('id', selectedContract.id);
    await fetchContracts();
    setSelectedContract(prev => prev ? { ...prev, attachments: newAttachments } : prev);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownload = async (att: ContractAttachment) => {
    if (!isSupabaseConfigured) return;
    const { data } = await supabase.storage.from('contract-files').createSignedUrl(att.storagePath, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  const handleDeleteFile = async (att: ContractAttachment) => {
    if (!selectedContract) return;
    const ok = await confirm({ targetName: att.name, title: 'Xoá file đính kèm', warningText: 'File sẽ bị xoá khỏi Storage không thể khôi phục.' });
    if (!ok) return;
    try {
      if (isSupabaseConfigured) await supabase.storage.from('contract-files').remove([att.storagePath]);
      const newAttachments = selectedContract.attachments.filter(a => a.id !== att.id);
      await supabase.from('supplier_contracts').update({ attachments: newAttachments }).eq('id', selectedContract.id);
      await fetchContracts();
      setSelectedContract(prev => prev ? { ...prev, attachments: newAttachments } : prev);
      toast.success('Xoá file thành công');
    } catch (e: any) {
      toast.error('Lỗi xoá file', e?.message);
    }
  };

  // ── filter ───────────────────────────────────────────────────────────────────
  const filtered = contracts.filter(c => {
    const q = searchTerm.toLowerCase();
    const matchSearch = !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || (c.supplierName || '').toLowerCase().includes(q);
    const matchStatus = !filterStatus || c.status === filterStatus;
    return matchSearch && matchStatus;
  });

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/30"
            placeholder="Tìm mã, tên, nhà cung cấp..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 dark:text-white outline-none"
        >
          <option value="">Tất cả trạng thái</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button
          onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-bold rounded-xl shadow-md shadow-blue-500/20 hover:shadow-blue-500/40 transition-all"
        >
          <Plus size={15} /> Thêm hợp đồng
        </button>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">
                <th className="px-4 py-3 text-left">Mã HĐ</th>
                <th className="px-4 py-3 text-left">Tên hợp đồng</th>
                <th className="px-4 py-3 text-left">Nhà cung cấp</th>
                <th className="px-4 py-3 text-right">Giá trị</th>
                <th className="px-4 py-3 text-center">Trạng thái</th>
                <th className="px-4 py-3 text-center">Hết hạn</th>
                <th className="px-4 py-3 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400"><Loader2 className="inline animate-spin mr-2" size={16} />Đang tải...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400">Chưa có hợp đồng nào</td></tr>
              ) : filtered.map(c => {
                const days = daysUntil(c.expiryDate);
                const expiringSoon = days !== null && days >= 0 && days <= 30;
                const expired = days !== null && days < 0;
                return (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-blue-600 dark:text-blue-400">{c.code}</td>
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-white max-w-xs truncate">{c.name}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{c.supplierName || '—'}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-white">
                      {formatCurrency(c.value, c.currency)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_CONFIG[c.status]?.color}`}>
                        {STATUS_CONFIG[c.status]?.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {c.expiryDate ? (
                        <span className={`text-xs font-bold ${expired ? 'text-red-600' : expiringSoon ? 'text-amber-600' : 'text-slate-500 dark:text-slate-400'}`}>
                          {expired ? '⚠️ ' : expiringSoon ? '🔔 ' : ''}{formatDate(c.expiryDate)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => { setSelectedContract(c); setDetailTab('info'); }}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors" title="Xem chi tiết">
                          <Eye size={14} />
                        </button>
                        <button onClick={() => handleEdit(c)}
                          className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors" title="Sửa">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => handleDelete(c.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title="Xóa">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Add/Edit Modal ─────────────────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                  <FileSignature className="text-white" size={15} />
                </div>
                <h3 className="font-black text-slate-800 dark:text-white">
                  {editingId ? 'Sửa hợp đồng NCC' : 'Thêm hợp đồng NCC mới'}
                </h3>
              </div>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mã hợp đồng *</label>
                  <input value={form.code} onChange={e => setForm({...form, code: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/30"
                    placeholder="HD-NCC-2025-001" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Loại hợp đồng</label>
                  <select value={form.type} onChange={e => setForm({...form, type: e.target.value as any})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none">
                    {CONTRACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tên hợp đồng *</label>
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/30"
                  placeholder="Mô tả ngắn về hợp đồng" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nhà cung cấp</label>
                  {suppliers && suppliers.length > 0 ? (
                    <select value={form.supplierId} onChange={e => {
                      const sup = suppliers.find(s => s.id === e.target.value);
                      setForm({...form, supplierId: e.target.value, supplierName: sup?.name || ''});
                    }} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none">
                      <option value="">— Chọn nhà cung cấp —</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  ) : (
                    <input value={form.supplierName} onChange={e => setForm({...form, supplierName: e.target.value})}
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
                      placeholder="Tên nhà cung cấp" />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Người đại diện NCC</label>
                  <input value={form.supplierRepresentative} onChange={e => setForm({...form, supplierRepresentative: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
                    placeholder="Nguyễn Văn A" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Giá trị hợp đồng</label>
                  <input type="number" value={form.value} onChange={e => setForm({...form, value: Number(e.target.value)})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
                    placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tiền tệ</label>
                  <select value={form.currency} onChange={e => setForm({...form, currency: e.target.value as any})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none">
                    <option value="VND">VND</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phương thức thanh toán</label>
                  <select value={form.paymentMethod} onChange={e => setForm({...form, paymentMethod: e.target.value as any})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none">
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Trạng thái</label>
                  <select value={form.status} onChange={e => setForm({...form, status: e.target.value as HdContractStatus})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none">
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Điều kiện thanh toán</label>
                <input value={form.paymentTerms} onChange={e => setForm({...form, paymentTerms: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
                  placeholder="VD: Thanh toán 30 ngày sau xuất hoá đơn" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ngày ký</label>
                  <input type="date" value={form.signedDate} onChange={e => setForm({...form, signedDate: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ngày hiệu lực</label>
                  <input type="date" value={form.effectiveDate} onChange={e => setForm({...form, effectiveDate: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ngày hết hạn</label>
                  <input type="date" value={form.expiryDate} onChange={e => setForm({...form, expiryDate: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Số PO liên kết</label>
                  <input value={form.purchaseOrderNumber} onChange={e => setForm({...form, purchaseOrderNumber: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
                    placeholder="PO-2025-001" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Thông tin bảo lãnh</label>
                  <input value={form.guaranteeInfo} onChange={e => setForm({...form, guaranteeInfo: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
                    placeholder="NH bảo lãnh / số bảo lãnh" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ghi chú</label>
                <textarea value={form.note} onChange={e => setForm({...form, note: e.target.value})} rows={2}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none resize-none"
                  placeholder="Ghi chú thêm..." />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex gap-3">
              <button onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                Hủy
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-blue-500/20 disabled:opacity-50 transition-all">
                {saving ? <><Loader2 size={15} className="animate-spin" /> Đang lưu...</> : <><Save size={15} /> Lưu hợp đồng</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Modal ───────────────────────────────────────────────────────── */}
      {selectedContract && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <p className="font-mono text-xs text-blue-600 dark:text-blue-400 font-bold">{selectedContract.code}</p>
                <h3 className="font-black text-slate-800 dark:text-white">{selectedContract.name}</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_CONFIG[selectedContract.status]?.color}`}>
                  {STATUS_CONFIG[selectedContract.status]?.label}
                </span>
                <button onClick={() => setSelectedContract(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                  <X size={20} />
                </button>
              </div>
            </div>
            {/* Tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-800 px-6">
              {(['info', 'docs'] as const).map(tab => (
                <button key={tab} onClick={() => setDetailTab(tab)}
                  className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${detailTab === tab ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}>
                  {tab === 'info' ? '📋 Thông tin' : `📎 Tài liệu (${selectedContract.attachments?.length || 0})`}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {detailTab === 'info' && (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {[
                    ['Nhà cung cấp', selectedContract.supplierName],
                    ['Người đại diện', selectedContract.supplierRepresentative],
                    ['Giá trị HĐ', formatCurrency(selectedContract.value, selectedContract.currency)],
                    ['Thanh toán', PAYMENT_METHODS.find(m => m.value === selectedContract.paymentMethod)?.label],
                    ['Điều kiện TT', selectedContract.paymentTerms],
                    ['Số PO', selectedContract.purchaseOrderNumber],
                    ['Ngày ký', formatDate(selectedContract.signedDate)],
                    ['Ngày hiệu lực', formatDate(selectedContract.effectiveDate)],
                    ['Ngày hết hạn', formatDate(selectedContract.expiryDate)],
                    ['Bảo lãnh', selectedContract.guaranteeInfo],
                    ['Ghi chú', selectedContract.note],
                  ].map(([label, val]) => val ? (
                    <div key={label as string} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3">
                      <p className="text-xs font-bold text-slate-400 uppercase mb-1">{label}</p>
                      <p className="font-medium text-slate-800 dark:text-white">{val}</p>
                    </div>
                  ) : null)}
                </div>
              )}
              {detailTab === 'docs' && (
                <div className="space-y-3">
                  {/* Upload area */}
                  <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-blue-200 dark:border-blue-800 rounded-xl p-6 cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all">
                    <Upload className="text-blue-400" size={24} />
                    <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Kéo thả hoặc click để tải lên</span>
                    <span className="text-xs text-slate-400">PDF, DOCX, JPG, PNG — Tối đa 20MB</span>
                    <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls" onChange={handleFileUpload} disabled={uploading} />
                    {uploading && <div className="flex items-center gap-2 text-blue-500 text-xs font-bold"><Loader2 size={14} className="animate-spin" />Đang tải lên...</div>}
                    {uploadError && <p className="text-xs text-red-500 font-bold">{uploadError}</p>}
                  </label>
                  {/* File list */}
                  {selectedContract.attachments?.length === 0 && !uploading && (
                    <p className="text-center text-sm text-slate-400 py-4">Chưa có tài liệu đính kèm</p>
                  )}
                  {selectedContract.attachments?.map(att => (
                    <div key={att.id} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl group">
                      <File className="text-blue-500 shrink-0" size={20} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{att.name}</p>
                        <p className="text-xs text-slate-400">{(att.fileSize / 1024).toFixed(0)} KB · {formatDate(att.uploadedAt)} · {att.uploadedBy}</p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleDownload(att)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors" title="Tải xuống">
                          <Download size={13} />
                        </button>
                        <button onClick={() => handleDeleteFile(att)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title="Xóa">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupplierContracts;
