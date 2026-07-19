import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CopyPlus, Eye, Loader2, Save, Search, ShieldCheck } from 'lucide-react';
import type {
  BusinessRole,
  BusinessRoleImpactPreview,
  BusinessRoleItem,
  SaveBusinessRoleInput,
} from '../../lib/permissions/authorizationGovernanceTypes';
import { permissionRegistry } from '../../lib/permissions/permissionRegistry';
import { isIdentityBoundPermission } from '../../lib/permissions/permissionRisk';
import type {
  PermissionActionDefinition,
  PermissionModuleDefinition,
  PermissionScope,
  PermissionScopeType,
} from '../../lib/permissions/permissionTypes';
import type { PermissionScopeLookupOptionsByType } from '../../lib/permissions/permissionScopeLookupService';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import PermissionScopePicker from './PermissionScopePicker';

interface BusinessRoleEditorProps {
  role: BusinessRole | null;
  permissionActions: readonly PermissionActionDefinition[];
  preview: BusinessRoleImpactPreview | null;
  disabled: boolean;
  scopeLookupOptions?: PermissionScopeLookupOptionsByType;
  onPreview: (items: BusinessRoleItem[]) => Promise<void>;
  onSave: (input: SaveBusinessRoleInput) => Promise<void>;
}

interface GroupedModule {
  module: PermissionModuleDefinition;
  actions: PermissionActionDefinition[];
  selectedCount: number;
  totalCount: number;
}

const itemKey = (item: BusinessRoleItem) => `${item.permissionCode}::${item.scopeType}::${item.scopeId}`;
const canonicalItems = (items: readonly BusinessRoleItem[]) => [...items]
  .map(itemKey)
  .sort()
  .join('|');

const actionModuleCodeByPermission = new Map<string, string>(
  permissionRegistry.flatMap(application =>
    application.modules.flatMap(module =>
      module.actions.map(action => [action.permissionCode, module.code] as const),
    ),
  ),
);

const getDefaultExpandedModules = (role: BusinessRole | null) => {
  const selectedModules = new Set(
    (role?.items || [])
      .map(item => actionModuleCodeByPermission.get(item.permissionCode))
      .filter((moduleCode): moduleCode is string => Boolean(moduleCode)),
  );
  if (selectedModules.size > 0) return selectedModules;
  const firstModule = permissionRegistry.flatMap(application => application.modules)[0];
  return new Set(firstModule ? [firstModule.code] : []);
};

const getActionScopeTypes = (action: PermissionActionDefinition): readonly PermissionScopeType[] =>
  action.scopeTypes?.length ? action.scopeTypes : ['global'];

const BusinessRoleEditor: React.FC<BusinessRoleEditorProps> = ({
  role,
  permissionActions,
  preview,
  disabled,
  scopeLookupOptions,
  onPreview,
  onSave,
}) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<BusinessRoleItem[]>([]);
  const [reason, setReason] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(() => getDefaultExpandedModules(null));
  const [previewedItemsKey, setPreviewedItemsKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [validationMessage, setValidationMessage] = useState('');

  useEffect(() => {
    setCode(role?.code || '');
    setName(role?.name || '');
    setDescription(role?.description || '');
    setItems(role?.items ? [...role.items] : []);
    setReason('');
    setSearchQuery('');
    setShowSelectedOnly(false);
    setExpandedModules(getDefaultExpandedModules(role));
    setPreviewedItemsKey(null);
    setValidationMessage('');
  }, [role]);

  const editableActions = useMemo(
    () => permissionActions.filter(action =>
      !isIdentityBoundPermission(action.permissionCode) ||
      Boolean(role?.isSystem && role.items.some(item => item.permissionCode === action.permissionCode))
    ),
    [permissionActions, role],
  );
  const editableActionByCode = useMemo(
    () => new Map(editableActions.map(action => [action.permissionCode, action] as const)),
    [editableActions],
  );
  const itemsByPermissionCode = useMemo(
    () => new Map(items.map(item => [item.permissionCode, item] as const)),
    [items],
  );
  const groupedApplications = useMemo(() => permissionRegistry
    .map(application => {
      const modules = application.modules
        .map<GroupedModule>(module => {
          const moduleActions = module.actions
            .map(action => editableActionByCode.get(action.permissionCode))
            .filter((action): action is PermissionActionDefinition => Boolean(action));
          const selectedCount = moduleActions.filter(action => itemsByPermissionCode.has(action.permissionCode)).length;
          const actions = moduleActions.filter(action => {
            const item = itemsByPermissionCode.get(action.permissionCode);
            if (showSelectedOnly && !item) return false;
            return matchesSearchQueryMultiple([
              application.code,
              application.label,
              module.code,
              module.label,
              module.description,
              action.label,
              action.permissionCode,
              action.description,
              item?.scopeType,
              item?.scopeId,
            ], searchQuery);
          });
          return { module, actions, selectedCount, totalCount: moduleActions.length };
        })
        .filter(module => module.actions.length > 0);

      return {
        code: application.code,
        label: application.label,
        modules,
        selectedCount: modules.reduce((total, module) => total + module.selectedCount, 0),
      };
    })
    .filter(application => application.modules.length > 0), [editableActionByCode, itemsByPermissionCode, searchQuery, showSelectedOnly]);

  const currentItemsKey = canonicalItems(items);
  const originalItemsKey = canonicalItems(role?.items || []);
  const itemChanged = currentItemsKey !== originalItemsKey;
  const previewMatches = preview !== null && previewedItemsKey === currentItemsKey;
  const historyBlocksItemMutation = itemChanged && previewMatches && preview.affectedPrincipalCount > 0;
  const editorDisabled = disabled || Boolean(role?.isSystem);
  const filteredActionCount = groupedApplications.reduce(
    (total, application) => total + application.modules.reduce((moduleTotal, module) => moduleTotal + module.actions.length, 0),
    0,
  );

  const toggleExpandedModule = (moduleCode: string) => {
    setExpandedModules(current => {
      const next = new Set(current);
      if (next.has(moduleCode)) next.delete(moduleCode);
      else next.add(moduleCode);
      return next;
    });
  };

  const toggleAction = (action: PermissionActionDefinition, checked: boolean) => {
    setPreviewedItemsKey(null);
    if (!checked) {
      setItems(current => current.filter(item => item.permissionCode !== action.permissionCode));
      return;
    }
    const scopeType = getActionScopeTypes(action)[0] || 'global';
    setItems(current => current.some(item => item.permissionCode === action.permissionCode)
      ? current
      : [...current, {
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

  const updateItemScope = (permissionCode: string, scope: PermissionScope) => {
    const scopeType = (scope.scopeType || 'global') as PermissionScopeType;
    updateItem(permissionCode, {
      scopeType,
      scopeId: scopeType === 'global' ? '*' : scope.scopeId || '*',
    });
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
    } catch {
      setValidationMessage('Không thể preview tác động Business Role. Vui lòng thử lại.');
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
    } catch {
      setValidationMessage('Không thể lưu Business Role. Backend đã từ chối thay đổi.');
    } finally {
      setBusy(null);
    }
  };

  const renderAction = (action: PermissionActionDefinition) => {
    const item = itemsByPermissionCode.get(action.permissionCode);
    const scopeTypes = getActionScopeTypes(action);

    return (
      <div key={action.permissionCode} className="grid gap-3 rounded-lg border border-slate-100 px-3 py-2 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <label className="flex min-w-0 items-start gap-3 text-xs font-bold text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(item)}
            disabled={editorDisabled}
            onChange={event => toggleAction(action, event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 rounded accent-violet-600"
          />
          <span className="min-w-0">
            <span className="block text-sm font-black text-slate-700">{action.label}</span>
            <span className="mt-0.5 block break-all text-[10px] text-slate-400">{action.permissionCode}</span>
            <span className="mt-1 block text-[10px] text-slate-400">
              {scopeTypes.join(', ')}
            </span>
          </span>
        </label>
        {item ? (
          <PermissionScopePicker
            value={{ scopeType: item.scopeType, scopeId: item.scopeId }}
            onChange={scope => updateItemScope(action.permissionCode, scope)}
            disabled={editorDisabled}
            lookupOptions={scopeLookupOptions}
            allowedScopeTypes={scopeTypes}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-400">
            Chọn quyền để cấu hình scope
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-700">
          <ShieldCheck size={16} className="text-violet-600" />
          {role ? `Sửa ${role.name}` : 'Tạo Business Role'}
        </div>
        {role?.isSystem && <span className="rounded bg-slate-200 px-2 py-1 text-[9px] font-black text-slate-600">SYSTEM · chỉ đọc</span>}
      </div>
      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={code} onChange={event => setCode(event.target.value.replace(/[^A-Za-z0-9_]/g, '').toUpperCase())} disabled={editorDisabled || Boolean(role)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:bg-slate-50" placeholder="Mã role" />
          <input value={name} onChange={event => setName(event.target.value)} disabled={editorDisabled} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:bg-slate-50" placeholder="Tên role" />
        </div>
        <textarea value={description} onChange={event => setDescription(event.target.value)} disabled={editorDisabled} rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:bg-slate-50" placeholder="Mô tả" />

        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className="relative block">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-9 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-violet-200"
              placeholder="Tìm theo module, quyền, mã quyền..."
            />
          </label>
          <button
            type="button"
            onClick={() => setShowSelectedOnly(current => !current)}
            className={`rounded-lg border px-3 py-2 text-xs font-black ${showSelectedOnly ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
          >
            Đã chọn {items.length}
          </button>
        </div>

        <div className="space-y-3 rounded-xl border border-slate-200 p-3">
          {groupedApplications.length === 0 && (
            <div className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs font-bold text-slate-400">
              Không có quyền phù hợp.
            </div>
          )}
          {groupedApplications.map(application => (
            <div key={application.code} className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-wide text-slate-400">
                <span>{application.label}</span>
                <span>{application.selectedCount}/{items.length || filteredActionCount}</span>
              </div>
              {application.modules.map(({ module, actions, selectedCount, totalCount }) => {
                const expanded = expandedModules.has(module.code) || Boolean(searchQuery.trim()) || showSelectedOnly;
                return (
                  <section key={module.code} className="overflow-hidden rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => toggleExpandedModule(module.code)}
                      className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                    >
                      {expanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black text-slate-800">{module.label}</span>
                        <span className="mt-0.5 block text-[10px] font-bold text-slate-400">
                          {selectedCount}/{totalCount} quyền đã chọn
                        </span>
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">{actions.length}</span>
                    </button>
                    {expanded && (
                      <div className="space-y-2 border-t border-slate-100 p-2">
                        {actions.map(action => renderAction(action))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          ))}
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
