import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import type { WorkConfigurationService } from "../../lib/work/workConfigurationService";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type { WorkWorkspacePeopleService } from "../../lib/work/workWorkspacePeopleService";
import type { WorkWorkspaceService } from "../../lib/work/workWorkspaceService";
import type { MembershipChange, WorkspaceMember, WorkspaceSummary } from "../../lib/work/workWorkspaceTypes";
import { WorkHomeWorkspace } from "../../pages/work/WorkHome";
import { WorkSpaceCreateWorkspace } from "../../pages/work/WorkSpaceCreate";
import { WorkSpaceWorkspace } from "../../pages/work/WorkSpacePage";

const query = new URLSearchParams(location.search);
const calls: Array<{ name: string; args: unknown[] }> = [];
let fail = query.has("error");
let memberApplyFails = query.has("memberRetry");
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
if (query.has("archived") && rows[0]) rows[0].status = "archived";
const members: WorkspaceMember[] = [
  { userId: "admin-user",name: "Admin Hoàng",avatarUrl: null,role: "admin",origin: "organization",expiresAt: null,lockVersion: 1 },
  { userId: "son-user",name: "Phạm Ngọc Sơn",avatarUrl: null,role: "member",origin: "organization",expiresAt: null,lockVersion: 1 },
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
  get: async (workspaceId: string) => {
    calls.push({ name: "get",args: [workspaceId] });
    const item = rows.find((value) => value.id === workspaceId);
    if (!item) throw new Error("WORK_WORKSPACE_NOT_FOUND");
    return { ...item,memberCount: members.length };
  },
  setPreference: async (workspaceId: string,pinned: boolean) => {
    calls.push({ name: "preference",args: [workspaceId,pinned] });
    const item = rows.find((value) => value.id === workspaceId);
    if (item && pinned !== null) item.pinned = pinned;
    return { workspaceId,pinned: item?.pinned || false,lastOpenedAt: null };
  },
  members: async (workspaceId: string,search = "") => {
    calls.push({ name: "members",args: [workspaceId,search] });
    return { items: members.filter((member) => member.name.toLowerCase().includes(search.toLowerCase())),nextCursor: null };
  },
  previewMembers: async (workspaceId: string,changes: MembershipChange[]) => {
    calls.push({ name: "memberPreview",args: [workspaceId,changes] });
    return { fingerprint: "fixture-fingerprint",changes,blockers: [] };
  },
  applyMembers: async (workspaceId: string,preview: { changes: MembershipChange[] },version: number,reason: string,key: string) => {
    calls.push({ name: "memberApply",args: [workspaceId,preview,version,reason,key] });
    if (memberApplyFails) { memberApplyFails = false; throw new Error("NETWORK_RESPONSE_LOST"); }
    for (const change of preview.changes) {
      if (change.operation === "add" && !members.some((member) => member.userId === change.userId)) members.push({ userId: change.userId,name: "Nguyễn Minh Anh",avatarUrl: null,role: change.role || "member",origin: change.origin || "manual",expiresAt: null,lockVersion: 1 });
    }
    const item = rows.find((value) => value.id === workspaceId);
    if (item) item.lockVersion = 2;
    return { lockVersion: 2 };
  },
  sources: async (kind: WorkspaceSummary["kind"],search = "") => {
    calls.push({ name: "sources",args: [kind,search] });
    const all = kind === "department" ? [
      { id: "department-1",name: "Phòng Quản lý dự án",kind,existingWorkspaceId: "space-department" },
      { id: "department-2",name: "Phòng Kỹ thuật",kind,existingWorkspaceId: null },
    ] : [{ id: "project-1",name: "Dự án Trung tâm dữ liệu",kind,existingWorkspaceId: null }];
    return { items: all.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())),nextCursor: null };
  },
  create: async (input: { kind: WorkspaceSummary["kind"]; name: string; coverKey: string },key: string) => {
    calls.push({ name: "create",args: [input,key] });
    if (!["plain","grid","waves","dots","blueprint","sunrise"].includes(input.coverKey)) throw new Error("WORK_INVALID_COMMAND");
    const created = workspace("space-created",input.name,input.kind,false,0); rows.push(created); return created;
  },
  command: async (workspaceId: string,command: string,payload: Record<string,unknown>,version: number,reason: string,key: string) => {
    calls.push({ name: "command",args: [workspaceId,command,payload,version,reason,key] });
    const item = rows.find((value) => value.id === workspaceId)!;
    if (command === "update_profile") item.name = String(payload.name);
    if (command === "archive") item.status = "archived";
    if (command === "restore") item.status = "active";
    item.lockVersion += 1; return { ...item };
  },
} as WorkWorkspaceService;

const peopleService = {
  people: async (workspaceId: string,source: string,search = "") => {
    calls.push({ name: "people",args: [workspaceId,source,search] });
    const people = [
      { userId: "new-user",employeeId: "employee-3",name: "Nguyễn Minh Anh",avatarUrl: null,position: "Kỹ sư dự án",sourceLabel: "Phòng Quản lý dự án",sourceReference: "department-1",eligibility: "ELIGIBLE",alreadyMember: members.some((member) => member.userId === "new-user") },
      { userId: null,employeeId: "employee-4",name: "Nhân sự chưa có tài khoản",avatarUrl: null,position: "Thực tập",sourceLabel: null,sourceReference: null,eligibility: "NO_APP_ACCOUNT",alreadyMember: false },
    ];
    return { items: people.filter((person) => person.name.toLowerCase().includes(search.toLowerCase())),nextCursor: null };
  },
  sourceDiff: async (workspaceId: string) => { calls.push({ name: "sourceDiff",args: [workspaceId] }); return { fingerprint: "source-fp",items: [],nextCursor: null }; },
} as WorkWorkspacePeopleService;

const taskRows = [{
  id: "task-1",task_code: "CV-0001",title: "Kiểm tra hồ sơ nghiệm thu",status: "pending_acknowledgement",priority: "important",privacy: "standard",scope_type: "workspace",workspace_id: "space-department",department_id: null,project_id: null,task_group_id: null,deadline_at: "2026-09-10T10:00:00Z",created_by: "admin-user",reviewer_user_id: null,updated_at: "2026-09-08T00:00:00Z",lock_version: 1,
}];
const taskService = {
  workspaceTasks: async (workspaceId: string,filters: { search?: string }) => {
    calls.push({ name: "workspaceTasks",args: [workspaceId,filters] });
    if (query.has("slowRefresh")) await new Promise((resolve) => setTimeout(resolve, 500));
    return { items: taskRows.filter((task) => !filters.search || task.title.toLowerCase().includes(filters.search.toLowerCase())),nextCursor: null };
  },
  context: async () => ({ actorId: "fixture-user",canCreate: true,canAssignUser: false,canAssignGroup: false,canChooseReviewer: false,calendarReady: true }),
  groups: async () => ({ items: [],nextCursor: null }),
  options: async () => ({ items: [],nextCursor: null }),
  preview: async () => ({ validCount: 0,excluded: [],resolved: [],fingerprint: "task-fp" }),
} as unknown as WorkTaskService;
const configurationService = {
  list: async () => ({ items: [],nextCursor: null }),
  history: async () => ({ items: [],nextCursor: null }),
  preview: async () => ({ calendarName: "Lịch văn phòng",timezone: "Asia/Ho_Chi_Minh",policyId: "policy",acknowledgementMinutes: 480,executionMinutes: null,acknowledgementDueAt: "2026-09-09T10:00:00Z",executionDueAt: null }),
  save: async () => ({ id: "record",record: null }),
  scopes: async () => ({ items: [],nextCursor: null }),
} as WorkConfigurationService;

function TaskFixture() {
  const { taskCode } = useParams();
  const [params] = useSearchParams();
  return <main style={{ padding: 32 }}><h1>{taskCode}</h1><p>Workspace quay lại: {params.get("workspace")}</p></main>;
}
const subscribeRefresh = (invalidate: () => void) => {
  window.addEventListener("focus", invalidate);
  return () => window.removeEventListener("focus", invalidate);
};
function SpaceRouteFixture() {
  const { workspaceId = "" } = useParams();
  return <WorkSpaceWorkspace actorId="fixture-user" workspaceId={workspaceId} workspaceService={service} peopleService={peopleService} taskService={taskService} attachments={{} as never} configurationService={configurationService} subscribe={query.has("slowRefresh") ? subscribeRefresh : undefined} />;
}
Object.assign(window,{ workWorkspaceQa: { calls,rows,members } });
createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <Routes>
      <Route path="/work" element={<WorkHomeWorkspace actorId="fixture-user" displayName="Phạm Ngọc Sơn" service={service} canCreateDirect canCreateWorkspace />} />
      <Route path="/work/spaces/new" element={<WorkSpaceCreateWorkspace service={service} />} />
      <Route path="/work/spaces/:workspaceId" element={<SpaceRouteFixture />} />
      <Route path="/work/spaces/:workspaceId/members" element={<SpaceRouteFixture />} />
      <Route path="/work/spaces/:workspaceId/settings" element={<SpaceRouteFixture />} />
      <Route path="/work/tasks/:taskCode" element={<TaskFixture />} />
      <Route path="*" element={<WorkHomeWorkspace actorId="fixture-user" displayName="Phạm Ngọc Sơn" service={service} canCreateDirect canCreateWorkspace />} />
    </Routes>
  </HashRouter>,
);
