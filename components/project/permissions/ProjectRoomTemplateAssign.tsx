import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, RefreshCw, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import { projectStaffService } from '../../../lib/projectStaffService';
import {
  buildDraftFromTemplate,
  diffRoomActions,
  orderTemplatesForPosition,
  projectRoomTemplateService,
  type ProjectRoomTemplate,
  type ProjectRoomTemplateActions,
} from '../../../lib/projectRoomTemplateService';
import {
  getProjectPermissionRoom,
  getProjectPermissionRoomActionLabel,
  PROJECT_PERMISSION_ROOMS,
  type ProjectPermissionRoomCode,
  type ProjectRoomActionCode,
} from '../../../lib/permissions/projectPermissionRooms';
import { useToast } from '../../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../../lib/apiError';
import type { ProjectStaff } from '../../../types';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
  onApplied: () => void;
}

// Person-first Room setup: pick a project member, start from a role template
// (suggested by position), adjust any action for this person, then apply.
// Room-by-Room editing stays below.
const ProjectRoomTemplateAssign: React.FC<Props> = ({ projectId, constructionSiteId, onApplied }) => {
  const toast = useToast();
  const [staff, setStaff] = useState<ProjectStaff[]>([]);
  const [templates, setTemplates] = useState<ProjectRoomTemplate[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [staffId, setStaffId] = useState('');
  const [current, setCurrent] = useState<ProjectRoomTemplateActions | null>(null);
  const [currentState, setCurrentState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [draft, setDraft] = useState<ProjectRoomTemplateActions>({});
  const [templateCode, setTemplateCode] = useState('');
  const [usedTemplateCode, setUsedTemplateCode] = useState<string | null>(null);
  const [fillMode, setFillMode] = useState<'merge' | 'replace'>('merge');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const [staffRows, templateRows] = await Promise.all([
        projectStaffService.listByProject(projectId, constructionSiteId || undefined),
        projectRoomTemplateService.list(),
      ]);
      setStaff(staffRows.filter(row => !row.endDate).sort((a, b) => (a.userName || '').localeCompare(b.userName || '', 'vi')));
      setTemplates(templateRows);
      setLoadState('ready');
    } catch (loadError) {
      logApiError('projectRoomTemplate.load', loadError);
      setLoadState('error');
    }
  }, [constructionSiteId, projectId]);

  useEffect(() => { load(); }, [load]);

  const selectedStaff = staff.find(row => row.id === staffId);
  const orderedTemplates = useMemo(
    () => orderTemplatesForPosition(templates, selectedStaff?.positionId),
    [templates, selectedStaff?.positionId],
  );
  const selectedTemplate = orderedTemplates.find(template => template.code === templateCode);
  const changes = useMemo(() => (current ? diffRoomActions(current, draft) : []), [current, draft]);

  const loadCurrent = async (id: string) => {
    setCurrentState('loading');
    try {
      const actions = await projectRoomTemplateService.getStaffRoomActions(projectId, constructionSiteId, id);
      setCurrent(actions);
      setDraft(structuredClone(actions));
      setCurrentState('ready');
    } catch (loadError) {
      logApiError('projectRoomTemplate.current', loadError);
      setCurrentState('error');
    }
  };

  const chooseStaff = (id: string) => {
    setStaffId(id);
    setError('');
    setUsedTemplateCode(null);
    setCurrent(null);
    const positionId = staff.find(row => row.id === id)?.positionId;
    setTemplateCode(orderTemplatesForPosition(templates, positionId).find(template => template.suggested)?.code || '');
    if (id) loadCurrent(id); else setCurrentState('idle');
  };

  const fillFromTemplate = () => {
    if (!current || !selectedTemplate) return;
    setDraft(buildDraftFromTemplate(current, selectedTemplate.roomActions, fillMode));
    setUsedTemplateCode(selectedTemplate.code);
  };

  const toggle = (room: ProjectPermissionRoomCode, action: ProjectRoomActionCode) => {
    setDraft(prev => {
      const next = new Set(prev[room] || []);
      if (next.has(action)) {
        next.delete(action);
        if (action === 'view') next.clear(); // every other action needs view
      } else {
        next.add(action);
        if (action !== 'view') next.add('view');
      }
      const result: ProjectRoomTemplateActions = { ...prev, [room]: [...next] };
      if (next.size === 0) delete result[room];
      return result;
    });
  };

  const apply = async () => {
    if (!staffId || changes.length === 0) return;
    setApplying(true);
    setError('');
    try {
      const applied = await projectRoomTemplateService.apply({
        projectId, constructionSiteId, staffId,
        templateCode: usedTemplateCode, mode: 'exact', dryRun: false, roomActions: draft,
      });
      toast.success('Đã cập nhật quyền Room', `${selectedStaff?.userName || 'Nhân sự'}: ${applied.length} Room thay đổi.`);
      await loadCurrent(staffId);
      onApplied();
    } catch (applyError) {
      logApiError('projectRoomTemplate.apply', applyError);
      setError(getApiErrorMessage(applyError, 'Không lưu được quyền Room.'));
    } finally {
      setApplying(false);
    }
  };

  const fieldClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
  const addedCount = changes.reduce((sum, change) => sum + change.added.length, 0);
  const removedCount = changes.reduce((sum, change) => sum + change.removed.length, 0);

  return (
    <section className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm dark:border-indigo-900/60 dark:bg-slate-800 md:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
          <Wand2 size={18} />
        </div>
        <div>
          <h3 className="text-base font-black text-slate-900 dark:text-white">Phân quyền theo người</h3>
          <p className="text-xs text-slate-500 dark:text-slate-300">
            Chọn người, điền nhanh theo mẫu vai trò, rồi thêm hoặc bỏ từng quyền cho riêng người đó trước khi lưu.
          </p>
        </div>
      </div>

      {loadState === 'loading' && (
        <p className="mt-4 flex items-center gap-2 text-sm font-bold text-slate-400"><Loader2 size={16} className="animate-spin" /> Đang tải nhân sự và mẫu…</p>
      )}
      {loadState === 'error' && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
          Không tải được nhân sự dự án hoặc mẫu quyền.
          <button type="button" onClick={load} className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 font-black"><RefreshCw size={12} /> Thử lại</button>
        </div>
      )}
      {loadState === 'ready' && staff.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-3 text-sm font-bold text-slate-500">
          Dự án chưa có nhân sự. Thêm người ở tab Nhân sự của dự án trước, rồi quay lại phân quyền.
        </p>
      )}

      {loadState === 'ready' && staff.length > 0 && (
        <div className="mt-4 space-y-4">
          <label className="block space-y-1 md:max-w-md">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Nhân sự</span>
            <select value={staffId} onChange={event => chooseStaff(event.target.value)} className={fieldClass}>
              <option value="">— Chọn người trong dự án —</option>
              {staff.map(row => (
                <option key={row.id} value={row.id}>{row.userName || row.userId}{row.positionName ? ` · ${row.positionName}` : ''}</option>
              ))}
            </select>
          </label>

          {currentState === 'loading' && <p className="flex items-center gap-2 text-xs font-bold text-slate-400"><Loader2 size={14} className="animate-spin" /> Đang tải quyền hiện có…</p>}
          {currentState === 'error' && (
            <p className="flex flex-wrap items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
              Không tải được quyền hiện có của người này.
              <button type="button" onClick={() => loadCurrent(staffId)} className="rounded-lg bg-white px-2 py-1 font-black">Thử lại</button>
            </p>
          )}

          {currentState === 'ready' && current && (
            <>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
                <p className="mb-2 text-xs font-black text-slate-700 dark:text-slate-200">1. Điền nhanh theo mẫu (không bắt buộc)</p>
                <div className="flex flex-col gap-2 md:flex-row md:items-end">
                  <label className="flex-1 space-y-1">
                    <select value={templateCode} onChange={event => setTemplateCode(event.target.value)} className={fieldClass}>
                      <option value="">— Chọn mẫu vai trò —</option>
                      {orderedTemplates.map(template => (
                        <option key={template.code} value={template.code}>{template.suggested ? '★ ' : ''}{template.name}</option>
                      ))}
                    </select>
                  </label>
                  <div role="radiogroup" aria-label="Cách điền" className="flex gap-1.5 text-[11px]">
                    {([['merge', 'Thêm vào quyền đang có'], ['replace', 'Thay bằng mẫu']] as const).map(([value, label]) => (
                      <button key={value} type="button" role="radio" aria-checked={fillMode === value} onClick={() => setFillMode(value)}
                        className={`rounded-lg border px-2.5 py-2 font-bold ${fillMode === value ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={fillFromTemplate} disabled={!selectedTemplate}
                    className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300">
                    Điền vào bảng
                  </button>
                </div>
                {selectedTemplate && (
                  <p className="mt-1.5 flex items-start gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {selectedTemplate.suggested && <Sparkles size={12} className="mt-0.5 shrink-0 text-indigo-500" />}
                    {selectedTemplate.suggested ? 'Gợi ý theo chức vụ. ' : ''}{selectedTemplate.description}
                  </p>
                )}
              </div>

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-black text-slate-700 dark:text-slate-200">2. Quyền của {selectedStaff?.userName} — bấm để thêm hoặc bỏ</p>
                  <div className="flex gap-3 text-[10px] font-bold text-slate-500">
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-indigo-600" /> Đang có</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-emerald-500" /> Sẽ thêm</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded border border-rose-400 bg-rose-50" /> Sẽ gỡ</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {PROJECT_PERMISSION_ROOMS.map(room => {
                    const had = new Set(current[room.code] || []);
                    const now = new Set(draft[room.code] || []);
                    return (
                      <div key={room.code} className="flex flex-col gap-1.5 rounded-xl border border-slate-100 px-3 py-2 dark:border-slate-700 md:flex-row md:items-center">
                        <span className="w-52 shrink-0 text-xs font-black text-slate-700 dark:text-slate-200">{room.name}</span>
                        <div className="flex flex-wrap gap-1.5">
                          {room.actions.map(action => {
                            const on = now.has(action);
                            const was = had.has(action);
                            const tone = on && was ? 'border-indigo-600 bg-indigo-600 text-white'
                              : on ? 'border-emerald-500 bg-emerald-500 text-white'
                                : was ? 'border-rose-300 bg-rose-50 text-rose-600 line-through'
                                  : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300';
                            return (
                              <button key={action} type="button" aria-pressed={on} onClick={() => toggle(room.code, action)}
                                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold transition ${tone}`}>
                                {on && <Check size={11} />}{getProjectPermissionRoomActionLabel(room.code, action)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
                <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  {changes.length === 0
                    ? 'Chưa có thay đổi.'
                    : `${changes.length} Room thay đổi · +${addedCount} quyền · −${removedCount} quyền${usedTemplateCode ? ` · theo mẫu "${templates.find(t => t.code === usedTemplateCode)?.name}"` : ''}`}
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setDraft(structuredClone(current)); setUsedTemplateCode(null); }} disabled={changes.length === 0 || applying}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200">
                    <RotateCcw size={12} /> Về như hiện tại
                  </button>
                  <button type="button" onClick={apply} disabled={changes.length === 0 || applying}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-40">
                    {applying && <Loader2 size={13} className="animate-spin" />} Lưu quyền cho {selectedStaff?.userName || 'người này'}
                  </button>
                </div>
              </div>
              {changes.length > 0 && (
                <ul className="space-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {changes.map(change => (
                    <li key={change.roomCode}>
                      <span className="font-bold text-slate-600 dark:text-slate-300">{getProjectPermissionRoom(change.roomCode)?.name}: </span>
                      {change.added.length > 0 && <span className="text-emerald-700">thêm {change.added.map(a => getProjectPermissionRoomActionLabel(change.roomCode, a)).join(', ')}</span>}
                      {change.added.length > 0 && change.removed.length > 0 && '; '}
                      {change.removed.length > 0 && <span className="text-rose-700">gỡ {change.removed.map(a => getProjectPermissionRoomActionLabel(change.roomCode, a)).join(', ')}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
};

export default ProjectRoomTemplateAssign;
