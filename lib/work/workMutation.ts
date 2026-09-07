import { knownWorkRejection } from "./workForm";
import type { WorkTaskService } from "./workTaskService";
import type {
  WorkCollaborationCommand,
  WorkLifecycleCommand,
} from "./workTypes";
export type WorkMutationRequest = {
  taskId: string;
  key: string;
  version: number;
  input: WorkLifecycleCommand | WorkCollaborationCommand;
  kind: "lifecycle" | "collaboration";
};
/** Owned by the actor's workspace: survives detail navigation, never persisted. */
export class WorkMutationSession {
  pending: WorkMutationRequest | null = null;
  running = false;
  begin(
    taskId: string,
    kind: WorkMutationRequest["kind"],
    input: WorkMutationRequest["input"],
    version = 0,
  ) {
    if (this.pending) throw new Error("WORK_UNRESOLVED_COMMAND");
    this.pending = {
      taskId,
      kind,
      input: structuredClone(input),
      version,
      key: crypto.randomUUID(),
    };
  }
  async run(service: WorkTaskService) {
    if (this.running || !this.pending)
      throw new Error("WORK_UNRESOLVED_COMMAND");
    this.running = true;
    const p = this.pending;
    try {
      const result =
        p.kind === "lifecycle"
          ? await service.command({
              ...p.input,
              taskId: p.taskId,
              expectedLockVersion: p.version,
              idempotencyKey: p.key,
            } as Parameters<WorkTaskService["command"]>[0])
          : await service.collaborate({
              ...p.input,
              taskId: p.taskId,
              idempotencyKey: p.key,
            } as Parameters<WorkTaskService["collaborate"]>[0]);
      this.pending = null;
      return result;
    } catch (error) {
      if (knownWorkRejection(error)) this.pending = null;
      throw error;
    } finally {
      this.running = false;
    }
  }
}
