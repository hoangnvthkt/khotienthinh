import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { WorkConfigurationWorkspace } from "../../pages/work/WorkSettings";
import {
  type ConfigRecord,
  type ConfigSave,
  type WorkConfigurationService,
} from "../../lib/work/workConfigurationService";
const calls: { name: string; args: unknown[] }[] = [];
const query = new URLSearchParams(location.search);
let fail = query.has("lost"),
  conflict = query.has("conflict");
const rows: ConfigRecord[] = [
  {
    id: "calendar-1",
    lock_version: 1,
    name: "Lịch văn phòng",
    is_active: true,
    timezone: "Asia/Ho_Chi_Minh",
    working_weekdays: [1, 2, 3, 4, 5, 6],
    working_intervals: [
      { start: "08:00", end: "12:00" },
      { start: "13:00", end: "17:00" },
    ],
  },
];
const service: WorkConfigurationService = {
  scopes: async (search = "", cursor = null) => {
    calls.push({ name: "scopes", args: [search, cursor] });
    return {
      items: [
        { id: "department:d1", name: "Phòng Quản lý dự án" },
        { id: "global", name: "Toàn hệ thống" },
      ].filter((x) => x.name.toLowerCase().includes(search.toLowerCase())),
      nextCursor: null,
    };
  },
  list: async (kind, scope, parent = null, cursor = null, id = null) => {
    calls.push({ name: "list", args: [kind, scope, parent, cursor, id] });
    if (kind === "calendar_option") return { items: rows, nextCursor: null };
    return {
      items: kind === "calendar" ? rows.filter((r) => !id || r.id === id) : [],
      nextCursor: null,
    };
  },
  save: async (input: ConfigSave) => {
    calls.push({ name: "save", args: [structuredClone(input)] });
    if (conflict) {
      conflict = false;
      rows[0] = {
        ...rows[0],
        lock_version: 2,
        name: "Lịch mới từ đồng nghiệp",
      };
      throw new Error("WORK_VERSION_CONFLICT");
    }
    if (fail) {
      fail = false;
      throw new Error("connection lost");
    }
    const r = {
      ...input.data,
      id: input.id || "new",
      lock_version: (input.version || 0) + 1,
    } as ConfigRecord;
    if (input.kind === "calendar") {
      const i = rows.findIndex((x) => x.id === r.id);
      if (i >= 0) rows[i] = r;
      else rows.push(r);
    }
    return { id: r.id, record: r };
  },
  history: async () => ({ items: [], nextCursor: null }),
  preview: async (...args) => {
    calls.push({ name: "preview", args });
    return {
      calendarName: "Lịch văn phòng",
      timezone: "Asia/Ho_Chi_Minh",
      policyId: null,
      acknowledgementMinutes: 60,
      executionMinutes: null,
      acknowledgementDueAt: "2026-09-07T06:30:00Z",
      executionDueAt: null,
    };
  },
};
Object.assign(window, { workConfigQa: { calls } });
createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <WorkConfigurationWorkspace actorId="fixture" service={service} />
  </HashRouter>,
);
