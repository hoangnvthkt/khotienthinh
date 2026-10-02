import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, CalendarOff, CheckCircle2, ChevronRight, Clock, Inbox, Plus, RefreshCw,
  Send, Settings2, UserCheck, Users, X, XCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useToast } from '../../context/ToastContext';
import { useReasonConfirm } from '../../context/ConfirmContext';
import { canPerformHrmTemplatePermission } from '../../lib/permissions/permissionService';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import {
  currentLeaveStep, LeaveLogRow, LeavePreview, LeaveRequestRow, leaveService, LeaveSession,
  LeaveSettings, LeaveStatus, LeaveTypeOption,
} from '../../lib/leaveService';

type Tab = 'mine' | 'approve' | 'all' | 'policy';

const STATUS: Record<LeaveStatus, { label: string; tone: string }> = {
  pending: { label: 'Chờ duyệt', tone: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' },
  approved: { label: 'Đã duyệt', tone: 'bg-leaf-50 text-leaf-700 dark:bg-leaf-900/30 dark:text-leaf-300' },
  rejected: { label: 'Từ chối', tone: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300' },
  cancelled: { label: 'Đã hủy', tone: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};
const SESSION_LABEL: Record<LeaveSession, string> = { full: 'cả ngày', morning: 'buổi sáng', afternoon: 'buổi chiều' };
const PAID_BY_LABEL = { company: 'Công ty trả lương', social_insurance: 'Quỹ BHXH chi trả', none: 'Không hưởng lương' } as const;
const LATE_SUBTYPES = ['Đi muộn', 'Về sớm', 'Ra ngoài trong giờ'];
const PERSONAL_SUBTYPES = ['Kết hôn (3 ngày)', 'Con kết hôn (1 ngày)', 'Bố/mẹ, vợ/chồng, con mất (3 ngày)'];
const PERSONAL_UNPAID_SUBTYPES = ['Ông bà, anh chị em ruột mất', 'Bố/mẹ, anh chị em ruột kết hôn'];
const LOG_ACTION: Record<string, string> = { create: 'tạo đơn', approve: 'duyệt', reject: 'từ chối', cancel: 'hủy đơn', revoke: 'thu hồi' };

const formatDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('vi-VN');
const today = () => new Date().toLocaleDateString('sv-SE');

const describeTime = (request: Pick<LeaveRequestRow, 'startDate' | 'endDate' | 'startSession' | 'endSession' | 'minutes' | 'subtype'>) => {
  if (request.minutes !== null) return `${request.subtype || 'Đi muộn / về sớm'} ${request.minutes} phút · ${formatDate(request.startDate)}`;
  if (request.startDate === request.endDate) {
    return `${formatDate(request.startDate)}${request.startSession !== 'full' ? ` (${SESSION_LABEL[request.startSession]})` : ''}`;
  }
  return `${formatDate(request.startDate)}${request.startSession === 'afternoon' ? ' (chiều)' : ''} → ${formatDate(request.endDate)}${request.endSession === 'morning' ? ' (sáng)' : ''}`;
};

const LeaveManagement: React.FC = () => {
  const { employees, users, user } = useApp();
  useModuleData('hrm');
  const toast = useToast();
  const reasonConfirm = useReasonConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const isHr = canPerformHrmTemplatePermission(user, 'hrm.employee.view_sensitive');
  const canManagePolicy = canPerformHrmTemplatePermission(user, 'hrm.master_data.manage');
  const me = useMemo(() => employees.find(employee => employee.userId === user.id && employee.status === 'Đang làm việc'), [employees, user.id]);

  const [tab, setTab] = useState<Tab>('mine');
  const [requests, setRequests] = useState<LeaveRequestRow[]>([]);
  const [types, setTypes] = useState<LeaveTypeOption[]>([]);
  const [settings, setSettings] = useState<LeaveSettings | null>(null);
  const [balance, setBalance] = useState<{ accrued: number; used: number } | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('request'));
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | ''>('');

  const userName = useCallback((id: string | null | undefined) => users.find(item => item.id === id)?.name || '', [users]);
  const employeeById = useMemo(() => new Map(employees.map(employee => [employee.id, employee])), [employees]);
  const typeName = useCallback((code: string) => types.find(type => type.code === code)?.name || code, [types]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [requestRows, typeRows, settingRow] = await Promise.all([
        leaveService.listVisible(), leaveService.listTypes(), leaveService.getSettings(),
      ]);
      setRequests(requestRows);
      setTypes(typeRows);
      setSettings(settingRow);
      if (me) setBalance(await leaveService.myAnnualBalance(me.id, new Date().getFullYear()));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Không tải được đơn nghỉ.');
    } finally {
      setLoading(false);
    }
  }, [me]);

  useEffect(() => { void load(); }, [load]);

  const isMyStep = useCallback((request: LeaveRequestRow) => {
    const step = currentLeaveStep(request);
    if (!step) return false;
    return step.userId === user.id || (step.kind === 'hr' && isHr);
  }, [isHr, user.id]);

  const mine = requests.filter(request => request.employeeId === me?.id);
  const toApprove = requests.filter(request => request.employeeId !== me?.id && isMyStep(request));
  const pendingAnnual = mine.filter(request => request.status === 'pending' && request.type === 'annual')
    .reduce((sum, request) => sum + request.totalDays, 0);

  const visibleRows = (tab === 'mine' ? mine : tab === 'approve' ? toApprove : requests)
    .filter(request => !statusFilter || request.status === statusFilter)
    .filter(request => !search || matchesSearchQueryMultiple([
      request.code, employeeById.get(request.employeeId)?.fullName, employeeById.get(request.employeeId)?.employeeCode, typeName(request.type),
    ], search));

  const selected = requests.find(request => request.id === selectedId) || null;

  const openRequest = (id: string | null) => {
    setSelectedId(id);
    const next = new URLSearchParams(searchParams);
    if (id) next.set('request', id); else next.delete('request');
    setSearchParams(next, { replace: true });
  };

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await load();
    } catch (error) {
      toast.error('Chưa thực hiện được', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };

  const approve = async (request: LeaveRequestRow, onBehalf: boolean) => {
    let comment: string | null = null;
    if (onBehalf) {
      comment = await reasonConfirm({
        title: 'HR duyệt thay', targetName: `${request.code} · ${employeeById.get(request.employeeId)?.fullName || ''}`,
        subtitle: 'Lịch sử sẽ ghi bạn là người duyệt thay cho bước này.', reasonLabel: 'Lý do duyệt thay',
        reasonPlaceholder: 'Ví dụ: người duyệt nghỉ phép, đã xác nhận qua điện thoại', actionLabel: 'Duyệt thay', intent: 'warning',
      });
      if (comment === null) return;
    }
    await run(() => leaveService.decide(request.id, 'approve', comment), 'Đã duyệt đơn');
  };

  const reject = async (request: LeaveRequestRow) => {
    const reason = await reasonConfirm({
      title: 'Từ chối đơn', targetName: `${request.code} · ${employeeById.get(request.employeeId)?.fullName || ''}`,
      subtitle: 'Người xin sẽ nhận thông báo kèm lý do.', reasonLabel: 'Lý do từ chối',
      reasonPlaceholder: 'Ví dụ: trùng tiến độ đổ bê tông, đề nghị dời sang tuần sau', actionLabel: 'Từ chối', intent: 'danger',
    });
    if (reason === null) return;
    await run(() => leaveService.decide(request.id, 'reject', reason), 'Đã từ chối đơn');
  };

  const cancel = async (request: LeaveRequestRow) => {
    const reason = await reasonConfirm({
      title: 'Hủy đơn', targetName: `${request.code} · ${typeName(request.type)}`,
      subtitle: request.status === 'approved' ? 'Số phép và bảng công sẽ được hoàn lại.' : 'Đơn sẽ dừng xử lý.',
      reasonLabel: 'Lý do hủy', reasonPlaceholder: 'Ví dụ: đổi kế hoạch', actionLabel: 'Hủy đơn', intent: 'danger',
    });
    if (reason === null) return;
    await run(() => leaveService.cancel(request.id, reason), 'Đã hủy đơn');
  };

  const remaining = balance ? balance.accrued - balance.used - pendingAnnual : null;

  const tabs: Array<{ id: Tab; label: string; count?: number; icon: typeof Inbox; show: boolean }> = [
    { id: 'mine', label: 'Đơn của tôi', count: mine.filter(request => request.status === 'pending').length, icon: CalendarOff, show: true },
    { id: 'approve', label: 'Chờ tôi duyệt', count: toApprove.length, icon: UserCheck, show: true },
    { id: 'all', label: 'Toàn công ty', icon: Users, show: isHr },
    { id: 'policy', label: 'Chính sách', icon: Settings2, show: isHr },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-foreground flex items-center gap-2"><CalendarOff className="text-mint-600" size={24} /> Nghỉ phép</h1>
          <p className="text-sm text-muted-foreground">Xin nghỉ, đi muộn / về sớm, công tác — hệ thống tự gửi đúng người duyệt.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="rounded-xl border border-border p-2.5 text-muted-foreground hover:bg-muted" aria-label="Tải lại">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {me && (
            <button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-leaf-600 px-4 py-2.5 text-sm font-black text-white hover:bg-leaf-700">
              <Plus size={16} /> Tạo đơn
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-2xl bg-mint-50 p-3 sm:p-4 dark:bg-mint-900/20">
          <p className="text-[10px] sm:text-[11px] font-black uppercase text-mint-700 dark:text-mint-300">Phép còn lại</p>
          <p className="text-lg sm:text-2xl font-black text-mint-700 dark:text-mint-300">
            {balance === undefined ? '…' : remaining === null ? 'Chưa có' : `${remaining.toLocaleString('vi-VN')} ngày`}
          </p>
          <p className="hidden text-[11px] text-muted-foreground sm:block">
            {balance === null ? 'HR chưa thiết lập số phép năm nay cho bạn.' : pendingAnnual > 0 ? `Đã trừ ${pendingAnnual} ngày đang chờ duyệt` : 'Cộng 1 ngày vào mùng 1 hằng tháng'}
          </p>
        </div>
        <div className="rounded-2xl bg-amber-50 p-3 sm:p-4 dark:bg-amber-950/20">
          <p className="text-[10px] sm:text-[11px] font-black uppercase text-amber-700 dark:text-amber-300">Đơn đang chờ</p>
          <p className="text-lg sm:text-2xl font-black text-amber-700 dark:text-amber-300">{loading ? '…' : mine.filter(request => request.status === 'pending').length}</p>
        </div>
        <button type="button" onClick={() => setTab('approve')} className="rounded-2xl bg-leaf-50 p-3 sm:p-4 text-left dark:bg-leaf-900/20">
          <p className="text-[10px] sm:text-[11px] font-black uppercase text-leaf-700 dark:text-leaf-300">Chờ tôi duyệt</p>
          <p className="text-lg sm:text-2xl font-black text-leaf-700 dark:text-leaf-300">{loading ? '…' : toApprove.length}</p>
        </button>
      </div>

      <div className="flex flex-wrap gap-1 rounded-2xl bg-muted p-1">
        {tabs.filter(item => item.show).map(item => (
          <button key={item.id} type="button" onClick={() => setTab(item.id)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black ${tab === item.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>
            <item.icon size={14} /> {item.label}
            {item.count ? <span className="rounded-full bg-amber-500 px-1.5 text-[10px] text-white">{item.count}</span> : null}
          </button>
        ))}
      </div>

      {loadError && <p className="text-sm font-bold text-rose-600">{loadError}</p>}

      {tab === 'policy' ? (
        <PolicyPanel settings={settings} types={types} users={users.filter(item => item.isActive !== false)} canEdit={canManagePolicy} onSaved={load} />
      ) : (
        <div className="rounded-2xl border border-border bg-card">
          {tab !== 'mine' && (
            <div className="flex flex-wrap gap-2 border-b border-border p-3">
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm mã đơn, nhân viên, loại…"
                className="min-w-[200px] flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm" />
              <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as LeaveStatus | '')}
                className="rounded-xl border border-border bg-card px-3 py-2 text-sm">
                <option value="">Mọi trạng thái</option>
                {Object.entries(STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
              </select>
            </div>
          )}
          {visibleRows.length === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">
              {loading ? 'Đang tải…' : tab === 'approve' ? 'Không có đơn nào chờ bạn duyệt.' : tab === 'mine' ? 'Bạn chưa có đơn nào. Bấm "Tạo đơn" để xin nghỉ.' : 'Không có đơn phù hợp.'}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visibleRows.map(request => {
                const step = currentLeaveStep(request);
                const employee = employeeById.get(request.employeeId);
                return (
                  <button key={request.id} type="button" onClick={() => openRequest(request.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-foreground">
                        {tab !== 'mine' && <span className="text-mint-700 dark:text-mint-300">{employee?.fullName || 'Nhân viên'} · </span>}
                        {typeName(request.type)}
                        <span className="ml-2 font-mono text-[11px] text-muted-foreground">{request.code}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {describeTime(request)}{request.minutes === null ? ` · ${request.totalDays.toLocaleString('vi-VN')} ngày` : ''}
                        {step ? ` · đang chờ: ${step.kind === 'hr' ? 'Phòng HCNS' : userName(step.userId) || step.label}` : ''}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-black ${STATUS[request.status].tone}`}>{STATUS[request.status].label}</span>
                    <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selected && (
        <RequestDrawer
          request={selected}
          employeeName={employeeById.get(selected.employeeId)?.fullName || 'Nhân viên'}
          typeName={typeName(selected.type)}
          userName={userName}
          isOwner={selected.employeeId === me?.id}
          isMyStep={isMyStep(selected)}
          isHr={isHr}
          busy={busy}
          onClose={() => openRequest(null)}
          onApprove={onBehalf => void approve(selected, onBehalf)}
          onReject={() => void reject(selected)}
          onCancel={() => void cancel(selected)}
        />
      )}

      {showCreate && me && (
        <CreateDialog
          types={types.filter(type => type.isActive)}
          settings={settings}
          onClose={() => setShowCreate(false)}
          onSubmitted={async () => { setShowCreate(false); setTab('mine'); await load(); }}
        />
      )}
    </div>
  );
};

const RequestDrawer: React.FC<{
  request: LeaveRequestRow;
  employeeName: string;
  typeName: string;
  userName: (id: string | null | undefined) => string;
  isOwner: boolean;
  isMyStep: boolean;
  isHr: boolean;
  busy: boolean;
  onClose: () => void;
  onApprove: (onBehalf: boolean) => void;
  onReject: () => void;
  onCancel: () => void;
}> = ({ request, employeeName, typeName, userName, isOwner, isMyStep, isHr, busy, onClose, onApprove, onReject, onCancel }) => {
  const [logs, setLogs] = useState<LeaveLogRow[]>([]);
  useEffect(() => {
    leaveService.listLogs(request.id).then(setLogs).catch(() => setLogs([]));
  }, [request.id, request.status, request.currentStep]);

  const canDecide = request.status === 'pending' && !isOwner && (isMyStep || isHr);
  const canCancel = (request.status === 'pending' && (isOwner || isHr)) || (request.status === 'approved' && isHr);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="flex w-full max-w-lg flex-col bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <p className="font-mono text-[11px] text-muted-foreground">{request.code}</p>
            <h2 className="text-lg font-black text-foreground">{typeName}</h2>
            <p className="text-sm font-bold text-mint-700 dark:text-mint-300">{employeeName}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-lg px-2 py-1 text-[11px] font-black ${STATUS[request.status].tone}`}>{STATUS[request.status].label}</span>
            <button type="button" onClick={onClose} className="rounded-xl p-2 hover:bg-muted" aria-label="Đóng"><X size={18} /></button>
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="rounded-xl bg-muted/60 p-3 text-sm">
            <p className="font-bold text-foreground">{describeTime(request)}</p>
            {request.minutes === null && <p className="text-muted-foreground">{request.totalDays.toLocaleString('vi-VN')} ngày làm việc</p>}
            <p className="mt-2 text-foreground">{request.reason}</p>
            {request.rejectionReason && <p className="mt-2 font-bold text-rose-600">Lý do từ chối: {request.rejectionReason}</p>}
            {request.cancelReason && <p className="mt-2 text-muted-foreground">Lý do hủy: {request.cancelReason}</p>}
          </div>

          <div>
            <p className="mb-2 text-[11px] font-black uppercase text-muted-foreground">Người duyệt</p>
            <ol className="space-y-2">
              {request.approvers.map((step, index) => {
                const waiting = request.status === 'pending' && (request.currentStep || 1) === index + 1;
                return (
                  <li key={`${step.order}-${index}`} className={`flex items-start gap-3 rounded-xl border p-3 ${waiting ? 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20' : 'border-border'}`}>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white ${step.status === 'approved' ? 'bg-leaf-600' : step.status === 'rejected' ? 'bg-rose-500' : waiting ? 'bg-amber-500' : 'bg-slate-300'}`}>
                      {index + 1}
                    </span>
                    <div className="min-w-0 text-sm">
                      <p className="font-bold text-foreground">{step.kind === 'hr' ? 'Phòng HCNS' : userName(step.userId) || 'Chưa xác định'}</p>
                      <p className="text-[11px] text-muted-foreground">{step.label}</p>
                      {step.status !== 'waiting' && (
                        <p className="text-[11px] text-muted-foreground">
                          {step.status === 'approved' ? 'Đã duyệt' : 'Từ chối'}{step.onBehalf ? ` (HR ${userName(step.decidedBy)} duyệt thay)` : ''}
                          {step.decidedAt ? ` · ${new Date(step.decidedAt).toLocaleString('vi-VN')}` : ''}{step.comment ? ` · "${step.comment}"` : ''}
                        </p>
                      )}
                      {waiting && <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">Đang chờ duyệt</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {logs.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-black uppercase text-muted-foreground">Lịch sử</p>
              <ul className="space-y-1.5 text-xs">
                {logs.map(log => (
                  <li key={log.id} className="text-muted-foreground">
                    <span className="font-bold text-foreground">{userName(log.actedBy) || 'Hệ thống'}</span> {LOG_ACTION[log.action] || log.action}
                    {log.comment && log.action !== 'create' ? ` — ${log.comment}` : ''} · {new Date(log.createdAt).toLocaleString('vi-VN')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {(canDecide || canCancel) && (
          <div className="flex flex-wrap gap-2 border-t border-border p-4">
            {canDecide && (
              <>
                <button type="button" disabled={busy} onClick={() => onApprove(!isMyStep)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-leaf-600 px-4 py-2.5 text-sm font-black text-white hover:bg-leaf-700 disabled:opacity-50">
                  <CheckCircle2 size={16} /> {isMyStep ? 'Duyệt' : 'HR duyệt thay'}
                </button>
                <button type="button" disabled={busy} onClick={onReject}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-black text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                  <XCircle size={16} /> Từ chối
                </button>
              </>
            )}
            {canCancel && (
              <button type="button" disabled={busy} onClick={onCancel}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-muted-foreground hover:bg-muted disabled:opacity-50">
                Hủy đơn
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const CreateDialog: React.FC<{
  types: LeaveTypeOption[];
  settings: LeaveSettings | null;
  onClose: () => void;
  onSubmitted: () => Promise<void>;
}> = ({ types, settings, onClose, onSubmitted }) => {
  const toast = useToast();
  const [typeCode, setTypeCode] = useState(types[0]?.code || 'annual');
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [startSession, setStartSession] = useState<LeaveSession>('full');
  const [endSession, setEndSession] = useState<LeaveSession>('full');
  const [minutes, setMinutes] = useState(30);
  const [subtype, setSubtype] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [sending, setSending] = useState(false);

  const type = types.find(item => item.code === typeCode);
  const isMinute = type?.unit === 'minute';
  const singleDay = start === end;
  const subtypes = typeCode === 'late_early' ? LATE_SUBTYPES : typeCode === 'personal' ? PERSONAL_SUBTYPES : typeCode === 'personal_unpaid' ? PERSONAL_UNPAID_SUBTYPES : [];
  const payload = {
    type: typeCode,
    start,
    end: isMinute ? start : end,
    startSession: isMinute ? 'full' as const : startSession,
    endSession: isMinute ? 'full' as const : singleDay ? startSession : endSession,
    minutes: isMinute ? minutes : null,
  };

  useEffect(() => {
    if (!start || (!isMinute && !end)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      leaveService.preview(payload)
        .then(result => { if (!cancelled) { setPreview(result); setPreviewError(''); } })
        .catch(error => { if (!cancelled) setPreviewError(error instanceof Error ? error.message : 'Không xem trước được.'); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeCode, start, end, startSession, endSession, minutes, isMinute]);

  const submit = async () => {
    setSending(true);
    try {
      await leaveService.submit({ ...payload, subtype: subtype || null, reason });
      toast.success('Đã gửi đơn', preview?.steps[0] ? `Chờ ${preview.steps[0].name || preview.steps[0].label} duyệt.` : undefined);
      await onSubmitted();
    } catch (error) {
      toast.error('Chưa gửi được đơn', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setSending(false);
    }
  };

  const blocked = !preview || preview.problems.length > 0 || reason.trim().length < 3 || (subtypes.length > 0 && typeCode === 'late_early' && !subtype);
  const sessionButtons = (value: LeaveSession, onChange: (value: LeaveSession) => void, options: LeaveSession[]) => (
    <div className="flex gap-1">
      {options.map(option => (
        <button key={option} type="button" onClick={() => onChange(option)}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${value === option ? 'bg-mint-600 text-white' : 'bg-muted text-muted-foreground'}`}>
          {option === 'full' ? 'Cả ngày' : option === 'morning' ? 'Sáng' : 'Chiều'}
        </button>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl bg-card shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-border p-5">
          <h3 className="text-lg font-black text-foreground">Tạo đơn</h3>
          <button type="button" onClick={onClose} className="rounded-xl p-1.5 hover:bg-muted" aria-label="Đóng"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <p className="mb-2 text-[11px] font-black uppercase text-muted-foreground">1. Loại đơn</p>
            <div className="grid grid-cols-2 gap-2">
              {types.map(item => (
                <button key={item.code} type="button" onClick={() => { setTypeCode(item.code); setSubtype(''); }}
                  className={`rounded-xl border p-2.5 text-left ${typeCode === item.code ? 'border-mint-500 bg-mint-50 dark:bg-mint-900/30' : 'border-border'}`}>
                  <p className="text-xs font-black text-foreground">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground">{PAID_BY_LABEL[item.paidBy]}</p>
                </button>
              ))}
            </div>
            {type?.description && <p className="mt-2 text-[11px] text-muted-foreground">{type.description}</p>}
          </div>

          <div>
            <p className="mb-2 text-[11px] font-black uppercase text-muted-foreground">2. Thời gian</p>
            {isMinute ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-bold text-muted-foreground">Ngày
                  <input type="date" value={start} onChange={event => setStart(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-bold text-muted-foreground">Số phút (tối đa {settings?.lateEarlyMaxMinutes ?? 60})
                  <input type="number" min={1} max={settings?.lateEarlyMaxMinutes ?? 60} value={minutes}
                    onChange={event => setMinutes(Math.max(0, parseInt(event.target.value, 10) || 0))}
                    className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-xs font-bold text-muted-foreground">Từ ngày
                    <input type="date" value={start} onChange={event => { setStart(event.target.value); if (event.target.value > end) setEnd(event.target.value); }}
                      className="mt-1 block rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                  </label>
                  {sessionButtons(startSession, setStartSession, singleDay ? ['full', 'morning', 'afternoon'] : ['full', 'afternoon'])}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-xs font-bold text-muted-foreground">Đến ngày
                    <input type="date" value={end} min={start} onChange={event => setEnd(event.target.value)}
                      className="mt-1 block rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                  </label>
                  {!singleDay && sessionButtons(endSession, setEndSession, ['full', 'morning'])}
                </div>
              </div>
            )}
            {subtypes.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {subtypes.map(item => (
                  <button key={item} type="button" onClick={() => setSubtype(item === subtype ? '' : item)}
                    className={`rounded-full border px-3 py-1 text-[11px] font-bold ${subtype === item ? 'border-mint-500 bg-mint-50 text-mint-700 dark:bg-mint-900/30' : 'border-border text-muted-foreground'}`}>
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-[11px] font-black uppercase text-muted-foreground">3. Lý do</p>
            <textarea value={reason} onChange={event => setReason(event.target.value)} rows={2}
              placeholder={isMinute ? 'Ví dụ: đi xử lý hồ sơ tại sở xây dựng' : 'Ví dụ: về quê có việc gia đình'}
              className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-sm" />
          </div>

          <div className="rounded-2xl border border-border bg-muted/40 p-3">
            {previewError ? (
              <p className="text-xs font-bold text-rose-600">{previewError}</p>
            ) : !preview ? (
              <p className="text-xs text-muted-foreground">Đang tính…</p>
            ) : (
              <div className="space-y-2 text-xs">
                <p className="font-bold text-foreground">
                  {isMinute ? `${minutes} phút` : `${preview.days.toLocaleString('vi-VN')} ngày làm việc`}
                  {' · '}{PAID_BY_LABEL[preview.paidBy]}
                  {preview.annualRemaining !== null && type?.deductsAnnual
                    ? ` · phép còn ${preview.annualRemaining.toLocaleString('vi-VN')} → ${(preview.annualRemaining - preview.days).toLocaleString('vi-VN')} ngày`
                    : ''}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Send size={12} className="text-mint-600" />
                  {preview.steps.map((step, index) => (
                    <React.Fragment key={step.order}>
                      {index > 0 && <ChevronRight size={12} className="text-muted-foreground" />}
                      <span className="rounded-lg bg-card px-2 py-0.5 font-bold text-mint-700 dark:text-mint-300">
                        {step.name} <span className="font-normal text-muted-foreground">({step.label})</span>
                      </span>
                    </React.Fragment>
                  ))}
                </div>
                {preview.problems.map(problem => (
                  <p key={problem} className="flex items-start gap-1 font-bold text-rose-600"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{problem}</p>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-border p-4">
          {preview && preview.problems.length === 0 && blocked && (
            <p className="mb-2 text-xs font-bold text-muted-foreground">
              {typeCode === 'late_early' && !subtype ? 'Chọn đi muộn, về sớm hoặc ra ngoài trong giờ.' : 'Nhập lý do để gửi đơn.'}
            </p>
          )}
          <div className="flex gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-bold text-muted-foreground hover:bg-muted">Đóng</button>
          <button type="button" onClick={() => void submit()} disabled={blocked || sending}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-leaf-600 px-4 py-2.5 text-sm font-black text-white hover:bg-leaf-700 disabled:opacity-40">
            <Send size={16} /> {sending ? 'Đang gửi…' : 'Gửi đơn'}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const PolicyPanel: React.FC<{
  settings: LeaveSettings | null;
  types: LeaveTypeOption[];
  users: Array<{ id: string; name: string }>;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}> = ({ settings, types, users, canEdit, onSaved }) => {
  const toast = useToast();
  const [draft, setDraft] = useState<LeaveSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  if (!draft) return <p className="text-sm text-muted-foreground">Chưa có chính sách.</p>;

  const save = async () => {
    setSaving(true);
    try {
      await leaveService.saveSettings(draft);
      toast.success('Đã lưu chính sách nghỉ');
      await onSaved();
    } catch (error) {
      toast.error('Chưa lưu được', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const toggleType = async (type: LeaveTypeOption) => {
    try {
      await leaveService.setTypeActive(type.code, !type.isActive);
      toast.success(type.isActive ? `Đã tắt "${type.name}"` : `Đã bật "${type.name}"`);
      await onSaved();
    } catch (error) {
      toast.error('Chưa cập nhật được', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    }
  };

  const field = 'mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm disabled:opacity-60';
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-black text-foreground">Quy tắc duyệt</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Bước 1 tự xác định: nhân sự công trường → người duyệt của công trường; còn lại → quản lý trong sơ đồ tổ chức
          (nếu chưa có thì quản lý trực tiếp của tài khoản, cuối cùng là phòng HCNS). Bước 2 thêm cho loại đơn có đánh dấu khi vượt ngưỡng ngày.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold text-muted-foreground">Thêm bước 2 khi đơn dài hơn (ngày làm việc)
            <input type="number" min={0} step={0.5} disabled={!canEdit} value={draft.secondStepThresholdDays}
              onChange={event => setDraft({ ...draft, secondStepThresholdDays: Number(event.target.value) || 0 })} className={field} />
          </label>
          <label className="text-xs font-bold text-muted-foreground">Người duyệt bước 2
            <select disabled={!canEdit} value={draft.secondStepApproverUserId || ''}
              onChange={event => setDraft({ ...draft, secondStepApproverUserId: event.target.value || null })} className={field}>
              <option value="">— Không có bước 2 —</option>
              {users.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-muted-foreground">Tên bước 2
            <input disabled={!canEdit} value={draft.secondStepLabel} onChange={event => setDraft({ ...draft, secondStepLabel: event.target.value })} className={field} />
          </label>
          <label className="text-xs font-bold text-muted-foreground">Đi muộn / về sớm tối đa mỗi lần (phút)
            <input type="number" min={5} max={480} disabled={!canEdit} value={draft.lateEarlyMaxMinutes}
              onChange={event => setDraft({ ...draft, lateEarlyMaxMinutes: Number(event.target.value) || 60 })} className={field} />
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground sm:col-span-2">
            <input type="checkbox" disabled={!canEdit} checked={draft.saturdayIsWorkday} onChange={event => setDraft({ ...draft, saturdayIsWorkday: event.target.checked })} />
            Thứ Bảy là ngày làm việc (tính vào số ngày nghỉ)
          </label>
        </div>
        {canEdit ? (
          <button type="button" onClick={() => void save()} disabled={saving}
            className="mt-3 rounded-xl bg-leaf-600 px-4 py-2 text-xs font-black text-white hover:bg-leaf-700 disabled:opacity-50">
            {saving ? 'Đang lưu…' : 'Lưu chính sách'}
          </button>
        ) : <p className="mt-3 text-xs text-muted-foreground">Chỉ HR Manage được sửa.</p>}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-black text-foreground">Loại đơn</h3>
        <div className="divide-y divide-border">
          {types.filter(type => type.code !== 'other').map(type => (
            <div key={type.code} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">{type.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {PAID_BY_LABEL[type.paidBy]}{type.deductsAnnual ? ' · trừ phép năm' : ''}{type.needsSecondStep ? ' · có bước 2 khi vượt ngưỡng' : ''}{type.unit === 'minute' ? ' · tính theo phút' : ''}
                </p>
              </div>
              <span className={`rounded-lg px-2 py-1 text-[11px] font-black ${type.isActive ? 'bg-leaf-50 text-leaf-700 dark:bg-leaf-900/30 dark:text-leaf-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                {type.isActive ? 'Đang dùng' : 'Đã tắt'}
              </span>
              {canEdit && (
                <button type="button" onClick={() => void toggleType(type)} className="rounded-xl border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground hover:bg-muted">
                  {type.isActive ? 'Tắt' : 'Bật'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock size={12} /> Phép năm cộng 1 ngày vào mùng 1 hằng tháng (trừ nhân sự thử việc). HR sửa trực tiếp số phép còn lại trong hồ sơ nhân sự.</p>
    </div>
  );
};

export default LeaveManagement;
