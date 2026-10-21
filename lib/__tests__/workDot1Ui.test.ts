import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { quickDuePresets, quickTaskInput } from "../../pages/work/WorkQuickAssign";
import { freshAttachments, progressChoices } from "../../pages/work/WorkProgressReport";
import { workDueInfo, workLevelLabels, workLevelOf, workUpdateInfo } from "../work/workPresentation";
import { documentText } from "../work/workForm";
import type { WorkTaskAttachment } from "../work/workTypes";

const migration = readFileSync("supabase/migrations/20261022090000_work_dot1_notify_quick.sql", "utf8");

describe("Vioo Work Đợt 1 PR-2 · giao nhanh", () => {
  it("hạn gợi ý hôm nay / mai / thứ 7 lúc 17:00, bỏ mốc đã qua và mốc trùng", () => {
    const tuesday = new Date(2026, 9, 20, 10, 30); // T3 20/10
    expect(quickDuePresets(tuesday).map((p) => [p.id, p.label, p.at.getDate(), p.at.getHours()])).toEqual([
      ["today", "Hôm nay", 20, 17], ["tomorrow", "Mai", 21, 17], ["saturday", "Thứ 7 24/10", 24, 17],
    ]);
    const tuesdayEvening = new Date(2026, 9, 20, 18, 0);
    expect(quickDuePresets(tuesdayEvening).map((p) => p.id)).toEqual(["tomorrow", "saturday"]);
    const friday = new Date(2026, 9, 23, 9, 0); // mai là thứ 7 → gộp một nút
    expect(quickDuePresets(friday).map((p) => p.id)).toEqual(["today", "tomorrow"]);
  });

  it("dựng đầu vào tạo việc phạm vi trực tiếp, A → urgent, checklist / thẻ sạch, ghi bằng chứng khi nộp", () => {
    const input = quickTaskInput({
      title: "  Rà soát khối lượng mái khu B ", assigneeId: "u-ha", deadline: new Date(2026, 9, 24, 17, 0), level: "A",
      description: "Đối chiếu bản vẽ R2", checklist: "Bóc khối lượng\n\n Đối chiếu dự toán ", tags: "XinHai, Mái, XinHai",
      evidence: { photo: true, file: true },
    });
    expect(input).toMatchObject({
      title: "Rà soát khối lượng mái khu B", scope: { type: "direct" }, recipientSources: [{ type: "user", id: "u-ha" }],
      priority: "urgent", privacy: "standard", labels: ["XinHai", "Mái"],
      checklist: [{ title: "Bóc khối lượng" }, { title: "Đối chiếu dự toán" }], watcherUserIds: [],
    });
    expect(documentText(input.description)).toBe("Đối chiếu bản vẽ R2\nBằng chứng khi nộp: ảnh + tệp.");
    expect(new Date(input.deadlineAt!).getHours()).toBe(17);
  });
});

describe("Vioo Work Đợt 1 PR-2 · cập nhật tiến độ", () => {
  it("mốc % gồm mức hiện tại + mốc lớn hơn", () => {
    expect(progressChoices(0)).toEqual([0, 25, 50, 75, 90, 100]);
    expect(progressChoices(65)).toEqual([65, 75, 90, 100]);
    expect(progressChoices(100)).toEqual([100]);
  });

  it("chỉ gợi ý gắn tệp người làm vừa tải sau lần cập nhật trước", () => {
    const file = (id: string, by: string, at: string) => ({ id, uploader_user_id: by, created_at: at, deleted_at: null }) as unknown as WorkTaskAttachment;
    const files = [file("old", "me", "2026-10-19T01:00:00Z"), file("new", "me", "2026-10-20T02:00:00Z"), file("other", "you", "2026-10-20T03:00:00Z")];
    expect(freshAttachments(files, "me", "2026-10-20T00:00:00Z").map((f) => f.id)).toEqual(["new"]);
    expect(freshAttachments(files, "me", null).map((f) => f.id)).toEqual(["old", "new"]);
  });
});

describe("Vioo Work Đợt 1 PR-2 · nhãn mức, hạn, lâu chưa cập nhật", () => {
  it("A / B / C từ priority", () => {
    expect([workLevelOf("urgent"), workLevelOf("important"), workLevelOf("normal")]).toEqual(["A", "B", "C"]);
    expect(workLevelLabels.urgent).toBe("A · Trọng điểm");
  });

  it("hạn: quá N ngày đỏ, hôm nay / mai cam, còn N ngày; việc xong không báo quá hạn", () => {
    const now = new Date(2026, 9, 20, 10, 30);
    expect(workDueInfo(new Date(2026, 9, 17, 17, 0).toISOString(), "in_progress", now)).toEqual({ text: "Quá 3 ngày", tone: "over" });
    expect(workDueInfo(new Date(2026, 9, 20, 9, 0).toISOString(), "in_progress", now)).toEqual({ text: "Quá hạn hôm nay", tone: "over" });
    expect(workDueInfo(new Date(2026, 9, 20, 17, 0).toISOString(), "in_progress", now)).toEqual({ text: "Hôm nay 17:00", tone: "soon" });
    expect(workDueInfo(new Date(2026, 9, 21, 17, 0).toISOString(), "in_progress", now).tone).toBe("soon");
    expect(workDueInfo(new Date(2026, 9, 24, 17, 0).toISOString(), "in_progress", now)).toEqual({ text: "Còn 4 ngày", tone: "ok" });
    expect(workDueInfo(new Date(2026, 9, 17, 17, 0).toISOString(), "completed", now).tone).toBe("ok");
    expect(workDueInfo(null, "in_progress", now)).toEqual({ text: "Chưa có hạn", tone: "none" });
  });

  it("lâu chưa cập nhật khi quá 48 giờ với việc đang làm; việc chờ duyệt / xong không nhắc", () => {
    const now = new Date("2026-10-20T03:30:00Z");
    expect(workUpdateInfo("2026-10-17T03:00:00Z", "in_progress", now)).toEqual({ text: "3 ngày chưa cập nhật", stale: true });
    expect(workUpdateInfo("2026-10-20T01:30:00Z", "in_progress", now)).toEqual({ text: "Cập nhật 2 giờ trước", stale: false });
    expect(workUpdateInfo("2026-10-17T03:00:00Z", "awaiting_review", now)).toBeNull();
    expect(workUpdateInfo(null, "in_progress", now)).toBeNull();
  });
});

describe("Vioo Work Đợt 1 PR-2 · hợp đồng migration", () => {
  it("bật thông báo, bỏ hàng chờ tồn trước lúc áp, lịch nhắc 08:00 thứ 2 – thứ 7", () => {
    expect(migration).toContain("update app_private.work_notification_settings set enabled = true, rollout_started_at = now() where singleton;");
    expect(migration).toContain("perform cron.schedule('work-stale-reminders', '0 1 * * 1-6', 'select app_private.work_enqueue_stale_reminders();');");
  });

  it("nhắc chỉ việc A/B, quá 48 giờ; quá 72 giờ báo thêm trưởng đơn vị; mỗi việc một tin / ngày", () => {
    expect(migration).toContain("t.priority in ('urgent', 'important')");
    expect(migration).toContain("q.last_at < now() - interval '48 hours'");
    expect(migration).toContain("when r.last_at < now() - interval '72 hours' then 'task.stale_escalated' else 'task.stale_reminder' end");
    expect(migration).toMatch(/insert into app_private\.work_reminder_keys values \(v_key, now\(\)\) on conflict do nothing;\s+if not found then continue;/);
  });

  it("mốc cập nhật trong danh sách chỉ trả khi người gọi xem được việc", () => {
    expect(migration).toContain("select case when app_private.work_task_actor_can_view(p_task_id) then app_private.work_task_last_progress_at(p_task_id) end;");
    expect(migration).toMatch(/grant execute on function public\.list_work_task_updates_v1\(uuid, timestamptz, integer\) to authenticated;/);
  });
});
