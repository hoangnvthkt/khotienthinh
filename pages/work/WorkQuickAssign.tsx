import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, FileText, Loader2, Send, Sparkles, Undo2 } from "lucide-react";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type { WorkAssignablePeople, WorkAssignablePerson, WorkBoardService, WorkLevel } from "../../lib/work/workBoardService";
import { WORK_LEVEL_LABELS } from "../../lib/work/workBoardService";
import { WorkCreateAttempt, workError } from "../../lib/work/workForm";
import { workDayLabel } from "../../lib/work/workPresentation";
import { localIsoDate, matchWorkPerson, resolveDue, type WorkAiService } from "../../lib/work/workAi";
import { WorkMeetingImport } from "./WorkMeetingImport";
import { Highlight, useRipple } from "../../components/work/motion";
import { dateAt, personOption, quickChoices, quickDuePresets, quickTaskInput } from "../../lib/work/workQuick";

const CAP = 10;
const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = localIsoDate;
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export { dateAt, personOption, quickChoices, quickDuePresets, quickTaskInput } from "../../lib/work/workQuick";

type Form = { title: string; assigneeId: string; dueId: string; otherDate: string; otherTime: string; level: WorkLevel;
  description: string; checklist: string; tags: string; evidence: { photo: boolean; file: boolean }; more: boolean };
type AiNote = { tone: "ok" | "warn"; text: string; undo?: Form };

export function WorkQuickAssign({ service, board, ai, actorName, onCreated, preset }: {
  service: Pick<WorkTaskService, "preview" | "create">;
  board: Pick<WorkBoardService, "assignablePeople" | "linkAi" | "learnPersonAlias" | "createMeeting" | "setOrigin">;
  /** Đợt 1 PR-3: nháp AI (Điền giúp, Viết yêu cầu, Dán biên bản). Không có → chỉ giao tay. */
  ai?: WorkAiService;
  actorName: string;
  onCreated: (message: string) => void;
  /** Từ Phòng tôi / Toàn công ty: điền sẵn người làm ("Giao việc cho X") hoặc mở Dán biên bản ("Ghi chỉ đạo"); nonce đổi mỗi lần bấm. */
  preset?: { assigneeId?: string; meeting?: boolean; nonce: number } | null;
}) {
  const [people, setPeople] = useState<WorkAssignablePeople | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const presets = useMemo(() => quickDuePresets(), []);
  const blank = (): Form => ({ title: "", assigneeId: "", dueId: presets.at(-1)?.id || "other", otherDate: isoDate(new Date(Date.now() + 3 * 86_400_000)),
    otherTime: "17:00", level: "B", description: "", checklist: "", tags: "", evidence: { photo: false, file: false }, more: false });
  const [form, setFormState] = useState<Form>(blank);
  const set = (patch: Partial<Form>) => setFormState((f) => ({ ...f, ...patch }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [aiBusy, setAiBusy] = useState<null | "draft" | "writer">(null);
  const [aiNote, setAiNote] = useState<AiNote | null>(null);
  const submitRipple = useRipple();
  /** Lượt AI đã điền form: gắn vào việc sau khi giao; cách gọi người để học (chỉ khi máy phải đoán / người giao bấm chọn). */
  const [draftRun, setDraftRun] = useState<{ runId: string; phrase: string | null; learn: boolean } | null>(null);
  const [writerRun, setWriterRun] = useState<string | null>(null);
  const [pick, setPick] = useState<{ phrase: string; people: WorkAssignablePerson[] } | null>(null);
  const [dueAlt, setDueAlt] = useState<Date[] | null>(null);
  const [meeting, setMeeting] = useState(false);
  useEffect(() => {
    if (!preset) return;
    if (preset.assigneeId) set({ assigneeId: preset.assigneeId });
    if (preset.meeting) setMeeting(true);
    requestAnimationFrame(() => { titleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); if (!preset.meeting) titleRef.current?.focus(); });
  }, [preset?.nonce]);
  const attempt = useRef<{ signature: string; value: WorkCreateAttempt } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    board.assignablePeople(null, 200).then((result) => {
      if (!live) return;
      setPeople(result);
      const me = result.people.find((p) => p.isMe);
      if (!result.canAssignOthers && me) set({ assigneeId: me.userId });
    }).catch((caught) => live && setLoadError(caught));
    return () => { live = false; };
  }, [board]);

  const choices = useMemo(() => quickChoices(people), [people]);
  const assignee = choices.find((p) => p.userId === form.assigneeId) || null;
  const deadline = form.dueId === "other" ? (form.otherDate ? dateAt(form.otherDate, form.otherTime) : null)
    : presets.find((p) => p.id === form.dueId)?.at || null;
  const deadlineInvalid = !deadline || deadline.getTime() <= Date.now();

  /** Đặt hạn: trùng nút gợi ý thì chọn nút, không thì "Ngày khác" + ngày giờ. */
  const dueFields = (d: Date): Partial<Form> => {
    const preset = presets.find((p) => p.at.getTime() === d.getTime());
    return preset ? { dueId: preset.id } : { dueId: "other", otherDate: isoDate(d), otherTime: hhmm(d) };
  };

  async function fillFromSentence() {
    if (!ai || !people) return;
    const sentence = form.title.trim();
    if (sentence.length < 3) {
      setAiNote({ tone: "warn", text: "Gõ câu giao việc trước, VD: Hà rà soát HĐ cốp pha SMB thứ 6, quan trọng." });
      titleRef.current?.focus();
      return;
    }
    setAiBusy("draft"); setAiNote(null); setError(null);
    const r = await ai.draftTask(sentence, choices);
    setAiBusy(null);
    if (!r.ok) { setAiNote({ tone: "warn", text: `${r.message} Bạn vẫn giao tay được.` }); return; }
    const d = r.result;
    const before = form;
    const patch: Partial<Form> = { title: d.title || sentence };
    const m = d.assignee || d.assigneeName ? matchWorkPerson(d.assignee, d.assigneeName, choices) : { kind: "none" as const };
    let learn = false;
    setPick(null);
    if (m.kind === "one") { patch.assigneeId = m.person.userId; learn = !m.exact && !m.person.isMe; }
    else if (m.kind === "many") { patch.assigneeId = ""; setPick({ phrase: d.assignee || d.assigneeName || "", people: m.people }); learn = true; }
    const due = resolveDue(d);
    if (due.at) Object.assign(patch, dueFields(due.at));
    setDueAlt(due.at && due.alt ? [due.at, due.alt] : null);
    if (d.level) patch.level = d.level;
    if (d.description) patch.description = d.description;
    if (d.checklist.length) patch.checklist = d.checklist.join("\n");
    if (d.tags.length) patch.tags = d.tags.join(", ");
    if (d.evidence.photo || d.evidence.file) patch.evidence = { photo: d.evidence.photo || form.evidence.photo, file: d.evidence.file || form.evidence.file };
    if (d.description || d.checklist.length || d.tags.length) patch.more = true;
    set(patch);
    setDraftRun({ runId: r.runId, phrase: d.assignee, learn });
    const missing = [
      m.kind === "none" && (d.assignee ? `không thấy “${d.assignee}” trong danh sách — chọn ở ô Người làm` : "chọn người làm"),
      m.kind === "many" && `chọn đúng “${d.assignee || d.assigneeName}” bên dưới`,
      !due.at && "chọn hạn",
    ].filter(Boolean);
    setAiNote({ tone: missing.length || m.kind === "many" ? "warn" : "ok", undo: before,
      text: `AI đã điền từ câu của bạn${missing.length ? ` · ${missing.join(", ")}` : ""}${d.warnings.length ? ` · ${d.warnings[0]}` : ""}. Kiểm rồi bấm Giao.` });
  }

  async function writeRequirements() {
    if (!ai) return;
    if (form.title.trim().length < 2) { setError(new Error("QUICK_TITLE")); titleRef.current?.focus(); return; }
    setAiBusy("writer"); setAiNote(null);
    const r = await ai.writeTask(form.title.trim(), form.description, form.level);
    setAiBusy(null);
    if (!r.ok) { setAiNote({ tone: "warn", text: `${r.message} Bạn vẫn viết tay được.` }); return; }
    const before = form;
    set({ description: r.result.description || form.description, checklist: form.checklist.trim() ? form.checklist : r.result.checklist.join("\n"),
      evidence: { photo: form.evidence.photo || r.result.evidence.photo, file: form.evidence.file || r.result.evidence.file }, more: true });
    setWriterRun(r.runId);
    setAiNote({ tone: "ok", undo: before, text: "AI đã viết yêu cầu, checklist, bằng chứng — sửa cho đúng việc rồi bấm Giao." });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.title.trim().length < 2) { setError(new Error("QUICK_TITLE")); titleRef.current?.focus(); return; }
    if (!assignee) { setError(new Error("QUICK_ASSIGNEE")); return; }
    if (deadlineInvalid || !deadline) { setError(new Error("WORK_DEADLINE_EXPIRED")); return; }
    const input = quickTaskInput({ ...form, assigneeId: assignee.userId, deadline });
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
      // Dấu vết AI + học cách gọi: không chặn luồng giao, lỗi bỏ qua.
      if (draftRun) {
        void board.linkAi(result.taskId, draftRun.runId, "task_draft").catch(() => undefined);
        if (draftRun.learn && draftRun.phrase) void board.learnPersonAlias(result.taskId, draftRun.phrase).catch(() => undefined);
      }
      if (writerRun) void board.linkAi(result.taskId, writerRun, "task_writer").catch(() => undefined);
      onCreated(`Đã giao ${result.taskCode} cho ${assignee.isMe ? "chính bạn" : assignee.name} · hạn ${workDayLabel(input.deadlineAt!)}`);
      setFormState({ ...blank(), assigneeId: people && !people.canAssignOthers ? form.assigneeId : "" });
      setDraftRun(null); setWriterRun(null); setAiNote(null); setPick(null); setDueAlt(null);
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
    <>
    <form className="work-quick" onSubmit={submit} aria-label="Giao việc nhanh" noValidate>
      <div className="work-quick-head">
        <input ref={titleRef} className="work-input work-quick-title" value={form.title} maxLength={300} autoComplete="off"
          aria-label="Tên việc" placeholder="Giao việc mới… VD: Hà rà soát HĐ cốp pha SMB thứ 6, quan trọng"
          onChange={(e) => { set({ title: e.target.value }); if (error) setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ai) { e.preventDefault(); void fillFromSentence(); } }} />
        {ai && (
          <div className="work-quick-ai">
            <button type="button" className="work-secondary work-ai-button" aria-busy={aiBusy === "draft"} disabled={!people || aiBusy !== null} onClick={() => void fillFromSentence()}
              title="AI đọc câu giao việc và điền người làm, hạn, mức, checklist — bạn kiểm rồi bấm Giao">
              {aiBusy === "draft" ? <Loader2 size={15} className="work-spin" /> : <Sparkles size={15} />} {aiBusy === "draft" ? "AI đang đọc…" : "AI điền"}
            </button>
            {people?.canAssignOthers && (
              <button type="button" className="work-secondary" aria-expanded={meeting} onClick={() => setMeeting((v) => !v)}
                title="Dán biên bản họp / tin Zalo / ảnh sổ họp → AI tách thành nhiều việc">
                <FileText size={15} /> Dán biên bản
              </button>
            )}
          </div>
        )}
      </div>
      <div className="work-quick-row">
        <select className="work-input work-quick-person" aria-label="Người làm" value={form.assigneeId} disabled={!people}
          onChange={(e) => { set({ assigneeId: e.target.value }); setPick(null); }}>
          {!people ? <option value="">{loadError ? "Không tải được danh sách" : "Đang tải người làm…"}</option>
            : <option value="" disabled>Chọn người làm</option>}
          {choices.map((p) => (
            <option key={p.userId} value={p.userId}>{p.isMe ? personOption(p, actorName) : `${personOption(p, actorName)} · ${loadLabel(p.load)}`}</option>
          ))}
        </select>
        <div className="work-quick-seg has-pill" role="group" aria-label="Hạn">
          {presets.map((p) => (
            <button type="button" key={p.id} aria-pressed={form.dueId === p.id} onClick={() => { set({ dueId: p.id }); setDueAlt(null); }}>
              {form.dueId === p.id && <Highlight group="work-quick-due" />}{p.label}
            </button>
          ))}
          <button type="button" aria-pressed={form.dueId === "other"} onClick={() => set({ dueId: "other" })}>{form.dueId === "other" && <Highlight group="work-quick-due" />}Ngày khác</button>
        </div>
        {form.dueId === "other" && (
          <span className="work-quick-when">
            <input className="work-input work-quick-date" type="date" aria-label="Chọn ngày hạn" value={form.otherDate}
              min={isoDate(new Date())} onChange={(e) => set({ otherDate: e.target.value })} />
            <input className="work-input work-quick-time" type="time" aria-label="Giờ hạn" value={form.otherTime} step={900}
              onChange={(e) => set({ otherTime: e.target.value || "17:00" })} />
          </span>
        )}
        <div className="work-quick-seg work-quick-level has-pill" role="group" aria-label="Mức quan trọng">
          {(["A", "B", "C"] as const).map((l) => (
            <button type="button" key={l} data-level={l} aria-pressed={form.level === l} title={WORK_LEVEL_LABELS[l]} onClick={() => set({ level: l })}>
              {form.level === l && <Highlight group="work-quick-level" />}{l}
            </button>
          ))}
        </div>
        <button type="button" className="work-secondary work-quick-more-toggle" aria-expanded={form.more} onClick={() => set({ more: !form.more })}>
          {form.more ? <ChevronUp size={16} /> : <ChevronDown size={16} />} Chi tiết
        </button>
        <button className="work-primary work-quick-submit" disabled={busy || !people} onPointerDown={submitRipple.onPointerDown}>
          <Send size={16} /> {busy ? "Đang giao…" : "Giao"}{submitRipple.ripples}
        </button>
      </div>
      {aiNote && (
        <p className={`work-ai-note is-${aiNote.tone}`} role="status">
          <Sparkles size={14} aria-hidden="true" /> <span>{aiNote.text}</span>
          {aiNote.undo && (
            <button type="button" className="work-text-button" onClick={() => { setFormState(aiNote.undo!); setAiNote(null); setPick(null); setDueAlt(null); setDraftRun(null); setWriterRun(null); }}>
              <Undo2 size={13} /> Hoàn tác
            </button>
          )}
        </p>
      )}
      {pick && (
        <div className="work-ai-pick" role="group" aria-label="Chọn người làm">
          <span>“{pick.phrase}” là ai?</span>
          {pick.people.map((p) => (
            <button type="button" key={p.userId} className="work-chip-button" onClick={() => { set({ assigneeId: p.userId }); setPick(null); }}>
              {personOption(p, actorName)}
            </button>
          ))}
        </div>
      )}
      {dueAlt && (
        <div className="work-ai-pick" role="group" aria-label="Chọn hạn">
          <span>Hạn nào?</span>
          {dueAlt.map((d) => (
            <button type="button" key={d.toISOString()} className="work-chip-button" aria-pressed={deadline?.getTime() === d.getTime()}
              onClick={() => { set(dueFields(d)); setDueAlt(null); }}>{workDayLabel(d.toISOString())}</button>
          ))}
        </div>
      )}
      {form.more && (
        <div className="work-quick-more">
          <div className="work-label">
            <span className="work-label-row">Yêu cầu
              {ai && (
                <button type="button" className="work-text-button work-ai-inline" disabled={aiBusy !== null} onClick={() => void writeRequirements()}
                  title="AI viết yêu cầu, checklist, bằng chứng từ tên việc">
                  {aiBusy === "writer" ? <Loader2 size={13} className="work-spin" /> : <Sparkles size={13} />} {aiBusy === "writer" ? "Đang viết…" : "Viết giúp"}
                </button>
              )}
            </span>
            <textarea className="work-input" rows={3} maxLength={4000} value={form.description} placeholder="Kết quả cần có, đầu vào…" aria-label="Yêu cầu"
              onChange={(e) => set({ description: e.target.value })} />
          </div>
          <label className="work-label">Checklist · mỗi dòng một mục
            <textarea className="work-input" rows={3} value={form.checklist} placeholder={"Bóc khối lượng\nĐối chiếu dự toán"}
              onChange={(e) => set({ checklist: e.target.value })} />
          </label>
          <label className="work-label">Thẻ
            <input className="work-input" value={form.tags} maxLength={400} placeholder="VD: XinHai, Khối lượng" onChange={(e) => set({ tags: e.target.value })} />
          </label>
          <div className="work-label">Bằng chứng khi nộp
            <div className="work-quick-toggles">
              <button type="button" aria-pressed={form.evidence.photo} onClick={() => set({ evidence: { ...form.evidence, photo: !form.evidence.photo } })}>Ảnh</button>
              <button type="button" aria-pressed={form.evidence.file} onClick={() => set({ evidence: { ...form.evidence, file: !form.evidence.file } })}>Tệp</button>
            </div>
          </div>
        </div>
      )}
      <p className="work-quick-preview" aria-live="polite">
        <b>{actorName}</b> <span aria-hidden="true">→</span> <b>{assignee ? (assignee.isMe ? "chính bạn" : assignee.name) : "…"}</b>
        {" · hạn "}<b className={deadlineInvalid ? "work-quick-bad" : ""}>{deadline ? workDayLabel(deadline.toISOString()) : "chưa chọn"}</b>
        {" · "}<span className={`work-level-chip level-${form.level}`}>{form.level}</span> {WORK_LEVEL_LABELS[form.level]}
        {" · duyệt: "}{assignee?.isMe ? "tự hoàn thành" : "bạn"}
      </p>
      {message && <p className="work-error" role="alert">{message}</p>}
    </form>
    {meeting && ai && people && (
      <WorkMeetingImport ai={ai} service={service} board={board} people={people} actorName={actorName}
        onClose={() => setMeeting(false)} onDone={(text) => onCreated(text)} />
    )}
    </>
  );
}
