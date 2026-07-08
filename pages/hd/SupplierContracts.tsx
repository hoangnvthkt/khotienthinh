import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import {
  SupplierContract,
  HdContractStatus,
  ContractAttachment,
  Project,
  BusinessPartner,
  SupplierContractLine,
  SupplierDeliveryStatement,
  SupplierDirectDeliveryNote,
  SupplierPayableDocument,
  SupplierPaymentBatch,
} from '../../types';
import { useModuleData } from '../../hooks/useModuleData';
import { projectMasterService } from '../../lib/projectMasterService';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import SearchableSelect from '../../components/common/SearchableSelect';
import { partnerService } from '../../lib/partnerService';
import {
  supplierContractLineService,
  supplierDeliveryStatementService,
  supplierDirectDeliveryService,
} from '../../lib/supplierDeliveryStatementService';
import { supplierPayableService } from '../../lib/supplierPayableService';
import { supplierPaymentBatchService } from '../../lib/supplierPaymentBatchService';

// ─── helpers ─────────────────────────────────────────────────────────────────
const formatCurrency = (v: number, currency = 'VND') =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);

const formatDate = (d?: string) => d ? new Date(d).toLocaleDateString('vi-VN') : '—';

const moneyNumber = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
};

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

type SupplierContractDetailTab = 'info' | 'rates' | 'deliveries' | 'statements' | 'payments' | 'docs';

const EMPTY_CONTRACT_LINE_FORM = {
  itemNameSnapshot: '',
  unitSnapshot: '',
  unitPrice: 0,
  vatRate: 10,
  quantityLimit: '',
  amountLimit: '',
  deliveryTerms: '',
  note: '',
};

const EMPTY_FORM: Omit<SupplierContract, 'id' | 'attachments' | 'createdAt' | 'updatedAt'> = {
  code: '', name: '', type: 'purchase', supplierId: '', supplierName: '',
  projectId: '', constructionSiteId: '',
  supplierRepresentative: '', value: 0, currency: 'VND', paymentMethod: 'bank_transfer',
  paymentTerms: '', guaranteeInfo: '', purchaseOrderNumber: '',
  signedDate: '', effectiveDate: '', expiryDate: '',
  managedByUserId: '', managedByName: '', status: 'draft', note: '',
};

// ─── Main Component ────────────────────────────────────────────────────────────
const SupplierContracts: React.FC = () => {
  const { user } = useApp();
  const [suppliers, setSuppliers] = useState<BusinessPartner[]>([]);
  useModuleData('wms');
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [contracts, setContracts] = useState<SupplierContract[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
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
  const [detailTab, setDetailTab] = useState<SupplierContractDetailTab>('info');
  const [contractLines, setContractLines] = useState<SupplierContractLine[]>([]);
  const [contractDeliveries, setContractDeliveries] = useState<SupplierDirectDeliveryNote[]>([]);
  const [contractStatements, setContractStatements] = useState<SupplierDeliveryStatement[]>([]);
  const [contractPayables, setContractPayables] = useState<SupplierPayableDocument[]>([]);
  const [contractPaymentBatches, setContractPaymentBatches] = useState<SupplierPaymentBatch[]>([]);
  const [loadingContractLedger, setLoadingContractLedger] = useState(false);
  const [contractLineForm, setContractLineForm] = useState(EMPTY_CONTRACT_LINE_FORM);
  const [savingContractLine, setSavingContractLine] = useState(false);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // ── fetch ────────────────────────────────────────────────────────────────────
  const fetchContracts = async () => {
    setLoading(true);
    projectMasterService.list().then(setProjects).catch(console.error);
    partnerService.list({ classification: 'supplier' }).then(setSuppliers).catch(console.error);
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
        projectId: r.project_id || undefined, constructionSiteId: r.construction_site_id || undefined,
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

  const loadSupplierContractLedger = useCallback(async (contract: SupplierContract) => {
    setLoadingContractLedger(true);
    try {
      const [lines, deliveries, statements, payables, paymentBatches] = await Promise.all([
        supplierContractLineService.listByContract(contract.id),
        supplierDirectDeliveryService.list({
          projectId: contract.projectId || null,
          constructionSiteId: contract.constructionSiteId || null,
          supplierContractId: contract.id,
        }),
        supplierDeliveryStatementService.list({
          projectId: contract.projectId || null,
          constructionSiteId: contract.constructionSiteId || null,
          supplierContractId: contract.id,
        }),
        supplierPayableService.listDocuments({
          projectId: contract.projectId || null,
          constructionSiteId: contract.constructionSiteId || null,
          supplierId: contract.supplierId || null,
          sourceType: 'supplier_delivery_statement',
        }),
        supplierPaymentBatchService.listBatches({
          projectId: contract.projectId || null,
          constructionSiteId: contract.constructionSiteId || null,
          supplierId: contract.supplierId || null,
        }),
      ]);
      setContractLines(lines);
      setContractDeliveries(deliveries);
      setContractStatements(statements);
      setContractPayables(payables.filter(doc =>
        doc.supplierContractId === contract.id || doc.metadata?.supplierContractId === contract.id,
      ));
      setContractPaymentBatches(paymentBatches);
    } catch (e: any) {
      toast.error('Không tải được dữ liệu HĐ NCC', e?.message || 'Vui lòng thử lại.');
      setContractLines([]);
      setContractDeliveries([]);
      setContractStatements([]);
      setContractPayables([]);
      setContractPaymentBatches([]);
    } finally {
      setLoadingContractLedger(false);
    }
  }, [toast]);

  useEffect(() => {
    if (selectedContract) void loadSupplierContractLedger(selectedContract);
  }, [loadSupplierContractLedger, selectedContract]);

  // ── save (add / edit) ────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim()) return;
    if (!form.projectId) {
      toast.warning('Thiếu thông tin', 'Vui lòng chọn dự án liên kết.');
      return;
    }
    setSaving(true);
    const project = projects.find(item => item.id === form.projectId);
    const payload = {
      id: editingId || crypto.randomUUID(),
      code: form.code.trim(), name: form.name.trim(), type: form.type,
      project_id: form.projectId || null,
      construction_site_id: project?.constructionSiteId || form.constructionSiteId || null,
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

  const handleSaveContractLine = async () => {
    if (!selectedContract) return;
    if (!contractLineForm.itemNameSnapshot.trim()) {
      toast.warning('Thiếu tên vật tư', 'Nhập tên vật tư/điều khoản đơn giá trước khi lưu.');
      return;
    }
    if (Number(contractLineForm.unitPrice || 0) < 0) {
      toast.warning('Đơn giá không hợp lệ', 'Đơn giá HĐ không được âm.');
      return;
    }
    setSavingContractLine(true);
    try {
      const nextLine: SupplierContractLine = {
        id: crypto.randomUUID(),
        supplierContractId: selectedContract.id,
        lineNo: contractLines.length + 1,
        itemNameSnapshot: contractLineForm.itemNameSnapshot.trim(),
        unitSnapshot: contractLineForm.unitSnapshot.trim() || null,
        unitPrice: Number(contractLineForm.unitPrice || 0),
        vatRate: Number(contractLineForm.vatRate || 0),
        quantityLimit: contractLineForm.quantityLimit === '' ? null : Number(contractLineForm.quantityLimit || 0),
        amountLimit: contractLineForm.amountLimit === '' ? null : Number(contractLineForm.amountLimit || 0),
        deliveryTerms: contractLineForm.deliveryTerms.trim() || null,
        note: contractLineForm.note.trim() || null,
      };
      await supplierContractLineService.upsert([nextLine]);
      setContractLineForm(EMPTY_CONTRACT_LINE_FORM);
      await loadSupplierContractLedger(selectedContract);
      toast.success('Đã thêm dòng đơn giá HĐ');
    } catch (e: any) {
      toast.error('Không lưu được dòng đơn giá', e?.message || 'Vui lòng thử lại.');
    } finally {
      setSavingContractLine(false);
    }
  };

  const handleEdit = (c: SupplierContract) => {
    setForm({
      code: c.code, name: c.name, type: c.type,
      projectId: c.projectId || '', constructionSiteId: c.constructionSiteId || '',
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
    const matchSearch = !searchTerm.trim() || matchesSearchQueryMultiple([
      c.code,
      c.name,
      c.supplierName
    ], searchTerm);
    const matchStatus = !filterStatus || c.status === filterStatus;
    return matchSearch && matchStatus;
  });
  const contractRecognizedAmount = contractPayables.reduce((sum, doc) => sum + moneyNumber(doc.recognizedAmount), 0);
  const contractPaidAmount = contractPayables.reduce((sum, doc) => sum + moneyNumber(doc.paidAmount), 0);
  const contractOutstandingAmount = contractPayables.reduce((sum, doc) => sum + moneyNumber(doc.outstandingAmount), 0);
  const contractRemainingAmount = selectedContract ? Math.max(0, moneyNumber(selectedContract.value) - contractRecognizedAmount) : 0;

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
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Dự án *</label>
                <SearchableSelect
                  value={form.projectId || ''}
                  options={projects}
                  onChange={val => setForm({ ...form, projectId: val ? val.id : '', constructionSiteId: val?.constructionSiteId || '' })}
                  getOptionValue={p => p.id}
                  getOptionLabel={p => p.code ? `${p.code} - ${p.name}` : p.name}
                  placeholder="Chọn dự án..."
                  emptyLabel="Không tìm thấy dự án"
                  className="w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nhà cung cấp *</label>
                  <SearchableSelect
                    value={form.supplierId || ''}
                    options={suppliers || []}
                    onChange={val => setForm({
                      ...form,
                      supplierId: val ? val.id : '',
                      supplierName: val ? val.name : '',
                      supplierRepresentative: val ? (val.contactName || '') : ''
                    })}
                    getOptionValue={s => s.id}
                    getOptionLabel={s => s.code ? `${s.code} - ${s.name}` : s.name}
                    placeholder="Chọn nhà cung cấp..."
                    emptyLabel="Không tìm thấy nhà cung cấp"
                    className="w-full"
                  />
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
              {([
                ['info', 'Thông tin'],
                ['rates', `Đơn giá (${contractLines.length})`],
                ['deliveries', `Giao nhận (${contractDeliveries.length})`],
                ['statements', `Đối soát (${contractStatements.length})`],
                ['payments', 'Thanh toán'],
                ['docs', `Tài liệu (${selectedContract.attachments?.length || 0})`],
              ] as Array<[SupplierContractDetailTab, string]>).map(([tab, label]) => (
                <button key={tab} onClick={() => setDetailTab(tab)}
                  className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${detailTab === tab ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {detailTab === 'info' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      ['Giá trị HĐ', formatCurrency(selectedContract.value, selectedContract.currency), 'text-slate-900 dark:text-white'],
                      ['Đã ghi nhận phải trả', formatCurrency(contractRecognizedAmount, selectedContract.currency), 'text-blue-700 dark:text-blue-300'],
                      ['Đã thanh toán', formatCurrency(contractPaidAmount, selectedContract.currency), 'text-emerald-700 dark:text-emerald-300'],
                      ['Còn phải trả', formatCurrency(contractOutstandingAmount, selectedContract.currency), 'text-red-700 dark:text-red-300'],
                    ].map(([label, value, tone]) => (
                      <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800">
                        <p className="text-[10px] font-black uppercase text-slate-400">{label}</p>
                        <p className={`mt-1 text-sm font-black ${tone}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {[
                      ['Nhà cung cấp', selectedContract.supplierName],
                      ['Người đại diện', selectedContract.supplierRepresentative],
                      ['Còn lại theo HĐ', formatCurrency(contractRemainingAmount, selectedContract.currency)],
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
                </div>
              )}
              {detailTab === 'rates' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-12 gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <input
                      value={contractLineForm.itemNameSnapshot}
                      onChange={e => setContractLineForm({ ...contractLineForm, itemNameSnapshot: e.target.value })}
                      className="col-span-3 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      placeholder="Tên vật tư"
                    />
                    <input
                      value={contractLineForm.unitSnapshot}
                      onChange={e => setContractLineForm({ ...contractLineForm, unitSnapshot: e.target.value })}
                      className="col-span-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      placeholder="ĐVT"
                    />
                    <input
                      type="number"
                      value={contractLineForm.unitPrice}
                      onChange={e => setContractLineForm({ ...contractLineForm, unitPrice: Number(e.target.value) })}
                      className="col-span-2 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      placeholder="Đơn giá"
                    />
                    <input
                      type="number"
                      value={contractLineForm.vatRate}
                      onChange={e => setContractLineForm({ ...contractLineForm, vatRate: Number(e.target.value) })}
                      className="col-span-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      placeholder="VAT"
                    />
                    <input
                      value={contractLineForm.deliveryTerms}
                      onChange={e => setContractLineForm({ ...contractLineForm, deliveryTerms: e.target.value })}
                      className="col-span-3 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      placeholder="Điều khoản giao nhận"
                    />
                    <button
                      onClick={handleSaveContractLine}
                      disabled={savingContractLine}
                      className="col-span-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-black text-white disabled:opacity-50"
                    >
                      {savingContractLine ? 'Đang lưu' : 'Thêm đơn giá'}
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs font-black uppercase text-slate-400 dark:bg-slate-800">
                        <tr>
                          <th className="px-3 py-2 text-left">Vật tư</th>
                          <th className="px-3 py-2 text-left">ĐVT</th>
                          <th className="px-3 py-2 text-right">Đơn giá</th>
                          <th className="px-3 py-2 text-right">VAT</th>
                          <th className="px-3 py-2 text-left">Điều khoản</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {contractLines.length === 0 ? (
                          <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Chưa khai báo dòng đơn giá HĐ</td></tr>
                        ) : contractLines.map(line => (
                          <tr key={line.id}>
                            <td className="px-3 py-2 font-bold text-slate-800 dark:text-white">{line.itemNameSnapshot}</td>
                            <td className="px-3 py-2 text-slate-500">{line.unitSnapshot || '-'}</td>
                            <td className="px-3 py-2 text-right font-bold">{formatCurrency(line.unitPrice, selectedContract.currency)}</td>
                            <td className="px-3 py-2 text-right">{line.vatRate}%</td>
                            <td className="px-3 py-2 text-slate-500">{line.deliveryTerms || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {detailTab === 'deliveries' && (
                <div className="space-y-3">
                  {loadingContractLedger ? (
                    <p className="py-8 text-center text-sm font-bold text-slate-400">Đang tải giao nhận...</p>
                  ) : contractDeliveries.length === 0 ? (
                    <p className="py-8 text-center text-sm font-bold text-slate-400">Chưa có phiếu giao nhận theo HĐ này</p>
                  ) : contractDeliveries.map(note => (
                    <div key={note.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-slate-800 dark:text-white">{note.code}</p>
                          <p className="text-xs font-bold text-slate-400">Phiếu NCC {note.deliveryTicketNo} · {formatDate(note.deliveryDate)}</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">{note.status}</span>
                      </div>
                      <p className="mt-2 text-right text-sm font-black text-blue-700 dark:text-blue-300">{formatCurrency(note.totalAmount, selectedContract.currency)}</p>
                    </div>
                  ))}
                </div>
              )}
              {detailTab === 'statements' && (
                <div className="space-y-3">
                  {contractStatements.length === 0 ? (
                    <p className="py-8 text-center text-sm font-bold text-slate-400">Chưa có bảng đối soát theo HĐ này</p>
                  ) : contractStatements.map(statement => (
                    <div key={statement.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-slate-800 dark:text-white">{statement.code}</p>
                          <p className="text-xs font-bold text-slate-400">Kỳ {formatDate(statement.periodMonth)} · ngày {formatDate(statement.statementDate)}</p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-black ${statement.status === 'posted' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {statement.status}
                        </span>
                      </div>
                      <p className="mt-2 text-right text-sm font-black text-blue-700 dark:text-blue-300">{formatCurrency(statement.totalAmount, selectedContract.currency)}</p>
                    </div>
                  ))}
                </div>
              )}
              {detailTab === 'payments' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800">
                      <p className="text-[10px] font-black uppercase text-slate-400">AP theo HĐ</p>
                      <p className="mt-1 text-sm font-black text-blue-700">{formatCurrency(contractRecognizedAmount, selectedContract.currency)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800">
                      <p className="text-[10px] font-black uppercase text-slate-400">Đã trả</p>
                      <p className="mt-1 text-sm font-black text-emerald-700">{formatCurrency(contractPaidAmount, selectedContract.currency)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800">
                      <p className="text-[10px] font-black uppercase text-slate-400">Còn phải trả</p>
                      <p className="mt-1 text-sm font-black text-red-700">{formatCurrency(contractOutstandingAmount, selectedContract.currency)}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-black uppercase text-slate-400">Chứng từ phải trả từ đối soát HĐ</p>
                    {contractPayables.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm font-bold text-slate-400 dark:border-slate-800">Chưa ghi nhận AP theo HĐ này</p>
                    ) : contractPayables.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                        <div>
                          <p className="font-black text-slate-800 dark:text-white">{doc.documentNo}</p>
                          <p className="text-xs font-bold text-slate-400">{formatDate(doc.documentDate)} · {doc.status}</p>
                        </div>
                        <p className="font-black text-red-700">{formatCurrency(doc.outstandingAmount, selectedContract.currency)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-black uppercase text-slate-400">Đợt thanh toán NCC trong phạm vi dự án/công trường</p>
                    {contractPaymentBatches.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm font-bold text-slate-400 dark:border-slate-800">Chưa có đợt thanh toán NCC</p>
                    ) : contractPaymentBatches.map(batch => (
                      <div key={batch.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                        <div>
                          <p className="font-black text-slate-800 dark:text-white">{batch.code}</p>
                          <p className="text-xs font-bold text-slate-400">{formatDate(batch.paymentDate)} · {batch.status}</p>
                        </div>
                        <p className="font-black text-emerald-700">{formatCurrency(batch.amount, selectedContract.currency)}</p>
                      </div>
                    ))}
                  </div>
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
