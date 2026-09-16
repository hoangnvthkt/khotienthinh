import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, LockKeyhole,
  Plus, RefreshCcw, Save, ShieldCheck, UserPlus, XCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { listPermissionAdminCatalog } from '../../lib/permissions/permissionCatalogService';
import { PermissionAdminCatalog, PermissionCatalogAction, PermissionScopeType } from '../../lib/permissions/permissionTypes';
import { canPerform } from '../../lib/permissions/permissionService';
import {
  assignBusinessRole,
  BusinessRoleAdminSnapshot,
  BusinessRoleAssignmentPreview,
  BusinessRoleItem,
  BusinessRoleTemplate,
  getBusinessRoleAdminSnapshot,
  previewBusinessRoleAssignment,
  revokeBusinessRoleAssignment,
  saveBusinessRole,
} from '../../lib/permissions/businessRoleAdminService';

const STEPS = [
  { id: 1, label: 'Thông tin chung' },
  { id: 2, label: 'Cấu hình bảng phân quyền' },
  { id: 3, label: 'Gán đối tượng' },
] as const;

const SCOPE_LABELS: Record<PermissionScopeType, string> = {
  global: 'Toàn hệ thống', own: 'Chính người dùng', assigned: 'Được giao',
  project: 'Dự án', construction_site: 'Công trường', warehouse: 'Kho',
  department: 'Phòng ban', direct_reports: 'Cấp dưới trực tiếp',
  org_unit: 'Đơn vị tổ chức', work_workspace: 'Không gian công việc',
};

const allScopeTypes = Object.keys(SCOPE_LABELS) as PermissionScopeType[];
const codeFromName = (name: string) => name.trim().toUpperCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

type Draft = { id?: string; code: string; name: string; description: string; version: number; items: BusinessRoleItem[] };
const emptyDraft = (): Draft => ({ code: '', name: '', description: '', version: 0, items: [] });
const draftFromTemplate = (template: BusinessRoleTemplate): Draft => ({
  id: template.id, code: template.code, name: template.name,
  description: template.description || '', version: template.version,
  items: template.items.map(item => ({ ...item })),
});

const SettingsRoleTemplates: React.FC = () => {
  const { users, warehouses } = useApp();
  const toast = useToast();
  const [snapshot, setSnapshot] = useState<BusinessRoleAdminSnapshot | null>(null);
  const [catalog, setCatalog] = useState<PermissionAdminCatalog | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');
  const [saveReason, setSaveReason] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const [scopeType, setScopeType] = useState<PermissionScopeType>('global');
  const [scopeId, setScopeId] = useState('*');
  const [expiresAt, setExpiresAt] = useState('');
  const [assignReason, setAssignReason] = useState('');
  const [preview, setPreview] = useState<BusinessRoleAssignmentPreview | null>(null);
  const [controlOwnerUserId, setControlOwnerUserId] = useState('');
  const [controlReason, setControlReason] = useState('');
  const [compensatingControls, setCompensatingControls] = useState('');
  const [controlExpiresAt, setControlExpiresAt] = useState('');
  const [revokeReason, setRevokeReason] = useState('');

  const templates = snapshot?.templates || [];
  const selected = templates.find(item => item.id === selectedId);
  const activeUsers = users.filter(user => user.isActive !== false && user.accountStatus !== 'DISABLED');
  const actionByCode = useMemo(() => new Map(
    (catalog?.applications || []).flatMap(app => app.modules.flatMap(module => module.actions))
      .map(action => [action.permissionCode, action]),
  ), [catalog]);

  const load = async (preferredId?: string) => {
    setLoading(true); setError('');
    try {
      const [nextSnapshot, nextCatalog] = await Promise.all([
        getBusinessRoleAdminSnapshot(), listPermissionAdminCatalog(),
      ]);
      setSnapshot(nextSnapshot); setCatalog(nextCatalog);
      const nextId = preferredId || selectedId || nextSnapshot.templates[0]?.id || '';
      setSelectedId(nextId);
      const next = nextSnapshot.templates.find(item => item.id === nextId);
      setDraft(next ? draftFromTemplate(next) : emptyDraft());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được mẫu quyền.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!selected) return;
    setDraft(draftFromTemplate(selected));
    setScopeType(selected.code === 'SUPER_ADMIN' ? 'global' : 'global'); setScopeId('*');
  }, [selectedId]);

  const availableAssignmentScopes = useMemo(() => {
    if (selected?.code === 'SUPER_ADMIN') return ['global'] as PermissionScopeType[];
    if (!draft.items.length) return ['global'] as PermissionScopeType[];
    return allScopeTypes.filter(candidate => draft.items.every(item => {
      const action = actionByCode.get(item.permissionCode);
      if (!action) return false;
      if (candidate === 'global') return action.scopeTypes.includes(item.scopeType);
      if (item.scopeType !== 'global') return item.scopeType === candidate;
      return action.scopeTypes.includes(candidate);
    }));
  }, [selected?.code, draft.items, actionByCode]);

  useEffect(() => {
    if (!availableAssignmentScopes.includes(scopeType)) {
      const next = availableAssignmentScopes[0] || 'global';
      setScopeType(next); setScopeId(next === 'global' ? '*' : '');
    }
  }, [availableAssignmentScopes, scopeType]);
  useEffect(() => {
    setPreview(null);
    if (scopeType === 'global') setScopeId('*');
    else if ((scopeType === 'own' || scopeType === 'assigned') && targetUserId) setScopeId(targetUserId);
    else setScopeId('');
  }, [scopeType, targetUserId]);

  const chooseTemplate = (template: BusinessRoleTemplate) => {
    setSelectedId(template.id); setPreview(null); setStep(1);
    setSaveReason(''); setAssignReason('');
  };
  const startNew = () => {
    setSelectedId(''); setDraft(emptyDraft()); setStep(1); setPreview(null);
    setSaveReason(''); setAssignReason('');
  };
  const isLocked = Boolean(selected?.locked);
  const permissionsImmutable = Boolean(selected?.assignments.length);

  const toggleAction = (action: PermissionCatalogAction) => {
    if (isLocked || permissionsImmutable || !['enforced', 'verified'].includes(action.grantReadiness)) return;
    setDraft(current => {
      const exists = current.items.some(item => item.permissionCode === action.permissionCode);
      if (exists) return { ...current, items: current.items.filter(item => item.permissionCode !== action.permissionCode) };
      const scopeType = action.scopeTypes.includes('global') ? 'global' : action.scopeTypes[0];
      return { ...current, items: [...current.items, {
        permissionCode: action.permissionCode, scopeType, scopeId: '*', sortOrder: current.items.length,
      }] };
    });
  };
  const changeItemScope = (permissionCode: string, nextScope: PermissionScopeType) => setDraft(current => ({
    ...current,
    items: current.items.map(item => item.permissionCode === permissionCode
      ? { ...item, scopeType: nextScope, scopeId: '*' } : item),
  }));

  const saveTemplate = async () => {
    if (isLocked) { setStep(3); return; }
    setBusy(true); setError('');
    try {
      const receipt = await saveBusinessRole({
        roleTemplateId: draft.id, expectedRoleVersion: draft.version,
        code: draft.code || codeFromName(draft.name), name: draft.name,
        description: draft.description, items: draft.items, reason: saveReason,
      });
      toast.success('Đã lưu mẫu quyền', 'Phiên bản mẫu đã được cập nhật và ghi audit.');
      await load(receipt.roleTemplateId); setStep(3);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không lưu được mẫu quyền.'); }
    finally { setBusy(false); }
  };

  const runPreview = async () => {
    if (!selected || !targetUserId || !scopeId) return;
    setBusy(true); setError(''); setPreview(null);
    try {
      setPreview(await previewBusinessRoleAssignment({
        targetUserId, roleTemplateId: selected.id, scopeType, scopeId,
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tạo được preview.'); }
    finally { setBusy(false); }
  };

  const assign = async () => {
    if (!selected || !preview) return;
    setBusy(true); setError('');
    try {
      const warningAcceptances = preview.warnings.map(warning => ({
        ruleCode: warning.ruleCode, scopeType: warning.scopeType, scopeId: warning.scopeId,
        reason: controlReason, controlOwnerUserId, compensatingControls,
        expiresAt: new Date(controlExpiresAt).toISOString(),
      }));
      await assignBusinessRole({
        targetUserId, roleTemplateId: selected.id, expectedRoleVersion: preview.roleVersion,
        scopeType, scopeId, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        reason: assignReason, warningAcceptances,
        expectedPreviewFingerprint: preview.fingerprint,
      });
      toast.success('Đã gán mẫu quyền', 'Assignment đã được ghi audit.');
      setPreview(null); setAssignReason(''); await load(selected.id); setStep(3);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không gán được mẫu quyền.'); }
    finally { setBusy(false); }
  };

  const revoke = async (assignmentId: string) => {
    setBusy(true); setError('');
    try {
      await revokeBusinessRoleAssignment(assignmentId, revokeReason);
      toast.success('Đã thu hồi mẫu quyền'); setRevokeReason('');
      await load(selectedId); setStep(3);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thu hồi được assignment.'); }
    finally { setBusy(false); }
  };

  const warningsReady = !preview?.warnings.length || (
    controlOwnerUserId && controlReason.trim().length >= 10
    && compensatingControls.trim().length >= 10 && controlExpiresAt
  );
  const canAssign = Boolean(preview && preview.hardDenies.length === 0 && warningsReady
    && assignReason.trim().length >= 10);

  if (loading) return <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-500">Đang tải mẫu quyền…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 md:flex-row md:items-center md:justify-between">
        <div><h2 className="text-xl font-black text-slate-800">Mẫu quyền & phân quyền</h2><p className="text-xs text-slate-500">Mẫu chứa action; assignment mang phạm vi cụ thể theo từng người.</p></div>
        <div className="flex gap-2"><button onClick={() => void load(selectedId)} className="rounded-xl border px-3 py-2 text-xs font-bold"><RefreshCcw size={14} className="mr-1 inline" />Tải lại</button><button onClick={startNew} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white"><Plus size={14} className="mr-1 inline" />Tạo mẫu</button></div>
      </div>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-2 px-2 text-xs font-black uppercase text-slate-500">Danh sách mẫu</div>
          <div className="max-h-[720px] space-y-1 overflow-y-auto">
            {templates.map(template => <button key={template.id} onClick={() => chooseTemplate(template)} className={`w-full rounded-xl border px-3 py-2 text-left ${selectedId === template.id ? 'border-blue-300 bg-blue-50' : 'border-transparent hover:bg-slate-50'}`}>
              <div className="flex items-center justify-between gap-2"><span className="text-sm font-bold text-slate-800">{template.name}</span>{template.locked && <LockKeyhole size={13} className="text-slate-400" />}</div>
              <div className="mt-1 text-[10px] text-slate-500">{template.code} · {template.effectiveActionCount} quyền · {template.assignments.length} người</div>
            </button>)}
          </div>
        </aside>
        <main className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-6 grid grid-cols-3 gap-2">
            {STEPS.map(item => <button key={item.id} onClick={() => item.id < step || selected ? setStep(item.id) : undefined} className={`rounded-xl border p-3 text-left ${step === item.id ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`}><span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-black">{item.id < step ? <Check size={14} /> : item.id}</span><span className="text-xs font-bold">{item.label}</span></button>)}
          </div>

          {step === 1 && <section className="space-y-4">
            <div><h3 className="text-lg font-black text-slate-800">Thông tin chung</h3><p className="text-xs text-slate-500">Tên, mã và nguyên tắc cập nhật của mẫu quyền.</p></div>
            {selected?.code === 'SUPER_ADMIN' && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><ShieldCheck size={16} className="mr-2 inline" /><b>SUPER_ADMIN</b> là mẫu động bị khóa, tự nhận capability hiện tại và tương lai; hiện không có assignment thật.</div>}
            <label className="block text-xs font-bold text-slate-600">Tên mẫu quyền<input value={draft.name} disabled={isLocked} onChange={event => setDraft(current => ({ ...current, name: event.target.value, code: current.id ? current.code : codeFromName(event.target.value) }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50" /></label>
            <label className="block text-xs font-bold text-slate-600">Mã mẫu<input value={draft.code} disabled={Boolean(draft.id) || isLocked} onChange={event => setDraft(current => ({ ...current, code: codeFromName(event.target.value) }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50" /></label>
            <label className="block text-xs font-bold text-slate-600">Mô tả<textarea value={draft.description} disabled={isLocked} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} rows={3} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50" /></label>
            <div className="flex justify-end"><button disabled={!draft.name.trim() || !draft.code.trim()} onClick={() => setStep(2)} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Tiếp tục <ChevronRight size={14} className="inline" /></button></div>
          </section>}

          {step === 2 && <section className="space-y-4">
            <div><h3 className="text-lg font-black text-slate-800">Cấu hình bảng phân quyền</h3><p className="text-xs text-slate-500">Ứng dụng → module → action. “Toàn quyền” của mẫu thường là snapshot tại lúc lưu.</p></div>
            {permissionsImmutable && !isLocked && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Mẫu đang có assignment nên tập quyền bị khóa. Hãy tạo mẫu mới và chuyển người dùng để tránh đổi quyền ngầm.</div>}
            {selected?.dynamic ? <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 text-sm text-indigo-900"><LockKeyhole size={18} className="mr-2 inline" />Mẫu động đang bao phủ <b>{selected.effectiveActionCount}</b> capability active. Không tạo item tĩnh và không cho sửa checkbox.</div> :
              <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">{catalog?.applications.map(app => <details key={app.code} className="rounded-xl border" open><summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-800">{app.label}</summary><div className="space-y-3 border-t p-3">{app.modules.map(module => <div key={module.code}><div className="mb-2 text-xs font-bold text-slate-600">{module.label}</div><div className="grid gap-2 md:grid-cols-2">{module.actions.map(action => {
                const item = draft.items.find(candidate => candidate.permissionCode === action.permissionCode);
                const disabled = isLocked || permissionsImmutable || !['enforced', 'verified'].includes(action.grantReadiness);
                return <div key={action.permissionCode} className={`rounded-lg border p-2 ${item ? 'border-blue-200 bg-blue-50' : 'border-slate-100'}`}><label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={Boolean(item)} disabled={disabled} onChange={() => toggleAction(action)} className="mt-0.5" /><span><b>{action.label}</b><span className="block font-mono text-[9px] text-slate-400">{action.permissionCode}</span></span></label>{item && <select value={item.scopeType} disabled={disabled} onChange={event => changeItemScope(action.permissionCode, event.target.value as PermissionScopeType)} className="mt-2 w-full rounded-lg border bg-white px-2 py-1 text-[10px]">{action.scopeTypes.map(scope => <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>)}</select>}</div>;
              })}</div></div>)}</div></details>)}</div>}
            {!isLocked && <label className="block text-xs font-bold text-slate-600">Lý do tạo/cập nhật<textarea value={saveReason} onChange={event => setSaveReason(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="Ít nhất 10 ký tự" /></label>}
            <div className="flex justify-between"><button onClick={() => setStep(1)} className="rounded-xl border px-4 py-2 text-xs font-bold"><ChevronLeft size={14} className="inline" /> Quay lại</button><button disabled={busy || (!isLocked && saveReason.trim().length < 10)} onClick={() => void saveTemplate()} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">{isLocked ? 'Tiếp tục' : <><Save size={14} className="inline" /> Lưu và tiếp tục</>}</button></div>
          </section>}

          {step === 3 && selected && <section className="space-y-4">
            <div><h3 className="text-lg font-black text-slate-800">Gán đối tượng</h3><p className="text-xs text-slate-500">Chọn người và phạm vi; phải kiểm tra tác động trước khi gán.</p></div>
            <div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-bold text-slate-600">Người dùng<select value={targetUserId} onChange={event => setTargetUserId(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2"><option value="">-- Chọn người dùng --</option>{activeUsers.map(user => <option key={user.id} value={user.id}>{user.name} — {user.email}</option>)}</select></label><label className="text-xs font-bold text-slate-600">Phạm vi<select value={scopeType} onChange={event => setScopeType(event.target.value as PermissionScopeType)} className="mt-1 w-full rounded-xl border px-3 py-2">{availableAssignmentScopes.map(scope => <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>)}</select></label></div>
            {scopeType === 'warehouse' ? <label className="block text-xs font-bold text-slate-600">Kho<select value={scopeId} onChange={event => setScopeId(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2"><option value="">-- Chọn kho --</option>{warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label> : !['global', 'own', 'assigned'].includes(scopeType) && <label className="block text-xs font-bold text-slate-600">ID phạm vi<input value={scopeId} onChange={event => setScopeId(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2" /></label>}
            <div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-bold text-slate-600">Hết hạn (nếu có)<input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2" /></label><label className="text-xs font-bold text-slate-600">Lý do gán<input value={assignReason} onChange={event => setAssignReason(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="Ít nhất 10 ký tự" /></label></div>
            <button disabled={busy || !targetUserId || !scopeId} onClick={() => void runPreview()} className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-xs font-black text-blue-700 disabled:opacity-40">Kiểm tra tác động</button>
            {preview && <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-xs text-indigo-950"><div className="grid grid-cols-3 gap-2 text-center"><div><b className="block text-lg">{preview.permissionCount}</b>Quyền</div><div><b className="block text-lg">{preview.sensitivePermissionCount}</b>Nhạy cảm</div><div><b className="block text-lg">{preview.businessApprovalPermissionCount}</b>Duyệt nghiệp vụ</div></div>{preview.dynamic && <div className="rounded-lg bg-white/70 p-2 font-bold">Dynamic: capability tương lai cũng tự được bao phủ.</div>}{preview.hardDenies.map(finding => <div key={finding.ruleCode} className="rounded-lg bg-rose-100 p-2 text-rose-800"><XCircle size={14} className="mr-1 inline" />{finding.message || finding.ruleCode}</div>)}{preview.warnings.length > 0 && <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="font-black text-amber-900"><AlertTriangle size={14} className="mr-1 inline" />{preview.warnings.length} cảnh báo SoD cần kiểm soát bù</div><select value={controlOwnerUserId} onChange={event => setControlOwnerUserId(event.target.value)} className="w-full rounded-lg border px-2 py-2"><option value="">-- Người kiểm soát có quyền audit --</option>{activeUsers.filter(user => user.id !== targetUserId && canPerform(user, 'system.authorization.audit')).map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select><input value={controlReason} onChange={event => setControlReason(event.target.value)} placeholder="Lý do chấp nhận cảnh báo" className="w-full rounded-lg border px-2 py-2" /><textarea value={compensatingControls} onChange={event => setCompensatingControls(event.target.value)} placeholder="Biện pháp kiểm soát bù" className="w-full rounded-lg border px-2 py-2" /><input type="datetime-local" value={controlExpiresAt} onChange={event => setControlExpiresAt(event.target.value)} className="w-full rounded-lg border px-2 py-2" /></div>}</div>}
            <div className="flex justify-between"><button onClick={() => setStep(2)} className="rounded-xl border px-4 py-2 text-xs font-bold"><ChevronLeft size={14} className="inline" /> Quay lại</button><button disabled={busy || !canAssign} onClick={() => void assign()} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40"><UserPlus size={14} className="mr-1 inline" />Gán mẫu quyền</button></div>
            <div className="border-t pt-4"><h4 className="mb-2 text-sm font-black text-slate-800">Assignment đang hiệu lực</h4><input value={revokeReason} onChange={event => setRevokeReason(event.target.value)} placeholder="Lý do thu hồi (ít nhất 10 ký tự)" className="mb-2 w-full rounded-xl border px-3 py-2 text-xs" />{selected.assignments.length === 0 ? <p className="text-xs text-slate-400">Chưa gán cho người dùng nào.</p> : <div className="space-y-2">{selected.assignments.map(assignment => { const target = users.find(user => user.id === assignment.targetUserId); return <div key={assignment.id} className="flex items-center justify-between rounded-xl border p-3"><div><div className="text-xs font-bold text-slate-800">{target?.name || assignment.targetUserId}</div><div className="text-[10px] text-slate-500">{SCOPE_LABELS[assignment.scopeType]} · {assignment.scopeId}</div></div><button disabled={busy || revokeReason.trim().length < 10} onClick={() => void revoke(assignment.id)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-[10px] font-bold text-rose-700 disabled:opacity-40">Thu hồi</button></div>; })}</div>}</div>
          </section>}
          {step === 3 && !selected && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Hãy lưu mẫu quyền trước khi gán đối tượng.</div>}
        </main>
      </div>
    </div>
  );
};

export default SettingsRoleTemplates;
