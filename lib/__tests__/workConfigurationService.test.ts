import { describe, it, expect, vi } from "vitest";
import {
  ConfigAttempt,
  createWorkConfigurationService,
  parseWorkIntervals,
} from "../work/workConfigurationService";
describe("Work configuration", () => {
  it("uses bounded readers and immutable retries including scope and reason", async () => {
    const rpc = vi.fn().mockResolvedValue({
        data: { items: [], nextCursor: null },
        error: null,
      }),
      service = createWorkConfigurationService({ rpc } as any);
    await service.list("calendar", { type: "global" }, null, "cursor");
    expect(rpc).toHaveBeenLastCalledWith(
      "list_work_configuration",
      expect.objectContaining({ p_limit: 30, p_cursor: "cursor" }),
    );
    rpc
      .mockResolvedValueOnce({ error: new Error("network") })
      .mockResolvedValue({ data: { id: "saved" }, error: null });
    const attempt = new ConfigAttempt(),
      data = { name: "Original" };
    attempt.begin({
      kind: "calendar",
      scope: { type: "global" },
      id: null,
      version: null,
      data,
      reason: "Pilot calendar",
    });
    data.name = "Changed";
    await expect(attempt.run(service)).rejects.toThrow("network");
    await attempt.run(service);
    expect(rpc.mock.calls.at(-1)).toEqual(rpc.mock.calls.at(-2));
    expect(rpc.mock.calls.at(-1)?.[1].p_data.name).toBe("Original");
    expect(attempt.pending).toBeNull();
  });
  it("releases conflict for explicit reload but retains uncertainty after configure access loss", async () => {
    const rpc = vi
        .fn()
        .mockResolvedValue({ error: new Error("WORK_VERSION_CONFLICT") }),
      service = createWorkConfigurationService({ rpc } as any),
      a = new ConfigAttempt();
    const input = {
      kind: "group" as const,
      scope: { type: "department" as const, departmentId: "d" },
      id: "g",
      version: 1,
      data: { name: "Bucket" },
      reason: "Rename bucket",
    };
    a.begin(input);
    await expect(a.run(service)).rejects.toThrow();
    expect(a.pending).toBeNull();
    a.begin(input);
    rpc.mockResolvedValue({ error: new Error("WORK_CONFIGURE_DENIED") });
    await expect(a.run(service)).rejects.toThrow();
    expect(a.pending).not.toBeNull();
  });
  it("restores the same command after navigation without sharing it with another actor", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => values.get(k) || null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    });
    try {
      const a = new ConfigAttempt("actor-a");
      a.begin({
        kind: "calendar",
        scope: { type: "global" },
        id: null,
        version: null,
        data: { name: "Pilot" },
        reason: "Actual hours",
      });
      const restored = new ConfigAttempt("actor-a");
      expect(restored.pending).toEqual(a.pending);
      expect(new ConfigAttempt("actor-b").pending).toBeNull();
      const rpc = vi
        .fn()
        .mockResolvedValue({ data: { id: "saved" }, error: null });
      await restored.run(createWorkConfigurationService({ rpc } as any));
      expect(new ConfigAttempt("actor-a").pending).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("parses split shifts without merging lunch into working time", () => {
    expect(parseWorkIntervals("08:00-12:00, 13:00-17:00")).toEqual([
      { start: "08:00", end: "12:00" },
      { start: "13:00", end: "17:00" },
    ]);
    expect(() => parseWorkIntervals("eight-five")).toThrow(
      "WORK_INVALID_INTERVALS",
    );
  });
});
