import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, GitBranch, Settings2, X } from 'lucide-react';
import { ProjectWorkflowBindingScope, ProjectWorkflowConfiguration, WorkflowTemplate } from '../../types';
import { projectWorkflowService } from '../../lib/projectWorkflowService';

interface Props {
  projectId?: string | null;
  constructionSiteId?: string | null;
  templates: WorkflowTemplate[];
  onConfigurationChange?: (configuration: ProjectWorkflowConfiguration) => void;
}

const scopeLabel: Record<ProjectWorkflowBindingScope, string> = {
  global: 'Mặc định toàn hệ thống',
  project: 'Riêng dự án',
  site: 'Riêng công trường',
};

const ProjectWorkflowBindingPanel: React.FC<Props> = ({
  projectId,
  constructionSiteId,
  templates,
  onConfigurationChange,
}) => {
  const [configuration, setConfiguration] = useState<ProjectWorkflowConfiguration | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [targetScope, setTargetScope] = useState<'project' | 'site'>(constructionSiteId ? 'site' : 'project');
  const templateById = useMemo(() => new Map(templates.map(template => [template.id, template])), [templates]);

  const load = async () => {
    const next = await projectWorkflowService.getConfiguration('material_request', projectId || null, constructionSiteId || null);
    setConfiguration(next);
    setTemplateId(next.binding?.workflowTemplateId || templates.find(template => template.isActive)?.id || '');
    onConfigurationChange?.(next);
  };

  useEffect(() => {
    void load().catch(err => setError(err?.message || 'Không tải được cấu hình workflow.'));
  }, [projectId, constructionSiteId]);

  const save = async () => {
    if (!templateId || !projectId) return;
    setSaving(true);
    setError(null);
    try {
      await projectWorkflowService.setBinding({
        subjectType: 'material_request',
        workflowTemplateId: templateId,
        projectId,
        constructionSiteId: targetScope === 'site' ? constructionSiteId || null : null,
      });
      await load();
      setOpen(false);
    } catch (err: any) {
      setError(err?.message || 'Không lưu được cấu hình workflow.');
    } finally {
      setSaving(false);
    }
  };

  const removeOverride = async () => {
    if (!projectId) return;
    setSaving(true);
    setError(null);
    try {
      await projectWorkflowService.removeBinding({
        subjectType: 'material_request',
        projectId,
        constructionSiteId: targetScope === 'site' ? constructionSiteId || null : null,
      });
      await load();
      setOpen(false);
    } catch (err: any) {
      setError(err?.message || 'Không xóa được cấu hình riêng.');
    } finally {
      setSaving(false);
    }
  };

  const effectiveTemplate = configuration?.binding
    ? templateById.get(configuration.binding.workflowTemplateId)
    : null;
  const selectedScopeMatchesEffective = configuration?.scope === targetScope;

  if (!configuration?.canManage) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100"
      >
        <Settings2 size={12} /> Cấu hình
      </button>

      {open && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/45 px-4 py-6">
          <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-indigo-600"><GitBranch size={13} /> Workflow vật tư</div>
                <h3 className="mt-1 text-base font-black text-slate-800">Cấu hình quy trình duyệt</h3>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={17} /></button>
            </div>
            <div className="space-y-4 p-5">
              {constructionSiteId && (
                <div className="grid grid-cols-2 gap-2">
                  {(['site', 'project'] as const).map(scope => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => setTargetScope(scope)}
                      className={`rounded-lg border px-3 py-2 text-xs font-black ${targetScope === scope ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500'}`}
                    >
                      {scope === 'site' ? 'Riêng công trường' : 'Riêng dự án'}
                    </button>
                  ))}
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase text-slate-400">Mẫu workflow</label>
                <select
                  value={templateId}
                  onChange={event => setTemplateId(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="">Chọn mẫu workflow</option>
                  {templates.filter(template => template.isActive).map(template => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
              </div>
              {error && <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</div>}
            </div>
            <div className="flex justify-between gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                disabled={saving || !selectedScopeMatchesEffective}
                onClick={removeOverride}
                className="rounded-lg px-3 py-2 text-xs font-black text-red-600 hover:bg-red-50 disabled:opacity-40"
              >
                Xóa cấu hình riêng
              </button>
              <button
                type="button"
                disabled={saving || !templateId}
                onClick={save}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ProjectWorkflowBindingPanel;
