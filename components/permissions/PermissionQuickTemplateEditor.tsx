import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import type { UserPermissionGrant } from '../../types';
import {
  permissionQuickTemplateService,
  type PermissionQuickTemplate,
} from '../../lib/permissions/permissionQuickTemplateService';
import CompactDirectPermissionTree from './CompactDirectPermissionTree';

export interface PermissionQuickTemplateEditorProps {
  disabled: boolean;
}

const TEMPLATE_DRAFT_USER_ID = 'template-draft';
const TEMPLATE_SCOPE_ID = 'template-scope';

const emptyTemplate = (): PermissionQuickTemplate => ({
  id: '',
  code: '',
  name: '',
  description: '',
  isActive: true,
  permissionCodes: [],
});

const templateToDrafts = (template: PermissionQuickTemplate): UserPermissionGrant[] =>
  template.permissionCodes.map(permissionCode => ({
    userId: TEMPLATE_DRAFT_USER_ID,
    permissionCode,
    scopeType: 'project',
    scopeId: TEMPLATE_SCOPE_ID,
  }));

const draftsToPermissionCodes = (drafts: readonly UserPermissionGrant[]): string[] =>
  [...new Set(
    drafts
      .filter(grant => grant.isActive !== false)
      .filter(grant => grant.userId === TEMPLATE_DRAFT_USER_ID)
      .map(grant => grant.permissionCode)
      .filter(Boolean),
  )].sort();

const PermissionQuickTemplateEditor: React.FC<PermissionQuickTemplateEditorProps> = ({ disabled }) => {
  const [templates, setTemplates] = useState<PermissionQuickTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [draftTemplate, setDraftTemplate] = useState<PermissionQuickTemplate>(emptyTemplate);
  const [drafts, setDrafts] = useState<UserPermissionGrant[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'load' | 'save' | 'deactivate' | null>(null);
  const [message, setMessage] = useState('');
  const scope = useMemo(() => ({ scopeType: 'project' as const, scopeId: TEMPLATE_SCOPE_ID }), []);
  const selectedTemplate = templates.find(template => template.id === selectedTemplateId) || null;
  const panelDisabled = disabled || busy !== null;

  const loadTemplates = async (preferredId?: string) => {
    setBusy('load');
    setMessage('');
    try {
      const nextTemplates = await permissionQuickTemplateService.list();
      setTemplates(nextTemplates);
      const nextSelected = preferredId && nextTemplates.some(template => template.id === preferredId)
        ? preferredId
        : nextTemplates[0]?.id || '';
      setSelectedTemplateId(nextSelected);
      const nextTemplate = nextTemplates.find(template => template.id === nextSelected) || emptyTemplate();
      setDraftTemplate(nextTemplate);
      setDrafts(templateToDrafts(nextTemplate));
    } catch {
      setMessage('Khong the tai mau quyen.');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const selectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setMessage('');
    setReason('');
    const nextTemplate = templates.find(template => template.id === templateId) || emptyTemplate();
    setDraftTemplate(nextTemplate);
    setDrafts(templateToDrafts(nextTemplate));
  };

  const createNew = () => {
    setSelectedTemplateId('');
    setDraftTemplate(emptyTemplate());
    setDrafts([]);
    setReason('');
    setMessage('');
  };

  const save = async () => {
    const permissionCodes = draftsToPermissionCodes(drafts);
    if (draftTemplate.code.trim().length < 3) {
      setMessage('Ma mau quyen can toi thieu 3 ky tu.');
      return;
    }
    if (draftTemplate.name.trim().length < 2) {
      setMessage('Ten mau quyen can toi thieu 2 ky tu.');
      return;
    }
    if (permissionCodes.length === 0) {
      setMessage('Mau quyen can it nhat mot permission.');
      return;
    }
    if (reason.trim().length < 10) {
      setMessage('Ly do thay doi can toi thieu 10 ky tu.');
      return;
    }

    setBusy('save');
    setMessage('');
    try {
      const savedId = await permissionQuickTemplateService.save({
        templateId: selectedTemplateId || null,
        code: draftTemplate.code,
        name: draftTemplate.name,
        description: draftTemplate.description,
        permissionCodes,
        reason,
      });
      setReason('');
      await loadTemplates(savedId);
      setMessage('Da luu Mẫu quyền.');
    } catch {
      setMessage('Khong the luu Mẫu quyền.');
    } finally {
      setBusy(null);
    }
  };

  const deactivate = async () => {
    if (!selectedTemplate) return;
    if (reason.trim().length < 10) {
      setMessage('Ly do ngung dung can toi thieu 10 ky tu.');
      return;
    }
    setBusy('deactivate');
    setMessage('');
    try {
      await permissionQuickTemplateService.deactivate(selectedTemplate.id, reason);
      setReason('');
      await loadTemplates();
      setMessage('Da ngung dung Mẫu quyền.');
    } catch {
      setMessage('Khong the ngung dung Mẫu quyền.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="grid min-h-[680px] gap-4 xl:grid-cols-[280px_1fr]">
      <aside className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="text-sm font-black text-slate-800">Mẫu quyền</div>
        <button
          type="button"
          onClick={createNew}
          disabled={panelDisabled}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-blue-200 px-3 py-2 text-xs font-black text-blue-700 disabled:opacity-50"
        >
          <Plus size={14} /> Mau moi
        </button>
        <div className="max-h-96 space-y-1 overflow-auto">
          {templates.length === 0 && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-400">
              Chua co mau da luu
            </div>
          )}
          {templates.map(template => (
            <button
              key={template.id}
              type="button"
              onClick={() => selectTemplate(template.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-xs font-bold ${template.id === selectedTemplateId ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <span className="block">{template.name}</span>
              <span className="mt-0.5 block text-[9px] text-slate-400">{template.code} · {template.permissionCodes.length}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5 text-xs font-bold text-slate-600">
            <span>Ma mau</span>
            <input
              value={draftTemplate.code}
              onChange={event => setDraftTemplate(previous => ({ ...previous, code: event.target.value }))}
              disabled={panelDisabled}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:bg-slate-50"
            />
          </label>
          <label className="space-y-1.5 text-xs font-bold text-slate-600">
            <span>Ten mau</span>
            <input
              value={draftTemplate.name}
              onChange={event => setDraftTemplate(previous => ({ ...previous, name: event.target.value }))}
              disabled={panelDisabled}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:bg-slate-50"
            />
          </label>
        </div>
        <label className="block space-y-1.5 text-xs font-bold text-slate-600">
          <span>Mo ta</span>
          <input
            value={draftTemplate.description || ''}
            onChange={event => setDraftTemplate(previous => ({ ...previous, description: event.target.value }))}
            disabled={panelDisabled}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:bg-slate-50"
          />
        </label>

        <CompactDirectPermissionTree
          targetUserId={TEMPLATE_DRAFT_USER_ID}
          grants={drafts}
          effectiveSources={[]}
          scope={scope}
          disabled={panelDisabled}
          applicationFilter="project"
          onGrantsChange={setDrafts}
        />

        <textarea
          value={reason}
          onChange={event => setReason(event.target.value)}
          disabled={panelDisabled}
          rows={2}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:bg-slate-50"
          placeholder="Ly do thay doi mau quyen"
        />

        {message && (
          <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs font-bold text-amber-700">
            {message}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={deactivate}
            disabled={panelDisabled || !selectedTemplate}
            className="flex items-center gap-2 rounded-lg border border-rose-200 px-4 py-2 text-xs font-black text-rose-700 disabled:opacity-50"
          >
            {busy === 'deactivate' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Ngung dung
          </button>
          <button
            type="button"
            onClick={save}
            disabled={panelDisabled}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50"
          >
            {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Luu mau
          </button>
        </div>
      </main>
    </section>
  );
};

export default PermissionQuickTemplateEditor;
