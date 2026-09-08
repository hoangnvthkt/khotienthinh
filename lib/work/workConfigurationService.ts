import type { SupabaseClient } from "@supabase/supabase-js";
import { knownWorkRejection } from "./workForm";
export type ConfigScope =
  | { type: "global" }
  | { type: "department"; departmentId: string }
  | { type: "project"; projectId: string }
  | { type: "workspace"; workspaceId: string };
export type ConfigKind = "group" | "calendar" | "exception" | "policy";
export interface ConfigRecord {
  id: string;
  lock_version: number;
  name?: string;
  description?: string | null;
  is_active?: boolean;
  sort_order?: number;
  timezone?: string;
  working_weekdays?: number[];
  working_intervals?: { start: string; end: string }[];
  is_default?: boolean;
  calendar_id?: string;
  exception_date?: string;
  is_working_day?: boolean;
  label?: string | null;
  priority?: string | null;
  acknowledgement_minutes?: number;
  execution_minutes?: number | null;
  effective_from?: string;
  effective_to?: string | null;
  [key: string]: unknown;
}
export interface ConfigPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface ConfigSave {
  kind: ConfigKind;
  scope: ConfigScope;
  id: string | null;
  version: number | null;
  data: Record<string, unknown>;
  reason: string;
  key: string;
}
export const configurationFields: Record<ConfigKind, string[]> = {
  group: ["name", "description", "is_active", "sort_order"],
  calendar: [
    "name",
    "timezone",
    "working_weekdays",
    "working_intervals",
    "is_active",
    "is_default",
  ],
  exception: [
    "calendar_id",
    "exception_date",
    "is_working_day",
    "working_intervals",
    "label",
  ],
  policy: [
    "name",
    "calendar_id",
    "priority",
    "acknowledgement_minutes",
    "execution_minutes",
    "effective_from",
    "effective_to",
    "is_active",
  ],
};
export function configurationScope(key: string): ConfigScope {
  if (key === "global") return { type: "global" };
  const split = key.indexOf(":");
  const kind = split < 0 ? "" : key.slice(0, split);
  const id = split < 0 ? "" : key.slice(split + 1);
  if (!id) throw new Error("WORK_INVALID_SCOPE");
  if (kind === "department") return { type: "department", departmentId: id };
  if (kind === "project") return { type: "project", projectId: id };
  if (kind === "workspace") return { type: "workspace", workspaceId: id };
  throw new Error("WORK_INVALID_SCOPE");
}
export function createWorkConfigurationService(
  client: Pick<SupabaseClient, "rpc">,
) {
  const call = async <T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> => {
    const r = await client.rpc(name, args);
    if (r.error) throw r.error;
    return r.data as T;
  };
  return {
    scopes: (search = "", cursor: string | null = null) =>
      call<ConfigPage<{ id: string; name: string }>>(
        "list_work_configuration_scopes",
        { p_search: search, p_cursor: cursor, p_limit: 30 },
      ),
    list: (
      kind: ConfigKind | "calendar_option",
      scope: ConfigScope,
      parent: string | null = null,
      cursor: string | null = null,
      id: string | null = null,
    ) =>
      call<ConfigPage<ConfigRecord>>("list_work_configuration", {
        p_kind: kind,
        p_scope: scope,
        p_parent_id: parent,
        p_cursor: cursor,
        p_limit: 30,
        p_record_id: id,
      }),
    save: (s: ConfigSave) =>
      call<{ id: string; record: ConfigRecord | null }>(
        "save_work_configuration",
        {
          p_kind: s.kind,
          p_scope: s.scope,
          p_id: s.id,
          p_expected_version: s.version,
          p_data: s.data,
          p_reason: s.reason,
          p_key: s.key,
        },
      ),
    history: (scope: ConfigScope, cursor: string | null = null) =>
      call<
        ConfigPage<{
          id: string;
          kind: ConfigKind;
          before_value: ConfigRecord | null;
          after_value: ConfigRecord | null;
          reason: string;
          created_at: string;
          actor_name: string;
        }>
      >("list_work_configuration_history", {
        p_scope: scope,
        p_cursor: cursor,
        p_limit: 30,
      }),
    preview: (scope: ConfigScope, priority: string, at: string) =>
      call<{
        calendarName: string;
        timezone: string;
        policyId: string | null;
        acknowledgementMinutes: number;
        executionMinutes: number | null;
        acknowledgementDueAt: string;
        executionDueAt: string | null;
      }>("preview_work_configuration_sla", {
        p_scope: scope,
        p_priority: priority,
        p_at: at,
      }),
  };
}
export type WorkConfigurationService = ReturnType<
  typeof createWorkConfigurationService
>;
export class ConfigAttempt {
  pending: ConfigSave | null = null;
  running = false;
  private persistedKey: string | null = null;
  constructor(private storageKey?: string) {
    if (!storageKey) return;
    try {
      const raw = sessionStorage.getItem(storageKey);
      const p = raw && raw.length <= 20000 ? JSON.parse(raw) : null;
      if (
        p &&
        Object.keys(configurationFields).includes(p.kind) &&
        typeof p.key === "string" &&
        typeof p.reason === "string" &&
        p.scope &&
        ["global", "department", "project", "workspace"].includes(
          p.scope.type,
        ) &&
        p.data &&
        typeof p.data === "object"
      ) {
        this.pending = p;
        this.persistedKey = p.key;
      }
    } catch {
      /* Storage may be disabled; in-memory retry still works. */
    }
  }
  private persist() {
    if (!this.storageKey) return;
    try {
      if (this.pending) {
        sessionStorage.setItem(this.storageKey, JSON.stringify(this.pending));
        this.persistedKey = this.pending.key;
      } else if (
        JSON.parse(sessionStorage.getItem(this.storageKey) || "null")?.key ===
        this.persistedKey
      )
        sessionStorage.removeItem(this.storageKey);
    } catch {
      /* Private browsing/quota must not change the command result. */
    }
  }
  begin(input: Omit<ConfigSave, "key">) {
    if (this.pending) throw new Error("WORK_UNRESOLVED_COMMAND");
    this.pending = { ...structuredClone(input), key: crypto.randomUUID() };
    this.persist();
  }
  async run(service: WorkConfigurationService) {
    if (!this.pending || this.running)
      throw new Error("WORK_UNRESOLVED_COMMAND");
    this.running = true;
    try {
      const r = await service.save(this.pending);
      this.pending = null;
      return r;
    } catch (e) {
      if (
        knownWorkRejection(e) &&
        (e as { message?: string }).message !== "WORK_CONFIGURE_DENIED"
      )
        this.pending = null;
      throw e;
    } finally {
      this.running = false;
      this.persist();
    }
  }
}
export function parseWorkIntervals(value: string) {
  return value
    .split(",")
    .filter((x) => x.trim())
    .map((x) => {
      const m = x.trim().match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
      if (!m) throw new Error("WORK_INVALID_INTERVALS");
      return { start: m[1], end: m[2] };
    });
}
