import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes, useParams } from "react-router-dom";
import type { WorkWorkspaceService } from "../../lib/work/workWorkspaceService";
import type { WorkspaceSummary } from "../../lib/work/workWorkspaceTypes";
import { WorkHomeWorkspace } from "../../pages/work/WorkHome";

const query = new URLSearchParams(location.search);
const calls: Array<{ name: string; args: unknown[] }> = [];
let fail = query.has("error");
const workspace = (
  id: string,
  name: string,
  kind: WorkspaceSummary["kind"],
  pinned = false,
  actions = 0,
): WorkspaceSummary => ({
  id,name,kind,pinned,status: "active",
  sourceName: kind === "collaboration" ? null : name,
  iconKey: kind === "department" ? "building" : kind === "project" ? "briefcase" : "users",
  colorKey: "blue",coverKey: "blueprint",memberCount: kind === "collaboration" ? 8 : 2,
  visibleOpenTaskCount: actions + 3,myActionCount: actions,lockVersion: 1,
  capabilities: { canView: true,canCreateTask: true,canManageMembers: pinned,canConfigure: pinned,canArchive: pinned },
});
const rows = query.has("empty") ? [] : [
  workspace("space-department","Phòng Quản lý dự án","department",true,4),
  workspace("space-project","Dự án Nhà máy Bắc Ninh","project",false,2),
  workspace("space-collab","Tổ phối hợp nghiệm thu","collaboration",false,1),
  ...(query.has("expired") ? [] : [workspace("space-design","Nhóm thiết kế hiện trường","collaboration")]),
];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve,ms));
const service = {
  list: async (search = "",kind = null,cursor = null) => {
    calls.push({ name: "list",args: [search,kind,cursor] });
    if (fail) { fail = false; throw new Error("WORK_WORKSPACE_RPC_FAILED"); }
    if (query.has("loading") || search === "chậm") await pause(550);
    const filtered = rows.filter((item) => (!kind || item.kind === kind)
      && (!search || item.name.toLowerCase().includes(search.toLowerCase())));
    if (!cursor && query.has("pages")) return { items: filtered.slice(0,2),nextCursor: { sortAt: "2026-09-08T00:00:00Z",id: filtered[1]?.id || "end" } };
    return { items: cursor ? [filtered[1],...filtered.slice(2)].filter(Boolean) : filtered,nextCursor: null };
  },
  setPreference: async (workspaceId: string,pinned: boolean) => {
    calls.push({ name: "preference",args: [workspaceId,pinned] });
    const item = rows.find((value) => value.id === workspaceId);
    if (item) item.pinned = pinned;
    return { workspaceId,pinned,lastOpenedAt: null };
  },
} as WorkWorkspaceService;

function SpaceFixture() {
  const { workspaceId } = useParams();
  const item = rows.find((row) => row.id === workspaceId);
  return <main style={{ padding: 32 }}><a href="#/work">← Không gian</a><h1>{item?.name || "Không tìm thấy"}</h1></main>;
}
Object.assign(window,{ workWorkspaceQa: { calls,rows } });
createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <Routes>
      <Route path="/work" element={<WorkHomeWorkspace actorId="fixture-user" displayName="Phạm Ngọc Sơn" service={service} canCreateDirect />} />
      <Route path="/work/spaces/:workspaceId" element={<SpaceFixture />} />
      <Route path="*" element={<WorkHomeWorkspace actorId="fixture-user" displayName="Phạm Ngọc Sơn" service={service} canCreateDirect />} />
    </Routes>
  </HashRouter>,
);
