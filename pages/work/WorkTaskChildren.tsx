import React, { useEffect, useState } from "react";
import { CheckCircle2, Circle, Paperclip, Plus, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import type { createWorkAttachmentService } from "../../lib/work/workAttachmentService";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type {
  WorkScope,
  WorkTaskChildAggregate,
  WorkTaskChildSummary,
  WorkTaskCommandResult,
  WorkTaskCursor,
  WorkTaskDetail,
} from "../../lib/work/workTypes";
import { scopeKey, workError } from "../../lib/work/workForm";
import { workWhen } from "../../lib/work/workPresentation";
import { WorkCreateDrawer } from "./WorkCreateDrawer";
import { WorkTaskSection } from "./WorkTaskSection";

const emptyAggregate: WorkTaskChildAggregate = {
  visibleTotal: 0,
  visibleCompleted: 0,
  visibleCancelled: 0,
  visibleOpen: 0,
};

function scopeOf(detail: WorkTaskDetail): WorkScope {
  const task = detail.task;
  if (task.scope_type === "workspace" && task.workspace_id)
    return { type: "workspace", workspaceId: task.workspace_id };
  if (task.scope_type === "department" && task.department_id)
    return { type: "department", departmentId: task.department_id };
  if (task.scope_type === "project" && task.project_id)
    return { type: "project", projectId: task.project_id };
  return { type: "direct" };
}

export function WorkTaskChildren({ detail, service, attachments, scopeLabel, revision, onCreated }: {
  detail: WorkTaskDetail;
  service: WorkTaskService;
  attachments: ReturnType<typeof createWorkAttachmentService>;
  scopeLabel: string;
  revision: number;
  onCreated: (result: WorkTaskCommandResult) => void;
}) {
  const [items, setItems] = useState<WorkTaskChildSummary[]>([]);
  const [aggregate, setAggregate] = useState(detail.childAggregate || emptyAggregate);
  const [cursor, setCursor] = useState<WorkTaskCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [drawer, setDrawer] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    service.children(detail.task.id).then((page) => {
      if (!live) return;
      setItems(page.items);
      setAggregate(page.aggregate);
      setCursor(page.nextCursor);
    }).catch((caught) => live && setError(caught)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [detail.task.id, service, revision, reload]);

  async function more() {
    if (!cursor) return;
    try {
      const page = await service.children(detail.task.id, cursor);
      setItems((current) => [...current, ...page.items]);
      setAggregate(page.aggregate);
      setCursor(page.nextCursor);
    } catch (caught) { setError(caught); }
  }

  const denominator = aggregate.visibleTotal;
  const progress = denominator ? Math.round((aggregate.visibleCompleted / denominator) * 100) : 0;
  return (
    <>
      <WorkTaskSection
        title="Công việc con"
        hint={denominator ? `${aggregate.visibleCompleted}/${denominator} hoàn thành` : "Chia việc thành các đầu việc độc lập"}
        className="work-children-section"
        actions={detail.capabilities.canCreateChild && <button type="button" className="work-secondary" onClick={() => setDrawer(true)}><Plus size={16} aria-hidden="true" /> Thêm công việc con</button>}
      >
        <div className="work-child-progress" aria-label={`${aggregate.visibleCompleted}/${denominator} hoàn thành`}><span style={{ width: `${progress}%` }} /></div>
        {loading && <p className="work-hint">Đang tải công việc con…</p>}
        {error && <p role="alert" className="work-error">{workError(error)} <button onClick={() => setReload((x) => x + 1)}>Tải lại</button></p>}
        <ul className="work-child-list">
          {items.map((child) => <li key={child.id}>
            {child.status === "completed" ? <CheckCircle2 className="work-child-done" size={22} aria-label="Đã hoàn thành" /> : <Circle size={22} aria-label="Chưa hoàn thành" />}
            <Link to={`/work/tasks/${child.task_code}`}><strong>{child.title}</strong><span>{child.task_code} · {workWhen(child.deadline_at)}</span></Link>
            <span className="work-child-meta"><UsersRound size={14} aria-hidden="true" /> {child.assignee_names.join(", ") || "Chưa có người nhận"}</span>
            {child.attachment_count > 0 && <span className="work-child-meta"><Paperclip size={14} aria-hidden="true" /> {child.attachment_count}</span>}
          </li>)}
        </ul>
        {!loading && !error && !items.length && <button type="button" className="work-child-empty" disabled={!detail.capabilities.canCreateChild} onClick={() => setDrawer(true)}><Plus size={18} aria-hidden="true" /> Thêm công việc con đầu tiên</button>}
        {cursor && <button type="button" className="work-text-button" onClick={() => void more()}>Xem thêm công việc con</button>}
      </WorkTaskSection>
      {drawer && <WorkCreateDrawer
        service={service}
        attachments={attachments}
        initialScope={scopeOf(detail)}
        lockScope
        scopeLabels={{ [scopeKey(scopeOf(detail))]: scopeLabel }}
        parentTask={{
          id: detail.task.id,
          title: detail.task.title,
          privacy: detail.task.privacy,
          taskGroupId: detail.task.task_group_id || undefined,
          plannedStartAt: detail.task.planned_start_at || undefined,
          deadlineAt: detail.task.deadline_at || undefined,
          recipientUserIds: detail.assignments.filter((assignment) => !assignment.ended_at).map((assignment) => assignment.user_id),
        }}
        onClose={() => setDrawer(false)}
        onCreated={(result) => { setDrawer(false); setReload((x) => x + 1); onCreated(result); }}
      />}
    </>
  );
}
