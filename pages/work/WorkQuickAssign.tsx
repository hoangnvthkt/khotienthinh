import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Send } from "lucide-react";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type { WorkAssignablePeople, WorkBoardService, WorkLevel } from "../../lib/work/workBoardService";
import { WORK_LEVEL_LABELS, priorityOfLevel } from "../../lib/work/workBoardService";
import { WorkCreateAttempt, workDocument, workError } from "../../lib/work/workForm";
import type { CreateWorkTaskInput } from "../../lib/work/workTypes";
import { workDayLabel } from "../../lib/work/workPresentation";

const CAP = 10;
const pad = (n: number) => String(n).padStart(2, "0");
const at17 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 17, 0, 0);
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Hạn gợi ý: hôm nay / mai / thứ 7 tuần này (chốt tuần), đều 17:00; hết giờ thì bỏ "hôm nay". */
export function quickDuePresets(now: Date = new Date()) {
  const today = at17(now);
  const tomorrow = at17(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const toSaturday = (6 - now.getDay() + 7) % 7;
  const saturday = at17(new Date(now.getFullYear(), now.getMonth(), now.getDate() + toSaturday));
  const presets = [
    { id: "today", label: "Hôm nay", at: today },
    { id: "tomorrow", label: "Mai", at: tomorrow },
    { id: "saturday", label: `Thứ 7 ${pad(saturday.getDate())}/${pad(saturday.getMonth() + 1)}`, at: saturday },
  ];
  return presets.filter((p, i, all) => p.at.getTime() > now.getTime() && all.findIndex((q) => q.at.getTime() === p.at.getTime()) === i);
}

/** Dựng đầu vào tạo việc (phạm vi trực tiếp). Bằng chứng khi nộp ghi vào cuối yêu cầu để người làm thấy. */
export function quickTaskInput(form: {
  title: string; assigneeId: string; deadline: Date; level: WorkLevel; description: string; checklist: string; tags: string;
  evidence: { photo: boolean; file: boolean };
}): CreateWorkTaskInput {
  const evidence = [form.evidence.photo && "ảnh", form.evidence.file && "tệp"].filter(Boolean).join(" + ");
  const description = [form.description.trim(), evidence ? `Bằng chứng khi nộp: ${evidence}.` : ""].filter(Boolean).join("\n");
  return {
    title: form.title.trim(),
    description: workDocument(description),
    scope: { type: "direct" },
    recipientSources: [{ type: "user", id: form.assigneeId }],
    watcherUserIds: [],
    priority: priorityOfLevel(form.level),
    privacy: "standard",
    labels: [...new Set(form.tags.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 20),
    checklist: form.checklist.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 50).map((title) => ({ title })),
    deadlineAt: form.deadline.toISOString(),
  };
}

export function WorkQuickAssign({ service, board, actorName, onCreated }: {
  service: Pick<WorkTaskService, "preview" | "create">;
  board: Pick<WorkBoardService, "assignablePeople">;
  actorName: string;
  onCreated: (message: string) => void;
}) {
  const [people, setPeople] = useState<WorkAssignablePeople | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const presets = useMemo(() => quickDuePresets(), []);
  const [dueId, setDueId] = useState(presets.at(-1)?.id || "other");
  const [otherDate, setOtherDate] = useState(isoDate(new Date(Date.now() + 3 * 86_400_000)));
  const [level, setLevel] = useState<WorkLevel>("B");
  const [more, setMore] = useState(false);
  const [description, setDescription] = useState("");
  const [checklist, setChecklist] = useState("");
  const [tags, setTags] = useState("");
  const [evidence, setEvidence] = useState({ photo: false, file: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const attempt = useRef<{ signature: string; value: WorkCreateAttempt } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    board.assignablePeople(null, 200).then((result) => {
      if (!live) return;
      setPeople(result);
      const me = result.people.find((p) => p.isMe);
      if (!result.canAssignOthers && me) setAssigneeId(me.userId);
    }).catch((caught) => live && setLoadError(caught));
    return () => { live = false; };
  }, [board]);

  const choices = useMemo(() => {
    if (!people) return [];
    const list = people.canAssignOthers ? people.people.filter((p) => p.canReceive || p.isMe) : people.people.filter((p) => p.isMe);
    return [...list].sort((a, b) => Number(b.isMe) - Number(a.isMe) || Number(b.myTeam) - Number(a.myTeam) || a.name.localeCompare(b.name, "vi"));
  }, [people]);
  const assignee = choices.find((p) => p.userId === assigneeId) || null;
  const deadline = dueId === "other"
    ? (otherDate ? at17(new Date(`${otherDate}T00:00:00`)) : null)
    : presets.find((p) => p.id === dueId)?.at || null;
  const deadlineInvalid = !deadline || deadline.getTime() <= Date.now();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || title.trim().length < 2) { setError(new Error("QUICK_TITLE")); titleRef.current?.focus(); return; }
    if (!assignee) { setError(new Error("QUICK_ASSIGNEE")); return; }
    if (deadlineInvalid || !deadline) { setError(new Error("WORK_DEADLINE_EXPIRED")); return; }
    const input = quickTaskInput({ title, assigneeId: assignee.userId, deadline, level, description, checklist, tags, evidence });
    const signature = JSON.stringify(input);
    setBusy(true); setError(null);
    try {
      if (!attempt.current || attempt.current.signature !== signature) {
        const preview = await service.preview(input.recipientSources, input.scope);
        if (!preview.validCount) throw new Error("WORK_NO_VALID_RECIPIENTS");
        attempt.current = { signature, value: new WorkCreateAttempt(input, preview.fingerprint) };
      }
      const result = await service.create(attempt.current.value.input, attempt.current.value.key, attempt.current.value.fingerprint);
      attempt.current = null;
      onCreated(`Đã giao ${result.taskCode} cho ${assignee.isMe ? "chính bạn" : assignee.name} · hạn ${workDayLabel(input.deadlineAt!)}`);
      setTitle(""); setDescription(""); setChecklist(""); setTags(""); setEvidence({ photo: false, file: false }); setMore(false);
      titleRef.current?.focus();
    } catch (caught) {
      // Lời từ chối đã biết thì bỏ lần thử; lỗi mạng giữ nguyên khóa để bấm lại không tạo việc thứ hai.
      if (caught instanceof Error && /^(WORK_RECIPIENT_PREVIEW_STALE|WORK_NO_VALID_RECIPIENTS|WORK_DEADLINE_EXPIRED)/.test(caught.message)) attempt.current = null;
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const message = error instanceof Error && error.message === "QUICK_TITLE" ? "Nhập tên việc (ít nhất 2 ký tự)."
    : error instanceof Error && error.message === "QUICK_ASSIGNEE" ? "Chọn người làm."
    : error ? workError(error) : "";
  const loadLabel = (load: number) => (load >= CAP ? "đầy" : load <= 3 ? "còn trống" : `tải ${load}/${CAP}`);

  return (
    <form className="work-quick" onSubmit={submit} aria-label="Giao việc nhanh" noValidate>
      <input ref={titleRef} className="work-input work-quick-title" value={title} maxLength={300} autoComplete="off"
        aria-label="Tên việc" placeholder="Giao việc mới… VD: Rà soát khối lượng phát sinh mái khu B"
        onChange={(e) => { setTitle(e.target.value); if (error) setError(null); }} />
      <div className="work-quick-row">
        <select className="work-input work-quick-person" aria-label="Người làm" value={assigneeId} disabled={!people}
          onChange={(e) => setAssigneeId(e.target.value)}>
          {!people ? <option value="">{loadError ? "Không tải được danh sách" : "Đang tải người làm…"}</option>
            : <option value="" disabled>Chọn người làm</option>}
          {choices.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.isMe ? `Tôi (${actorName})` : `${p.name}${p.unit?.code ? ` · ${p.unit.code}` : ""} · ${loadLabel(p.load)}`}
            </option>
          ))}
        </select>
        <div className="work-quick-seg" role="group" aria-label="Hạn">
          {presets.map((p) => (
            <button type="button" key={p.id} aria-pressed={dueId === p.id} onClick={() => setDueId(p.id)}>{p.label}</button>
          ))}
          <button type="button" aria-pressed={dueId === "other"} onClick={() => setDueId("other")}>Ngày khác</button>
        </div>
        {dueId === "other" && (
          <input className="work-input work-quick-date" type="date" aria-label="Chọn ngày hạn" value={otherDate}
            min={isoDate(new Date())} onChange={(e) => setOtherDate(e.target.value)} />
        )}
        <div className="work-quick-seg work-quick-level" role="group" aria-label="Mức quan trọng">
          {(["A", "B", "C"] as const).map((l) => (
            <button type="button" key={l} data-level={l} aria-pressed={level === l} title={WORK_LEVEL_LABELS[l]} onClick={() => setLevel(l)}>{l}</button>
          ))}
        </div>
        <button type="button" className="work-secondary work-quick-more-toggle" aria-expanded={more} onClick={() => setMore((v) => !v)}>
          {more ? <ChevronUp size={16} /> : <ChevronDown size={16} />} Chi tiết
        </button>
        <button className="work-primary work-quick-submit" disabled={busy || !people}>
          <Send size={16} /> {busy ? "Đang giao…" : "Giao"}
        </button>
      </div>
      {more && (
        <div className="work-quick-more">
          <label className="work-label">Yêu cầu
            <textarea className="work-input" rows={3} maxLength={4000} value={description} placeholder="Kết quả cần có, đầu vào…"
              onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="work-label">Checklist · mỗi dòng một mục
            <textarea className="work-input" rows={3} value={checklist} placeholder={"Bóc khối lượng\nĐối chiếu dự toán"}
              onChange={(e) => setChecklist(e.target.value)} />
          </label>
          <label className="work-label">Thẻ
            <input className="work-input" value={tags} maxLength={400} placeholder="VD: XinHai, Khối lượng" onChange={(e) => setTags(e.target.value)} />
          </label>
          <div className="work-label">Bằng chứng khi nộp
            <div className="work-quick-toggles">
              <button type="button" aria-pressed={evidence.photo} onClick={() => setEvidence((v) => ({ ...v, photo: !v.photo }))}>Ảnh</button>
              <button type="button" aria-pressed={evidence.file} onClick={() => setEvidence((v) => ({ ...v, file: !v.file }))}>Tệp</button>
            </div>
          </div>
        </div>
      )}
      <p className="work-quick-preview" aria-live="polite">
        <b>{actorName}</b> <span aria-hidden="true">→</span> <b>{assignee ? (assignee.isMe ? "chính bạn" : assignee.name) : "…"}</b>
        {" · hạn "}<b className={deadlineInvalid ? "work-quick-bad" : ""}>{deadline ? workDayLabel(deadline.toISOString()) : "chưa chọn"}</b>
        {" · "}<span className={`work-level-chip level-${level}`}>{level}</span> {WORK_LEVEL_LABELS[level]}
        {" · duyệt: "}{assignee?.isMe ? "tự hoàn thành" : "bạn"}
      </p>
      {message && <p className="work-error" role="alert">{message}</p>}
    </form>
  );
}
