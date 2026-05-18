import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Download, Edit2, FileSpreadsheet, Loader2, Plus, RefreshCcw, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { BusinessPartner, PartnerClassification } from '../../types';
import { partnerService } from '../../lib/partnerService';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { loadXlsx } from '../../lib/loadXlsx';
import ExcelImportReviewModal from '../../components/ExcelImportReviewModal';
import { ExcelImportMode, ExcelImportPreview, applyImportChanges, buildImportPreview, parseExcelRows } from '../../lib/excelImport';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

const CLASSIFICATION_OPTIONS: Array<{ value: PartnerClassification; label: string }> = [
  { value: 'owner', label: 'Chủ đầu tư' },
  { value: 'contractor', label: 'Nhà thầu' },
  { value: 'supplier', label: 'Nhà cung cấp' },
];

const EMPTY_FORM: Omit<BusinessPartner, 'id' | 'createdAt' | 'updatedAt'> = {
  code: '',
  name: '',
  ownerName: '',
  createdDate: new Date().toISOString().split('T')[0],
  taxCode: '',
  address: '',
  classifications: ['owner'],
  phone: '',
  country: 'Việt Nam',
  province: '',
  ward: '',
  email: '',
  website: '',
  bankName: '',
  bankAccount: '',
  contactName: '',
  contactTitle: '',
  contactPhone: '',
  contactEmail: '',
  isActive: true,
  note: '',
};

const HEADER_ALIASES: Record<string, keyof Omit<BusinessPartner, 'id' | 'classifications' | 'isActive'>> = {
  'mã khách hàng': 'code',
  'ma khach hang': 'code',
  'tên khách hàng': 'name',
  'ten khach hang': 'name',
  'người phụ trách': 'ownerName',
  'nguoi phu trach': 'ownerName',
  'ngày tạo': 'createdDate',
  'ngay tao': 'createdDate',
  'mã số thuế': 'taxCode',
  'ma so thue': 'taxCode',
  'địa chỉ': 'address',
  'dia chi': 'address',
  'số điện thoại': 'phone',
  'so dien thoai': 'phone',
  'số điện thoại_1': 'contactPhone',
  'so dien thoai_1': 'contactPhone',
  'quốc gia': 'country',
  'quoc gia': 'country',
  'tỉnh thành': 'province',
  'tinh thanh': 'province',
  'phường xã': 'ward',
  'phuong xa': 'ward',
  email: 'email',
  email_1: 'contactEmail',
  website: 'website',
  'ngân hàng': 'bankName',
  'ngan hang': 'bankName',
  'tài khoản': 'bankAccount',
  'tai khoan': 'bankAccount',
  'tên liên hệ': 'contactName',
  'ten lien he': 'contactName',
  'chức vụ': 'contactTitle',
  'chuc vu': 'contactTitle',
};

const normalizeHeader = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

const parseClassifications = (value: unknown): PartnerClassification[] => {
  const raw = String(value || '').toLowerCase();
  const result: PartnerClassification[] = [];
  if (raw.includes('chủ') || raw.includes('chu') || raw.includes('owner')) result.push('owner');
  if (raw.includes('thầu') || raw.includes('thau') || raw.includes('contractor')) result.push('contractor');
  if (raw.includes('cung') || raw.includes('supplier') || raw.includes('ncc')) result.push('supplier');
  return result.length > 0 ? result : ['owner'];
};

const formatDate = (value?: string) => value ? new Date(value).toLocaleDateString('vi-VN') : '-';

const BusinessPartners: React.FC = () => {
  const toast = useToast();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [partners, setPartners] = useState<BusinessPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<PartnerClassification | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BusinessPartner | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [importMode, setImportMode] = useState<ExcelImportMode>('create');
  const [importPreview, setImportPreview] = useState<ExcelImportPreview<BusinessPartner> | null>(null);
  const importModeRef = useRef<ExcelImportMode>('create');

  const loadPartners = async () => {
    setLoading(true);
    try {
      setPartners(await partnerService.list({ includeInactive: true }));
    } catch (error: any) {
      logApiError('partners.load', error);
      toast.error('Lỗi tải đối tác', getApiErrorMessage(error, 'Không thể tải danh sách đối tác.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPartners(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return partners.filter(partner => {
      const matchesSearch = !q || [
        partner.code,
        partner.name,
        partner.taxCode,
        partner.phone,
        partner.email,
        partner.contactName,
      ].some(value => (value || '').toLowerCase().includes(q));
      const matchesClass = !filter || partner.classifications.includes(filter);
      return matchesSearch && matchesClass;
    });
  }, [partners, search, filter]);

  const resetForm = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(false);
  };

  const openEdit = (partner: BusinessPartner) => {
    setEditing(partner);
    setForm({
      code: partner.code || '',
      name: partner.name || '',
      ownerUserId: partner.ownerUserId || '',
      ownerName: partner.ownerName || '',
      createdDate: partner.createdDate || new Date().toISOString().split('T')[0],
      taxCode: partner.taxCode || '',
      address: partner.address || '',
      classifications: partner.classifications?.length ? partner.classifications : ['owner'],
      phone: partner.phone || '',
      country: partner.country || 'Việt Nam',
      province: partner.province || '',
      ward: partner.ward || '',
      email: partner.email || '',
      website: partner.website || '',
      bankName: partner.bankName || '',
      bankAccount: partner.bankAccount || '',
      contactName: partner.contactName || '',
      contactTitle: partner.contactTitle || '',
      contactPhone: partner.contactPhone || '',
      contactEmail: partner.contactEmail || '',
      isActive: partner.isActive,
      note: partner.note || '',
    });
    setShowForm(true);
  };

  const toggleClassification = (value: PartnerClassification) => {
    setForm(prev => {
      const exists = prev.classifications.includes(value);
      const next = exists
        ? prev.classifications.filter(item => item !== value)
        : [...prev.classifications, value];
      return { ...prev, classifications: next.length > 0 ? next : [value] };
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Thiếu tên đối tác');
    if (form.classifications.length === 0) return toast.error('Chọn ít nhất một phân loại');
    setSaving(true);
    try {
      await partnerService.upsert({ ...form, id: editing?.id, createdAt: editing?.createdAt });
      toast.success(editing ? 'Cập nhật đối tác thành công' : 'Thêm đối tác thành công');
      resetForm();
      await loadPartners();
    } catch (error: any) {
      logApiError('partners.save', error);
      toast.error('Lỗi lưu đối tác', getApiErrorMessage(error, 'Không thể lưu đối tác.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (partner: BusinessPartner) => {
    const ok = await confirm({
      title: 'Ngưng sử dụng đối tác',
      targetName: partner.name,
      warningText: 'Đối tác sẽ được chuyển sang trạng thái không hoạt động để giữ lịch sử hợp đồng.',
    });
    if (!ok) return;
    try {
      await partnerService.remove(partner.id);
      toast.success('Đã ngưng sử dụng đối tác');
      await loadPartners();
    } catch (error: any) {
      logApiError('partners.delete', error);
      toast.error('Lỗi cập nhật đối tác', getApiErrorMessage(error, 'Không thể ngưng sử dụng đối tác.'));
    }
  };

  const normalizePartnerDate = (value: unknown) => {
    const raw = String(value || '').trim();
    if (!raw) return new Date().toISOString().split('T')[0];
    const parts = raw.split('/');
    if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? raw : date.toISOString().split('T')[0];
  };

  const normalizeBoolean = (value: unknown) => {
    const raw = String(value || '').trim().toLowerCase();
    return !(raw === 'ngưng dùng' || raw === 'không hoạt động' || raw === 'inactive' || raw === 'false' || raw === '0');
  };

  const openPartnerImport = (mode: ExcelImportMode) => {
    importModeRef.current = mode;
    setImportMode(mode);
    fileInputRef.current?.click();
  };

  const handleDownloadTemplate = async () => {
    try {
      const XLSX = await loadXlsx();
      const createHeaders = [
        'Mã đối tác *', 'Tên đối tác *', 'Phân loại', 'Mã số thuế', 'Địa chỉ', 'Số điện thoại',
        'Email', 'Website', 'Người phụ trách', 'Ngày tạo', 'Quốc gia', 'Tỉnh thành', 'Phường xã',
        'Ngân hàng', 'Tài khoản', 'Tên liên hệ', 'Chức vụ', 'SĐT liên hệ', 'Email liên hệ',
        'Trạng thái', 'Ghi chú',
      ];
      const createRows = [
        ['DT-001', 'Công ty ABC', 'Chủ đầu tư, Nhà cung cấp', '0100000000', 'Hà Nội', '0900000000', 'contact@abc.vn', '', '', '2026-05-18', 'Việt Nam', '', '', '', '', '', '', '', '', 'Đang dùng', ''],
      ];
      const updateHeaders = ['Mã đối tác *', 'Tên đối tác', 'Mã số thuế', 'Số điện thoại', 'Email', 'Trạng thái', 'Ghi chú'];
      const updateRows = [['DT-001', '', '', '0911111111', '', '', 'Cập nhật riêng số điện thoại']];
      const guideRows = [
        ['Nội dung', 'Hướng dẫn'],
        ['Nhập mới', 'Dùng sheet Nhap_moi. Mã đối tác đã tồn tại sẽ bị báo lỗi.'],
        ['Cập nhật', 'Dùng sheet Cap_nhat hoặc file chỉ gồm Mã đối tác và các cột muốn sửa.'],
        ['Ô trống', 'Trong chế độ Cập nhật, ô trống nghĩa là không đổi dữ liệu.'],
        ['Xóa giá trị', 'Dùng token __CLEAR__ cho các cột cho phép xoá như email, website, ghi chú.'],
        ['Phân loại', 'Có thể nhập: Chủ đầu tư, Nhà thầu, Nhà cung cấp. Có thể nhập nhiều giá trị trong một ô.'],
      ];
      const wb = XLSX.utils.book_new();
      const createWs = XLSX.utils.aoa_to_sheet([createHeaders, ...createRows]);
      createWs['!cols'] = createHeaders.map(() => ({ wch: 20 }));
      const updateWs = XLSX.utils.aoa_to_sheet([updateHeaders, ...updateRows]);
      updateWs['!cols'] = updateHeaders.map(() => ({ wch: 22 }));
      const guideWs = XLSX.utils.aoa_to_sheet(guideRows);
      guideWs['!cols'] = [{ wch: 18 }, { wch: 90 }];
      XLSX.utils.book_append_sheet(wb, createWs, 'Nhap_moi');
      XLSX.utils.book_append_sheet(wb, updateWs, 'Cap_nhat');
      XLSX.utils.book_append_sheet(wb, guideWs, 'Huong_dan');
      const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Mau_import_doi_tac.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Đã tải file mẫu đối tác');
    } catch (error) {
      logApiError('partners.template', error);
      toast.error('Không thể tạo file mẫu', getApiErrorMessage(error, 'Không thể tạo file Excel mẫu đối tác.'));
    }
  };

  const buildPartnerPreview = (mode: ExcelImportMode, rows: Record<string, unknown>[]) => buildImportPreview<BusinessPartner>({
    mode,
    keyLabel: 'Mã đối tác',
    keyAliases: ['Mã đối tác *', 'Mã đối tác', 'Mã khách hàng', 'Ma khach hang', 'code'],
    existingRecords: partners,
    getRecordKey: partner => partner.code,
    createBaseRecord: code => ({
      id: crypto.randomUUID(),
      ...EMPTY_FORM,
      code,
      classifications: ['owner'],
      isActive: true,
    }),
    fields: [
      { key: 'name', label: 'Tên đối tác', aliases: ['Tên đối tác *', 'Tên đối tác', 'Tên khách hàng', 'Ten khach hang', 'name'], requiredOnCreate: true },
      { key: 'classifications', label: 'Phân loại', aliases: ['Phân loại', 'Phan loai'], normalize: parseClassifications },
      { key: 'taxCode', label: 'Mã số thuế', aliases: ['Mã số thuế', 'Ma so thue', 'MST'], clearable: true },
      { key: 'address', label: 'Địa chỉ', aliases: ['Địa chỉ', 'Dia chi'], clearable: true },
      { key: 'phone', label: 'Số điện thoại', aliases: ['Số điện thoại', 'So dien thoai', 'SĐT', 'phone'], clearable: true },
      { key: 'email', label: 'Email', aliases: ['Email', 'email'], clearable: true },
      { key: 'website', label: 'Website', aliases: ['Website', 'website'], clearable: true },
      { key: 'ownerName', label: 'Người phụ trách', aliases: ['Người phụ trách', 'Nguoi phu trach'], clearable: true },
      { key: 'createdDate', label: 'Ngày tạo', aliases: ['Ngày tạo', 'Ngay tao'], normalize: normalizePartnerDate },
      { key: 'country', label: 'Quốc gia', aliases: ['Quốc gia', 'Quoc gia'], clearable: true },
      { key: 'province', label: 'Tỉnh thành', aliases: ['Tỉnh thành', 'Tinh thanh'], clearable: true },
      { key: 'ward', label: 'Phường xã', aliases: ['Phường xã', 'Phuong xa'], clearable: true },
      { key: 'bankName', label: 'Ngân hàng', aliases: ['Ngân hàng', 'Ngan hang'], clearable: true },
      { key: 'bankAccount', label: 'Tài khoản', aliases: ['Tài khoản', 'Tai khoan'], clearable: true },
      { key: 'contactName', label: 'Tên liên hệ', aliases: ['Tên liên hệ', 'Ten lien he'], clearable: true },
      { key: 'contactTitle', label: 'Chức vụ', aliases: ['Chức vụ', 'Chuc vu'], clearable: true },
      { key: 'contactPhone', label: 'SĐT liên hệ', aliases: ['SĐT liên hệ', 'Số điện thoại_1', 'So dien thoai_1'], clearable: true },
      { key: 'contactEmail', label: 'Email liên hệ', aliases: ['Email liên hệ', 'email_1'], clearable: true },
      { key: 'isActive', label: 'Trạng thái', aliases: ['Trạng thái', 'Trang thai'], normalize: normalizeBoolean },
      { key: 'note', label: 'Ghi chú', aliases: ['Ghi chú', 'Ghi chu'], clearable: true },
    ],
  }, rows);

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSaving(true);
    try {
      const rows = await parseExcelRows(file, importModeRef.current === 'create' ? 'Nhap_moi' : 'Cap_nhat');
      if (rows.length === 0) {
        toast.warning('File rỗng', 'File Excel không có dữ liệu đối tác.');
        return;
      }
      setImportPreview(buildPartnerPreview(importModeRef.current, rows));
    } catch (error) {
      logApiError('partners.import.read', error);
      toast.error('Lỗi import Excel', getApiErrorMessage(error, 'File Excel đối tác không hợp lệ.'));
    } finally {
      setSaving(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const commitImport = async () => {
    if (!importPreview) return;
    const records = applyImportChanges(importPreview);
    if (records.length === 0) {
      toast.warning('Không có thay đổi', 'File không có dòng hợp lệ cần ghi dữ liệu.');
      return;
    }
    setSaving(true);
    try {
      if (importPreview.mode === 'create') {
        for (const row of records) await partnerService.upsert(row);
        toast.success('Import đối tác thành công', `Đã nhập ${records.length} dòng.`);
      } else {
        const changedRows = importPreview.rows.filter(row => row.status === 'update' && row.existingRecord && row.nextRecord);
        for (const row of changedRows) await partnerService.upsert({ ...row.existingRecord!, ...row.nextRecord! });
        toast.success('Cập nhật đối tác thành công', `Đã cập nhật ${changedRows.length} dòng.`);
      }
      setImportPreview(null);
      await loadPartners();
    } catch (error) {
      logApiError('partners.import.apply', error);
      toast.error('Lỗi ghi dữ liệu import', getApiErrorMessage(error, 'Không thể ghi dữ liệu đối tác.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm mã, tên, MST, liên hệ..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-sky-500/30"
          />
        </div>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as PartnerClassification | '')}
          className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 dark:text-white outline-none"
        >
          <option value="">Tất cả phân loại</option>
          {CLASSIFICATION_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button
          onClick={handleDownloadTemplate}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition"
        >
          <Download size={15} /> Mẫu
        </button>
        <button
          onClick={() => openPartnerImport('create')}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-60"
        >
          {saving && importMode === 'create' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Nhập mới
        </button>
        <button
          onClick={() => openPartnerImport('update')}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 border border-amber-200 dark:border-amber-900/60 text-amber-700 dark:text-amber-300 text-sm font-bold rounded-xl hover:bg-amber-50 dark:hover:bg-amber-900/20 transition disabled:opacity-60"
        >
          {saving && importMode === 'update' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />} Cập nhật
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />
        <button
          onClick={() => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-sky-500 to-blue-600 text-white text-sm font-bold rounded-xl shadow-md shadow-sky-500/20"
        >
          <Plus size={15} /> Thêm đối tác
        </button>
      </div>

      {importPreview && (
        <ExcelImportReviewModal
          title={importPreview.mode === 'create' ? 'Preview nhập mới đối tác' : 'Preview cập nhật đối tác'}
          preview={importPreview}
          loading={saving}
          onClose={() => setImportPreview(null)}
          onConfirm={commitImport}
        />
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">
                <th className="px-4 py-3 text-left">Mã</th>
                <th className="px-4 py-3 text-left">Đối tác</th>
                <th className="px-4 py-3 text-left">Phân loại</th>
                <th className="px-4 py-3 text-left">MST / Liên hệ</th>
                <th className="px-4 py-3 text-center">Ngày tạo</th>
                <th className="px-4 py-3 text-center">Trạng thái</th>
                <th className="px-4 py-3 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400"><Loader2 className="inline animate-spin mr-2" size={16} />Đang tải...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400">Chưa có đối tác</td></tr>
              ) : filtered.map(partner => (
                <tr key={partner.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-mono font-bold text-sky-600 dark:text-sky-400">{partner.code}</td>
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800 dark:text-white">{partner.name}</div>
                    <div className="text-xs text-slate-400">{partner.address || '-'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {partner.classifications.map(value => (
                        <span key={value} className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-100 text-[11px] font-bold">
                          {CLASSIFICATION_OPTIONS.find(item => item.value === value)?.label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    <div>{partner.taxCode || '-'}</div>
                    <div className="text-xs text-slate-400">{partner.contactName || partner.phone || partner.email || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-center text-slate-500">{formatDate(partner.createdDate)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${partner.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {partner.isActive ? 'Đang dùng' : 'Ngưng dùng'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-center gap-1">
                      <button onClick={() => openEdit(partner)} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(partner)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-sky-50 dark:bg-sky-950/30">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-sky-600 flex items-center justify-center"><Building2 className="text-white" size={18} /></div>
                <h3 className="font-black text-slate-800 dark:text-white">{editing ? 'Sửa đối tác' : 'Thêm đối tác'}</h3>
              </div>
              <button onClick={resetForm} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <TextInput label="Mã khách hàng" value={form.code} onChange={value => setForm({ ...form, code: value })} placeholder="Tự sinh nếu bỏ trống" />
                <TextInput label="Tên khách hàng *" value={form.name} onChange={value => setForm({ ...form, name: value })} />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Phân loại</label>
                <div className="flex flex-wrap gap-2">
                  {CLASSIFICATION_OPTIONS.map(item => (
                    <label key={item.value} className={`px-3 py-2 rounded-xl border text-sm font-bold cursor-pointer ${form.classifications.includes(item.value) ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-500'}`}>
                      <input type="checkbox" className="mr-2" checked={form.classifications.includes(item.value)} onChange={() => toggleClassification(item.value)} />
                      {item.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <TextInput label="Người phụ trách" value={form.ownerName || ''} onChange={value => setForm({ ...form, ownerName: value })} />
                <TextInput label="Ngày tạo" type="date" value={form.createdDate || ''} onChange={value => setForm({ ...form, createdDate: value })} />
                <TextInput label="Mã số thuế" value={form.taxCode || ''} onChange={value => setForm({ ...form, taxCode: value })} />
              </div>
              <TextInput label="Địa chỉ" value={form.address || ''} onChange={value => setForm({ ...form, address: value })} />
              <div className="grid grid-cols-4 gap-4">
                <TextInput label="Số điện thoại" value={form.phone || ''} onChange={value => setForm({ ...form, phone: value })} />
                <TextInput label="Quốc gia" value={form.country || ''} onChange={value => setForm({ ...form, country: value })} />
                <TextInput label="Tỉnh thành" value={form.province || ''} onChange={value => setForm({ ...form, province: value })} />
                <TextInput label="Phường xã" value={form.ward || ''} onChange={value => setForm({ ...form, ward: value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <TextInput label="Email" value={form.email || ''} onChange={value => setForm({ ...form, email: value })} />
                <TextInput label="Website" value={form.website || ''} onChange={value => setForm({ ...form, website: value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <TextInput label="Ngân hàng" value={form.bankName || ''} onChange={value => setForm({ ...form, bankName: value })} />
                <TextInput label="Tài khoản" value={form.bankAccount || ''} onChange={value => setForm({ ...form, bankAccount: value })} />
              </div>
              <div className="grid grid-cols-4 gap-4">
                <TextInput label="Tên liên hệ" value={form.contactName || ''} onChange={value => setForm({ ...form, contactName: value })} />
                <TextInput label="Chức vụ" value={form.contactTitle || ''} onChange={value => setForm({ ...form, contactTitle: value })} />
                <TextInput label="SĐT liên hệ" value={form.contactPhone || ''} onChange={value => setForm({ ...form, contactPhone: value })} />
                <TextInput label="Email liên hệ" value={form.contactEmail || ''} onChange={value => setForm({ ...form, contactEmail: value })} />
              </div>
              <textarea
                value={form.note || ''}
                onChange={e => setForm({ ...form, note: e.target.value })}
                placeholder="Ghi chú"
                rows={2}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
              />
              <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />
                Đang hoạt động
              </label>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex gap-3">
              <button onClick={resetForm} className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-300">Hủy</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 bg-sky-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu đối tác
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
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
      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-sky-500/30"
    />
  </div>
);

export default BusinessPartners;
