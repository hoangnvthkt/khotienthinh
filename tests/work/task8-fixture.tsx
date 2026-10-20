// Browser-only isolated fixture. Never mounted by the production entry point.
import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { WorkWorkspace } from "../../pages/work/WorkPage";
import { createWorkAi } from "../../lib/work/workAi";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type { createWorkAttachmentService } from "../../lib/work/workAttachmentService";
import {
  documentText,
  emptyWorkDraft,
  mentionedUserIds,
  workDocument,
} from "../../lib/work/workForm";
import type { WorkTaskSummary, WorkTextDocument } from "../../lib/work/workTypes";
const query = new URLSearchParams(window.location.search);
if (query.get("layout") === "true") {
  const root = document.getElementById("root")!;
  const host = document.createElement("main");
  host.dataset.workScrollHost = "true";
  host.style.cssText = "height:100dvh;overflow:auto;position:relative";
  root.replaceWith(host);
  host.append(root);
  const nav = document.createElement("nav");
  nav.textContent = "Điều hướng ứng dụng";
  nav.style.cssText =
    "position:fixed;bottom:0;left:0;right:0;height:64px;background:white;border-top:1px solid #ddd;z-index:50;text-align:center;padding:20px";
  document.body.append(nav);
}
const qa = {
  calls: [] as { name: string; args: unknown[] }[],
  createAttempts: 0,
  finalizeAttempts: 0,
  denyReads: false,
};
(window as unknown as { workQa: typeof qa }).workQa = qa;
const subscribeRefresh = (invalidate: () => void) => {
  window.addEventListener("focus", invalidate);
  return () => window.removeEventListener("focus", invalidate);
};
const log = (name: string, ...args: unknown[]) => qa.calls.push({ name, args });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const summary = (id: string, title: string): WorkTaskSummary => ({
  id,
  task_code: `VW-2026-${id.padStart(6, "0")}`,
  title,
  status: "in_progress",
  priority: "important",
  privacy: "standard",
  scope_type: "direct",
  department_id: null,
  project_id: null,
  task_group_id: null,
  planned_start_at: "2026-09-09T01:00:00Z",
  deadline_at: "2026-09-10T10:00:00Z",
  parent_task_id: null,
  created_by: "actor",
  reviewer_user_id: "actor",
  updated_at: "2026-09-07T00:00:00Z",
  lock_version: 1,
  assignment_count: 2,
  acknowledged_count: 1,
  progress_percent: id === "1" ? 65 : 25,
  last_progress_at: "2026-09-09T01:15:00Z",
});
const people = [
  { id: "actor", name: "Lê Minh An", kind: "user" },
  { id: "second", name: "Nguyễn Thu Hà", kind: "user" },
  { id: "third", name: "Lý Thị Hà", kind: "user" },
  { id: "fourth", name: "Vương Thành Đô", kind: "user" },
];
let taskStatus = query.get("state") || "in_progress";
let taskVersion = 1;
let commandAttempts = 0;
const commandResults = new Map<string, any>();
const fixtureComments: any[] = [];
let checkDone = false;
let commentVersion = 1;
let pinned = false;
let plannedStartAt: string | null = "2026-09-09T01:00:00Z";
let deadlineAt: string | null = "2026-09-10T10:00:00Z";
let watcherIds = ["second"];
let descriptionDocument: WorkTextDocument = workDocument(
  "Kiểm tra đầy đủ hồ sơ trước khi trình duyệt.\nKhông diễn giải nội dung thành HTML.",
);
let resultDraftDocument: WorkTextDocument = workDocument("Bản nháp kết quả ban đầu.");
let progressPercent = 65;
const fixtureChildren: any[] = [];
const role = query.get("role") || "assignee";
const comment = (id: string, text: string) => ({
  id,
  task_id: "1",
  author_user_id: "actor",
  parent_comment_id: null,
  content_document: workDocument(text),
  content_text: text,
  edited_at: null,
  lock_version: 1,
  created_at: "2026-09-07T01:00:00Z",
  updated_at: "2026-09-07T01:00:00Z",
  mentionedUserIds: [],
  can_edit: role !== "watcher",
});
// Đợt 1: dòng cập nhật + tóm tắt + người giao được (bật bằng ?updates=1, ?origin=claim|directive, ?quick=false).
const fixtureUpdates: any[] = query.get("updates") === "1" ? [
  { id: "u2", at: "2026-09-09T01:15:00Z", authorId: "actor", authorName: "Lê Minh An", done: "Đối chiếu xong biên bản trục A–D.", doing: "Ký nháy biên bản trục E–H.",
    next: "Nộp hồ sơ cho tư vấn giám sát 10/9.", blocked: "Thiếu chữ ký chỉ huy trưởng.", progressBefore: 40, progressAfter: 65, ai: true,
    files: [{ id: "f1", name: "BB-nghiem-thu-A-D.pdf", mime: "application/pdf", evidenceType: null }] },
  { id: "u1", at: "2026-09-08T09:30:00Z", authorId: "actor", authorName: "Lê Minh An", done: "Gom đủ 12 biên bản.", next: "Đối chiếu trục A–D.",
    progressBefore: 10, progressAfter: 40, ai: false, files: [] },
] : [];
// Việc của tôi (mockup v1): bảng giả theo giờ máy; ?board=empty | error. Lệnh trên việc "b-*" đổi trạng thái việc đó.
const bDay = (offset: number, h = 17) => { const d = new Date(); d.setHours(h, 0, 0, 0); d.setDate(d.getDate() + offset); return d.toISOString(); };
const bIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const bMonday = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
const bAdd = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const toSaturday = (6 - new Date().getDay() + 7) % 7;
const canOf = (t: any) => {
  const live = !["completed", "cancelled", "awaiting_review"].includes(t.status);
  return { acknowledge: live && !t.acknowledged, start: live && t.acknowledged && ["not_started", "changes_requested"].includes(t.status),
    block: live && t.acknowledged && t.status === "in_progress", unblock: live && t.acknowledged && t.status === "blocked",
    submit: live && t.acknowledged && ["in_progress", "changes_requested"].includes(t.status) };
};
const bTask = (id: string, x: any) => ({ id, code: `VW-2026-0002${id.slice(2)}`, labels: [], lockVersion: 1, blockedReason: null, completedAt: null,
  createdAt: bDay(-6, 9), lastProgressAt: bDay(-1, 10), acknowledged: true, needsReview: true, createdBy: { id: "head", name: "Vương Thành Đô" },
  createdByMe: false, createdByHead: true, checklist: { done: 0, total: 0 }, origin: null, progressPercent: 0, status: "in_progress", ...x });
const boardTasks: any[] = query.get("board") === "empty" ? [] : [
  bTask("b-01", { title: "Bóc khối lượng phát sinh móng PĐ3 – XinHai", level: "A", deadlineAt: bDay(-3), progressPercent: 60, lastProgressAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    labels: ["XinHai", "Khối lượng"], checklist: { done: 3, total: 5 }, createdByHead: false, createdBy: { id: "tgd", name: "Tổng giám đốc" },
    origin: { origin: "directive", claimStatus: "not_needed", giver: { id: "tgd", name: "BLĐ" }, meeting: { title: "Giao ban 12/10", heldOn: "2026-10-12" } } }),
  bTask("b-02", { title: "Gửi biên bản nghiệm thu cột trục A–D cho CĐT – SMB", level: "B", deadlineAt: bDay(0, 23), progressPercent: 80, lastProgressAt: new Date(Date.now() - 18 * 3_600_000).toISOString(), labels: ["SMB", "Nghiệm thu"] }),
  bTask("b-03", { title: "Cập nhật ảnh tiến độ tuần vào Nhật ký SMB", level: "C", deadlineAt: bDay(0, 23), status: "not_started", createdByMe: true, createdByHead: false, needsReview: false,
    lastProgressAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), labels: ["SMB", "Nhật ký"] }),
  bTask("b-04", { title: "Đối chiếu đơn giá cốp pha với 3 nhà cung cấp", level: "B", deadlineAt: bDay(Math.max(1, toSaturday)), status: "blocked", blockedReason: "Chờ phòng Mua hàng gửi báo giá thứ 3",
    progressPercent: 40, lastProgressAt: new Date(Date.now() - 60 * 3_600_000).toISOString(), labels: ["Mua hàng"] }),
  bTask("b-05", { title: "Lập kế hoạch vật tư tuần 44 cho XinHai", level: "A", deadlineAt: bDay(Math.max(1, toSaturday) + 3), status: "pending_acknowledgement", acknowledged: false, lastProgressAt: bDay(-1, 9), labels: ["XinHai"] }),
  bTask("b-06", { title: "Đề xuất phương án tăng ca lắp dựng kèo – SMB", level: "A", deadlineAt: bDay(Math.max(1, toSaturday)), createdByMe: true, createdByHead: false, needsReview: true,
    origin: { origin: "oral_claim", claimStatus: "pending", giver: { id: "ptgd", name: "Phó TGĐ" }, meeting: null } }),
  bTask("b-07", { title: "Rà soát hồ sơ thanh toán đợt 2 SMB", level: "B", deadlineAt: bDay(-1), status: "completed", completedAt: bDay(-1, 15), progressPercent: 100 }),
  bTask("b-08", { title: "Nghiệm thu cốp pha sàn tầng 3 – SMB", level: "B", deadlineAt: bDay(Math.max(1, toSaturday) + 5), progressPercent: 20, lastProgressAt: new Date(Date.now() - 5 * 3_600_000).toISOString() }),
  bTask("b-09", { title: "Chốt khối lượng thép tháng 10 – XinHai", level: "C", deadlineAt: bDay(Math.max(1, toSaturday) + 5), progressPercent: 50, lastProgressAt: new Date(Date.now() - 6 * 3_600_000).toISOString() }),
  bTask("b-10", { title: "Báo cáo tuần 42 cho Trưởng phòng", level: "C", deadlineAt: bDay(-6), status: "completed", completedAt: bDay(-6, 11), progressPercent: 100 }),
  bTask("b-11", { title: "Cập nhật danh bạ nhà cung cấp", level: "C", deadlineAt: null, progressPercent: 10, lastProgressAt: new Date(Date.now() - 20 * 3_600_000).toISOString() }),
];
for (const t of boardTasks) t.can = canOf(t);

// Phòng tôi / Toàn công ty / Sổ chỉ đạo (PR-4): ?access=staff → không có tab; ?access=head → chỉ Phòng tôi.
const bLastWeek = bIso(bAdd(bMonday, -7));
const member = (userId: string, name: string, title: string, x: any) => ({ userId, name, title, orgUnitId: "u-qlda", isHead: false,
  active: 3, levels: { A: 1, B: 1, C: 1 }, load: 6, overdue: 0, stale: 0, unack: 0, due: 3, ontime: 3, ...x });
const teamMembers = (prev: boolean) => [
  member("fourth", "Vương Thành Đô", "Trưởng phòng", { isHead: true, active: 2, levels: { A: 1, B: 1, C: 0 }, load: 5, due: 2, ontime: 2 }),
  member("actor", "Lê Minh An", "Kỹ sư dự án", { active: 6, levels: { A: 2, B: 3, C: 1 }, load: 13, overdue: 1, stale: 1, due: 7, ontime: prev ? 5 : 6 }),
  member("second", "Nguyễn Thu Hà", "Kỹ sư kế hoạch", { active: 4, levels: { A: 1, B: 2, C: 1 }, load: 8, unack: 1, due: 4, ontime: prev ? 4 : 3 }),
  member("khoi", "Tạ Minh Khôi", "Kỹ sư hiện trường", { active: 5, levels: { A: 2, B: 1, C: 2 }, load: 10, overdue: 2, stale: 2, due: 5, ontime: 2 }),
  member("bao", "Phan Quốc Bảo", "Chuyên viên hồ sơ", { active: 1, levels: { A: 0, B: 0, C: 1 }, load: 1, due: 0, ontime: 0 }),
];
const unit = (id: string, code: string, name: string, parent: string, x: any) => ({ id, code, name, type: "department",
  parent: { id: `p-${parent}`, code: null, name: parent }, people: 6, hasHead: true, active: 12, overdue: 0, stale: 0, due: 8, ontime: 7,
  directives: { open: 1, late: 0, doneThisMonth: 2 }, claimsPending: 0, ...x });
const companyUnits = (prev: boolean) => [
  unit("u-qlda", "QLDA", "Phòng Quản lý dự án", "Khối Văn phòng", { people: 5, due: 18, ontime: prev ? 14 : 15, overdue: 3, stale: 3, directives: { open: 3, late: 1, doneThisMonth: 2 } }),
  unit("u-tckt", "TCKT", "Phòng Tài chính kế toán", "Khối Văn phòng", { people: 7, due: 12, ontime: 11 }),
  unit("u-hcns", "HCNS", "Phòng Hành chính nhân sự", "Khối Văn phòng", { people: 6, due: 9, ontime: prev ? 8 : 6, overdue: 2, directives: { open: 2, late: 1, doneThisMonth: 1 } }),
  unit("u-tktl", "TKTL", "Thư ký – Trợ lý", "Khối Văn phòng", { people: 3, due: 2, ontime: 2, hasHead: false, directives: { open: 0, late: 0, doneThisMonth: 0 } }),
  unit("u-smb", "BCH SMB", "Ban chỉ huy SMB", "Khối Công trường", { people: 9, due: 14, ontime: 9, overdue: 4, stale: 5, directives: { open: 2, late: 1, doneThisMonth: 0 } }),
  unit("u-xh", "XINHAI", "Ban chỉ huy XinHai", "Khối Công trường", { people: 8, due: 10, ontime: 9 }),
  unit("u-nm", "VPNM", "Văn phòng nhà máy", "Khối Nhà máy", { people: 4, due: 0, ontime: 0, hasHead: false, directives: { open: 0, late: 0, doneThisMonth: 0 } }),
];
const directiveRows: any[] = [
  { id: "d-1", code: "VW-2026-000301", title: "Rà soát hồ sơ thanh toán đợt 3 SMB", level: "A", status: "in_progress", deadlineAt: bDay(-2), progressPercent: 60, completedAt: null,
    createdAt: bDay(-8, 9), lastProgressAt: new Date(Date.now() - 70 * 3_600_000).toISOString(), origin: "directive", claimStatus: "not_needed",
    giver: { id: "tgd", name: "TGĐ" }, meeting: { title: "Giao ban tuần 42", heldOn: "2026-10-12" }, assignees: [{ name: "Lê Minh An", unit: "QLDA" }], canDecide: false, bucket: "late" },
  { id: "d-2", code: "VW-2026-000302", title: "Chốt kế hoạch dòng tiền tháng 11", level: "A", status: "in_progress", deadlineAt: bDay(4), progressPercent: 40, completedAt: null,
    createdAt: bDay(-6, 9), lastProgressAt: new Date(Date.now() - 5 * 3_600_000).toISOString(), origin: "directive", claimStatus: "not_needed",
    giver: { id: "tgd", name: "TGĐ" }, meeting: { title: "Giao ban tuần 43", heldOn: "2026-10-19" }, assignees: [{ name: "Trịnh Thị Hương", unit: "TCKT" }], canDecide: false, bucket: "doing" },
  { id: "d-3", code: "VW-2026-000303", title: "Lập kế hoạch vật tư tuần 44 cho XinHai", level: "B", status: "not_started", deadlineAt: bDay(6), progressPercent: 0, completedAt: null,
    createdAt: bDay(-1, 9), lastProgressAt: bDay(-1, 9), origin: "directive", claimStatus: "not_needed",
    giver: { id: "tgd", name: "TGĐ" }, meeting: { title: "Giao ban tuần 43", heldOn: "2026-10-19" }, assignees: [{ name: "Tạ Minh Khôi", unit: "QLDA" }], canDecide: false, bucket: "doing" },
  { id: "d-4", code: "VW-2026-000304", title: "Đề xuất phương án tăng ca lắp dựng kèo – SMB", level: "A", status: "not_started", deadlineAt: bDay(4), progressPercent: 0, completedAt: null,
    createdAt: bDay(-1, 10), lastProgressAt: bDay(-1, 10), origin: "oral_claim", claimStatus: "pending",
    giver: { id: "actor", name: "Lê Minh An" }, meeting: null, assignees: [{ name: "Nguyễn Thu Hà", unit: "QLDA" }], canDecide: true, bucket: "confirm" },
  { id: "d-5", code: "VW-2026-000305", title: "Nghiệm thu móng PĐ1 – XinHai", level: "A", status: "completed", deadlineAt: bDay(-5), progressPercent: 100, completedAt: bDay(-6, 15),
    createdAt: bDay(-15, 9), lastProgressAt: bDay(-6, 15), origin: "directive", claimStatus: "not_needed",
    giver: { id: "tgd", name: "TGĐ" }, meeting: { title: "Giao ban tuần 41", heldOn: "2026-10-05" }, assignees: [{ name: "Tạ Minh Khôi", unit: "QLDA" }], canDecide: false, bucket: "done" },
];
const reviewRows: any[] = [
  { id: "r-1", code: "VW-2026-000311", title: "Bảng so sánh giá cốp pha 3 nhà cung cấp", level: "B", deadlineAt: bDay(1), lockVersion: 4, progressPercent: 100,
    assignees: ["Tạ Minh Khôi"], iteration: 1, submittedAt: bDay(0, 9), result: "Đã so sánh 3 NCC, đề xuất chọn nhà cung cấp B vì giá thấp hơn 4%", files: 2 },
  { id: "r-2", code: "VW-2026-000312", title: "Biên bản nghiệm thu cốt thép sàn tầng 3", level: "A", deadlineAt: bDay(-1), lockVersion: 6, progressPercent: 100,
    assignees: ["Lê Minh An"], iteration: 2, submittedAt: bDay(0, 8), result: "Bổ sung chữ ký tư vấn giám sát theo góp ý lần 1", files: 1 },
];
const overviewItem = (t: any) => ({ id: t.id, code: t.code, title: t.title, status: t.status, level: t.level, deadlineAt: t.deadlineAt, progressPercent: t.progressPercent,
  lastProgressAt: t.lastProgressAt, overdue: false, restricted: false, createdByName: "Vương Thành Đô", assignees: [{ userId: "actor", name: "Lê Minh An" }] });

const board = {
  async boardAccess() {
    log("boardAccess");
    const a = query.get("access");
    return { myUnits: a === "staff" ? [] : [{ id: "u-qlda", code: "QLDA", name: "Phòng Quản lý dự án" }], company: !a,
      reviewsWaitingMe: reviewRows.length, claimsWaitingMe: directiveRows.filter((d) => d.bucket === "confirm").length };
  },
  async teamBoard(unitId: string | null, weekStart: string | null = null) {
    log("teamBoard", unitId, weekStart);
    await wait(80);
    const prev = Boolean(weekStart && weekStart < bLastWeek);
    return { unit: { id: unitId || "u-qlda", code: "QLDA", name: "Phòng Quản lý dự án" }, myUnits: [{ id: "u-qlda", code: "QLDA", name: "Phòng Quản lý dự án" }],
      weekStart: weekStart || bLastWeek, canViewAll: true, reviewWaiting: reviewRows.length, members: teamMembers(prev) };
  },
  async companyBoard(weekStart: string | null = null) {
    log("companyBoard", weekStart);
    await wait(80);
    return { weekStart: weekStart || bLastWeek, units: companyUnits(Boolean(weekStart && weekStart < bLastWeek)), claimsWaitingMe: 1 };
  },
  async reviewQueue() { log("reviewQueue"); return reviewRows.slice(); },
  async directives(orgUnitId: string | null = null) {
    log("directives", orgUnitId);
    return orgUnitId ? directiveRows.filter((d) => d.assignees.some((a: any) => a.unit === "QLDA")) : directiveRows.slice();
  },
  async tasksOverview(input: any) {
    log("tasksOverview", input);
    await wait(60);
    const items = boardTasks.filter((t) => t.status !== "completed").map(overviewItem)
      .filter((t) => input.state !== "overdue" || (t.deadlineAt && Date.parse(t.deadlineAt) < Date.now()))
      .filter((t) => input.state !== "unack" || t.status === "pending_acknowledgement");
    return { unit: null, total: items.length, overdue: 0, stale: 0, items };
  },
  async decideClaimV2(taskId: string, decision: string, note: string | null, deadlineAt: string | null) {
    log("decideClaimV2", taskId, decision, note, deadlineAt);
    const d = directiveRows.find((x) => x.id === taskId);
    if (d) { d.claimStatus = decision === "confirm" ? "confirmed" : "rejected"; d.canDecide = false; d.bucket = decision === "confirm" ? "doing" : "gone";
      if (deadlineAt) d.deadlineAt = deadlineAt; if (decision !== "confirm") directiveRows.splice(directiveRows.indexOf(d), 1); }
    return { taskId, claimStatus: decision === "confirm" ? "confirmed" : "rejected", deadlineAt };
  },
  async myBoard() {
    log("myBoard");
    await wait(150);
    if (query.get("board") === "error") throw new Error("network");
    const load = boardTasks.filter((t) => !["completed", "cancelled"].includes(t.status)).reduce((n, t) => n + ({ A: 3, B: 2, C: 1 } as any)[t.level], 0);
    return { me: { userId: "actor", name: "Lê Minh An", title: "Kỹ sư dự án", unit: { id: "u", code: "QLDA", name: "Phòng Quản lý dự án" } },
      today: bIso(new Date()), weekStart: bIso(bMonday), weekEnd: bIso(bAdd(bMonday, 6)), doneSince: bIso(bAdd(bMonday, -35)), tasks: boardTasks.map((t) => ({ ...t })),
      weeks: [7, 14, 21, 28].map((n, i) => ({ weekStart: bIso(bAdd(bMonday, -n)), due: [7, 6, 5, 4][i], ontime: [6, 5, 4, 3][i] })),
      review: { reviewed: 5, firstPass: 4 }, load };
  },
  async assignablePeople() {
    log("assignablePeople");
    return { canAssignOthers: true, people: [
      { userId: "actor", name: "Lê Minh An", title: "Kỹ sư", unit: { id: "u", code: "QLDA", name: "Phòng QLDA" }, myTeam: false, sameUnit: true, isMe: true, canReceive: true, load: 4, aliases: [] },
      { userId: "second", name: "Nguyễn Thu Hà", title: "Kỹ sư kế hoạch", unit: { id: "u", code: "QLDA", name: "Phòng QLDA" }, myTeam: true, sameUnit: true, isMe: false, canReceive: true, load: 3, aliases: [] },
      { userId: "third", name: "Lý Thị Hà", title: "Kế toán", unit: { id: "u2", code: "TCKT", name: "Phòng TCKT" }, myTeam: false, sameUnit: false, isMe: false, canReceive: true, load: 1, aliases: [] },
      { userId: "fourth", name: "Vương Thành Đô", title: "Trưởng phòng", unit: { id: "u", code: "QLDA", name: "Phòng QLDA" }, myTeam: false, sameUnit: true, isMe: false, canReceive: true, load: 9, aliases: [] },
    ] };
  },
  async linkAi(taskId: string, runId: string, kind: string) { log("linkAi", taskId, runId, kind); return { taskId, runId, kind }; },
  async learnPersonAlias(taskId: string, alias: string) { log("learnPersonAlias", taskId, alias); return { saved: 1 }; },
  async createMeeting(title: string, heldOn: string) { log("createMeeting", title, heldOn); return { meetingId: "meeting-1", title, heldOn }; },
  async setOrigin(taskId: string, origin: string, meetingId: string | null, giverUserId: string | null) {
    log("setOrigin", taskId, origin, meetingId, giverUserId);
    return { taskId, origin, claimStatus: "not_needed" };
  },
  async taskBrief(taskId: string) {
    log("taskBrief", taskId);
    const origin = query.get("origin");
    return { task: { lastProgressAt: fixtureUpdates[0]?.at || "2026-09-07T00:10:00Z" },
      origin: origin === "claim" ? { origin: "oral_claim", claimStatus: "pending", decidedAt: null, giver: { id: "actor", name: "Lê Minh An" }, meeting: null }
        : origin === "directive" ? { origin: "directive", claimStatus: "not_needed", decidedAt: null, giver: null, meeting: { id: "m", title: "Giao ban 07/09", heldOn: "2026-09-07" } }
        : null,
      updates: fixtureUpdates.slice(0, 5), assignees: [], checklist: { done: 0, total: 0 }, children: { open: 0, total: 0 }, events: [] } as any;
  },
  async listUpdates(taskId: string) {
    log("listUpdates", taskId);
    return { items: fixtureUpdates.slice(), nextBefore: null };
  },
  async decideClaim(taskId: string, decision: string, note: string | null) {
    log("decideClaim", taskId, decision, note);
    return { taskId, claimStatus: decision === "confirm" ? "confirmed" : "rejected" };
  },
};
// Đợt 1 PR-3: AI giả (không gọi cổng AI). ?ai=off → tắt nút AI; ?ai=fail → cổng báo hết lượt.
const aiResults: Record<string, (input: any) => unknown> = {
  work_task_draft: (input) => /Hà/.test(input.text)
    ? { title: "Bóc khối lượng mái khu B", assignee: "Hà", assigneeName: null, dueText: "thứ 6", dueDate: null, dueTime: null, level: "B", description: "", checklist: [], tags: ["XinHai"], evidence: { photo: false, file: true }, warnings: [] }
    : { title: "Rà soát hồ sơ thanh toán đợt 3 SMB", assignee: "anh Đô", assigneeName: "Vương Thành Đô", dueText: "mai 9h", dueDate: null, dueTime: "09:00", level: "A",
        description: "Đối chiếu hồ sơ với hợp đồng, ghi chênh lệch.", checklist: ["Đối chiếu khối lượng", "Đối chiếu đơn giá"], tags: ["SMB"], evidence: { photo: false, file: true }, warnings: [] },
  work_task_writer: () => ({ description: "Rà soát toàn bộ hồ sơ đợt 3, nộp bảng chênh lệch so với hợp đồng [số hợp đồng].", checklist: ["Gom hồ sơ", "Đối chiếu khối lượng", "Lập bảng chênh lệch"], evidence: { photo: false, file: true } }),
  work_meeting_tasks: () => ({ meetingTitle: "Giao ban tuần 43", heldOn: "2026-09-07", chairman: "Nguyễn Thu Hà", warnings: ["Ý 5 chưa rõ người làm."], tasks: [
    { title: "Rà soát hồ sơ thanh toán đợt 3 SMB", assignee: "anh Đô", assigneeName: "Vương Thành Đô", dueText: "thứ 6", dueDate: null, dueTime: null, level: "A", note: null, quote: "Anh Đô rà soát lại hồ sơ thanh toán đợt 3 SMB, xong trước thứ 6. Gấp." },
    { title: "Chốt kế hoạch dòng tiền tháng 11", assignee: "Hà", assigneeName: null, dueText: "cuối tuần", dueDate: null, dueTime: null, level: "B", note: "Gửi BLĐ", quote: "Hà chốt KH dòng tiền T11." },
    { title: "Liên hệ CĐT xin lịch nghiệm thu móng M4", assignee: null, assigneeName: null, dueText: "mai", dueDate: null, dueTime: null, level: null, note: null, quote: "Cần một người liên hệ CĐT." },
  ] }),
  work_update_draft: () => ({ done: "Bóc xong khối lượng móng M1–M3", doing: "Bóc dầm tầng 2", next: "Mai đối chiếu dự toán", blocked: "Chờ CĐT duyệt bản vẽ kết cấu", percent: 80, warnings: [] }),
  work_task_brief: () => ({ brief: "Việc đang ở 65%, còn vướng chữ ký chỉ huy trưởng. Đang kịp hạn theo đánh giá của máy." }),
};
const fakeAiRun = async (skill: string, input: Record<string, unknown>, context: Record<string, unknown>) => {
  log("ai", skill, input, context);
  await wait(250);
  if (query.get("ai") === "fail") return { code: "AI_QUOTA", reason: "user_day", dailyLimit: 20 } as any;
  return { code: "OK", runId: `run-${skill}`, result: aiResults[skill](input), model: "fixture", provider: "anthropic", usage: { tokensIn: 1, tokensOut: 1, costUsd: 0, durationMs: 250 } } as any;
};
const fixtureAi = query.get("ai") === "off" ? null : createWorkAi(fakeAiRun as any, (runId: string, accepted: boolean) => log("aiFeedback", runId, accepted));
const service: WorkTaskService = {
  async command(input) {
    log("command", structuredClone(input));
    const rv = reviewRows.find((r) => r.id === input.taskId);
    if (rv && input.command === "review") { reviewRows.splice(reviewRows.indexOf(rv), 1); return { taskId: rv.id, taskCode: rv.code, lockVersion: rv.lockVersion + 1, status: "completed" } as any; }
    const bt = boardTasks.find((t) => t.id === input.taskId);
    if (bt) {
      await wait(80);
      if (input.command === "acknowledge") { bt.acknowledged = true; bt.status = "not_started"; }
      else if (input.command === "start" || input.command === "unblock") bt.status = "in_progress";
      else if (input.command === "block") { bt.status = "blocked"; bt.blockedReason = (input.payload as any).reason; }
      else if (input.command === "submit") { bt.status = bt.needsReview ? "awaiting_review" : "completed"; if (!bt.needsReview) bt.completedAt = new Date().toISOString(); }
      bt.lockVersion++; bt.lastProgressAt = new Date().toISOString(); bt.can = canOf(bt);
      return { taskId: bt.id, taskCode: bt.code, lockVersion: bt.lockVersion, status: bt.status } as any;
    }
    commandAttempts++;
    if (commandResults.has(input.idempotencyKey))
      return commandResults.get(input.idempotencyKey);
    if (query.get("conflict") === "true" && commandAttempts === 1) {
      taskVersion++;
      throw new Error("WORK_VERSION_CONFLICT");
    }
    taskVersion++;
    taskStatus =
      (
        {
          acknowledge: "not_started",
          start: "in_progress",
          block: "blocked",
          unblock: "in_progress",
          submit: "awaiting_review",
          cancel: "cancelled",
          transfer: "pending_acknowledgement",
        } as Record<string, string>
      )[input.command] || taskStatus;
    if (input.command === "review")
      taskStatus =
        input.payload.decision === "approve"
          ? "completed"
          : "changes_requested";
    const result: any = {
      taskId: "1",
      taskCode: "VW-2026-000001",
      lockVersion: taskVersion,
      status: taskStatus,
    };
    commandResults.set(input.idempotencyKey, result);
    if (query.get("lostCommand") === "true" && commandAttempts === 1)
      throw new Error("network");
    return result;
  },
  async collaborate(input) {
    log("collaborate", structuredClone(input));
    if (input.command === "comment_edit") {
      if (query.get("commentConflict") === "true" && commentVersion === 1) {
        commentVersion = 2;
        throw new Error("WORK_VERSION_CONFLICT");
      }
      fixtureComments.unshift({
        ...comment(
          input.payload.commentId,
          documentText(input.payload.content),
        ),
        content_document: input.payload.content,
        mentionedUserIds: mentionedUserIds(input.payload.content),
        lock_version: commentVersion,
      });
    }
    if (input.command === "set_pin") pinned = input.payload.pinned;
    if (input.command === "schedule_update") {
      plannedStartAt = input.payload.plannedStartAt;
      deadlineAt = input.payload.deadlineAt;
      taskVersion++;
    }
    if (input.command === "watchers_update") {
      watcherIds = [...new Set([...watcherIds.filter((id) => !input.payload.removeUserIds.includes(id)), ...input.payload.addUserIds])];
      taskVersion++;
    }
    if (input.command === "description_update") {
      descriptionDocument = input.payload.content;
      taskVersion++;
    }
    if (input.command === "result_draft_update") {
      resultDraftDocument = input.payload.content;
      taskVersion++;
    }
    if (input.command === "progress_report") {
      const payload = input.payload;
      fixtureUpdates.unshift({ id: `u${fixtureUpdates.length + 1}`, at: new Date().toISOString(), authorId: "actor", authorName: "Lê Minh An",
        ...payload, progressBefore: progressPercent, progressAfter: payload.progressPercent, ai: false,
        files: (payload.attachmentIds || []).map((id: string) => ({ id, name: `${id}.jpg`, mime: "image/jpeg", evidenceType: null })) });
      progressPercent = payload.progressPercent;
      if (taskStatus === "not_started") taskStatus = "in_progress";
    }
    if (input.command === "progress_update") {
      progressPercent = input.payload.progressPercent;
      taskVersion++;
    }
    if (input.command === "checklist_set_completed")
      checkDone = input.payload.completed;
    if (input.command === "comment_create") {
      const c = {
        ...comment("new-comment", documentText(input.payload.content)),
        content_document: input.payload.content,
        mentionedUserIds: mentionedUserIds(input.payload.content),
        parent_comment_id: input.payload.parentCommentId || null,
      };
      fixtureComments.unshift(c);
    }
    return {
      taskId: "1",
      taskLockVersion: taskVersion,
      preferences: { pinned, notificationsEnabled: true },
    } as any;
  },
  async comments(taskId, cursor) {
    if (query.has("slowRefresh")) await wait(500);
    if (qa.denyReads) throw new Error("WORK_FORBIDDEN");
    log("comments", taskId, cursor);
    return {
      items: cursor
        ? [comment("older", "Nội dung bình luận cũ")]
        : [
            ...fixtureComments,
            comment("first", "Đã kiểm tra tài liệu đầu vào."),
          ],
      nextCursor: cursor
        ? null
        : { sortAt: "2026-09-07T01:00:00Z", id: "first" },
    };
  },
  async history(taskId, filters, cursor) {
    log("history", taskId, filters, cursor);
    return {
      items: [
        {
          id: "event",
          task_id: taskId,
          actor_user_id: "actor",
          event_type: "task.started",
          source: "human",
          payload: { reason: "Bắt đầu ca kiểm tra" },
          created_at: "2026-09-07T01:00:00Z",
          correlation_id: null,
          idempotency_key: null,
        },
      ],
      nextCursor: null,
    } as any;
  },
  async mentions(taskId, search, cursor) {
    log("mentions", taskId, search, cursor);
    return {
      items: people.map((p) => ({ userId: p.id, name: p.name })),
      nextCursor: null,
    };
  },
  async watcherOptions(taskId, search, cursor) {
    log("watcherOptions", taskId, search, cursor);
    return {
      items: people.map((p) => ({ userId: p.id, name: p.name })),
      nextCursor: null,
    };
  },
  async children(taskId, cursor) {
    log("children", taskId, cursor);
    return {
      items: fixtureChildren,
      aggregate: {
        visibleTotal: fixtureChildren.filter((item) => item.status !== "cancelled").length,
        visibleCompleted: fixtureChildren.filter((item) => item.status === "completed").length,
        visibleCancelled: 0,
        visibleOpen: fixtureChildren.filter((item) => !["completed", "cancelled"].includes(item.status)).length,
      },
      nextCursor: null,
    };
  },
  async assigneeOptions(taskId, action, search, cursor) {
    log("assigneeOptions", taskId, action, search, cursor);
    return {
      items: [{ userId: "second", name: "Nguyễn Thu Hà" }],
      nextCursor: null,
    };
  },
  async detailContext(taskId, ids) {
    log("detailContext", taskId, ids);
    return {
      names: { actor: "Lê Minh An", second: "Nguyễn Thu Hà" },
      scopeName: "Trực tiếp",
      bucketName: null,
    };
  },
  async commentAnchor(taskId, id) {
    log("commentAnchor", taskId, id);
    return {
      comment: {
        ...comment(id, "Bình luận đích từ thông báo"),
        lock_version: commentVersion,
      },
      parent: null,
    };
  },
  async list(view, filters, cursor) {
    if (query.has("slowRefresh")) await wait(500);
    if (qa.denyReads) throw new Error("WORK_FORBIDDEN");
    log("list", view, filters, cursor);
    await wait(filters.search === "chậm" ? 800 : 15);
    if (filters.search === "lỗi") throw new Error("network");
    if (filters.search)
      return {
        items: [summary("3", `Kết quả ${filters.search}`)],
        nextCursor: null,
      };
    return {
      items:
        query.get("longList") === "true"
          ? Array.from({ length: 20 }, (_, i) =>
              summary(String(i + 1), `Công việc số ${i + 1}`),
            )
          : cursor
            ? [summary("2", "Tổng hợp kết quả kiểm tra")]
            : [
                summary(
                  "1",
                  view === "created_by_me"
                    ? "Công việc tôi đã giao"
                    : "Chuẩn bị hồ sơ nghiệm thu",
                ),
              ],
      nextCursor: cursor ? null : { sortAt: "2026-09-07T00:00:00Z", id: "1" },
    };
  },
  async options(kind, scope, search) {
    log("options", kind, scope, search);
    const items =
      kind === "scope" || kind === "filter_scope"
        ? [
            { id: "direct", name: "Trực tiếp", kind: "direct" },
            {
              id: "department:dept",
              name: "Phòng kỹ thuật",
              kind: "department",
            },
          ]
        : kind === "work_group"
          ? [{ id: "group", name: "Nhóm vận hành", kind: "work_group" }]
          : people;
    return {
      items: items.filter(
        (x) => !search || x.name.toLowerCase().includes(search.toLowerCase()),
      ),
      nextCursor: null,
    };
  },
  async context(scope) {
    log("context", scope);
    return {
      actorId: "actor",
      canCreate: true,
      canAssignUser: true,
      canAssignGroup: true,
      canChooseReviewer: true,
      calendarReady: query.get("calendar") !== "off",
    };
  },
  async groups() {
    return { items: [{ id: "bucket", name: "Hồ sơ" }], nextCursor: null };
  },
  async preview(sources, scope) {
    log("preview", sources, scope);
    await wait(sources.length === 1 ? 100 : 20);
    const ids = [
      ...new Set(
        sources.flatMap((x) =>
          x.type === "work_group" ? people.map((u) => u.id) : [x.id],
        ),
      ),
    ];
    return {
      sources,
      validRecipients: ids.map((id) => ({
        userId: id,
        name: people.find((p) => p.id === id)!.name,
        sources,
      })),
      invalidRecipients: [],
      validCount: ids.length,
      invalidCount: 0,
      fingerprint: JSON.stringify([sources, scope]),
    };
  },
  async create(input, key, fingerprint) {
    log("create", input, key, fingerprint);
    qa.createAttempts++;
    if (query.get("ambiguous") === "true" && qa.createAttempts === 1)
      throw new Error("network timeout");
    if (input.parentTaskId && !fixtureChildren.length)
      fixtureChildren.push({
        ...summary("99", input.title),
        task_code: "VW-2026-000099",
        parent_task_id: input.parentTaskId,
        planned_start_at: input.plannedStartAt || null,
        deadline_at: input.deadlineAt || null,
        assignee_names: ["Lê Minh An"],
        attachment_count: 0,
      });
    return {
      taskId: "new",
      taskCode: "VW-2026-000099",
      lockVersion: 1,
      status: "pending_acknowledgement",
    };
  },
  async detail(ref) {
    log("detail", ref);
    if (query.get("deny") === "true") throw new Error("WORK_TASK_NOT_FOUND");
    const terminal = ["completed", "cancelled"].includes(taskStatus),
      worker = role === "assignee",
      reviewer = role === "reviewer";
    const active = worker && !terminal;
    return {
      task: {
        ...summary("1", "Chuẩn bị hồ sơ nghiệm thu"),
        status: taskStatus,
        lock_version: taskVersion,
        progress_percent: taskStatus === "completed" ? 100 : progressPercent,
        planned_start_at: plannedStartAt,
        deadline_at: deadlineAt,
        description_document: descriptionDocument,
        description_text: documentText(descriptionDocument),
        result_draft_document: resultDraftDocument,
        result_draft_text: documentText(resultDraftDocument),
        result_draft_updated_at: "2026-09-09T03:00:00Z",
        result_draft_updated_by: "actor",
        labels: ["Nghiệm thu", "Hồ sơ"],
        review_policy: query.get("autoComplete") === "true" ? "auto_complete" : "creator_review",
        created_at: "2026-09-07T00:00:00Z",
        blocked_reason: taskStatus === "blocked" ? "Chờ vật tư" : null,
      },
      assignments: [
        {
          id: "assignment",
          task_id: "1",
          user_id: "actor",
          assigned_by: "second",
          state: taskStatus,
          assigned_at: "2026-09-07T00:00:00Z",
          acknowledged_at:
            taskStatus === "pending_acknowledgement"
              ? null
              : "2026-09-07T00:10:00Z",
          acknowledgement_due_at: "2026-09-08T02:00:00Z",
          execution_sla_due_at: "2026-09-10T10:00:00Z",
          ended_at: terminal ? "2026-09-07T03:00:00Z" : null,
        },
      ],
      participants: watcherIds.map((userId) => ({ id: `watcher-${userId}`, user_id: userId, participant_role: "watcher" })),
      preferences: { pinned, notificationsEnabled: true },
      attachments:
        query.get("images") === "true"
          ? [
              {
                id: "image",
                task_id: "1",
                file_name: "anh-nghiem-thu.webp",
                mime_type: "image/webp",
                size_bytes: 1234,
                attachment_kind: "input",
                uploader_user_id: "actor",
                can_delete: false,
                variants: {
                  thumbnail: {},
                  display: {},
                  fallback: {},
                  original: {},
                },
              },
              {
                id: "pdf",
                task_id: "1",
                file_name: "bien-ban-nghiem-thu.pdf",
                mime_type: "application/pdf",
                size_bytes: 2048,
                attachment_kind: "input",
                uploader_user_id: "actor",
                can_delete: false,
                variants: { original: {} },
              },
              {
                id: "text",
                task_id: "1",
                file_name: "ghi-chu-hien-truong.txt",
                mime_type: "text/plain",
                size_bytes: 96,
                attachment_kind: "discussion",
                uploader_user_id: "actor",
                can_delete: false,
                variants: { original: {} },
              },
              {
                id: "sheet",
                task_id: "1",
                file_name: "du-lieu-cu.xls",
                mime_type: "application/vnd.ms-excel",
                size_bytes: 4096,
                attachment_kind: "input",
                uploader_user_id: "actor",
                can_delete: false,
                variants: { original: {} },
              },
            ]
          : [],
      currentSubmission:
        taskStatus === "awaiting_review"
          ? {
              id: "submission",
              iteration: 1,
              submitted_by: "actor",
              submitted_at: "2026-09-07T02:00:00Z",
              result_document: workDocument("Hồ sơ đã được kiểm tra đầy đủ."),
              result_text: "Hồ sơ đã được kiểm tra đầy đủ.",
              status: "pending_review",
            }
          : null,
      checklist:
        query.get("task9") === "true"
          ? [
              {
                id: "check",
                task_id: "1",
                title: "Đối chiếu biên bản",
                lock_version: 1,
                sort_order: 0,
                assignee_user_id: "actor",
                completed_at: checkDone ? "2026-09-07T02:00:00Z" : null,
              },
            ]
          : [],
      capabilities: {
        canClone: true,
        canViewHistory: role !== "watcher",
        canSetPreferences: true,
        canComment: !terminal,
        canManageChecklist: active && taskStatus !== "awaiting_review",
        canCreateChild: active,
        canManageSchedule: active,
        canManageWatchers: active,
        canUpdateDescription: !terminal && role !== "watcher",
        canUpdateResultDraft: active && ["in_progress", "changes_requested"].includes(taskStatus),
        canUpdateProgress: active && ["in_progress", "changes_requested"].includes(taskStatus),
        canAcknowledge: active && taskStatus === "pending_acknowledgement",
        canRequestClarification:
          active && taskStatus === "pending_acknowledgement",
        canStart: active && taskStatus === "not_started",
        canBlock: active && taskStatus === "in_progress",
        canUnblock: active && taskStatus === "blocked",
        canSubmit: active && taskStatus === "in_progress",
        canReview: reviewer && taskStatus === "awaiting_review",
        canCancel: reviewer && !terminal,
        canTransfer: active,
        canAddAssignees: active,
        canAttachInput: active,
        canAttachDiscussion: !terminal,
        canAttachResult: active,
        canAttachEvidence: active,
      },
      childAggregate: {
        visibleTotal: fixtureChildren.length,
        visibleCompleted: fixtureChildren.filter((item) => item.status === "completed").length,
        visibleCancelled: 0,
        visibleOpen: fixtureChildren.filter((item) => !["completed", "cancelled"].includes(item.status)).length,
      },
    } as any;
  },
  async clone(id) {
    log("clone", id);
    return {
      draft: {
        ...emptyWorkDraft({ type: "direct" }),
        title: "Bản sao hồ sơ",
        recipientSources: [{ type: "user", id: "actor" }],
        watcherUserIds: ["second"],
        clonedFromTaskId: id,
      },
      labels: {
        actor: "Lê Minh An",
        second: "Nguyễn Thu Hà",
        direct: "Trực tiếp",
      },
      requiresDeadlineConfirmation: true,
    };
  },
};
const attachments: ReturnType<typeof createWorkAttachmentService> = {
  async begin(taskId, file, kind, keep, key) {
    log("attachment.begin", taskId, file.name, kind, keep, key);
    return {
      id: "attachment",
      status: "pending",
      bucket: "work-attachments",
      path: "reserved",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
  },
  async upload() {
    log("attachment.upload");
  },
  async finalize() {
    log("attachment.finalize");
    qa.finalizeAttempts++;
    if (query.get("fileFailure") === "true" && qa.finalizeAttempts === 1)
      throw new Error("network");
    return { id: "attachment", status: "ready" };
  },
  async read(id, variant) {
    log("attachment.read", id, variant);
    if (qa.denyReads) throw new Error("WORK_COMMAND_DENIED");
    const signedUrl =
      id === "text"
        ? "data:text/plain;charset=utf-8,Ghi%20ch%C3%BA%20an%20to%C3%A0n%20t%E1%BA%A1i%20hi%E1%BB%87n%20tr%C6%B0%E1%BB%9Dng."
        : id === "pdf"
          ? "data:application/pdf;base64,JVBERi0xLjQKJSVFT0Y="
          : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1UAAAAASUVORK5CYII=";
    return {
      signedUrl,
      expiresIn: query.get("previewExpired") === "true" ? 5 : 60,
    };
  },
  async remove() {
    throw new Error("not used");
  },
};
createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <Routes>
      <Route
        path="/work/my"
        element={
          <WorkWorkspace
            actorId="actor"
            service={service}
            board={board as any}
            actorName="Lê Minh An"
            canQuickAssign={query.get("quick") !== "false"}
            ai={fixtureAi}
            attachments={attachments}
            subscribe={query.has("slowRefresh") ? subscribeRefresh : undefined}
          />
        }
      />
      <Route
        path="/work/tasks/:taskCode"
        element={
          <WorkWorkspace
            actorId="actor"
            service={service}
            board={board as any}
            actorName="Lê Minh An"
            canQuickAssign={query.get("quick") !== "false"}
            ai={fixtureAi}
            attachments={attachments}
            subscribe={query.has("slowRefresh") ? subscribeRefresh : undefined}
          />
        }
      />
    </Routes>
  </HashRouter>,
);
