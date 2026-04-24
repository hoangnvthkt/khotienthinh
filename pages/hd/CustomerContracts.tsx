import React, { useState, useEffect, useRef } from 'react';
import {
  Plus, Search, Loader2, FileSignature, Users, Edit2, Trash2, Eye,
  Upload, X, Download, File, Save, Trash2 as TrashIcon
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { CustomerContract, HdContractStatus, ContractAttachment } from '../../types';

const formatCurrency = (v: number, currency = 'VND') =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
const formatDate = (d?: string) => d ? new Date(d).toLocaleDateString('vi-VN') : '—';
const daysUntil = (d?: string) => d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null;
const sanitizeFileName = (n: string) =>
  n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');

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
  { value: 'construction', label: 'Thi công' },
  { value: 'supply',       label: 'Cung ứng' },
  { value: 'design',       label: 'Thiết kế' },
  { value: 'consulting',   label: 'Tư vấn' },
  { value: 'implementation', label: 'Thực hiện' },
];
const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Chuyển khoản' },
  { value: 'cash',          label: 'Tiền mặt' },
  { value: 'credit',        label: 'Công nợ' },
];

const EMPTY_FORM: Omit<CustomerContract, 'id' | 'attachments' | 'createdAt' | 'updatedAt'> = {
  code: '', name: '', type: 'construction', customerName: '', customerTaxCode: '',
  customerAddress: '', customerRepresentative: '', customerRepresentativeTitle: '',
  projectId: '', value: 0, vatPercent: 0, currency: 'VND',
  paymentMethod: 'bank_transfer', paymentSchedule: '', warrantyMonths: 0,
  signedDate: '', effectiveDate: '', endDate: '',
  managedByUserId: '', managedByName: '', status: 'draft', note: '',
};

const CustomerContracts: React.FC = () => {
  const { user } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [contracts, setContracts] = useState<CustomerContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [selectedContract, setSelectedContract] = useState<CustomerContract | null>(null);
  const [detailTab, setDetailTab] = useState<'info' | 'docs'>('info');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const fetchContracts = async () => {
    setLoading(true);
    if (!isSupabaseConfigured) { setContracts([]); setLoading(false); return; }
    const { data, error } = await supabase.from('customer_contracts').select('*').order('created_at', { ascending: false });
    if (!error && data) {
      setContracts(data.map((r: any) => ({
        id: r.id, code: r.code, name: r.name, type: r.type,
        customerName: r.customer_name, customerTaxCode: r.customer_tax_code,
        customerAddress: r.customer_address, customerRepresentative: r.customer_representative,
        customerRepresentativeTitle: r.customer_representative_title, projectId: r.project_id,
        value: Number(r.value), vatPercent: Number(r.vat_percent), currency: r.currency,
        paymentMethod: r.payment_method, paymentSchedule: r.payment_schedule, warrantyMonths: r.warranty_months,
        signedDate: r.signed_date, effectiveDate: r.effective_date, endDate: r.end_date,
        managedByUserId: r.managed_by_user_id, managedByName: r.managed_by_name,
        status: r.status, note: r.note, attachments: r.attachments || [],
        createdAt: r.created_at, updatedAt: r.updated_at,
      })));
    }
    setLoading(false);
  };

  useEffect(() => { fetchContracts(); }, []);

  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim() || !form.customerName.trim()) return;
    setSaving(true);
    const payload = {
      id: editingId || crypto.randomUUID(),
      code: form.code, name: form.name, type: form.type,
      customer_name: form.customerName, customer_tax_code: form.customerTaxCode || null,
      customer_address: form.customerAddress || null, customer_representative: form.customerRepresentative || null,
      customer_representative_title: form.customerRepresentativeTitle || null, project_id: form.projectId || null,
      value: form.value, vat_percent: form.vatPercent || 0, currency: form.currency,
      payment_method: form.paymentMethod || null, payment_schedule: form.paymentSchedule || null,
      warranty_months: form.warrantyMonths || 0, signed_date: form.signedDate || null,
      effective_date: form.effectiveDate || null, end_date: form.endDate || null,
      managed_by_user_id: form.managedByUserId || null, managed_by_name: form.managedByName || null,
      status: form.status, note: form.note || null,
      attachments: editingId ? (contracts.find(c => c.id === editingId)?.attachments || []) : [],
      updated_at: new Date().toISOString(),
    };
    if (isSupabaseConfigured) {
      try {
        if (editingId) await supabase.from('customer_contracts').update(payload).eq('id', editingId);
        else await supabase.from('customer_contracts').insert({ ...payload, created_at: new Date().toISOString() });
        await fetchContracts();
        toast.success(editingId ? 'Cập nhật thành công' : 'Thêm hợp đồng thành công', `Hợp đồng ${payload.code} đã được lưu`);
      } catch (e: any) {
        toast.error('Lỗi lưu hợp đồng', e?.message);
      }
    }
    setSaving(false); setShowForm(false); setEditingId(null); setForm(EMPTY_FORM);
  };

  const handleEdit = (c: CustomerContract) => {
    setForm({
      code: c.code, name: c.name, type: c.type, customerName: c.customerName,
      customerTaxCode: c.customerTaxCode || '', customerAddress: c.customerAddress || '',
      customerRepresentative: c.customerRepresentative || '', customerRepresentativeTitle: c.customerRepresentativeTitle || '',
      projectId: c.projectId || '', value: c.value, vatPercent: c.vatPercent || 0, currency: c.currency,
      paymentMethod: c.paymentMethod || 'bank_transfer', paymentSchedule: c.paymentSchedule || '',
      warrantyMonths: c.warrantyMonths || 0, signedDate: c.signedDate || '',
      effectiveDate: c.effectiveDate || '', endDate: c.endDate || '',
      managedByUserId: c.managedByUserId || '', managedByName: c.managedByName || '',
      status: c.status, note: c.note || '',
    });
    setEditingId(c.id); setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    const c = contracts.find(x => x.id === id);
    const ok = await confirm({ targetName: c?.name || 'hợp đồng này', title: 'Xoá hợp đồng khách hàng', warningText: 'Hợp đồng và file đính kèm sẽ bị xoá vĩnh viễn.' });
    if (!ok) return;
    try {
      if (isSupabaseConfigured) await supabase.from('customer_contracts').delete().eq('id', id);
      await fetchContracts();
      if (selectedContract?.id === id) setSelectedContract(null);
      toast.success('Xoá thành công', 'Hợp đồng đã được xoá');
    } catch (e: any) {
      toast.error('Lỗi xoá', e?.message);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedContract || !e.target.files?.length || !isSupabaseConfigured) return;
    setUploading(true); setUploadError('');
    const file = e.target.files[0];
    const path = `customer/${selectedContract.id}/${Date.now()}_${sanitizeFileName(file.name)}`;
    const { error } = await supabase.storage.from('contract-files').upload(path, file);
    if (error) { setUploadError(error.message); toast.error('Lỗi upload', error.message); setUploading(false); return; }
    const attachment: ContractAttachment = {
      id: crypto.randomUUID(), name: file.name, fileName: sanitizeFileName(file.name),
      storagePath: path, fileType: file.type || file.name.split('.').pop() || '',
      fileSize: file.size, uploadedAt: new Date().toISOString(), uploadedBy: user.name || '',
    };
    const newAttachments = [...(selectedContract.attachments || []), attachment];
    await supabase.from('customer_contracts').update({ attachments: newAttachments }).eq('id', selectedContract.id);
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
    const ok = await confirm({ targetName: att.name, title: 'Xoá file đính kèm', warningText: 'File sẽ bị xoá khỏi Storage. Không thể khôi phục.' });
    if (!ok) return;
    try {
      if (isSupabaseConfigured) await supabase.storage.from('contract-files').remove([att.storagePath]);
      const newAttachments = selectedContract.attachments.filter(a => a.id !== att.id);
      await supabase.from('customer_contracts').update({ attachments: newAttachments }).eq('id', selectedContract.id);
      await fetchContracts();
      setSelectedContract(prev => prev ? { ...prev, attachments: newAttachments } : prev);
      toast.success('Xoá file thành công');
    } catch (e: any) {
      toast.error('Lỗi xoá file', e?.message);
    }
  };

  const filtered = contracts.filter(c => {
    const q = searchTerm.toLowerCase();
    return (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.customerName.toLowerCase().includes(q))
      && (!filterStatus || c.status === filterStatus);
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
            placeholder="Tìm mã, tên, khách hàng..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 dark:text-white outline-none">
          <option value="">Tất cả trạng thái</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-bold rounded-xl shadow-md shadow-emerald-500/20 hover:shadow-emerald-500/40 transition-all">
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
                <th className="px-4 py-3 text-left">Khách hàng</th>
                <th className="px-4 py-3 text-right">Giá trị</th>
                <th className="px-4 py-3 text-center">Trạng thái</th>
                <th className="px-4 py-3 text-center">Kết thúc</th>
                <th className="px-4 py-3 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400"><Loader2 className="inline animate-spin mr-2" size={16} />Đang tải...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400">Chưa có hợp đồng nào</td></tr>
              ) : filtered.map(c => {
                const days = daysUntil(c.endDate);
                const expiringSoon = days !== null && days >= 0 && days <= 30;
                const expired = days !== null && days < 0;
                return (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">{c.code}</td>
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-white max-w-xs truncate">{c.name}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{c.customerName}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-white">{formatCurrency(c.value, c.currency)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_CONFIG[c.status]?.color}`}>
                        {STATUS_CONFIG[c.status]?.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {c.endDate ? (
                        <span className={`text-xs font-bold ${expired ? 'text-red-600' : expiringSoon ? 'text-amber-600' : 'text-slate-500 dark:text-slate-400'}`}>
                          {expired ? '⚠️ ' : expiringSoon ? '🔔 ' : ''}{formatDate(c.endDate)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => { setSelectedContract(c); setDetailTab('info'); }}
                          className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"><Eye size={14} /></button>
                        <button onClick={() => handleEdit(c)}
                          className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"><Edit2 size={14} /></button>
                        <button onClick={() => handleDelete(c.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"><Trash2 size={14} /></button>
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
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                  <Users className="text-white" size={15} />
                </div>
                <h3 className="font-black text-slate-800 dark:text-white">{editingId ? 'Sửa hợp đồng KH' : 'Thêm hợp đồng KH mới'}</h3>
              </div>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"><X size={20} /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mã hợp đồng *</label>
                  <input value={form.code} onChange={e => setForm({...form, code: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
                    placeholder="HD-KH-2025-001" />
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
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
                  placeholder="Mô tả ngắn về hợp đồng" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tên khách hàng *</label>
                  <input value={form.customerName} onChange={e => setForm({...form, customerName: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
                    placeholder="Công ty TNHH ABC" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mã số thuế</label>
                  <input value={form.customerTaxCode} onChange={e => setForm({...form, customerTaxCode: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
                    placeholder="0123456789" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Địa chỉ khách hàng</label>
                <input value={form.customerAddress} onChange={e => setForm({...form, customerAddress: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
                  placeholder="Địa chỉ..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Người đại diện KH</label>
                  <input value={form.customerRepresentative} onChange={e => setForm({...form, customerRepresentative: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
                    placeholder="Nguyễn Văn A" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Chức vụ đại diện</label>
                  <input value={form.customerRepresentativeTitle} onChange={e => setForm({...form, customerRepresentativeTitle: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
                    placeholder="Giám đốc" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Giá trị HĐ</label>
                  <input type="number" value={form.value} onChange={e => setForm({...form, value: Number(e.target.value)})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">VAT (%)</label>
                  <input type="number" value={form.vatPercent} onChange={e => setForm({...form, vatPercent: Number(e.target.value)})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
                    placeholder="10" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Bảo hành (tháng)</label>
                  <input type="number" value={form.warrantyMonths} onChange={e => setForm({...form, warrantyMonths: Number(e.target.value)})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tiến độ thanh toán</label>
                <input value={form.paymentSchedule} onChange={e => setForm({...form, paymentSchedule: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
                  placeholder="VD: 30% tạm ứng, 60% nghiệm thu, 10% bảo hành" />
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
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ngày kết thúc</label>
                  <input type="date" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ghi chú</label>
                <textarea value={form.note} onChange={e => setForm({...form, note: e.target.value})} rows={2}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none resize-none" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex gap-3">
              <button onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Hủy</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-md disabled:opacity-50">
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
                <p className="font-mono text-xs text-emerald-600 dark:text-emerald-400 font-bold">{selectedContract.code}</p>
                <h3 className="font-black text-slate-800 dark:text-white">{selectedContract.name}</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_CONFIG[selectedContract.status]?.color}`}>
                  {STATUS_CONFIG[selectedContract.status]?.label}
                </span>
                <button onClick={() => setSelectedContract(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"><X size={20} /></button>
              </div>
            </div>
            <div className="flex border-b border-slate-100 dark:border-slate-800 px-6">
              {(['info', 'docs'] as const).map(tab => (
                <button key={tab} onClick={() => setDetailTab(tab)}
                  className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${detailTab === tab ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}>
                  {tab === 'info' ? '📋 Thông tin' : `📎 Tài liệu (${selectedContract.attachments?.length || 0})`}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {detailTab === 'info' && (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {[
                    ['Khách hàng', selectedContract.customerName],
                    ['MST', selectedContract.customerTaxCode],
                    ['Địa chỉ', selectedContract.customerAddress],
                    ['Người đại diện', selectedContract.customerRepresentative],
                    ['Chức vụ', selectedContract.customerRepresentativeTitle],
                    ['Giá trị HĐ', formatCurrency(selectedContract.value, selectedContract.currency)],
                    ['VAT', selectedContract.vatPercent ? `${selectedContract.vatPercent}%` : null],
                    ['Bảo hành', selectedContract.warrantyMonths ? `${selectedContract.warrantyMonths} tháng` : null],
                    ['TT', selectedContract.paymentSchedule],
                    ['Ngày ký', formatDate(selectedContract.signedDate)],
                    ['Ngày hiệu lực', formatDate(selectedContract.effectiveDate)],
                    ['Ngày kết thúc', formatDate(selectedContract.endDate)],
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
                  <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-emerald-200 dark:border-emerald-800 rounded-xl p-6 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10 transition-all">
                    <Upload className="text-emerald-400" size={24} />
                    <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Kéo thả hoặc click để tải lên</span>
                    <span className="text-xs text-slate-400">PDF, DOCX, JPG — Tối đa 20MB</span>
                    <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx" onChange={handleFileUpload} disabled={uploading} />
                    {uploading && <div className="flex items-center gap-2 text-emerald-500 text-xs font-bold"><Loader2 size={14} className="animate-spin" />Đang tải lên...</div>}
                    {uploadError && <p className="text-xs text-red-500 font-bold">{uploadError}</p>}
                  </label>
                  {selectedContract.attachments?.length === 0 && !uploading && (
                    <p className="text-center text-sm text-slate-400 py-4">Chưa có tài liệu đính kèm</p>
                  )}
                  {selectedContract.attachments?.map(att => (
                    <div key={att.id} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl group">
                      <File className="text-emerald-500 shrink-0" size={20} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{att.name}</p>
                        <p className="text-xs text-slate-400">{(att.fileSize / 1024).toFixed(0)} KB · {formatDate(att.uploadedAt)}</p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleDownload(att)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"><Download size={13} /></button>
                        <button onClick={() => handleDeleteFile(att)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"><Trash2 size={13} /></button>
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

export default CustomerContracts;
