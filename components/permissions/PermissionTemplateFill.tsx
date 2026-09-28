import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Undo2, Wand2 } from 'lucide-react';
import { UserPermissionGrant } from '../../types';
import { PermissionAdminCatalog } from '../../lib/permissions/permissionTypes';
import {
  buildGrantsFromTemplate,
  orderUserTemplatesForPosition,
  userPermissionTemplateService,
  type UserPermissionTemplate,
  type UserPermissionTemplateMode,
} from '../../lib/userPermissionTemplateService';
import { logApiError } from '../../lib/apiError';

interface PermissionTemplateFillProps {
  userId: string;
  catalog: PermissionAdminCatalog;
  grants: readonly UserPermissionGrant[];
  inheritedCodes: readonly string[];
  reason: string;
  disabled: boolean;
  onGrantsChange: (grants: UserPermissionGrant[]) => void;
  onReasonChange: (reason: string) => void;
}

type Filled = { name: string; added: number; removed: number; skipped: number; before: UserPermissionGrant[] };

// "Fill from a template": the position template becomes the starting point of
// this person's own permissions; the Admin then adjusts single boxes below.
const PermissionTemplateFill: React.FC<PermissionTemplateFillProps> = ({
  userId, catalog, grants, inheritedCodes, reason, disabled, onGrantsChange, onReasonChange,
}) => {
  const [templates, setTemplates] = useState<UserPermissionTemplate[]>([]);
  const [positionId, setPositionId] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reload, setReload] = useState(0);
  const [selectedCode, setSelectedCode] = useState('');
  const [mode, setMode] = useState<UserPermissionTemplateMode>('merge');
  const [filled, setFilled] = useState<Filled | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    Promise.all([
      userPermissionTemplateService.list(),
      // The position only orders the list; an unknown position is not an error.
      userPermissionTemplateService.getUserPositionId(userId).catch(() => null),
    ])
      .then(([rows, position]) => {
        if (cancelled) return;
        setTemplates(rows);
        setPositionId(position);
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
  useEffect(() => { setFilled(null); }, [userId]);
  useEffect(() => {
    if (!selectedCode && ordered[0]) setSelectedCode(ordered[0].code);
  }, [ordered, selectedCode]);

  const selected = ordered.find(template => template.code === selectedCode);

  const fill = () => {
    if (!selected) return;
    const result = buildGrantsFromTemplate({
      current: grants, template: selected, mode, catalog, userId, inheritedCodes,
    });
    setFilled({ name: selected.name, added: result.added, removed: result.removed, skipped: result.skipped, before: [...grants] });
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
      <div className="flex items-center gap-2 text-xs font-black text-indigo-700">
        <Wand2 size={14} /> Điền nhanh theo mẫu vị trí
      </div>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <select
          aria-label="Mẫu quyền"
          value={selectedCode}
          onChange={event => setSelectedCode(event.target.value)}
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
