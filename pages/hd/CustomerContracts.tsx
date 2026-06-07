import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  Download,
  Edit2,
  Eye,
  File,
  FileSignature,
  Loader2,
  Paperclip,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import SearchableSelect from '../../components/common/SearchableSelect';

import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import {
  BusinessPartner,
  ContractAttachment,
  ContractFormTemplate,
  ContractGuarantee,
  ContractGuaranteeStatus,
  ContractGuaranteeType,
  ContractTemplateField,
  ContractTypeMetadata,
  CustomerContract,
  HdContractStatus,
  Project,
} from '../../types';
import { customerContractService } from '../../lib/hdService';
import { partnerService } from '../../lib/partnerService';
import { contractGuaranteeService, contractTemplateService, contractTypeService } from '../../lib/contractMetadataService';
import { projectMasterService } from '../../lib/projectMasterService';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';

const STATUS_CONFIG: Record<HdContractStatus, { label: string; color: string }> = {
  draft: { label: 'Nháp', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  negotiating: { label: 'Đang đàm phán', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  signed: { label: 'Đã ký', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  active: { label: 'Đang thực hiện', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  completed: { label: 'Hoàn thành', color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' },
  expired: { label: 'Hết hạn', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  cancelled: { label: 'Đã hủy', color: 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400' },
};

const GUARANTEE_TYPES: Record<ContractGuaranteeType, string> = {
  performance: 'Bảo lãnh thực hiện HĐ',
  advance: 'Bảo lãnh tạm ứng',
  warranty: 'Bảo lãnh bảo hành',
  other: 'Khác',
};

const GUARANTEE_STATUSES: Record<ContractGuaranteeStatus, string> = {
  draft: 'Nháp',
  active: 'Hiệu lực',
  released: 'Đã giải tỏa',
  expired: 'Hết hạn',
  cancelled: 'Đã hủy',
};

interface ReceivedContractForm {
  code: string;
  name: string;
  projectId: string;
  contractTypeId: string;
  ownerPartnerId: string;
  appendixNumber: string;
  appendixName: string;
  customerName: string;
  customerTaxCode: string;
  customerAddress: string;
  customerRepresentative: string;
  customerRepresentativeTitle: string;
  representativePhone: string;
  representativeEmail: string;
  website: string;
  bankAccount: string;
  bankName: string;
  goodsAmount: number;
  discountPercent: number;
  overheadCost: number;
  vatPercent: number;
  signedDate: string;
  effectiveDate: string;
  endDate: string;
  durationText: string;
  status: HdContractStatus;
  note: string;
  customData: Record<string, any>;
}

const emptyForm = (): ReceivedContractForm => ({
  code: '',
  name: '',
  projectId: '',
  contractTypeId: '',
  ownerPartnerId: '',
  appendixNumber: '',
  appendixName: '',
  customerName: '',
  customerTaxCode: '',
  customerAddress: '',
  customerRepresentative: '',
  customerRepresentativeTitle: '',
  representativePhone: '',
  representativeEmail: '',
  website: '',
  bankAccount: '',
  bankName: '',
  goodsAmount: 0,
  discountPercent: 0,
  overheadCost: 0,
  vatPercent: 10,
  signedDate: '',
  effectiveDate: '',
  endDate: '',
  durationText: '',
  status: 'draft',
  note: '',
  customData: {},
});

const formatCurrency = (value: number | string | undefined, currency = 'VND') =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0));

const formatDate = (value?: string) => value ? new Date(value).toLocaleDateString('vi-VN') : '-';
const sanitizeFileName = (name: string) =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');

const calculateTotals = (form: ReceivedContractForm) => {
  const goodsAmount = Number(form.goodsAmount || 0);
  const discountPercent = Number(form.discountPercent || 0);
  const overheadCost = Number(form.overheadCost || 0);
  const vatPercent = Number(form.vatPercent || 0);
  const discountAmount = Math.round(goodsAmount * discountPercent / 100);
  const beforeVat = Math.max(0, goodsAmount - discountAmount + overheadCost);
  const vatAmount = Math.round(beforeVat * vatPercent / 100);
  const contractValue = beforeVat + vatAmount;
  return { goodsAmount, discountAmount, beforeVat, vatAmount, contractValue };
};

const getTemplateDefaults = (template: ContractFormTemplate | null): Record<string, any> => {
  const data: Record<string, any> = {};
  template?.sections?.forEach(section => {
    section.fields?.forEach(field => {
      if (field.defaultValue !== undefined && field.defaultValue !== null) data[field.key] = field.defaultValue;
      else if (field.fieldType === 'number' || field.fieldType === 'currency' || field.fieldType === 'percent') data[field.key] = 0;
      else data[field.key] = '';
    });
  });
  return data;
};

const CustomerContracts: React.FC = () => {
  const { user } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [contracts, setContracts] = useState<CustomerContract[]>([]);
  const [partners, setPartners] = useState<BusinessPartner[]>([]);
  const [contractTypes, setContractTypes] = useState<ContractTypeMetadata[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ReceivedContractForm>(emptyForm());
  const [activeTemplate, setActiveTemplate] = useState<ContractFormTemplate | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [selectedContract, setSelectedContract] = useState<CustomerContract | null>(null);
  const [detailTab, setDetailTab] = useState<'info' | 'guarantees' | 'docs'>('info');
  const [guarantees, setGuarantees] = useState<ContractGuarantee[]>([]);
  const [guaranteeForm, setGuaranteeForm] = useState<Partial<ContractGuarantee> | null>(null);
  const [uploadCategory, setUploadCategory] = useState<'contract' | 'other'>('contract');
  const [uploading, setUploading] = useState(false);

  const ownerPartners = useMemo(
    () => partners.filter(partner => partner.isActive && partner.classifications.includes('owner')),
    [partners],
  );

  const totals = useMemo(() => calculateTotals(form), [form]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [contractData, partnerData, typeData, projectData] = await Promise.all([
        customerContractService.list(),
        partnerService.list({ classification: 'owner' }),
        contractTypeService.list(),
        projectMasterService.list(),
      ]);
      setContracts(contractData);
      setPartners(partnerData);
      setContractTypes(typeData);
      setProjects(projectData);
    } catch (error: any) {
      toast.error('Lỗi tải HĐ nhận thầu', error?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!form.contractTypeId || !showForm) {
      setActiveTemplate(null);
      return;
    }
    let cancelled = false;
    setTemplateLoading(true);
    contractTemplateService.getDefaultTemplate(form.contractTypeId)
      .then(template => {
        if (cancelled) return;
        setActiveTemplate(template);
        setForm(prev => ({ ...prev, customData: { ...getTemplateDefaults(template), ...prev.customData } }));
      })
      .catch((error: any) => toast.error('Lỗi tải mẫu HĐ', error?.message))
      .finally(() => { if (!cancelled) setTemplateLoading(false); });
    return () => { cancelled = true; };
  }, [form.contractTypeId, showForm]);

  useEffect(() => {
    if (!selectedContract) {
      setGuarantees([]);
      return;
    }
    contractGuaranteeService.listByContract(selectedContract.id)
      .then(setGuarantees)
      .catch((error: any) => toast.error('Lỗi tải bảo lãnh', error?.message));
  }, [selectedContract?.id]);

  const filtered = useMemo(() => {
    return contracts.filter(contract => {
      const project = projects.find(p => p.id === contract.projectId);
      const matchesSearch = !searchTerm.trim() || matchesSearchQueryMultiple([
        contract.code,
        contract.name,
        contract.customerName,
        contract.customerTaxCode,
        project?.name,
      ], searchTerm);
      const matchesStatus = !filterStatus || contract.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [contracts, projects, searchTerm, filterStatus]);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm());
    setActiveTemplate(null);
    setShowForm(false);
  };

  const openCreate = () => {
    const next = emptyForm();
    next.contractTypeId = contractTypes[0]?.id || '';
    setEditingId(null);
    setForm(next);
    setShowForm(true);
  };

  const openEdit = (contract: CustomerContract) => {
    const customData = contract.customData || {};
    setEditingId(contract.id);
    setForm({
      code: contract.code || '',
      name: contract.name || '',
      projectId: contract.projectId || '',
      contractTypeId: contract.contractTypeId || contractTypes.find(t => t.code === contract.type)?.id || contractTypes[0]?.id || '',
      ownerPartnerId: contract.ownerPartnerId || '',
      appendixNumber: customData.appendixNumber || '',
      appendixName: customData.appendixName || '',
      customerName: contract.customerName || '',
      customerTaxCode: contract.customerTaxCode || '',
      customerAddress: contract.customerAddress || '',
      customerRepresentative: contract.customerRepresentative || '',
      customerRepresentativeTitle: contract.customerRepresentativeTitle || '',
      representativePhone: customData.representativePhone || '',
      representativeEmail: customData.representativeEmail || '',
      website: customData.website || '',
      bankAccount: customData.bankAccount || '',
      bankName: customData.bankName || '',
      goodsAmount: Number(customData.goodsAmount || contract.value || 0),
      discountPercent: Number(customData.discountPercent || 0),
      overheadCost: Number(customData.overheadCost || 0),
      vatPercent: Number(contract.vatPercent ?? customData.vatPercent ?? 10),
      signedDate: contract.signedDate || '',
      effectiveDate: contract.effectiveDate || '',
      endDate: contract.endDate || '',
      durationText: customData.durationText || '',
      status: contract.status || 'draft',
      note: contract.note || '',
      customData,
    });
    setShowForm(true);
  };

  const handleOwnerChange = (partnerId: string) => {
    const partner = ownerPartners.find(item => item.id === partnerId);
    setForm(prev => ({
      ...prev,
      ownerPartnerId: partnerId,
      customerName: partner?.name || '',
      customerTaxCode: partner?.taxCode || '',
      customerAddress: partner?.address || '',
      customerRepresentative: partner?.contactName || '',
      customerRepresentativeTitle: partner?.contactTitle || '',
      representativePhone: partner?.contactPhone || partner?.phone || '',
      representativeEmail: partner?.contactEmail || partner?.email || '',
      website: partner?.website || '',
      bankAccount: partner?.bankAccount || '',
      bankName: partner?.bankName || '',
    }));
  };

  const setCustomValue = (key: string, value: any) => {
    setForm(prev => ({ ...prev, customData: { ...prev.customData, [key]: value } }));
  };

  const validateForm = () => {
    if (!form.projectId) return 'Chọn dự án';
    if (!form.contractTypeId) return 'Chọn loại hợp đồng';
    if (!form.ownerPartnerId) return 'Chọn chủ đầu tư';
    if (!form.code.trim()) return 'Nhập số hợp đồng';
    const requiredField = activeTemplate?.sections
      ?.flatMap(section => section.fields || [])
      .find(field => field.required && !String(form.customData[field.key] ?? '').trim());
    if (requiredField) return `Nhập ${requiredField.label}`;
    return '';
  };

  const handleSave = async () => {
    const validation = validateForm();
    if (validation) return toast.error(validation);
    setSaving(true);
    try {
      const project = projects.find(item => item.id === form.projectId);
      const contractType = contractTypes.find(item => item.id === form.contractTypeId);
      const owner = ownerPartners.find(item => item.id === form.ownerPartnerId);
      const existing = editingId ? contracts.find(item => item.id === editingId) : null;
      const commercialData = {
        appendixNumber: form.appendixNumber,
        appendixName: form.appendixName,
        representativePhone: form.representativePhone,
        representativeEmail: form.representativeEmail,
        website: form.website,
        bankAccount: form.bankAccount,
        bankName: form.bankName,
        goodsAmount: totals.goodsAmount,
        discountPercent: Number(form.discountPercent || 0),
        discountAmount: totals.discountAmount,
        overheadCost: Number(form.overheadCost || 0),
        vatPercent: Number(form.vatPercent || 0),
        vatAmount: totals.vatAmount,
        durationText: form.durationText,
      };
      const contract: CustomerContract = {
        id: editingId || crypto.randomUUID(),
        code: form.code.trim(),
        name: form.name.trim() || form.code.trim(),
        type: contractType?.code || 'construction',
        contractTypeId: form.contractTypeId,
        ownerPartnerId: form.ownerPartnerId,
        templateId: activeTemplate?.id || undefined,
        templateSnapshot: activeTemplate,
        customData: { ...form.customData, ...commercialData },
        counterpartySnapshot: owner ? {
          id: owner.id,
          code: owner.code,
          name: owner.name,
          taxCode: owner.taxCode,
          address: owner.address,
          contactName: owner.contactName,
          contactTitle: owner.contactTitle,
          contactPhone: owner.contactPhone || owner.phone,
          contactEmail: owner.contactEmail || owner.email,
          bankName: owner.bankName,
          bankAccount: owner.bankAccount,
        } : null,
        customerName: form.customerName,
        customerTaxCode: form.customerTaxCode || undefined,
        customerAddress: form.customerAddress || undefined,
        customerRepresentative: form.customerRepresentative || undefined,
        customerRepresentativeTitle: form.customerRepresentativeTitle || undefined,
        projectId: form.projectId,
        constructionSiteId: project?.constructionSiteId || null,
        value: totals.contractValue,
        vatPercent: Number(form.vatPercent || 0),
        currency: 'VND',
        paymentMethod: 'bank_transfer',
        paymentSchedule: form.customData.paymentTerms || '',
        warrantyMonths: Number(form.customData.warrantyMonths || 0),
        signedDate: form.signedDate || undefined,
        effectiveDate: form.effectiveDate || undefined,
        endDate: form.endDate || undefined,
        managedByUserId: existing?.managedByUserId || user.id,
        managedByName: existing?.managedByName || user.name || user.username,
        status: form.status,
        note: form.note || undefined,
        attachments: existing?.attachments || [],
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await customerContractService.upsert(contract);
      if (!editingId) await contractGuaranteeService.createDefaults(contract.id);
      toast.success(editingId ? 'Cập nhật HĐ nhận thầu' : 'Tạo HĐ nhận thầu thành công', contract.code);
      resetForm();
      await loadData();
    } catch (error: any) {
      toast.error('Lỗi lưu HĐ nhận thầu', error?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (contract: CustomerContract) => {
    const ok = await confirm({
      title: 'Xóa HĐ nhận thầu',
      targetName: contract.code,
      warningText: 'Hợp đồng, file đính kèm và các mục bảo lãnh liên quan sẽ bị xóa.',
    });
    if (!ok) return;
    try {
      await customerContractService.remove(contract.id);
      toast.success('Đã xóa HĐ nhận thầu');
      if (selectedContract?.id === contract.id) setSelectedContract(null);
      await loadData();
    } catch (error: any) {
      toast.error('Lỗi xóa hợp đồng', error?.message);
    }
  };

  const triggerUpload = (category: 'contract' | 'other') => {
    setUploadCategory(category);
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedContract || !event.target.files?.length || !isSupabaseConfigured) return;
    const file = event.target.files[0];
    setUploading(true);
    try {
      const safeName = sanitizeFileName(file.name);
      const path = `customer/${selectedContract.id}/${uploadCategory}/${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from('contract-files').upload(path, file);
      if (error) throw error;
      const attachment: ContractAttachment = {
        id: crypto.randomUUID(),
        name: file.name,
        fileName: safeName,
        storagePath: path,
        fileType: file.type || safeName.split('.').pop() || '',
        fileSize: file.size,
        category: uploadCategory,
        uploadedAt: new Date().toISOString(),
        uploadedBy: user.name || user.username || '',
      };
      const attachments = [...(selectedContract.attachments || []), attachment];
      await customerContractService.updateAttachments(selectedContract.id, attachments);
      setSelectedContract({ ...selectedContract, attachments });
      setContracts(prev => prev.map(item => item.id === selectedContract.id ? { ...item, attachments } : item));
      toast.success('Upload file thành công');
    } catch (error: any) {
      toast.error('Lỗi upload file', error?.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownload = async (attachment: ContractAttachment) => {
    if (!isSupabaseConfigured) return;
    const { data, error } = await supabase.storage.from('contract-files').createSignedUrl(attachment.storagePath, 60);
    if (error) return toast.error('Lỗi tải file', error.message);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  const handleDeleteFile = async (attachment: ContractAttachment) => {
    if (!selectedContract) return;
    const ok = await confirm({ title: 'Xóa file đính kèm', targetName: attachment.name });
    if (!ok) return;
    try {
      if (isSupabaseConfigured) await supabase.storage.from('contract-files').remove([attachment.storagePath]);
      const attachments = (selectedContract.attachments || []).filter(item => item.id !== attachment.id);
      await customerContractService.updateAttachments(selectedContract.id, attachments);
      setSelectedContract({ ...selectedContract, attachments });
      setContracts(prev => prev.map(item => item.id === selectedContract.id ? { ...item, attachments } : item));
      toast.success('Đã xóa file');
    } catch (error: any) {
      toast.error('Lỗi xóa file', error?.message);
    }
  };

  const saveGuarantee = async () => {
    if (!selectedContract || !guaranteeForm?.name?.trim()) return;
    setSaving(true);
    try {
      await contractGuaranteeService.upsert({
        ...guaranteeForm,
        contractId: selectedContract.id,
        name: guaranteeForm.name,
        amount: Number(guaranteeForm.amount || 0),
        percent: Number(guaranteeForm.percent || 0),
      });
      setGuaranteeForm(null);
      setGuarantees(await contractGuaranteeService.listByContract(selectedContract.id));
      toast.success('Đã lưu bảo lãnh');
    } catch (error: any) {
      toast.error('Lỗi lưu bảo lãnh', error?.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteGuarantee = async (guarantee: ContractGuarantee) => {
    const ok = await confirm({ title: 'Xóa bảo lãnh', targetName: guarantee.name });
    if (!ok || !selectedContract) return;
    try {
      await contractGuaranteeService.remove(guarantee.id);
      setGuarantees(await contractGuaranteeService.listByContract(selectedContract.id));
      toast.success('Đã xóa bảo lãnh');
    } catch (error: any) {
      toast.error('Lỗi xóa bảo lãnh', error?.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
            placeholder="Tìm số HĐ, tên HĐ, chủ đầu tư, dự án..."
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
          {Object.entries(STATUS_CONFIG).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
        </select>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-bold rounded-xl shadow-md shadow-emerald-500/20"
        >
          <Plus size={15} /> Tạo HĐ nhận thầu
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">
                <th className="px-4 py-3 text-left">Số HĐ</th>
                <th className="px-4 py-3 text-left">Hợp đồng</th>
                <th className="px-4 py-3 text-left">Dự án</th>
                <th className="px-4 py-3 text-left">Chủ đầu tư</th>
                <th className="px-4 py-3 text-right">Giá trị</th>
                <th className="px-4 py-3 text-center">Trạng thái</th>
                <th className="px-4 py-3 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400"><Loader2 className="inline animate-spin mr-2" size={16} />Đang tải...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400">Chưa có HĐ nhận thầu</td></tr>
              ) : filtered.map(contract => {
                const project = projects.find(item => item.id === contract.projectId);
                const type = contractTypes.find(item => item.id === contract.contractTypeId);
                return (
                  <tr key={contract.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">{contract.code}</td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800 dark:text-white">{contract.name}</div>
                      <div className="text-xs text-slate-400">{type?.name || contract.type}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{project?.name || '-'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{contract.customerName}</td>
                    <td className="px-4 py-3 text-right font-black text-slate-800 dark:text-white">{formatCurrency(contract.value, contract.currency)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_CONFIG[contract.status]?.color}`}>
                        {STATUS_CONFIG[contract.status]?.label || contract.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => navigate(`/hd/customer/${contract.id}`)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg"><Eye size={14} /></button>
                        <button onClick={() => openEdit(contract)} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg"><Edit2 size={14} /></button>
                        <button onClick={() => handleDelete(contract)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-emerald-50 dark:bg-emerald-950/30">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center"><FileSignature className="text-white" size={18} /></div>
                <div>
                  <h3 className="font-black text-slate-800 dark:text-white">{editingId ? 'Sửa HĐ nhận thầu' : 'Tạo HĐ nhận thầu'}</h3>
                  <p className="text-xs text-slate-500">Chọn metadata, chủ đầu tư và khai báo thông tin hợp đồng</p>
                </div>
              </div>
              <button onClick={resetForm} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>

            <div className="overflow-y-auto flex-1 p-6 space-y-5">
              <section>
                <h4 className="text-sm font-black text-slate-700 dark:text-slate-200 mb-3">Thông tin hợp đồng</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Dự án *</label>
                    <SearchableSelect
                      value={form.projectId}
                      options={projects}
                      onChange={val => setForm({ ...form, projectId: val ? val.id : '' })}
                      getOptionValue={p => p.id}
                      getOptionLabel={p => p.code ? `${p.code} - ${p.name}` : p.name}
                      placeholder="Chọn dự án..."
                      emptyLabel="Không tìm thấy dự án"
                      className="w-full"
                    />
                  </div>
                  <SelectInput label="Loại hợp đồng *" value={form.contractTypeId} onChange={value => setForm({ ...form, contractTypeId: value, customData: {} })}>
                    <option value="">Chọn loại hợp đồng</option>
                    {contractTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
                  </SelectInput>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Chủ đầu tư *</label>
                    <SearchableSelect
                      value={form.ownerPartnerId}
                      options={ownerPartners}
                      onChange={val => handleOwnerChange(val ? val.id : '')}
                      getOptionValue={p => p.id}
                      getOptionLabel={p => p.code ? `${p.code} - ${p.name}` : p.name}
                      placeholder="Chọn chủ đầu tư..."
                      emptyLabel="Không tìm thấy chủ đầu tư"
                      className="w-full"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                  <TextInput label="Số hợp đồng *" value={form.code} onChange={value => setForm({ ...form, code: value })} placeholder="Nhập số hợp đồng" />
                  <TextInput label="Tên hợp đồng" value={form.name} onChange={value => setForm({ ...form, name: value })} placeholder="Nhập tên hợp đồng" />
                  <TextInput label="Phụ lục số" value={form.appendixNumber} onChange={value => setForm({ ...form, appendixNumber: value })} placeholder="Nhập phụ lục số" />
                  <TextInput label="Tên phụ lục" value={form.appendixName} onChange={value => setForm({ ...form, appendixName: value })} placeholder="Nhập tên phụ lục" />
                  <TextInput label="Người đại diện" value={form.customerRepresentative} onChange={value => setForm({ ...form, customerRepresentative: value })} />
                  <TextInput label="Chức vụ" value={form.customerRepresentativeTitle} onChange={value => setForm({ ...form, customerRepresentativeTitle: value })} />
                  <TextInput label="Số điện thoại" value={form.representativePhone} onChange={value => setForm({ ...form, representativePhone: value })} />
                  <TextInput label="Email" value={form.representativeEmail} onChange={value => setForm({ ...form, representativeEmail: value })} />
                  <TextInput label="Website" value={form.website} onChange={value => setForm({ ...form, website: value })} />
                  <TextInput label="Địa chỉ trụ sở" value={form.customerAddress} onChange={value => setForm({ ...form, customerAddress: value })} />
                  <TextInput label="Mã số thuế" value={form.customerTaxCode} onChange={value => setForm({ ...form, customerTaxCode: value })} />
                  <TextInput label="Tài khoản ngân hàng" value={form.bankAccount} onChange={value => setForm({ ...form, bankAccount: value })} />
                  <TextInput label="Ngân hàng" value={form.bankName} onChange={value => setForm({ ...form, bankName: value })} />
                </div>
              </section>

              <section>
                <h4 className="text-sm font-black text-slate-700 dark:text-slate-200 mb-3">Giá trị và thời hạn</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <TextInput label="Tổng tiền hàng hóa" type="number" value={String(form.goodsAmount)} onChange={value => setForm({ ...form, goodsAmount: Number(value) })} />
                  <TextInput label="% Chiết khấu" type="number" value={String(form.discountPercent)} onChange={value => setForm({ ...form, discountPercent: Number(value) })} />
                  <ReadonlyMetric label="Tiền chiết khấu" value={formatCurrency(totals.discountAmount)} />
                  <TextInput label="Chi phí chung" type="number" value={String(form.overheadCost)} onChange={value => setForm({ ...form, overheadCost: Number(value) })} />
                  <TextInput label="VAT (%)" type="number" value={String(form.vatPercent)} onChange={value => setForm({ ...form, vatPercent: Number(value) })} />
                  <ReadonlyMetric label="VAT (tiền)" value={formatCurrency(totals.vatAmount)} />
                  <ReadonlyMetric label="Giá trị hợp đồng" value={formatCurrency(totals.contractValue)} strong />
                  <SelectInput label="Trạng thái" value={form.status} onChange={value => setForm({ ...form, status: value as HdContractStatus })}>
                    {Object.entries(STATUS_CONFIG).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                  </SelectInput>
                  <TextInput label="Ngày ký hợp đồng" type="date" value={form.signedDate} onChange={value => setForm({ ...form, signedDate: value })} />
                  <TextInput label="Ngày HĐ có hiệu lực" type="date" value={form.effectiveDate} onChange={value => setForm({ ...form, effectiveDate: value })} />
                  <TextInput label="Ngày HĐ hết hiệu lực" type="date" value={form.endDate} onChange={value => setForm({ ...form, endDate: value })} />
                  <TextInput label="Thời gian thực hiện" value={form.durationText} onChange={value => setForm({ ...form, durationText: value })} placeholder="VD: 120 ngày" />
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-black text-slate-700 dark:text-slate-200">Trường dữ liệu theo mẫu</h4>
                  {templateLoading && <span className="text-xs text-slate-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" />Đang tải mẫu</span>}
                </div>
                {!activeTemplate ? (
                  <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 py-8 text-center text-sm text-slate-400">
                    Chọn loại hợp đồng để tải mẫu khai báo
                  </div>
                ) : (
                  <div className="space-y-4">
                    {activeTemplate.sections?.map(section => (
                      <div key={section.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 font-black text-sm text-slate-700 dark:text-slate-200">{section.title}</div>
                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                          {section.fields?.map(field => (
                            <DynamicField
                              key={field.id}
                              field={field}
                              value={form.customData[field.key]}
                              onChange={value => setCustomValue(field.key, value)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <textarea
                value={form.note}
                onChange={e => setForm({ ...form, note: e.target.value })}
                rows={2}
                placeholder="Ghi chú"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
              />
            </div>

            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex gap-3">
              <button onClick={resetForm} className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Hủy</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu HĐ nhận thầu
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedContract && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <p className="font-mono text-xs text-emerald-600 dark:text-emerald-400 font-bold">{selectedContract.code}</p>
                <h3 className="font-black text-slate-800 dark:text-white">{selectedContract.name}</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_CONFIG[selectedContract.status]?.color}`}>
                  {STATUS_CONFIG[selectedContract.status]?.label}
                </span>
                <button onClick={() => setSelectedContract(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
            </div>
            <div className="flex border-b border-slate-100 dark:border-slate-800 px-6">
              {[
                ['info', 'Thông tin', FileSignature],
                ['guarantees', `Bảo lãnh (${guarantees.length})`, ShieldCheck],
                ['docs', `Tài liệu (${selectedContract.attachments?.length || 0})`, Paperclip],
              ].map(([tab, label, Icon]: any) => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-bold border-b-2 transition-colors ${detailTab === tab ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {detailTab === 'info' && <ContractInfo contract={selectedContract} projects={projects} contractTypes={contractTypes} />}
              {detailTab === 'guarantees' && (
                <GuaranteeTab
                  guarantees={guarantees}
                  onCreate={() => setGuaranteeForm({ contractId: selectedContract.id, guaranteeType: 'other', name: '', amount: 0, percent: 0, status: 'draft' })}
                  onEdit={setGuaranteeForm}
                  onDelete={deleteGuarantee}
                />
              )}
              {detailTab === 'docs' && (
                <div className="space-y-4">
                  <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls" onChange={handleFileUpload} disabled={uploading} />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <button onClick={() => triggerUpload('contract')} disabled={uploading} className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-emerald-200 dark:border-emerald-800 rounded-xl p-6 hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10 transition disabled:opacity-50">
                      <Upload className="text-emerald-500" size={24} />
                      <span className="text-sm font-bold text-slate-600 dark:text-slate-300">File hợp đồng</span>
                    </button>
                    <button onClick={() => triggerUpload('other')} disabled={uploading} className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-6 hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50">
                      <Upload className="text-slate-500" size={24} />
                      <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Các file khác</span>
                    </button>
                  </div>
                  {uploading && <div className="text-sm text-emerald-600 font-bold flex items-center gap-2"><Loader2 className="animate-spin" size={14} />Đang upload...</div>}
                  {(selectedContract.attachments || []).length === 0 ? (
                    <p className="text-center text-sm text-slate-400 py-6">Chưa có tài liệu đính kèm</p>
                  ) : (
                    <div className="space-y-2">
                      {(selectedContract.attachments || []).map(attachment => (
                        <div key={attachment.id} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                          <File className="text-emerald-500 shrink-0" size={20} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{attachment.name}</p>
                            <p className="text-xs text-slate-400">
                              {attachment.category === 'contract' ? 'File hợp đồng' : 'File khác'} · {(attachment.fileSize / 1024).toFixed(0)} KB · {formatDate(attachment.uploadedAt)}
                            </p>
                          </div>
                          <button onClick={() => handleDownload(attachment)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg"><Download size={14} /></button>
                          <button onClick={() => handleDeleteFile(attachment)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {guaranteeForm && selectedContract && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-black text-slate-800 dark:text-white">{guaranteeForm.id ? 'Sửa bảo lãnh' : 'Thêm bảo lãnh'}</h3>
              <button onClick={() => setGuaranteeForm(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <SelectInput label="Loại bảo lãnh" value={guaranteeForm.guaranteeType || 'other'} onChange={value => setGuaranteeForm({ ...guaranteeForm, guaranteeType: value as ContractGuaranteeType })}>
                {Object.entries(GUARANTEE_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </SelectInput>
              <TextInput label="Tên bảo lãnh *" value={guaranteeForm.name || ''} onChange={value => setGuaranteeForm({ ...guaranteeForm, name: value })} />
              <TextInput label="Giá trị" type="number" value={String(guaranteeForm.amount || 0)} onChange={value => setGuaranteeForm({ ...guaranteeForm, amount: Number(value) })} />
              <TextInput label="Tỷ lệ (%)" type="number" value={String(guaranteeForm.percent || 0)} onChange={value => setGuaranteeForm({ ...guaranteeForm, percent: Number(value) })} />
              <TextInput label="Ngân hàng" value={guaranteeForm.bankName || ''} onChange={value => setGuaranteeForm({ ...guaranteeForm, bankName: value })} />
              <TextInput label="Số bảo lãnh" value={guaranteeForm.guaranteeNumber || ''} onChange={value => setGuaranteeForm({ ...guaranteeForm, guaranteeNumber: value })} />
              <TextInput label="Ngày phát hành" type="date" value={guaranteeForm.issueDate || ''} onChange={value => setGuaranteeForm({ ...guaranteeForm, issueDate: value })} />
              <TextInput label="Ngày hết hạn" type="date" value={guaranteeForm.expiryDate || ''} onChange={value => setGuaranteeForm({ ...guaranteeForm, expiryDate: value })} />
              <SelectInput label="Trạng thái" value={guaranteeForm.status || 'draft'} onChange={value => setGuaranteeForm({ ...guaranteeForm, status: value as ContractGuaranteeStatus })}>
                {Object.entries(GUARANTEE_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </SelectInput>
              <TextInput label="Ghi chú" value={guaranteeForm.note || ''} onChange={value => setGuaranteeForm({ ...guaranteeForm, note: value })} />
            </div>
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex gap-3">
              <button onClick={() => setGuaranteeForm(null)} className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-300">Hủy</button>
              <button onClick={saveGuarantee} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Lưu bảo lãnh
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ContractInfo: React.FC<{
  contract: CustomerContract;
  projects: Project[];
  contractTypes: ContractTypeMetadata[];
}> = ({ contract, projects, contractTypes }) => {
  const custom = contract.customData || {};
  const totals = {
    discountAmount: custom.discountAmount || 0,
    vatAmount: custom.vatAmount || 0,
    goodsAmount: custom.goodsAmount || 0,
    overheadCost: custom.overheadCost || 0,
  };
  const fields = contract.templateSnapshot?.sections?.flatMap(section => section.fields || []) || [];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <InfoBox label="Dự án" value={projects.find(p => p.id === contract.projectId)?.name} />
        <InfoBox label="Loại hợp đồng" value={contractTypes.find(t => t.id === contract.contractTypeId)?.name || contract.type} />
        <InfoBox label="Chủ đầu tư" value={contract.customerName} />
        <InfoBox label="MST" value={contract.customerTaxCode} />
        <InfoBox label="Địa chỉ" value={contract.customerAddress} />
        <InfoBox label="Người đại diện" value={contract.customerRepresentative} />
        <InfoBox label="Chức vụ" value={contract.customerRepresentativeTitle} />
        <InfoBox label="Số điện thoại" value={custom.representativePhone} />
        <InfoBox label="Email" value={custom.representativeEmail} />
        <InfoBox label="Website" value={custom.website} />
        <InfoBox label="Ngân hàng" value={custom.bankName} />
        <InfoBox label="Tài khoản" value={custom.bankAccount} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
        <InfoBox label="Tổng tiền hàng hóa" value={formatCurrency(totals.goodsAmount)} />
        <InfoBox label="Chiết khấu" value={formatCurrency(totals.discountAmount)} />
        <InfoBox label="Chi phí chung" value={formatCurrency(totals.overheadCost)} />
        <InfoBox label="VAT" value={formatCurrency(totals.vatAmount)} />
        <InfoBox label="Giá trị hợp đồng" value={formatCurrency(contract.value, contract.currency)} />
        <InfoBox label="Ngày ký" value={formatDate(contract.signedDate)} />
        <InfoBox label="Ngày hiệu lực" value={formatDate(contract.effectiveDate)} />
        <InfoBox label="Ngày hết hiệu lực" value={formatDate(contract.endDate)} />
      </div>
      {fields.length > 0 && (
        <div>
          <h4 className="font-black text-sm text-slate-700 dark:text-slate-200 mb-3">Dữ liệu theo mẫu</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            {fields.map(field => <InfoBox key={field.id} label={field.label} value={custom[field.key]} />)}
          </div>
        </div>
      )}
      {contract.note && <InfoBox label="Ghi chú" value={contract.note} />}
    </div>
  );
};

const GuaranteeTab: React.FC<{
  guarantees: ContractGuarantee[];
  onCreate: () => void;
  onEdit: (guarantee: ContractGuarantee) => void;
  onDelete: (guarantee: ContractGuarantee) => void;
}> = ({ guarantees, onCreate, onEdit, onDelete }) => (
  <div className="space-y-3">
    <div className="flex justify-end">
      <button onClick={onCreate} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold flex items-center gap-2"><Plus size={14} /> Thêm bảo lãnh</button>
    </div>
    {guarantees.length === 0 ? (
      <p className="text-center text-sm text-slate-400 py-8">Chưa có mục bảo lãnh</p>
    ) : guarantees.map(guarantee => (
      <div key={guarantee.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center gap-4">
        <ShieldCheck className="text-emerald-500 shrink-0" size={22} />
        <div className="flex-1">
          <div className="font-black text-slate-800 dark:text-white">{guarantee.name}</div>
          <div className="text-xs text-slate-400">
            {GUARANTEE_TYPES[guarantee.guaranteeType]} · {formatCurrency(guarantee.amount)} · {GUARANTEE_STATUSES[guarantee.status]}
          </div>
          <div className="text-xs text-slate-400 flex items-center gap-1 mt-1"><Calendar size={11} /> {formatDate(guarantee.issueDate)} - {formatDate(guarantee.expiryDate)}</div>
        </div>
        <button onClick={() => onEdit(guarantee)} className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50"><Edit2 size={14} /></button>
        <button onClick={() => onDelete(guarantee)} className="p-1.5 rounded-lg text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
      </div>
    ))}
  </div>
);

const DynamicField: React.FC<{
  field: ContractTemplateField;
  value: any;
  onChange: (value: any) => void;
}> = ({ field, value, onChange }) => {
  const label = `${field.label}${field.required ? ' *' : ''}`;
  if (field.fieldType === 'textarea') {
    return (
      <div className="md:col-span-2">
        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>
        <textarea value={value || ''} onChange={e => onChange(e.target.value)} placeholder={field.placeholder} rows={2} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none" />
      </div>
    );
  }
  if (field.fieldType === 'select') {
    return (
      <SelectInput label={label} value={value || ''} onChange={onChange}>
        <option value="">Chọn</option>
        {(field.options || []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </SelectInput>
    );
  }
  const inputType = field.fieldType === 'date' ? 'date'
    : field.fieldType === 'number' || field.fieldType === 'currency' || field.fieldType === 'percent' ? 'number'
      : field.fieldType === 'email' ? 'email'
        : field.fieldType === 'url' ? 'url'
          : 'text';
  return <TextInput label={label} type={inputType} value={String(value ?? '')} onChange={val => onChange(inputType === 'number' ? Number(val) : val)} placeholder={field.placeholder} />;
};

const TextInput: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}> = ({ label, value, onChange, type = 'text', placeholder }) => (
  <div>
    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
    />
  </div>
);

const SelectInput: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}> = ({ label, value, onChange, children }) => (
  <div>
    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>
    <select value={value} onChange={e => onChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30">
      {children}
    </select>
  </div>
);

const ReadonlyMetric: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div>
    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>
    <div className={`px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm ${strong ? 'font-black text-emerald-700 dark:text-emerald-400' : 'font-bold text-slate-700 dark:text-slate-200'}`}>
      {value}
    </div>
  </div>
);

const InfoBox: React.FC<{ label: string; value: any }> = ({ label, value }) => (
  <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3">
    <p className="text-xs font-bold text-slate-400 uppercase mb-1">{label}</p>
    <p className="font-medium text-slate-800 dark:text-white whitespace-pre-wrap">{value || '-'}</p>
  </div>
);

export default CustomerContracts;
