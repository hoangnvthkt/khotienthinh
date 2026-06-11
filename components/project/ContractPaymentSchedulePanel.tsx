import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Loader2,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  ContractAppendix,
  ContractItemType,
  PaymentDossierStatus,
  PaymentQualityStatus,
  PaymentSchedule,
  PaymentScheduleMilestoneType,
  ProjectTask,
} from '../../types';
import { contractAppendixService } from '../../lib/hdService';
import { paymentService, taskService } from '../../lib/projectService';
import { ProjectPermissionCode, projectStaffService } from '../../lib/projectStaffService';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

interface Props {
  contractId: string;
  contractType: ContractItemType;
  projectId?: string | null;
  constructionSiteId?: string | null;
  contactName?: string;
  contractValue?: number;
  currency?: 'VND' | 'USD';
  canManageTab?: boolean;
}

const ADMIN_PROJECT_PERMS: ProjectPermissionCode[] = ['view', 'edit', 'delete', 'submit', 'verify', 'confirm', 'approve'];

const milestoneLabel: Record<PaymentScheduleMilestoneType, string> = {
  advance: 'Tạm ứng',
  progress: 'Thanh toán tiến độ',
  settlement: 'Quyết toán',
  retention: 'Giữ lại / bảo hành',
  other: 'Khác',
};

const dossierLabel: Record<PaymentDossierStatus, string> = {
  not_started: 'Chưa lập',
  preparing: 'Đang chuẩn bị',
  submitted: 'Đã trình',
  approved: 'Đã duyệt',
};

const qualityLabel: Record<PaymentQualityStatus, string> = {
  not_applicable: 'Không áp dụng',
  not_confirmed: 'Chưa xác nhận',
  passed: 'Đạt',
  failed: 'Không đạt',
};

const fmtMoney = (value: number, currency = 'VND') =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0));

const today = () => new Date().toISOString().slice(0, 10);
const parseDate = (value?: string) => value ? new Date(`${value}T00:00:00`) : null;
const fmtDate = (value?: string) => {
  const date = parseDate(value);
  return date ? date.toLocaleDateString('vi-VN') : '-';
};
const daysUntil = (value?: string) => {
  const date = parseDate(value);
  if (!date) return 0;
  return Math.round((date.getTime() - parseDate(today())!.getTime()) / 86_400_000);
};
const getDefaultQualityStatus = (milestoneType: PaymentScheduleMilestoneType): PaymentQualityStatus =>
  milestoneType === 'advance' ? 'not_applicable' : 'not_confirmed';
const taskLabel = (task: ProjectTask) => `${task.wbsCode ? `${task.wbsCode} - ` : ''}${task.name}`;
const lower = (value?: string | null) => (value || '').toLowerCase();

const defaultSchedule = (
  contractId: string,
  contractType: ContractItemType,
  sequenceNo: number,
  projectId?: string | null,
  constructionSiteId?: string | null,
  contactName?: string,
): PaymentSchedule => ({
  id: crypto.randomUUID(),
  projectId: projectId || null,
  constructionSiteId: constructionSiteId || projectId || '',
  contractId,
  contractType,
  sequenceNo,
  milestoneType: sequenceNo === 1 ? 'advance' : 'progress',
  description: sequenceNo === 1 ? 'Đợt 1 - Tạm ứng' : `Đợt ${sequenceNo}`,
  amount: 0,
  dueDate: today(),
  status: 'pending',
  type: contractType === 'customer' ? 'receivable' : 'payable',
  contactName,
  plannedTaskIds: [],
  plannedScopeNote: '',
  dossierStatus: 'not_started',
  qualityStatus: sequenceNo === 1 ? 'not_applicable' : 'not_confirmed',
  note: '',
});

const ContractPaymentSchedulePanel: React.FC<Props> = ({
  contractId,
  contractType,
  projectId,
  constructionSiteId,
  contactName,
  contractValue = 0,
  currency = 'VND',
  canManageTab = true,
}) => {
  const { user } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const { loading: saving, run } = useAsyncAction({
    errorTitle: 'Không thể lưu lịch thanh toán',
    fallbackError: 'Không thể lưu lịch thanh toán lên Supabase.',
    logScope: 'contractPaymentSchedule.save',
  });
  const [items, setItems] = useState<PaymentSchedule[]>([]);
  const [appendices, setAppendices] = useState<ContractAppendix[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<PaymentSchedule | null>(null);
  const [projectPerms, setProjectPerms] = useState<Set<ProjectPermissionCode>>(new Set());

  const loadPermissions = useCallback(async () => {
    if (canManageTab || user?.role === 'ADMIN') {
      setProjectPerms(new Set(ADMIN_PROJECT_PERMS));
      return;
    }
    try {
      const hasPbac = await projectStaffService.hasProjectPbac(projectId || undefined, constructionSiteId || undefined);
      if (!hasPbac) {
        setProjectPerms(new Set(ADMIN_PROJECT_PERMS));
        return;
      }
      if (!user?.id) {
        setProjectPerms(new Set());
        return;
      }
      const checks = await Promise.all((['edit', 'delete', 'confirm'] as ProjectPermissionCode[]).map(async code => ({
        code,
        allowed: projectId
          ? (await projectStaffService.checkProjectPermission(user.id, projectId, code, constructionSiteId || undefined)).allowed
          : constructionSiteId
            ? (await projectStaffService.checkPermission(user.id, constructionSiteId, code)).allowed
            : false,
      })));
      setProjectPerms(new Set(checks.filter(item => item.allowed).map(item => item.code)));
    } catch (error) {
      console.warn('Cannot load payment schedule permissions', error);
      setProjectPerms(new Set());
    }
  }, [canManageTab, constructionSiteId, projectId, user?.id, user?.role]);

  useEffect(() => { loadPermissions(); }, [loadPermissions]);

  const canEdit = user?.role === 'ADMIN' || projectPerms.has('edit');
  const canDelete = user?.role === 'ADMIN' || projectPerms.has('delete');
  const canConfirm = user?.role === 'ADMIN' || projectPerms.has('confirm');

  const requirePermission = async (code: ProjectPermissionCode, actionLabel: string) => {
    if (user?.role === 'ADMIN' || projectPerms.has(code)) return true;
    try {
      await projectStaffService.requireProjectPermission({
        userId: user?.id,
        projectId: projectId || undefined,
        constructionSiteId: constructionSiteId || undefined,
        code,
        actionLabel,
      });
      return true;
    } catch (error: any) {
      toast.warning('Không đủ quyền', error?.message || `Bạn cần quyền ${code} để ${actionLabel}.`);
      return false;
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const taskScope = projectId || constructionSiteId || '';
      const [scheduleRows, appendixRows, taskRows] = await Promise.all([
        paymentService.listByContract(contractId, contractType),
        contractAppendixService.listByContract(contractId, contractType),
        taskScope ? taskService.list(taskScope, constructionSiteId || null).catch(() => []) : Promise.resolve([]),
      ]);
      setItems(scheduleRows);
      setAppendices(appendixRows);
      setTasks(taskRows);
    } catch (error) {
      logApiError('contractPaymentSchedule.load', error);
      toast.error('Không thể tải lịch thanh toán', getApiErrorMessage(error, 'Không thể tải lịch thanh toán của hợp đồng.'));
    } finally {
      setLoading(false);
    }
  }, [constructionSiteId, contractId, contractType, projectId, toast]);

  useEffect(() => { load(); }, [load]);

  const taskMap = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);
  const sortedTasks = useMemo(() => [...tasks].sort((a, b) =>
    (a.wbsCode || '').localeCompare(b.wbsCode || '', 'vi') || (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name, 'vi'),
  ), [tasks]);

  const metrics = useMemo(() => {
    const totalPlan = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const paid = items.reduce((sum, item) => sum + Number(item.paidAmount || (item.status === 'paid' ? item.amount : 0)), 0);
    const upcoming = items.filter(item => item.status !== 'paid' && daysUntil(item.dueDate) >= 0 && daysUntil(item.dueDate) <= 10).length;
    const overdue = items.filter(item => item.status !== 'paid' && (item.status === 'overdue' || daysUntil(item.dueDate) < 0)).length;
    return { totalPlan, paid, remaining: Math.max(0, totalPlan - paid), upcoming, overdue };
  }, [items]);

  const openCreate = () => setForm(defaultSchedule(
    contractId,
    contractType,
    Math.max(0, ...items.map(item => Number(item.sequenceNo || 0))) + 1,
    projectId,
    constructionSiteId,
    contactName,
  ));
  const openEdit = (item: PaymentSchedule) => setForm({ ...item, plannedTaskIds: item.plannedTaskIds || [] });

  const save = async () => {
    if (!form) return;
    const source = items.find(item => item.id === form.id);
    const qualityChanged = source
      ? form.qualityStatus !== source.qualityStatus || form.qualityNote !== source.qualityNote
      : form.qualityStatus === 'passed' || form.qualityStatus === 'failed';
    if (!(await requirePermission('edit', 'lưu kế hoạch thanh toán'))) return;
    if (qualityChanged && !(await requirePermission('confirm', 'xác nhận chất lượng thanh toán'))) return;
    if (!form.description.trim()) {
      toast.warning('Thiếu mô tả đợt thanh toán', 'Vui lòng nhập nội dung hoặc tên đợt thanh toán.');
      return;
    }
    if (!form.constructionSiteId && !form.projectId) {
      toast.warning('Thiếu liên kết dự án/công trường', 'Hợp đồng cần có dự án hoặc công trường trước khi tạo lịch thanh toán.');
      return;
    }
    await run(async () => {
      const milestoneType = form.milestoneType || 'progress';
      const qualityStatus = milestoneType === 'advance' ? 'not_applicable' : (form.qualityStatus || 'not_confirmed');
      const shouldStampQuality = qualityChanged && (qualityStatus === 'passed' || qualityStatus === 'failed');
      await paymentService.upsert({
        ...form,
        contractId,
        contractType,
        projectId: projectId || form.projectId || null,
        constructionSiteId: constructionSiteId || form.constructionSiteId || projectId || '',
        sequenceNo: Number(form.sequenceNo || 1),
        milestoneType,
        description: form.description.trim(),
        amount: Number(form.amount || 0),
        paidAmount: Number(form.paidAmount || 0),
        plannedTaskIds: form.plannedTaskIds || [],
        plannedScopeNote: form.plannedScopeNote || '',
        qualityStatus,
        qualityConfirmedBy: shouldStampQuality ? user?.id : form.qualityConfirmedBy,
        qualityConfirmedName: shouldStampQuality ? user?.name : form.qualityConfirmedName,
        qualityConfirmedAt: shouldStampQuality ? new Date().toISOString() : form.qualityConfirmedAt,
      });
      setForm(null);
      await load();
    }, { successTitle: 'Đã lưu lịch thanh toán' });
  };

  const remove = async (item: PaymentSchedule) => {
    if (!(await requirePermission('delete', 'xoá kế hoạch thanh toán'))) return;
    const ok = await confirm({
      title: 'Xoá lịch thanh toán',
      targetName: item.description,
      warningText: 'Đợt thanh toán này sẽ bị xoá khỏi CashFlow và workspace hợp đồng.',
    });
    if (!ok) return;
    await run(async () => {
      await paymentService.remove(item.id);
      await load();
    }, { successTitle: 'Đã xoá lịch thanh toán', errorTitle: 'Không thể xoá lịch thanh toán' });
  };

  const markPaid = async (item: PaymentSchedule) => {
    if (!(await requirePermission('confirm', 'xác nhận đã thanh toán'))) return;
    await run(async () => {
      await paymentService.upsert({
        ...item,
        status: 'paid',
        paidDate: item.paidDate || today(),
        paidAmount: Number(item.paidAmount || item.amount || 0),
      });
      await load();
    }, { successTitle: 'Đã xác nhận thanh toán', errorTitle: 'Không thể cập nhật thanh toán' });
  };

  const confirmQuality = async (item: PaymentSchedule, qualityStatus: PaymentQualityStatus) => {
    if (!(await requirePermission('confirm', 'xác nhận chất lượng thanh toán'))) return;
    await run(async () => {
      await paymentService.upsert({
        ...item,
        qualityStatus,
        qualityConfirmedBy: user?.id,
        qualityConfirmedName: user?.name,
        qualityConfirmedAt: new Date().toISOString(),
      });
      await load();
    }, { successTitle: qualityStatus === 'passed' ? 'Đã xác nhận chất lượng đạt' : 'Đã xác nhận chất lượng không đạt' });
  };

  return (
    <div className="space-y-4 mt-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h4 className="text-xs font-black text-slate-700 dark:text-white flex items-center gap-1.5">
            <CalendarClock size={14} className="text-emerald-500" /> Kế hoạch thanh toán
          </h4>
          <p className="text-[10px] text-slate-400 font-bold mt-1">Nhập tay theo hợp đồng; hạng mục WBS chỉ mô tả phạm vi thanh toán dự kiến.</p>
        </div>
        {canEdit && (
          <button
            onClick={openCreate}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
          >
            <Plus size={12} /> Thêm đợt
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Metric label="Giá trị HĐ" value={fmtMoney(contractValue, currency)} />
        <Metric label="Tổng kế hoạch" value={fmtMoney(metrics.totalPlan, currency)} />
        <Metric label="Đã thanh toán" value={fmtMoney(metrics.paid, currency)} tone="emerald" />
        <Metric label="Còn lại" value={fmtMoney(metrics.remaining, currency)} tone="amber" />
        <Metric label="Sắp tới hạn" value={`${metrics.upcoming} đợt`} tone="blue" />
        <Metric label="Quá hạn" value={`${metrics.overdue} đợt`} tone="red" />
      </div>

      {loading ? (
        <div className="p-6 text-center text-sm text-slate-400"><Loader2 size={16} className="inline animate-spin mr-2" />Đang tải kế hoạch thanh toán...</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs font-bold text-slate-400">
          Chưa có kế hoạch thanh toán cho hợp đồng này
        </div>
      ) : (
        <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[980px]">
              <thead className="bg-slate-50 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-3 text-left">Đợt</th>
                  <th className="p-3 text-left">Mốc</th>
                  <th className="p-3 text-center">Ngày dự kiến</th>
                  <th className="p-3 text-right">Số tiền</th>
                  <th className="p-3 text-left">Hạng mục dự kiến</th>
                  <th className="p-3 text-center">Hồ sơ</th>
                  <th className="p-3 text-center">Chất lượng</th>
                  <th className="p-3 text-center">Trạng thái</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map(item => {
                  const remainingDays = daysUntil(item.dueDate);
                  const overdue = item.status !== 'paid' && (item.status === 'overdue' || remainingDays < 0);
                  const selectedTasks = (item.plannedTaskIds || []).map(id => taskMap.get(id)).filter(Boolean) as ProjectTask[];
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/60 align-top">
                      <td className="p-3">
                        <div className="font-black text-slate-700">{item.sequenceNo ? `Đợt ${item.sequenceNo}` : 'Đợt'}</div>
                        <div className="text-slate-500 font-bold mt-0.5">{item.description}</div>
                      </td>
                      <td className="p-3 text-slate-600 font-bold">{milestoneLabel[item.milestoneType || 'progress']}</td>
                      <td className="p-3 text-center">
                        <div className="font-bold text-slate-600">{fmtDate(item.dueDate)}</div>
                        {item.status !== 'paid' && (
                          <div className={`text-[10px] font-black mt-0.5 ${overdue ? 'text-red-600' : remainingDays <= 10 ? 'text-amber-600' : 'text-slate-400'}`}>
                            {overdue ? `Quá hạn ${Math.abs(remainingDays)} ngày` : `Còn ${remainingDays} ngày`}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right font-black text-slate-800">{fmtMoney(item.amount, currency)}</td>
                      <td className="p-3">
                        <div className="space-y-1">
                          {selectedTasks.length > 0 ? selectedTasks.slice(0, 3).map(task => (
                            <span key={task.id} className="inline-flex mr-1 mb-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                              {taskLabel(task)}
                            </span>
                          )) : <span className="text-slate-300 font-bold">Chưa chọn WBS</span>}
                          {selectedTasks.length > 3 && <span className="text-[10px] text-slate-400 font-bold">+{selectedTasks.length - 3}</span>}
                        </div>
                        {item.plannedScopeNote && <div className="mt-1 text-[10px] text-slate-400 font-bold line-clamp-2">{item.plannedScopeNote}</div>}
                      </td>
                      <td className="p-3 text-center">
                        <StatusPill label={dossierLabel[item.dossierStatus || 'not_started']} tone={item.dossierStatus === 'approved' ? 'emerald' : item.dossierStatus === 'submitted' ? 'blue' : 'slate'} />
                      </td>
                      <td className="p-3 text-center">
                        <StatusPill
                          label={qualityLabel[item.qualityStatus || getDefaultQualityStatus(item.milestoneType || 'progress')]}
                          tone={item.qualityStatus === 'passed' ? 'emerald' : item.qualityStatus === 'failed' ? 'red' : item.qualityStatus === 'not_applicable' ? 'slate' : 'amber'}
                        />
                        {canConfirm && item.qualityStatus !== 'not_applicable' && (
                          <div className="mt-1 flex justify-center gap-1">
                            <button onClick={() => confirmQuality(item, 'passed')} className="px-1.5 py-0.5 rounded-md text-[9px] font-black text-emerald-600 hover:bg-emerald-50">Đạt</button>
                            <button onClick={() => confirmQuality(item, 'failed')} className="px-1.5 py-0.5 rounded-md text-[9px] font-black text-red-600 hover:bg-red-50">Không đạt</button>
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <StatusPill label={item.status === 'paid' ? 'Đã thanh toán' : overdue ? 'Quá hạn' : 'Chờ thanh toán'} tone={item.status === 'paid' ? 'emerald' : overdue ? 'red' : 'amber'} />
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        {canConfirm && item.status !== 'paid' && <button onClick={() => markPaid(item)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-emerald-600 hover:bg-emerald-50">Đã TT</button>}
                        {canEdit && <button onClick={() => openEdit(item)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-indigo-600 hover:bg-indigo-50">Sửa</button>}
                        {canDelete && <button onClick={() => remove(item)} className="ml-1 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-emerald-500 uppercase">Kế hoạch thanh toán hợp đồng</p>
                <h3 className="font-black text-slate-800">{form.description || 'Đợt thanh toán mới'}</h3>
              </div>
              <button onClick={() => setForm(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-4 gap-3 overflow-y-auto">
              <Field label="Số đợt" type="number" value={String(form.sequenceNo || 1)} onChange={value => setForm({ ...form, sequenceNo: Number(value) })} />
              <SelectField label="Loại mốc" value={form.milestoneType || 'progress'} onChange={value => {
                const milestoneType = value as PaymentScheduleMilestoneType;
                setForm({
                  ...form,
                  milestoneType,
                  qualityStatus: getDefaultQualityStatus(milestoneType),
                });
              }}>
                {Object.entries(milestoneLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </SelectField>
              <Field label="Ngày dự kiến" type="date" value={form.dueDate} onChange={value => setForm({ ...form, dueDate: value })} />
              <Field label="Số tiền dự kiến" type="number" value={String(form.amount || 0)} onChange={value => setForm({ ...form, amount: Number(value) })} />
              <Field label="Mô tả đợt *" className="md:col-span-2" value={form.description} onChange={value => setForm({ ...form, description: value })} />
              <SelectField label="Loại dòng tiền" value={form.type} onChange={value => setForm({ ...form, type: value as PaymentSchedule['type'] })}>
                <option value="receivable">Phải thu</option>
                <option value="payable">Phải trả</option>
              </SelectField>
              <SelectField label="Trạng thái thanh toán" value={form.status} onChange={value => setForm({ ...form, status: value as PaymentSchedule['status'] })}>
                <option value="pending">Chờ thanh toán</option>
                <option value="paid">Đã thanh toán</option>
                <option value="overdue">Quá hạn</option>
              </SelectField>
              <SelectField label="Trạng thái hồ sơ" value={form.dossierStatus || 'not_started'} onChange={value => setForm({ ...form, dossierStatus: value as PaymentDossierStatus })}>
                {Object.entries(dossierLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </SelectField>
              <div>
                <SelectField
                  label="Chất lượng"
                  value={form.qualityStatus || getDefaultQualityStatus(form.milestoneType || 'progress')}
                  onChange={value => setForm({ ...form, qualityStatus: value as PaymentQualityStatus })}
                  disabled={!canConfirm || form.milestoneType === 'advance'}
                >
                  {Object.entries(qualityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </SelectField>
                {form.milestoneType === 'advance' ? (
                  <p className="mt-1 text-[10px] font-bold text-slate-400">Tạm ứng đầu công trình chưa có hạng mục nghiệm thu nên chất lượng để Không áp dụng.</p>
                ) : !canConfirm ? (
                  <p className="mt-1 text-[10px] font-bold text-amber-600">Chỉ người có quyền confirm/Chỉ huy trưởng mới được xác nhận chất lượng.</p>
                ) : null}
              </div>
              <Field label="Đã thanh toán" type="number" value={String(form.paidAmount || 0)} onChange={value => setForm({ ...form, paidAmount: Number(value) })} />
              <Field label="Ngày thanh toán" type="date" value={form.paidDate || ''} onChange={value => setForm({ ...form, paidDate: value })} />
              <SelectField label="Phụ lục" value={form.appendixId || ''} onChange={value => setForm({ ...form, appendixId: value || undefined })}>
                <option value="">Không gắn phụ lục</option>
                {appendices.map(item => <option key={item.id} value={item.id}>{item.appendixNumber} - {item.name}</option>)}
              </SelectField>
              <TaskMultiSelect
                label="Hạng mục WBS dự kiến"
                className="md:col-span-2"
                tasks={sortedTasks}
                value={form.plannedTaskIds || []}
                onChange={plannedTaskIds => setForm({ ...form, plannedTaskIds })}
              />
              <Field label="Ghi chú phạm vi thanh toán" className="md:col-span-2" value={form.plannedScopeNote || ''} onChange={value => setForm({ ...form, plannedScopeNote: value })} />
              <Field label="Ghi chú chất lượng" className="md:col-span-2" value={form.qualityNote || ''} onChange={value => setForm({ ...form, qualityNote: value })} />
              <Field label="Ghi chú chung" className="md:col-span-2" value={form.note || ''} onChange={value => setForm({ ...form, note: value })} />
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
              <button onClick={() => setForm(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl font-bold text-sm text-slate-600">Huỷ</button>
              <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu kế hoạch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; tone?: 'slate' | 'emerald' | 'amber' | 'red' | 'blue' }> = ({ label, value, tone = 'slate' }) => {
  const color = tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : tone === 'red' ? 'text-red-600' : tone === 'blue' ? 'text-blue-600' : 'text-slate-800';
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</div>
      <div className={`text-base font-black ${color}`}>{value}</div>
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

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  className?: string;
}> = ({ label, value, onChange, type = 'text', className = '' }) => (
  <label className={`block ${className}`}>
    <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</span>
    <input
      type={type}
      value={value}
      onChange={event => onChange(event.target.value)}
      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
    />
  </label>
);

const SelectField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}> = ({ label, value, onChange, children, disabled }) => (
  <label className="block">
    <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</span>
    <select
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 bg-white disabled:bg-slate-50 disabled:text-slate-400"
    >
      {children}
    </select>
  </label>
);

const TaskMultiSelect: React.FC<{
  label: string;
  tasks: ProjectTask[];
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
}> = ({ label, tasks, value, onChange, className = '' }) => {
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(value), [value]);
  const selectedTasks = useMemo(
    () => tasks.filter(task => selected.has(task.id)),
    [selected, tasks],
  );
  const filteredTasks = useMemo(() => {
    const needle = lower(query.trim());
    if (!needle) return tasks;
    return tasks.filter(task => lower(`${task.wbsCode || ''} ${task.name}`).includes(needle));
  }, [query, tasks]);

  const toggle = (taskId: string) => {
    const next = new Set(value);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    onChange(Array.from(next));
  };

  return (
    <div className={`block ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="block text-[10px] font-bold text-slate-400 uppercase">{label}</span>
        <button
          type="button"
          onClick={() => onChange([])}
          className="text-[10px] font-black text-slate-400 hover:text-slate-700"
        >
          Không chọn hạng mục
        </button>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <label className="relative block border-b border-slate-100">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-300" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Gõ mã WBS hoặc tên hạng mục"
            className="w-full pl-8 pr-8 py-2 text-sm outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-2 text-slate-300 hover:text-slate-500"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <div className="max-h-40 overflow-y-auto divide-y divide-slate-50">
          {filteredTasks.length === 0 ? (
            <div className="px-3 py-5 text-center text-xs font-bold text-slate-300">
              Không tìm thấy hạng mục phù hợp
            </div>
          ) : filteredTasks.map(task => (
            <label key={task.id} className="flex items-start gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(task.id)}
                onChange={() => toggle(task.id)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="min-w-0">
                <span className="block text-xs font-black text-slate-700 truncate">{taskLabel(task)}</span>
                <span className="block text-[10px] font-bold text-slate-400">
                  {task.startDate || '-'} → {task.endDate || '-'} · {Number(task.progress || 0)}%
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {selectedTasks.length === 0 ? (
          <span className="text-[10px] font-bold text-slate-400">Chưa chọn hạng mục nào. Có thể để trống cho tạm ứng hoặc đợt không gắn WBS.</span>
        ) : selectedTasks.map(task => (
          <button
            key={task.id}
            type="button"
            onClick={() => toggle(task.id)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-[10px] font-black text-emerald-700 hover:bg-emerald-100"
          >
            {taskLabel(task)} <X size={10} />
          </button>
        ))}
      </div>
    </div>
  );
};

export default ContractPaymentSchedulePanel;
