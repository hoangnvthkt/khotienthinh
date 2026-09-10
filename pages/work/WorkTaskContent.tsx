import React, { useEffect, useRef, useState } from "react";
import { Edit3, Save, X } from "lucide-react";
import { documentText } from "../../lib/work/workForm";
import type {
  WorkCollaborationCommand,
  WorkTaskCapabilities,
  WorkTaskSubmission,
  WorkTextDocument,
  WorkTask,
} from "../../lib/work/workTypes";
import { WorkRichTextEditor } from "./WorkRichTextEditor";
import { WorkRichTextView } from "./WorkRichTextView";
import { WorkTaskSection } from "./WorkTaskSection";

type Run = (input: WorkCollaborationCommand) => Promise<boolean>;

export function WorkTaskProgress({ task, canUpdate, busy, run }: {
  task: WorkTask;
  canUpdate: boolean;
  busy: boolean;
  run: Run;
}) {
  const [value, setValue] = useState(task.progress_percent);
  const serverValue = useRef(task.progress_percent);
  useEffect(() => {
    setValue((current) => current === serverValue.current ? task.progress_percent : current);
    serverValue.current = task.progress_percent;
  }, [task.id, task.progress_percent]);
  const changed = value !== task.progress_percent;
  return <section className="work-progress-card" aria-labelledby="work-progress-title">
    <header>
      <div>
        <strong id="work-progress-title">Tiến độ thực hiện</strong>
        <span>{task.status === "completed" ? "Đã hoàn thành" : "Cập nhật theo tiến độ thực tế"}</span>
      </div>
      <output htmlFor="work-task-progress">{value}%</output>
    </header>
    <div className="work-progress-controls">
      <input id="work-task-progress" aria-label="Phần trăm hoàn thành" type="range" min="0" max="100" step="5"
        value={value} disabled={!canUpdate || busy} style={{ "--work-progress": `${value}%` } as React.CSSProperties}
        onChange={(event) => setValue(Number(event.target.value))} />
      {canUpdate && <button className="work-secondary" disabled={busy || !changed}
        onClick={() => void run({ command: "progress_update", payload: { progressPercent: value, expectedLockVersion: task.lock_version } })}>
        <Save size={15} /> Lưu tiến độ
      </button>}
    </div>
    {value === 100 && task.status !== "completed" && <p>100% chỉ phản ánh tiến độ. Hãy nộp kết quả để hoàn tất quy trình.</p>}
  </section>;
}

export function WorkTaskDescription({ task, canUpdate, busy, run }: {
  task: WorkTask;
  canUpdate: boolean;
  busy: boolean;
  run: Run;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WorkTextDocument>(task.description_document);
  useEffect(() => { setDraft(task.description_document); setEditing(false); }, [task.id]);
  return <WorkTaskSection title="Mô tả công việc" hint="Yêu cầu và thông tin đầu vào" actions={canUpdate && !editing
    ? <button className="work-secondary" disabled={busy} onClick={() => { setDraft(task.description_document); setEditing(true); }}><Edit3 size={15} /> Chỉnh sửa</button>
    : undefined}>
    {editing ? <>
      <WorkRichTextEditor label="Mô tả công việc" value={draft} onChange={setDraft} disabled={busy} placeholder="Thêm mô tả công việc…" />
      <div className="work-editor-actions">
        <button className="work-secondary" disabled={busy} onClick={() => { setDraft(task.description_document); setEditing(false); }}><X size={15} /> Hủy</button>
        <button className="work-primary" disabled={busy || !documentText(draft).trim()} onClick={async () => {
          if (await run({ command: "description_update", payload: { content: draft, expectedLockVersion: task.lock_version } })) setEditing(false);
        }}><Save size={15} /> Lưu mô tả</button>
      </div>
    </> : <WorkRichTextView document={task.description_document} empty="Chưa có mô tả." />}
  </WorkTaskSection>;
}

export function WorkTaskResult({ task, currentSubmission, canUpdate, busy, run, submitterName }: {
  task: WorkTask;
  currentSubmission: WorkTaskSubmission | null;
  canUpdate: boolean;
  busy: boolean;
  run: Run;
  submitterName: (id: string | null) => string;
}) {
  const [draft, setDraft] = useState<WorkTextDocument>(task.result_draft_document);
  const serverSignature = JSON.stringify(task.result_draft_document);
  const previousServerSignature = useRef(serverSignature);
  useEffect(() => {
    setDraft((current) => JSON.stringify(current) === previousServerSignature.current ? task.result_draft_document : current);
    previousServerSignature.current = serverSignature;
  }, [task.id, serverSignature]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(task.result_draft_document);
  return <WorkTaskSection className="work-result-section" title="Kết quả công việc"
    hint={canUpdate ? "Lưu nháp trước khi nộp kết quả" : currentSubmission ? `Lần nộp ${currentSubmission.iteration}` : "Chưa có kết quả"}>
    {canUpdate ? <>
      <WorkRichTextEditor label="Kết quả công việc" value={draft} onChange={setDraft} disabled={busy} placeholder="Cập nhật kết quả công việc…" />
      <div className="work-editor-actions">
        <span>{dirty ? "Có thay đổi chưa lưu" : task.result_draft_updated_at ? "Đã lưu bản nháp" : "Bản nháp chưa có nội dung"}</span>
        <button className="work-primary" disabled={busy || !dirty || !documentText(draft).trim()} onClick={() => void run({
          command: "result_draft_update",
          payload: { content: draft, expectedLockVersion: task.lock_version },
        })}><Save size={15} /> Lưu kết quả</button>
      </div>
    </> : task.result_draft_text
      ? <WorkRichTextView document={task.result_draft_document} empty="Chưa có bản nháp kết quả." />
      : !currentSubmission && <p>Chưa có kết quả.</p>}
    {currentSubmission && <div className="work-submitted-result">
      <header>
        <strong>Kết quả đã nộp · Lần {currentSubmission.iteration}</strong>
        <span>{submitterName(currentSubmission.submitted_by)}</span>
      </header>
      <WorkRichTextView document={currentSubmission.result_document} empty={currentSubmission.result_text} />
      <strong className={`work-submission-state state-${currentSubmission.status}`}>{{ pending_review: "Chờ đánh giá", approved: "Đã duyệt", changes_requested: "Cần chỉnh sửa" }[currentSubmission.status]}</strong>
      {currentSubmission.review_note && <p>{currentSubmission.review_note}</p>}
    </div>}
  </WorkTaskSection>;
}
