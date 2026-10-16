import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowRight, ArrowUp, CalendarDays, CheckCircle2, Columns3, Eye, EyeOff, Hash, Lock, Pencil, Plus, Send, ShieldCheck,
  ToggleLeft, Trash2, TriangleAlert, Type, UserCheck, Users, X, List, Banknote,
} from 'lucide-react';
import { useConfirm } from '../../../context/ConfirmContext';
import { useToast } from '../../../context/ToastContext';
import SearchableSelect from '../../common/SearchableSelect';
import { Badge, Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import { ROSTER_FIELDS, ROSTER_GROUPS, type RosterGroupKey } from '../../../lib/hrmRoster';
import {
  APPROVAL_GROUPS, CUSTOM_TYPE_LABEL, ROLE_LABEL, customFieldProblems, effectiveStep1,
  type ApprovalChain, type ApprovalGroup, type ApproverCandidate, type CustomFieldDraft, type CustomFieldType,
  type RosterApprovalSettings, type RosterConfig, type RosterCustomField,
} from '../../../lib/hrmRosterConfig';
import { hrmRosterConfigService } from '../../../lib/hrmRosterConfigService';
import { ENT } from './rosterUi';

const TYPE_ICON: Record<CustomFieldType, React.ElementType> = {
  text: Type, number: Hash, money: Banknote, date: CalendarDays, select: List, boolean: ToggleLeft,
};
const ROLE_STYLE = {
  HR_MANAGE: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200',
  HR: 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200',
  OTHER: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
} as const;
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
const sameSettings = (a: RosterApprovalSettings, b: RosterApprovalSettings) =>
  (['general', 'pay'] as const).every(key => sameList(a[key].step1, b[key].step1) && sameList(a[key].step2, b[key].step2));

// ---------------------------------------------------------------------------
// Người duyệt
// ---------------------------------------------------------------------------
const PersonChip: React.FC<{ person: ApproverCandidate | undefined; id: string; onRemove?: () => void }> = ({ person, id, onRemove }) =>
  <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-2.5 pr-1 text-sm shadow-sm">
    <span className="truncate font-semibold text-foreground">{person?.name || id}</span>
    {person && person.role !== 'HR_MANAGE' && <Badge className={ROLE_STYLE[person.role]} title={person.role === 'OTHER' ? 'Chỉ thấy các phiếu được giao duyệt, không thấy Bảng nhân sự' : undefined}>{ROLE_LABEL[person.role]}</Badge>}
    {onRemove && <button type="button" onClick={onRemove} aria-label={`Bỏ ${person?.name || id}`} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-rose-700"><X size={13} /></button>}
  </span>;

const StepEditor: React.FC<{
  title: string; ids: string[]; candidates: ApproverCandidate[]; fallback?: string[]; onChange: (ids: string[]) => void;
}> = ({ title, ids, candidates, fallback, onChange }) => {
  const byId = (id: string) => candidates.find(item => item.userId === id);
  const options = candidates.filter(item => !ids.includes(item.userId));
  return <div className="space-y-2">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
    <div className="flex flex-wrap items-center gap-1.5">
      {ids.map(id => <PersonChip key={id} id={id} person={byId(id)} onRemove={() => onChange(ids.filter(item => item !== id))} />)}
      {ids.length === 0 && fallback && <span className="text-sm text-muted-foreground">Mặc định HR Manage: <b className="text-foreground">{fallback.map(id => byId(id)?.name || id).join(', ')}</b></span>}
    </div>
    <SearchableSelect ariaLabel={`Thêm người ${title.toLowerCase()}`} value={null} options={options} placeholder="Thêm người…" clearable={false}
      getOptionValue={item => item.userId} getOptionLabel={item => item.name}
      getOptionSearchText={item => `${item.name} ${item.employeeCode || ''} ${item.positionName || ''}`}
      renderOption={item => <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate"><b>{item.name}</b>{item.positionName && <span className="text-slate-500"> · {item.positionName}</span>}</span>
        <span className="shrink-0 text-[11px] font-semibold text-slate-500">{ROLE_LABEL[item.role]}</span></span>}
      onChange={item => item && onChange([...ids, item.userId])} />
  </div>;
};

const FlowNode: React.FC<{ label: string; names: string[]; tone: string; icon: React.ElementType }> = ({ label, names, tone, icon: Icon }) =>
  <div className={`min-w-0 flex-1 rounded-xl border px-3 py-2 ${tone}`}>
    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide"><Icon size={12} />{label}</p>
    <p className="mt-0.5 truncate text-sm font-semibold" title={names.join(', ')}>{names.join(' / ') || '—'}</p>
  </div>;

const ApprovalCard: React.FC<{
  group: (typeof APPROVAL_GROUPS)[number]; chain: ApprovalChain; config: RosterConfig; onChange: (chain: ApprovalChain) => void;
}> = ({ group, chain, config, onChange }) => {
  const [withStep2, setWithStep2] = useState(chain.step2.length > 0);
  const nameOf = (id: string) => config.candidates.find(item => item.userId === id)?.name || id;
  const step1 = effectiveStep1({ approvals: { ...config.approvals, [group.key]: chain }, defaultApproverIds: config.defaultApproverIds }, group.key);
  const both = chain.step2.filter(id => step1.includes(id));
  const warnings: string[] = [];
  if (step1.length === 1) warnings.push(`Bước 1 chỉ có ${nameOf(step1[0])}: phiếu do người này gửi hoặc đổi hồ sơ của chính người này sẽ không ai duyệt được. Nên chọn ít nhất 2 người.`);
  if (both.length) warnings.push(`${both.map(nameOf).join(', ')} có ở cả 2 bước: một người không duyệt 2 lần một phiếu, bước 2 sẽ cần người khác.`);
  if (withStep2 && chain.step2.length === 0) warnings.push('Đã bật bước 2 nhưng chưa chọn người.');
  return <section className="rounded-2xl border border-border bg-card shadow-sm">
    <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
      <h3 className="text-base font-bold text-foreground">{group.label}</h3>
      <span className="text-xs text-muted-foreground">{group.hint}</span>
    </header>
    <div className="space-y-4 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch" aria-label="Luồng duyệt">
        <FlowNode label="HR gửi phiếu" names={['HR']} icon={Send} tone="border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
        <ArrowRight size={16} className="mx-auto shrink-0 self-center text-muted-foreground max-sm:rotate-90" />
        <FlowNode label="Bước 1 · 1 người là đủ" names={step1.map(nameOf)} icon={UserCheck} tone="border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100" />
        {withStep2 && <>
          <ArrowRight size={16} className="mx-auto shrink-0 self-center text-muted-foreground max-sm:rotate-90" />
          <FlowNode label="Bước 2" names={chain.step2.map(nameOf)} icon={ShieldCheck} tone="border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100" />
        </>}
        <ArrowRight size={16} className="mx-auto shrink-0 self-center text-muted-foreground max-sm:rotate-90" />
        <FlowNode label="Hồ sơ cập nhật" names={['Tự động']} icon={CheckCircle2} tone="border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <StepEditor title="Bước 1" ids={chain.step1} candidates={config.candidates} fallback={config.defaultApproverIds}
          onChange={ids => onChange({ ...chain, step1: ids })} />
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <input type="checkbox" checked={withStep2} className="h-4 w-4 accent-teal-600"
              onChange={e => { setWithStep2(e.target.checked); if (!e.target.checked) onChange({ ...chain, step2: [] }); }} />
            Duyệt thêm bước 2</label>
          {withStep2 && <StepEditor title="Bước 2" ids={chain.step2} candidates={config.candidates} onChange={ids => onChange({ ...chain, step2: ids })} />}
        </div>
      </div>
      {warnings.map(text => <p key={text} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        <TriangleAlert size={15} className="mt-0.5 shrink-0" />{text}</p>)}
    </div>
  </section>;
};

// ---------------------------------------------------------------------------
// Cột thông tin
// ---------------------------------------------------------------------------
const EMPTY_DRAFT: CustomFieldDraft = { label: '', group: 'other', type: 'text', options: [], required: false, payOnly: false, hint: '' };

const FieldEditor: React.FC<{
  initial: RosterCustomField | null; others: RosterCustomField[]; onCancel: () => void; onSave: (draft: CustomFieldDraft) => Promise<void>;
}> = ({ initial, others, onCancel, onSave }) => {
  const [draft, setDraft] = useState<CustomFieldDraft>(() => initial
    ? { label: initial.label, group: initial.group, type: initial.type, options: initial.options, required: initial.required, payOnly: initial.payOnly, hint: initial.hint || '' }
    : EMPTY_DRAFT);
  const [optionsText, setOptionsText] = useState((initial?.options || []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const pay = draft.group === 'pay';
  const problems = customFieldProblems({ ...draft, options: optionsText.split('\n') }, others.filter(item => item.id !== initial?.id),
    ROSTER_FIELDS.map(field => field.label));
  const typeLocked = Boolean(initial && initial.filledCount > 0);
  const save = async () => {
    setTried(true);
    if (problems.length) return;
    setSaving(true);
    try { await onSave({ ...draft, payOnly: draft.payOnly || pay, options: optionsText.split('\n').map(item => item.trim()).filter(Boolean) }); } finally { setSaving(false); }
  };
  const Icon = TYPE_ICON[draft.type];
  return <section className="rounded-2xl border-2 border-teal-300 bg-card shadow-sm dark:border-teal-800">
    <h3 className="border-b border-border px-4 py-2.5 text-sm font-bold text-foreground">{initial ? `Sửa cột “${initial.label}”` : 'Thêm cột thông tin'}</h3>
    <div className="grid gap-4 p-4 md:grid-cols-2">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">Tên cột <span className="text-amber-600">*</span></span>
        <input autoFocus value={draft.label} onChange={e => setDraft(cur => ({ ...cur, label: e.target.value }))} placeholder="VD: Nguyên quán" className={`w-full ${inputCls}`} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">Nằm ở nhóm cột</span>
        <select value={draft.group} onChange={e => setDraft(cur => ({ ...cur, group: e.target.value as RosterGroupKey }))} className={`w-full ${inputCls}`}>
          {ROSTER_GROUPS.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}
        </select>
      </label>
      <div className="md:col-span-2">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">Kiểu dữ liệu{typeLocked && ' (đã có dữ liệu — không đổi được kiểu)'}</span>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6" role="radiogroup" aria-label="Kiểu dữ liệu">
          {(Object.keys(CUSTOM_TYPE_LABEL) as CustomFieldType[]).map(type => {
            const TypeIcon = TYPE_ICON[type]; const on = draft.type === type;
            return <button key={type} type="button" role="radio" aria-checked={on} disabled={typeLocked && !on} onClick={() => setDraft(cur => ({ ...cur, type }))}
              className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-xs font-semibold transition disabled:opacity-40 ${on ? 'border-teal-500 bg-teal-50 text-teal-800 ring-2 ring-teal-500/20 dark:bg-teal-950/40 dark:text-teal-200' : 'border-border text-muted-foreground hover:border-teal-300'}`}>
              <TypeIcon size={16} />{CUSTOM_TYPE_LABEL[type]}</button>;
          })}
        </div>
      </div>
      {draft.type === 'select' && <label className="block md:col-span-2">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">Các lựa chọn — mỗi dòng một lựa chọn</span>
        <textarea rows={4} value={optionsText} onChange={e => setOptionsText(e.target.value)} placeholder={'HĐ thử việc\nHĐ có thời hạn 1 năm\nHĐ không xác định thời hạn'} className={`w-full resize-y ${inputCls}`} />
      </label>}
      <label className="block md:col-span-2">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">Gợi ý khi nhập (không bắt buộc)</span>
        <input value={draft.hint} onChange={e => setDraft(cur => ({ ...cur, hint: e.target.value }))} placeholder="VD: Ghi theo CCCD" className={`w-full ${inputCls}`} />
      </label>
      <div className="flex flex-wrap gap-x-6 gap-y-2 md:col-span-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.required} className="h-4 w-4 accent-teal-600"
          onChange={e => setDraft(cur => ({ ...cur, required: e.target.checked }))} />Bắt buộc — đếm vào “Thiếu thông tin”</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.payOnly || pay} disabled={pay} className="h-4 w-4 accent-teal-600"
          onChange={e => setDraft(cur => ({ ...cur, payOnly: e.target.checked }))} />Chỉ HR Manage xem{pay && ' (nhóm Lương luôn bảo mật)'}</label>
      </div>
      <div className="rounded-xl border border-dashed border-border bg-slate-50 p-3 md:col-span-2 dark:bg-slate-900">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Xem trước trong Bảng nhân sự</p>
        <div className="inline-flex overflow-hidden rounded-lg border border-border bg-card text-[13px]">
          <span className={`px-3 py-1.5 text-xs font-bold uppercase ${ROSTER_GROUPS.find(group => group.key === draft.group)?.tone}`}>{ROSTER_GROUPS.find(group => group.key === draft.group)?.label}</span>
          <span className="flex items-center gap-1.5 border-l border-border px-3 py-1.5 font-semibold text-muted-foreground"><Icon size={13} />{draft.label.trim() || 'Tên cột'}</span>
          <span className="border-l border-border px-3 py-1.5">{draft.required ? <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-700">Thiếu</span> : <span className="text-muted-foreground">—</span>}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Nhập Data: đặt đúng tên cột này ở dòng tiêu đề file Excel.</p>
      </div>
      {tried && problems.length > 0 && <ul className="space-y-1 md:col-span-2">{problems.map(text => <li key={text} className="flex items-center gap-1.5 text-sm text-rose-700 dark:text-rose-300"><TriangleAlert size={14} />{text}</li>)}</ul>}
    </div>
    <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
      <button type="button" onClick={onCancel} className={secondaryBtn}>Hủy</button>
      <button type="button" onClick={() => void save()} disabled={saving} className={primaryBtn}><CheckCircle2 size={15} />{initial ? 'Lưu cột' : 'Thêm cột'}</button>
    </footer>
  </section>;
};

const FieldsPanel: React.FC<{ config: RosterConfig; onConfig: (config: RosterConfig) => void; onChanged: () => void }> = ({ config, onConfig, onChanged }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<RosterCustomField | 'new' | null>(null);
  const fields = [...config.customFields].sort((a, b) => a.sortOrder - b.sortOrder);
  const replace = (field: RosterCustomField) => onConfig({ ...config, customFields: [...config.customFields.filter(item => item.id !== field.id), field] });

  const save = async (draft: CustomFieldDraft) => {
    try {
      const saved = await hrmRosterConfigService.saveCustomField(editing && editing !== 'new' ? editing.id : null, draft);
      replace(saved); setEditing(null); onChanged();
      toast.success(editing === 'new' ? `Đã thêm cột “${saved.label}”` : `Đã lưu cột “${saved.label}”`, 'Cột hiện ngay trong Bảng nhân sự và form Đổi thông tin.');
    } catch (e) { toast.error('Chưa lưu được cột', e instanceof Error ? e.message : ''); }
  };
  const toggle = async (field: RosterCustomField) => {
    try { replace(await hrmRosterConfigService.setCustomFieldActive(field.id, !field.isActive)); onChanged();
      toast.success(field.isActive ? `Đã ẩn cột “${field.label}”` : `Đã hiện lại cột “${field.label}”`, field.isActive ? 'Dữ liệu vẫn giữ, hiện lại được bất cứ lúc nào.' : undefined);
    } catch (e) { toast.error('Chưa đổi được', e instanceof Error ? e.message : ''); }
  };
  const move = async (field: RosterCustomField, dir: -1 | 1) => {
    const same = fields.filter(item => item.group === field.group);
    const index = same.findIndex(item => item.id === field.id);
    const target = same[index + dir];
    if (!target) return;
    const ids = fields.map(item => item.id);
    const a = ids.indexOf(field.id); const b = ids.indexOf(target.id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    try { await hrmRosterConfigService.reorderCustomFields(ids);
      onConfig({ ...config, customFields: config.customFields.map(item => ({ ...item, sortOrder: ids.indexOf(item.id) + 1 })) }); onChanged();
    } catch (e) { toast.error('Chưa đổi được thứ tự', e instanceof Error ? e.message : ''); }
  };
  const remove = async (field: RosterCustomField) => {
    const ok = await confirm({ title: 'Xóa cột?', targetName: field.label, confirmText: 'Xóa cột', actionLabel: 'Xóa cột',
      subtitle: 'Cột chưa có dữ liệu nên xóa hẳn được.', warningText: 'Muốn dùng lại thì thêm cột mới.' });
    if (!ok) return;
    try { await hrmRosterConfigService.deleteCustomField(field.id); onConfig({ ...config, customFields: config.customFields.filter(item => item.id !== field.id) }); onChanged();
      toast.success(`Đã xóa cột “${field.label}”`);
    } catch (e) { toast.error('Chưa xóa được', e instanceof Error ? e.message : ''); }
  };

  return <div className="space-y-4">
    {editing ? <FieldEditor initial={editing === 'new' ? null : editing} others={config.customFields} onCancel={() => setEditing(null)} onSave={save} />
      : <button type="button" onClick={() => setEditing('new')} className={primaryBtn}><Plus size={15} />Thêm cột</button>}
    {ROSTER_GROUPS.map(group => {
      const standard = ROSTER_FIELDS.filter(field => field.group === group.key);
      const custom = fields.filter(field => field.group === group.key);
      return <section key={group.key} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <h3 className={`flex items-center justify-between px-4 py-2 text-xs font-bold uppercase tracking-wide ${group.tone}`}>{group.label}
          <span className="font-semibold normal-case tracking-normal opacity-80">{standard.length} cột chuẩn{custom.length ? ` · ${custom.length} cột thêm` : ''}</span></h3>
        <p className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2 text-xs text-muted-foreground">
          <Lock size={12} className="shrink-0" />{standard.map(field => field.label).join(' · ')}</p>
        {custom.length === 0 ? <p className="px-4 py-2.5 text-sm text-muted-foreground">Chưa có cột thêm.</p>
          : <ul className="divide-y divide-border">{custom.map((field, index) => {
            const TypeIcon = TYPE_ICON[field.type];
            return <li key={field.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 ${field.isActive ? '' : 'bg-slate-50 opacity-70 dark:bg-slate-900'}`}>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="flex min-w-0 max-w-full items-center gap-2"><TypeIcon size={15} className="shrink-0 text-teal-600" />
                  <span className={`truncate ${ENT}`}>{field.label}</span></span>
                <Badge className="border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">{CUSTOM_TYPE_LABEL[field.type]}{field.type === 'select' ? ` · ${field.options.length}` : ''}</Badge>
                {field.required && <Badge className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Bắt buộc</Badge>}
                {field.payOnly && <Badge className="border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200"><Lock size={10} />HR Manage</Badge>}
                {!field.isActive && <Badge className="border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Đã ẩn</Badge>}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">{field.filledCount} người có dữ liệu</span>
              <span className="flex items-center gap-0.5">
                <button type="button" onClick={() => void move(field, -1)} disabled={index === 0} aria-label="Lên trên" className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp size={14} /></button>
                <button type="button" onClick={() => void move(field, 1)} disabled={index === custom.length - 1} aria-label="Xuống dưới" className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown size={14} /></button>
                <button type="button" onClick={() => setEditing(field)} aria-label={`Sửa ${field.label}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-teal-700"><Pencil size={14} /></button>
                <button type="button" onClick={() => void toggle(field)} aria-label={field.isActive ? 'Ẩn cột' : 'Hiện cột'} title={field.isActive ? 'Ẩn cột (giữ dữ liệu)' : 'Hiện lại'} className="rounded p-1.5 text-muted-foreground hover:bg-muted">{field.isActive ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                {field.filledCount === 0 && <button type="button" onClick={() => void remove(field)} aria-label={`Xóa ${field.label}`} className="rounded p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-700"><Trash2 size={14} /></button>}
              </span>
            </li>;
          })}</ul>}
      </section>;
    })}
  </div>;
};

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------
export const RosterConfigDrawer: React.FC<{ onClose: () => void; onChanged: () => void }> = ({ onClose, onChanged }) => {
  const toast = useToast();
  const [config, setConfig] = useState<RosterConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'approvers' | 'fields'>('approvers');
  const [settings, setSettings] = useState<RosterApprovalSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    setError(null);
    hrmRosterConfigService.load().then(next => { setConfig(next); setSettings(next.approvals); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);
  const dirty = Boolean(config && settings && !sameSettings(config.approvals, settings));
  const activeFields = config?.customFields.filter(field => field.isActive).length || 0;
  const updated = useMemo(() => config?.updatedAt ? new Date(config.updatedAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null, [config]);

  const saveApprovals = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const next = await hrmRosterConfigService.saveApprovals(settings);
      setConfig(next); setSettings(next.approvals); onChanged();
      toast.success('Đã lưu người duyệt', 'Áp dụng cho phiếu gửi từ bây giờ; phiếu đang chờ giữ người duyệt cũ.');
    } catch (e) { toast.error('Chưa lưu được người duyệt', e instanceof Error ? e.message : ''); } finally { setSaving(false); }
  };

  return <Drawer label="Cấu hình Hồ sơ nhân sự" wide onClose={onClose}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cấu hình</p>
      <h2 className="mt-1 text-lg font-bold text-foreground">Hồ sơ nhân sự</h2>
      {updated && <p className="text-xs text-muted-foreground">Sửa lần cuối {updated}{config?.updatedByName ? ` · ${config.updatedByName}` : ''}</p>}
      <div className="mt-3 inline-flex rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Cấu hình">
        {([['approvers', 'Người duyệt', Users, 0], ['fields', 'Cột thông tin', Columns3, activeFields]] as const).map(([key, label, Icon, n]) =>
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-semibold transition ${tab === key ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
            <Icon size={15} />{label}{n > 0 && <span className={`rounded-full px-1.5 text-xs tabular-nums ${tab === key ? 'bg-white/20' : 'bg-muted'}`}>{n}</span>}</button>)}
      </div>
    </>}
    footer={tab === 'approvers' && config ? <>
      <span className="mr-auto text-sm text-muted-foreground">{dirty ? 'Có thay đổi chưa lưu' : 'Không ai tự duyệt phiếu mình gửi hoặc hồ sơ của mình.'}</span>
      <button type="button" onClick={() => setSettings(config.approvals)} disabled={!dirty || saving} className={secondaryBtn}>Hoàn tác</button>
      <button type="button" onClick={() => void saveApprovals()} disabled={!dirty || saving} className={primaryBtn}><CheckCircle2 size={15} />Lưu người duyệt</button>
    </> : undefined}>
    {error ? <StateBox kind="error" title="Chưa tải được cấu hình" message={error} onRetry={load} />
      : !config || !settings ? <StateBox kind="loading" title="Đang tải cấu hình…" />
        : tab === 'approvers'
          ? <div className="space-y-4">{APPROVAL_GROUPS.map(group => <ApprovalCard key={group.key} group={group} chain={settings[group.key as ApprovalGroup]} config={config}
            onChange={chain => setSettings(cur => cur && ({ ...cur, [group.key]: chain }))} />)}</div>
          : <FieldsPanel config={config} onConfig={setConfig} onChanged={onChanged} />}
  </Drawer>;
};
