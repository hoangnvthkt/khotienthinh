import React, { useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, Send, Sparkles, X } from "lucide-react";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type { WorkAssignablePeople, WorkAssignablePerson, WorkBoardService, WorkLevel } from "../../lib/work/workBoardService";
import { WORK_LEVEL_LABELS } from "../../lib/work/workBoardService";
import { WorkCreateAttempt, workError } from "../../lib/work/workForm";
import { localIsoDate, matchWorkPerson, resolveDue, type AiImage, type WorkAiService } from "../../lib/work/workAi";
import { readImageFile, type ImageAttachment } from "../../lib/assistantFiles";
import { dateAt, personOption, quickChoices, quickTaskInput } from "../../lib/work/workQuick";

interface Row {
  key: string; include: boolean; title: string; assigneeId: string; phrase: string | null; candidates: WorkAssignablePerson[];
  date: string; time: string; level: WorkLevel; note: string; quote: string | null;
  state: "idle" | "done" | "error"; message: string; code?: string;
}
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Đợt 1 PR-3 · Giao từ biên bản họp: dán chữ / chụp sổ họp → AI tách việc → người giao kiểm từng dòng → Giao N việc
 *  (mỗi việc một lần tạo có khóa chống trùng); có thể ghi vào Sổ chỉ đạo (cuộc họp + người chỉ đạo). */
export function WorkMeetingImport({ ai, service, board, people, actorName, onClose, onDone }: {
  ai: WorkAiService;
  service: Pick<WorkTaskService, "preview" | "create">;
  board: Pick<WorkBoardService, "linkAi" | "learnPersonAlias" | "createMeeting" | "setOrigin">;
  people: WorkAssignablePeople;
  actorName: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const choices = quickChoices(people);
  const [text, setText] = useState("");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [heldOn, setHeldOn] = useState(localIsoDate(new Date()));
  const [giverId, setGiverId] = useState("");
  const [record, setRecord] = useState(true);
  const [busy, setBusy] = useState(false);
  const meetingId = useRef<string | null>(null);
  const attempts = useRef(new Map<string, { signature: string; value: WorkCreateAttempt }>());
  const fileRef = useRef<HTMLInputElement>(null);
  const today = localIsoDate(new Date());

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const next = [...images];
    for (const file of [...files]) {
      if (next.length >= 4) { setError("Tối đa 4 ảnh mỗi lần."); break; }
      try { next.push(await readImageFile(file)); } catch (e) { setError(e instanceof Error ? e.message : "Không đọc được ảnh."); }
    }
    setImages(next);
  }

  async function read() {
    if (text.trim().length < 10 && !images.length) { setError("Dán nội dung biên bản (ít nhất vài dòng) hoặc thêm ảnh sổ họp."); return; }
    setReading(true); setError("");
    const r = await ai.meetingTasks(text.trim(), images.map<AiImage>((i) => ({ mime: i.mime, b64: i.b64 })), people.people);
    setReading(false);
    if (!r.ok) { setError(`${r.message} Bạn vẫn giao từng việc ở ô Giao nhanh.`); return; }
    if (!r.result.tasks.length) { setError("AI không thấy việc nào được giao trong biên bản — kiểm lại nội dung hoặc giao tay."); return; }
    setRunId(r.runId);
    setWarnings(r.result.warnings);
    setTitle(r.result.meetingTitle || `Họp ${ddmm(today)}`);
    if (r.result.heldOn && r.result.heldOn <= today) setHeldOn(r.result.heldOn);
    const chair = r.result.chairman ? matchWorkPerson(r.result.chairman, null, people.people) : null;
    setGiverId(chair?.kind === "one" && !chair.person.isMe ? chair.person.userId : "");
    setRows(r.result.tasks.map((t, i) => {
      const m = matchWorkPerson(t.assignee, t.assigneeName, choices);
      const due = resolveDue(t);
      return {
        key: `r${i}`, include: true, title: t.title, phrase: t.assignee,
        assigneeId: m.kind === "one" ? m.person.userId : "", candidates: m.kind === "many" ? m.people : [],
        date: due.at ? localIsoDate(due.at) : "", time: due.at ? hhmm(due.at) : "17:00", level: t.level || "B",
        note: t.note || "", quote: t.quote, state: "idle", message: "",
      };
    }));
  }

  const patch = (key: string, p: Partial<Row>) => setRows((list) => list && list.map((r) => (r.key === key ? { ...r, ...p, ...(r.state === "error" ? { state: "idle", message: "" } : {}) } : r)));
  const todo = (rows || []).filter((r) => r.include && r.state !== "done");

  async function giveAll() {
    if (!rows) return;
    const checked = rows.map((r) => {
      if (!r.include || r.state === "done") return r;
      const deadline = r.date ? dateAt(r.date, r.time) : null;
      const problem = r.title.trim().length < 2 ? "Nhập tên việc." : !r.assigneeId ? "Chọn người làm." : !deadline || deadline.getTime() <= Date.now() ? "Chọn hạn sau thời điểm hiện tại." : "";
      return problem ? { ...r, state: "error" as const, message: problem } : r;
    });
    setRows(checked);
    if (checked.some((r) => r.include && r.state === "error")) return;
    setBusy(true); setError("");
    if (record && !meetingId.current) {
      try { meetingId.current = (await board.createMeeting(title.trim() || `Họp ${ddmm(heldOn)}`, heldOn)).meetingId; }
      catch (e) { setBusy(false); setError(`Chưa ghi được cuộc họp: ${workError(e)}`); return; }
    }
    let done = 0;
    const out = [...checked];
    for (let i = 0; i < out.length; i++) {
      const r = out[i];
      if (!r.include || r.state === "done") continue;
      const input = quickTaskInput({ title: r.title, assigneeId: r.assigneeId, deadline: dateAt(r.date, r.time)!, level: r.level, description: r.note,
        checklist: "", tags: "", evidence: { photo: false, file: false } });
      const signature = JSON.stringify(input);
      try {
        let a = attempts.current.get(r.key);
        if (!a || a.signature !== signature) {
          const preview = await service.preview(input.recipientSources, input.scope);
          if (!preview.validCount) throw new Error("WORK_NO_VALID_RECIPIENTS");
          a = { signature, value: new WorkCreateAttempt(input, preview.fingerprint) };
          attempts.current.set(r.key, a);
        }
        const result = await service.create(a.value.input, a.value.key, a.value.fingerprint);
        attempts.current.delete(r.key);
        let message = "";
        if (record && meetingId.current) {
          try { await board.setOrigin(result.taskId, "directive", meetingId.current, giverId || null); }
          catch { message = "Đã giao, chưa ghi được vào Sổ chỉ đạo."; }
        }
        if (runId) void board.linkAi(result.taskId, runId, "meeting_tasks").catch(() => undefined);
        const picked = choices.find((p) => p.userId === r.assigneeId);
        if (runId && r.phrase && picked && !picked.isMe && matchWorkPerson(r.phrase, null, choices).kind !== "one") {
          void board.learnPersonAlias(result.taskId, r.phrase).catch(() => undefined);
        }
        out[i] = { ...r, state: "done", code: result.taskCode, message };
        done += 1;
      } catch (caught) {
        if (caught instanceof Error && /^(WORK_RECIPIENT_PREVIEW_STALE|WORK_NO_VALID_RECIPIENTS|WORK_DEADLINE_EXPIRED)/.test(caught.message)) attempts.current.delete(r.key);
        out[i] = { ...r, state: "error", message: workError(caught) };
      }
      setRows([...out]);
    }
    setBusy(false);
    const failed = out.filter((r) => r.include && r.state === "error").length;
    if (done) onDone(`Đã giao ${done} việc từ biên bản${record ? " · ghi vào Sổ chỉ đạo" : ""}${failed ? ` · ${failed} việc chưa giao được` : ""}`);
    if (!failed && done) onClose();
  }

  return (
    <section className="work-meeting" aria-label="Giao từ biên bản họp">
      <header className="work-meeting-head">
        <h3><Sparkles size={16} aria-hidden="true" /> Giao từ biên bản họp</h3>
        <button type="button" className="work-icon-button" aria-label="Đóng" onClick={onClose} disabled={busy}><X size={16} /></button>
      </header>
      {!rows ? (
        <>
          <textarea className="work-input work-meeting-text" rows={6} maxLength={12000} value={text} aria-label="Nội dung biên bản"
            placeholder={"Dán biên bản họp / tin nhắn chỉ đạo, VD:\n1. Anh Đô rà soát hồ sơ thanh toán đợt 3 SMB, xong trước thứ 6.\n2. Chị Hương chốt dòng tiền tháng 11, gấp."}
            onChange={(e) => setText(e.target.value)} />
          <div className="work-meeting-photos">
            {images.map((img) => (
              <span key={img.id} className="work-meeting-thumb">
                <img src={img.previewUrl} alt={img.name} />
                <button type="button" aria-label={`Bỏ ảnh ${img.name}`} onClick={() => setImages((list) => list.filter((x) => x.id !== img.id))}><X size={12} /></button>
              </span>
            ))}
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
            <button type="button" className="work-secondary" onClick={() => fileRef.current?.click()} disabled={images.length >= 4}>
              <Camera size={15} /> Ảnh sổ họp
            </button>
            <button type="button" className="work-primary" onClick={() => void read()} disabled={reading}>
              {reading ? <Loader2 size={15} className="work-spin" /> : <Sparkles size={15} />} {reading ? "AI đang tách việc…" : "Tách việc"}
            </button>
          </div>
          <p className="work-hint">AI chỉ tách nháp; bạn kiểm người làm, hạn từng việc rồi mới giao.</p>
        </>
      ) : (
        <>
          <div className="work-meeting-meta">
            <label className="work-label">Cuộc họp<input className="work-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={!record || busy} /></label>
            <label className="work-label">Ngày họp<input className="work-input" type="date" value={heldOn} max={today} onChange={(e) => setHeldOn(e.target.value)} disabled={!record || busy} /></label>
            <label className="work-label">Người chỉ đạo
              <select className="work-input" value={giverId} onChange={(e) => setGiverId(e.target.value)} disabled={!record || busy}>
                <option value="">Không ghi</option>
                {people.people.filter((p) => !p.isMe).map((p) => <option key={p.userId} value={p.userId}>{personOption(p, actorName)}</option>)}
              </select>
            </label>
            <label className="work-meeting-record"><input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} disabled={busy || Boolean(meetingId.current)} /> Ghi vào Sổ chỉ đạo</label>
          </div>
          {warnings.length > 0 && <p className="work-ai-note is-warn" role="status"><Sparkles size={14} aria-hidden="true" /> <span>{warnings.join(" · ")}</span></p>}
          <ol className="work-meeting-rows">
            {rows.map((r) => (
              <li key={r.key} className={`work-meeting-row is-${r.state}${r.include ? "" : " is-off"}`}>
                <input type="checkbox" checked={r.include} aria-label={`Giao việc ${r.title}`} disabled={r.state === "done" || busy}
                  onChange={(e) => patch(r.key, { include: e.target.checked })} />
                <div className="work-meeting-fields">
                  <input className="work-input" value={r.title} maxLength={300} aria-label="Tên việc" disabled={r.state === "done" || busy}
                    onChange={(e) => patch(r.key, { title: e.target.value })} />
                  <div className="work-meeting-line">
                    <select className="work-input" aria-label="Người làm" value={r.assigneeId} disabled={r.state === "done" || busy}
                      onChange={(e) => patch(r.key, { assigneeId: e.target.value, candidates: [] })}>
                      <option value="" disabled>{r.phrase ? `Chọn người (“${r.phrase}”)` : "Chọn người làm"}</option>
                      {choices.map((p) => <option key={p.userId} value={p.userId}>{personOption(p, actorName)}</option>)}
                    </select>
                    <input className="work-input" type="date" aria-label="Ngày hạn" value={r.date} min={today} disabled={r.state === "done" || busy}
                      onChange={(e) => patch(r.key, { date: e.target.value })} />
                    <input className="work-input work-quick-time" type="time" aria-label="Giờ hạn" value={r.time} step={900} disabled={r.state === "done" || busy}
                      onChange={(e) => patch(r.key, { time: e.target.value || "17:00" })} />
                    <div className="work-quick-seg work-quick-level" role="group" aria-label="Mức quan trọng">
                      {(["A", "B", "C"] as const).map((l) => (
                        <button type="button" key={l} data-level={l} aria-pressed={r.level === l} title={WORK_LEVEL_LABELS[l]} disabled={r.state === "done" || busy}
                          onClick={() => patch(r.key, { level: l })}>{l}</button>
                      ))}
                    </div>
                  </div>
                  {r.candidates.length > 0 && !r.assigneeId && (
                    <div className="work-ai-pick" role="group" aria-label="Chọn người làm">
                      <span>“{r.phrase}” là ai?</span>
                      {r.candidates.map((p) => <button type="button" key={p.userId} className="work-chip-button" onClick={() => patch(r.key, { assigneeId: p.userId, candidates: [] })}>{personOption(p, actorName)}</button>)}
                    </div>
                  )}
                  {r.quote && <p className="work-meeting-quote">“{r.quote}”</p>}
                  {r.state === "done" && <p className="work-meeting-ok"><CheckCircle2 size={14} aria-hidden="true" /> Đã giao {r.code}{r.message ? ` · ${r.message}` : ""}</p>}
                  {r.state === "error" && <p className="work-error" role="alert">{r.message}</p>}
                </div>
              </li>
            ))}
          </ol>
          {error && <p className="work-error" role="alert">{error}</p>}
          <div className="work-meeting-foot">
            <button type="button" className="work-secondary" disabled={busy || rows.some((r) => r.state === "done")} onClick={() => { setRows(null); setWarnings([]); }}>Tách lại</button>
            <button type="button" className="work-primary" disabled={busy || !todo.length} onClick={() => void giveAll()}
              title={!todo.length ? "Chưa chọn việc nào để giao" : undefined}>
              {busy ? <Loader2 size={15} className="work-spin" /> : <Send size={15} />} {busy ? "Đang giao…" : `Giao ${todo.length} việc`}
            </button>
          </div>
        </>
      )}
      {!rows && error && <p className="work-error" role="alert">{error}</p>}
    </section>
  );
}
