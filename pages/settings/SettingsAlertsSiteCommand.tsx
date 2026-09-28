import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, HardHat, Loader2, Pencil, RefreshCw, Save, Search, X } from 'lucide-react';
import { notificationAlertRuleService, type SiteCommandPosition } from '../../lib/notificationAlertRules';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

const isCommanderPosition = (name: string) => /chỉ huy trưởng/i.test(name);

// Which positions make up a project's site command (Ban chỉ huy công trường).
const SettingsAlertsSiteCommand: React.FC = () => {
  const toast = useToast();
  const [positions, setPositions] = useState<SiteCommandPosition[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setState('loading');
    try {
      setPositions(await notificationAlertRuleService.listSiteCommandPositions());
      setState('ready');
    } catch (error) {
      logApiError('settings.alerts.siteCommand.load', error);
      setState('error');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const selected = useMemo(() => positions.filter(position => position.isSiteCommand), [positions]);
  const commanderStaff = selected
    .filter(position => isCommanderPosition(position.name))
    .reduce((sum, position) => sum + position.projectStaffCount, 0);
  const hasCommanderPosition = selected.some(position => isCommanderPosition(position.name));

  const editable = useMemo(() => {
    const query = search.trim().toLowerCase();
    return positions
      .filter(position => position.isActive || draft.has(position.id))
      .filter(position => !query || `${position.name} ${position.code || ''}`.toLowerCase().includes(query))
      .sort((a, b) => Number(draft.has(b.id)) - Number(draft.has(a.id)) || a.name.localeCompare(b.name, 'vi'));
  }, [positions, draft, search]);

  const startEdit = () => {
    setDraft(new Set(selected.map(position => position.id)));
    setSearch('');
    setEditing(true);
  };

  const toggle = (id: string) => {
    setDraft(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const count = await notificationAlertRuleService.setSiteCommandPositions([...draft]);
      toast.success('Đã lưu Ban chỉ huy công trường', `${count} chức vụ thuộc BCH.`);
      setEditing(false);
      await load();
    } catch (error) {
      logApiError('settings.alerts.siteCommand.save', error);
      toast.error('Không lưu được', getApiErrorMessage(error, 'Không thể cập nhật chức vụ BCH.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
            <HardHat size={20} />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-800">Ban chỉ huy công trường (BCH)</h3>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Cảnh báo có chọn "Kèm Ban chỉ huy" gửi tới người giữ các chức vụ dưới đây trong nhân sự của đúng dự án đó.
            </p>
          </div>
        </div>
        {state === 'ready' && !editing && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
          >
            <Pencil size={14} /> Sửa chức vụ
          </button>
        )}
      </div>

      {state === 'loading' && (
        <div className="mt-4 flex items-center gap-2 text-sm font-bold text-slate-400">
          <Loader2 size={16} className="animate-spin" /> Đang tải chức vụ...
        </div>
      )}

      {state === 'error' && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          Không tải được danh sách chức vụ.
          <button type="button" onClick={load} className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-black text-red-700 hover:bg-red-100">
            <RefreshCw size={12} /> Thử lại
          </button>
        </div>
      )}

      {state === 'ready' && !editing && (
        <>
          {selected.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-3 text-sm font-bold text-slate-500">
              Chưa chọn chức vụ nào, nên "Kèm Ban chỉ huy" chưa gửi cho ai.
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              {selected.map(position => (
                <span key={position.id} className="inline-flex items-center gap-1.5 rounded-full border border-orange-100 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-800">
                  {position.name}
                  <span className={position.projectStaffCount === 0 ? 'text-orange-400' : 'text-orange-600'}>
                    · {position.projectStaffCount > 0 ? `${position.projectStaffCount} người` : 'chưa ai'}
                  </span>
                </span>
              ))}
            </div>
          )}
          {hasCommanderPosition && commanderStaff === 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              Chưa có ai được gán chức vụ Chỉ huy trưởng trong nhân sự dự án, nên cảnh báo chưa tới được Chỉ huy trưởng. Gán chức vụ ở Dự án → Nhân sự.
            </div>
          )}
        </>
      )}

      {state === 'ready' && editing && (
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <Search size={15} className="text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Tìm chức vụ..."
              className="w-full bg-transparent text-sm font-bold text-slate-700 outline-none"
            />
          </label>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-100 p-2">
            {editable.length === 0 && <p className="px-2 py-3 text-sm font-bold text-slate-400">Không có chức vụ phù hợp.</p>}
            {editable.map(position => (
              <label key={position.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={draft.has(position.id)}
                  onChange={() => toggle(position.id)}
                  className="h-4 w-4 rounded border-slate-300 text-orange-600"
                />
                <span className="flex-1 text-sm font-bold text-slate-700">{position.name}</span>
                <span className="text-[11px] font-bold text-slate-400">
                  {position.projectStaffCount > 0 ? `${position.projectStaffCount} người trong dự án` : 'Chưa ai'}
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-xs font-bold text-slate-500">Đã chọn {draft.size} chức vụ</span>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <X size={14} /> Huỷ
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default SettingsAlertsSiteCommand;
