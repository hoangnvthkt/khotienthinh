import React, { useEffect, useMemo, useState } from 'react';
import { CopyPlus, Eye, Loader2, Save, ShieldCheck } from 'lucide-react';
import type {
  BusinessRole,
  BusinessRoleImpactPreview,
  BusinessRoleItem,
  SaveBusinessRoleInput,
} from '../../lib/permissions/authorizationGovernanceTypes';
import { isIdentityBoundPermission } from '../../lib/permissions/permissionRisk';
import type { PermissionActionDefinition, PermissionScopeType } from '../../lib/permissions/permissionTypes';

interface BusinessRoleEditorProps {
  role: BusinessRole | null;
  permissionActions: readonly PermissionActionDefinition[];
  preview: BusinessRoleImpactPreview | null;
  disabled: boolean;
  onPreview: (items: BusinessRoleItem[]) => Promise<void>;
  onSave: (input: SaveBusinessRoleInput) => Promise<void>;
}

const itemKey = (item: BusinessRoleItem) => `${item.permissionCode}::${item.scopeType}::${item.scopeId}`;
const canonicalItems = (items: readonly BusinessRoleItem[]) => [...items]
  .map(itemKey)
  .sort()
  .join('|');

const BusinessRoleEditor: React.FC<BusinessRoleEditorProps> = ({
  role,
  permissionActions,
  preview,
  disabled,
  onPreview,
  onSave,
}) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<BusinessRoleItem[]>([]);
  const [reason, setReason] = useState('');
  const [previewedItemsKey, setPreviewedItemsKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [validationMessage, setValidationMessage] = useState('');

  useEffect(() => {
    setCode(role?.code || '');
    setName(role?.name || '');
    setDescription(role?.description || '');
    setItems(role?.items ? [...role.items] : []);
    setReason('');
    setPreviewedItemsKey(null);
    setValidationMessage('');
  }, [role]);

  const editableActions = useMemo(
    () => permissionActions.filter(action => !isIdentityBoundPermission(action.permissionCode)),
    [permissionActions],
  );
  const currentItemsKey = canonicalItems(items);
  const originalItemsKey = canonicalItems(role?.items || []);
  const itemChanged = currentItemsKey !== originalItemsKey;
  const previewMatches = preview !== null && previewedItemsKey === currentItemsKey;
  const historyBlocksItemMutation = itemChanged && previewMatches && preview.affectedPrincipalCount > 0;
  const editorDisabled = disabled || Boolean(role?.isSystem);

  const toggleAction = (action: PermissionActionDefinition, checked: boolean) => {
    setPreviewedItemsKey(null);
    if (!checked) {
      setItems(current => current.filter(item => item.permissionCode !== action.permissionCode));
      return;
    }
    const scopeType = (action.scopeTypes?.[0] || 'global') as PermissionScopeType;
    setItems(current => [...current, {
      permissionCode: action.permissionCode,
      scopeType,
      scopeId: '*',
      sortOrder: action.sortOrder || current.length * 10 + 10,
    }]);
  };

  const updateItem = (permissionCode: string, patch: Partial<BusinessRoleItem>) => {
    setPreviewedItemsKey(null);
    setItems(current => current.map(item => item.permissionCode === permissionCode ? { ...item, ...patch } : item));
  };

  const handlePreview = async () => {
    if (items.length === 0) {
      setValidationMessage('Business Role cần ít nhất một quyền.');
      return;
    }
    setBusy('preview');
    setValidationMessage('');
    try {
      await onPreview(items);
      setPreviewedItemsKey(canonicalItems(items));
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    if (!code.trim() || !name.trim() || reason.trim().length < 10 || items.length === 0) {
      setValidationMessage('Nhập mã, tên, ít nhất một quyền và lý do từ 10 ký tự.');
      return;
    }
    if (itemChanged && !previewMatches) {
      setValidationMessage('Hãy preview đúng danh sách quyền hiện tại trước khi lưu.');
      return;
    }
    if (historyBlocksItemMutation) {
      setValidationMessage('Role đã có lịch sử phân công. Hãy clone/tạo role mới rồi phân công lại.');
      return;
    }
    setBusy('save');
    setValidationMessage('');
    try {
      await onSave({
        roleTemplateId: role?.id || null,
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim(),
        items,
        reason: reason.trim(),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-700"><ShieldCheck size={16} className="text-violet-600" /> {role ? `Sửa ${role.name}` : 'Tạo Business Role'}</div>
        {role?.isSystem && <span className="rounded bg-slate-200 px-2 py-1 text-[9px] font-black text-slate-600">SYSTEM · chỉ đọc</span>}
      </div>
      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={code} onChange={event => setCode(event.target.value.replace(/[^A-Za-z0-9_]/g, '').toUpperCase())} disabled={editorDisabled || Boolean(role)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:bg-slate-50" placeholder="Mã role" />
          <input value={name} onChange={event => setName(event.target.value)} disabled={editorDisabled} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:bg-slate-50" placeholder="Tên role" />
        </div>
        <textarea value={description} onChange={event => setDescription(event.target.value)} disabled={editorDisabled} rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:bg-slate-50" placeholder="Mô tả" />
        <div className="max-h-72 space-y-2 overflow-auto rounded-xl border border-slate-200 p-3">
          {editableActions.map(action => {
            const item = items.find(candidate => candidate.permissionCode === action.permissionCode);
            return (
              <div key={action.permissionCode} className="grid items-center gap-2 rounded-lg border border-slate-100 p-2 sm:grid-cols-[1fr_140px_150px]">
                <label className="flex min-w-0 items-center gap-2 text-[11px] font-bold text-slate-600">
                  <input type="checkbox" checked={Boolean(item)} disabled={editorDisabled} onChange={event => toggleAction(action, event.target.checked)} className="accent-violet-600" />
                  <span className="truncate">{action.label} · {action.permissionCode}</span>
                </label>
                <select value={item?.scopeType || action.scopeTypes?.[0] || 'global'} disabled={editorDisabled || !item} onChange={event => updateItem(action.permissionCode, { scopeType: event.target.value as PermissionScopeType, scopeId: event.target.value === 'global' ? '*' : item?.scopeId || '*' })} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold disabled:bg-slate-50">
                  {(action.scopeTypes?.length ? action.scopeTypes : ['global']).map(scopeType => <option key={scopeType} value={scopeType}>{scopeType}</option>)}
                </select>
                <input value={item?.scopeId || '*'} disabled={editorDisabled || !item || item.scopeType === 'global'} onChange={event => updateItem(action.permissionCode, { scopeId: event.target.value || '*' })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[10px] font-bold disabled:bg-slate-50" placeholder="scope id" />
              </div>
            );
          })}
        </div>
        <textarea value={reason} onChange={event => setReason(event.target.value)} disabled={editorDisabled} rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:bg-slate-50" placeholder="Lý do thay đổi (ít nhất 10 ký tự)" />
        {preview && previewMatches && (
          <div className="grid gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-[10px] font-bold text-blue-700 sm:grid-cols-2">
            <span>{preview.affectedPrincipalCount} principal từng bị ảnh hưởng</span>
            <span>{preview.affectedScopeCount} scope từng bị ảnh hưởng</span>
            <span>+{preview.addedPermissionKeys.length} quyền</span>
            <span>-{preview.removedPermissionKeys.length} quyền</span>
          </div>
        )}
        {historyBlocksItemMutation && <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-700"><CopyPlus size={15} /> Role có lịch sử phân công; hãy clone/tạo role mới để đổi tập quyền.</div>}
        {validationMessage && <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700">{validationMessage}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={handlePreview} disabled={editorDisabled || busy !== null} className="flex items-center gap-2 rounded-lg border border-blue-200 px-4 py-2 text-xs font-black text-blue-700 disabled:opacity-50">{busy === 'preview' ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview tác động</button>
          <button type="button" onClick={handleSave} disabled={editorDisabled || busy !== null || historyBlocksItemMutation} className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">{busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu role</button>
        </div>
      </div>
    </section>
  );
};

export default BusinessRoleEditor;
