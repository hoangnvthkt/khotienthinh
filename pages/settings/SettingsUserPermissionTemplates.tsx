import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Loader2, Plus, RefreshCw, Save, UserCog, X } from 'lucide-react';
import {
  userPermissionTemplateService,
  type TemplateScopeType,
  type UserPermissionTemplate,
  type UserPermissionTemplateItem,
} from '../../lib/userPermissionTemplateService';
import { listPermissionAdminCatalog } from '../../lib/permissions/permissionCatalogService';
import type { PermissionAdminCatalog, PermissionCatalogAction } from '../../lib/permissions/permissionTypes';
import { SCOPE_LABELS } from '../../components/permissions/PermissionModuleCard';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

type Position = { id: string; name: string };

const TEMPLATE_SCOPES: TemplateScopeType[] = ['own', 'assigned', 'global'];

const slug = (name: string) => name.trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'mau_moi';

const emptyTemplate = (): UserPermissionTemplate => ({
  code: '', name: '', description: '', items: [], suggestedPositionIds: [], sortOrder: 100, isActive: true,
});

const templateScopes = (action: PermissionCatalogAction) =>
  TEMPLATE_SCOPES.filter(scope => action.scopeTypes.includes(scope));

// Only permissions a template may carry: directly grantable, outside
// projects (Room templates), with a scope that needs no specific entity.
const canUseInTemplate = (action: PermissionCatalogAction) =>
  action.directGrantAllowed && !action.permissionCode.startsWith('project.') && templateScopes(action).length > 0;

// Person templates for the whole system: which permissions each position
// gets. Filled in per person at Settings → Users → edit → "Điền nhanh theo mẫu".
const SettingsUserPermissionTemplates: React.FC = () => {
  const toast = useToast();
  const [templates, setTemplates] = useState<UserPermissionTemplate[]>([]);
  const [catalog, setCatalog] = useState<PermissionAdminCatalog | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserPermissionTemplate>(emptyTemplate);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [positionQuery, setPositionQuery] = useState('');

  const load = async (keepCode?: string) => {
    setState('loading');
    try {
      const [rows, nextCatalog, positionResult] = await Promise.all([
        userPermissionTemplateService.list(),
        listPermissionAdminCatalog(),
        supabase.from('hrm_positions').select('id,name').eq('is_active', true).order('name').limit(1000),
      ]);
      if (positionResult.error) throw positionResult.error;
      setTemplates(rows);
      setCatalog(nextCatalog);
      setPositions((positionResult.data || []) as Position[]);
      const next = rows.find(row => row.code === keepCode) || rows[0];
      if (next) { setSelectedCode(next.code); setDraft(structuredClone(next)); setIsNew(false); }
      setState('ready');
    } catch (error) {
      logApiError('settings.userPermissionTemplates.load', error);
      setState('error');
    }
  };

  useEffect(() => { load(); }, []);

  const applications = useMemo(() => (catalog?.applications || [])
    .map(application => ({
      ...application,
      modules: application.modules
        .map(module => ({ ...module, actions: module.actions.filter(canUseInTemplate) }))
        .filter(module => module.actions.length > 0),
    }))
    .filter(application => application.modules.length > 0), [catalog]);

  const saved = templates.find(row => row.code === selectedCode);
  const dirty = isNew || JSON.stringify(saved) !== JSON.stringify(draft);
  const itemsByCode = useMemo(() => {
    const map = new Map<string, UserPermissionTemplateItem>();
    draft.items.forEach(item => map.set(item.permissionCode, item));
    return map;
  }, [draft.items]);

  const selectTemplate = (template: UserPermissionTemplate) => {
    setSelectedCode(template.code);
    setDraft(structuredClone(template));
    setIsNew(false);
  };

  const startNew = () => {
    setSelectedCode(null);
    setDraft(emptyTemplate());
    setIsNew(true);
  };

  const toggleAction = (action: PermissionCatalogAction) => setDraft(prev => {
    const exists = prev.items.some(item => item.permissionCode === action.permissionCode);
    const scopes = templateScopes(action);
    return {
      ...prev,
      items: exists
        ? prev.items.filter(item => item.permissionCode !== action.permissionCode)
        : [...prev.items, {
          permissionCode: action.permissionCode,
          scopeType: scopes.includes('global') && !scopes.includes('own') ? 'global' : scopes[0],
          ...(action.directGrantRequiresExpiry ? { expiresInDays: 365 } : {}),
        }],
    };
  });

  const setScope = (permissionCode: string, scopeType: TemplateScopeType) => setDraft(prev => ({
    ...prev,
    items: prev.items.map(item => item.permissionCode === permissionCode ? { ...item, scopeType } : item),
  }));

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
      await userPermissionTemplateService.save({ ...draft, code });
      toast.success('Đã lưu mẫu quyền', draft.name);
      await load(code);
    } catch (error) {
      logApiError('settings.userPermissionTemplates.save', error);
      toast.error('Không lưu được mẫu', getApiErrorMessage(error, 'Không thể lưu mẫu quyền theo vị trí.'));
    } finally {
      setSaving(false);
    }
  };

  const visiblePositions = useMemo(() => {
    const query = positionQuery.trim().toLocaleLowerCase('vi');
    return positions.filter(position => !draft.suggestedPositionIds.includes(position.id)
      && query && position.name.toLocaleLowerCase('vi').includes(query)).slice(0, 40);
  }, [positions, positionQuery, draft.suggestedPositionIds]);

  if (state === 'loading') {
    return <div className="flex items-center justify-center py-20 text-sm font-bold text-slate-400"><Loader2 size={18} className="mr-2 animate-spin" /> Đang tải mẫu quyền theo vị trí…</div>;
  }
  if (state === 'error') {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
        <p className="text-sm font-bold text-rose-800">Không tải được mẫu quyền theo vị trí</p>
        <button type="button" onClick={() => load()} className="mt-3 inline-flex items-center gap-1 rounded-xl bg-rose-700 px-3 py-2 text-xs font-black text-white"><RefreshCw size={12} /> Thử lại</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><UserCog size={20} /></div>
            <div>
              <h2 className="text-lg font-black text-slate-800">Mẫu quyền theo vị trí</h2>
              <p className="text-xs font-medium text-slate-500">
                Bộ quyền gợi ý cho từng vị trí trên toàn hệ thống. Áp cho từng người ở Người dùng → Sửa → "Điền nhanh theo mẫu vị trí", rồi thêm bớt riêng.
                Quyền trong dự án dùng "Mẫu quyền dự án"; lương, hợp đồng lao động, đãi ngộ cấp qua vai trò HR / HR Manage.
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
                {template.items.length} quyền{template.isActive ? '' : ' · đang tắt'}
              </span>
            </button>
          ))}
        </nav>

        <section className="min-w-0 space-y-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
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
            <textarea rows={2} value={draft.description || ''} onChange={event => setDraft(prev => ({ ...prev, description: event.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>

          <div>
            <p className="mb-2 text-xs font-bold text-slate-600">Quyền trong mẫu <span className="font-medium text-slate-400">· {draft.items.length} quyền</span></p>
            <div className="space-y-2">
              {applications.map(application => {
                const count = application.modules.reduce((sum, module) => sum + module.actions.filter(action => itemsByCode.has(action.permissionCode)).length, 0);
                return (
                  <details key={application.code} className="group rounded-xl border border-slate-100">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
                      <ChevronRight size={14} className="text-slate-400 transition group-open:rotate-90" />
                      <span className="flex-1 text-sm font-black text-slate-700">{application.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${count > 0 ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-50 text-slate-400'}`}>{count > 0 ? `${count} quyền` : 'Không có'}</span>
                    </summary>
                    <div className="space-y-3 border-t border-slate-100 px-3 py-3">
                      {application.modules.map(module => (
                        <div key={module.code}>
                          <p className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-slate-500">{module.label}</p>
                          <div className="space-y-1">
                            {module.actions.map(action => {
                              const item = itemsByCode.get(action.permissionCode);
                              const scopes = templateScopes(action);
                              return (
                                <div key={action.permissionCode} className="flex flex-wrap items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-slate-50">
                                  <label className="flex min-h-9 flex-1 cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
                                    <input type="checkbox" checked={Boolean(item)} onChange={() => toggleAction(action)} className="h-4 w-4 rounded accent-indigo-600" />
                                    {action.label}
                                  </label>
                                  {action.riskLevel === 'sensitive' && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-700">Nhạy cảm</span>}
                                  {item && action.directGrantRequiresExpiry && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">Hết hạn sau {item.expiresInDays || 365} ngày</span>}
                                  {item && scopes.length > 1 && (
                                    <select aria-label={`Phạm vi ${action.label}`} value={item.scopeType} onChange={event => setScope(action.permissionCode, event.target.value as TemplateScopeType)}
                                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600">
                                      {scopes.map(scope => <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>)}
                                    </select>
                                  )}
                                  {item && scopes.length === 1 && <span className="text-[11px] font-semibold text-slate-400">{SCOPE_LABELS[item.scopeType]}</span>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold text-slate-600">Gợi ý cho chức vụ <span className="font-medium text-slate-400">· khi sửa quyền người có chức vụ này, mẫu được chọn sẵn</span></p>
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
                {visiblePositions.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Không tìm thấy chức vụ.</p>}
                {visiblePositions.map(position => (
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
          <p className="text-[11px] text-slate-400">Sửa mẫu không đổi quyền của người đã được áp trước đó; chỉ dùng cho lần điền tiếp theo.</p>
        </section>
      </div>
    </div>
  );
};

export default SettingsUserPermissionTemplates;
