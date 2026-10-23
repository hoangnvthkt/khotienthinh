import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Link2, Link2Off, Loader2, RefreshCw, Undo2, Wand2 } from 'lucide-react';
import { UserPermissionGrant } from '../../types';
import { PermissionAdminCatalog } from '../../lib/permissions/permissionTypes';
import {
  buildGrantsFromTemplate,
  orderUserTemplatesForPosition,
  userPermissionTemplateService,
  type PermissionTemplateOptionDef,
  type UserPermissionTemplate,
  type UserPermissionTemplateMode,
} from '../../lib/userPermissionTemplateService';
import {
  userTemplateAssignmentService,
  type TemplateAssignmentPreview,
  type UserTemplateAssignment,
} from '../../lib/userTemplateAssignmentService';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

interface PermissionTemplateFillProps {
  userId: string;
  catalog: PermissionAdminCatalog;
  grants: readonly UserPermissionGrant[];
  inheritedCodes: readonly string[];
  reason: string;
  disabled: boolean;
  onGrantsChange: (grants: UserPermissionGrant[]) => void;
  onReasonChange: (reason: string) => void;
  /** Bảng quyền bên dưới có thay đổi chưa lưu: chưa cho gắn / bỏ mẫu để khỏi mất thay đổi. */
  hasUnsavedChanges?: boolean;
  /** Máy chủ vừa đổi quyền của người này (gắn / bỏ mẫu): nạp lại bảng quyền. */
  onAssignmentChanged?: () => void | Promise<void>;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(item => b.includes(item));
const previewNames = (items: TemplateAssignmentPreview['add']) => {
  const names = items.slice(0, 4).map(item => (item.moduleLabel ? `${item.moduleLabel}: ${item.label}` : item.label)).join(' · ');
  return items.length > 4 ? `${names}… (+${items.length - 4})` : names;
};

type Filled = { name: string; added: number; removed: number; skipped: number; before: UserPermissionGrant[] };

// "Fill from a template": the position template becomes the starting point of
// this person's own permissions; the Admin then adjusts single boxes below.
const PermissionTemplateFill: React.FC<PermissionTemplateFillProps> = ({
  userId, catalog, grants, inheritedCodes, reason, disabled, onGrantsChange, onReasonChange,
  hasUnsavedChanges = false, onAssignmentChanged,
}) => {
  const [templates, setTemplates] = useState<UserPermissionTemplate[]>([]);
  const [positionId, setPositionId] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reload, setReload] = useState(0);
  const [selectedCode, setSelectedCode] = useState('');
  const [mode, setMode] = useState<UserPermissionTemplateMode>('merge');
  const [filled, setFilled] = useState<Filled | null>(null);
  const [assignment, setAssignment] = useState<UserTemplateAssignment | null>(null);
  const [optionDefs, setOptionDefs] = useState<PermissionTemplateOptionDef[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [preview, setPreview] = useState<TemplateAssignmentPreview | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignDone, setAssignDone] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    Promise.all([
      userPermissionTemplateService.list(),
      // The position only orders the list; an unknown position is not an error.
      userPermissionTemplateService.getUserPositionId(userId).catch(() => null),
      userTemplateAssignmentService.get(userId),
      userPermissionTemplateService.listOptionDefs(),
    ])
      .then(([rows, position, current, defs]) => {
        if (cancelled) return;
        setTemplates(rows);
        setPositionId(position);
        setAssignment(current);
        setOptionDefs(defs);
        if (current) {
          setSelectedCode(current.templateCode);
          setSelectedOptions(current.options);
        }
        setState('ready');
      })
      .catch(error => {
        if (cancelled) return;
        logApiError('permissionTemplateFill.load', error);
        setState('error');
      });
    return () => { cancelled = true; };
  }, [userId, reload]);

  const ordered = useMemo(() => orderUserTemplatesForPosition(templates, positionId), [templates, positionId]);
  useEffect(() => { setFilled(null); setPreview(null); setAssignError(''); setAssignDone(''); setConfirmRemove(false); }, [userId]);
  useEffect(() => {
    if (!selectedCode && ordered[0]) setSelectedCode(ordered[0].code);
  }, [ordered, selectedCode]);

  const selected = ordered.find(template => template.code === selectedCode);
  const selectedOptionDefs = optionDefs.filter(option => selected?.options.includes(option.key));
  const chosenOptions = selectedOptions.filter(key => selected?.options.includes(key));
  const assignmentMatches = Boolean(assignment && selected && assignment.templateCode === selected.code
    && sameSet(assignment.options, chosenOptions));
  const assignLabel = !assignment ? 'Gắn mẫu (tự cập nhật)'
    : assignment.templateCode !== selected?.code ? 'Đổi sang mẫu này' : 'Lưu ô tùy chọn';
  const blockedByEdits = hasUnsavedChanges ? 'Lưu hoặc hủy thay đổi trong bảng quyền trước.' : '';

  const toggleOption = (key: string) => {
    setPreview(null);
    setAssignDone('');
    setSelectedOptions(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  };

  const startAssign = async () => {
    if (!selected) return;
    setBusy(true); setAssignError(''); setAssignDone('');
    try {
      setPreview(await userTemplateAssignmentService.preview(userId, selected.code, chosenOptions));
    } catch (error) {
      logApiError('permissionTemplateFill.previewAssignment', error);
      setAssignError(getApiErrorMessage(error, 'Không xem trước được thay đổi.'));
    } finally {
      setBusy(false);
    }
  };

  const confirmAssign = async () => {
    if (!selected) return;
    setBusy(true); setAssignError('');
    try {
      const result = await userTemplateAssignmentService.save(userId, selected.code, chosenOptions, `Gắn mẫu quyền "${selected.name}"`);
      setAssignment(await userTemplateAssignmentService.get(userId));
      setPreview(null);
      setAssignDone(`Đã gắn mẫu "${selected.name}": thêm ${result.added}, gỡ ${result.removed} quyền. Sửa mẫu sau này sẽ tự cập nhật người này.`);
      await onAssignmentChanged?.();
    } catch (error) {
      logApiError('permissionTemplateFill.saveAssignment', error);
      setAssignError(getApiErrorMessage(error, 'Không gắn được mẫu.'));
    } finally {
      setBusy(false);
    }
  };

  const removeAssignment = async () => {
    if (!assignment) return;
    setBusy(true); setAssignError('');
    try {
      await userTemplateAssignmentService.remove(userId, `Bỏ liên kết mẫu quyền "${assignment.templateName}"`);
      setAssignDone(`Đã bỏ liên kết mẫu "${assignment.templateName}". Quyền hiện có giữ nguyên.`);
      setAssignment(null);
      setConfirmRemove(false);
      await onAssignmentChanged?.();
    } catch (error) {
      logApiError('permissionTemplateFill.removeAssignment', error);
      setAssignError(getApiErrorMessage(error, 'Không bỏ liên kết được.'));
    } finally {
      setBusy(false);
    }
  };

  const fill = () => {
    if (!selected) return;
    const result = buildGrantsFromTemplate({
      current: grants, template: selected, mode, catalog, userId, inheritedCodes,
    });
    setFilled({ name: selected.name, added: result.added, removed: result.removed, skipped: result.skipped, before: [...grants] });
    setAssignDone('');
    setPreview(null);
    onGrantsChange(result.grants);
    if (!reason.trim()) onReasonChange(`Áp mẫu quyền "${selected.name}"`);
  };

  const undo = () => {
    if (!filled) return;
    onGrantsChange(filled.before);
    if (reason === `Áp mẫu quyền "${filled.name}"`) onReasonChange('');
    setFilled(null);
  };

  if (state === 'loading') {
    return <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-white px-3 py-3 text-xs font-semibold text-slate-500"><Loader2 size={14} className="animate-spin" /> Đang tải mẫu quyền theo vị trí…</div>;
  }
  if (state === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
        <span className="font-bold">Không tải được mẫu quyền. Vẫn có thể tick từng quyền bên dưới.</span>
        <button type="button" onClick={() => setReload(value => value + 1)} className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-2 py-1 font-bold"><RefreshCw size={12} /> Thử lại</button>
      </div>
    );
  }
  if (ordered.length === 0) {
    return <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">Chưa có mẫu quyền nào đang dùng. Admin tạo mẫu ở Cài đặt → Mẫu quyền theo vị trí.</p>;
  }

  return (
    <div className="space-y-2 rounded-xl border border-indigo-100 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs font-black text-indigo-700">
        <Wand2 size={14} /> Điền nhanh theo mẫu vị trí
        {assignment && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700" title="Sửa mẫu sẽ tự cập nhật quyền của người này">
            <Link2 size={11} /> Đang theo mẫu "{assignment.templateName}"
            {assignment.options.length > 0 && ` · ${assignment.options.map(key => optionDefs.find(option => option.key === key)?.label || key).join(', ')}`}
            {assignment.excludedCount > 0 && ` · bỏ riêng ${assignment.excludedCount} quyền`}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <select
          aria-label="Mẫu quyền"
          value={selectedCode}
          onChange={event => { setSelectedCode(event.target.value); setPreview(null); }}
          disabled={disabled}
          className="min-h-10 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-100"
        >
          {ordered.map(template => (
            <option key={template.code} value={template.code}>
              {template.suggested ? '★ ' : ''}{template.name}{template.suggested ? ' (gợi ý theo chức vụ)' : ''}
            </option>
          ))}
        </select>
        <div role="radiogroup" aria-label="Cách điền" className="flex rounded-lg border border-slate-200 p-0.5 text-[11px] font-bold">
          {([['merge', 'Thêm vào quyền đang có'], ['replace', 'Thay bằng mẫu']] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={mode === value} disabled={disabled} onClick={() => setMode(value)}
              className={`rounded-md px-2.5 py-1.5 ${mode === value ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={fill} disabled={disabled || !selected}
          className="min-h-10 rounded-lg bg-indigo-600 px-3 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50">
          Điền vào bảng
        </button>
      </div>
      {selected?.description && <p className="text-[11px] text-slate-500">{selected.description} <span className="text-slate-400">· {selected.items.length} quyền</span></p>}
      {selectedOptionDefs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {selectedOptionDefs.map(option => (
            <label key={option.key} title={option.description || undefined}
              className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
              <input type="checkbox" checked={selectedOptions.includes(option.key)} onChange={() => toggleOption(option.key)} disabled={disabled || busy} className="h-4 w-4 rounded accent-indigo-600" />
              {option.label}
            </label>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!assignmentMatches && (
          <button type="button" onClick={() => void startAssign()} disabled={disabled || busy || !selected || Boolean(blockedByEdits)} title={blockedByEdits || undefined}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-black text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
            {busy && !confirmRemove ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} {assignLabel}
          </button>
        )}
        {assignment && !confirmRemove && (
          <button type="button" onClick={() => setConfirmRemove(true)} disabled={disabled || busy || Boolean(blockedByEdits)} title={blockedByEdits || undefined}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <Link2Off size={13} /> Bỏ liên kết
          </button>
        )}
        {blockedByEdits && <span className="text-[11px] font-semibold text-amber-700">{blockedByEdits}</span>}
      </div>
      {preview && selected && (
        <div role="status" className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-[11px] text-slate-700">
          <p className="font-bold">
            {preview.add.length === 0 && preview.remove.length === 0
              ? `Không đổi quyền nào; chỉ ghi nhận người này theo mẫu "${selected.name}".`
              : <>Sẽ {[preview.add.length > 0 && `thêm ${preview.add.length} quyền`, preview.remove.length > 0 && `gỡ ${preview.remove.length} quyền`].filter(Boolean).join(', ')}.</>}
          </p>
          {preview.add.length > 0 && <p><span className="font-bold text-emerald-700">Thêm:</span> {previewNames(preview.add)}</p>}
          {preview.remove.length > 0 && <p><span className="font-bold text-rose-700">Gỡ:</span> {previewNames(preview.remove)}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => void confirmAssign()} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 font-black text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} {assignment?.templateCode === selected.code ? 'Xác nhận' : 'Xác nhận gắn mẫu'}
            </button>
            <button type="button" onClick={() => setPreview(null)} disabled={busy} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-bold text-slate-600">Thôi</button>
          </div>
        </div>
      )}
      {confirmRemove && assignment && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
          <span className="flex-1 font-semibold">Bỏ liên kết: quyền hiện có giữ nguyên, sửa mẫu "{assignment.templateName}" sau này không còn cập nhật người này.</span>
          <button type="button" onClick={() => void removeAssignment()} disabled={busy} className="rounded-md bg-slate-700 px-3 py-1.5 font-black text-white disabled:opacity-50">
            {busy ? <Loader2 size={12} className="mr-1 inline animate-spin" /> : null}Bỏ liên kết
          </button>
          <button type="button" onClick={() => setConfirmRemove(false)} disabled={busy} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-bold text-slate-600">Thôi</button>
        </div>
      )}
      {assignError && <p role="alert" className="text-[11px] font-bold text-rose-700">{assignError}</p>}
      {assignDone && <p role="status" className="flex items-start gap-1.5 text-[11px] font-semibold text-emerald-700"><CheckCircle2 size={13} className="mt-0.5 shrink-0" />{assignDone}</p>}
      {mode === 'replace' && <p className="text-[11px] font-semibold text-amber-700">Thay bằng mẫu sẽ gỡ các quyền cấp riêng khác của người này (trừ quyền dự án). Xem mục "Thay đổi quyền sẽ lưu" trước khi lưu.</p>}
      {filled && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
          <span className="flex flex-1 items-start gap-1.5 font-semibold">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
            Đã điền mẫu "{filled.name}": thêm {filled.added}, gỡ {filled.removed}
            {filled.skipped > 0 && <> · bỏ qua {filled.skipped} quyền đã có sẵn từ vai trò hoặc không cấp riêng được</>}.
            Chỉnh từng quyền bên dưới rồi bấm Lưu. Chưa lưu thì chưa có hiệu lực.
          </span>
          <button type="button" onClick={undo} disabled={disabled} className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 py-1 font-bold"><Undo2 size={12} /> Hoàn tác</button>
        </div>
      )}
    </div>
  );
};

export default PermissionTemplateFill;
