// Vioo Work · Đợt 1 PR-3: thẻ "Giao việc" của Trợ lý. Trợ lý chỉ chuẩn bị (assistant_commands kind work_task); người dùng sửa trên thẻ rồi
// bấm Giao → đúng lệnh của Giao nhanh (xem trước người nhận → create_work_task, khóa chống tạo trùng theo thẻ) → biên nhận trên thẻ.
import { supabase } from './supabase';
import { finishCommand, workTaskRoute, type AssistantCommand } from './assistantCommands';
import { createWorkTaskService, type WorkTaskService } from './work/workTaskService';
import { createWorkBoardService, type WorkAssignablePeople, type WorkBoardService, type WorkLevel } from './work/workBoardService';
import { WorkCreateAttempt, knownWorkRejection, workError } from './work/workForm';
import { quickTaskInput } from './work/workQuick';

export interface WorkTaskCardInput { title: string; assigneeId: string; assigneeName: string; deadline: Date; level: WorkLevel; description: string; checklist: string[] }
export interface WorkTaskCardActions {
  people: () => Promise<WorkAssignablePeople>;
  give: (command: AssistantCommand, input: WorkTaskCardInput) => Promise<AssistantCommand>;
}

export function createWorkTaskCardActions(
  service: Pick<WorkTaskService, 'preview' | 'create'> = createWorkTaskService(supabase),
  board: Pick<WorkBoardService, 'assignablePeople' | 'linkAi'> = createWorkBoardService(supabase),
  finish: typeof finishCommand = finishCommand,
): WorkTaskCardActions {
  const attempts = new Map<string, { signature: string; value: WorkCreateAttempt }>();
  let people: Promise<WorkAssignablePeople> | null = null;
  return {
    people: () => (people ??= board.assignablePeople(null, 200).catch(e => { people = null; throw e; })),
    async give(command, form) {
      const input = quickTaskInput({ title: form.title, assigneeId: form.assigneeId, deadline: form.deadline, level: form.level, description: form.description,
        checklist: form.checklist.join('\n'), tags: '', evidence: { photo: false, file: false } });
      const signature = JSON.stringify(input);
      let a = attempts.get(command.id);
      try {
        if (!a || a.signature !== signature) {
          const preview = await service.preview(input.recipientSources, input.scope);
          if (!preview.validCount) throw new Error('WORK_NO_VALID_RECIPIENTS');
          a = { signature, value: new WorkCreateAttempt(input, preview.fingerprint) };
          attempts.set(command.id, a);
        }
        const result = await service.create(a.value.input, a.value.key, a.value.fingerprint);
        attempts.delete(command.id);
        const runId = typeof command.payload.runId === 'string' ? command.payload.runId : null;
        if (runId) void board.linkAi(result.taskId, runId, 'assistant').catch(() => undefined);
        const receipt = { code: result.taskCode, taskId: result.taskId, route: workTaskRoute(result.taskCode), assigneeName: form.assigneeName, deadlineAt: input.deadlineAt };
        return (await finish(command.id, 'done', receipt)) || { ...command, status: 'done', result: receipt };
      } catch (e) {
        // Lời từ chối đã biết thì bỏ lần thử; lỗi mạng giữ khóa để bấm lại không tạo việc thứ hai.
        if (knownWorkRejection(e) || (e instanceof Error && e.message === 'WORK_NO_VALID_RECIPIENTS')) attempts.delete(command.id);
        throw new Error(workError(e));
      }
    },
  };
}
export const defaultWorkTaskCardActions = createWorkTaskCardActions();
