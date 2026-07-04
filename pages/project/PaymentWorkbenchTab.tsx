import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Download,
  Edit2,
  ExternalLink,
  Filter,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  ContractItemType,
  PaymentDossierStatus,
  PaymentQualityStatus,
  PaymentSchedule,
  PaymentScheduleMilestoneType,
  PaymentScheduleStatus,
  PaymentScheduleWorkbenchRow,
} from '../../types';
import {
  paymentScheduleWorkbenchService,
  PaymentScheduleContractTypeFilter,
} from '../../lib/paymentScheduleWorkbenchService';
import { paymentService } from '../../lib/projectService';
import { ProjectPermissionCode, projectStaffService } from '../../lib/projectStaffService';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

interface PaymentWorkbenchTabProps {
  constructionSiteId: string;
  projectId?: string;
  canManageTab?: boolean;
}

type PaymentScheduleSubTab = 'plan' | 'upcoming' | 'overdue' | 'paid';

const ALL_PROJECT_PERMISSION_CODES: ProjectPermissionCode[] = ['view', 'edit', 'delete', 'submit', 'verify', 'confirm', 'approve'];

const subTabs: Array<{ key: PaymentScheduleSubTab; label: string }> = [
  { key: 'plan', label: 'Kế hoạch' },
  { key: 'upcoming', label: 'Sắp tới hạn' },
  { key: 'overdue', label: 'Quá hạn' },
  { key: 'paid', label: 'Đã thanh toán' },
];

const contractTypeOptions: Array<{ value: PaymentScheduleContractTypeFilter; label: string }> = [
  { value: 'all', label: 'Tất cả HĐ' },
  { value: 'customer', label: 'HĐ nhận thầu' },
  { value: 'subcontractor', label: 'HĐ thầu phụ' },
];

const milestoneLabel = {
  advance: 'Tạm ứng',
  progress: 'Tiến độ',
  settlement: 'Quyết toán',
  retention: 'Giữ lại',
  other: 'Khác',
};

const dossierLabel = {
  not_started: 'Chưa lập',
  preparing: 'Đang chuẩn bị',
  submitted: 'Đã trình',
  approved: 'Đã duyệt',
};

const qualityLabel = {
  not_applicable: 'Không áp dụng',
  not_confirmed: 'Chưa xác nhận',
  passed: 'Đạt',
  failed: 'Không đạt',
};

const today = () => new Date().toISOString().slice(0, 10);
const parseMoneyInput = (value: string): number => {
  const parsed = Number(value.replace(/[^\d]/g, ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
};
const fmtMoney = (value: number) => {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1_000_000_000) return `${(amount / 1_000_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`;
  if (Math.abs(amount) >= 1_000_000) return `${(amount / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  return `${amount.toLocaleString('vi-VN')} đ`;
};
const fmtDate = (value?: string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('vi-VN') : '-';

const buildProjectUrl = (
  projectId: string | undefined,
  constructionSiteId: string,
  tab: string,
  extra?: Record<string, string | undefined | null>,
) => {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  params.set('siteId', constructionSiteId);
  params.set('tab', tab);
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return `/da?${params.toString()}`;
};

const getVisibleRows = (rows: PaymentScheduleWorkbenchRow[], activeTab: PaymentScheduleSubTab) => {
  if (activeTab === 'upcoming') return rows.filter(row => row.isUpcoming);
  if (activeTab === 'overdue') return rows.filter(row => row.isOverdue);
  if (activeTab === 'paid') return rows.filter(row => row.status === 'paid');
  return rows;
};

const milestoneOptions: Array<{ value: PaymentScheduleMilestoneType; label: string }> = [
  { value: 'advance', label: 'Tạm ứng' },
  { value: 'progress', label: 'Tiến độ' },
  { value: 'settlement', label: 'Quyết toán' },
  { value: 'retention', label: 'Giữ lại' },
  { value: 'other', label: 'Khác' },
];

const statusOptions: Array<{ value: PaymentScheduleStatus; label: string }> = [
  { value: 'pending', label: 'Chờ xử lý' },
  { value: 'paid', label: 'Đã thanh toán' },
  { value: 'overdue', label: 'Quá hạn' },
];

const dossierOptions: Array<{ value: PaymentDossierStatus; label: string }> = [
  { value: 'not_started', label: 'Chưa lập' },
  { value: 'preparing', label: 'Đang chuẩn bị' },
  { value: 'submitted', label: 'Đã trình' },
  { value: 'approved', label: 'Đã duyệt' },
];

const qualityOptions: Array<{ value: PaymentQualityStatus; label: string }> = [
  { value: 'not_applicable', label: 'Không áp dụng' },
  { value: 'not_confirmed', label: 'Chưa xác nhận' },
  { value: 'passed', label: 'Đạt' },
  { value: 'failed', label: 'Không đạt' },
];

const fieldClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100';

const FormField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</span>
    {children}
  </label>
);

const PaymentScheduleEditor: React.FC<{
  form: PaymentSchedule;
  saving: boolean;
  onChange: (next: PaymentSchedule) => void;
  onClose: () => void;
  onSave: () => void;
}> = ({ form, saving, onChange, onClose, onSave }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
    <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <div className="text-sm font-black text-slate-900">Kế hoạch thanh toán</div>
          <div className="mt-0.5 text-[11px] font-bold text-slate-400">Tạo hoặc cập nhật dòng thanh toán công trình</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700">
          <X size={16} />
        </button>
      </div>
      <div className="grid gap-3 p-5 md:grid-cols-2">
        <FormField label="Loại dòng tiền">
          <select className={fieldClass} value={form.type} onChange={event => onChange({ ...form, type: event.target.value as PaymentSchedule['type'] })}>
            <option value="receivable">Phải thu</option>
            <option value="payable">Phải trả</option>
          </select>
        </FormField>
        <FormField label="Loại hợp đồng">
          <select className={fieldClass} value={form.contractType || ''} onChange={event => onChange({ ...form, contractType: (event.target.value || undefined) as PaymentSchedule['contractType'] })}>
            <option value="">Không gắn hợp đồng</option>
            <option value="customer">HĐ nhận thầu</option>
            <option value="subcontractor">HĐ thầu phụ</option>
          </select>
        </FormField>
        <FormField label="Đợt">
          <input className={fieldClass} type="number" min={1} value={form.sequenceNo || 1} onChange={event => onChange({ ...form, sequenceNo: Number(event.target.value || 1) })} />
        </FormField>
        <FormField label="Mốc">
          <select className={fieldClass} value={form.milestoneType || 'progress'} onChange={event => onChange({ ...form, milestoneType: event.target.value as PaymentScheduleMilestoneType })}>
            {milestoneOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FormField>
        <FormField label="Mô tả">
          <input className={fieldClass} value={form.description} onChange={event => onChange({ ...form, description: event.target.value })} placeholder="VD: Đợt 1 - tạm ứng 30%" />
        </FormField>
        <FormField label="Đối tượng">
          <input className={fieldClass} value={form.contactName || ''} onChange={event => onChange({ ...form, contactName: event.target.value })} placeholder="Tên CĐT/NTP/NCC" />
        </FormField>
        <FormField label="Giá trị dự kiến">
          <input className={fieldClass} inputMode="numeric" value={form.amount ? Math.round(form.amount).toLocaleString('vi-VN') : ''} onChange={event => onChange({ ...form, amount: parseMoneyInput(event.target.value) })} placeholder="0" />
        </FormField>
        <FormField label="Ngày dự kiến">
          <input type="date" className={fieldClass} value={form.dueDate || today()} onChange={event => onChange({ ...form, dueDate: event.target.value })} />
        </FormField>
        <FormField label="Trạng thái">
          <select className={fieldClass} value={form.status || 'pending'} onChange={event => onChange({ ...form, status: event.target.value as PaymentScheduleStatus })}>
            {statusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FormField>
        <FormField label="Đã thanh toán">
          <input className={fieldClass} inputMode="numeric" value={form.paidAmount ? Math.round(form.paidAmount).toLocaleString('vi-VN') : ''} onChange={event => onChange({ ...form, paidAmount: parseMoneyInput(event.target.value) })} placeholder="0" />
        </FormField>
        <FormField label="Ngày thanh toán">
          <input type="date" className={fieldClass} value={form.paidDate || ''} onChange={event => onChange({ ...form, paidDate: event.target.value || undefined })} />
        </FormField>
        <FormField label="Hồ sơ">
          <select className={fieldClass} value={form.dossierStatus || 'not_started'} onChange={event => onChange({ ...form, dossierStatus: event.target.value as PaymentDossierStatus })}>
            {dossierOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FormField>
        <FormField label="Chất lượng">
          <select className={fieldClass} value={form.qualityStatus || 'not_confirmed'} onChange={event => onChange({ ...form, qualityStatus: event.target.value as PaymentQualityStatus })}>
            {qualityOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FormField>
        <FormField label="Ghi chú phạm vi">
          <input className={fieldClass} value={form.plannedScopeNote || ''} onChange={event => onChange({ ...form, plannedScopeNote: event.target.value })} placeholder="Hạng mục/phạm vi dự kiến" />
        </FormField>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
        <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50">Hủy</button>
        <button type="button" onClick={onSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2 text-xs font-black text-white hover:bg-orange-600 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu
        </button>
      </div>
    </div>
  </div>
);

const PaymentWorkbenchTab: React.FC<PaymentWorkbenchTabProps> = ({ constructionSiteId, projectId, canManageTab = true }) => {
  const { user } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const location = useLocation();
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [activeTab, setActiveTab] = useState<PaymentScheduleSubTab>(() => {
    const value = queryParams.get('paymentTab') as PaymentScheduleSubTab | null;
    return value && subTabs.some(tab => tab.key === value) ? value : 'plan';
  });
  const [contractType, setContractType] = useState<PaymentScheduleContractTypeFilter>((queryParams.get('contractType') as PaymentScheduleContractTypeFilter) || 'all');
  const [contractId, setContractId] = useState(queryParams.get('contractId') || '');
  const [dateFrom, setDateFrom] = useState(queryParams.get('dateFrom') || '');
  const [dateTo, setDateTo] = useState(queryParams.get('dateTo') || '');
  const [search, setSearch] = useState(queryParams.get('search') || '');
  const [loading, setLoading] = useState(true);
  const [actingRowId, setActingRowId] = useState<string | null>(null);
  const [rows, setRows] = useState<PaymentScheduleWorkbenchRow[]>([]);
  const [form, setForm] = useState<PaymentSchedule | null>(null);
  const [savingForm, setSavingForm] = useState(false);
  const [summary, setSummary] = useState({
    customerContractValue: 0,
    totalReceivable: 0,
    totalPayable: 0,
    upcomingCount: 0,
    overdueCount: 0,
    paidAmount: 0,
    pendingAmount: 0,
    paidCount: 0,
    totalCount: 0,
  });
  const [projectPerms, setProjectPerms] = useState<Set<ProjectPermissionCode>>(new Set());
  const [pbacLoaded, setPbacLoaded] = useState(false);

  useEffect(() => {
    const value = queryParams.get('paymentTab') as PaymentScheduleSubTab | null;
    if (value && subTabs.some(tab => tab.key === value)) setActiveTab(value);
  }, [queryParams]);

  const loadPermissions = useCallback(async () => {
    setPbacLoaded(false);
    try {
      if (canManageTab || user?.role === 'ADMIN') {
        setProjectPerms(new Set(ALL_PROJECT_PERMISSION_CODES));
        return;
      }
      const hasPbac = await projectStaffService.hasProjectPbac(projectId, constructionSiteId);
      if (!hasPbac) {
        setProjectPerms(new Set(ALL_PROJECT_PERMISSION_CODES));
        return;
      }
      if (!user?.id) {
        setProjectPerms(new Set());
        return;
      }
      const checks = await Promise.all(ALL_PROJECT_PERMISSION_CODES.map(async code => ({
        code,
        allowed: projectId
          ? (await projectStaffService.checkProjectPermission(user.id, projectId, code, constructionSiteId)).allowed
          : (await projectStaffService.checkPermission(user.id, constructionSiteId, code)).allowed,
      })));
      setProjectPerms(new Set(checks.filter(item => item.allowed).map(item => item.code)));
    } catch (error: any) {
      console.warn('Cannot load payment schedule permissions', error?.message || error);
      setProjectPerms(new Set());
    } finally {
      setPbacLoaded(true);
    }
  }, [canManageTab, constructionSiteId, projectId, user?.id, user?.role]);

  useEffect(() => { loadPermissions(); }, [loadPermissions]);

  const canConfirm = canManageTab || user?.role === 'ADMIN' || projectPerms.has('confirm');
  const canEditSchedule = canManageTab || user?.role === 'ADMIN' || projectPerms.has('edit');
  const canDeleteSchedule = canManageTab || user?.role === 'ADMIN' || projectPerms.has('delete');

  const requireSchedulePermission = async (code: ProjectPermissionCode, actionLabel: string) => {
    if (canManageTab || user?.role === 'ADMIN' || projectPerms.has(code)) return true;
    if (!pbacLoaded) {
      toast.info('Đang tải quyền', 'Vui lòng thử lại sau vài giây.');
      return false;
    }
    try {
      await projectStaffService.requireProjectPermission({
        userId: user?.id,
        projectId,
        constructionSiteId,
        code,
        actionLabel,
      });
      return true;
    } catch (error: any) {
      toast.warning('Không đủ quyền', error?.message || `Bạn cần quyền ${code}.`);
      return false;
    }
  };

  const requireConfirmPermission = async (actionLabel: string) => {
    if (canManageTab || user?.role === 'ADMIN' || projectPerms.has('confirm')) return true;
    if (!pbacLoaded) {
      toast.info('Đang tải quyền', 'Vui lòng thử lại sau vài giây.');
      return false;
    }
    try {
      await projectStaffService.requireProjectPermission({
        userId: user?.id,
        projectId,
        constructionSiteId,
        code: 'confirm',
        actionLabel,
      });
      return true;
    } catch (error: any) {
      toast.warning('Không đủ quyền', error?.message || 'Bạn cần quyền xác nhận nghiệp vụ.');
      return false;
    }
  };

  const loadWorkbench = useCallback(async () => {
    setLoading(true);
    try {
      const result = await paymentScheduleWorkbenchService.getWorkbench({
        projectId,
        constructionSiteId,
        contractType,
        contractId: contractId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search,
      });
      setRows(result.rows);
      setSummary(result.summary);
    } catch (error: any) {
      toast.error('Không tải được kế hoạch thanh toán', error?.message || 'Vui lòng kiểm tra dữ liệu dự án.');
    } finally {
      setLoading(false);
    }
  }, [constructionSiteId, contractId, contractType, dateFrom, dateTo, projectId, search, toast]);

  useEffect(() => { loadWorkbench(); }, [loadWorkbench]);

  const visibleRows = useMemo(() => getVisibleRows(rows, activeTab), [activeTab, rows]);

  const contractOptions = useMemo(() => {
    const byId = new Map<string, { id: string; label: string; type?: ContractItemType }>();
    rows.forEach(row => {
      if (!row.contractId) return;
      byId.set(row.contractId, {
        id: row.contractId,
        type: row.contractType,
        label: `${row.contractCode || row.contractId} - ${row.counterpartyName || row.contractName || row.contractId}`,
      });
    });
    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label, 'vi'));
  }, [rows]);

  const setPaymentSubTab = (next: PaymentScheduleSubTab) => {
    setActiveTab(next);
    navigate(buildProjectUrl(projectId, constructionSiteId, 'payment', {
      paymentTab: next,
      contractType,
      contractId: contractId || undefined,
    }), { replace: true });
  };

  const handleOpenContract = (row: PaymentScheduleWorkbenchRow) => {
    navigate(buildProjectUrl(projectId, constructionSiteId, 'contract', {
      contractId: row.contractId || undefined,
      contractType: row.contractType,
      contractWorkspaceTab: 'schedule',
    }));
  };

  const handleOpenGantt = (row: PaymentScheduleWorkbenchRow) => {
    const task = row.plannedTasks[0];
    navigate(buildProjectUrl(projectId, constructionSiteId, 'gantt', { taskId: task?.id }));
  };

  const openNew = async () => {
    if (!(await requireSchedulePermission('edit', 'tạo kế hoạch thanh toán'))) return;
    setForm({
      id: crypto.randomUUID(),
      projectId: projectId || null,
      constructionSiteId,
      sequenceNo: rows.length + 1,
      milestoneType: 'progress',
      description: '',
      amount: 0,
      dueDate: today(),
      paidAmount: 0,
      status: 'pending',
      type: contractType === 'subcontractor' ? 'payable' : 'receivable',
      contractType: contractType === 'all' ? undefined : contractType,
      contractId: contractId || undefined,
      contactName: '',
      plannedTaskIds: [],
      dossierStatus: 'not_started',
      qualityStatus: 'not_confirmed',
    });
  };

  const openEdit = async (row: PaymentScheduleWorkbenchRow) => {
    if (!(await requireSchedulePermission('edit', 'sửa kế hoạch thanh toán'))) return;
    setForm({
      ...row,
      projectId: row.projectId || projectId || null,
      constructionSiteId,
      plannedTaskIds: row.plannedTaskIds || [],
    });
  };

  const saveForm = async () => {
    if (!form) return;
    if (!form.description.trim()) {
      toast.warning('Thiếu mô tả', 'Nhập mô tả kế hoạch thanh toán trước khi lưu.');
      return;
    }
    if (Number(form.amount || 0) <= 0) {
      toast.warning('Thiếu giá trị', 'Nhập giá trị kế hoạch thanh toán lớn hơn 0.');
      return;
    }
    setSavingForm(true);
    try {
      await paymentService.upsert({
        ...form,
        projectId: projectId || null,
        constructionSiteId,
        paidDate: form.status === 'paid' ? (form.paidDate || today()) : form.paidDate,
        paidAmount: Number(form.paidAmount || 0),
      });
      setForm(null);
      toast.success('Đã lưu kế hoạch thanh toán');
      await loadWorkbench();
    } catch (error: any) {
      toast.error('Không lưu được kế hoạch thanh toán', error?.message || 'Vui lòng thử lại.');
    } finally {
      setSavingForm(false);
    }
  };

  const deleteRow = async (row: PaymentScheduleWorkbenchRow) => {
    if (!(await requireSchedulePermission('delete', 'xóa kế hoạch thanh toán'))) return;
    const ok = await confirm({
      title: 'Xóa kế hoạch thanh toán',
      targetName: row.description,
      warningText: 'Dòng kế hoạch này sẽ bị xoá khỏi lịch thanh toán công trình.',
      actionLabel: 'Xóa',
      countdownSeconds: 0,
    });
    if (!ok) return;
    setActingRowId(row.id);
    try {
      await paymentService.remove(row.id);
      toast.success('Đã xóa kế hoạch thanh toán');
      await loadWorkbench();
    } catch (error: any) {
      toast.error('Không xóa được kế hoạch thanh toán', error?.message || 'Vui lòng thử lại.');
    } finally {
      setActingRowId(null);
    }
  };

  const handleMarkPaid = async (row: PaymentScheduleWorkbenchRow) => {
    if (!(await requireConfirmPermission('xác nhận đã thanh toán'))) return;
    const ok = await confirm({
      title: 'Xác nhận đã thanh toán',
      targetName: row.description,
      warningText: 'Hệ thống sẽ đánh dấu đợt này đã thanh toán và ghi nhận dòng tiền dự án.',
      actionLabel: 'Xác nhận',
      countdownSeconds: 0,
    });
    if (!ok) return;
    setActingRowId(row.id);
    try {
      await paymentService.upsert({
        ...row,
        status: 'paid',
        paidDate: row.paidDate || today(),
        paidAmount: Number(row.paidAmount || row.amount || 0),
      });
      toast.success('Đã xác nhận thanh toán');
      await loadWorkbench();
    } catch (error: any) {
      toast.error('Không thể xác nhận thanh toán', error?.message);
    } finally {
      setActingRowId(null);
    }
  };

  const handleQuality = async (row: PaymentScheduleWorkbenchRow, qualityStatus: PaymentQualityStatus) => {
    if (!(await requireConfirmPermission('xác nhận chất lượng thanh toán'))) return;
    setActingRowId(row.id);
    try {
      await paymentService.upsert({
        ...row,
        qualityStatus,
        qualityConfirmedBy: user?.id,
        qualityConfirmedName: user?.name,
        qualityConfirmedAt: new Date().toISOString(),
      });
      toast.success(qualityStatus === 'passed' ? 'Đã xác nhận chất lượng đạt' : 'Đã xác nhận chất lượng không đạt');
      await loadWorkbench();
    } catch (error: any) {
      toast.error('Không thể cập nhật chất lượng', error?.message);
    } finally {
      setActingRowId(null);
    }
  };

  const exportRows = () => {
    const sheetRows = visibleRows.map(row => ({
      'Hợp đồng': row.contractCode || row.contractId || '',
      'Loại HĐ': row.contractType === 'customer' ? 'HĐ nhận thầu' : 'HĐ thầu phụ',
      'Đối tác': row.counterpartyName || '',
      'Đợt': row.sequenceNo || '',
      'Mô tả': row.description,
      'Loại mốc': milestoneLabel[row.milestoneType || 'progress'],
      'Ngày dự kiến': row.dueDate,
      'Còn ngày': row.daysUntilDue,
      'Giá trị dự kiến': row.amount,
      'Hạng mục dự kiến': row.plannedTasks.map(task => `${task.wbsCode ? `${task.wbsCode} - ` : ''}${task.name}`).join('; '),
      'Ghi chú phạm vi': row.plannedScopeNote || '',
      'Hồ sơ': dossierLabel[row.dossierStatus || 'not_started'],
      'Chất lượng': qualityLabel[row.qualityStatus || 'not_confirmed'],
      'Đã thanh toán': row.paidAmount || (row.status === 'paid' ? row.amount : 0),
      'Trạng thái': row.status === 'paid' ? 'Đã thanh toán' : row.isOverdue ? 'Quá hạn' : 'Chờ thanh toán',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), 'Payment Schedule');
    XLSX.writeFile(wb, `Payment_Schedule_${today()}.xlsx`);
  };

  const cards = [
    { label: 'Giá trị HĐ nhận thầu', value: fmtMoney(summary.customerContractValue), sub: 'Tổng hợp đồng CĐT', color: 'text-slate-800', icon: CreditCard },
    { label: 'Tổng phải thu', value: fmtMoney(summary.totalReceivable), sub: `${summary.totalCount} đợt kế hoạch`, color: 'text-emerald-600', icon: CheckCircle2 },
    { label: 'Tổng phải trả', value: fmtMoney(summary.totalPayable), sub: 'HĐ thầu phụ', color: 'text-blue-600', icon: CreditCard },
    { label: 'Sắp tới hạn', value: summary.upcomingCount.toLocaleString('vi-VN'), sub: 'Trong 10 ngày', color: 'text-amber-600', icon: CalendarClock },
    { label: 'Quá hạn', value: summary.overdueCount.toLocaleString('vi-VN'), sub: 'Chưa thanh toán', color: 'text-red-600', icon: Filter },
    { label: 'Đã thanh toán', value: fmtMoney(summary.paidAmount), sub: `${summary.paidCount} đợt`, color: 'text-indigo-600', icon: ShieldCheck },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-slate-800 dark:text-white">Nghiệm thu & Thanh toán</h3>
          <p className="text-xs font-bold text-slate-400 mt-1">Kế hoạch thanh toán nhập tay theo hợp đồng, có hạng mục dự kiến và xác nhận chất lượng tổng hợp.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEditSchedule && (
            <button onClick={openNew} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-500 text-xs font-black text-white hover:bg-orange-600 transition">
              <Plus size={14} /> Thêm kế hoạch
            </button>
          )}
          <button onClick={loadWorkbench} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50 transition">
            <RefreshCcw size={14} /> Tải lại
          </button>
          <button onClick={exportRows} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-black text-emerald-700 hover:bg-emerald-100 transition">
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      <div className="flex gap-1 bg-white dark:bg-slate-800 rounded-2xl p-1.5 border border-slate-100 dark:border-slate-700/50 shadow-sm overflow-x-auto">
        {subTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setPaymentSubTab(tab.key)}
            className={`shrink-0 px-3 py-2 rounded-xl text-xs font-black transition ${activeTab === tab.key ? 'bg-orange-500 text-white shadow' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
        {cards.map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{card.label}</p>
                  <p className={`mt-1 text-xl font-black ${card.color}`}>{card.value}</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-1">{card.sub}</p>
                </div>
                <div className="w-9 h-9 rounded-2xl bg-slate-50 dark:bg-slate-700 flex items-center justify-center shrink-0">
                  <Icon size={17} className={card.color} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-3 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
          <select value={contractType} onChange={e => setContractType(e.target.value as PaymentScheduleContractTypeFilter)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold outline-none bg-white">
            {contractTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select value={contractId} onChange={e => setContractId(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold outline-none bg-white md:col-span-2">
            <option value="">Tất cả hợp đồng</option>
            {contractOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold outline-none" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold outline-none" />
          <label className="relative">
            <Search size={13} className="absolute left-3 top-2.5 text-slate-300" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm kiếm"
              className="w-full pl-8 pr-8 py-2 rounded-xl border border-slate-200 text-xs font-bold outline-none" />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-2 text-slate-300 hover:text-slate-500"><X size={14} /></button>}
          </label>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm font-bold text-slate-400">
            <Loader2 size={18} className="inline animate-spin mr-2" />Đang tải kế hoạch thanh toán...
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="p-12 text-center text-sm font-bold text-slate-400">Chưa có kế hoạch thanh toán phù hợp bộ lọc.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[1180px]">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-3 text-left">Hợp đồng</th>
                  <th className="p-3 text-left">Đợt</th>
                  <th className="p-3 text-left">Mốc</th>
                  <th className="p-3 text-center">Ngày dự kiến</th>
                  <th className="p-3 text-right">Giá trị dự kiến</th>
                  <th className="p-3 text-left">Hạng mục dự kiến</th>
                  <th className="p-3 text-center">Hồ sơ</th>
                  <th className="p-3 text-center">Chất lượng</th>
                  <th className="p-3 text-right">Đã thanh toán</th>
                  <th className="p-3 text-center">Trạng thái</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
                {visibleRows.map(row => (
                  <tr key={row.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 align-top">
                    <td className="p-3">
                      <div className="font-black text-slate-700 dark:text-slate-100">{row.contractCode || row.contractId || '-'}</div>
                      <div className="text-[10px] font-bold text-slate-400 mt-0.5">{row.counterpartyName || '-'}</div>
                      <StatusPill label={row.contractType === 'customer' ? 'Nhận thầu' : 'Thầu phụ'} tone={row.contractType === 'customer' ? 'emerald' : 'blue'} />
                    </td>
                    <td className="p-3">
                      <div className="font-black text-slate-700 dark:text-slate-100">{row.sequenceNo ? `Đợt ${row.sequenceNo}` : 'Đợt'}</div>
                      <div className="text-slate-500 dark:text-slate-300 font-bold mt-0.5">{row.description}</div>
                    </td>
                    <td className="p-3 font-bold text-slate-600 dark:text-slate-300">{milestoneLabel[row.milestoneType || 'progress']}</td>
                    <td className="p-3 text-center">
                      <div className="font-bold text-slate-600 dark:text-slate-300">{fmtDate(row.dueDate)}</div>
                      {row.status !== 'paid' && (
                        <div className={`text-[10px] font-black mt-0.5 ${row.isOverdue ? 'text-red-600' : row.isUpcoming ? 'text-amber-600' : 'text-slate-400'}`}>
                          {row.isOverdue ? `Quá hạn ${Math.abs(row.daysUntilDue)} ngày` : `Còn ${row.daysUntilDue} ngày`}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-right font-black text-slate-800 dark:text-white">{fmtMoney(row.amount)}</td>
                    <td className="p-3">
                      <div className="space-y-1">
                        {row.plannedTasks.length > 0 ? row.plannedTasks.slice(0, 3).map(task => (
                          <button
                            key={task.id}
                            onClick={() => navigate(buildProjectUrl(projectId, constructionSiteId, 'gantt', { taskId: task.id }))}
                            className="inline-flex mr-1 mb-1 px-2 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold"
                          >
                            {task.wbsCode ? `${task.wbsCode} - ` : ''}{task.name}
                          </button>
                        )) : <span className="text-slate-300 font-bold">Chưa chọn WBS</span>}
                        {row.plannedTasks.length > 3 && <span className="text-[10px] text-slate-400 font-bold">+{row.plannedTasks.length - 3}</span>}
                      </div>
                      {row.plannedScopeNote && <div className="mt-1 text-[10px] text-slate-400 font-bold line-clamp-2">{row.plannedScopeNote}</div>}
                    </td>
                    <td className="p-3 text-center">
                      <StatusPill label={dossierLabel[row.dossierStatus || 'not_started']} tone={row.dossierStatus === 'approved' ? 'emerald' : row.dossierStatus === 'submitted' ? 'blue' : 'slate'} />
                    </td>
                    <td className="p-3 text-center">
                      <StatusPill
                        label={qualityLabel[row.qualityStatus || 'not_confirmed']}
                        tone={row.qualityStatus === 'passed' ? 'emerald' : row.qualityStatus === 'failed' ? 'red' : row.qualityStatus === 'not_applicable' ? 'slate' : 'amber'}
                      />
                      {canConfirm && row.qualityStatus !== 'not_applicable' && (
                        <div className="mt-1 flex justify-center gap-1">
                          <button disabled={actingRowId === row.id} onClick={() => handleQuality(row, 'passed')} className="px-1.5 py-0.5 rounded-md text-[9px] font-black text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">Đạt</button>
                          <button disabled={actingRowId === row.id} onClick={() => handleQuality(row, 'failed')} className="px-1.5 py-0.5 rounded-md text-[9px] font-black text-red-600 hover:bg-red-50 disabled:opacity-50">Không đạt</button>
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-right font-black text-slate-700 dark:text-slate-200">{fmtMoney(row.paidAmount || (row.status === 'paid' ? row.amount : 0))}</td>
                    <td className="p-3 text-center">
                      <StatusPill label={row.status === 'paid' ? 'Đã thanh toán' : row.isOverdue ? 'Quá hạn' : 'Chờ thanh toán'} tone={row.status === 'paid' ? 'emerald' : row.isOverdue ? 'red' : 'amber'} />
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {canEditSchedule && (
                        <button disabled={actingRowId === row.id} onClick={() => openEdit(row)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-blue-600 hover:bg-blue-50 disabled:opacity-50">
                          <Edit2 size={11} className="inline mr-1" />Sửa
                        </button>
                      )}
                      {canDeleteSchedule && (
                        <button disabled={actingRowId === row.id} onClick={() => deleteRow(row)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">
                          <Trash2 size={11} className="inline mr-1" />Xóa
                        </button>
                      )}
                      {canConfirm && row.status !== 'paid' && (
                        <button disabled={actingRowId === row.id} onClick={() => handleMarkPaid(row)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">Đã TT</button>
                      )}
                      <button onClick={() => handleOpenContract(row)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-indigo-600 hover:bg-indigo-50">
                        <ExternalLink size={11} className="inline mr-1" />HĐ
                      </button>
                      {row.plannedTasks.length > 0 && (
                        <button onClick={() => handleOpenGantt(row)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-slate-500 hover:bg-slate-50">Gantt</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form && (
        <PaymentScheduleEditor
          form={form}
          saving={savingForm}
          onChange={setForm}
          onClose={() => setForm(null)}
          onSave={saveForm}
        />
      )}
    </div>
  );
};

const StatusPill: React.FC<{ label: string; tone?: 'slate' | 'emerald' | 'amber' | 'red' | 'blue' }> = ({ label, tone = 'slate' }) => {
  const cls = tone === 'emerald'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : tone === 'amber'
      ? 'bg-amber-50 text-amber-700 border-amber-100'
      : tone === 'red'
        ? 'bg-red-50 text-red-700 border-red-100'
        : tone === 'blue'
          ? 'bg-blue-50 text-blue-700 border-blue-100'
          : 'bg-slate-50 text-slate-600 border-slate-100';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-black border ${cls}`}>{label}</span>;
};

export default PaymentWorkbenchTab;
