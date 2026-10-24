// Browser-only isolated fixture: màn Việc của tôi với dữ liệu mẫu, ?dark để xem nền tối. Không gắn vào app thật.
import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { Search } from "lucide-react";
import { WorkMyBoard } from "../../pages/work/WorkMyBoard";
import { WorkQuickAssign } from "../../pages/work/WorkQuickAssign";
import type { WorkMyBoard as Board, WorkMyTask } from "../../lib/work/workBoardService";
import { Highlight, WorkMotion } from "../../components/work/motion";
import "../../pages/work/work.css";

const query = new URLSearchParams(location.search);
if (query.has("dark")) document.documentElement.classList.add("dark");

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const now = new Date();
const today = iso(now);
const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
const day = (offset: number, h = 17) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset, h).toISOString();
const giver = { id: "u2", name: "Nguyễn Văn Hoàng" };

let seq = 0;
const task = (title: string, status: WorkMyTask["status"], level: WorkMyTask["level"], due: string | null, progress: number, extra: Partial<WorkMyTask> = {}): WorkMyTask => ({
  id: `t${++seq}`, code: `CV-26${String(seq).padStart(3, "0")}`, title, status, level, deadlineAt: due, progressPercent: progress, labels: [],
  lockVersion: 1, blockedReason: status === "blocked" ? "Chờ NCC gửi lại báo giá" : null, completedAt: status === "completed" ? due : null,
  createdAt: day(-3, 9), lastProgressAt: day(-1, 9), acknowledged: status !== "pending_acknowledgement", needsReview: false,
  createdBy: giver, createdByMe: false, createdByHead: true, checklist: { done: 1, total: 3 }, origin: null,
  can: { acknowledge: status === "pending_acknowledgement", start: status === "not_started", block: status === "in_progress", unblock: status === "blocked", submit: status === "in_progress" },
  ...extra,
});

const board: Board = {
  me: { userId: "u1", name: "Admin Hoàng", title: "Chuyên viên Công nghệ thông tin (IT)", unit: { id: "it", code: "IT", name: "Phòng CNTT" } },
  today, weekStart: iso(monday), weekEnd: iso(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)), doneSince: iso(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 14)),
  tasks: [
    task("Chốt kế hoạch vật tư tuần", "completed", "B", day(0), 100),
    task("Cập nhật quyền kho Hưng Yên", "completed", "C", day(1), 100),
    task("Kiểm tra đồng bộ 3P lương", "in_progress", "A", day(2), 40),
    task("Sao lưu cấu hình AI", "blocked", "B", day(3), 20),
    task("Rà soát HĐ cốp pha SMB", "in_progress", "A", day(4), 60),
    task("Cài máy in tầng 3", "not_started", "C", day(4), 0),
    task("Kiểm tra đăng nhập thiết bị mới", "in_progress", "B", day(6), 30),
    task("Duyệt quyền tài khoản mới", "pending_acknowledgement", "B", day(6), 0),
    task("Báo cáo tuần CNTT", "not_started", "C", null, 0),
  ],
  weeks: [{ weekStart: "w1", due: 14, ontime: 12 }, { weekStart: "w2", due: 10, ontime: 9 }, { weekStart: "w3", due: 8, ontime: 7 }, { weekStart: "w4", due: 9, ontime: 8 }],
  review: { reviewed: 12, firstPass: 11 }, load: 7,
};

const people = {
  canAssignOthers: true,
  people: [
    { userId: "u1", name: "Admin Hoàng", title: "Chuyên viên CNTT", unit: board.me.unit, myTeam: true, sameUnit: true, isMe: true, canReceive: true, load: 7, aliases: [] },
    { userId: "u3", name: "Trần Thu Hà", title: "Kỹ sư dự toán", unit: { id: "qs", code: "QS", name: "Phòng Dự toán" }, myTeam: false, sameUnit: false, isMe: false, canReceive: true, load: 4, aliases: ["Hà"] },
  ],
};
const aiService = {
  draftTask: async () => { await new Promise((r) => setTimeout(r, 2500)); return { ok: false, message: "Dữ liệu mẫu." }; },
} as never;
const boardService = {
  myBoard: async () => board,
  assignablePeople: async () => people,
  setOrigin: async () => undefined,
  linkAi: async () => undefined,
  learnPersonAlias: async () => undefined,
  createMeeting: async () => undefined,
} as never;
const taskService = { command: async () => ({}), preview: async () => ({}), create: async () => ({}) } as never;

const tabs = ["Được giao", "Tôi đã giao", "Tôi theo dõi", "Đã ghim"];
createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <WorkMotion>
    <main className="work-module">
      <WorkMyBoard board={boardService} service={taskService} refreshKey={0} detailTo={(code) => `/work/${code}`} onNotice={() => undefined}
        headerActions={<button className="work-secondary">Tạo công việc</button>}>
        <WorkQuickAssign service={taskService} board={boardService} ai={query.has("ai") ? aiService : undefined} actorName="Admin Hoàng" onCreated={() => undefined} />
        <nav className="work-tabs has-pill" aria-label="Danh sách công việc">
          {tabs.map((t, i) => <button key={t} aria-current={i === 0 ? "page" : undefined}>{i === 0 && <Highlight group="work-tabs" className="work-tab-line" />}{t}</button>)}
          <button className="work-tabs-extra"><Search size={15} /> Tìm & lọc</button>
        </nav>
      </WorkMyBoard>
    </main>
    </WorkMotion>
  </HashRouter>,
);
