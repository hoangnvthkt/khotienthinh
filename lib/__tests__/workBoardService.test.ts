import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkBoardService,
  isStale,
  levelOfPriority,
  normalizeProgressReport,
  ontimeRate,
  priorityOfLevel,
  workLoad,
} from "../work/workBoardService";
import { workError } from "../work/workForm";

const migration = readFileSync("supabase/migrations/20261021170000_work_dot1_foundation.sql", "utf8");

describe("Vioo Work Đợt 1 · mức A/B/C và tải việc", () => {
  it("A/B/C dùng priority sẵn có, đổi qua lại không mất", () => {
    expect(levelOfPriority("urgent")).toBe("A");
    expect(levelOfPriority("important")).toBe("B");
    expect(levelOfPriority("normal")).toBe("C");
    for (const level of ["A", "B", "C"] as const) expect(levelOfPriority(priorityOfLevel(level))).toBe(level);
    expect(workLoad({ A: 2, B: 1, C: 1 })).toBe(9);
  });

  it("đúng hạn chưa có việc đến hạn là null, không che bằng 0", () => {
    expect(ontimeRate(0, 0)).toBeNull();
    expect(ontimeRate(17, 21)).toBe(81);
  });

  it("lâu chưa cập nhật khi quá 48 giờ", () => {
    const now = new Date("2026-10-20T03:30:00Z");
    expect(isStale("2026-10-18T03:00:00Z", now)).toBe(true);
    expect(isStale("2026-10-18T04:00:00Z", now)).toBe(false);
    expect(isStale(null, now)).toBe(false);
  });
});

describe("Vioo Work Đợt 1 · cập nhật tiến độ có cấu trúc", () => {
  it("cắt khoảng trắng, bỏ dòng rỗng, giữ tệp không trùng và lượt AI", () => {
    const result = normalizeProgressReport({
      done: "  Bóc xong cọc ", doing: "", next: "Giằng móng", blocked: "   ", progressPercent: 60,
      attachmentIds: ["a", "a", "b"], expectedLockVersion: 4, aiRunId: "run-1",
    });
    expect(result).toEqual({ ok: true, payload: {
      done: "Bóc xong cọc", next: "Giằng móng", progressPercent: 60, attachmentIds: ["a", "b"], expectedLockVersion: 4, aiRunId: "run-1",
    } });
  });

  it("chặn sớm như máy chủ: rỗng, quá dài, % ngoài 0–100", () => {
    expect(normalizeProgressReport({ done: " ", progressPercent: 10 })).toEqual({ ok: false, problem: "empty" });
    expect(normalizeProgressReport({ done: "x".repeat(2001), progressPercent: 10 })).toEqual({ ok: false, problem: "too_long" });
    expect(normalizeProgressReport({ done: "x", progressPercent: 101 })).toEqual({ ok: false, problem: "progress" });
    expect(normalizeProgressReport({ done: "x", progressPercent: 12.5 })).toEqual({ ok: false, problem: "progress" });
  });

  it("gửi đúng lệnh progress_report kèm khóa chống gửi trùng; đầu vào sai không gọi máy chủ", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { taskId: "t", progressPercent: 60 }, error: null });
    const service = createWorkBoardService({ rpc } as any);
    await service.reportProgress("t", { doing: "Đài móng", progressPercent: 60 }, "key-1");
    expect(rpc).toHaveBeenCalledWith("command_work_task_collaboration", {
      p_task_id: "t", p_command: "progress_report", p_payload: { doing: "Đài móng", progressPercent: 60 }, p_idempotency_key: "key-1",
    });
    await expect(service.reportProgress("t", { progressPercent: 60 }, "key-2")).rejects.toThrow("WORK_PROGRESS_REPORT_EMPTY");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(workError(new Error("WORK_PROGRESS_REPORT_EMPTY"))).toContain("Đã làm");
  });
});

describe("Vioo Work Đợt 1 · RPC đọc gọn và nguồn việc", () => {
  it("gọi đúng tên và tham số RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const service = createWorkBoardService({ rpc } as any);
    await service.taskBrief("t");
    await service.teamBoard();
    await service.companyBoard("2026-10-12");
    await service.assignablePeople("  Hà ", 20);
    await service.createMeeting(" Giao ban tuần 43 ", "2026-10-19");
    await service.setOrigin("t", "oral_claim", null, "u-bld");
    await service.decideClaim("t", "reject", "  Không phải việc tôi giao ");
    await service.linkAi("t", "run", "task_draft");
    expect(rpc.mock.calls).toEqual([
      ["work_task_brief_v1", { p_task_id: "t" }],
      ["work_team_board_v1", { p_org_unit_id: null, p_week_start: null }],
      ["work_company_board_v1", { p_week_start: "2026-10-12" }],
      ["work_assignable_people_v1", { p_query: "Hà", p_limit: 20 }],
      ["work_meeting_create_v1", { p_title: "Giao ban tuần 43", p_held_on: "2026-10-19", p_org_unit_id: null }],
      ["work_task_set_origin_v1", { p_task_id: "t", p_origin: "oral_claim", p_meeting_id: null, p_giver_user_id: "u-bld" }],
      ["work_task_claim_decide_v1", { p_task_id: "t", p_decision: "reject", p_note: "Không phải việc tôi giao" }],
      ["work_ai_link_v1", { p_task_id: "t", p_run_id: "run", p_kind: "task_draft" }],
    ]);
  });

  it("lỗi RPC chuyển nguyên cho màn hình, có câu tiếng Việt", async () => {
    const error = { code: "42501", message: "WORK_BOARD_DENIED" };
    const service = createWorkBoardService({ rpc: vi.fn().mockResolvedValue({ data: null, error }) } as any);
    await expect(service.teamBoard()).rejects.toBe(error);
    expect(workError(error)).toBe("Bạn chưa được xem số liệu của đơn vị này.");
  });
});

describe("Vioo Work Đợt 1 · hợp đồng migration", () => {
  it("chỉ thêm RPC mới, mở cho người đăng nhập, khóa với anon", () => {
    for (const fn of ["work_meeting_create_v1", "work_task_set_origin_v1", "work_task_claim_decide_v1", "work_ai_link_v1",
      "work_task_brief_v1", "work_team_board_v1", "work_company_board_v1", "work_assignable_people_v1"]) {
      expect(migration).toMatch(new RegExp(`create function public\\.${fn}\\(`));
      expect(migration).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`));
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
    }
  });

  it("bảng mới bật RLS và không cấp quyền đọc trực tiếp", () => {
    for (const table of ["work_meetings", "work_task_origins", "work_task_updates", "work_task_ai_links"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
    }
    expect(migration).toMatch(/revoke all on public\.work_meetings, public\.work_task_origins, public\.work_task_updates, public\.work_task_ai_links from public, anon, authenticated;/);
  });

  it("skill Vioo Work thêm ở trạng thái tắt (PR-3 bật)", () => {
    const skills = migration.match(/^\s*\('work_[a-z_]+',.*\)[,]?$/gm) ?? [];
    expect(skills.map((row) => row.match(/\('(work_[a-z_]+)'/)?.[1])).toEqual(
      ["work_task_draft", "work_meeting_tasks", "work_update_draft", "work_task_writer", "work_task_brief"]);
    for (const row of skills) expect(row).toMatch(/', false, \d+, 'fast'\),?$/);
  });

  it("trưởng đơn vị không xem việc hạn chế; người được nêu là người giao vẫn xem để xác nhận", () => {
    expect(migration).toContain("return ((v_related or v_scope or v_head) and v_restricted) or v_giver;");
  });
});
