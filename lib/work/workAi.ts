/** Vioo Work Đợt 1 (PR-3): AI soạn nháp giao việc qua cổng AI + khớp người / hạn trên máy.
 * AI không giao, không gửi: màn hình điền form, người dùng bấm. Tên người và hạn AI chỉ chép chữ trong câu ("Hà", "thứ 6");
 * máy khớp với danh sách người giao được và đổi thành ngày; trùng / không chắc thì hiện nút để chọn. */
import { aiErrorMessage, aiGateway, type AiRunResult } from "../aiGateway";
import type { WorkAssignablePerson, WorkLevel } from "./workBoardService";
import { localIsoDate, workPeopleLines, type AiImage, type AiMeeting, type AiTaskDraft, type AiTaskWriting, type AiUpdateDraft } from "./workAiText";
export * from "./workAiText";

/** Ứng dụng tắt strict: cả hai nhánh đều khai đủ khóa để đọc r.message / r.result sau khi kiểm r.ok. */
export type WorkAiResult<T> = { ok: true; runId: string; result: T; message?: undefined } | { ok: false; message: string; runId?: undefined; result?: undefined };

async function unwrap<T>(pending: Promise<AiRunResult<T>>): Promise<WorkAiResult<T>> {
  try {
    const r = await pending;
    return r.code === "OK" ? { ok: true, runId: r.runId, result: r.result } : { ok: false, message: aiErrorMessage(r) };
  } catch {
    return { ok: false, message: aiErrorMessage({ code: "AI_FAILED" }) };
  }
}

export function createWorkAi(run: typeof aiGateway.run = aiGateway.run.bind(aiGateway), feedback = aiGateway.feedback.bind(aiGateway)) {
  return {
    draftTask: (text: string, people: WorkAssignablePerson[], now = new Date()) =>
      unwrap(run<AiTaskDraft>("work_task_draft", { text, today: localIsoDate(now), people: workPeopleLines(people) }, { screen: "work" })),
    meetingTasks: (text: string, images: AiImage[], people: WorkAssignablePerson[], now = new Date()) =>
      unwrap(run<AiMeeting>("work_meeting_tasks", { text, images: images.length ? images : null, today: localIsoDate(now), people: workPeopleLines(people) },
        { screen: "work", pages: images.length })),
    updateDraft: (notes: string, facts: string, taskId: string) =>
      unwrap(run<AiUpdateDraft>("work_update_draft", { notes, task: facts }, { screen: "work", taskId })),
    writeTask: (title: string, notes: string, level: WorkLevel | null) =>
      unwrap(run<AiTaskWriting>("work_task_writer", { title, notes, level }, { screen: "work" })),
    briefTask: (facts: string, taskId: string) =>
      unwrap(run<{ brief: string }>("work_task_brief", { facts }, { screen: "work", taskId })),
    /** 👍 / 👎 cho tóm tắt (nháp khác ghi "đã dùng" khi người dùng gửi thật qua work_ai_link_v1 / aiRunId). */
    feedback: (runId: string, accepted: boolean) => feedback(runId, accepted),
  };
}
export type WorkAiService = ReturnType<typeof createWorkAi>;
export const workAi = createWorkAi();
