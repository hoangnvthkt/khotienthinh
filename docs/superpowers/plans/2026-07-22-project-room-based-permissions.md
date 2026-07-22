# Project Room-Based Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay ma trận quyền Dự án bằng các Room nghiệp vụ cố định, cho phép admin chỉnh quyền nhiều nhân viên trong một lần lưu và bảo đảm authorization/recipient filtering luôn dùng đúng cặp Room + action.

**Architecture:** Room definitions là registry cố định dùng chung giữa TypeScript và dữ liệu seed. Membership và action được lưu tách biệt; mọi kiểm tra đi qua RPC/RLS với `project_id + construction_site_id + room_code + action_code`; workflow vẫn yêu cầu assignment hiện tại. UI có Tab Phân quyền riêng gồm Card tổng quan và Drawer chỉnh batch, sau đó từng nghiệp vụ được cutover tuần tự khỏi quyền generic.

**Tech Stack:** React 18, TypeScript 5.8, Vite 6, Vitest 4, Supabase/PostgreSQL/RLS/RPC, Tailwind utility classes, lucide-react.

## Global Constraints

- Room là danh mục hệ thống cố định; UI không tạo, đổi mã hoặc xóa Room.
- Chỉ `ADMIN` đang hoạt động được thay đổi membership/action trong Room ở phase này.
- Quyền hiệu lực luôn là `(room_code, action_code)`; không suy diễn từ action generic toàn dự án.
- Room quyết định capability/candidate; assignment và trạng thái workflow vẫn quyết định ai được xử lý một hồ sơ cụ thể.
- Admin override không tự đưa admin vào recipient picker.
- Một người có thể thuộc nhiều Room và chỉ nhận action đã cấp tại từng Room.
- Lưu một Room là một transaction; lỗi một thành viên rollback toàn bộ và UI giữ draft.
- Gỡ membership/action bằng soft-deactivate, không hard-delete qua UI.
- Không thêm version check hoặc xử lý ghi đè đồng thời trong phase này.
- Không chạy `supabase db push --linked` khi lịch sử migration local/remote chưa được đối chiếu.
- Dùng TDD: viết test fail, triển khai tối thiểu, chạy pass, rồi commit riêng từng task.

## File Map

**Tạo mới:**

- `lib/permissions/projectPermissionRooms.ts`: registry, types và whitelist action.
- `lib/projectPermissionRoomService.ts`: frontend RPC adapter.
- `components/project/ProjectRoomSubmissionDialog.tsx`: recipient picker bắt buộc Room + action.
- `components/project/permissions/ProjectPermissionRoomCard.tsx`: Card Room.
- `components/project/permissions/ProjectPermissionRoomDrawer.tsx`: editor batch.
- `components/project/permissions/ProjectPermissionRoomsPanel.tsx`: orchestration UI.
- `pages/project/ProjectPermissionsTab.tsx`: entry point admin-only.
- `supabase/migrations/20260722090000_project_permission_rooms.sql`: schema/RLS/RPC/audit.
- `supabase/tests/project_permission_rooms_smoke.sql`: SQL smoke test.
- `scripts/audit-project-legacy-room-mapping.sql`: báo cáo mapping legacy read-only.
- Các test `lib/__tests__/projectPermissionRoom*.test.ts` ghi ở từng task.

**Sửa chính:**

- `types.ts`, `lib/projectTabPermissions.ts`, `lib/permissions/projectPermissionRegistry.ts`.
- `pages/ProjectDashboard.tsx`, `pages/project/ProjectOrgTab.tsx`.
- `components/project/ProjectSubmissionDialog.tsx`, `lib/projectStaffService.ts`.
- Các tab/service/RPC/RLS nghiệp vụ ghi ở Task 8–11.

---

### Task 1: Khóa registry Room và action bằng TypeScript

**Files:**
- Create: `lib/permissions/projectPermissionRooms.ts`
- Create: `lib/__tests__/projectPermissionRooms.test.ts`

**Interfaces:**
- Produces: `ProjectPermissionRoomCode`, `ProjectRoomActionCode`, `ProjectPermissionRoomDefinition`, `PROJECT_PERMISSION_ROOMS`, `getProjectPermissionRoom()`, `isRoomActionAllowed()`.
- Consumes: Không phụ thuộc database hoặc React.

- [ ] **Step 1: Viết unit test fail**

```ts
import { describe, expect, it } from 'vitest';
import { PROJECT_PERMISSION_ROOMS, getProjectPermissionRoom, isRoomActionAllowed } from '../permissions/projectPermissionRooms';

describe('projectPermissionRooms', () => {
  it('exposes 14 unique fixed rooms', () => {
    const codes = PROJECT_PERMISSION_ROOMS.map(room => room.code);
    expect(codes).toHaveLength(14);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(expect.arrayContaining([
      'daily_log', 'material_request', 'material_po', 'gantt',
      'weekly_progress', 'quantity_acceptance', 'payment',
      'boq_reconciliation', 'quality', 'safety', 'subcontract',
    ]));
  });

  it('does not leak an action between rooms', () => {
    expect(isRoomActionAllowed('daily_log', 'approve')).toBe(true);
    expect(isRoomActionAllowed('daily_log', 'confirm')).toBe(false);
    expect(isRoomActionAllowed('material_planning', 'view_available_stock')).toBe(false);
    expect(isRoomActionAllowed('material_request', 'view_available_stock')).toBe(true);
  });

  it('returns immutable definitions', () => {
    expect(getProjectPermissionRoom('material_po')?.name).toBe('Đơn hàng PO');
    expect(() => (PROJECT_PERMISSION_ROOMS as any).push({ code: 'custom' })).toThrow();
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm test -- lib/__tests__/projectPermissionRooms.test.ts`

Expected: FAIL vì module registry chưa tồn tại.

- [ ] **Step 3: Implement registry typed và immutable**

```ts
export const PROJECT_ROOM_ACTION_CODES = [
  'view', 'edit', 'delete', 'submit', 'verify',
  'confirm', 'approve', 'view_available_stock',
] as const;
export type ProjectRoomActionCode = typeof PROJECT_ROOM_ACTION_CODES[number];

export const PROJECT_PERMISSION_ROOM_CODES = [
  'daily_log', 'material_planning', 'material_request', 'material_po',
  'material_waste', 'custom_material', 'gantt', 'weekly_progress',
  'quantity_acceptance', 'payment', 'boq_reconciliation', 'quality',
  'safety', 'subcontract',
] as const;
export type ProjectPermissionRoomCode = typeof PROJECT_PERMISSION_ROOM_CODES[number];

export interface ProjectPermissionRoomDefinition {
  readonly code: ProjectPermissionRoomCode;
  readonly groupCode: 'daily_log' | 'material' | 'progress' | 'finance' | 'quality' | 'safety' | 'subcontract';
  readonly name: string;
  readonly description: string;
  readonly actions: readonly ProjectRoomActionCode[];
  readonly requiredActions: readonly ProjectRoomActionCode[];
  readonly sortOrder: number;
}
```

Khai báo đủ 14 Room và đúng whitelist trong đặc tả. `requiredActions` chỉ chứa action workflow bắt buộc có candidate và luôn là tập con của `actions`. Dùng `Object.freeze()` cho array ngoài, `actions` và `requiredActions`.

```text
daily_log: verify, approve
material_planning: none
material_request: approve, confirm
material_po: approve
material_waste: approve
custom_material: approve
gantt: verify, approve
weekly_progress: approve
quantity_acceptance: approve
payment: approve, confirm
boq_reconciliation: verify
quality: approve
safety: approve
subcontract: approve
```

- [ ] **Step 4: Chạy unit test và typecheck**

Run: `npm test -- lib/__tests__/projectPermissionRooms.test.ts && npm run lint`

Expected: PASS, không có TypeScript error.

- [ ] **Step 5: Commit**

```bash
git add lib/permissions/projectPermissionRooms.ts lib/__tests__/projectPermissionRooms.test.ts
git commit -m "feat(project): define fixed permission rooms"
```

---

### Task 2: Tạo schema, RLS và RPC Room

**Files:**
- Create: `supabase/migrations/20260722090000_project_permission_rooms.sql`
- Create: `supabase/tests/project_permission_rooms_smoke.sql`
- Create: `lib/__tests__/projectPermissionRoomMigrationContract.test.ts`

**Interfaces:**
- Consumes: schema `users`, `projects`, `project_staff`, `permission_audit_events`, `current_app_user_id()`.
- Produces: ba bảng Room; `project_user_has_room_action`, `list_project_permission_rooms`, `get_project_permission_room`, `list_project_room_staff_candidates`, `replace_project_permission_room_members`, `list_project_room_action_recipients`.

- [ ] **Step 1: Viết migration contract test fail**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260722090000_project_permission_rooms.sql'), 'utf8');

describe('project permission Room migration', () => {
  it('creates tables and RPCs', () => {
    expect(sql).toContain('create table if not exists public.project_permission_rooms');
    expect(sql).toContain('create table if not exists public.project_permission_room_members');
    expect(sql).toContain('create table if not exists public.project_permission_room_member_actions');
    for (const name of [
      'project_user_has_room_action', 'list_project_permission_rooms',
      'get_project_permission_room', 'list_project_room_staff_candidates',
      'replace_project_permission_room_members', 'list_project_room_action_recipients',
    ]) expect(sql).toContain(name);
  });

  it('blocks direct writes and audits admin batch changes', () => {
    expect(sql).toContain('revoke insert, update, delete');
    expect(sql).toContain("u.role = 'ADMIN'");
    expect(sql).toContain("'replace_project_permission_room_members'");
    expect(sql).toContain('permission_audit_events');
  });
});
```

- [ ] **Step 2: Chạy contract test để xác nhận fail**

Run: `npm test -- lib/__tests__/projectPermissionRoomMigrationContract.test.ts`

Expected: FAIL vì migration chưa tồn tại.

- [ ] **Step 3: Tạo ba bảng và seed 14 Room**

```sql
create table if not exists public.project_permission_rooms (
  code text primary key,
  group_code text not null,
  name text not null,
  description text not null default '',
  allowed_actions text[] not null,
  required_actions text[] not null default '{}'::text[],
  sort_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (allowed_actions <@ array['view','edit','delete','submit','verify','confirm','approve','view_available_stock']::text[]),
  check (required_actions <@ allowed_actions)
);

create table if not exists public.project_permission_room_members (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  construction_site_id text,
  room_code text not null references public.project_permission_rooms(code),
  project_staff_id uuid not null references public.project_staff(id) on delete cascade,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists project_permission_room_member_scope_uidx
  on public.project_permission_room_members (
    project_id, coalesce(construction_site_id, ''), room_code, project_staff_id
  );

create table if not exists public.project_permission_room_member_actions (
  room_member_id uuid not null references public.project_permission_room_members(id) on delete cascade,
  action_code text not null,
  is_active boolean not null default true,
  granted_by uuid references public.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_member_id, action_code),
  check (action_code = any(array['view','edit','delete','submit','verify','confirm','approve','view_available_stock']::text[]))
);
```

Thêm trigger validate `action_code = any(room.allowed_actions)`. Seed đúng 14 rows từ Task 1, gồm `required_actions` cho các bước mà thiếu người sẽ chặn submit.

- [ ] **Step 4: Implement authorization function**

```sql
create or replace function app_private.project_user_has_room_action(
  p_user_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_room_code text,
  p_action_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    join public.project_staff ps on ps.user_id = u.id::text
    join public.project_permission_room_members rm on rm.project_staff_id = ps.id
    join public.project_permission_room_member_actions ra on ra.room_member_id = rm.id
    join public.project_permission_rooms r on r.code = rm.room_code
    where u.id = p_user_id
      and coalesce(u.is_active, true)
      and ps.end_date is null
      and ps.project_id = p_project_id
      and rm.project_id = p_project_id
      and rm.room_code = p_room_code
      and coalesce(rm.is_active, false)
      and coalesce(ra.is_active, false)
      and coalesce(r.is_active, false)
      and ra.action_code = p_action_code
      and p_action_code = any(r.allowed_actions)
      and (rm.construction_site_id is null or rm.construction_site_id = p_construction_site_id)
  );
$$;
```

Public wrapper nhận `p_user_id uuid default current_app_user_id()`. Revoke execute từ `public, anon`, grant `authenticated`.

- [ ] **Step 5: Implement read RPC và atomic replace RPC**

`replace_project_permission_room_members(project, site, room, members_json)` phải:

```sql
if not exists (
  select 1 from public.users u
  where u.id = public.current_app_user_id()
    and coalesce(u.is_active, true)
    and u.role = 'ADMIN'
) then
  raise exception using errcode = '42501', message = 'Chỉ admin hệ thống được sửa Room phân quyền.';
end if;
```

Sau đó validate toàn payload trước khi ghi, upsert membership/action, soft-deactivate row bị gỡ, và ghi một audit event:

```sql
event_type = 'replace_project_permission_room_members'
metadata = jsonb_build_object(
  'project_id', p_project_id,
  'construction_site_id', p_construction_site_id,
  'room_code', p_room_code
)
```

Recipient RPC bắt buộc Room + action và không auto-include admin.

- [ ] **Step 6: Viết SQL smoke có hai approver khác Room**

Fixture: chị A có `(material_po, approve)`, anh B có `(daily_log, approve)`. Assert A không có Daily Log approve, B không có PO approve, recipient của mỗi Room chỉ có đúng người; invalid batch rollback toàn bộ; direct authenticated writes bị từ chối.

- [ ] **Step 7: Chạy contract, local reset và smoke**

```bash
npm test -- lib/__tests__/projectPermissionRoomMigrationContract.test.ts
npx supabase db reset --local
npx supabase db query --local -f supabase/tests/project_permission_rooms_smoke.sql
```

Expected: PASS, không có SQL exception.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260722090000_project_permission_rooms.sql supabase/tests/project_permission_rooms_smoke.sql lib/__tests__/projectPermissionRoomMigrationContract.test.ts
git commit -m "feat(project): add permission Room persistence"
```

---

### Task 3: Tạo frontend service cho Room

**Files:**
- Create: `lib/projectPermissionRoomService.ts`
- Create: `lib/__tests__/projectPermissionRoomService.test.ts`
- Modify: `types.ts`

**Interfaces:**
- Consumes: RPC Task 2 và types Task 1.
- Produces: `ProjectPermissionRoomSummary`, `ProjectPermissionRoomMember`, `ProjectRoomStaffCandidate`, `ReplaceProjectRoomMemberInput`, `projectPermissionRoomService`.

- [ ] **Step 1: Viết RPC adapter tests fail**

```ts
expect(supabaseMocks.rpc).toHaveBeenCalledWith('replace_project_permission_room_members', {
  p_project_id: 'project-1',
  p_construction_site_id: 'site-1',
  p_room_code: 'material_po',
  p_members: [{ staff_id: 'staff-1', action_codes: ['approve'] }],
});

expect(supabaseMocks.rpc).toHaveBeenCalledWith('list_project_room_action_recipients', {
  p_project_id: 'project-1',
  p_construction_site_id: 'site-1',
  p_room_code: 'daily_log',
  p_action_code: 'approve',
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm test -- lib/__tests__/projectPermissionRoomService.test.ts`

Expected: FAIL vì service chưa tồn tại.

- [ ] **Step 3: Implement service contract**

```ts
export interface ReplaceProjectRoomMemberInput {
  staffId: string;
  actionCodes: ProjectRoomActionCode[];
}

export interface ProjectPermissionRoomSummary {
  roomCode: ProjectPermissionRoomCode;
  groupCode: ProjectPermissionRoomDefinition['groupCode'];
  roomName: string;
  description: string;
  allowedActions: ProjectRoomActionCode[];
  memberCount: number;
  memberPreview: Array<{ userId: string; userName: string; userAvatar?: string | null }>;
  actionCounts: Partial<Record<ProjectRoomActionCode, number>>;
  missingRequiredActions: ProjectRoomActionCode[];
}

export interface ProjectPermissionRoomMember {
  roomMemberId: string;
  staffId: string;
  userId: string;
  userName: string;
  userAvatar?: string | null;
  positionName?: string | null;
  constructionSiteId?: string | null;
  actionCodes: ProjectRoomActionCode[];
  isActive: boolean;
}

export interface ProjectRoomStaffCandidate {
  staffId: string;
  userId: string;
  userName: string;
  userAvatar?: string | null;
  positionName?: string | null;
  constructionSiteId?: string | null;
  isRoomMember: boolean;
  disabledReason?: string | null;
}

export const projectPermissionRoomService = {
  listRooms(projectId: string, siteId?: string | null): Promise<ProjectPermissionRoomSummary[]>,
  getRoom(projectId: string, siteId: string | null | undefined, roomCode: ProjectPermissionRoomCode): Promise<ProjectPermissionRoomMember[]>,
  listCandidates(projectId: string, siteId: string | null | undefined, roomCode: ProjectPermissionRoomCode): Promise<ProjectRoomStaffCandidate[]>,
  replaceMembers(projectId: string, siteId: string | null | undefined, roomCode: ProjectPermissionRoomCode, members: ReplaceProjectRoomMemberInput[]): Promise<void>,
  listRecipients(projectId: string, siteId: string | null | undefined, roomCode: ProjectPermissionRoomCode, actionCode: ProjectRoomActionCode): Promise<ProjectStaff[]>,
  hasAction(userId: string, projectId: string, siteId: string | null | undefined, roomCode: ProjectPermissionRoomCode, actionCode: ProjectRoomActionCode): Promise<boolean>,
};
```

Trước RPC có Room/action, gọi `isRoomActionAllowed`; invalid pair throw và không gọi Supabase. Map snake_case ở duy nhất service này.

- [ ] **Step 4: Chạy tests và typecheck**

Run: `npm test -- lib/__tests__/projectPermissionRoomService.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/projectPermissionRoomService.ts lib/__tests__/projectPermissionRoomService.test.ts types.ts
git commit -m "feat(project): add permission Room service"
```

---

### Task 4: Tách Tab Tổ chức và Tab Phân quyền

**Files:**
- Create: `pages/project/ProjectPermissionsTab.tsx`
- Create: `supabase/migrations/20260722093000_project_org_admin_only.sql`
- Modify: `pages/project/ProjectOrgTab.tsx`
- Modify: `pages/ProjectDashboard.tsx`
- Modify: `lib/projectTabPermissions.ts`
- Modify: `lib/permissions/projectPermissionRegistry.ts`
- Modify: `lib/__tests__/permissionRegistry.test.ts`

**Interfaces:**
- Consumes: `ProjectPermissionRoomsPanel` sẽ được hoàn thiện ở Task 5–6.
- Produces: tab key/route `permissions`; Tổ chức không còn ma trận quyền.

- [ ] **Step 1: Sửa contract test để yêu cầu tab riêng**

```ts
it('keeps organization and Room permissions in separate tabs', () => {
  const org = readFileSync(join(process.cwd(), 'pages/project/ProjectOrgTab.tsx'), 'utf8');
  const permissions = readFileSync(join(process.cwd(), 'pages/project/ProjectPermissionsTab.tsx'), 'utf8');
  const dashboard = readFileSync(join(process.cwd(), 'pages/ProjectDashboard.tsx'), 'utf8');

  expect(org).not.toContain('PermissionMatrix');
  expect(org).not.toContain('PROJECT_PERMISSION_TEMPLATES');
  expect(permissions).toContain('ProjectPermissionRoomsPanel');
  expect(dashboard).toContain("overviewTab === 'permissions'");
  expect(dashboard).toContain('user?.role === Role.ADMIN');
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm test -- lib/__tests__/permissionRegistry.test.ts`

Expected: FAIL vì file/tab mới chưa tồn tại.

- [ ] **Step 3: Thêm route và admin visibility gate**

Thêm vào `PROJECT_TAB_PERMISSIONS`:

```ts
{ key: 'permissions', label: 'Phân quyền', icon: '🔐', route: '/da/tabs/permissions' }
```

Trong dashboard:

```ts
const visibleOverviewTabs = useMemo(
  () => PROJECT_TAB_PERMISSIONS.filter(tab =>
    !isProjectFinanceLegacyTabKey(tab.key) &&
    (tab.key !== 'permissions' || user?.role === Role.ADMIN) &&
    canViewProjectTab(tab.key)
  ),
  [canViewProjectTab, user?.role],
);
```

Map route `permissions` vào `project.org`; không đưa Room action vào ma trận PBAC v2.

- [ ] **Step 4: Loại ma trận khỏi `ProjectOrgTab`**

Xóa imports/state/handler cho `PermissionMatrix`, `PermissionDiffPreview`, `PROJECT_PERMISSION_TEMPLATES`, `listUserPermissionGrants`, project grants và `replaceProjectStaffPermissionGrants`. Giữ thêm/sửa/kết thúc/xóa nhân sự. Mutation UI chỉ render cho `currentUser?.role === Role.ADMIN`; migration `20260722093000_project_org_admin_only.sql` đổi `upsert_project_staff_assignment`, `end_project_staff_assignment`, `remove_project_staff_assignment` thành admin-only.

- [ ] **Step 5: Tạo entry page admin-only**

```tsx
const ProjectPermissionsTab: React.FC<Props> = ({ projectId, constructionSiteId }) => {
  const { user } = useApp();
  if (user?.role !== Role.ADMIN) return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm font-bold text-amber-800">
      Chỉ admin hệ thống được quản lý phân quyền dự án.
    </div>
  );
  return <ProjectPermissionRoomsPanel projectId={projectId} constructionSiteId={constructionSiteId} />;
};
```

- [ ] **Step 6: Chạy test và typecheck**

Run: `npm test -- lib/__tests__/permissionRegistry.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add pages/project/ProjectPermissionsTab.tsx pages/project/ProjectOrgTab.tsx pages/ProjectDashboard.tsx lib/projectTabPermissions.ts lib/permissions/projectPermissionRegistry.ts lib/__tests__/permissionRegistry.test.ts supabase/migrations/20260722093000_project_org_admin_only.sql
git commit -m "refactor(project): separate organization and permissions tabs"
```

---

### Task 5: Xây Room Card overview

**Files:**
- Create: `components/project/permissions/ProjectPermissionRoomCard.tsx`
- Create: `components/project/permissions/ProjectPermissionRoomsPanel.tsx`
- Create: `lib/__tests__/projectPermissionRoomsUiContract.test.ts`
- Modify: `pages/project/ProjectPermissionsTab.tsx`

**Interfaces:**
- Consumes: `projectPermissionRoomService.listRooms()`.
- Produces: Room grid, search/group filter, warning và `onOpen(roomCode)`.

- [ ] **Step 1: Viết UI contract test fail**

```ts
it('renders Room cards with summaries', () => {
  expect(panelSource).toContain('projectPermissionRoomService.listRooms');
  expect(panelSource).toContain('ProjectPermissionRoomCard');
  expect(panelSource).toContain('searchQuery');
  expect(panelSource).toContain('selectedGroup');
  expect(cardSource).toContain('memberPreview');
  expect(cardSource).toContain('missingRequiredActions');
  expect(cardSource).toContain('actionCounts');
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm test -- lib/__tests__/projectPermissionRoomsUiContract.test.ts`

Expected: FAIL vì components chưa tồn tại.

- [ ] **Step 3: Dùng skill frontend tại thời điểm thực thi**

Đọc `design-taste-frontend` trước khi viết JSX. Giữ visual language Project Dashboard: nền white/slate, accent có nghĩa theo nhóm, radius 16–20px, shadow nhẹ, focus state rõ; không dùng trang trí gây nhiễu.

- [ ] **Step 4: Implement Card contract**

```ts
interface ProjectPermissionRoomCardProps {
  room: ProjectPermissionRoomSummary;
  onOpen: (roomCode: ProjectPermissionRoomCode) => void;
}
```

Card hiển thị tên/mô tả, `memberCount`, tối đa 5 avatar, `+N`, badge `Duyệt N`/`Xác nhận N`, cảnh báo action bắt buộc còn thiếu. Toàn Card là button có keyboard/focus support.

- [ ] **Step 5: Implement panel states**

```ts
const [rooms, setRooms] = useState<ProjectPermissionRoomSummary[]>([]);
const [selectedRoomCode, setSelectedRoomCode] = useState<ProjectPermissionRoomCode | null>(null);
const [searchQuery, setSearchQuery] = useState('');
const [selectedGroup, setSelectedGroup] = useState<string>('all');
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
```

Loading dùng skeleton cùng kích thước Card; error có nút Thử lại. Sau save Drawer, reload summaries rồi đóng Drawer.

- [ ] **Step 6: Chạy test, typecheck và build**

Run: `npm test -- lib/__tests__/projectPermissionRoomsUiContract.test.ts && npm run lint && npm run build`

Expected: PASS và build thành công.

- [ ] **Step 7: Commit**

```bash
git add components/project/permissions/ProjectPermissionRoomCard.tsx components/project/permissions/ProjectPermissionRoomsPanel.tsx pages/project/ProjectPermissionsTab.tsx lib/__tests__/projectPermissionRoomsUiContract.test.ts
git commit -m "feat(project): add permission Room overview"
```

---

### Task 6: Xây Drawer chỉnh một hoặc nhiều nhân viên

**Files:**
- Create: `components/project/permissions/ProjectPermissionRoomDrawer.tsx`
- Modify: `components/project/permissions/ProjectPermissionRoomsPanel.tsx`
- Modify: `lib/__tests__/projectPermissionRoomsUiContract.test.ts`

**Interfaces:**
- Consumes: `getRoom`, `listCandidates`, `replaceMembers`.
- Produces: draft editor, multi-select, bulk grant/revoke/remove và một nút save.

- [ ] **Step 1: Bổ sung contract test fail**

```ts
it('keeps edits in a local draft and saves the whole Room once', () => {
  expect(drawerSource).toContain('draftMembers');
  expect(drawerSource).toContain('selectedStaffIds');
  expect(drawerSource).toContain('toggleMemberAction');
  expect(drawerSource).toContain('applyBulkAction');
  expect(drawerSource).toContain('removeSelectedMembers');
  expect(drawerSource).toContain('projectPermissionRoomService.replaceMembers');
  expect(drawerSource).toContain('Hủy thay đổi');
  expect(drawerSource).toContain('Lưu thay đổi');
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm test -- lib/__tests__/projectPermissionRoomsUiContract.test.ts`

Expected: FAIL vì Drawer chưa tồn tại.

- [ ] **Step 3: Implement reducer thuần**

```ts
export const toggleMemberAction = (
  members: ProjectPermissionRoomMember[],
  staffId: string,
  actionCode: ProjectRoomActionCode,
): ProjectPermissionRoomMember[] => members.map(member => member.staffId !== staffId ? member : {
  ...member,
  actionCodes: member.actionCodes.includes(actionCode)
    ? member.actionCodes.filter(code => code !== actionCode)
    : [...member.actionCodes, actionCode],
});
```

Bulk grant dùng `Set`, bulk revoke dùng filter, remove xóa khỏi draft. Unit test cả toggle on/off và hai người được bulk grant cùng action.

- [ ] **Step 4: Implement Drawer behavior**

- Desktop là right Drawer; mobile là full-screen sheet.
- Picker chọn nhiều active project staff, không thêm trùng.
- Chỉ render action từ `room.actions`.
- Footer sticky hiển thị số thay đổi và gọi `replaceMembers` đúng một lần.
- Save lỗi giữ draft; save thành công gọi `onSaved()`.
- Không thêm version field/conflict modal.

- [ ] **Step 5: Chạy verification**

Run: `npm test -- lib/__tests__/projectPermissionRoomsUiContract.test.ts && npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/project/permissions/ProjectPermissionRoomDrawer.tsx components/project/permissions/ProjectPermissionRoomsPanel.tsx lib/__tests__/projectPermissionRoomsUiContract.test.ts
git commit -m "feat(project): add batch Room permission editor"
```

---

### Task 7: Snapshot và phân loại quyền legacy

**Files:**
- Create: `scripts/audit-project-legacy-room-mapping.sql`
- Create: `supabase/migrations/20260722100000_project_permission_legacy_room_mapping.sql`
- Modify: `supabase/tests/project_permission_rooms_smoke.sql`
- Create: `lib/__tests__/projectLegacyRoomMappingContract.test.ts`

**Interfaces:**
- Produces: report `staff_id`, `user_id`, scope, `legacy_code`, evidence, `suggested_room_code`, `mapping_status`.
- Consumes: legacy permission, assignment, recipient và audit history.

- [ ] **Step 1: Viết contract test fail**

```ts
expect(sql).toContain('legacy_code');
expect(sql).toContain('suggested_room_code');
expect(sql).toContain('mapping_status');
expect(sql).toContain("'unclassified'");
expect(sql).not.toMatch(/delete\s+from\s+public\.project_staff_permissions/i);
expect(sql).not.toMatch(/update\s+public\.project_staff_permissions/i);
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm test -- lib/__tests__/projectLegacyRoomMappingContract.test.ts`

Expected: FAIL vì audit script chưa tồn tại.

- [ ] **Step 3: Viết read-only audit SQL**

```sql
select
  ps.id as staff_id,
  ps.user_id::uuid as user_id,
  ps.project_id,
  ps.construction_site_id,
  ppt.code as legacy_code,
  evidence.room_code as suggested_room_code,
  evidence.evidence_type,
  case
    when ppt.code = 'view_available_stock' then 'suggested'
    when evidence.room_code is not null then 'suggested'
    else 'unclassified'
  end as mapping_status
from public.project_staff ps
join public.project_staff_permissions psp on psp.staff_id = ps.id and coalesce(psp.is_active, true)
join public.project_permission_types ppt on ppt.id = psp.permission_type_id
left join evidence on evidence.staff_id = ps.id and evidence.action_code = ppt.code;
```

`evidence` union assignment, submitted recipient, workflow/audit transition và stock-specific evidence. Không dùng PBAC v2 grant do projection sinh làm bằng chứng duy nhất.

- [ ] **Step 4: Lưu kết quả admin xử lý, không tham gia authorization**

Trong migration mới, thêm bảng `project_permission_legacy_room_mappings` với unique `(staff_id, legacy_permission_type_id, room_code)` và `mapping_status in ('suggested','confirmed','unclassified','ignored')`. Bảng chỉ dùng audit/migration.

- [ ] **Step 5: Chạy tests**

Run: `npm test -- lib/__tests__/projectLegacyRoomMappingContract.test.ts lib/__tests__/projectPermissionRoomMigrationContract.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/audit-project-legacy-room-mapping.sql supabase/migrations/20260722100000_project_permission_legacy_room_mapping.sql supabase/tests/project_permission_rooms_smoke.sql lib/__tests__/projectLegacyRoomMappingContract.test.ts
git commit -m "feat(project): audit legacy permissions by Room"
```

---

### Task 8: Chuyển recipient picker sang Room + action

**Files:**
- Create: `components/project/ProjectRoomSubmissionDialog.tsx`
- Modify: `types.ts`
- Create: `lib/__tests__/projectRoomRecipientContract.test.ts`
- Modify: `lib/__tests__/projectPermissionRoomService.test.ts`

**Interfaces:**
- Consumes: `projectPermissionRoomService.listRecipients()`.
- Produces: dialog mới bắt buộc Room/action; dialog generic hiện tại tiếp tục chạy cho callsite chưa cutover và module Hợp đồng.

- [ ] **Step 1: Viết recipient contract test fail**

```ts
it('requires Room context for Project recipient selection', () => {
  expect(roomDialogSource).toContain('recipientRoomCode');
  expect(roomDialogSource).toContain('recipientAction');
  expect(roomDialogSource).toContain('projectPermissionRoomService.listRecipients');
  expect(roomDialogSource).not.toContain('recipientPermissionCodes');
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm test -- lib/__tests__/projectRoomRecipientContract.test.ts`

Expected: FAIL.

- [ ] **Step 3: Tạo Room dialog với Props bắt buộc**

```ts
interface Props {
  projectId: string;
  constructionSiteId?: string | null;
  recipientRoomCode: ProjectPermissionRoomCode;
  recipientAction: ProjectRoomActionCode;
  title: string;
  actionLabel?: string;
  documentLabel: string;
  documentName: string;
  documentSubtitle?: string;
  details?: DetailRow[];
  recipientHint?: string;
  onCancel: () => void;
  onConfirm: (target: ProjectSubmissionTarget) => Promise<void> | void;
}
```

Load recipients bằng:

```ts
projectPermissionRoomService.listRecipients(
  projectId,
  constructionSiteId,
  recipientRoomCode,
  recipientAction,
);
```

Target lưu `roomCode`, `actionCode`; `permissionCode` chỉ giữ để đọc payload lịch sử, không query candidate. Giữ `ProjectSubmissionDialog.tsx` nguyên trạng trong Task này để build không vỡ.

Trong `types.ts` thêm hai trường typed:

```ts
roomCode?: ProjectPermissionRoomCode;
actionCode?: ProjectRoomActionCode;
```

- [ ] **Step 4: Test exact recipient RPC**

```ts
await projectPermissionRoomService.listRecipients(
  'project-1', 'site-1', 'daily_log', 'approve',
);
expect(supabaseMocks.rpc).toHaveBeenCalledWith('list_project_room_action_recipients', {
  p_project_id: 'project-1',
  p_construction_site_id: 'site-1',
  p_room_code: 'daily_log',
  p_action_code: 'approve',
});
```

- [ ] **Step 5: Chạy tests, typecheck và build**

Run: `npm test -- lib/__tests__/projectRoomRecipientContract.test.ts lib/__tests__/projectPermissionRoomService.test.ts && npm run lint && npm run build`

Expected: PASS; các callsite cũ vẫn build bằng dialog legacy.

- [ ] **Step 6: Commit**

```bash
git add components/project/ProjectRoomSubmissionDialog.tsx types.ts lib/__tests__/projectRoomRecipientContract.test.ts lib/__tests__/projectPermissionRoomService.test.ts
git commit -m "feat(project): add Room-aware recipient dialog"
```

---

### Task 9: Cutover Nhật ký và Vật tư làm lát cắt chuẩn

**Files:**
- Modify: `pages/project/DailyLogTab.tsx`
- Modify: `pages/project/MaterialTab.tsx`
- Modify: `pages/project/SupplyChainTab.tsx`
- Modify: `components/project/material/MaterialRequestTab.tsx`
- Modify: `lib/projectDocumentPolicy.ts`
- Modify: `lib/projectService.ts`
- Modify: `lib/materialRequestService.ts`
- Modify: `lib/materialRequestFulfillmentService.ts`
- Modify: `lib/customMaterialRequestService.ts`
- Modify: `lib/projectMaterialPlanningService.ts`
- Create: `supabase/migrations/20260722120000_project_room_daily_material_cutover.sql`
- Modify: `lib/__tests__/dailyLogPermissions.phase3.test.ts`
- Modify: `lib/__tests__/materialPermissions.phase3.test.ts`
- Modify: `lib/__tests__/dailyLogAssignmentUiContract.test.ts`
- Modify: `supabase/tests/phase3_daily_log_permissions_smoke.sql`
- Modify: `supabase/tests/phase3_material_permissions_smoke.sql`

**Interfaces:**
- Consumes: Room codes `daily_log`, `material_planning`, `material_request`, `material_po`, `material_waste`, `custom_material`.
- Produces: reference slice dùng cùng Room check ở UI, service, RPC/RLS và assignment.

- [ ] **Step 1: Đổi tests để chứng minh không rò quyền chéo**

```ts
it('uses the PO Room for the primary PO recipient picker', () => {
  expect(supplySource).toContain('recipientRoomCode="material_po"');
  expect(supplySource).toContain('recipientAction="approve"');
  expect(supplySource).not.toContain("recipientPermissionCodes={['confirm']}");
});

it('keeps Daily Log assignment-first while requiring its Room', () => {
  expect(dailyLogSource).toContain("roomCode: 'daily_log'");
  expect(dailyLogSource).toContain('getDailyLogResponsibilityTarget');
});
```

- [ ] **Step 2: Chạy tests để xác nhận fail**

Run: `npm test -- lib/__tests__/dailyLogPermissions.phase3.test.ts lib/__tests__/materialPermissions.phase3.test.ts lib/__tests__/dailyLogAssignmentUiContract.test.ts lib/__tests__/projectRoomRecipientContract.test.ts`

Expected: FAIL ở Room integration.

- [ ] **Step 3: Map capability theo Room**

```text
daily_log: view/edit/delete/submit/verify/approve
material_planning: view/edit/delete
material_request: view/edit/delete/submit/verify/confirm/approve/view_available_stock
material_po: view/edit/delete/submit/approve/confirm
material_waste: view/edit/approve
custom_material: view/edit/approve
```

Nhật ký vẫn dùng responsibility resolver; resolver chỉ nhận người có đúng Room action.

- [ ] **Step 4: Map backend guards và RLS**

Thay permission check bằng dạng:

```sql
app_private.project_user_has_room_action(
  v_actor_id,
  v_project_id,
  v_construction_site_id,
  'material_po',
  'approve'
)
```

Creator/state/assignment rules kết hợp bằng `AND`; Room không bypass ownership hoặc current handler.

- [ ] **Step 5: Chuyển recipient callsites**

- PO chính: `material_po + approve`.
- PO nhận hàng: `material_po + confirm`.
- Đề xuất vật tư: gửi `material_request + submit`, kiểm tra `material_request + verify`, duyệt `material_request + approve`, xác nhận cấp hàng `material_request + confirm`.
- Project Material/Daily Log import `ProjectRoomSubmissionDialog`; không còn generic recipient props.

- [ ] **Step 6: Chạy verification**

```bash
npm test -- lib/__tests__/dailyLogPermissions.phase3.test.ts lib/__tests__/materialPermissions.phase3.test.ts lib/__tests__/dailyLogAssignmentUiContract.test.ts lib/__tests__/projectRoomRecipientContract.test.ts
npx supabase db query --local -f supabase/tests/phase3_daily_log_permissions_smoke.sql
npx supabase db query --local -f supabase/tests/phase3_material_permissions_smoke.sql
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add pages/project/DailyLogTab.tsx pages/project/MaterialTab.tsx pages/project/SupplyChainTab.tsx components/project/material/MaterialRequestTab.tsx lib/projectDocumentPolicy.ts lib/projectService.ts lib/materialRequestService.ts lib/materialRequestFulfillmentService.ts lib/customMaterialRequestService.ts lib/projectMaterialPlanningService.ts lib/__tests__/dailyLogPermissions.phase3.test.ts lib/__tests__/materialPermissions.phase3.test.ts lib/__tests__/dailyLogAssignmentUiContract.test.ts supabase/tests/phase3_daily_log_permissions_smoke.sql supabase/tests/phase3_material_permissions_smoke.sql supabase/migrations/20260722120000_project_room_daily_material_cutover.sql
git commit -m "refactor(project): enforce Daily Log and Material Rooms"
```

---

### Task 10: Cutover các Room Dự án còn lại

**Files:**
- Modify: `pages/project/GanttTab.tsx`
- Modify: `pages/project/WeeklyProgressTab.tsx`
- Modify: `components/project/QuantityAcceptancePanel.tsx`
- Modify: `components/project/PaymentCertificatePanel.tsx`
- Modify: `components/project/BoqReconciliationPanel.tsx`
- Modify: `pages/project/QualityTab.tsx`
- Modify: `pages/project/SafetyTab.tsx`
- Modify: `pages/project/SubcontractTab.tsx`
- Modify: `pages/project/PaymentWorkbenchTab.tsx`
- Modify: `lib/projectService.ts`
- Modify: `lib/projectTaskCompletionService.ts`
- Modify: `lib/projectWeeklyProgressService.ts`
- Modify: `lib/quantityAcceptanceService.ts`
- Modify: `lib/paymentCertificateService.ts`
- Modify: `lib/paymentScheduleWorkbenchService.ts`
- Modify: `lib/boqReconciliationService.ts`
- Modify: `lib/qualityChecklistService.ts`
- Modify: `lib/safetyService.ts`
- Create: `supabase/migrations/20260722150000_project_room_remaining_cutover.sql`
- Create: `lib/__tests__/projectRoomCutoverContract.test.ts`
- Modify: `lib/__tests__/permissionRegistry.test.ts`
- Modify: `supabase/tests/phase3_payment_contract_permissions_smoke.sql`
- Modify: `supabase/tests/phase3_quality_safety_documents_smoke.sql`

**Interfaces:**
- Consumes: Room service/backend function chuẩn.
- Produces: không còn generic consumer trong Room Dự án đã xác định.

- [ ] **Step 1: Viết source contract fail**

```ts
const expected: Record<string, string> = {
  'pages/project/GanttTab.tsx': 'gantt',
  'pages/project/WeeklyProgressTab.tsx': 'weekly_progress',
  'components/project/QuantityAcceptancePanel.tsx': 'quantity_acceptance',
  'components/project/PaymentCertificatePanel.tsx': 'payment',
  'components/project/BoqReconciliationPanel.tsx': 'boq_reconciliation',
  'pages/project/QualityTab.tsx': 'quality',
  'pages/project/SafetyTab.tsx': 'safety',
  'pages/project/SubcontractTab.tsx': 'subcontract',
};

for (const [file, roomCode] of Object.entries(expected)) {
  const source = readFileSync(join(process.cwd(), file), 'utf8');
  expect(source).toContain(roomCode);
  expect(source).not.toMatch(/recipientPermissionCodes=\{\['(?:approve|verify|confirm)'\]\}/);
}
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm test -- lib/__tests__/projectRoomCutoverContract.test.ts`

Expected: FAIL tại callsite generic hiện có.

- [ ] **Step 3: Cutover Tài chính**

```text
QuantityAcceptancePanel → quantity_acceptance
PaymentCertificatePanel / PaymentWorkbenchTab → payment
BoqReconciliationPanel → boq_reconciliation
```

`confirm` trong payment là mark-paid; `approve` không suy ra `confirm`. Return/cancel vẫn yêu cầu assignment + state + action bước hiện tại.

- [ ] **Step 4: Cutover Tiến độ**

```text
Gantt create/edit/progress → gantt + edit
Gantt delete → gantt + delete
Gantt completion → gantt + submit/verify/approve
Weekly save → weekly_progress + edit
Weekly workflow/lock → weekly_progress + submit/verify/approve/confirm
```

- [ ] **Step 5: Cutover Chất lượng, An toàn, Nhà thầu**

Map đúng whitelist Task 1. Không dùng `canManageTab` làm điều kiện duy nhất cho mutation; nó chỉ còn phục vụ tab visibility trong thời gian cleanup.

- [ ] **Step 6: Cập nhật SQL guards và smoke**

Mỗi nhóm test: allowed đúng Room, denied cùng action ở Room khác, denied action ngoài whitelist, denied direct mutation thiếu Room, denied transition khi có Room action nhưng không phải assignee.

- [ ] **Step 7: Thu hẹp legacy consumer allowlist**

Loại các file đã cutover khỏi allowlist trong `permissionRegistry.test.ts`. Chỉ component host module Hợp đồng hoặc compatibility migration được phép còn generic trong checkpoint này.

- [ ] **Step 8: Chạy verification**

```bash
npm test -- lib/__tests__/projectRoomCutoverContract.test.ts lib/__tests__/permissionRegistry.test.ts
npx supabase db query --local -f supabase/tests/phase3_payment_contract_permissions_smoke.sql
npx supabase db query --local -f supabase/tests/phase3_quality_safety_documents_smoke.sql
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add pages/project components/project lib/projectService.ts lib/projectTaskCompletionService.ts lib/projectWeeklyProgressService.ts lib/quantityAcceptanceService.ts lib/paymentCertificateService.ts lib/paymentScheduleWorkbenchService.ts lib/boqReconciliationService.ts lib/qualityChecklistService.ts lib/safetyService.ts lib/__tests__/projectRoomCutoverContract.test.ts lib/__tests__/permissionRegistry.test.ts supabase/migrations/20260722150000_project_room_remaining_cutover.sql supabase/tests/phase3_payment_contract_permissions_smoke.sql supabase/tests/phase3_quality_safety_documents_smoke.sql
git commit -m "refactor(project): enforce remaining permission Rooms"
```

---

### Task 11: Chuẩn hóa các tab không dùng Room

**Files:**
- Modify: `pages/project/DocumentsTab.tsx`
- Modify: `pages/project/ReportTab.tsx`
- Modify: `pages/project/ExecutiveTab.tsx`
- Modify: `pages/project/ContractTab.tsx`
- Modify: `pages/ProjectDashboard.tsx`
- Create: `supabase/migrations/20260722170000_project_non_room_tab_hardening.sql`
- Create: `supabase/tests/project_non_room_tabs_smoke.sql`
- Create: `lib/__tests__/projectNonRoomTabsContract.test.ts`

**Interfaces:**
- Consumes: active project membership và system admin identity.
- Produces: Tài liệu theo membership; Báo cáo/Điều hành/Hợp đồng không có Room hoặc mutation nội bộ.

- [ ] **Step 1: Viết contract test fail**

```ts
it('keeps non-Room tabs within the approved feature surface', () => {
  expect(documentsSource).toContain('canUploadAsProjectMember');
  expect(documentsSource).toContain('canDeleteOwnDocument');
  expect(reportSource).not.toContain('Export Excel');
  expect(reportSource).not.toContain('Sao chép');
  expect(executiveSource).not.toMatch(/onClick=.*(?:save|delete|approve)/i);
  expect(contractSource).toContain('Mở module Hợp đồng');
  expect(contractSource).not.toContain('<ContractWorkspace');
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm test -- lib/__tests__/projectNonRoomTabsContract.test.ts`

Expected: FAIL vì các tab vẫn còn surface cũ.

- [ ] **Step 3: Chuẩn hóa Tài liệu**

- Active project/site member được view và upload.
- Người upload được xóa tài liệu của mình khi policy trạng thái cho phép.
- System admin được xóa mọi tài liệu.
- Không tạo Room Tài liệu và không dùng `canManageTab` để quyết định upload.
- Migration RLS dùng project membership + `created_by`; direct upload của người ngoài dự án bị từ chối.

- [ ] **Step 4: Chuẩn hóa Báo cáo và Điều hành**

Loại các action Copy/Export khỏi `ReportTab`; `ExecutiveTab` chỉ render dữ liệu. Không seed Room/action cho hai tab này.

- [ ] **Step 5: Chuẩn hóa Hợp đồng trong Dự án**

`ContractTab` chỉ render summary/read-only cards và deeplink tới `/hd/customer/:id` cho hợp đồng khách hàng hoặc `/hd/subcontractor/:id` cho hợp đồng thầu phụ. Không render `ContractWorkspace` hoặc các nút add/edit/delete/approve trong context Dự án. `ContractWorkspace` trong `pages/hd/ContractWorkspacePage.tsx` vẫn giữ chức năng của host module Hợp đồng.

- [ ] **Step 6: Chạy tests, SQL smoke và build**

```bash
npm test -- lib/__tests__/projectNonRoomTabsContract.test.ts
npx supabase db query --local -f supabase/tests/project_non_room_tabs_smoke.sql
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add pages/project/DocumentsTab.tsx pages/project/ReportTab.tsx pages/project/ExecutiveTab.tsx pages/project/ContractTab.tsx pages/ProjectDashboard.tsx supabase/migrations/20260722170000_project_non_room_tab_hardening.sql supabase/tests/project_non_room_tabs_smoke.sql lib/__tests__/projectNonRoomTabsContract.test.ts
git commit -m "refactor(project): normalize non-Room tabs"
```

---

### Task 12: Tắt projection generic và hoàn tất regression suite

**Files:**
- Create: `supabase/migrations/20260722180000_project_room_cutover_cleanup.sql`
- Create: `components/contract/ContractSubmissionDialog.tsx`
- Delete: `components/project/ProjectSubmissionDialog.tsx`
- Modify: `lib/permissions/projectPermissionService.ts`
- Modify: `lib/projectStaffService.ts`
- Modify: `pages/project/ProjectOrgTab.tsx`
- Modify: `lib/__tests__/projectPermissionService.test.ts`
- Modify: `lib/__tests__/phase5PermissionHardening.test.ts`
- Modify: `supabase/tests/phase5_no_legacy_fallback_smoke.sql`
- Modify: `docs/security/permission-refactor-roadmap.md`

**Interfaces:**
- Consumes: mọi Room đã cutover và mapping report.
- Produces: không còn legacy→mọi module hoặc Room→legacy projection trong Dự án.

- [ ] **Step 1: Viết cleanup contract fail**

```ts
it('does not project a generic action across Project modules', () => {
  expect(projectPermissionSource).not.toContain('legacyProjectCodeToPermissionCodes');
  expect(projectPermissionSource).not.toContain('projectActionCodesByAction');
});

it('keeps legacy rows read-only after Room cutover', () => {
  expect(cleanupSql).toContain('project_permission_legacy_room_mappings');
  expect(cleanupSql).toContain('revoke insert, update, delete');
  expect(cleanupSql).not.toContain('delete from public.project_staff_permissions');
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm test -- lib/__tests__/projectPermissionService.test.ts lib/__tests__/phase5PermissionHardening.test.ts`

Expected: FAIL vì projection helpers còn tồn tại.

- [ ] **Step 3: Xóa đường projection hai chiều**

- Không đồng bộ Room grant sang `project_staff_permissions`.
- Không backfill generic action sang Room.
- Revoke direct legacy writes; giữ bảng/snapshot read-only để audit.
- Xóa `legacyProjectCodeToPermissionCodes`, `getLegacyProjectCodesDerivedFromPermissionCodes` khỏi Project UI.
- Xóa generic recipient path.
- Chuyển `ContractVariationPanel` và `ContractWorkspace` sang `components/contract/ContractSubmissionDialog.tsx` trước khi xóa Project dialog legacy.

- [ ] **Step 4: Chạy full regression**

```bash
npm test
npx supabase db reset --local
npx supabase db query --local -f supabase/tests/project_permission_rooms_smoke.sql
npx supabase db query --local -f supabase/tests/phase3_daily_log_permissions_smoke.sql
npx supabase db query --local -f supabase/tests/phase3_material_permissions_smoke.sql
npx supabase db query --local -f supabase/tests/phase3_payment_contract_permissions_smoke.sql
npx supabase db query --local -f supabase/tests/phase3_quality_safety_documents_smoke.sql
npx supabase db query --local -f supabase/tests/project_non_room_tabs_smoke.sql
npx supabase db query --local -f supabase/tests/phase5_no_legacy_fallback_smoke.sql
npm run lint
npm run build
```

Expected: tất cả PASS.

- [ ] **Step 5: Chạy manual acceptance scenario**

1. Admin mở Dự án → Phân quyền.
2. Room PO: thêm chị A, cấp `approve`, lưu.
3. Room Nhật ký: thêm anh B, cấp `approve`, lưu.
4. Gửi PO chỉ thấy chị A; gửi Nhật ký chỉ thấy anh B.
5. Thêm chị A vào Room Nhật ký; gửi lại thấy cả hai.
6. Direct-call duyệt Nhật ký khi chưa được assignment phải bị backend từ chối.
7. Chọn nhiều người, cấp/gỡ action và xác nhận UI chỉ gọi một save RPC.

- [ ] **Step 6: Cập nhật roadmap và commit**

```bash
git add supabase/migrations/20260722180000_project_room_cutover_cleanup.sql components/contract/ContractSubmissionDialog.tsx components/project/ProjectSubmissionDialog.tsx components/project/ContractVariationPanel.tsx components/project/ContractWorkspace.tsx lib/permissions/projectPermissionService.ts lib/projectStaffService.ts pages/project/ProjectOrgTab.tsx lib/__tests__/projectPermissionService.test.ts lib/__tests__/phase5PermissionHardening.test.ts supabase/tests/phase5_no_legacy_fallback_smoke.sql docs/security/permission-refactor-roadmap.md
git commit -m "refactor(project): complete Room permission cutover"
```

---

## Cloud Deployment Checkpoint

Không gộp checkpoint này vào implementation local.

- [ ] Đối chiếu `supabase migration list --linked` và giải quyết remote-only/local-only migrations.
- [ ] Backup `project_staff_permissions`, `user_permission_grants`, `permission_audit_events` và assignment/recipient data.
- [ ] Chạy audit legacy và lưu kết quả trước migration.
- [ ] Apply foundation trên staging/disposable environment.
- [ ] Chạy Room smoke suite trên staging.
- [ ] Admin xác nhận các grant `unclassified`.
- [ ] Cutover Nhật ký → Vật tư → Tài chính → các Room còn lại.
- [ ] Chỉ apply cleanup khi không còn Project recipient/mutation phụ thuộc generic permission.
- [ ] Rollback theo từng Room bằng RPC/feature switch; không xóa Room audit data.

## Final Definition of Done

- Tab Tổ chức chỉ quản lý nhân sự; Tab Phân quyền hiển thị toàn bộ Room.
- Card/avatar summary phản ánh dữ liệu thật.
- Drawer chỉnh một/nhiều nhân viên, lưu một lần, lỗi giữ draft.
- Chỉ admin thay đổi Room.
- Recipient picker bắt buộc Room + action.
- Backend/RLS từ chối direct call sai Room.
- Room action không bypass assignment hoặc workflow state.
- Legacy grant có snapshot và mapping/`unclassified`; không biến mất âm thầm.
- Không còn projection generic hai chiều trong Dự án sau cleanup.
- `npm test`, `npm run lint`, `npm run build` và SQL smoke suite đều pass.
