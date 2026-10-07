import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, BookOpenCheck, CalendarOff, CheckCircle2, ChevronRight, FileText, Inbox, Paperclip, Plus, RefreshCw,
  Send, Settings2, UserCheck, Users, X, XCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useToast } from '../../context/ToastContext';
import { useReasonConfirm } from '../../context/ConfirmContext';
import { canPerformHrmTemplatePermission } from '../../lib/permissions/permissionService';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import {
  currentLeaveStep, LEAVE_MAX_ATTACHMENTS, LeaveLedgerBalance, LeaveLogRow, LeavePreview, LeaveRequestRow, leaveService, LeaveSession,
  LeaveSettings, LeaveStatus, LeaveTypeOption,
} from '../../lib/leaveService';
import { PAID_BY_LABEL, subtypeProblem } from '../../lib/leavePolicy';
import LeavePolicySettings, { type LeaveTypeUsage } from '../../components/hrm/LeavePolicySettings';
import LeaveLedgerDrawer from '../../components/hrm/LeaveLedgerDrawer';
import LeaveBalancesPanel from '../../components/hrm/LeaveBalancesPanel';
import LeaveCreateDialog from '../../components/hrm/LeaveCreateDialog';

type Tab = 'mine' | 'approve' | 'all' | 'balances' | 'policy';

const STATUS: Record<LeaveStatus, { label: string; tone: string }> = {
  pending: { label: 'Chờ duyệt', tone: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' },
  approved: { label: 'Đã duyệt', tone: 'bg-leaf-50 text-leaf-700 dark:bg-leaf-900/30 dark:text-leaf-300' },
  rejected: { label: 'Từ chối', tone: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300' },
  cancelled: { label: 'Đã hủy', tone: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};
const SESSION_LABEL: Record<LeaveSession, string> = { full: 'cả ngày', morning: 'buổi sáng', afternoon: 'buổi chiều' };
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

  const [tab, setTab] = useState<Tab>(() => {
    const value = searchParams.get('tab');
    return value === 'balances' || value === 'policy' ? value : 'mine';
  });
  const [requests, setRequests] = useState<LeaveRequestRow[]>([]);
  const [types, setTypes] = useState<LeaveTypeOption[]>([]);
  const [settings, setSettings] = useState<LeaveSettings | null>(null);
  const [balance, setBalance] = useState<LeaveLedgerBalance | null | undefined>(undefined);
  const [ledgerOpen, setLedgerOpen] = useState(false);
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
      if (me) setBalance((await leaveService.ledger(me.id, new Date().getFullYear())).balance);
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

  const usage = useMemo(() => {
    const result: Record<string, LeaveTypeUsage> = {};
    for (const request of requests) {
      const row = result[request.type] || (result[request.type] = { total: 0, pending: 0 });
      row.total += 1;
      if (request.status === 'pending') row.pending += 1;
    }
    return result;
  }, [requests]);

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

  const remaining = balance ? balance.availableDays - pendingAnnual : null;

  const tabs: Array<{ id: Tab; label: string; count?: number; icon: typeof Inbox; show: boolean }> = [
    { id: 'mine', label: 'Đơn của tôi', count: mine.filter(request => request.status === 'pending').length, icon: CalendarOff, show: true },
    { id: 'approve', label: 'Chờ tôi duyệt', count: toApprove.length, icon: UserCheck, show: true },
    { id: 'all', label: 'Toàn công ty', icon: Users, show: isHr },
    { id: 'balances', label: 'Số phép', icon: BookOpenCheck, show: isHr },
    { id: 'policy', label: 'Thiết lập', icon: Settings2, show: isHr || canManagePolicy },
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
        <button type="button" onClick={() => me && setLedgerOpen(true)} disabled={!me} title="Xem sổ phép"
          className="rounded-2xl bg-mint-50 p-3 sm:p-4 text-left dark:bg-mint-900/20">
          <p className="text-[10px] sm:text-[11px] font-black uppercase text-mint-700 dark:text-mint-300">Phép còn lại</p>
          <p className="text-lg sm:text-2xl font-black text-mint-700 dark:text-mint-300">
            {balance === undefined ? '…' : remaining === null ? 'Chưa có' : `${remaining.toLocaleString('vi-VN')} ngày`}
          </p>
          <p className="hidden text-[11px] text-muted-foreground sm:block">
            {balance === null ? 'HR chưa thiết lập số phép năm nay cho bạn.'
              : balance && balance.carryLeft > 0 && balance.carryExpiresOn ? `Gồm ${balance.carryLeft.toLocaleString('vi-VN')} ngày phép tồn, dùng đến ${formatDate(balance.carryExpiresOn)}`
              : pendingAnnual > 0 ? `Đã trừ ${pendingAnnual} ngày đang chờ duyệt` : 'Cộng 1 ngày vào mùng 1 hằng tháng'}
          </p>
          {me && <p className="mt-1 text-[11px] font-bold text-mint-700 underline-offset-2 hover:underline dark:text-mint-300">Xem sổ phép</p>}
        </button>
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

      {loadError && tab !== 'policy' && <p className="text-sm font-bold text-rose-600">{loadError}</p>}

      {tab === 'balances' ? (
        <LeaveBalancesPanel ownEmployeeId={me?.id} />
      ) : tab === 'policy' ? (
        <LeavePolicySettings settings={settings} types={types} users={users.filter(item => item.isActive !== false)} usage={usage}
          canEdit={canManagePolicy} loading={loading} error={loadError} onChanged={load} />
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

      {ledgerOpen && me && (
        <LeaveLedgerDrawer employeeId={me.id} employeeName={me.fullName} year={new Date().getFullYear()} canAdjust={false} onClose={() => setLedgerOpen(false)} />
      )}

      {showCreate && me && (
        <LeaveCreateDialog
          employeeId={me.id}
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
  const [papers, setPapers] = useState<Array<{ path: string; url: string | null; isPdf: boolean }> | null>(null);
  useEffect(() => {
    leaveService.listLogs(request.id).then(setLogs).catch(() => setLogs([]));
  }, [request.id, request.status, request.currentStep]);
  useEffect(() => {
    setPapers(null);
    leaveService.attachmentUrls(request.attachmentPaths).then(setPapers).catch(() => setPapers([]));
  }, [request.attachmentPaths]);

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
            {request.minutes === null && <p className="text-muted-foreground">{request.totalDays.toLocaleString('vi-VN')} ngày làm việc{request.subtype ? ` · ${request.subtype}` : ''}</p>}
            <p className="mt-2 text-foreground">{request.reason}</p>
            {request.rejectionReason && <p className="mt-2 font-bold text-rose-600">Lý do từ chối: {request.rejectionReason}</p>}
            {request.cancelReason && <p className="mt-2 text-muted-foreground">Lý do hủy: {request.cancelReason}</p>}
          </div>

          {request.attachmentPaths.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-black uppercase text-muted-foreground">Giấy tờ đính kèm</p>
              {papers === null ? <p className="text-xs text-muted-foreground">Đang tải…</p> : (
                <div className="flex flex-wrap gap-2">
                  {papers.map((paper, index) => paper.url ? (
                    <a key={paper.path} href={paper.url} target="_blank" rel="noreferrer"
                      className="block overflow-hidden rounded-xl border border-border hover:ring-2 hover:ring-mint-500/40">
                      {paper.isPdf
                        ? <span className="flex h-20 w-20 flex-col items-center justify-center gap-1 text-xs font-bold text-mint-700"><FileText size={22} />PDF {index + 1}</span>
                        : <img src={paper.url} alt={`Giấy tờ ${index + 1}`} className="h-20 w-20 object-cover" />}
                    </a>
                  ) : (
                    <span key={paper.path} className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-border text-center text-[10px] text-muted-foreground">Không mở được</span>
                  ))}
                </div>
              )}
            </div>
          )}

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

export default LeaveManagement;
