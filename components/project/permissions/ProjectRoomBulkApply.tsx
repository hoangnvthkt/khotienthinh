import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Users } from 'lucide-react';
import {
  projectRoomTemplateService,
  type ProjectRoomTemplate,
} from '../../../lib/projectRoomTemplateService';
import { buildSafeTemplateDraft, type RoomRulesByRoom } from '../../../lib/projectRoomPersonDraft';
import { useToast } from '../../../context/ToastContext';
import { useConfirm } from '../../../context/ConfirmContext';
import { getApiErrorMessage, logApiError } from '../../../lib/apiError';
import type { ProjectStaff } from '../../../types';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
  staff: ProjectStaff[];
  templates: ProjectRoomTemplate[];
  rules: RoomRulesByRoom;
  onApplied: () => Promise<void> | void;
}

type BulkMode = 'merge' | 'replace' | 'clear';

const MODES: Array<{ value: BulkMode; label: string; hint: string }> = [
  { value: 'merge', label: 'Thêm quyền theo mẫu', hint: 'Giữ quyền đang có, thêm quyền của mẫu.' },
  { value: 'replace', label: 'Thay bằng mẫu', hint: 'Quyền của mỗi người đúng bằng mẫu (trừ quyền chưa áp dụng đầy đủ, luôn được giữ).' },
  { value: 'clear', label: 'Gỡ hết quyền Room', hint: 'Gỡ mọi quyền Room của những người đã chọn (trừ quyền chưa áp dụng đầy đủ, luôn được giữ).' },
];

const fieldClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white';

// Same rules as one person at a time, applied to several people: each person is read, given the
// template (or cleared) and saved on its own, so a failure never leaves anyone half-changed.
const ProjectRoomBulkApply: React.FC<Props> = ({ projectId, constructionSiteId, staff, templates, rules, onApplied }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<BulkMode>('merge');
  const [templateCode, setTemplateCode] = useState('');
  const [running, setRunning] = useState(false);
  const [failures, setFailures] = useState<Array<{ name: string; message: string }>>([]);

  const activeTemplates = useMemo(() => templates.filter(template => template.isActive), [templates]);
  const template = activeTemplates.find(item => item.code === templateCode);
  const canRun = selected.size > 0 && !running && (mode === 'clear' || Boolean(template));

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const run = async () => {
    if (!canRun) return;
    if (mode === 'clear' && !await confirm({
      title: 'Gỡ hết quyền Room?',
      targetName: `${selected.size} người đã chọn`,
      warningText: 'Họ sẽ mất mọi quyền Room trong dự án này (trừ quyền chưa áp dụng đầy đủ). Có thể cấp lại sau.',
      confirmText: 'Gỡ quyền',
      intent: 'danger',
    })) return;
    setRunning(true);
    setFailures([]);
    const failed: Array<{ name: string; message: string }> = [];
    let changedPeople = 0;
    for (const person of staff.filter(row => selected.has(row.id))) {
      try {
        const current = await projectRoomTemplateService.getStaffRoomActions(projectId, constructionSiteId, person.id);
        const draft = mode === 'clear' ? {} : buildSafeTemplateDraft(current, template!.roomActions, mode, rules).draft;
        const changes = await projectRoomTemplateService.apply({
          projectId, constructionSiteId, staffId: person.id,
          templateCode: mode === 'clear' ? null : template!.code, mode: 'exact', dryRun: false, roomActions: draft,
        });
        if (changes.length > 0) changedPeople += 1;
      } catch (error) {
        logApiError('projectRoomBulk.apply', error);
        failed.push({ name: person.userName || person.userId, message: getApiErrorMessage(error, 'Không lưu được.') });
      }
    }
    setFailures(failed);
    setRunning(false);
    await onApplied();
    if (failed.length === 0) {
      toast.success('Đã cập nhật quyền Room', `${changedPeople} người thay đổi, ${selected.size - changedPeople} người không đổi.`);
      setSelected(new Set());
    } else {
      toast.warning('Có người chưa được cập nhật', `${failed.length}/${selected.size} người lỗi, xem danh sách bên dưới.`);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl p-4 text-left focus:outline-none focus:ring-2 focus:ring-indigo-500 md:px-5">
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200"><Users size={17} /></span>
          <span>
            <span className="block text-sm font-black text-slate-900 dark:text-white">Áp cho nhiều người cùng lúc</span>
            <span className="block text-xs text-slate-500 dark:text-slate-300">Thêm, thay theo mẫu hoặc gỡ quyền Room cho nhiều nhân sự một lần.</span>
          </span>
        </span>
        {open ? <ChevronDown size={17} className="text-indigo-500" /> : <ChevronRight size={17} className="text-slate-300" />}
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-100 p-4 dark:border-slate-700 md:px-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-black text-slate-700 dark:text-slate-200">1. Chọn người ({selected.size}/{staff.length})</p>
              <button type="button" className="text-[11px] font-black text-indigo-700"
                onClick={() => setSelected(selected.size === staff.length ? new Set() : new Set(staff.map(row => row.id)))}>
                {selected.size === staff.length ? 'Bỏ chọn hết' : 'Chọn tất cả'}
              </button>
            </div>
            <div className="grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {staff.map(row => (
                <label key={row.id} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold ${selected.has(row.id) ? 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-200' : 'border-slate-200 text-slate-700 dark:border-slate-600 dark:text-slate-200'}`}>
                  <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} className="h-4 w-4 shrink-0 rounded accent-indigo-600" />
                  <span className="min-w-0 truncate">{row.userName || row.userId}{row.positionName ? <span className="font-medium text-slate-400"> · {row.positionName}</span> : null}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-black text-slate-700 dark:text-slate-200">2. Làm gì</p>
            <div role="radiogroup" aria-label="Cách áp" className="flex flex-wrap gap-1.5 text-[11px]">
              {MODES.map(item => (
                <button key={item.value} type="button" role="radio" aria-checked={mode === item.value} onClick={() => setMode(item.value)}
                  className={`rounded-lg border px-3 py-2 font-bold ${mode === item.value ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'}`}>
                  {item.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">{MODES.find(item => item.value === mode)?.hint}</p>
            {mode !== 'clear' && (
              <label className="mt-2 block space-y-1 md:max-w-md">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Mẫu vai trò</span>
                <select value={templateCode} onChange={event => setTemplateCode(event.target.value)} className={fieldClass}>
                  <option value="">— Chọn mẫu —</option>
                  {activeTemplates.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
                </select>
              </label>
            )}
          </div>

          {failures.length > 0 && (
            <div role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
              <p>Chưa cập nhật được {failures.length} người:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 font-semibold">
                {failures.map(item => <li key={item.name}>{item.name}: {item.message}</li>)}
              </ul>
            </div>
          )}

          <div className="flex justify-end border-t border-slate-100 pt-3 dark:border-slate-700">
            <button type="button" onClick={run} disabled={!canRun}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black text-white disabled:opacity-40 ${mode === 'clear' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
              {running && <Loader2 size={13} className="animate-spin" />}
              {mode === 'clear' ? `Gỡ quyền của ${selected.size} người` : `Áp mẫu cho ${selected.size} người`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default ProjectRoomBulkApply;
