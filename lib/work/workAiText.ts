/** Vioo Work Đợt 1 (PR-3): phần chạy trên máy của nháp AI — khớp người, đổi chữ hạn thành ngày, dựng số liệu gửi AI.
 * Không gọi mạng (bộ kiểm model thật trong scripts/assistant-evals dùng lại). */
import type { WorkAssignablePerson, WorkLevel, WorkTaskBrief } from "./workBoardService";
import { WORK_LEVEL_LABELS } from "./workBoardService";
import { workDayLabel, workStatusLabels } from "./workPresentation";
import type { WorkTaskStatus } from "./workTypes";

export interface AiDraftCore {
  title: string; assignee: string | null; assigneeName: string | null;
  dueText: string | null; dueDate: string | null; dueTime: string | null; level: WorkLevel | null;
}
export interface AiTaskDraft extends AiDraftCore {
  description: string; checklist: string[]; tags: string[]; evidence: { photo: boolean; file: boolean }; warnings: string[];
}
export interface AiMeetingTask extends AiDraftCore { note: string | null; quote: string | null }
export interface AiMeeting { meetingTitle: string | null; heldOn: string | null; chairman: string | null; tasks: AiMeetingTask[]; warnings: string[] }
export interface AiUpdateDraft { done: string; doing: string; next: string; blocked: string; percent: number | null; warnings: string[] }
export interface AiTaskWriting { description: string; checklist: string[]; evidence: { photo: boolean; file: boolean } }
export interface AiImage { mime: "image/jpeg" | "image/png" | "image/webp"; b64: string }

const pad = (n: number) => String(n).padStart(2, "0");
export const localIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Danh sách gửi AI để nhận ra chữ nào là người (chỉ họ tên + đơn vị + cách gọi đã học, không có id / liên hệ). */
export const workPeopleLines = (people: WorkAssignablePerson[]) => people
  .filter((p) => p.canReceive || p.isMe).slice(0, 200)
  .map((p) => `${p.isMe ? "Tôi (người giao): " : ""}${p.name}${p.unit ? ` · ${p.unit.code || p.unit.name}` : ""}${p.aliases.length ? ` (gọi: ${p.aliases.slice(0, 3).join(", ")})` : ""}`)
  .join("\n");

// ── Khớp người ───────────────────────────────────────────────────────────────────────────────────────────────
export const foldVi = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
  .toLowerCase().replace(/\s+/g, " ").trim();
const HONORIFIC = new Set(["anh", "chi", "em", "a", "c", "e", "bac", "chu", "co", "ong", "ba", "sep", "mr", "ms", "mrs", "dc", "thay", "giao", "cho", "nho", "ban"]);
export type PersonMatch =
  | { kind: "one"; person: WorkAssignablePerson; exact: boolean }
  | { kind: "many"; people: WorkAssignablePerson[] }
  | { kind: "none" };

/** "Hà" / "anh Đô" / "Hà KH" / "tôi" → người giao được. exact = khớp đúng họ tên hoặc cách gọi đã học (không cần học thêm). */
export function matchWorkPerson(phrase: string | null, nameHint: string | null, people: WorkAssignablePerson[]): PersonMatch {
  const pool = people.filter((p) => p.canReceive || p.isMe);
  const q = foldVi(phrase);
  if (/^(toi|minh|em|tu lam|chinh toi|ban than)$/.test(q)) {
    const me = pool.find((p) => p.isMe);
    return me ? { kind: "one", person: me, exact: true } : { kind: "none" };
  }
  const exact = (text: string) => pool.filter((p) => foldVi(p.name) === text || p.aliases.some((a) => foldVi(a) === text));
  if (q) {
    const same = exact(q);
    if (same.length === 1) return { kind: "one", person: same[0], exact: true };
    if (same.length > 1) return { kind: "many", people: same };
  }
  const words = q.split(/[^a-z0-9]+/).filter((w) => w && !HONORIFIC.has(w));
  const hits = words.length ? pool.filter((p) => {
    const name = foldVi(p.name).split(" ");
    const given = name[name.length - 1];
    const unit = foldVi(`${p.unit?.code || ""} ${p.unit?.name || ""}`);
    return (words.includes(given) && words.every((w) => name.includes(w)))
      || (words[0] === given && words.length > 1 && words.slice(1).every((w) => unit.includes(w)));
  }) : [];
  if (hits.length === 1) return { kind: "one", person: hits[0], exact: false };
  // AI chắc họ tên trong danh sách: chỉ nhận khi họ tên đó nằm trong các người khớp chữ (hoặc câu không có chữ người).
  const hinted = nameHint ? exact(foldVi(nameHint)) : [];
  if (hinted.length === 1 && (!hits.length || hits.includes(hinted[0]))) return { kind: "one", person: hinted[0], exact: !q };
  if (hits.length > 1) return { kind: "many", people: hits.slice(0, 6) };
  return { kind: "none" };
}

// ── Đổi chữ hạn thành ngày (giờ máy người dùng, mặc định 17:00) ──────────────────────────────────────────────
const at = (d: Date, h: number, m: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Thứ trong tuần kiểu VN: thứ 2 = 1 … thứ 7 = 6, chủ nhật = 0; tuần bắt đầu thứ 2. */
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

function timeOf(t: string, fallback: string | null): [number, number] {
  const m = t.match(/(\d{1,2})\s*(?:h(?![a-z])|gio\b|:)\s*(\d{2})?/);
  if (m) {
    let h = Number(m[1]); const min = Number(m[2] || 0);
    if (h < 12 && /chieu|toi/.test(t)) h += 12;
    if (h <= 23 && min <= 59) return [h, min];
  }
  const f = fallback?.match(/^(\d{2}):(\d{2})$/);
  return f ? [Number(f[1]), Number(f[2])] : [17, 0];
}

/** "thứ 6", "mai", "trước 25/10", "cuối tuần", "thứ 6 tuần sau", "3 ngày nữa" → ngày giờ; không hiểu thì null. */
export function parseDueText(text: string | null, now: Date = new Date(), dueTime: string | null = null): Date | null {
  // "một / hai / ba ngày / tuần" → số (để "mốt" không nhầm với "một").
  const t = foldVi(text).replace(/\b(mot|hai|ba) (ngay|tuan)\b/g, (_, w: string, u: string) => `${{ mot: 1, hai: 2, ba: 3 }[w]} ${u}`);
  if (!t) return null;
  const [h, m] = timeOf(t, dueTime);
  const today = at(now, 0, 0);
  const nextWeek = /tuan (sau|toi)/.test(t);
  const dm = t.match(/(?<!\d)(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?!\d)/);
  if (dm) {
    const day = Number(dm[1]); const month = Number(dm[2]) - 1;
    let year = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : now.getFullYear();
    if (!dm[3] && new Date(year, month, day) < addDays(today, -60)) year += 1;
    const d = new Date(year, month, day);
    if (d.getMonth() === month && d.getDate() === day) return at(d, h, m);
  }
  const n = t.match(/(?<!\b(?:thu|t) ?)(\d{1,2}) (ngay|tuan)(?! ?\d)/);
  if (n) return at(addDays(today, Number(n[1]) * (n[2] === "tuan" ? 7 : 1)), h, m);
  if (/\b(hom nay|trong ngay)\b/.test(t)) return at(today, h, m);
  if (/\b(ngay kia|mot)\b/.test(t)) return at(addDays(today, 2), h, m);
  if (/\b(ngay mai|mai)\b/.test(t)) return at(addDays(today, 1), h, m);
  if (/cuoi thang/.test(t)) return at(new Date(now.getFullYear(), now.getMonth() + 1, 0), h, m);
  const wd = t.match(/\b(?:thu|t)\s*([2-7])\b/) || (/\b(chu nhat|cn)\b/.test(t) ? ["", "8"] : null);
  const target = wd ? Number(wd[1]) - 1 : /cuoi tuan/.test(t) ? 6 : /dau tuan/.test(t) ? 1 : nextWeek ? 6 : null; // CN → 7 (cuối tuần VN)
  if (target == null) return null;
  const offset = (target === 7 ? 6 : target - 1); // ngày thứ mấy kể từ thứ 2
  if (nextWeek) return at(addDays(mondayOf(today), 7 + offset), h, m);
  let d = addDays(mondayOf(today), offset);
  if (at(d, h, m) <= now) d = addDays(d, 7);
  return at(d, h, m);
}

/** Hạn của nháp AI: chữ trong câu (máy đổi) trước, ngày AI tính sau; lệch nhau thì trả cả hai để người giao chọn. */
export function resolveDue(d: Pick<AiDraftCore, "dueText" | "dueDate" | "dueTime">, now: Date = new Date()): { at: Date | null; alt: Date | null } {
  const fromText = parseDueText(d.dueText, now, d.dueTime);
  const fromAi = d.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(d.dueDate)
    ? (() => { const [y, mo, da] = d.dueDate!.split("-").map(Number); const [h, m] = timeOf("", d.dueTime); return new Date(y, mo - 1, da, h, m); })()
    : null;
  const okAi = fromAi && fromAi > now ? fromAi : null;
  if (fromText) return { at: fromText, alt: okAi && localIsoDate(okAi) !== localIsoDate(fromText) ? okAi : null };
  return { at: okAi, alt: null };
}

// ── Số liệu gửi AI (máy tính sẵn) ───────────────────────────────────────────────────────────────────────────
/** Kịp hạn hay không — máy tính, AI chỉ nói lại (giống công cụ tom_tat_viec ở cổng AI). */
export function workDueAssessment(t: { status: string; deadlineAt: string | null; createdAt: string | null; progressPercent: number }, now: Date = new Date()) {
  if (t.status === "completed") return "Đã hoàn thành";
  if (t.status === "cancelled") return "Đã hủy";
  const due = Date.parse(t.deadlineAt || "");
  if (Number.isNaN(due)) return "Chưa có hạn";
  const n = now.getTime();
  if (due < n) return `Đã quá hạn ${Math.max(1, Math.ceil((n - due) / 86_400_000))} ngày`;
  const start = Date.parse(t.createdAt || "");
  if (Number.isNaN(start) || due <= start) return "Còn hạn";
  const elapsed = Math.round(((n - start) / (due - start)) * 100);
  return elapsed - t.progressPercent >= 25
    ? `Có nguy cơ trễ: đã qua ${elapsed}% thời gian, tiến độ ${t.progressPercent}%`
    : `Đang kịp: đã qua ${elapsed}% thời gian, tiến độ ${t.progressPercent}%`;
}

const LEVEL_TEXT = (level: WorkLevel) => `${level} · ${WORK_LEVEL_LABELS[level]}`;
const ago = (iso: string | null, now: Date) => {
  const h = iso ? (now.getTime() - Date.parse(iso)) / 3_600_000 : NaN;
  return Number.isNaN(h) ? null : h < 24 ? `${Math.max(1, Math.round(h))} giờ trước` : `${Math.floor(h / 24)} ngày trước`;
};

/** Các dòng số liệu cho skill tóm tắt việc (từ work_task_brief_v1, đã kiểm quyền). */
export function workBriefFacts(b: WorkTaskBrief, now: Date = new Date()) {
  const t = b.task;
  const status = workStatusLabels[t.status as WorkTaskStatus] || t.status;
  const updates = b.updates.slice(0, 3).map((u) => `- ${workDayLabel(u.at)} · ${u.author}: ${[
    u.done && `Đã: ${u.done}`, u.doing && `Đang: ${u.doing}`, u.next && `Sẽ: ${u.next}`, u.blocked && `Vướng: ${u.blocked}`,
  ].filter(Boolean).join("; ")} (${u.progressBefore}% → ${u.progressAfter}%)`);
  const origin = b.origin?.origin === "directive" ? `Chỉ đạo${b.origin.meeting ? ` · ${b.origin.meeting.title}` : ""}${b.origin.giver ? ` · ${b.origin.giver.name}` : ""}`
    : b.origin?.origin === "oral_claim" ? `Giao trực tiếp · ${b.origin.claimStatus === "confirmed" ? "đã xác nhận" : b.origin.claimStatus === "rejected" ? "người giao không nhận" : "chờ người giao xác nhận"}` : null;
  return [
    `Việc: ${t.code} · ${t.title}`,
    `Mức: ${LEVEL_TEXT(t.level)}`,
    `Trạng thái: ${status} · tiến độ ${t.progressPercent}%`,
    `Hạn: ${t.deadlineAt ? workDayLabel(t.deadlineAt) : "chưa có hạn"}`,
    `Đánh giá hạn: ${workDueAssessment({ status: t.status, deadlineAt: t.deadlineAt, createdAt: t.createdAt, progressPercent: t.progressPercent }, now)}`,
    t.createdBy && `Người giao: ${t.createdBy.name}`,
    t.reviewer && `Người duyệt: ${t.reviewer.name}`,
    b.assignees.length && `Người làm: ${b.assignees.map((a) => `${a.name}${a.acknowledgedAt ? "" : " (chưa nhận việc)"}`).join(", ")}`,
    b.checklist.total && `Checklist: ${b.checklist.done}/${b.checklist.total} mục xong`,
    b.children.total && `Việc con: ${b.children.open} chưa xong / ${b.children.total}`,
    origin && `Nguồn: ${origin}`,
    `Lần cập nhật cuối: ${ago(t.lastProgressAt, now) || "chưa có"}`,
    updates.length ? `Cập nhật gần nhất:\n${updates.join("\n")}` : "Chưa có cập nhật Đã / Đang / Sẽ / Vướng.",
  ].filter(Boolean).join("\n");
}

/** Bối cảnh việc cho skill viết giúp cập nhật (tên, % hiện tại, hạn, lần cập nhật trước). */
export function workUpdateFacts(t: { task_code: string; title: string; progress_percent: number; deadline_at: string | null }, brief: WorkTaskBrief | null) {
  const last = brief?.updates[0];
  return [
    `Việc: ${t.task_code} · ${t.title}`,
    `Tiến độ hiện tại: ${t.progress_percent}%`,
    `Hạn: ${t.deadline_at ? workDayLabel(t.deadline_at) : "chưa có hạn"}`,
    brief?.checklist.total ? `Checklist: ${brief.checklist.done}/${brief.checklist.total} mục xong` : null,
    last ? `Lần cập nhật trước (${workDayLabel(last.at)}): ${[last.done && `Đã: ${last.done}`, last.doing && `Đang: ${last.doing}`, last.next && `Sẽ: ${last.next}`].filter(Boolean).join("; ")}` : null,
  ].filter(Boolean).join("\n");
}
