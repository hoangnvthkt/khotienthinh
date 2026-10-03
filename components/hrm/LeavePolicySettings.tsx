import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Banknote, ChevronDown, FileCheck2, History, ListChecks, Lock, Pencil, Plus, Power, Search, Settings2, ShieldCheck, Trash2, UserCheck, X,
} from 'lucide-react';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import {
  leaveService, type LeavePolicyLogRow, type LeaveSettings, type LeaveTypeDraft, type LeaveTypeOption,
} from '../../lib/leaveService';
import {
  approvalExample, approvalSteps, draftOf, emptyDraft, LEAVE_PAID_BY_LOCKED, LEAVE_SUBTYPES_LOCKED, leaveDraftProblems,
  normalizeDraft, PAID_BY_LABEL, sameDraft, subtypeSummary,
} from '../../lib/leavePolicy';
import { Badge, Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';

// Thiết lập nghỉ phép: HR Manage / Admin decide which leave types staff can pick, who approves,
// the reasons with their day limits and the papers to attach. Changes apply to new requests only.

export interface LeaveTypeUsage { total: number; pending: number }

const ENT = 'font-semibold text-mint-700 dark:text-mint-300';
const NUM = 'font-semibold tabular-nums text-leaf-700 dark:text-leaf-300';
const PAID_STYLE: Record<LeaveTypeOption['paidBy'], { strip: string; badge: string }> = {
  company: { strip: 'border-l-leaf-500', badge: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200' },
  social_insurance: { strip: 'border-l-teal-500', badge: 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200' },
  none: { strip: 'border-l-amber-400', badge: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200' },
};
const OFF_BADGE = 'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400';
const FIELD_LABEL: Record<string, string> = {
  name: 'Tên', description: 'Mô tả', paidBy: 'Hưởng lương', secondStepAfterDays: 'Ngưỡng thêm bước duyệt', hrStep: 'HCNS kiểm tra',
  requiresOfficial: 'Chỉ nhân sự chính thức', subtypes: 'Lý do con', requiresAttachment: 'Bắt buộc đính kèm', attachmentHint: 'Giấy tờ cần nộp',
  secondStepApproverUserId: 'Người duyệt bước 2', secondStepLabel: 'Tên bước 2', lateEarlyMaxMinutes: 'Đi muộn / về sớm tối đa',
  saturdayIsWorkday: 'Thứ Bảy làm việc', isActive: 'Trạng thái',
};
const LOG_ACTION: Record<LeavePolicyLogRow['action'], string> = { create: 'tạo', update: 'sửa', activate: 'bật lại', deactivate: 'tắt' };

const Switch: React.FC<{ checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; label: string }> = ({ checked, disabled, onChange, label }) =>
  <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-leaf-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
  </button>;

const Section: React.FC<{ n: number; icon: React.ElementType; title: string; hint?: string; children: React.ReactNode }> = ({ n, icon: Icon, title, hint, children }) =>
  <section className="rounded-2xl border border-border bg-card p-4">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-mint-100 text-xs font-bold text-mint-800 dark:bg-mint-900/50 dark:text-mint-200">{n}</span>
      <Icon size={15} className="text-teal-600" />{title}
    </h3>
    {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    <div className="mt-3 space-y-3">{children}</div>
  </section>;

const LockNote: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Lock size={12} className="mt-0.5 shrink-0" />{children}</p>;

const formatValue = (key: string, value: unknown, userName: (id: string | null) => string): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (key === 'paidBy') return PAID_BY_LABEL[value as LeaveTypeOption['paidBy']] || String(value);
  if (key === 'secondStepApproverUserId') return userName(String(value)) || 'Người dùng đã xóa';
  if (key === 'subtypes' && Array.isArray(value)) {
    return value.map(item => `${item.name}${item.maxDays ? ` (${item.maxDays} ngày)` : ''}`).join(', ') || '—';
  }
  if (key === 'secondStepAfterDays') return `> ${value} ngày`;
  if (key === 'lateEarlyMaxMinutes') return `${value} phút`;
  return String(value);
};

const HistoryList: React.FC<{ rows: LeavePolicyLogRow[]; typeName: (code: string) => string; userName: (id: string | null) => string; showTarget?: boolean }> = ({ rows, typeName, userName, showTarget }) =>
  rows.length === 0 ? <p className="text-xs text-muted-foreground">Chưa có thay đổi nào được ghi lại.</p>
    : <ol className="space-y-2">{rows.map(row => <li key={row.id} className="rounded-xl border border-border px-3 py-2 text-xs">
      <p><span className={ENT}>{row.actorName || 'Hệ thống'}</span> {LOG_ACTION[row.action]}{showTarget && <> <span className="font-semibold text-foreground">{row.target === 'settings' ? 'quy tắc chung' : typeName(row.target)}</span></>}
        <span className="text-muted-foreground"> · {new Date(row.createdAt).toLocaleString('vi-VN')}</span></p>
      {Object.entries(row.changes || {}).filter(([key]) => key !== 'isActive').map(([key, change]) => <p key={key} className="mt-0.5 text-muted-foreground">
        {FIELD_LABEL[key] || key}: <span className="line-through">{formatValue(key, change.from, userName)}</span> → <span className="text-foreground">{formatValue(key, change.to, userName)}</span>
      </p>)}
    </li>)}</ol>;

// ---------------------------------------------------------------------------
// Drawer: create or edit one leave type.
// ---------------------------------------------------------------------------
const TypeDrawer: React.FC<{
  type: LeaveTypeOption | null;
  allTypes: LeaveTypeOption[];
  settings: LeaveSettings;
  approverName: string;
  usage: LeaveTypeUsage;
  canEdit: boolean;
  history: LeavePolicyLogRow[];
  userName: (id: string | null) => string;
  onClose: () => void;
  onSaved: (code: string) => Promise<void>;
}> = ({ type, allTypes, settings, approverName, usage, canEdit, history, userName, onClose, onSaved }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const initial = useMemo(() => type ? draftOf(type) : emptyDraft(), [type]);
  const [draft, setDraft] = useState<LeaveTypeDraft>(initial);
  const [saving, setSaving] = useState(false);
  const unit = type?.unit || 'day';
  const paidLocked = !!type && LEAVE_PAID_BY_LOCKED.has(type.code);
  const subtypesLocked = !!type && LEAVE_SUBTYPES_LOCKED.has(type.code);
  const problems = leaveDraftProblems(draft, unit, allTypes.filter(item => item.code !== type?.code).map(item => item.name));
  const dirty = !sameDraft(draft, initial);
  const editable = canEdit;
  const set = <K extends keyof LeaveTypeDraft>(key: K, value: LeaveTypeDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const setSubtype = (index: number, patch: Partial<LeaveTypeDraft['subtypes'][number]>) =>
    set('subtypes', draft.subtypes.map((item, i) => i === index ? { ...item, ...patch } : item));

  const save = async () => {
    setSaving(true);
    try {
      const code = await leaveService.saveType(type?.code || null, normalizeDraft(draft));
      toast.success(type ? `Đã lưu "${draft.name.trim()}"` : `Đã thêm "${draft.name.trim()}"`,
        type ? `Áp dụng cho đơn gửi từ bây giờ${usage.pending ? `; ${usage.pending} đơn đang chờ giữ người duyệt cũ` : ''}.`
          : 'Nhân viên đã chọn được loại này khi tạo đơn.');
      await onSaved(code);
    } catch (error) {
      toast.error('Chưa lưu được', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    if (!type) return;
    if (type.isActive) {
      const ok = await confirm({
        title: 'Tắt loại đơn', targetName: type.name, actionLabel: 'Tắt loại này', confirmText: 'Tắt loại này', intent: 'warning', countdownSeconds: 0,
        subtitle: 'Nhân viên không chọn được loại này khi tạo đơn mới.',
        warningText: `${usage.pending ? `${usage.pending} đơn đang chờ vẫn được duyệt tiếp. ` : ''}Đơn cũ giữ nguyên. Bật lại bất cứ lúc nào.`,
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      await leaveService.setTypeActive(type.code, !type.isActive);
      toast.success(type.isActive ? `Đã tắt "${type.name}"` : `Đã bật lại "${type.name}"`,
        type.isActive ? 'Loại này không còn trong danh sách khi nhân viên tạo đơn.' : 'Nhân viên chọn được loại này khi tạo đơn.');
      await onSaved(type.code);
    } catch (error) {
      toast.error('Chưa cập nhật được', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const tryClose = async () => {
    if (dirty && editable) {
      const ok = await confirm({
        title: 'Bỏ thay đổi?', targetName: draft.name || 'Loại đơn mới', actionLabel: 'Bỏ thay đổi', confirmText: 'Bỏ thay đổi',
        intent: 'warning', countdownSeconds: 0, subtitle: 'Những gì bạn vừa sửa chưa được lưu.',
      });
      if (!ok) return;
    }
    onClose();
  };

  return <Drawer label={type ? `Thiết lập ${type.name}` : 'Thêm loại đơn'} onClose={() => void tryClose()}
    header={<div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{type ? 'Thiết lập loại đơn' : 'Thêm loại đơn'}</p>
      <h2 className={`text-lg ${ENT}`}>{draft.name.trim() || 'Loại đơn mới'}</h2>
      {type && <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Badge className={type.isActive ? PAID_STYLE.company.badge : OFF_BADGE}>{type.isActive ? 'Đang dùng' : 'Đã tắt'}</Badge>
        {type.isSystem && <Badge className={OFF_BADGE}><Lock size={10} />Loại hệ thống</Badge>}
        <span className="text-xs text-muted-foreground">Đã có <span className={NUM}>{usage.total}</span> đơn{usage.pending ? <> · <span className="font-semibold text-amber-700 dark:text-amber-300">{usage.pending} đang chờ</span></> : ''}</span>
      </div>}
    </div>}
    footer={editable ? <>
      {type && <button type="button" onClick={() => void toggleActive()} disabled={saving} className={`${secondaryBtn} mr-auto`}>
        <Power size={15} />{type.isActive ? 'Tắt loại này' : 'Bật lại'}</button>}
      {problems.length > 0 && dirty && <span className="w-full text-right text-xs font-semibold text-rose-600 sm:w-auto">{problems[0]}</span>}
      <button type="button" onClick={() => void tryClose()} className={secondaryBtn}>Đóng</button>
      <button type="button" onClick={() => void save()} disabled={saving || !dirty || problems.length > 0} className={primaryBtn}>
        {saving ? 'Đang lưu…' : type ? 'Lưu thay đổi' : 'Thêm loại đơn'}</button>
    </> : <button type="button" onClick={onClose} className={secondaryBtn}>Đóng</button>}>

    {!editable && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      Bạn đang xem. Chỉ HR Manage và Admin được sửa thiết lập nghỉ phép.</p>}

    <Section n={1} icon={Pencil} title="Tên và mô tả" hint="Nhân viên thấy tên và mô tả này khi chọn loại đơn.">
      <label className="block text-xs font-semibold text-muted-foreground">Tên loại đơn
        <input value={draft.name} disabled={!editable} onChange={e => set('name', e.target.value)} maxLength={60}
          placeholder="Ví dụ: Nghỉ bù" className={`${inputCls} mt-1 w-full`} /></label>
      <label className="block text-xs font-semibold text-muted-foreground">Mô tả ngắn
        <textarea value={draft.description} disabled={!editable} onChange={e => set('description', e.target.value)} rows={2} maxLength={300}
          placeholder="Ví dụ: Nghỉ bù cho ngày làm thêm Chủ nhật, trong vòng 30 ngày." className={`${inputCls} mt-1 w-full resize-none`} /></label>
      {!type && <LockNote>Loại mới tính theo ngày nghỉ và không trừ phép năm.</LockNote>}
    </Section>

    <Section n={2} icon={Banknote} title="Hưởng lương" hint="Bảng công dùng mục này để tính ngày có lương hay không lương.">
      <div className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(PAID_BY_LABEL) as Array<LeaveTypeOption['paidBy']>).map(option =>
          <button key={option} type="button" disabled={!editable || paidLocked} onClick={() => set('paidBy', option)} aria-pressed={draft.paidBy === option}
            className={`rounded-xl border px-3 py-2 text-left text-sm disabled:cursor-not-allowed ${draft.paidBy === option ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:bg-muted'} ${paidLocked && draft.paidBy !== option ? 'opacity-40' : ''}`}>
            <span className="font-semibold text-foreground">{PAID_BY_LABEL[option]}</span>
          </button>)}
      </div>
      {type?.deductsAnnual && <p className="text-xs font-semibold text-leaf-700 dark:text-leaf-300">Trừ vào số phép năm của nhân viên.</p>}
      {paidLocked && <LockNote>Loại hệ thống: sổ phép và bảng công đang tính theo cách này nên không đổi được.</LockNote>}
    </Section>

    <Section n={3} icon={UserCheck} title="Ai duyệt" hint="Bước 1 tự xác định: người duyệt của công trường, hoặc quản lý trên sơ đồ tổ chức, cuối cùng là Phòng HCNS.">
      <div className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">1</span>
        <span className="font-semibold text-foreground">Quản lý trực tiếp</span><span className="text-xs text-muted-foreground">luôn có</span>
      </div>
      {unit === 'day' && <div className="rounded-xl border border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <Switch label={`Thêm bước ${settings.secondStepLabel}`} checked={draft.secondStepAfterDays !== null} disabled={!editable}
            onChange={on => set('secondStepAfterDays', on ? 3 : null)} />
          <span className="text-sm text-foreground">Thêm bước <span className="font-semibold">{settings.secondStepLabel}</span>
            {approverName && <> — <span className={ENT}>{approverName}</span></>}</span>
        </div>
        {draft.secondStepAfterDays !== null && <label className="mt-2 flex flex-wrap items-center gap-2 pl-14 text-sm text-muted-foreground">khi đơn dài hơn
          <input type="number" min={0} step={0.5} value={draft.secondStepAfterDays} disabled={!editable} aria-label="Số ngày làm việc"
            onChange={e => set('secondStepAfterDays', e.target.value === '' ? 0 : Number(e.target.value))} className={`${inputCls} w-20 text-right tabular-nums`} />
          ngày làm việc</label>}
      </div>}
      <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
        <Switch label="Phòng HCNS kiểm tra sau cùng" checked={draft.hrStep} disabled={!editable} onChange={on => set('hrStep', on)} />
        <span className="text-sm text-foreground">Phòng HCNS kiểm tra sau cùng</span>
      </div>
      <p className="flex items-start gap-1.5 rounded-xl bg-mint-50 px-3 py-2 text-xs text-mint-900 dark:bg-mint-950/30 dark:text-mint-100">
        <ArrowRight size={13} className="mt-0.5 shrink-0" />{approvalExample(draft, unit, settings.secondStepLabel)}</p>
    </Section>

    <Section n={4} icon={ListChecks} title="Lý do và số ngày tối đa"
      hint={subtypesLocked ? undefined : 'Có danh sách thì nhân viên phải chọn một lý do. Đơn dài hơn số ngày tối đa sẽ không gửi được. Để trống ô ngày nếu không giới hạn.'}>
      {draft.subtypes.length === 0 && !editable && <p className="text-xs text-muted-foreground">Không có lý do con.</p>}
      {draft.subtypes.length > 0 && <ul className="space-y-2">{draft.subtypes.map((item, index) =>
        <li key={index} className="flex items-center gap-2">
          <input value={item.name} disabled={!editable || subtypesLocked} onChange={e => setSubtype(index, { name: e.target.value })} maxLength={80}
            aria-label={`Lý do ${index + 1}`} placeholder="Ví dụ: Kết hôn" className={`${inputCls} min-w-0 flex-1`} />
          {unit === 'day' && <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">tối đa
            <input type="number" min={0.5} step={0.5} value={item.maxDays ?? ''} disabled={!editable || subtypesLocked} aria-label={`Số ngày tối đa của lý do ${index + 1}`}
              onChange={e => setSubtype(index, { maxDays: e.target.value === '' ? null : Number(e.target.value) })} className={`${inputCls} w-16 text-right tabular-nums`} />ngày</label>}
          {editable && !subtypesLocked && <button type="button" onClick={() => set('subtypes', draft.subtypes.filter((_, i) => i !== index))}
            aria-label={`Bỏ lý do ${item.name || index + 1}`} className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button>}
        </li>)}</ul>}
      {editable && !subtypesLocked && <button type="button" onClick={() => set('subtypes', [...draft.subtypes, { name: '', maxDays: null }])} className={secondaryBtn}>
        <Plus size={15} />Thêm lý do</button>}
      {subtypesLocked && <LockNote>Bảng công đọc các lý do này để tính đi muộn / về sớm nên không đổi được.</LockNote>}
    </Section>

    <Section n={5} icon={FileCheck2} title="Giấy tờ đính kèm">
      <div className="flex items-center gap-3">
        <Switch label="Bắt buộc đính kèm khi gửi đơn" checked={draft.requiresAttachment} disabled={!editable} onChange={on => set('requiresAttachment', on)} />
        <span className="text-sm text-foreground">Bắt buộc chụp / đính kèm giấy tờ khi gửi đơn</span>
      </div>
      {draft.requiresAttachment && <label className="block text-xs font-semibold text-muted-foreground">Giấy tờ cần nộp (nhân viên thấy dòng này)
        <input value={draft.attachmentHint} disabled={!editable} onChange={e => set('attachmentHint', e.target.value)} maxLength={200}
          placeholder="Ví dụ: Giấy chứng nhận nghỉ việc hưởng BHXH hoặc giấy ra viện" className={`${inputCls} mt-1 w-full`} /></label>}
    </Section>

    <Section n={6} icon={ShieldCheck} title="Ai được xin">
      <div className="flex items-center gap-3">
        <Switch label="Chỉ nhân sự chính thức" checked={draft.requiresOfficial} disabled={!editable} onChange={on => set('requiresOfficial', on)} />
        <span className="text-sm text-foreground">Chỉ nhân sự chính thức <span className="text-muted-foreground">(người đang thử việc không gửi được)</span></span>
      </div>
    </Section>

    {type && <details className="rounded-2xl border border-border bg-card p-4">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground"><History size={15} className="text-teal-600" />Lịch sử thay đổi
        <span className="text-xs font-normal text-muted-foreground">({history.length})</span></summary>
      <div className="mt-3"><HistoryList rows={history} typeName={() => type.name} userName={userName} /></div>
    </details>}
  </Drawer>;
};

// ---------------------------------------------------------------------------
// Drawer: rules shared by every type.
// ---------------------------------------------------------------------------
const GeneralDrawer: React.FC<{
  settings: LeaveSettings;
  users: Array<{ id: string; name: string }>;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}> = ({ settings, users, canEdit, onClose, onSaved }) => {
  const toast = useToast();
  const [draft, setDraft] = useState<LeaveSettings>(settings);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const invalid = draft.secondStepLabel.trim().length < 2 || !(draft.lateEarlyMaxMinutes >= 5 && draft.lateEarlyMaxMinutes <= 480);

  const save = async () => {
    setSaving(true);
    try {
      await leaveService.saveSettings({ ...draft, secondStepLabel: draft.secondStepLabel.trim() });
      toast.success('Đã lưu quy tắc chung', 'Áp dụng cho đơn gửi từ bây giờ; đơn đang chờ giữ người duyệt cũ.');
      await onSaved();
    } catch (error) {
      toast.error('Chưa lưu được', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  return <Drawer label="Quy tắc chung" onClose={onClose}
    header={<div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nghỉ phép</p><h2 className="text-lg font-semibold text-foreground">Quy tắc chung</h2></div>}
    footer={canEdit ? <>
      <button type="button" onClick={onClose} className={secondaryBtn}>Đóng</button>
      <button type="button" onClick={() => void save()} disabled={saving || !dirty || invalid} className={primaryBtn}>{saving ? 'Đang lưu…' : 'Lưu quy tắc'}</button>
    </> : <button type="button" onClick={onClose} className={secondaryBtn}>Đóng</button>}>
    <Section n={1} icon={UserCheck} title="Bước duyệt thêm cho đơn dài" hint="Loại đơn nào thêm bước này, và từ bao nhiêu ngày, đặt riêng trong từng loại đơn.">
      <label className="block text-xs font-semibold text-muted-foreground">Người duyệt
        <select value={draft.secondStepApproverUserId || ''} disabled={!canEdit} onChange={e => setDraft({ ...draft, secondStepApproverUserId: e.target.value || null })}
          className={`${inputCls} mt-1 w-full`}>
          <option value="">— Không thêm bước này —</option>
          {users.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
      <label className="block text-xs font-semibold text-muted-foreground">Tên bước (hiện trên đơn)
        <input value={draft.secondStepLabel} disabled={!canEdit} maxLength={60} onChange={e => setDraft({ ...draft, secondStepLabel: e.target.value })} className={`${inputCls} mt-1 w-full`} /></label>
    </Section>
    <Section n={2} icon={Settings2} title="Cách tính">
      <label className="flex flex-wrap items-center gap-2 text-sm text-foreground">Đi muộn / về sớm tối đa mỗi lần
        <input type="number" min={5} max={480} value={draft.lateEarlyMaxMinutes} disabled={!canEdit} aria-label="Số phút tối đa"
          onChange={e => setDraft({ ...draft, lateEarlyMaxMinutes: Number(e.target.value) || 0 })} className={`${inputCls} w-20 text-right tabular-nums`} />phút</label>
      <div className="flex items-center gap-3">
        <Switch label="Thứ Bảy là ngày làm việc" checked={draft.saturdayIsWorkday} disabled={!canEdit} onChange={on => setDraft({ ...draft, saturdayIsWorkday: on })} />
        <span className="text-sm text-foreground">Thứ Bảy là ngày làm việc <span className="text-muted-foreground">(nghỉ Thứ Bảy bị tính vào số ngày nghỉ)</span></span>
      </div>
    </Section>
  </Drawer>;
};

// ---------------------------------------------------------------------------
// Main view.
// ---------------------------------------------------------------------------
const LeavePolicySettings: React.FC<{
  settings: LeaveSettings | null;
  types: LeaveTypeOption[];
  users: Array<{ id: string; name: string }>;
  usage: Record<string, LeaveTypeUsage>;
  canEdit: boolean;
  loading: boolean;
  error: string;
  onChanged: () => Promise<void>;
}> = ({ settings, types, users, usage, canEdit, loading, error, onChanged }) => {
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<'active' | 'off' | 'all'>('active');
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [general, setGeneral] = useState(false);
  const [log, setLog] = useState<LeavePolicyLogRow[]>([]);

  const loadLog = useCallback(() => { leaveService.listPolicyLog().then(setLog).catch(() => setLog([])); }, []);
  useEffect(() => { loadLog(); }, [loadLog]);

  const userName = useCallback((id: string | null) => users.find(item => item.id === id)?.name || '', [users]);
  const typeName = useCallback((code: string) => types.find(item => item.code === code)?.name || code, [types]);
  const listed = types.filter(type => type.code !== 'other');
  const counts = { active: listed.filter(type => type.isActive).length, off: listed.filter(type => !type.isActive).length, all: listed.length };
  const shown = listed
    .filter(type => show === 'all' || (show === 'active' ? type.isActive : !type.isActive))
    .filter(type => !search || matchesSearchQueryMultiple([type.name, type.description, ...type.subtypes.map(item => item.name)], search));
  const openType = types.find(type => type.code === openCode) || null;
  const approverName = settings ? userName(settings.secondStepApproverUserId) : '';
  const afterSave = async () => { await onChanged(); loadLog(); };

  if (error && !settings) return <StateBox kind="error" message={error} onRetry={() => void onChanged()} />;
  if (loading && !settings) return <StateBox kind="loading" title="Đang tải thiết lập nghỉ phép…" />;
  if (!settings) return <StateBox kind="empty" title="Chưa có thiết lập nghỉ phép" message="Liên hệ quản trị hệ thống để khởi tạo." />;

  return <section className="space-y-3">
    <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-leaf-500 text-white"><Settings2 size={20} /></span>
      <div className="min-w-[220px] flex-1">
        <h2 className="text-lg font-bold text-foreground">Thiết lập nghỉ phép</h2>
        <p className="text-sm text-muted-foreground">Loại đơn nhân viên được chọn, ai duyệt, lý do và số ngày tối đa, giấy tờ phải nộp. Thay đổi áp dụng cho đơn gửi sau khi lưu.</p>
        <details className="mt-1 text-sm">
          <summary className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-teal-700 dark:text-teal-300">Cách làm <ChevronDown size={13} /></summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Bấm vào một loại đơn để sửa: hưởng lương, có thêm bước {settings.secondStepLabel} khi đơn dài, lý do con và số ngày tối đa, giấy tờ cần nộp.</li>
            <li>Không dùng nữa thì <b>Tắt</b> — đơn cũ và đơn đang chờ vẫn giữ nguyên. Loại đơn không bị xóa để giữ lịch sử.</li>
            <li>Người duyệt bước thêm và cách tính chung (đi muộn tối đa, Thứ Bảy) nằm ở <b>Quy tắc chung</b>.</li>
          </ol>
        </details>
      </div>
      {canEdit && <button type="button" onClick={() => setCreating(true)} className={primaryBtn}><Plus size={16} />Thêm loại đơn</button>}
      {!canEdit && <p className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        Bạn đang xem. Chỉ HR Manage và Admin được sửa thiết lập nghỉ phép.</p>}
    </div>

    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-label="Loại đơn" className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
          <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2">
            <Search size={15} className="text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Tìm loại đơn" placeholder="Tìm loại đơn, lý do…" className="w-full bg-transparent py-1.5 text-sm focus:outline-none" />
            {search && <button type="button" onClick={() => setSearch('')} aria-label="Xóa tìm kiếm"><X size={14} /></button>}
          </label>
          <div className="flex rounded-lg border border-border p-0.5 text-xs font-semibold" role="group" aria-label="Lọc trạng thái">
            {(['active', 'off', 'all'] as const).map(key => <button key={key} type="button" aria-pressed={show === key} onClick={() => setShow(key)}
              className={`rounded-md px-2.5 py-1 ${show === key ? 'bg-teal-600 text-white' : 'text-muted-foreground hover:bg-muted'}`}>
              {{ active: 'Đang dùng', off: 'Đã tắt', all: 'Tất cả' }[key]} <span className="tabular-nums">{counts[key]}</span></button>)}
          </div>
        </div>
        {shown.length === 0 ? <div className="px-4 py-12 text-center text-sm text-muted-foreground">
          {show === 'off' && !search ? 'Không có loại đơn nào đang tắt.' : 'Không có loại đơn khớp tìm kiếm.'}</div>
          : <ul className="divide-y divide-border">{shown.map(type => {
            const used = usage[type.code] || { total: 0, pending: 0 };
            const summary = subtypeSummary(type.subtypes);
            return <li key={type.code}><button type="button" onClick={() => setOpenCode(type.code)}
              className={`flex w-full items-start gap-3 border-l-4 px-3 py-3 text-left hover:bg-mint-50/60 dark:hover:bg-mint-950/20 ${type.isActive ? PAID_STYLE[type.paidBy].strip : 'border-l-slate-300 opacity-70'}`}>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className={`text-sm ${ENT}`}>{type.name}</span>
                  <Badge className={PAID_STYLE[type.paidBy].badge}>{PAID_BY_LABEL[type.paidBy]}</Badge>
                  {type.deductsAnnual && <Badge className="border-mint-200 bg-mint-50 text-mint-800 dark:border-mint-900 dark:bg-mint-950/40 dark:text-mint-200">Trừ phép năm</Badge>}
                  {type.unit === 'minute' && <Badge className={OFF_BADGE}>Tính theo phút</Badge>}
                  {!type.isActive && <Badge className={OFF_BADGE}>Đã tắt</Badge>}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  {approvalSteps(type, settings.secondStepLabel).map((step, index) => <React.Fragment key={step}>
                    {index > 0 && <ArrowRight size={11} />}
                    <span className={index > 0 ? 'font-semibold text-foreground' : ''}>{step}</span>
                  </React.Fragment>)}
                </span>
                {(summary || type.requiresAttachment || type.requiresOfficial) && <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {summary && <span className="inline-flex items-center gap-1"><ListChecks size={12} />{summary}</span>}
                  {type.requiresAttachment && <span className="inline-flex items-center gap-1 font-semibold text-teal-700 dark:text-teal-300"><FileCheck2 size={12} />Cần giấy tờ</span>}
                  {type.requiresOfficial && <span className="inline-flex items-center gap-1"><ShieldCheck size={12} />Chỉ nhân sự chính thức</span>}
                </span>}
              </span>
              <span className="shrink-0 text-right text-xs text-muted-foreground">
                <span className={`block text-base ${NUM}`}>{used.total}</span>đơn
                {used.pending > 0 && <span className="block font-semibold text-amber-700 dark:text-amber-300">{used.pending} chờ</span>}
              </span>
            </button></li>;
          })}</ul>}
      </section>

      <aside className="space-y-3">
        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 text-sm font-semibold text-foreground">Quy tắc chung</h3>
            <button type="button" onClick={() => setGeneral(true)} className={secondaryBtn}>{canEdit ? <><Pencil size={14} />Sửa</> : 'Xem'}</button>
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="text-xs text-muted-foreground">Bước duyệt thêm cho đơn dài</dt>
              <dd>{approverName ? <><span className={ENT}>{approverName}</span> <span className="text-muted-foreground">({settings.secondStepLabel})</span></>
                : <span className="font-semibold text-amber-700 dark:text-amber-300">Chưa chọn người — đơn dài chỉ qua quản lý</span>}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Đi muộn / về sớm tối đa mỗi lần</dt><dd><span className={NUM}>{settings.lateEarlyMaxMinutes}</span> phút</dd></div>
            <div><dt className="text-xs text-muted-foreground">Thứ Bảy</dt><dd className="text-foreground">{settings.saturdayIsWorkday ? 'Ngày làm việc' : 'Ngày nghỉ'}</dd></div>
          </dl>
          <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">Phép năm cộng 1 ngày vào mùng 1 hằng tháng (trừ người thử việc); phép tồn dùng đến hết 31/03.</p>
        </section>
        <details className="rounded-2xl border border-border bg-card p-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground"><History size={15} className="text-teal-600" />Lịch sử thay đổi
            <span className="text-xs font-normal text-muted-foreground">({log.length})</span></summary>
          <div className="mt-3 max-h-96 overflow-y-auto"><HistoryList rows={log.slice(0, 30)} typeName={typeName} userName={userName} showTarget /></div>
        </details>
      </aside>
    </div>

    {(openType || creating) && <TypeDrawer key={openType?.code || 'new'} type={creating ? null : openType} allTypes={types} settings={settings}
      approverName={approverName} usage={(openType && usage[openType.code]) || { total: 0, pending: 0 }} canEdit={canEdit}
      history={openType ? log.filter(row => row.target === openType.code) : []} userName={userName}
      onClose={() => { setOpenCode(null); setCreating(false); }}
      onSaved={async code => { await afterSave(); setCreating(false); setOpenCode(code); }} />}
    {general && <GeneralDrawer settings={settings} users={users} canEdit={canEdit} onClose={() => setGeneral(false)}
      onSaved={async () => { await afterSave(); setGeneral(false); }} />}
  </section>;
};

export default LeavePolicySettings;
