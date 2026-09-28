import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCw, Save, Wand2, X } from 'lucide-react';
import {
  projectRoomTemplateService,
  type ProjectRoomTemplate,
  type ProjectRoomTemplateActions,
} from '../../lib/projectRoomTemplateService';
import {
  getProjectPermissionRoomActionLabel,
  PROJECT_PERMISSION_ROOMS,
  type ProjectPermissionRoomCode,
  type ProjectRoomActionCode,
} from '../../lib/permissions/projectPermissionRooms';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

type Position = { id: string; name: string };

const slug = (name: string) => name.trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'mau_moi';

const emptyTemplate = (): ProjectRoomTemplate => ({
  code: '', name: '', description: '', roomActions: {}, suggestedPositionIds: [], sortOrder: 100, isActive: true,
});

// Room role templates: which Room actions each site role gets. Applied per
// person in a project's Permissions tab.
const SettingsProjectRoomTemplates: React.FC = () => {
  const toast = useToast();
  const [templates, setTemplates] = useState<ProjectRoomTemplate[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProjectRoomTemplate>(emptyTemplate);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [positionQuery, setPositionQuery] = useState('');

  const load = async (keepCode?: string) => {
    setState('loading');
    try {
      const [rows, positionResult] = await Promise.all([
        projectRoomTemplateService.list(),
        supabase.from('hrm_positions').select('id,name').eq('is_active', true).order('name').limit(1000),
      ]);
      if (positionResult.error) throw positionResult.error;
      setTemplates(rows);
      setPositions((positionResult.data || []) as Position[]);
      const next = rows.find(row => row.code === keepCode) || rows[0];
      if (next) { setSelectedCode(next.code); setDraft(structuredClone(next)); setIsNew(false); }
      setState('ready');
    } catch (error) {
      logApiError('settings.projectRoomTemplates.load', error);
      setState('error');
    }
  };

  useEffect(() => { load(); }, []);

  const saved = templates.find(row => row.code === selectedCode);
  const dirty = isNew || JSON.stringify(saved) !== JSON.stringify(draft);
  const actionCount = Object.values(draft.roomActions).reduce((sum, actions) => sum + (actions?.length || 0), 0);

  const selectTemplate = (template: ProjectRoomTemplate) => {
    setSelectedCode(template.code);
    setDraft(structuredClone(template));
    setIsNew(false);
  };

  const startNew = () => {
    setSelectedCode(null);
    setDraft(emptyTemplate());
    setIsNew(true);
  };

  const toggleAction = (room: ProjectPermissionRoomCode, action: ProjectRoomActionCode) => {
    setDraft(prev => {
      const current = new Set(prev.roomActions[room] || []);
      if (current.has(action)) {
        current.delete(action);
        if (action === 'view') current.clear(); // every other action needs view
      } else {
        current.add(action);
        if (action !== 'view') current.add('view');
      }
      const roomActions: ProjectRoomTemplateActions = { ...prev.roomActions, [room]: [...current] };
      if (current.size === 0) delete roomActions[room];
      return { ...prev, roomActions };
    });
  };

  const togglePosition = (id: string) => setDraft(prev => ({
    ...prev,
    suggestedPositionIds: prev.suggestedPositionIds.includes(id)
      ? prev.suggestedPositionIds.filter(item => item !== id)
      : [...prev.suggestedPositionIds, id],
  }));

  const save = async () => {
    const code = isNew ? slug(draft.name) : draft.code;
    if (draft.name.trim().length < 2) { toast.warning('Thiếu tên mẫu', 'Đặt tên cho mẫu trước khi lưu.'); return; }
    if (isNew && templates.some(row => row.code === code)) { toast.warning('Trùng mẫu', 'Đã có mẫu với tên tương tự, hãy đặt tên khác.'); return; }
    setSaving(true);
    try {
      await projectRoomTemplateService.save({ ...draft, code });
      toast.success('Đã lưu mẫu quyền', draft.name);
      await load(code);
    } catch (error) {
      logApiError('settings.projectRoomTemplates.save', error);
      toast.error('Không lưu được mẫu', getApiErrorMessage(error, 'Không thể lưu mẫu quyền dự án.'));
    } finally {
      setSaving(false);
    }
  };

  const visiblePositions = useMemo(() => {
    const query = positionQuery.trim().toLocaleLowerCase('vi');
    return positions.filter(position => draft.suggestedPositionIds.includes(position.id)
      || (query && position.name.toLocaleLowerCase('vi').includes(query))).slice(0, 40);
  }, [positions, positionQuery, draft.suggestedPositionIds]);

  if (state === 'loading') {
    return <div className="flex items-center justify-center py-20 text-sm font-bold text-slate-400"><Loader2 size={18} className="mr-2 animate-spin" /> Đang tải mẫu quyền dự án…</div>;
  }
  if (state === 'error') {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
        <p className="text-sm font-bold text-rose-800">Không tải được mẫu quyền dự án</p>
        <button type="button" onClick={() => load()} className="mt-3 inline-flex items-center gap-1 rounded-xl bg-rose-700 px-3 py-2 text-xs font-black text-white"><RefreshCw size={12} /> Thử lại</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Wand2 size={20} /></div>
            <div>
              <h2 className="text-lg font-black text-slate-800">Mẫu quyền dự án theo vai trò</h2>
              <p className="text-xs font-medium text-slate-500">
                Mỗi mẫu là bộ quyền Room cho một vai trò công trường. Áp cho từng người ở Dự án → tab Phân quyền → "Phân quyền nhanh theo vai trò".
              </p>
            </div>
          </div>
          <button type="button" onClick={startNew} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
            <Plus size={14} /> Mẫu mới
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Danh sách mẫu" className="space-y-1.5">
          {isNew && <div className="rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2.5 text-sm font-black text-indigo-700">Mẫu mới (chưa lưu)</div>}
          {templates.map(template => (
            <button key={template.code} type="button" onClick={() => selectTemplate(template)}
              className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${!isNew && selectedCode === template.code ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
              <span className="block text-sm font-black text-slate-800">{template.name}</span>
              <span className="block text-[11px] font-semibold text-slate-500">
                {Object.keys(template.roomActions).length} Room{template.isActive ? '' : ' · đang tắt'}
              </span>
            </button>
          ))}
        </nav>

        <section className="space-y-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-bold text-slate-600">Tên mẫu</span>
              <input value={draft.name} onChange={event => setDraft(prev => ({ ...prev, name: event.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-100" />
            </label>
            <label className="flex items-center gap-2 self-end rounded-xl border border-slate-200 px-3 py-2">
              <input type="checkbox" checked={draft.isActive} onChange={event => setDraft(prev => ({ ...prev, isActive: event.target.checked }))} className="h-4 w-4 rounded" />
              <span className="text-xs font-bold text-slate-600">Đang dùng (hiện trong danh sách chọn mẫu)</span>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-slate-600">Mô tả ngắn</span>
            <input value={draft.description || ''} onChange={event => setDraft(prev => ({ ...prev, description: event.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>

          <div>
            <p className="mb-2 text-xs font-bold text-slate-600">Quyền theo Room <span className="font-medium text-slate-400">· {actionCount} quyền; tick một thao tác sẽ tự thêm "Xem"</span></p>
            <div className="space-y-2">
              {PROJECT_PERMISSION_ROOMS.map(room => {
                const selected = draft.roomActions[room.code] || [];
                return (
                  <div key={room.code} className="flex flex-col gap-2 rounded-xl border border-slate-100 px-3 py-2 md:flex-row md:items-center">
                    <span className="w-52 shrink-0 text-xs font-black text-slate-700">{room.name}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {room.actions.map(action => (
                        <button key={action} type="button" aria-pressed={selected.includes(action)} onClick={() => toggleAction(room.code, action)}
                          className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${selected.includes(action) ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200'}`}>
                          {getProjectPermissionRoomActionLabel(room.code, action)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold text-slate-600">Gợi ý cho chức vụ <span className="font-medium text-slate-400">· khi chọn người có chức vụ này, mẫu được chọn sẵn</span></p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {draft.suggestedPositionIds.length === 0 && <span className="text-[11px] font-semibold text-slate-400">Chưa gắn chức vụ nào.</span>}
              {draft.suggestedPositionIds.map(id => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700">
                  {positions.find(position => position.id === id)?.name || 'Chức vụ đã ẩn'}
                  <button type="button" onClick={() => togglePosition(id)} aria-label="Bỏ chức vụ"><X size={11} /></button>
                </span>
              ))}
            </div>
            <input value={positionQuery} onChange={event => setPositionQuery(event.target.value)} placeholder="Tìm chức vụ để thêm…"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-indigo-100" />
            {positionQuery.trim() && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-slate-100">
                {visiblePositions.filter(position => !draft.suggestedPositionIds.includes(position.id)).map(position => (
                  <button key={position.id} type="button" onClick={() => togglePosition(position.id)} className="block w-full px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    + {position.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
            {!isNew && dirty && saved && (
              <button type="button" onClick={() => setDraft(structuredClone(saved))} disabled={saving} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">Huỷ thay đổi</button>
            )}
            <button type="button" onClick={save} disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-40">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu mẫu
            </button>
          </div>
          <p className="text-[11px] text-slate-400">Sửa mẫu không đổi quyền của người đã được áp trước đó; chỉ áp dụng cho lần áp tiếp theo.</p>
        </section>
      </div>
    </div>
  );
};

export default SettingsProjectRoomTemplates;
