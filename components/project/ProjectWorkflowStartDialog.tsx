import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, GitBranch, Send, X } from 'lucide-react';
import { Employee, OrgUnit, ProjectWorkflowConfiguration, ProjectWorkflowSubject, User, WorkflowNode } from '../../types';
import { projectWorkflowService } from '../../lib/projectWorkflowService';
import ProjectWorkflowAssigneeSelect from './ProjectWorkflowAssigneeSelect';

interface Props {
  requestId: string;
  requestCode: string;
  requesterUserId: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  users: User[];
  employees?: Employee[];
  orgUnits?: OrgUnit[];
  submitLabel?: string;
  onCancel: () => void;
  onConfirm: (input: { templateId: string; assigneeUserIds: string[]; comment: string }) => Promise<void> | void;
}

const ProjectWorkflowStartDialog: React.FC<Props> = ({
  requestId,
  requestCode,
  requesterUserId,
  projectId,
  constructionSiteId,
  users,
  employees = [],
  orgUnits = [],
  submitLabel = 'Gửi duyệt',
  onCancel,
  onConfirm,
}) => {
  const [configuration, setConfiguration] = useState<ProjectWorkflowConfiguration | null>(null);
  const [firstNode, setFirstNode] = useState<WorkflowNode | null>(null);
  const [assigneeUserIds, setAssigneeUserIds] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syntheticSubject = useMemo<ProjectWorkflowSubject>(() => ({
    id: `draft:${requestId}`,
    subjectType: 'material_request',
    subjectId: requestId,
    projectId: projectId || null,
    constructionSiteId: constructionSiteId || null,
    status: 'RUNNING',
  }), [constructionSiteId, projectId, requestId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    projectWorkflowService.getConfiguration('material_request', projectId || null, constructionSiteId || null)
      .then(async next => {
        if (!alive) return;
        setConfiguration(next);
        if (!next.valid || !next.binding) {
          setError(next.errors[0] || 'Chưa cấu hình workflow hợp lệ.');
          return;
        }
        const context = await projectWorkflowService.getTemplateStartContext(next.binding.workflowTemplateId);
        if (!alive) return;
        setFirstNode(context.firstNode);
        if (!context.firstNode) setError('Mẫu workflow chưa có bước xử lý đầu tiên.');
      })
      .catch(err => alive && setError(err?.message || 'Không tải được workflow đề xuất vật tư.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [constructionSiteId, projectId]);

  const submit = async () => {
    if (!configuration?.binding || !firstNode || assigneeUserIds.length === 0) {
      setError('Vui lòng chọn ít nhất một người xử lý bước đầu.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({
        templateId: configuration.binding.workflowTemplateId,
        assigneeUserIds,
        comment: comment.trim(),
      });
    } catch (err: any) {
      setError(err?.message || 'Không gửi được đề xuất vật tư.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-emerald-600"><GitBranch size={13} /> Bắt đầu workflow</div>
            <h3 className="mt-1 text-base font-black text-slate-800">Gửi đề xuất vật tư</h3>
            <p className="mt-1 text-xs font-bold text-slate-400">{requestCode}</p>
          </div>
          <button onClick={onCancel} disabled={submitting} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50"><X size={17} /></button>
        </div>
        <div className="space-y-4 p-5">
          {loading && <div className="text-xs font-bold text-slate-400">Đang tải cấu hình workflow...</div>}
          {configuration?.valid && firstNode && (
            <>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
                Bước đầu tiên: <span className="font-black">{firstNode.label}</span>
              </div>
              <ProjectWorkflowAssigneeSelect
                subject={syntheticSubject}
                node={firstNode}
                users={users}
                employees={employees}
                orgUnits={orgUnits}
                value={assigneeUserIds}
                creatorUserId={requesterUserId}
                disabled={submitting}
                onChange={setAssigneeUserIds}
              />
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase text-slate-400">Ghi chú</label>
                <textarea
                  rows={3}
                  value={comment}
                  onChange={event => setComment(event.target.value)}
                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200"
                />
              </div>
            </>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button onClick={onCancel} disabled={submitting} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Hủy</button>
          <button onClick={submit} disabled={submitting || loading || !configuration?.valid || !firstNode} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50">
            <Send size={14} /> {submitting ? 'Đang gửi...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectWorkflowStartDialog;
