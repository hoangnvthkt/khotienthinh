import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlarmClock, Check, ExternalLink, FilePenLine, FileText, Loader2, RefreshCw, Search, UserCheck, X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { canPerformHrmTemplatePermission } from '../../lib/permissions/permissionService';
import { EDITOR_META, describePayload, type ProfileEditorKind } from '../../lib/hrmProfileFields';
import {
  hrmProfileChangeService,
  type DirectManagerRow, type HrReminder, type ProfileChangeRequest,
} from '../../lib/hrmProfileChangeService';
import { ProfileFieldInput } from './ProfileChangeRequestDialog';

type Tab = 'changes' | 'reminders' | 'managers';

const REMINDER_META: Record<HrReminder['kind'], { label: string; section: string }> = {
  contract: { label: 'Hợp đồng', section: 'contracts_employment' },
  probation: { label: 'Thử việc', section: 'contracts_employment' },
  identity: { label: 'Giấy tờ', section: 'legal_insurance' },
  certification: { label: 'Chứng chỉ', section: 'qualifications_documents' },
};

const SOURCE_META: Record<DirectManagerRow['source'], { label: string; className: string }> = {
  org_chart: { label: 'Sơ đồ tổ chức', className: 'bg-mint-50 text-mint-700 dark:bg-mint-900/30 dark:text-mint-300' },
  designated: { label: 'HR chỉ định', className: 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300' },
  none: { label: 'Chưa có', className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' },
};

const formatDate = (value: string) => value.slice(0, 10).split('-').reverse().join('/');
const timeAgo = (value: string) => {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  return days <= 0 ? 'hôm nay' : `${days} ngày trước`;
};
const daysChip = (daysLeft: number) => daysLeft < 0
  ? { text: `Quá hạn ${-daysLeft} ngày`, className: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300' }
  : daysLeft === 0
    ? { text: 'Hôm nay', className: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300' }
    : { text: `Còn ${daysLeft} ngày`, className: daysLeft <= 7 ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' };

/** HR review of one change request: check the photos, fix a typo if needed, approve or reject. */
const ChangeReviewDrawer: React.FC<{
  request: ProfileChangeRequest;
  isOwn: boolean;
  canApprovePay: boolean;
  onClose: () => void;
  onDecided: () => void;
}> = ({ request, isOwn, canApprovePay, onClose, onDecided }) => {
  const navigate = useNavigate();
  const editable = request.status === 'pending';
  const fields = request.kind !== 'other' ? EDITOR_META[request.kind as ProfileEditorKind].fields : [];
  const [form, setForm] = useState<Record<string, unknown>>(() => ({
    ...(request.kind === 'identity' ? { isPrimary: true } : {}),
    ...(request.kind === 'bank' ? { isPayrollAccount: true } : {}),
    ...request.payload,
  }));
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<Array<{ path: string; url: string | null; isPdf: boolean }> | null>(null);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState('');
  const blockedReason = isOwn ? 'Đây là đề nghị của chính bạn, nhờ HR khác duyệt.'
    : request.needsCompensationManager && !canApprovePay ? 'Tài khoản ngân hàng và thuế cần HR Manage duyệt.' : '';

  useEffect(() => {
    void hrmProfileChangeService.attachmentUrls(request.attachmentPaths).then(setFiles).catch(() => setFiles([]));
  }, [request.attachmentPaths]);

  const decide = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'reject');
    setError('');
    try {
      await hrmProfileChangeService.decide(request.id, approve, note, request.kind === 'other' ? null : form);
      onDecided();
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : 'Không lưu được quyết định.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex justify-end bg-slate-950/50" role="dialog" aria-modal="true" aria-label="Duyệt đề nghị cập nhật">
      <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-mint-700 dark:text-mint-300">{request.kindLabel}</p>
            <h2 className="truncate text-lg font-black text-slate-950 dark:text-white">{request.fullName}</h2>
            <p className="text-xs font-semibold text-slate-500">{[request.employeeCode, request.orgUnitName].filter(Boolean).join(' · ')} · gửi {timeAgo(request.createdAt)}</p>
          </div>
          <button type="button" onClick={() => navigate(`/ep/${request.employeeId}`)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Mở hồ sơ hiện tại" aria-label="Mở hồ sơ hiện tại">
            <ExternalLink size={17} />
          </button>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Đóng"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {request.note && (
            <div className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <p className="mb-0.5 text-xs font-bold text-slate-500">Nhân viên ghi chú</p>{request.note}
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-black text-slate-800 dark:text-white">Ảnh giấy tờ</p>
            {files === null ? <Loader2 className="animate-spin text-slate-400" size={16} />
              : files.length === 0 ? <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Không có ảnh đính kèm, cần đối chiếu bản gốc.</p>
              : (
                <div className="grid grid-cols-2 gap-2">
                  {files.map(file => (
                    <a key={file.path} href={file.url || undefined} target="_blank" rel="noreferrer"
                      className="block aspect-[4/3] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                      {file.isPdf || !file.url
                        ? <span className="flex h-full items-center justify-center gap-2 text-sm font-bold text-slate-500"><FileText size={18} /> {file.url ? 'Mở PDF' : 'Không tải được'}</span>
                        : <img src={file.url} alt="Giấy tờ đính kèm" className="h-full w-full object-cover" />}
                    </a>
                  ))}
                </div>
              )}
          </div>

          {fields.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-black text-slate-800 dark:text-white">{editable ? 'Thông tin sẽ ghi vào hồ sơ' : 'Thông tin đã ghi'}</p>
              {editable ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {fields.map(field => (
                    <ProfileFieldInput key={field.key} field={field} value={form[field.key]}
                      onChange={value => setForm(current => ({ ...current, [field.key]: value }))} />
                  ))}
                </div>
              ) : (
                <dl className="grid gap-2 sm:grid-cols-2">
                  {describePayload(request.kind, request.payload).map(([label, value]) => (
                    <div key={label}><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className="text-sm font-bold text-slate-800 dark:text-slate-100">{value}</dd></div>
                  ))}
                </dl>
              )}
              {editable && <p className="mt-2 text-xs font-medium text-slate-500">Sửa được lỗi gõ trước khi duyệt. Hệ thống ghi lại người duyệt và giá trị cuối cùng.</p>}
            </div>
          )}
          {request.kind === 'other' && editable && (
            <p className="rounded-xl bg-sky-50 p-3 text-sm font-semibold text-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
              Mục "Thông tin khác": sửa hồ sơ bằng tay theo nội dung trên, rồi bấm "Đã cập nhật" để báo nhân viên.
            </p>
          )}

          {!editable ? (
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              {request.status === 'approved' ? 'Đã duyệt' : request.status === 'rejected' ? 'Đã từ chối' : 'Nhân viên đã hủy'}
              {request.decidedByName ? ` bởi ${request.decidedByName}` : ''}{request.decisionNote ? `: ${request.decisionNote}` : ''}
            </p>
          ) : (
            <label className="block space-y-2">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Ghi chú cho nhân viên</span>
              <textarea value={note} onChange={event => setNote(event.target.value)} rows={2} placeholder="Bắt buộc khi từ chối, ví dụ: Ảnh mờ, chụp lại mặt sau"
                className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-mint-600 focus:ring-2 focus:ring-mint-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
            </label>
          )}
          {(error || (editable && blockedReason)) && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{error || blockedReason}</p>
          )}
        </div>

        {editable && (
          <div className="flex gap-2 border-t border-slate-100 p-4 dark:border-slate-800">
            <button type="button" onClick={() => void decide(false)} disabled={busy !== null || isOwn || note.trim().length < 5}
              title={note.trim().length < 5 ? 'Ghi lý do từ chối trước' : undefined}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-3 text-sm font-black text-rose-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-900 dark:text-rose-300">
              {busy === 'reject' ? <Loader2 className="animate-spin" size={15} /> : <X size={15} />} Từ chối
            </button>
            <button type="button" onClick={() => void decide(true)} disabled={busy !== null || Boolean(blockedReason)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-mint-600 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]">
              {busy === 'approve' ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
              {request.kind === 'other' ? 'Đã cập nhật' : 'Duyệt & ghi vào hồ sơ'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/** Inline "who approves this person" designation for people the org chart does not cover. */
const DesignateManager: React.FC<{ row: DirectManagerRow; onSaved: () => void; onCancel: () => void }> = ({ row, onSaved, onCancel }) => {
  const { users, employees } = useApp();
  const employeeUserId = employees.find(employee => employee.id === row.employeeId)?.userId;
  const candidates = useMemo(() => users
    .filter(user => user.isActive !== false && (user.accountStatus || 'ACTIVE') === 'ACTIVE' && user.id !== employeeUserId)
    .sort((a, b) => a.name.localeCompare(b.name, 'vi')), [users, employeeUserId]);
  const [managerId, setManagerId] = useState(row.designatedManagerUserId || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await hrmProfileChangeService.setDesignatedManager(row.employeeId, managerId || null, 'Chỉ định quản lý trực tiếp theo phân công thực tế');
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được người duyệt.');
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70">
      <div className="flex flex-col gap-2 sm:flex-row">
        <select value={managerId} onChange={event => setManagerId(event.target.value)} aria-label="Người quản lý trực tiếp"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-mint-600 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
          <option value="">— Chưa chỉ định —</option>
          {candidates.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">Hủy</button>
          <button type="button" onClick={() => void save()} disabled={saving || managerId === (row.designatedManagerUserId || '')}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-mint-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40">
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />} Lưu
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs font-bold text-rose-600">{error}</p>}
    </div>
  );
};

/** HR to-do for profiles: change requests to approve, documents expiring, people without an approver. */
const HrmWorkQueuePanel: React.FC = () => {
  const navigate = useNavigate();
  const { user, employees } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('work') as Tab | null;
  const [tab, setTab] = useState<Tab | null>(requestedTab && ['changes', 'reminders', 'managers'].includes(requestedTab) ? requestedTab : null);
  const [changes, setChanges] = useState<ProfileChangeRequest[] | null>(null);
  const [doneChanges, setDoneChanges] = useState<ProfileChangeRequest[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [reminders, setReminders] = useState<HrReminder[] | null>(null);
  const [managers, setManagers] = useState<DirectManagerRow[] | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Tab, string>>>({});
  const [reviewing, setReviewing] = useState<ProfileChangeRequest | null>(null);
  const [managerFilter, setManagerFilter] = useState<'none' | 'all'>('none');
  const [managerSearch, setManagerSearch] = useState('');
  const [designating, setDesignating] = useState<string | null>(null);
  const canApprovePay = canPerformHrmTemplatePermission(user, 'hrm.compensation.manage');
  const ownEmployeeId = employees.find(employee => employee.userId === user?.id)?.id;

  const capture = useCallback(async <T,>(key: Tab, task: () => Promise<T>, set: (value: T) => void) => {
    try {
      set(await task());
      setErrors(current => ({ ...current, [key]: '' }));
    } catch (error) {
      setErrors(current => ({ ...current, [key]: error instanceof Error ? error.message : 'Không tải được.' }));
    }
  }, []);

  const loadChanges = useCallback(() => capture('changes', () => hrmProfileChangeService.listForHr('pending'), setChanges), [capture]);
  const loadManagers = useCallback(() => capture('managers', () => hrmProfileChangeService.listDirectManagers(), setManagers), [capture]);
  const loadAll = useCallback(() => {
    void loadChanges();
    void capture('reminders', () => hrmProfileChangeService.listReminders(45), setReminders);
    void loadManagers();
  }, [capture, loadChanges, loadManagers]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => {
    if (showDone && doneChanges === null) void capture('changes', () => hrmProfileChangeService.listForHr('done'), setDoneChanges);
  }, [capture, doneChanges, showDone]);

  const selectTab = (next: Tab) => {
    const value = tab === next ? null : next;
    setTab(value);
    const params = new URLSearchParams(searchParams);
    if (value) params.set('work', value); else params.delete('work');
    setSearchParams(params, { replace: true });
  };

  const withoutManager = managers?.filter(row => row.source === 'none').length;
  const urgentReminders = reminders?.filter(item => item.daysLeft <= 7).length;
  const tiles: Array<{ key: Tab; icon: typeof FilePenLine; title: string; value: string; detail: string; alert: boolean }> = [
    { key: 'changes', icon: FilePenLine, title: 'Đề nghị cập nhật',
      value: changes ? String(changes.length) : '…', detail: 'chờ HR duyệt', alert: Boolean(changes?.length) },
    { key: 'reminders', icon: AlarmClock, title: 'Sắp đến hạn',
      value: reminders ? String(reminders.length) : '…', detail: urgentReminders ? `${urgentReminders} mục trong 7 ngày` : 'trong 45 ngày tới', alert: Boolean(urgentReminders) },
    { key: 'managers', icon: UserCheck, title: 'Chưa có quản lý trực tiếp',
      value: managers ? String(withoutManager) : '…', detail: managers ? `trên ${managers.length} nhân sự` : 'đang kiểm tra', alert: Boolean(withoutManager) },
  ];

  const visibleManagers = (managers || []).filter(row =>
    (managerFilter === 'all' || row.source === 'none')
    && (!managerSearch.trim() || `${row.fullName} ${row.employeeCode || ''} ${row.orgUnitName || ''}`.toLowerCase().includes(managerSearch.trim().toLowerCase())));
  const changeRows = showDone ? doneChanges : changes;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-2 px-4 pt-4">
        <p className="flex-1 text-sm font-black text-slate-800 dark:text-white">Việc hồ sơ cần xử lý</p>
        <button type="button" onClick={loadAll} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Tải lại">
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="grid gap-2 p-4 sm:grid-cols-3">
        {tiles.map(tile => {
          const Icon = tile.icon;
          const active = tab === tile.key;
          return (
            <button key={tile.key} type="button" onClick={() => selectTab(tile.key)} aria-expanded={active}
              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[0.99] ${active
                ? 'border-mint-500 bg-mint-50 dark:border-mint-700 dark:bg-mint-900/20'
                : 'border-slate-200 hover:border-mint-300 dark:border-slate-700'}`}>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tile.alert ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-mint-100 text-mint-700 dark:bg-mint-900/40 dark:text-mint-300'}`}>
                <Icon size={19} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-500">{tile.title}</p>
                <p className="truncate text-sm font-semibold text-slate-500">
                  <span className="mr-1 text-xl font-black text-slate-900 dark:text-white">{errors[tile.key] ? '!' : tile.value}</span>{tile.detail}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {tab && (
        <div className="border-t border-slate-100 p-4 dark:border-slate-800">
          {errors[tab] && <p className="mb-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{errors[tab]}</p>}

          {tab === 'changes' && (
            <>
              <div className="mb-3 flex gap-1.5">
                {([['pending', 'Chờ duyệt'], ['done', 'Đã xử lý']] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setShowDone(key === 'done')}
                    className={`rounded-full px-3 py-1 text-[11px] font-bold ${(key === 'done') === showDone ? 'bg-mint-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {changeRows === null ? <p className="py-6 text-center text-sm text-slate-500">Đang tải…</p>
                : changeRows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">{showDone ? 'Chưa có đề nghị nào được xử lý.' : 'Không có đề nghị nào chờ duyệt. Nhân viên gửi từ "Hồ sơ của tôi".'}</p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {changeRows.map(row => (
                      <button key={row.id} type="button" onClick={() => setReviewing(row)} className="flex w-full items-start gap-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-mint-700 dark:text-mint-300">{row.fullName} <span className="font-mono text-[11px] text-slate-400">{row.employeeCode}</span></p>
                          <p className="truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
                            <span className="font-black">{row.kindLabel}</span> · {describePayload(row.kind, row.payload).slice(0, 2).map(([, value]) => value).join(' · ') || row.note || '—'}
                          </p>
                        </div>
                        <div className="shrink-0 text-right text-[11px] font-semibold text-slate-500">
                          <p>{showDone ? (row.status === 'approved' ? 'Đã duyệt' : row.status === 'rejected' ? 'Từ chối' : 'Đã hủy') : timeAgo(row.createdAt)}</p>
                          {row.attachmentPaths.length > 0 && <p>{row.attachmentPaths.length} ảnh</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
            </>
          )}

          {tab === 'reminders' && (
            reminders === null ? <p className="py-6 text-center text-sm text-slate-500">Đang tải…</p>
              : reminders.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  Không có hợp đồng, giấy tờ, chứng chỉ hay kỳ thử việc nào đến hạn trong 45 ngày tới.
                  <span className="mt-1 block text-xs">Hệ thống chỉ nhắc được khi hồ sơ đã nhập ngày hết hạn.</span>
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {reminders.map(item => {
                    const chip = daysChip(item.daysLeft);
                    return (
                      <button key={`${item.kind}-${item.recordId}`} type="button" onClick={() => navigate(`/ep/${item.employeeId}?section=${REMINDER_META[item.kind].section}`)}
                        className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <span className="w-20 shrink-0 text-[11px] font-black uppercase tracking-wide text-slate-400">{REMINDER_META[item.kind].label}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-slate-800 dark:text-white">{item.fullName}</p>
                          <p className="truncate text-xs font-semibold text-slate-500">{item.label} · {formatDate(item.dueDate)}</p>
                        </div>
                        <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-black ${chip.className}`}>{chip.text}</span>
                      </button>
                    );
                  })}
                </div>
              )
          )}

          {tab === 'managers' && (
            <>
              <p className="mb-3 text-xs font-medium text-slate-500">
                Người duyệt lấy từ sơ đồ tổ chức (trưởng đơn vị). Ai chưa nằm trên sơ đồ thì HR chỉ định riêng. Dùng chung cho nghỉ phép, Yêu cầu và đặt xe; nhân sự công trường nghỉ phép do người duyệt của công trường duyệt.
              </p>
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {([['none', `Chưa có · ${withoutManager ?? '…'}`], ['all', 'Tất cả']] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setManagerFilter(key)}
                    className={`rounded-full px-3 py-1 text-[11px] font-bold ${managerFilter === key ? 'bg-mint-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                    {label}
                  </button>
                ))}
                <div className="relative ml-auto w-full sm:w-56">
                  <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
                  <input value={managerSearch} onChange={event => setManagerSearch(event.target.value)} placeholder="Tìm tên, đơn vị"
                    className="w-full rounded-full border border-slate-200 bg-white py-1.5 pl-7 pr-3 text-xs font-semibold outline-none focus:border-mint-500 dark:border-slate-700 dark:bg-slate-800" />
                </div>
              </div>
              {managers === null ? <p className="py-6 text-center text-sm text-slate-500">Đang tải…</p>
                : visibleManagers.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">{managerFilter === 'none' ? 'Mọi nhân sự đã có người duyệt.' : 'Không tìm thấy nhân sự.'}</p>
                : (
                  <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                    {visibleManagers.map(row => (
                      <div key={row.employeeId} className="py-2.5">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-slate-800 dark:text-white">{row.fullName} <span className="font-mono text-[11px] text-slate-400">{row.employeeCode}</span></p>
                            <p className="truncate text-[11px] text-slate-500">{[row.orgUnitName || 'Chưa có đơn vị', row.positionName].filter(Boolean).join(' · ')}</p>
                            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${SOURCE_META[row.source].className}`}>{SOURCE_META[row.source].label}</span>
                              {row.managerName || 'Chưa có quản lý trực tiếp'}
                            </p>
                            {row.leaveApproverLabel && (!row.leaveApproverName || row.leaveApproverName !== row.managerName) && (
                              <p className="mt-0.5 text-[11px] text-slate-500">
                                Duyệt nghỉ phép: {row.leaveApproverName ? `${row.leaveApproverName} (${row.leaveApproverLabel})` : `${row.leaveApproverLabel} (tạm thời)`}
                              </p>
                            )}
                          </div>
                          {!row.hasAccount ? (
                            <span className="shrink-0 text-[11px] font-semibold text-slate-400">Chưa có tài khoản</span>
                          ) : row.source === 'org_chart' ? (
                            <button type="button" onClick={() => navigate('/settings/hrm-shared-catalog')} className="shrink-0 text-[11px] font-bold text-mint-700 hover:underline dark:text-mint-300">Sửa sơ đồ</button>
                          ) : designating !== row.employeeId && (
                            <button type="button" onClick={() => setDesignating(row.employeeId)}
                              className="shrink-0 rounded-lg border border-mint-200 px-2.5 py-1 text-xs font-black text-mint-700 hover:bg-mint-50 dark:border-mint-800 dark:text-mint-300">
                              {row.source === 'none' ? 'Chỉ định' : 'Đổi'}
                            </button>
                          )}
                        </div>
                        {designating === row.employeeId && (
                          <DesignateManager row={row} onCancel={() => setDesignating(null)}
                            onSaved={() => { setDesignating(null); void loadManagers(); }} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
            </>
          )}
        </div>
      )}

      {reviewing && (
        <ChangeReviewDrawer
          request={reviewing}
          isOwn={reviewing.employeeId === ownEmployeeId}
          canApprovePay={canApprovePay}
          onClose={() => setReviewing(null)}
          onDecided={() => { setReviewing(null); setDoneChanges(null); void loadChanges(); }}
        />
      )}
    </section>
  );
};

export default HrmWorkQueuePanel;
