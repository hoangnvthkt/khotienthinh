# Vioo Work Workspaces Implementation Plan

> **For agentic workers:** Execute task-by-task with the main agent coordinating.
> The user's subsequent instruction authorizes sub-agents for WS1–WS8, overriding
> the earlier no-sub-agent instruction for this scope only. Every sub-agent must
> use model `gpt-5.6-luna`, reasoning effort `xhigh` (Extra High).
> No unsolicited handoffs. Steps use checkbox syntax; this document is a plan,
> not authorization to publish production UI or send notifications.

**Goal:** Xây dashboard Workspace trực quan, có thành viên/quản trị riêng, liên kết
phòng ban/dự án chính thức, giữ nguyên nền tảng công việc R1A và hỗ trợ cộng tác liên phòng.

**Architecture:** Workspace là chủ thể cộng tác có ID riêng; liên kết nguồn tổ chức
chỉ cung cấp danh tính và gợi ý nhân sự. Membership sinh capability qua hệ thống quyền
hiện hành; mọi đường vào task và tài nguyên con đều kiểm tra membership trên server.
Chuyển đổi theo hướng thêm quan hệ, hỗ trợ client cũ có kiểm soát và chuyển từng scope.

**Tech Stack:** React 18, TypeScript, React Router 6, Vite, Supabase Cloud/Postgres/RPC,
Vitest, Playwright/Chrome; tái sử dụng CSS, private Storage và worker Work hiện có.

**Spec:** [Workspace design](../specs/2026-09-07-vioo-work-workspaces-design.md), kế thừa
[R1A](../specs/2026-09-05-vioo-work-task-management-design.md).

## Global Constraints

- Worktree `/Users/admin/khotienthinh/.worktrees/vioo-work-r1a`, branch `feature/vioo-work-r1a`.
- Điều phối bằng agent chính; sub-agent chỉ trong WS1–WS8 theo chỉ dẫn mới của người dùng,
  model `gpt-5.6-luna`, reasoning `xhigh`; không tạo/cập nhật handoff khi chưa được yêu cầu.
- Chỉ Supabase Cloud project `ftciqmqhmfvjtwoycswe`, cấu hình root `.env`; không Docker/local Supabase.
- Tạo migration bằng `npx --no-install supabase migration new <name>` khi thực hiện task.
  Không đặt trước timestamp, không sửa migration đã apply, không `db push --include-all`.
- Candidate rollback smoke → commit explicit paths → linked dry-run đúng migration → apply → postflight.
- Giữ task code/ID, assignment, deadline, SLA snapshots và audit. Không sao chép task sang bảng mới.
- Giao trực tiếp độc lập; membership không tự sửa hồ sơ nhân sự hoặc quyền của module khác.
- Không tự động mở quyền theo chức danh, ADMIN legacy hay thay đổi sơ đồ tổ chức.
- Dev port 5187 đã được người dùng chọn; giữ notification disabled trong UI review.
- Không chạy lại toàn bộ test cho thay đổi tài liệu; code chạy test liên quan và toàn bộ trước cutover.

## Baseline và thứ tự

Task 1–10 R1A đã triển khai backend và giao diện hiện tại; Task 10 có pilot dev,
nhưng trải nghiệm Workspace đã được người dùng bổ sung. Lộ trình này dùng mã
**WS1–WS8** để không nhập nhằng với Task 11 quan sát hoặc R1B giao hàng loạt.
Thực hiện WS1 → WS2 → WS3 → WS4 → WS5 → WS6 → WS7 → WS8.

| Task | Kết quả kiểm chứng độc lập |
| --- | --- |
| WS1 | Dữ liệu Workspace, quan hệ scope và hợp đồng API/types |
| WS2 | Tạo không gian, membership, vai trò và nguồn quyền canonical |
| WS3 | Gợi ý/thêm nhanh/đối chiếu nhân sự từ tổ chức và dự án |
| WS4 | Task, tài nguyên con và mọi đường đọc/ghi tuân theo Workspace |
| WS5 | Nhóm việc, lịch/SLA và dữ liệu pilot chuyển đúng sang Workspace |
| WS6 | Dashboard dạng menu thẻ, cá nhân hóa và điều hướng |
| WS7 | Màn hình không gian, tạo việc, quản lý thành viên và cấu hình |
| WS8 | Di chuyển pilot có kiểm soát, QA, bật dev và nghiệm thu người dùng |

Không bật dashboard bằng dữ liệu thật trước WS4/WS5. WS6 có fixture trình duyệt
riêng để kiểm tra bố cục mà không phát sinh dữ liệu Cloud; WS8 mới nối trải nghiệm
hoàn chỉnh cho pilot. Đây là một chuỗi phụ thuộc quyền/dữ liệu, không chia thành
những nhánh triển khai độc lập làm lệch hợp đồng.

## Cách phối hợp agent — cập nhật theo lựa chọn của người dùng

Một agent có thể hoàn thành lộ trình, nhưng dùng sub-agent cho phần việc độc lập
sẽ giúp tách triển khai khỏi kiểm tra. Không giao tám task chạy đồng thời: các
hợp đồng dữ liệu/quyền là phụ thuộc tuần tự WS1–WS5.

- **Agent chính:** sở hữu kiến trúc/contracts, điều phối file, rà quyền và tương thích,
  tích hợp, xử lý lỗi liên phần, chạy Cloud rollback/apply/postflight, commit và báo cáo.
- **Sub-agent triển khai:** một phần code có phạm vi file rõ và hợp đồng đã chốt;
  ưu tiên service/component/fixture khi có thể chạy bên cạnh công việc của agent chính.
- **Sub-agent kiểm tra:** rà spec/quyền/read-only hoặc viết test trong file được giao
  riêng. Không sửa cùng file với người đang triển khai; phát hiện phải có đường tái hiện.
- Thường tối đa **hai sub-agent đồng thời**; chỉ chạy song song khi có công việc
  độc lập hữu ích. WS1/WS2 có thể chỉ một worker + agent chính vì phụ thuộc bảo mật.
- Mỗi sub-agent dùng đúng `gpt-5.6-luna` + `xhigh`. Khi gọi spawn phải dùng fork
  `none` hoặc số lượt hữu hạn để model/effort override được áp dụng; prompt đính kèm
  đường dẫn worktree, spec, task, contracts, phạm vi file, test và tiêu chí hoàn thành.
- Nếu model không khả dụng, agent chính tiếp tục phần việc và báo rõ; không tự đổi
  sub-agent sang model khác. Không nhờ sub-agent sinh thêm agent.
- Sub-agent không apply migration, cấp quyền pilot, thay gate, gửi thông báo, commit,
  reset/checkout branch hoặc sửa dữ liệu Cloud. SQL candidate chỉ được tạo trong
  file đã giao; agent chính chịu trách nhiệm kiểm thử Cloud và bước ghi dữ liệu.
- Mọi agent dùng worktree Vioo Work được chỉ định và tôn trọng thay đổi đang có;
  agent chính phân công không chồng file và kiểm diff trước khi tích hợp.
- Kết quả sub-agent chỉ là đầu vào review. Agent chính kiểm code, chạy kiểm chứng
  liên quan, kiểm regression và xác nhận tiêu chí task trước khi đánh dấu hoàn thành.

Chỉ dẫn này thay thế các câu “main agent only” trước đây trong phạm vi WS1–WS8;
không thay đổi AGENTS.md chung của repository hoặc các dự án khác. Việc ghi cách
phối hợp vào kế hoạch chưa khởi chạy triển khai WS1.

## Hợp đồng xuyên suốt

### Mô hình dữ liệu và chuyển scope

- `public.work_workspaces`: uuid ID, `kind` department/project/collaboration,
  `department_id` uuid hoặc `project_id` text theo kind, `name` 2–160 ký tự,
  `description` tối đa 2000, `icon_key`/`color_key`/`cover_key` từ allowlist asset,
  `status` active/archived, `access_mode` legacy/workspace, `lock_version`, creator/timestamps.
  Unique nguồn liên kết kể cả archived. Liên kết nguồn bất biến, không hard delete.
- `public.work_workspace_members`: unique(workspace_id,user_id), role admin/member,
  status active/removed, starts_at/expires_at, added_by, origin manual/organization/project,
  source_reference, lock_version/timestamps. Mọi thay đổi có event trước/sau.
- `public.work_workspace_preferences`: unique(user_id,workspace_id), pinned,
  last_opened_at; chính user được ghi qua RPC kiểm membership, không chứa quyền.
- `app_private.work_workspace_events`: append-only actor, workspace, kind,
  before/after, reason, idempotency key, timestamp. Private RLS và reader được guard.
- Thêm `workspace_id` vào tasks/groups/calendars/policies; global calendar/policy và
  direct tasks giữ null. Group/task/config cùng không gian; foreign key và server
  validation ngăn trộn scope. Scope vật lý department/project được giữ cho dữ liệu
  cũ; collaboration dùng scope_type='workspace', department/project null.
- Client mới gửi `{type:'workspace',workspaceId}` cho cả ba loại. Server giải ra
  scope vật lý từ Workspace; client không được quyết định department/project của nó.
  Client cũ gửi department/project: resolve đúng Workspace duy nhất rồi chạy cùng
  membership guard khi access_mode=workspace. Không có nhánh cũ để vượt quyền.
- Scope quyền canonical dùng `work_workspace` + workspace UUID, khác org department
  và project. Mở rộng type/catalog/constraint/resolver có giới hạn namespace Work;
  không làm scope mới cấp quyền HRM, project finance, Gantt hoặc procurement.

```ts
// Create: lib/work/workWorkspaceTypes.ts
export type WorkspaceKind = 'department' | 'project' | 'collaboration';
export type WorkspaceRole = 'admin' | 'member';
export type WorkspaceTaskScope = {type:'workspace'; workspaceId:string};
export type WorkspaceCursor = {sortAt:string; id:string};
export interface WorkspaceCapabilities {
  canView:boolean; canCreateTask:boolean; canManageMembers:boolean;
  canConfigure:boolean; canArchive:boolean;
}
export interface WorkspaceSummary {
  id:string; name:string; kind:WorkspaceKind; status:'active'|'archived';
  sourceName:string|null; iconKey:string; colorKey:string; coverKey:string;
  pinned:boolean; memberCount:number; visibleOpenTaskCount:number;
  myActionCount:number; capabilities:WorkspaceCapabilities; lockVersion:number;
}
export interface WorkspacePage<T> {items:T[]; nextCursor:WorkspaceCursor|null}
export interface WorkspaceMember {
  userId:string; name:string; avatarUrl:string|null; role:WorkspaceRole;
  origin:'manual'|'organization'|'project'; expiresAt:string|null; lockVersion:number;
}
export interface MembershipChange {
  operation:'add'|'remove'|'set_role'; userId:string; role?:WorkspaceRole;
  expiresAt?:string|null;
}
export interface MembershipPreview {
  fingerprint:string; changes:MembershipChange[];
  blockers:Array<{userId:string;code:string;openAssignmentCount:number;openReviewCount:number}>;
}
```

Public entry RPC security invoker, private implementation definer search_path='',
revoked from anon/PUBLIC. Danh sách server 1..50, client 24 Workspace/30 người,
keyset cursor, search tối đa 100 ký tự; mutation batch tối đa 100 người, all-or-nothing.
Các list khi đổi scope/search/actor hủy hoặc fence response cũ. RPC kiểm user active,
server capability và version; không tin actorId/role/permissions từ request.

### Quyền và vòng đời

Nguồn canonical `WORKSPACE_MEMBER` phát capability theo role và thời gian hiệu lực.
Snapshot lẫn `app_private.resolve_effective_permission_sources` phải cho cùng kết quả.
Member có task.create/view_scope/view_related/assign_user/review/audit_view trong
workspace; review và lifecycle tiếp tục bị chặn bởi assignment/reviewer/state.
Admin thêm task.manage_scope/configure và workspace.manage_members/archive.
Không tự cấp view_restricted hoặc assign_group chưa nằm trong luồng quản trị này.

`work.workspace.create` global cho tạo collaboration; department/project scope
cho tạo Workspace liên kết đúng nguồn. `work.workspace.recover` global là quyền
khôi phục quản trị được cấp riêng qua vận hành và ghi audit, không cấp ngầm pilot.
Nguồn membership có thể phát `work.module.access` global cho người đang tham gia;
route/capability nội dung vẫn phải kiểm workspace cụ thể. Global business grants
cũ không vượt điều kiện membership; chỉ recovery command được khôi phục quản trị,
không được đọc task qua recovery capability. Bộ tạo nguồn membership chỉ đọc account/membership
active và role mapping; không gọi lại has_permission để tránh vòng đệ quy resolver.

Archive: task và config readonly, lịch sử/file vẫn guard bằng quyền đọc; active
assignment giữ nguyên nhưng không nhận việc mới. UI yêu cầu xử lý công việc mở
trước khi archive. Guard server cũng kiểm, không chỉ ẩn nút. Các replay đã hoàn
thành chỉ trả kết quả cũ cho actor còn quyền thích hợp, không thực thi lại mutation.

Remove member: preview chặn khi còn assignment/reviewer mở hoặc là admin cuối;
gợi ý chuyển việc bằng lifecycle command hiện có trước khi thử lại. Disabled user
bị chặn ngay bất kể các điều kiện bàn giao. Không cho expiry do client đặt ở quá
khứ; người thêm thành viên không cấp thời hạn vượt quyền quản trị của mình.

## WS1 — Workspace foundation và contracts

**Files:** create `lib/work/workWorkspaceTypes.ts`,
`lib/__tests__/workWorkspaceContracts.test.ts`, `supabase/tests/work_workspace_foundation_smoke.sql`;
CLI migration name `work_workspace_foundation`; update `supabase/baseline/current.json`.
Read `lib/work/workTypes.ts`, core schema migration `20260907021001_work_r1a_core_schema.sql`.

**Consumes:** org_units UUID, projects text ID, users UUID; R1A task/config tables.
**Produces:** bảng và contracts ở trên; chưa cấp quyền người dùng hoặc đổi task access.

- [x] Ghi fixture rollback với hai phòng, hai dự án, Workspace cộng tác và liên kết
  trùng. Chứng minh insert sai shape/trùng nguồn bị chặn; archived không giải phóng
  unique nguồn. Chứng minh browser không thể trực tiếp insert/update membership.
- [x] Chạy fixture trước schema, xác nhận fail vì bảng chưa tồn tại.
- [x] Tạo migration bằng CLI, thêm bảng, FK indexes, unique indexes và private audit.
  Browser table access deny-by-default; chưa mở generic table SELECT cho membership.
- [x] Thêm types và test phân biệt direct/workspace/legacy scope, không chấp nhận
  workspaceId kèm departmentId do client gửi. Không đổi input type cũ ở task này.
- [x] Chạy rollback smoke qua `scripts/run-supabase-cloud-transaction.mjs`, baseline
  checker, TypeScript; commit candidate với explicit paths. Apply foundation theo
  checkpoint chung nếu smoke/advisors đạt; access_mode vẫn legacy cho dữ liệu cũ.

SQL invariant mẫu phải được hiện thực trong migration:
```sql
check ((kind='department' and department_id is not null and project_id is null)
 or (kind='project' and project_id is not null and department_id is null)
 or (kind='collaboration' and department_id is null and project_id is null));
create unique index work_workspace_department_unique
 on public.work_workspaces(department_id) where department_id is not null;
```

**Nghiệm thu:** không thay đổi dữ liệu nghiệp vụ/visibility R1A; unique và RLS có
bằng chứng Cloud. Commit đề xuất `feat(work): add workspace foundation`.

## WS2 — Workspace commands, membership và canonical permissions

**Files:** create `lib/work/workWorkspaceService.ts`,
`lib/__tests__/workWorkspacePermission.test.ts`, `lib/__tests__/workWorkspaceService.test.ts`,
`supabase/tests/work_workspace_membership_smoke.sql`;
modify `types.ts`, `lib/permissions/permissionTypes.ts`,
`lib/permissions/permissionRegistry.ts`, `lib/permissions/authorizationEvaluator.ts`;
CLI migration `work_workspace_membership` và baseline allowlist.

**Consumes:** WS1 types/tables; canonical source resolver và authorization snapshot.
**Produces:** guarded public RPC và `createWorkWorkspaceService(client)` methods:
```ts
// Service contracts; all mutation keys generated once and retained on unknown result.
create(input:{kind:WorkspaceKind; name:string; departmentId?:string; projectId?:string;
 iconKey:string; colorKey:string; coverKey:string}, key:string): Promise<WorkspaceSummary>;
list(search:string, kind:WorkspaceKind|null, cursor:WorkspaceCursor|null,
 pinnedOnly:boolean|null, sort:'updated'|'recent'): Promise<WorkspacePage<WorkspaceSummary>>;
get(workspaceId:string): Promise<WorkspaceSummary>;
members(workspaceId:string, search:string, cursor:WorkspaceCursor|null): Promise<WorkspacePage<WorkspaceMember>>;
previewMembers(workspaceId:string, changes:MembershipChange[]): Promise<MembershipPreview>;
applyMembers(workspaceId:string, preview:MembershipPreview, expectedVersion:number,
 reason:string, key:string): Promise<{lockVersion:number}>;
```
RPC names tương ứng: `create_work_workspace`, `list_my_work_workspaces`,
`get_work_workspace`, `list_work_workspace_members`, `preview_work_workspace_members`,
`apply_work_workspace_members`. Rename/appearance/archive dùng
`command_work_workspace(p_workspace_id,p_command,p_payload,p_expected_version,p_reason,p_key)`;
command allowlist `update_profile|archive|restore`; reader nguồn tạo
`list_work_workspace_sources(p_kind,p_search,p_cursor,p_limit)` chỉ trả ID/name/kind
của org/project đang active mà actor có workspace.create đúng scope và quyền xem
nguồn; thêm `existingWorkspaceId` chỉ khi actor được phép thấy Workspace đó.
Không cho create linked nguồn chỉ biết UUID nhưng không có quyền dùng nguồn.
`list_my_work_workspaces` nhận p_pinned_only nullable và p_sort updated/recent;
updated sort theo (updated_at,id), recent theo (last_opened_at,id), giảm dần;
cursor cùng sort, đổi filter/sort phải reset. Pin section đọc riêng, không suy danh
sách đã ghim từ trang đầu của toàn bộ Workspace. Recovery RPC riêng
`recover_work_workspace_admin(p_workspace_id,p_user_id,p_reason,p_key)`.

- [x] Viết permission tests trước: HRM member không phải Workspace member, legacy
  ADMIN, global Work grant ngoài membership, expired/disabled member đều không vào
  task Workspace; admin A không sửa B; member không đổi role của chính mình.
- [x] Thêm nguồn membership vào central resolver/snapshot, scope work_workspace vào
  types/catalog và đúng các constraint cần thiết. So sánh parity JS/SQL cho mỗi role.
  Giữ nguyên mọi nhánh non-Work; test permission regression cả HRM và project.
- [x] Implement create atomically tạo Workspace + admin đầu tiên + audit, validate
  nguồn đang hoạt động và actor được phép dùng nguồn; rollback toàn bộ khi có lỗi.
- [x] Implement member preview/apply: lock Workspace, kiểm version/fingerprint,
  user active, expiry, admin cuối và nhiệm vụ đang mở. Không update/delete users,
  employees, project_staff hoặc grants của module khác.
- [x] Implement list/get/member readers, role-derived capabilities, counts ban đầu
  chỉ trả dữ liệu được guard; WS4 hoàn thiện task counts. Audit read bounded cùng guard.
- [ ] Test concurrent demote/remove admin, replay key, response lost, key reused với
  payload khác; khôi phục admin chỉ đúng recovery capability. Verify SQL và commit.

Test lõi:
```ts
expect(evaluateCapability(snapshot, 'work.task.create',
 {scopeType:'work_workspace',scopeId:workspaceA}).allowed).toBe(true);
expect(evaluateCapability(snapshot, 'work.task.create',
 {scopeType:'work_workspace',scopeId:workspaceB}).allowed).toBe(false);
```
Trong fixture, `snapshot` là nguồn WORKSPACE_MEMBER active của A; IDs được tạo trong
fixture. Ngoài evaluator, server task guard bắt buộc membership; không dùng test
scope matcher để thay thế kiểm chứng đường truy cập thực tế.

**Nghiệm thu:** thêm/bớt/đổi vai trò được audit và không sinh direct-grant pool.
Commit `feat(work): add workspace membership and canonical capabilities`.


WS2 verification note: replay/version/batch guards pass Cloud rollback; actual
simultaneous-client race coverage remains for WS8. Task-resource negatives listed
in the first item are implemented at the WS4 guard checkpoint.

## WS3 — Gợi ý nhân sự và đối chiếu nguồn

**Files:** create `lib/work/workWorkspacePeopleService.ts`,
`lib/__tests__/workWorkspacePeopleService.test.ts`,
`supabase/tests/work_workspace_people_smoke.sql`;
read `lib/hrmSharedCatalogModel.ts`, `lib/hrmSharedCatalogService.ts`,
`lib/projectStaffService.ts`, `pages/hrm/Employees.tsx`;
CLI migration `work_workspace_people` và baseline allowlist.

**Consumes:** membership guard/preview WS2; quan hệ phân công nhân sự có hiệu lực.
**Produces:** RPC `list_work_workspace_people(p_workspace_id,p_source,p_search,p_cursor,p_limit)`
với source organization/project/directory; trả userId nullable, employeeId nullable,
name/avatar/position/sourceLabel, eligibility, alreadyMember và nextCursor.
`preview_work_workspace_source_diff(p_workspace_id,p_cursor,p_limit)` trả trang
diff 1..50 cùng fingerprint nguồn; chỉ đề xuất, không tải toàn bộ công ty. Sau khi
chọn tối đa 100 thay đổi, WS2 tính fingerprint trên đúng tập đã chọn và nguồn hiện
hành. Mọi apply
vẫn đi qua WS2 và chỉ nhận thay đổi đã chọn, không cập nhật tự động.

- [x] Fixture: kiêm nhiệm, điều chuyển có ngày hiệu lực, kết thúc phân công dự án,
  chưa có tài khoản, tài khoản khóa, member đã có và người được mời thủ công liên phòng.
- [x] Xác nhận hàm SQL phân giải phân công hiện hành từ Cloud/local migration mới nhất;
  tái dùng hoặc tách projection tối thiểu cùng semantics HRM; không copy phép lọc
  employees.department_id vốn có thể khác nguồn tổ chức authoritative.
- [x] Implement bounded projections có quyền quản trị Workspace và chỉ các trường
  cần mời cộng tác; gợi ý project dùng phân công project, không quyền tài chính.
- [x] Implement dedupe theo user ID; khi chưa có tài khoản giữ employee row disabled.
  Preview selection tối đa 100 và fingerprint cả eligibility + effective source.
- [x] Diff chỉ đề xuất remove cho thành viên gắn nguồn tương ứng, giữ manual members;
  source change trong lúc preview phải báo `WORK_MEMBERSHIP_PREVIEW_STALE`.
- [x] Verify unauthorized source enumeration denied; tham số search không mở danh
  bạ HRM toàn bộ; limit/keyset/max batch được kiểm trên Cloud rồi commit.

Test ví dụ:
```ts
// Fixture có hai vị trí đang hiệu lực cùng user và một employee chưa có account.
expect(page.items.filter(p => p.userId === sonId)).toHaveLength(1);
expect(page.items.find(p => p.employeeId === noAccountEmployeeId)?.eligibility)
 .toBe('NO_APP_ACCOUNT');
```
**Nghiệm thu:** chọn nhanh đúng người mà không sửa HRM hoặc âm thầm đồng bộ membership.
Commit `feat(work): suggest workspace members from organization sources`.

## WS4 — Task access và command theo Workspace

**Files:** modify `lib/work/workTypes.ts`, `lib/work/workTaskService.ts`,
`lib/work/workForm.ts`, `lib/work/workRealtime.ts`, `hooks/work/useWorkTasks.ts`;
create `lib/__tests__/workWorkspaceTaskAccess.test.ts`,
`supabase/tests/work_workspace_tasks_smoke.sql`;
read applied Work task/lifecycle/collaboration/detail/attachment/notification migrations;
CLI migration `work_workspace_task_access` và baseline allowlist.

**Consumes:** WS1 scope bridge, WS2 canonical membership, task lifecycle R1A.
**Produces:** union WorkScope thêm WorkspaceTaskScope; task projections có workspace_id;
existing public task APIs nhận workspace scope và chuẩn hóa legacy input bằng cùng guard.
`list_work_workspace_tasks(p_workspace_id,p_filters,p_cursor,p_limit)` dùng projection
WorkTaskSummary, trả WorkspacePage<WorkTaskSummary>; chỉ visible tasks được đếm.

- [x] Viết Cloud negative fixtures trước cho task read/direct REST/RPC, comments,
  history, checklist, clone, recipient preview, transfer, watcher/reviewer, search,
  dashboard counts, attachment list/sign/upload/finalize/delete và notification links.
- [x] Thêm helper `app_private.work_resolve_workspace_scope(p_scope jsonb)`; reject
  workspace thiếu/archived khi mutate và scope mismatch; legacy scope mapped vẫn
  kiểm cùng membership. Hàm quyền task kiểm membership trước relationship/global grant.
- [x] Task standard trong Workspace: member được list/detail; restricted giữ predicate
  quan hệ cũ + membership. Reviewer/member không được tự duyệt việc không giao cho mình.
  Recipient/watchers/reviewer phải là member hợp lệ; group expansion cũng lọc member.
- [x] Update create/clone/lifecycle/collaboration readers/commands và query filters;
  task scope liên kết immutable ở phiên này. Clone ra không gian khác phải xem lại
  recipient preview, bucket và SLA; không chuyển task cũ bằng update scope tùy tiện.
- [x] Thêm member-removal invalidation: xóa cache/ảnh/link riêng, refresh snapshot,
  fence request đang bay; mọi RPC vẫn kiểm server khi client giữ snapshot cũ.
- [x] Workers kiểm membership ở lúc xử lý và mở liên kết; không gửi payload riêng
  cho người đã rời Workspace. Không bật delivery để thử; dùng rollback/outbox fixture.
- [x] Chạy Task3–9 smokes trên candidate và permission tests non-Work; commit khi
  mọi đường dẫn phụ được chứng minh không vượt guard. Giữ rollout access_mode theo scope.

SQL test tình huống phải có:
```sql
-- authenticated outsider với global work.task.view_scope nhưng không membership:
-- get_work_task(task_code) và sign attachment đều phải bị từ chối.
-- member thấy standard; member không liên quan không thấy restricted trong list/count.
-- former assignee đã bị remove không dùng URL cũ để vượt Workspace guard.
```
**Nghiệm thu:** sự cô lập nằm ở server, cả RPC cũ lẫn mới. Commit
`feat(work): enforce workspace membership across task access`.

## WS5 — Nhóm việc, lịch/SLA và công cụ chuyển đổi

**Files:** modify `lib/work/workConfigurationService.ts`,
`lib/work/workConfigurationAccess.ts`, `lib/work/workPresentation.ts`;
create `supabase/tests/work_workspace_configuration_smoke.sql`,
`supabase/operations/work_workspace_pilot_backfill.sql`,
`lib/__tests__/workWorkspaceConfiguration.test.ts`;
CLI migration `work_workspace_configuration` và baseline allowlist.

**Consumes:** Task10 config API + WS1/WS4 workspace_id; manifest pilot đã xác minh.
**Produces:** ConfigScope thêm workspace; config API cũ normalize cùng scope bridge;
script backfill mặc định rollback, có fingerprint inventory và đối chiếu trước/sau.

- [x] Snapshot task ID/code/deadline, assignment toàn dòng, calendar/policy/group ID,
  outbox và attachment links của pilot trước khi chuyển. Kiểm tra lại dữ liệu hiện
  tại; không dùng giả định task count 0 từ 2026-09-07.
- [x] Map department/project config sang Workspace; calendar global dùng chung vẫn
  chỉ global configurator sửa. Collaboration có calendar/policy/group riêng.
- [x] Implement group selector (30/50 items, đúng Workspace, inactive không chọn mới),
  policy overlap cùng Workspace+priority, lịch ngoại lệ và server SLA preview.
- [x] Backfill pilot đúng một Workspace, hai member từ manifest, giữ expiry chính
  xác và admin/member tương ứng. Gắn các task/config thuộc scope, không đổi assignment
  SLA snapshots. Không tạo membership cho toàn bộ org hoặc từ global grants.
- [x] Inventory scope khác nếu có: lập danh sách mapping và ai sẽ xem standard tasks;
  scope chưa có mapping duyệt được thì giữ legacy mode, không tự chuyển toàn Cloud.
- [x] Test trước/sau so sánh hashes trường nghiệp vụ; test direct task vẫn null
  workspace, giữ private attachments và lịch sử; script gọi hai lần không tạo trùng.
- [x] Commit migration/tooling; không chạy commit mode của backfill trước WS8.

SQL verification cần dùng trong operation:
```sql
-- temp table captures full assignment rows before backfill, excluding no columns.
if exists(select value from workspace_assignment_before
 except select to_jsonb(a) from public.work_task_assignments a) then
 raise exception 'WORK_WORKSPACE_ASSIGNMENT_CHANGED';
end if;
```
**Nghiệm thu:** cấu hình Workspace dùng lại Task10; pilot có phương án di chuyển
kiểm chứng được. Commit `feat(work): bridge workspace configuration and pilot data`.

## WS6 — Dashboard cá nhân dạng menu Workspace

**Files:** create `pages/work/WorkHome.tsx`, `pages/work/WorkWorkspaceCard.tsx`,
`pages/work/workspace.css`, `hooks/work/useWorkWorkspaces.ts`,
`tests/work/workspace-fixture.html`, `tests/work/workspace-fixture.tsx`,
`scripts/verify-work-workspace-browser.mjs`;
modify `App.tsx`, `components/Sidebar.tsx`, `lib/routeAccess.ts`,
`lib/permissions/permissionRegistry.ts`; create `lib/__tests__/workWorkspaceRoutes.test.ts`.

**Consumes:** WS2 WorkspaceSummary/list, WS4 counts/permissions, services injected ở fixture.
**Produces:** `/work` dashboard; `/work/my` giữ danh sách cá nhân hiện có;
route `/work/spaces/:workspaceId` nối WS7. Preference RPC
`set_work_workspace_preference(p_workspace_id,p_pinned,p_opened)` ghi đúng user hiện tại.

- [x] Viết fixture route/member/empty/loading/error/expired và sidebar parity trước.
  Khách chưa đăng nhập đi login; user ngoài membership không có thẻ Workspace đó.
- [x] Tạo layout: header chào người dùng, tác vụ cá nhân, hàng Việc cần tôi xử lý,
  tìm/lọc không gian, thẻ ghim và danh sách có phân trang. Chỉ số từ server, không
  tải toàn bộ tasks/nhân viên để đếm. Không làm bảng xếp hạng task count.
- [x] Thẻ 1 cột mobile, 2 tablet, 3 desktop; cover preset SVG/local asset, icon, màu,
  avatar stack tối đa 4 người + số còn lại, name/source label, visible counts.
  Focus rõ, nút pin tách link, keyboard hoạt động; reduced-motion tắt animation.
- [x] Preset có chủ đích: phòng ban dùng hình gợi hoạt động văn phòng, dự án dùng
  kiến trúc/công trường, cộng tác dùng minh họa nhóm; không chỉ đổi màu thẻ giống nhau.
  Giữ chữ/contrast rõ, thông tin thực tế ưu tiên hơn trang trí, không ảnh remote theo dõi.
- [x] Nút tạo trực tiếp/cá nhân kiểm quyền và calendar readiness; mở drawer hiện có,
  không giả lập một scope để vượt quyền pilot chỉ được cấp theo phòng ban.
- [x] Test stale response khi search/filter/actor thay đổi, refresh permission sau
  remove, pin persistence, load-more không trùng và không lộ restricted counters.
- [x] Chạy browser fixture 360x800/768x1024/1440x900, chụp và xem ảnh, keyboard,
  touch, empty/error/retry; commit UI còn sau gate đến WS8.

Browser acceptance mẫu:
```js
await page.getByRole('link', {name:/Phòng Quản lý dự án/}).click();
await page.getByRole('heading', {name:'Phòng Quản lý dự án', exact:true}).waitFor();
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
```
**Nghiệm thu:** dashboard sống động như menu, nhận ra không gian nhanh, không ảnh
hưởng trang cá nhân cũ. Commit `feat(work): add visual workspace home`.

## WS7 — Làm việc và quản trị ngay trong Workspace

**Files:** create `pages/work/WorkSpacePage.tsx`, `pages/work/WorkSpaceCreate.tsx`,
`pages/work/WorkSpaceMembers.tsx`, `pages/work/WorkSpaceMemberPicker.tsx`,
`pages/work/WorkSpaceSettings.tsx`;
modify `pages/work/WorkPage.tsx`, `pages/work/WorkCreateDrawer.tsx`,
`pages/work/WorkSettings.tsx`, `pages/work/WorkConfigurationForm.tsx`,
`pages/work/WorkDetail.tsx`, `lib/work/workMutation.ts`, browser fixture/script WS6.

**Consumes:** WS2 create/member commands, WS3 suggestions/diff, WS4 tasks, WS5 config.
**Produces:** `/work/spaces/new`, `/work/spaces/:workspaceId`,
`/work/spaces/:workspaceId/members`, `/work/spaces/:workspaceId/settings`.
Global config còn ở `/work/settings` cho người có quyền global; scoped settings
được mở từ Workspace, không bắt user tìm lại phòng ban trong một danh sách chung.

- [ ] Fixture user journey: tạo linked/collaboration → chọn admin đầu tiên → thêm
  member từ nguồn → cấu hình lịch → tạo task → nhận/xử lý/review → kiểm tra history.
- [ ] Wizard chọn loại, nguồn hợp lệ theo quyền, name/cover; nguồn đã có Workspace
  cho mở Workspace đó, không tạo bản trùng. Sau create vào không gian đang trống.
- [ ] Workspace header có nguồn, avatar và vai trò; tab Công việc / Thành viên /
  Cấu hình; admin controls chỉ cho admin, member thấy roster tối thiểu. archived
  hiện trạng thái readonly. UI không tự kiểm quyền bằng role text thay server caps.
- [ ] Danh sách Workspace khác “việc của tôi”: dùng endpoint WS4 cho toàn bộ standard
  tasks nhìn được. Drawer tạo tự giữ workspaceId, bucket và picker cùng phạm vi;
  task detail giữ breadcrumb/quay lại bộ lọc/scroll đúng Workspace và URL task cũ.
- [ ] Member picker gợi ý ưu tiên nguồn, tìm liên phòng, disabled reasons, select-page
  và preview batch rõ ràng; áp dụng một lần có version/fingerprint/reason/key.
  Review dialog không cho đóng tạo yêu cầu mới khi kết quả cũ chưa xác định.
- [ ] Membership change có màn xem trước quyền/trách nhiệm đang mở; admin cuối,
  nhiệm vụ cần bàn giao và preview stale hiển thị hướng xử lý cụ thể. Đối chiếu
  nguồn giữ manual members, không âm thầm áp dụng remove.
- [ ] Tái dùng editor nhóm việc/lịch/SLA; kiểm lost response, reload đúng record,
  actor-scoped draft và cache invalidation của Task10 trong ngữ cảnh Workspace.
- [ ] Test thật qua browser fixture; soát mọi task detail/attachment/nav regression,
  commit sau TypeScript và test liên quan đạt.

Browser acceptance mẫu:
```js
await page.getByRole('button',{name:'Thêm thành viên',exact:true}).click();
await page.getByLabel('Tìm nhân viên').fill('Sơn');
await page.getByRole('checkbox',{name:/Phạm Ngọc Sơn/}).check();
await page.getByRole('button',{name:'Xem trước thay đổi'}).click();
await page.getByRole('button',{name:'Áp dụng thay đổi'}).click();
// Fixture count: one apply call; network retry must preserve the identical key/payload.
```
**Nghiệm thu:** người dùng vận hành không gian và thành viên bằng UI thật, không
phải nhờ SQL thủ công như pilot cũ. Commit `feat(work): manage tasks and members in workspaces`.

## WS8 — Cutover pilot, kiểm thử và nghiệm thu dev

**Files:** update `docs/runbooks/vioo-work-r1a-rollout.md`,
`docs/runbooks/vioo-work-r1a-pilot.json`, backfill operation WS5;
create `supabase/tests/work_workspace_pilot_acceptance.sql` và
`docs/runbooks/vioo-work-workspace-acceptance.md` (checklist nghiệm thu, không handoff).

**Consumes:** WS1–7 đã có candidate và Cloud smokes. Giữ production UI và notification
activation riêng; không suy rằng user yêu cầu publish từ việc đồng ý kế hoạch này.
**Produces:** Workspace dev thực tế cho hai tài khoản hiện tại, hồ sơ kiểm chứng đầy đủ.

- [ ] Đọc lại inventory pilot: members/grants/calendar/task counts và nguồn đang
  hoạt động. So sánh fingerprint bản rehearsal; khác biệt buộc rehearsal lại.
- [ ] Chạy backfill mặc định rollback cùng acceptance: members đúng 2 người,
  admin/member đúng vai trò, calendar giữ split shifts, SLA/attachments/task code
  bất biến. Dùng auth_id thực khi mô phỏng persona SQL, kiểm `IS DISTINCT FROM`
  thay vì `<>` để không lọt principal null; không gọi đó là browser login thật.
- [ ] Candidate commit explicit paths; dry-run/apply từng migration còn lại đúng
  allowlist. Tạm ngừng ghi đúng pilot scope trong giao dịch chuyển access_mode,
  giữ scope khác hoạt động. Backfill + membership + mode switch phải atomic.
- [ ] Bootstrap quyền tạo Workspace cho đúng tài khoản admin pilot bằng canonical
  `work.workspace.create` global có cùng hạn 21/09, ghi riêng trong manifest/audit.
  Quyền này cho tạo collaboration và linked nguồn actor được phép xem; không cấp
  quyền đọc các Workspace hiện hữu. Sơn không có quyền tạo Workspace ở pilot đầu.
  Không bootstrap recovery global hoặc view_restricted.
- [ ] Retire đúng các direct Work scope grants do pilot cũ tạo sau khi membership
  parity đạt; lưu danh sách IDs/expiry và before/after audit, không xóa grant khác.
  Giữ hoặc thay thế module access có chủ đích; không tự gia hạn mốc 21/09.
- [ ] Chạy postflight server và toàn bộ tests; kiểm security advisor, query inventory,
  migration ledgers. Nếu fail, giữ UI gate tắt và quyền fail-closed. Không bật lại
  bypass legacy scope như một cách rollback quyền sau khi đã chuyển membership.
- [ ] Bật Workspace dashboard chỉ trên dev hiện có; kiểm HTTP, route flag và login.
  Người dùng đăng nhập thật để nghiệm thu admin/member; không giả lập JWT trong
  browser hoặc tự tạo task gửi thông báo cho người thật.
- [ ] Nghiệm thu UI: admin tạo/quản trị Workspace; Sơn thấy đúng phòng đã tham gia;
  thêm người có gợi ý tổ chức; người ngoài không thấy; direct work đúng capability;
  task standard/restricted, lịch, quay lại danh sách và mobile đều đúng.
- [ ] Cập nhật rollout bằng kết quả thật, task còn thiếu và grant expiry; chưa đánh
  dấu quan sát 48 giờ hoàn thành khi chưa chạy. Không tạo handoff hay dừng dev ngoài ý người dùng.

Commands kiểm chứng (load root `.env` âm thầm cho CLI Cloud):
```bash
npm run lint
npm test
npm run build
npm run check:supabase-migrations
npm run audit:supabase-queries
node scripts/verify-work-workspace-browser.mjs
node scripts/verify-work-task8-browser.mjs
node scripts/verify-work-task9-browser.mjs
node scripts/verify-work-task10-browser.mjs
npx --no-install supabase migration list --linked
npx --no-install supabase db advisors --linked --type security --level error --fail-on error
```
Khi thay endpoint/route, cập nhật fixture regression theo hợp đồng mới nhưng giữ các
assert bảo mật, idempotency, SLA, file và scroll. SQL smoke qua linked CLI, mỗi bộ
rollback riêng; không chạy fixture R1A cũ có giả định toàn Cloud rỗng sau pilot.

**Nghiệm thu:** user xem và thao tác được sản phẩm trên dev; schema/quyền/dữ liệu có
bằng chứng. Commit `chore(work): verify workspace pilot cutover`.

## Coverage và điểm kiểm soát

| Yêu cầu đã chốt | Task |
| --- | --- |
| Workspace linked + cộng tác, một nguồn chính thức | WS1, WS2, WS5 |
| Thành viên/quản trị riêng, quyền không lan module khác | WS2, WS4 |
| Gợi ý/chọn nhanh người trong sơ đồ tổ chức/dự án | WS3, WS7 |
| Nhân sự đổi nguồn không âm thầm đổi quyền/task | WS3, WS4, WS7 |
| Dashboard menu thẻ sống động, ghim, lọc và cá nhân hóa | WS6 |
| Xem/tạo hoạt động trong không gian mình tham gia | WS4, WS7 |
| Direct work vẫn riêng, quyền/lịch được kiểm tra | WS4, WS6, WS8 |
| Bucket/lịch/SLA, audit và dữ liệu R1A giữ nguyên | WS5, WS7, WS8 |
| Pilot đúng hai người, dev, Cloud và lịch đã chốt | WS5, WS8 |

Kế hoạch được self-review bằng agent chính. Các mặc định kỹ thuật (scope bridge,
role mapping, batch 100, preset covers, archive/removal guards) nằm trong tài liệu
để review; quyết định nghiệp vụ đã chốt không cần hỏi lại. Nếu phát hiện contract
HRM/permission khác thực tế, sửa thiết kế kỹ thuật và bằng chứng trước khi thay
schema, không âm thầm đổi ý nghĩa Workspace hay mở rộng quyền.

## Self-review trước khi giao kế hoạch

- [x] Đối chiếu các quyết định đã được người dùng đồng ý với bảng coverage WS1–WS8.
- [x] Tách thành viên Workspace khỏi quan hệ tổ chức và khỏi assignment công việc.
- [x] Kiểm tra hợp đồng nguồn tạo, danh bạ gợi ý, phân trang thẻ ghim/gần đây và diff.
- [x] Mọi nhánh legacy scope và tài nguyên con nằm trong kế hoạch chuyển quyền.
- [x] Ghi rõ pilot dev đang có dữ liệu có thể thay đổi; migration không được reset task.
- [x] Xác định các quyền bootstrap, expiry, bảo vệ admin cuối và recovery có audit.
- [x] Lịch 8 giờ/ngày, nghỉ trưa và Chủ nhật đã có kiểm chứng cần giữ lại.
- [x] Có bước nghiệm thu trực quan, keyboard/mobile và thao tác bằng tài khoản thật.
- [x] Không thay đổi ứng dụng/Cloud trong lần lập kế hoạch; không mở Task 11 quan sát.
