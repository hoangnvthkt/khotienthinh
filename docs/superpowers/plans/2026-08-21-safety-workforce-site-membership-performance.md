# Safety Workforce Site Membership and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển Safety Passport sang hồ sơ nhân công gốc + membership theo công trường, bảo đảm mỗi người chỉ có một assignment active toàn hệ thống, backfill 54 hồ sơ vào Công trường Sơn Miền Bắc và giảm tải màn hình từ hàng trăm request xuống các read model có cache theo scope.

**Architecture:** Postgres giữ invariant bằng membership UUID, assignment history, partial unique index và các RPC nguyên tử có kiểm tra quyền theo project/site. React chỉ gọi read/command RPC scoped, dùng cache memory `Map + TTL`, batch-sign ảnh roster và lazy-load hồ sơ nhạy cảm. Frontend được cutover trước; direct grants/RLS legacy chỉ bị siết trong migration promotion riêng sau khi UAT xác nhận giao diện mới đã deploy.

**Tech Stack:** React 18, TypeScript 5.8, Vite 6, Vitest 4, Supabase JS 2.98, Supabase CLI 2.95.6, Supabase Cloud Postgres, private Supabase Storage, Tailwind utility classes.

**Spec:** `docs/superpowers/specs/2026-08-21-safety-workforce-site-membership-performance-design.md`

## Global Constraints

- Không sử dụng sub-agent; thực hiện inline theo `superpowers:executing-plans` vì `AGENTS.md` cấm sub-agent.
- Mọi thao tác Supabase dùng project Cloud đã link và cấu hình `.env`; không chạy Supabase local và không dùng Docker.
- Trước mỗi schema change, chạy `npx supabase migration new <name>`; không tự đặt timestamp migration.
- Không đưa `service_role`, secret key hoặc database password vào frontend, test fixture, log hay commit.
- RLS/RPC là ranh giới bảo mật; filter frontend và cache không được dùng làm authorization.
- `construction_site_id` canonical mới là UUID FK tới `public.hrm_construction_sites(id)`; các cột Safety legacy dạng `text` chỉ giữ để tương thích trong giai đoạn cutover.
- Một worker có tối đa một `safety_project_assignments.assignment_status = 'active'` trên toàn hệ thống.
- Nhà thầu phụ/Tổ đội lấy trực tiếp từ `safety_subcontractors` và `safety_teams` đúng project/site; không ghi mới vào `safety_contractors`.
- Profile, CCCD, sức khỏe, bảo hiểm và chứng chỉ là dữ liệu gốc; không nhân bản theo assignment.
- Cache chỉ ở memory và key luôn chứa `userId|projectId|constructionSiteId`; không dùng `localStorage`, IndexedDB hoặc cache offline cho dữ liệu Safety Workforce.
- Signed URL không được persist, không dùng làm cache key và không xuất hiện trong database payload/audit log.
- Backfill phải dừng nếu snapshot Cloud không còn đúng 54 profile, nếu có CCCD chuẩn hóa trùng hoặc nếu assignment hiện hữu nằm ngoài Sơn Miền Bắc.
- Tạm dừng thao tác tạo/gán hồ sơ Safety Passport từ lúc chạy preflight rollout cuối đến khi frontend mới deploy xong; nếu không có cửa sổ bảo trì này thì không chạy backfill.
- Không tự cấp Safety Card trong backfill.
- Không chạy RLS cutover trước khi frontend mới đã deploy và UAT A/B site đạt yêu cầu.
- Giữ nguyên mọi thay đổi không liên quan đang có trong worktree.

---

## File Structure

### Database, audits and Cloud verification

- Create via CLI `supabase migration new safety_workforce_membership_foundation`: thêm worker kind/identity normalization, membership, assignment history columns, indexes và helper authorization.
- Create via CLI `supabase migration new safety_workforce_scoped_read_api`: thêm dashboard, roster, detail, exact lookup, card lookup và master-option RPC.
- Create via CLI `supabase migration new safety_workforce_scoped_commands`: thêm profile/document/assignment/transfer/card command RPC nguyên tử.
- Create via CLI `supabase migration new safety_workforce_son_mien_bac_backfill`: backfill 54 membership, 53 assignment, liên kết assignment cũ và thay constraint legacy.
- Create `supabase/audits/safety_workforce_son_mien_bac_preflight.sql`: query read-only, chỉ in aggregate/count và mapping status.
- Create `supabase/audits/safety_workforce_performance.sql`: EXPLAIN/`pg_stat_statements` cho read model mới.
- Create `supabase/tests/safety_workforce_site_membership_smoke.sql`: Cloud smoke chạy trong transaction và rollback.
- Create `supabase/pending_migrations/safety_workforce_rls_cutover_after_uat.sql`: thu hồi direct grants, thay policy Storage/profile legacy sau UAT.

### Domain, client and cache

- Modify `types.ts:6049-6282`: thêm worker kind, membership, assignment lifecycle, scoped roster/detail/capability và command input types.
- Create `lib/safetyWorkforceModel.ts`: parse payload RPC, chuẩn hóa cursor/filter và map error code ổn định.
- Create `lib/safetyWorkforceCache.ts`: promise deduplication, TTL, scope invalidation và clear khi đổi actor.
- Create `lib/safetyWorkforceApi.ts`: gọi RPC scoped, batch-sign ảnh, upload file theo worker và invalidate cache sau command.
- Create `hooks/useSafetyWorkforce.ts`: hook resource theo key/`enabled`, reset data ngay khi đổi site và không mount loader ngoài view.
- Modify `lib/safetyPassportService.ts`: giữ helper QR/status dùng chung, dừng các list/mutation direct-table đã được thay bằng scoped API.
- Remove `hooks/useSafetyPassport.ts` sau khi không còn consumer.

### UI

- Create `components/project/safety/passport/SafetyPassportDashboardView.tsx`: dashboard chỉ dùng aggregate RPC.
- Create `components/project/safety/passport/SafetyWorkerRosterView.tsx`: roster membership, search/filter/cursor và mở form B1.
- Create `components/project/safety/passport/SafetyActiveWorkforceView.tsx`: assignment active, gán/end/transfer và thao tác thẻ.
- Create `components/project/safety/passport/SafetyWorkerProfileForm.tsx`: form hồ sơ gốc + membership, Nhà thầu phụ/Tổ đội scoped.
- Create `components/project/safety/passport/SafetyWorkerAssignmentDialog.tsx`: B2 gán worker, exact lookup và transfer vào site hiện tại.
- Create `components/project/safety/passport/SafetyWorkerCardSection.tsx`: cấp/in/gia hạn/thu hồi thẻ trong hồ sơ.
- Create `components/project/safety/passport/SafetyWorkerHistory.tsx`: lịch sử assignment/card của membership hiện tại.
- Modify `components/project/safety/SafetyPassportWorkerDetailModal.tsx`: orchestrate basic/sensitive/assignment/card/history và lazy-load sensitive section.
- Modify `components/project/safety/SafetyPassportWorkerTable.tsx`: render scoped page từ server, không filter toàn bộ dataset trong client.
- Modify `components/project/safety/SafetyPassportPanel.tsx`: shell chọn đúng view; không mount sáu hook cùng lúc.
- Modify `pages/project/SafetyTab.tsx:41-58,554-584`: bỏ navigation `passportCards`; giữ Nhà thầu phụ/Tổ đội là master site.
- Modify `pages/SafetyCardLookup.tsx`: lookup QR qua scoped authenticated RPC.

### Tests

- Create `lib/__tests__/safetyWorkforceModel.test.ts`.
- Create `lib/__tests__/safetyWorkforceCache.test.ts`.
- Create `lib/__tests__/safetyWorkforceApi.test.ts`.
- Create `lib/__tests__/safetyWorkforceFoundationMigration.test.ts`.
- Create `lib/__tests__/safetyWorkforceReadApiMigration.test.ts`.
- Create `lib/__tests__/safetyWorkforceCommandMigration.test.ts`.
- Create `lib/__tests__/safetyWorkforceBackfillMigration.test.ts`.
- Create `lib/__tests__/safetyWorkforceRlsCutover.test.ts`.
- Create `lib/__tests__/safetyWorkforceUiContract.test.ts`.
- Create `components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx`.
- Modify `lib/__tests__/safetyPassportService.test.ts` để giữ regression cho helper QR/status và bỏ expectation direct-table.

---

### Task 1: Add scoped Safety Workforce domain contracts

**Files:**
- Modify: `types.ts:6049-6282`
- Create: `lib/safetyWorkforceModel.ts`
- Test: `lib/__tests__/safetyWorkforceModel.test.ts`

**Interfaces:**
- Produces:

```ts
export type SafetyWorkerKind = 'company_staff' | 'contractor_worker';
export type SafetyMembershipStatus = 'candidate' | 'active' | 'inactive';
export type SafetyAssignmentLifecycleStatus = 'active' | 'ended' | 'suspended' | 'cancelled';
export type SafetyWorkforceErrorCode =
  | 'SAFETY_SCOPE_REQUIRED'
  | 'SAFETY_SCOPE_MISMATCH'
  | 'SAFETY_WORKER_ACTIVE_ELSEWHERE'
  | 'SAFETY_CONTRACTOR_SCOPE_MISMATCH'
  | 'SAFETY_TEAM_SCOPE_MISMATCH'
  | 'SAFETY_ASSIGNMENT_NOT_ELIGIBLE'
  | 'SAFETY_ACTIVE_CARD_EXISTS'
  | 'SAFETY_TRANSFER_PERMISSION_REQUIRED';

export interface SafetyWorkforceCursor {
  createdAt: string;
  id: string;
}

export interface SafetyWorkforceCapabilities {
  canViewBasic: boolean;
  canManageWorker: boolean;
  canVerifyDocuments: boolean;
}

export interface SafetyRosterFilters {
  search?: string;
  membershipStatus?: SafetyMembershipStatus;
  assignmentStatus?: SafetyAssignmentLifecycleStatus;
  eligibilityStatus?: SafetyPassportAssignmentStatus;
  documentStatus?: 'missing' | 'expired';
  cursor?: SafetyWorkforceCursor;
  limit: number;
}

export interface SafetyWorkerSiteMembership {
  id: string;
  workerId: string;
  projectId: string;
  constructionSiteId: string;
  defaultSubcontractorId: string | null;
  defaultTeamId: string | null;
  status: SafetyMembershipStatus;
  firstJoinedAt: string;
  lastLeftAt: string | null;
  source: 'manual' | 'transfer' | 'son_mien_bac_backfill_v1';
}

export interface SafetyWorkerRosterItem {
  membership: SafetyWorkerSiteMembership;
  worker: Pick<SafetyWorkerProfile, 'id' | 'workerCode' | 'fullName' | 'phone' | 'status'> & {
    workerKind: SafetyWorkerKind;
    photoStoragePath: string | null;
    photoUrl?: string | null;
  };
  subcontractor: Pick<SafetySubcontractor, 'id' | 'name' | 'code' | 'status'> | null;
  team: Pick<SafetyTeam, 'id' | 'name' | 'code' | 'status'> | null;
  activeAssignment: SafetyProjectAssignment | null;
  activeCard: SafetyCard | null;
  identityNumberMasked: string;
  profileStatus: SafetyPassportDocumentReadiness;
  healthStatus: SafetyPassportDocumentReadiness;
  insuranceStatus: SafetyPassportDocumentReadiness;
}

export interface SafetyWorkerRosterPage {
  items: SafetyWorkerRosterItem[];
  nextCursor: SafetyWorkforceCursor | null;
  capabilities: SafetyWorkforceCapabilities;
}

export interface SafetySiteWorkforceOptions {
  subcontractors: Array<Pick<SafetySubcontractor, 'id' | 'name' | 'code' | 'status'>>;
  teams: Array<Pick<SafetyTeam, 'id' | 'name' | 'code' | 'status' | 'subcontractorId'>>;
}

export interface SafetyWorkforceDashboard {
  totalWorkers: number;
  activeAssignments: number;
  eligibleAssignments: number;
  missingProfile: number;
  missingCertificate: number;
  expiredCertificate: number;
  missingSiteRequirement: number;
  suspendedAssignments: number;
  expiringCertificates7Days: number;
  expiringCertificates30Days: number;
  expiredCertificates: number;
  expiringCards30Days: number;
  problematicSubcontractors: Array<{ id: string; name: string; issueCount: number }>;
}

export interface SafetyWorkerDetailProfile {
  id: string;
  workerCode: string;
  fullName: string;
  workerKind: SafetyWorkerKind;
  phone: string | null;
  dateOfBirth: string | null;
  roleName: string | null;
  status: SafetyPassportWorkerStatus;
  photoAttachment: SafetyAttachment | null;
  identityType?: 'cccd' | 'passport' | 'other';
  identityNumber?: string | null;
  identityIssueDate?: string | null;
  identityIssuePlace?: string | null;
  permanentAddress?: string | null;
}

export interface SafetyWorkerDetailPayload {
  rosterItem: SafetyWorkerRosterItem;
  profile: SafetyWorkerDetailProfile;
  documents: SafetyWorkerDocument[];
  certificates: SafetyWorkerCertificate[];
  assignments: SafetyProjectAssignment[];
  cards: SafetyCard[];
  capabilities: SafetyWorkforceCapabilities;
  sensitiveLoaded: boolean;
}

export interface SafetyWorkerLookupResult {
  workerId: string;
  workerCode: string;
  fullName: string;
  identityNumberMasked: string;
  targetMembershipId: string | null;
  activeAssignmentId: string | null;
  activeSiteName: string | null;
  canTransfer: boolean;
}

export interface SafetyCreateWorkerForSiteInput {
  workerKind: SafetyWorkerKind;
  profile: {
    workerCode?: string;
    fullName: string;
    phone?: string | null;
    dateOfBirth?: string | null;
    identityType: 'cccd' | 'passport' | 'other';
    identityNumber?: string | null;
    identityIssueDate?: string | null;
    identityIssuePlace?: string | null;
    permanentAddress?: string | null;
    roleName?: string | null;
  };
  subcontractorId: string | null;
  teamId: string | null;
}

export type SafetyWorkerProfilePatch = Partial<SafetyCreateWorkerForSiteInput['profile']> & {
  photoAttachment?: SafetyAttachment | null;
};

export type SafetyWorkerDocumentPatch = Pick<SafetyWorkerDocument,
  'documentType' | 'name' | 'issueDate' | 'expiryDate' | 'attachments' | 'status' | 'isRequired'> & {
  id?: string;
};

export interface SafetyAssignWorkerInput {
  membershipId: string;
  startedAt: string;
  subcontractorId: string | null;
  teamId: string | null;
  roleName?: string | null;
  workType?: string | null;
}

export interface SafetyTransferWorkerInput {
  assignmentId: string;
  sourceProjectId: string;
  sourceConstructionSiteId: string;
  targetProjectId: string;
  targetConstructionSiteId: string;
  startedAt: string;
  subcontractorId: string | null;
  teamId: string | null;
}
```

- Extend `SafetyWorkerProfile` with `workerKind` and optional `identityNumberNormalized`.
- Extend `SafetyProjectAssignment` with `membershipId`, `assignmentStatus`, `startedAt`, `endedAt`, `subcontractorId`, `teamId`, `endedBy`, `endedReason` and `source` while retaining legacy fields until cleanup.
- `parseSafetyWorkforceError(error)` returns `{ code: SafetyWorkforceErrorCode | 'UNKNOWN'; message: string }` by matching the stable `SAFETY_*` token in the Supabase error message/detail.

- [ ] **Step 1: Write failing model tests**

```ts
it('parses scoped roster payload without inventing sensitive fields', () => {
  const page = parseSafetyWorkerRosterPage({
    items: [{ membership: { id: 'm1', workerId: 'w1' }, worker: { id: 'w1', workerCode: 'W-1', fullName: 'A', workerKind: 'contractor_worker', photoStoragePath: 'w1/photo/a.jpg' } }],
    nextCursor: { createdAt: '2026-08-21T00:00:00Z', id: 'm1' },
    capabilities: { canViewBasic: true, canManageWorker: false, canVerifyDocuments: false },
  });

  expect(page.items[0].worker.photoStoragePath).toBe('w1/photo/a.jpg');
  expect(page.items[0].worker).not.toHaveProperty('identityNumber');
});

it('extracts the active-elsewhere business code', () => {
  expect(parseSafetyWorkforceError({ message: 'SAFETY_WORKER_ACTIVE_ELSEWHERE: worker is assigned' }).code)
    .toBe('SAFETY_WORKER_ACTIVE_ELSEWHERE');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run lib/__tests__/safetyWorkforceModel.test.ts`

Expected: FAIL because the new types and parser do not exist.

- [ ] **Step 3: Add the types and strict parsers**

Implement `parseSafetyWorkforceDashboard`, `parseSafetyWorkerRosterPage`, `parseSafetyWorkerDetailPayload`, `parseSafetySiteWorkforceOptions` and `parseSafetyWorkforceError`. Default missing arrays to `[]`, but throw `Error('SAFETY_INVALID_RPC_PAYLOAD')` when required scope IDs or worker IDs are absent; never copy unknown JSON keys into typed list items.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run lib/__tests__/safetyWorkforceModel.test.ts lib/__tests__/safetyPassportService.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit domain contracts**

```bash
git add types.ts lib/safetyWorkforceModel.ts lib/__tests__/safetyWorkforceModel.test.ts
git commit -m "feat: add scoped safety workforce contracts"
```

---

### Task 2: Add memory cache, promise deduplication and scope invalidation

**Files:**
- Create: `lib/safetyWorkforceCache.ts`
- Test: `lib/__tests__/safetyWorkforceCache.test.ts`

**Interfaces:**

```ts
export type SafetyWorkforceResource = 'dashboard' | 'roster' | 'active' | 'detail' | 'options' | 'card_lookup';

export interface SafetyWorkforceCacheScope {
  userId: string;
  projectId: string;
  constructionSiteId: string;
}

export function buildSafetyWorkforceCacheKey(
  scope: SafetyWorkforceCacheScope,
  resource: SafetyWorkforceResource,
  variant?: Record<string, string | number | boolean | null | undefined>,
): string;

export function getSafetyWorkforceCached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T>;
export function invalidateSafetyWorkforceScope(scope: SafetyWorkforceCacheScope, resources?: SafetyWorkforceResource[]): void;
export function setSafetyWorkforceCacheActor(userId: string | null): void;
export function clearSafetyWorkforceCache(): void;
```

- [ ] **Step 1: Write failing cache tests**

Cover same-key promise deduplication, TTL expiry with fake timers, site/user key separation, resource-only invalidation, immutable cached payloads and automatic full clear when actor changes.

```ts
it('deduplicates concurrent reads for the same scoped key', async () => {
  const loader = vi.fn(async () => ({ items: ['a'] }));
  const key = buildSafetyWorkforceCacheKey(
    { userId: 'u1', projectId: 'p1', constructionSiteId: 's1' },
    'roster',
  );
  const [first, second] = await Promise.all([
    getSafetyWorkforceCached(key, 60_000, loader),
    getSafetyWorkforceCached(key, 60_000, loader),
  ]);
  expect(loader).toHaveBeenCalledTimes(1);
  expect(first).toEqual(second);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run lib/__tests__/safetyWorkforceCache.test.ts`

Expected: FAIL because `safetyWorkforceCache.ts` does not exist.

- [ ] **Step 3: Implement the cache**

Use two module-level maps: `entries: Map<string, { expiresAt: number; value: unknown }>` and `inflight: Map<string, Promise<unknown>>`. Sort `variant` keys before JSON serialization. Delete failed promises in `finally`, deep-freeze successful plain-object/array payloads before storing, return the immutable reference to consumers, and never write browser storage.

TTL constants used later:

```ts
export const SAFETY_WORKFORCE_TTL = {
  dashboard: 20_000,
  roster: 45_000,
  active: 30_000,
  detail: 30_000,
  options: 5 * 60_000,
  card_lookup: 30_000,
} as const;
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `npx vitest run lib/__tests__/safetyWorkforceCache.test.ts`

Expected: PASS with no timer leaks.

- [ ] **Step 5: Commit cache infrastructure**

```bash
git add lib/safetyWorkforceCache.ts lib/__tests__/safetyWorkforceCache.test.ts
git commit -m "feat: add scoped safety workforce cache"
```

---

### Task 3: Create the membership and assignment-history foundation migration

**Files:**
- Create via CLI: migration ending `_safety_workforce_membership_foundation.sql`
- Test: `lib/__tests__/safetyWorkforceFoundationMigration.test.ts`

**Interfaces:**
- Produces `public.safety_worker_site_memberships` and canonical assignment lifecycle columns.
- Produces private helpers:

```sql
app_private.safety_workforce_normalize_identity(p_value text) returns text
app_private.safety_workforce_assert_scope(p_project_id text, p_construction_site_id uuid) returns void
app_private.safety_workforce_can_view(p_project_id text, p_construction_site_id uuid) returns boolean
app_private.safety_workforce_can_manage(p_project_id text, p_construction_site_id uuid) returns boolean
app_private.safety_workforce_can_view_sensitive(p_project_id text, p_construction_site_id uuid) returns boolean
app_private.safety_workforce_can_access_worker_storage(p_worker_id uuid, p_sensitive boolean, p_write boolean) returns boolean
app_private.safety_workforce_assert_subcontractor_team(p_project_id text, p_construction_site_id uuid, p_subcontractor_id uuid, p_team_id uuid, p_worker_kind text) returns void
```

- Permission helpers include explicit-scope Admin/Module Admin DA and otherwise call `app_private.project_has_permission_v2` with `project.safety.view`, `project.safety.worker_manage` or `project.safety.document_verify`.

- [ ] **Step 1: Write the failing migration contract test**

Discover the CLI-generated migration by suffix:

```ts
const file = readdirSync(resolve(process.cwd(), 'supabase/migrations'))
  .find(name => name.endsWith('_safety_workforce_membership_foundation.sql'));

it('creates canonical membership and one-active-worker protection', () => {
  expect(file).toBeDefined();
  expect(sql).toContain('create table public.safety_worker_site_memberships');
  expect(sql).toContain('identity_number_normalized');
  expect(sql).toContain('safety_worker_assignments_one_active_idx');
  expect(sql).toContain("where assignment_status = 'active'");
  expect(sql).toContain('project.safety.worker_manage');
  expect(sql).toContain('project.safety.document_verify');
  expect(sql).toContain("set search_path = ''");
  expect(sql).not.toMatch(/service_role/i);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npx vitest run lib/__tests__/safetyWorkforceFoundationMigration.test.ts`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Generate the migration with the installed CLI**

Run:

```bash
npx supabase migration new safety_workforce_membership_foundation
```

Expected: one new empty file under `supabase/migrations/` ending `_safety_workforce_membership_foundation.sql`.

- [ ] **Step 4: Implement additive schema and indexes**

The migration must:

```sql
alter table public.safety_worker_profiles
  add column if not exists worker_kind text,
  add column if not exists identity_number_normalized text;

create table public.safety_worker_site_memberships (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.safety_worker_profiles(id) on delete restrict,
  project_id text not null references public.projects(id) on delete restrict,
  construction_site_id uuid not null references public.hrm_construction_sites(id) on delete restrict,
  default_subcontractor_id uuid references public.safety_subcontractors(id) on delete set null,
  default_team_id uuid references public.safety_teams(id) on delete set null,
  status text not null default 'candidate' check (status in ('candidate','active','inactive')),
  first_joined_at timestamptz not null default now(),
  last_left_at timestamptz,
  source text not null default 'manual' check (source in ('manual','transfer','son_mien_bac_backfill_v1')),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_id, construction_site_id)
);

alter table public.safety_project_assignments
  add column if not exists membership_id uuid references public.safety_worker_site_memberships(id) on delete restrict,
  add column if not exists assignment_status text,
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists subcontractor_id uuid references public.safety_subcontractors(id) on delete set null,
  add column if not exists team_id uuid references public.safety_teams(id) on delete set null,
  add column if not exists ended_by uuid references public.users(id) on delete set null,
  add column if not exists ended_reason text,
  add column if not exists source text;

create unique index if not exists safety_worker_assignments_one_active_idx
  on public.safety_project_assignments(worker_id)
  where assignment_status = 'active';

create index if not exists safety_memberships_site_status_created_idx
  on public.safety_worker_site_memberships(construction_site_id, status, created_at desc, id desc);
create index if not exists safety_memberships_worker_idx
  on public.safety_worker_site_memberships(worker_id);
create index if not exists safety_assignments_membership_started_idx
  on public.safety_project_assignments(membership_id, started_at desc, id desc);
```

Add indexes for every new FK, checks for worker kind/assignment status/date order, identity normalization trigger, partial unique identity index, updated-at trigger and RLS on membership. Wrap non-`IF NOT EXISTS` constraints in `pg_constraint` checks. New Storage policies may grant basic photo/sensitive access through membership helpers, but the old policy remains until cutover.

Assignment `source` check accepts `manual | legacy | transfer | son_mien_bac_backfill_v1`; commands write `manual/transfer`, while only the existing assignment uses `legacy` during backfill.

- [ ] **Step 5: Run contract tests and commit**

Run: `npx vitest run lib/__tests__/safetyWorkforceFoundationMigration.test.ts`

Expected: PASS.

```bash
git add supabase/migrations/*_safety_workforce_membership_foundation.sql lib/__tests__/safetyWorkforceFoundationMigration.test.ts
git commit -m "feat: add safety workforce membership foundation"
```

---

### Task 4: Add scoped read-model RPCs

**Files:**
- Create via CLI: migration ending `_safety_workforce_scoped_read_api.sql`
- Test: `lib/__tests__/safetyWorkforceReadApiMigration.test.ts`

**Interfaces:**

```sql
public.get_safety_passport_dashboard(p_project_id text, p_construction_site_id uuid) returns jsonb
public.list_safety_site_worker_roster(
  p_project_id text,
  p_construction_site_id uuid,
  p_search text default null,
  p_membership_status text default null,
  p_assignment_status text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
public.get_safety_site_worker_detail(
  p_project_id text,
  p_construction_site_id uuid,
  p_membership_id uuid,
  p_include_sensitive boolean default false
) returns jsonb
public.lookup_safety_worker_exact(
  p_project_id text,
  p_construction_site_id uuid,
  p_worker_code text default null,
  p_identity_type text default null,
  p_identity_number text default null
) returns jsonb
public.list_safety_site_workforce_options(p_project_id text, p_construction_site_id uuid) returns jsonb
public.get_safety_card_by_qr(p_qr_token text) returns jsonb
```

All public functions are `security invoker` wrappers with `set search_path = ''`; privileged row assembly stays in `app_private`, is `security definer`, validates current actor and exact project/site before reading tables.

- [ ] **Step 1: Write the failing read-API contract test**

Assert every signature, `security invoker`, private definer placement, keyset predicate, `greatest(1, least(p_limit, 100))`, scoped joins through membership, no `select *`, no identity/document JSON in roster, and exact lookup requiring `safety_workforce_can_manage`.

```ts
const rosterSql = sql.slice(
  sql.indexOf('create or replace function app_private.list_safety_site_worker_roster'),
  sql.indexOf('create or replace function app_private.get_safety_site_worker_detail'),
);
expect(sql).toMatch(/\(membership\.created_at, membership\.id\)\s*<\s*\(p_cursor_created_at, p_cursor_id\)/);
expect(sql).toContain('app_private.safety_workforce_can_manage');
expect(sql).toContain('photoStoragePath');
expect(rosterSql).not.toContain('identity_attachments');
expect(rosterSql).not.toContain('identity_number');
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npx vitest run lib/__tests__/safetyWorkforceReadApiMigration.test.ts`

Expected: FAIL because the read migration does not exist.

- [ ] **Step 3: Generate and implement the read migration**

Run:

```bash
npx supabase migration new safety_workforce_scoped_read_api
```

Roster SQL orders by `membership.created_at desc, membership.id desc`, returns `p_limit + 1` internally and emits a cursor only when another row exists. Active view filters assignment with `assignment_status = 'active'`. Detail joins only the requested membership; assignment/card history is limited to that membership. When `p_include_sensitive = false`, document/certificate arrays are empty and profile JSON omits raw identity data. When true, the private function first requires `project.safety.worker_manage` or `project.safety.document_verify`.

Options read only active/approved site records:

```sql
select jsonb_build_object(
  'subcontractors', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', subcontractor.id,
      'name', subcontractor.name,
      'code', subcontractor.code,
      'status', subcontractor.status
    ) order by subcontractor.name)
    from public.safety_subcontractors subcontractor
    where subcontractor.project_id = p_project_id
      and subcontractor.construction_site_id = p_construction_site_id::text
      and subcontractor.status in ('approved','active')
  ), '[]'::jsonb),
  'teams', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', team.id,
      'name', team.name,
      'code', team.code,
      'status', team.status,
      'subcontractorId', team.subcontractor_id
    ) order by team.name)
    from public.safety_teams team
    where team.project_id = p_project_id
      and team.construction_site_id = p_construction_site_id::text
      and team.status = 'active'
  ), '[]'::jsonb)
);
```

Exact lookup accepts either exact worker code or normalized identity, never `%`, prefix or fuzzy matching, returns one minimal candidate and records an audit event without identity value. QR lookup requires an authenticated active actor and view permission at the card membership scope.

- [ ] **Step 4: Verify read contracts**

Run:

```bash
npx vitest run lib/__tests__/safetyWorkforceReadApiMigration.test.ts lib/__tests__/safetyWorkforceFoundationMigration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit scoped reads**

```bash
git add supabase/migrations/*_safety_workforce_scoped_read_api.sql lib/__tests__/safetyWorkforceReadApiMigration.test.ts
git commit -m "feat: add scoped safety workforce read api"
```

---

### Task 5: Add atomic profile, assignment, transfer and card commands

**Files:**
- Create via CLI: migration ending `_safety_workforce_scoped_commands.sql`
- Test: `lib/__tests__/safetyWorkforceCommandMigration.test.ts`

**Interfaces:**

```sql
public.create_safety_worker_profile_for_site(p_project_id text, p_construction_site_id uuid, p_worker_kind text, p_profile jsonb, p_subcontractor_id uuid default null, p_team_id uuid default null) returns jsonb
public.update_safety_worker_profile_for_site(p_membership_id uuid, p_profile jsonb) returns jsonb
public.upsert_safety_worker_documents_for_site(p_membership_id uuid, p_documents jsonb) returns jsonb
public.assign_safety_worker_to_site(p_membership_id uuid, p_started_at timestamptz, p_subcontractor_id uuid default null, p_team_id uuid default null, p_assignment jsonb default '{}'::jsonb) returns jsonb
public.update_safety_worker_assignment(p_assignment_id uuid, p_patch jsonb) returns jsonb
public.end_safety_worker_assignment(p_assignment_id uuid, p_ended_at timestamptz, p_reason text) returns jsonb
public.transfer_safety_worker_site(p_assignment_id uuid, p_target_project_id text, p_target_construction_site_id uuid, p_started_at timestamptz, p_subcontractor_id uuid default null, p_team_id uuid default null) returns jsonb
public.issue_safety_assignment_card(p_assignment_id uuid, p_expires_at date, p_template_id uuid default null) returns jsonb
public.renew_safety_assignment_card(p_card_id uuid, p_expires_at date) returns jsonb
public.revoke_safety_assignment_card(p_card_id uuid, p_reason text) returns jsonb
public.log_safety_card_print(p_card_id uuid) returns jsonb
```

- [ ] **Step 1: Write failing command migration tests**

Test for stable `SAFETY_*` errors, worker row lock before active-assignment check, ordered source/target membership locks in transfer, card revoke inside end/transfer, site subcontractor/team validation, no caller-supplied actor ID, private `security definer`, public `security invoker`, explicit grants and active-card uniqueness.

```ts
expect(sql).toMatch(/from public\.safety_worker_profiles[\s\S]+for update/);
expect(sql).toContain('SAFETY_WORKER_ACTIVE_ELSEWHERE');
expect(sql).toContain('order by membership.id for update');
expect(sql).toContain("status = 'revoked'");
expect(sql).not.toMatch(/p_actor(_user)?_id/i);
```

- [ ] **Step 2: Run command tests and verify RED**

Run: `npx vitest run lib/__tests__/safetyWorkforceCommandMigration.test.ts`

Expected: FAIL because the command migration does not exist.

- [ ] **Step 3: Generate the migration**

Run:

```bash
npx supabase migration new safety_workforce_scoped_commands
```

- [ ] **Step 4: Implement commands and invariants**

Every public wrapper derives actor from `public.current_app_user_id()`. Create/reuse checks exact global worker code and normalized identity, creates one membership with `on conflict (worker_id, construction_site_id) do update`, and does not create an active assignment. Contractor workers require a valid site subcontractor; company staff force subcontractor/team null.

Assignment/transfer commands lock the worker first. Transfer locks both membership rows ordered by UUID, ends the source, revokes its active card, activates/creates target membership and inserts target assignment in one function call. End/transfer set `ended_at`, `ended_by`, `ended_reason`, membership status and `last_left_at` together.

Initialize a sequence from existing `SAFE-CARD-*` values and generate codes inside Postgres:

```sql
create sequence if not exists public.safety_card_code_seq;
create unique index if not exists safety_cards_one_active_per_assignment_idx
  on public.safety_cards(assignment_id)
  where status = 'active';

v_card_code := 'SAFE-CARD-' || lpad(nextval('public.safety_card_code_seq')::text, 5, '0');
```

Renew inserts `safety_audit_logs` metadata with old/new expiry; print command inserts `safety_card_print_logs` and increments `printed_count` atomically. Revoke/end/transfer always require a non-empty reason. Commands return the scoped detail/read-model JSON rather than requiring client-side follow-up joins.

- [ ] **Step 5: Verify and commit commands**

Run:

```bash
npx vitest run lib/__tests__/safetyWorkforceCommandMigration.test.ts lib/__tests__/safetyWorkforceReadApiMigration.test.ts
```

Expected: PASS.

```bash
git add supabase/migrations/*_safety_workforce_scoped_commands.sql lib/__tests__/safetyWorkforceCommandMigration.test.ts
git commit -m "feat: add atomic safety workforce commands"
```

---

### Task 6: Add Sơn Miền Bắc preflight and idempotent backfill

**Files:**
- Create: `supabase/audits/safety_workforce_son_mien_bac_preflight.sql`
- Create via CLI: migration ending `_safety_workforce_son_mien_bac_backfill.sql`
- Test: `lib/__tests__/safetyWorkforceBackfillMigration.test.ts`

**Interfaces:**
- Preflight returns aggregate columns only: `site_count`, `project_count`, `profile_count`, `duplicate_identity_count`, `unmapped_contractor_count`, `ambiguous_team_count`, `assignment_outside_target_count`.
- Migration marker is exactly `son_mien_bac_backfill_v1`.

- [ ] **Step 1: Write failing backfill contract tests**

```ts
expect(preflightSql).toContain('begin read only');
expect(preflightSql).not.toMatch(/identity_number\s*(,|as)/i);
expect(sql).toContain("v_expected_profile_count constant integer := 54");
expect(sql).toContain("'son_mien_bac_backfill_v1'");
expect(sql).toContain('SAFETY_BACKFILL_PROFILE_COUNT_CHANGED');
expect(sql).toContain('SAFETY_BACKFILL_DUPLICATE_IDENTITY');
expect(sql).toContain('SAFETY_BACKFILL_ASSIGNMENT_OUTSIDE_TARGET');
expect(sql).toContain('drop constraint safety_project_assignments_active_unique');
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run lib/__tests__/safetyWorkforceBackfillMigration.test.ts`

Expected: FAIL because the audit and migration files do not exist.

- [ ] **Step 3: Create read-only preflight and run it on Cloud**

Generate the migration first:

```bash
npx supabase migration new safety_workforce_son_mien_bac_backfill
npx supabase db query --linked --agent=no --file supabase/audits/safety_workforce_son_mien_bac_preflight.sql
```

Expected preflight: `site_count=1`, `project_count=1`, `profile_count=54`, and all four error counts equal `0`. If any value differs, stop before editing/running the backfill migration and re-audit the changed rows.

- [ ] **Step 4: Implement idempotent backfill**

Resolve the site by trimmed/collapsed case-insensitive name `Công trường Sơn Miền Bắc`, require exactly one linked project, map legacy contractor name to exactly one `safety_subcontractors` row at target site, and map team only when `(subcontractor_id, normalized team name)` is unique.

Backfill rules:

```sql
update public.safety_worker_profiles worker
set worker_kind = case when worker.contractor_id is null then 'company_staff' else 'contractor_worker' end,
    identity_number_normalized = app_private.safety_workforce_normalize_identity(worker.identity_number),
    updated_at = now();

-- All 54 profiles receive one durable target membership.
insert into public.safety_worker_site_memberships (
  worker_id, project_id, construction_site_id,
  default_subcontractor_id, default_team_id, status,
  first_joined_at, source
)
select worker.id, v_target_project_id, v_target_site_id,
       mapped.subcontractor_id, mapped.team_id, 'active',
       now(), 'son_mien_bac_backfill_v1'
from public.safety_worker_profiles worker
left join pg_temp.safety_worker_backfill_map mapped on mapped.worker_id = worker.id
on conflict (worker_id, construction_site_id) do update
set default_subcontractor_id = excluded.default_subcontractor_id,
    default_team_id = excluded.default_team_id,
    status = 'active',
    updated_at = now();

-- Existing assignment keeps its ID and receives membership/lifecycle snapshots.
update public.safety_project_assignments assignment
set membership_id = membership.id,
    assignment_status = 'active',
    started_at = coalesce(assignment.started_at, assignment.start_date::timestamp at time zone 'Asia/Ho_Chi_Minh'),
    subcontractor_id = mapped.subcontractor_id,
    team_id = mapped.team_id,
    source = coalesce(assignment.source, 'legacy')
from public.safety_worker_site_memberships membership
left join pg_temp.safety_worker_backfill_map mapped on mapped.worker_id = membership.worker_id
where assignment.worker_id = membership.worker_id
  and membership.construction_site_id = v_target_site_id;

-- Only workers with no assignment receive a new active row.
insert into public.safety_project_assignments (
  worker_id, project_id, construction_site_id,
  role_name, start_date, membership_id, assignment_status,
  started_at, subcontractor_id, team_id, source
)
select worker.id, v_target_project_id, v_target_site_id::text,
       worker.role_name, current_date, membership.id, 'active',
       now(), mapped.subcontractor_id, mapped.team_id,
       'son_mien_bac_backfill_v1'
from public.safety_worker_profiles worker
join public.safety_worker_site_memberships membership
  on membership.worker_id = worker.id
 and membership.construction_site_id = v_target_site_id
left join pg_temp.safety_worker_backfill_map mapped on mapped.worker_id = worker.id
where not exists (select 1 from public.safety_project_assignments existing where existing.worker_id = worker.id);
```

Build `pg_temp.safety_worker_backfill_map` from the preflight-approved unique legacy-contractor/team mappings before these statements. Then recompute eligibility for all 54 assignments, assert 54 memberships, 54 active assignments and exactly 53 rows with backfill assignment source. Set `worker_kind`, `membership_id`, `assignment_status`, `started_at` and `source` to their final not-null/check constraints; keep `identity_number_normalized` nullable with its partial unique index; drop unique legacy `(worker_id, project_id, construction_site_id)`, preserve the global partial active index, and never insert a card.

- [ ] **Step 5: Verify and commit backfill artifacts**

Run:

```bash
npx vitest run lib/__tests__/safetyWorkforceBackfillMigration.test.ts lib/__tests__/safetyWorkforceFoundationMigration.test.ts
git diff --check
```

Expected: PASS and no whitespace errors.

```bash
git add supabase/audits/safety_workforce_son_mien_bac_preflight.sql supabase/migrations/*_safety_workforce_son_mien_bac_backfill.sql lib/__tests__/safetyWorkforceBackfillMigration.test.ts
git commit -m "feat: backfill safety workforce to Son Mien Bac"
```

---

### Task 7: Prepare Cloud smoke tests and inspect rollout without mutation

**Files:**
- Create: `supabase/tests/safety_workforce_site_membership_smoke.sql`
- Modify only if verification exposes a defect: the four Safety Workforce migrations and their contract tests.

**Interfaces:**
- Cloud state after task is unchanged; this task performs read-only preflight, migration dry-run and advisor baseline only.
- Smoke test always begins `begin; set local statement_timeout = '30s';` and ends `rollback;`.

- [ ] **Step 1: Write the Cloud smoke test before push**

The smoke transaction must resolve authenticated actors through JWT claims and prove:

- target roster count is 54;
- a different site roster does not return Sơn Miền Bắc membership rows;
- direct second active assignment fails with the unique index;
- assign to another site returns `SAFETY_WORKER_ACTIVE_ELSEWHERE`;
- invalid contractor/team scope returns the matching stable error;
- end/transfer rollback leaves source unchanged when a later validation fails;
- card issue is rejected when eligibility is not `eligible`;
- the transaction leaves row counts unchanged after rollback.

- [ ] **Step 2: Run all migration contract tests**

Run:

```bash
npx vitest run \
  lib/__tests__/safetyWorkforceFoundationMigration.test.ts \
  lib/__tests__/safetyWorkforceReadApiMigration.test.ts \
  lib/__tests__/safetyWorkforceCommandMigration.test.ts \
  lib/__tests__/safetyWorkforceBackfillMigration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Inspect the Cloud rollout set**

Run:

```bash
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

Expected: dry-run lists exactly the four new Safety Workforce migrations. If it lists any unrelated migration, stop and reconcile migration history before push; do not use `--include-all` to force unrelated files.

- [ ] **Step 4: Re-run read-only Cloud preflight and advisor baseline**

Run:

```bash
npx supabase db query --linked --agent=no --file supabase/audits/safety_workforce_son_mien_bac_preflight.sql
npx supabase db advisors --linked --type security --level error --fail-on none
npx supabase db advisors --linked --type performance --level error --fail-on none
```

Expected: preflight remains `site_count=1`, `project_count=1`, `profile_count=54`, all error counts `0`; advisor outputs are saved in the execution log for comparison after rollout. Do not run `db push` in this task.

- [ ] **Step 5: Commit smoke test and any verified correction**

```bash
git add supabase/tests/safety_workforce_site_membership_smoke.sql supabase/migrations/*_safety_workforce_*.sql lib/__tests__/safetyWorkforceFoundationMigration.test.ts lib/__tests__/safetyWorkforceReadApiMigration.test.ts lib/__tests__/safetyWorkforceCommandMigration.test.ts lib/__tests__/safetyWorkforceBackfillMigration.test.ts
git commit -m "test: add safety workforce cloud smoke coverage"
```

---

### Task 8: Add the scoped client API and batch Storage signing

**Files:**
- Create: `lib/safetyWorkforceApi.ts`
- Test: `lib/__tests__/safetyWorkforceApi.test.ts`
- Modify: `lib/safetyPassportService.ts`
- Modify: `lib/__tests__/safetyPassportService.test.ts`

**Interfaces:**

```ts
export type SafetyWorkforceRequestScope = SafetyWorkforceCacheScope;

export const safetyWorkforceApi = {
  getDashboard(scope: SafetyWorkforceRequestScope): Promise<SafetyWorkforceDashboard>;
  listRoster(scope: SafetyWorkforceRequestScope, filters: SafetyRosterFilters): Promise<SafetyWorkerRosterPage>;
  getDetail(scope: SafetyWorkforceRequestScope, membershipId: string, includeSensitive: boolean): Promise<SafetyWorkerDetailPayload>;
  lookupExact(scope: SafetyWorkforceRequestScope, input: { workerCode?: string; identityType?: string; identityNumber?: string }): Promise<SafetyWorkerLookupResult | null>;
  listOptions(scope: SafetyWorkforceRequestScope): Promise<SafetySiteWorkforceOptions>;
  createProfile(scope: SafetyWorkforceRequestScope, input: SafetyCreateWorkerForSiteInput): Promise<SafetyWorkerDetailPayload>;
  updateProfile(scope: SafetyWorkforceRequestScope, membershipId: string, patch: SafetyWorkerProfilePatch): Promise<SafetyWorkerDetailPayload>;
  saveDocuments(scope: SafetyWorkforceRequestScope, membershipId: string, documents: SafetyWorkerDocumentPatch[]): Promise<SafetyWorkerDetailPayload>;
  assign(scope: SafetyWorkforceRequestScope, input: SafetyAssignWorkerInput): Promise<SafetyWorkerDetailPayload>;
  endAssignment(scope: SafetyWorkforceRequestScope, assignmentId: string, endedAt: string, reason: string): Promise<SafetyWorkerDetailPayload>;
  transfer(scope: SafetyWorkforceRequestScope, input: SafetyTransferWorkerInput): Promise<SafetyWorkerDetailPayload>;
  issueCard(scope: SafetyWorkforceRequestScope, assignmentId: string, expiresAt: string, templateId?: string): Promise<SafetyWorkerDetailPayload>;
  renewCard(scope: SafetyWorkforceRequestScope, cardId: string, expiresAt: string): Promise<SafetyWorkerDetailPayload>;
  revokeCard(scope: SafetyWorkforceRequestScope, cardId: string, reason: string): Promise<SafetyWorkerDetailPayload>;
  logCardPrint(scope: SafetyWorkforceRequestScope, cardId: string): Promise<void>;
  lookupCard(qrToken: string, userId: string): Promise<SafetyCard | null>;
  uploadWorkerAttachment(workerId: string, category: string, file: File): Promise<SafetyAttachment>;
};
```

- [ ] **Step 1: Write failing API tests with Supabase mocks**

Test exact RPC names/`p_` parameters, UUID site usage, parser calls, scoped cache keys, `createSignedUrls(paths, 300)` once per roster page, no identity signing on list, and invalidation rules for profile/assignment/transfer/card mutations.

```ts
expect(supabaseMocks.rpc).toHaveBeenCalledWith('list_safety_site_worker_roster', expect.objectContaining({
  p_project_id: 'p1',
  p_construction_site_id: 's1',
  p_limit: 50,
}));
expect(supabaseMocks.createSignedUrls).toHaveBeenCalledTimes(1);
expect(supabaseMocks.createSignedUrls).toHaveBeenCalledWith(['w1/photo/a.jpg'], 300);
```

- [ ] **Step 2: Run API tests and verify RED**

Run: `npx vitest run lib/__tests__/safetyWorkforceApi.test.ts`

Expected: FAIL because the API module does not exist.

- [ ] **Step 3: Implement scoped reads and batch signing**

Reject empty `projectId`/`constructionSiteId` before RPC with `SAFETY_SCOPE_REQUIRED`. Wrap cached reads with TTL from Task 2. After roster parse, deduplicate non-null `photoStoragePath`, call one `createSignedUrls` request and merge URLs by returned `path`; a failed individual path gets `photoUrl: null` without failing the page. Detail signs photo and requested sensitive attachment paths in one batch only after `includeSensitive=true` response.

- [ ] **Step 4: Implement commands and invalidation**

Mutation invalidation matrix:

```ts
const INVALIDATION = {
  profile: ['roster', 'detail', 'dashboard'],
  assignment: ['roster', 'active', 'detail', 'dashboard'],
  card: ['active', 'detail', 'dashboard'],
} as const;
```

Transfer invalidates both source and destination scopes. `setSafetyWorkforceCacheActor` is called before each read. Upload path is `${workerId}/${category}/${crypto.randomUUID()}-${safeFileName}`; profile creation happens before upload so no `draft` folder is needed. Keep QR/status pure helpers in `safetyPassportService.ts`, but new API must not call `listWorkers`, `listProjectWorkerRows`, `listCards`, `assignWorkerToProject`, `saveWorkerDetail` or direct card insert.

- [ ] **Step 5: Verify and commit client API**

Run:

```bash
npx vitest run lib/__tests__/safetyWorkforceApi.test.ts lib/__tests__/safetyWorkforceCache.test.ts lib/__tests__/safetyPassportService.test.ts
```

Expected: PASS.

```bash
git add lib/safetyWorkforceApi.ts lib/safetyPassportService.ts lib/__tests__/safetyWorkforceApi.test.ts lib/__tests__/safetyPassportService.test.ts
git commit -m "feat: add scoped safety workforce client api"
```

---

### Task 9: Add resource hooks that reset on scope changes

**Files:**
- Create: `hooks/useSafetyWorkforce.ts`
- Test: `lib/__tests__/safetyWorkforceUiContract.test.ts`

**Interfaces:**

```ts
export interface SafetyResourceState<T> {
  data: T | null;
  loading: boolean;
  error: ReturnType<typeof parseSafetyWorkforceError> | null;
  reload: () => Promise<void>;
}

export function useSafetyDashboard(scope: SafetyWorkforceRequestScope): SafetyResourceState<SafetyWorkforceDashboard>;
export function useSafetyRoster(scope: SafetyWorkforceRequestScope, filters: SafetyRosterFilters): SafetyResourceState<SafetyWorkerRosterPage>;
export function useSafetyActiveWorkforce(scope: SafetyWorkforceRequestScope, filters: SafetyRosterFilters): SafetyResourceState<SafetyWorkerRosterPage>;
export function useSafetyWorkerDetail(scope: SafetyWorkforceRequestScope, membershipId: string | null, includeSensitive: boolean): SafetyResourceState<SafetyWorkerDetailPayload>;
export function useSafetyWorkforceOptions(scope: SafetyWorkforceRequestScope, enabled: boolean): SafetyResourceState<SafetySiteWorkforceOptions>;
```

- [ ] **Step 1: Add failing hook/source contracts**

The source contract must prove the new hook imports `safetyWorkforceApi`, accepts `enabled`, resets data before a changed request key loads, ignores a stale promise response and never imports/calls `safetyPassportService.listWorkers`.

```ts
expect(source).toContain('requestVersionRef');
expect(source).toContain('setData(null)');
expect(source).toContain('enabled');
expect(source).not.toContain('listWorkers()');
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npx vitest run lib/__tests__/safetyWorkforceUiContract.test.ts`

Expected: FAIL because `hooks/useSafetyWorkforce.ts` does not exist.

- [ ] **Step 3: Implement the hooks**

Create one internal `useSafetyResource(key, loader, enabled)` that increments `requestVersionRef`, calls `setData(null)` synchronously when key changes, and only commits result/error if its version is still current. `useSafetyActiveWorkforce` calls the same roster API with `assignmentStatus: 'active'`; no second client-side fan-out is allowed. Options hook remains disabled until a form/dialog opens.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npx vitest run lib/__tests__/safetyWorkforceUiContract.test.ts lib/__tests__/safetyWorkforceApi.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit hooks**

```bash
git add hooks/useSafetyWorkforce.ts lib/__tests__/safetyWorkforceUiContract.test.ts
git commit -m "feat: add conditional safety workforce hooks"
```

---

### Task 10: Split the panel into conditional dashboard, roster and active views

**Files:**
- Create: `components/project/safety/passport/SafetyPassportDashboardView.tsx`
- Create: `components/project/safety/passport/SafetyWorkerRosterView.tsx`
- Create: `components/project/safety/passport/SafetyActiveWorkforceView.tsx`
- Modify: `components/project/safety/SafetyPassportPanel.tsx:263-571`
- Test: `components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx`
- Modify: `lib/__tests__/safetyWorkforceUiContract.test.ts`

**Interfaces:**

```ts
export type SafetyPassportMode = 'passport' | 'passportWorkers' | 'passportAssignments';

interface ScopedViewProps {
  scope: SafetyWorkforceRequestScope;
  currentUser: User;
}
```

`SafetyPassportPanel` constructs `scope` from `currentUser.id`, `projectId` and required `constructionSiteId`, then renders exactly one child component.

- [ ] **Step 1: Write failing rendering and source tests**

Use `renderToStaticMarkup` with data props for each presentational branch and a source contract for the panel:

```ts
expect(panelSource).toContain("mode === 'passport'");
expect(panelSource).toContain('<SafetyPassportDashboardView');
expect(panelSource).toContain('<SafetyWorkerRosterView');
expect(panelSource).toContain('<SafetyActiveWorkforceView');
expect(panelSource).not.toContain('useSafetyCards(');
expect(panelSource).not.toContain('reloadAll');
```

Dashboard markup must contain Nhân công, Đang tham gia, Đủ điều kiện and Cần xử lý. Empty scope must render an explicit “Chưa chọn công trường” state and make zero data calls.

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```bash
npx vitest run components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx lib/__tests__/safetyWorkforceUiContract.test.ts
```

Expected: FAIL because the split views do not exist and the panel still mounts six hooks.

- [ ] **Step 3: Implement dashboard and conditional shell**

Move dashboard markup into `SafetyPassportDashboardView`, call only `useSafetyDashboard` there, and show an error retry without falling back to legacy global queries. Create roster/active shells that call only their corresponding hook; mutation dialogs remain unimplemented buttons until Tasks 11–13.

- [ ] **Step 4: Verify request-boundary contracts**

Run:

```bash
npx vitest run components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx lib/__tests__/safetyWorkforceUiContract.test.ts
npm run lint
```

Expected: PASS and TypeScript succeeds.

- [ ] **Step 5: Commit conditional views**

```bash
git add components/project/safety/passport components/project/safety/SafetyPassportPanel.tsx lib/__tests__/safetyWorkforceUiContract.test.ts
git commit -m "refactor: load only the active safety passport view"
```

---

### Task 11: Implement B1 roster and scoped profile creation

**Files:**
- Modify: `components/project/safety/passport/SafetyWorkerRosterView.tsx`
- Create: `components/project/safety/passport/SafetyWorkerProfileForm.tsx`
- Modify: `components/project/safety/SafetyPassportWorkerDetailModal.tsx`
- Modify: `components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx`
- Modify: `lib/__tests__/safetyWorkforceUiContract.test.ts`

**Interfaces:**

```ts
export interface SafetyCreateWorkerForSiteInput {
  workerKind: SafetyWorkerKind;
  profile: {
    workerCode?: string;
    fullName: string;
    phone?: string | null;
    dateOfBirth?: string | null;
    identityType: 'cccd' | 'passport' | 'other';
    identityNumber?: string | null;
    identityIssueDate?: string | null;
    identityIssuePlace?: string | null;
    permanentAddress?: string | null;
    roleName?: string | null;
  };
  subcontractorId: string | null;
  teamId: string | null;
}
```

- [ ] **Step 1: Add failing B1 UI tests**

Tests must show:

- roster renders only `SafetyWorkerRosterItem` from the current scope;
- changing search/status calls server filters instead of `.filter(rows)`;
- create form has `Cán bộ công ty` and `Nhân công nhà thầu`;
- contractor worker requires a subcontractor;
- team options are restricted to selected `subcontractorId`;
- company staff clears contractor/team;
- options are not loaded until form opens;
- list never renders raw CCCD.

- [ ] **Step 2: Run B1 tests and verify RED**

Run: `npx vitest run components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx lib/__tests__/safetyWorkforceUiContract.test.ts`

Expected: FAIL because the B1 form and server-driven roster are not implemented.

- [ ] **Step 3: Implement server-driven roster**

Debounce search by 250 ms, reset cursor on filters, and append the next page only when its scope/filter key matches. Columns/cards use worker code, name, phone, membership status, scoped subcontractor/team, active assignment status and photo URL. Do not read `worker.contractorId`, `worker.teamName`, `identityAttachments` or documents on the list.

- [ ] **Step 4: Implement profile-first upload flow**

On save:

1. Call `createProfile` to atomically create/reuse profile and candidate membership.
2. Use returned worker ID to upload photo/CCCD/health/insurance files under `${workerId}/${category}/${crypto.randomUUID()}-${safeFileName}`.
3. Call `updateProfile` for `photoAttachment` metadata and `saveDocuments` for document descriptors.
4. If upload fails after step 1, keep the candidate membership, show “Hồ sơ đã tạo, còn file chưa tải xong” and keep the dialog open for retry; never delete the profile automatically.
5. Invalidate only current roster/detail/dashboard.

Exact lookup runs before reuse when worker code/CCCD is entered. A found global profile is shown with minimal masked data and creates only the target membership; the form never displays another site’s history.

- [ ] **Step 5: Verify and commit B1**

Run:

```bash
npx vitest run components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx lib/__tests__/safetyWorkforceApi.test.ts lib/__tests__/safetyWorkforceUiContract.test.ts
npm run lint
```

Expected: PASS.

```bash
git add components/project/safety/passport/SafetyWorkerRosterView.tsx components/project/safety/passport/SafetyWorkerProfileForm.tsx components/project/safety/SafetyPassportWorkerDetailModal.tsx components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx lib/__tests__/safetyWorkforceUiContract.test.ts
git commit -m "feat: add scoped safety worker profile flow"
```

---

### Task 12: Implement B2 assignment, ending and transfer flows

**Files:**
- Modify: `components/project/safety/passport/SafetyActiveWorkforceView.tsx`
- Create: `components/project/safety/passport/SafetyWorkerAssignmentDialog.tsx`
- Modify: `components/project/safety/SafetyPassportWorkerTable.tsx`
- Modify: `components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx`
- Modify: `lib/__tests__/safetyWorkforceUiContract.test.ts`

**Interfaces:**

```ts
export interface SafetyAssignWorkerInput {
  membershipId: string;
  startedAt: string;
  subcontractorId: string | null;
  teamId: string | null;
  roleName?: string | null;
  workType?: string | null;
}

export interface SafetyTransferWorkerInput {
  assignmentId: string;
  sourceProjectId: string;
  sourceConstructionSiteId: string;
  targetProjectId: string;
  targetConstructionSiteId: string;
  startedAt: string;
  subcontractorId: string | null;
  teamId: string | null;
}
```

- [ ] **Step 1: Write failing B2 tests**

Prove candidate/inactive memberships are selectable, active current rows are excluded from the picker, exact lookup can locate a profile without target membership, contractor/team options use only the target site, `SAFETY_WORKER_ACTIVE_ELSEWHERE` shows End/Transfer guidance, end requires date/reason, and transfer button is shown only when the RPC capability permits it.

- [ ] **Step 2: Run B2 tests and verify RED**

Run: `npx vitest run components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx`

Expected: FAIL because assignment/transfer UI is not wired.

- [ ] **Step 3: Implement active worker table and assignment dialog**

`SafetyActiveWorkforceView` requests `assignmentStatus: 'active'` from the server. Search/status/document filters become RPC parameters; do not fetch all documents to filter locally. The table receives `SafetyWorkerRosterItem[]`, shows masked readiness fields returned by the read model and emits `onOpenDetail`, `onEnd`, `onTransfer`, `onIssueCard` callbacks.

Assignment dialog defaults `startedAt` to current time, filters teams by subcontractor, calls `assign`, and maps stable error codes to Vietnamese copy. It must not pre-check global active state as a security decision; the RPC remains authoritative.

- [ ] **Step 4: Implement end and transfer confirmations**

End requires a non-empty reason and `endedAt >= startedAt`. Transfer target is the current Project/Site, uses the active source assignment returned by exact lookup, requires manage permission on both scopes from RPC, and calls one `transfer` command. On success, source and target cache scopes are invalidated before closing the dialog.

- [ ] **Step 5: Verify and commit B2**

Run:

```bash
npx vitest run components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx lib/__tests__/safetyWorkforceApi.test.ts
npm run lint
```

Expected: PASS.

```bash
git add components/project/safety/passport/SafetyActiveWorkforceView.tsx components/project/safety/passport/SafetyWorkerAssignmentDialog.tsx components/project/safety/SafetyPassportWorkerTable.tsx components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx lib/__tests__/safetyWorkforceUiContract.test.ts
git commit -m "feat: add safety worker assignment and transfer flow"
```

---

### Task 13: Implement lazy sensitive detail, history and embedded Safety Card

**Files:**
- Modify: `components/project/safety/SafetyPassportWorkerDetailModal.tsx`
- Create: `components/project/safety/passport/SafetyWorkerCardSection.tsx`
- Create: `components/project/safety/passport/SafetyWorkerHistory.tsx`
- Modify: `components/project/safety/SafetyPassportCardPreview.tsx`
- Modify: `components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx`
- Modify: `lib/__tests__/safetyWorkforceUiContract.test.ts`

**Interfaces:**
- Detail initially calls `getDetail(scope, membershipId, false)`.
- Opening “Giấy tờ & chứng chỉ” calls `getDetail(scope, membershipId, true)` exactly once per detail cache TTL and only when `canManageWorker || canVerifyDocuments`.
- Card section consumes the active assignment/card embedded in detail; it never calls a global card list.

- [ ] **Step 1: Write failing detail/card tests**

Tests must prove basic profile renders before sensitive data, unauthorized actors do not render raw identity/documents, sensitive section triggers lazy load, membership history only contains current site, card controls are inside detail, issue requires active+eligible, renew requires future expiry, revoke requires reason and print logs before `window.print()`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx lib/__tests__/safetyWorkforceUiContract.test.ts`

Expected: FAIL because card/history sections do not exist and detail still eagerly calls the legacy profile loader.

- [ ] **Step 3: Refactor detail loading and document save**

Remove the effect calling `safetyPassportService.getWorkerProfile`. Render sections from `SafetyWorkerDetailPayload`. Sensitive section uses storage paths returned only by authorized detail RPC, batch-signed by the API. Editing profile/documents uses scoped commands; uploads occur under the existing worker ID. On permission error, clear sensitive state immediately and collapse the section.

- [ ] **Step 4: Add embedded card and history sections**

`SafetyWorkerCardSection` states:

- no active assignment: read-only “Không có phân công đang hoạt động”;
- active but not eligible: show exact missing eligibility reason and disable issue;
- eligible/no active card: issue with expiry/template;
- active card: preview, QR, expiry, print count, Gia hạn, Thu hồi, In;
- ended assignment history: show card code/status without mutation buttons.

`SafetyWorkerHistory` orders assignments by `startedAt desc`, displays subcontractor/team snapshot, start/end/reason and cards for each assignment. It receives only the current membership history from the RPC.

- [ ] **Step 5: Verify and commit B3**

Run:

```bash
npx vitest run components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx lib/__tests__/safetyWorkforceApi.test.ts lib/__tests__/safetyPassportService.test.ts
npm run lint
```

Expected: PASS.

```bash
git add components/project/safety/SafetyPassportWorkerDetailModal.tsx components/project/safety/SafetyPassportCardPreview.tsx components/project/safety/passport/SafetyWorkerCardSection.tsx components/project/safety/passport/SafetyWorkerHistory.tsx components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx lib/__tests__/safetyWorkforceUiContract.test.ts
git commit -m "feat: embed safety cards in worker detail"
```

---

### Task 14: Remove the standalone card route from Safety navigation and retire global loaders

**Files:**
- Modify: `pages/project/SafetyTab.tsx:41-58,554-584`
- Modify: `pages/SafetyCardLookup.tsx`
- Modify: `components/project/safety/SafetyPassportPanel.tsx`
- Modify: `lib/safetyPassportService.ts`
- Remove: `hooks/useSafetyPassport.ts`
- Modify: `lib/__tests__/safetyWorkforceUiContract.test.ts`
- Modify: `lib/__tests__/routeAccess.test.ts`

**Interfaces:**
- Safety Project navigation retains `passport`, `passportWorkers`, `passportAssignments`, `contractors`, `teams`.
- Authenticated `/safety-card/:qrToken` remains and calls `safetyWorkforceApi.lookupCard`; it is not a public anonymous capability.

- [ ] **Step 1: Add failing cutover contracts**

```ts
expect(safetyTabSource).not.toContain("passportCards: { label: 'Thẻ an toàn'");
expect(safetyTabSource).not.toContain('mode="passportCards"');
expect(panelSource).not.toContain("'passportCards'");
expect(cardLookupSource).toContain('safetyWorkforceApi.lookupCard');
expect(cardLookupSource).not.toContain('getCardByQrToken');
expect(safetyTabSource).toContain("if (view === 'overview') void loadSummary()");
expect(existsSync(resolve(process.cwd(), 'hooks/useSafetyPassport.ts'))).toBe(false);
```

- [ ] **Step 2: Run contracts and verify RED**

Run: `npx vitest run lib/__tests__/safetyWorkforceUiContract.test.ts lib/__tests__/routeAccess.test.ts`

Expected: FAIL because standalone card navigation and legacy hook still exist.

- [ ] **Step 3: Cut over navigation and QR lookup**

Remove `passportCards` from `SafetyView`, `VIEW_CONFIG`, `VIEW_GROUPS` and render branches. Do not remove site master `contractors` or `teams`. Initialize `view` from a validated `safetyView` query parameter and call `loadSummary()` automatically only when `view === 'overview'`, so a direct roster/assignment open does not add the unrelated Safety Overview request. Change QR page to authenticated scoped card RPC and retain existing not-found/revoked display behavior.

- [ ] **Step 4: Retire direct-table consumers**

Delete `hooks/useSafetyPassport.ts`. Remove unused direct global methods from `safetyPassportService.ts` after `rg` confirms no consumers: `listDashboard`, `listWorkers`, `getWorkerProfile`, `listProjectAssignments`, `listProjectWorkerRows`, `listCards`, `getCardByQrToken`, `assignWorkerToProject`, `saveWorkerDetail`, direct card issue/log methods and legacy contractor list/upsert. Keep pure exported helpers referenced by UI/tests.

Run:

```bash
rg -n "listWorkers\(|listProjectWorkerRows\(|listCards\(|getCardByQrToken\(|saveWorkerDetail\(" . --glob '*.{ts,tsx}' --glob '!node_modules/**'
```

Expected: no runtime consumer; test descriptions may mention removed names only in negative assertions.

- [ ] **Step 5: Verify and commit frontend cutover**

Run:

```bash
npx vitest run lib/__tests__/safetyWorkforceUiContract.test.ts lib/__tests__/routeAccess.test.ts lib/__tests__/safetyPassportService.test.ts
npm run lint
npm run build
```

Expected: all commands succeed.

```bash
git add pages/project/SafetyTab.tsx pages/SafetyCardLookup.tsx components/project/safety/SafetyPassportPanel.tsx lib/safetyPassportService.ts hooks/useSafetyPassport.ts lib/__tests__/safetyWorkforceUiContract.test.ts lib/__tests__/routeAccess.test.ts
git commit -m "refactor: cut over safety passport to scoped workforce api"
```

---

### Task 15: Run the coordinated Cloud backfill and frontend rollout

**Files:**
- Consume: the four Safety Workforce migrations, Cloud preflight/smoke SQL and the production build from Tasks 3–14.
- No new file is required unless verification reveals a defect.

**Interfaces:**
- Rollout window begins with Safety Passport writes paused and ends only after the new frontend is deployed and basic A/B smoke passes.
- Cloud target immediately after migration push: 54 Sơn Miền Bắc memberships, 54 active assignments, 53 new backfill assignments and zero backfill cards.

- [ ] **Step 1: Run the final pre-rollout gate**

Run:

```bash
npx vitest run lib/__tests__/safetyWorkforceFoundationMigration.test.ts lib/__tests__/safetyWorkforceReadApiMigration.test.ts lib/__tests__/safetyWorkforceCommandMigration.test.ts lib/__tests__/safetyWorkforceBackfillMigration.test.ts lib/__tests__/safetyWorkforceApi.test.ts lib/__tests__/safetyWorkforceUiContract.test.ts
npm run lint
npm run build
npx supabase db query --linked --agent=no --file supabase/audits/safety_workforce_son_mien_bac_preflight.sql
npx supabase db push --linked --dry-run
```

Expected: tests/build pass, preflight is still `54/0 errors`, and dry-run lists exactly the four Safety Workforce migrations.

- [ ] **Step 2: Obtain the rollout window confirmation**

Stop and ask the user to confirm both conditions:

1. Safety Passport create/assign operations are paused for the rollout window.
2. The built frontend commit is ready to be deployed immediately after the migration push by the authorized release operator.

Do not mutate Cloud until both confirmations are explicit.

- [ ] **Step 3: Push the four migrations and verify backfill**

Run:

```bash
npx supabase db push --linked --yes
npx supabase migration list --linked
npx supabase db query --linked --agent=no --file supabase/tests/safety_workforce_site_membership_smoke.sql
npx supabase db query --linked --agent=no --file supabase/audits/safety_workforce_son_mien_bac_preflight.sql
```

Expected: four migrations recorded; the smoke transaction asserts 54 target memberships, 54 active assignments, zero active duplicates and no auto-issued card before rolling back; the read-only preflight still reports the original snapshot/mapping checks as valid.

- [ ] **Step 4: Deploy the already-built frontend**

Hand the verified commit/build to the authorized release operator through the project’s existing release workflow and wait for deployment confirmation. The repository does not define a deployment command, so do not invent or run an external publishing command without user authorization.

- [ ] **Step 5: Run immediate rollout smoke and reopen writes**

With authenticated browser sessions, verify Sơn Miền Bắc roster shows 54 workers, another site does not show them, switching views does not call global profile queries, and create/assign dialogs load current-site subcontractor/team options. If any check fails, keep Safety Passport writes paused and fix/rollback using the backfill marker; reopen writes only after these checks pass.

---

### Task 16: Prepare and promote RLS/Storage cutover after UAT

**Files:**
- Create: `supabase/pending_migrations/safety_workforce_rls_cutover_after_uat.sql`
- Create: `lib/__tests__/safetyWorkforceRlsCutover.test.ts`
- Later create via CLI after UAT: migration ending `_safety_workforce_rls_cutover.sql`

**Interfaces:**
- Pending SQL has a guard that requires 54/54 target memberships, 54/54 active assignments, zero active duplicates, all public scoped RPCs present and no `safety_card` document created after the foundation migration.
- Cutover revokes direct authenticated access that can recreate global browsing; scoped public wrappers remain executable.

- [ ] **Step 1: Write failing RLS cutover contract**

Assert the pending file:

- revokes direct select/write on profile, documents, certificates, assignments, cards and legacy contractors;
- revokes execute on legacy mutation/read RPCs such as `recompute_safety_assignment_eligibility` that bypass the new command boundary;
- grants execute only for named scoped wrappers;
- drops old global Admin/Module Admin Safety Passport policies;
- replaces Storage policies using worker-folder UUID + photo/sensitive capability;
- keeps bucket private;
- uses `security_invoker = true` for any view;
- includes UPDATE-compatible SELECT policies;
- emits `notify pgrst, 'reload schema'`.

- [ ] **Step 2: Run contract and verify RED**

Run: `npx vitest run lib/__tests__/safetyWorkforceRlsCutover.test.ts`

Expected: FAIL because the pending cutover file does not exist.

- [ ] **Step 3: Write guarded pending SQL**

Follow `supabase/pending_migrations/README.md`: the file is intentionally excluded from `db push`. Storage select rule allows category `photo` with basic membership view; identity/health/insurance/certificate paths require sensitive capability. Insert/update/delete require `project.safety.worker_manage` at at least one membership scope for the worker folder. The promotion guard counts referenced objects whose top folder is not a worker UUID and aborts if the count is non-zero; do not silently orphan a legacy attachment when dropping the old policy.

Direct table grants after cutover:

```sql
revoke select, insert, update, delete on public.safety_worker_profiles from authenticated;
revoke select, insert, update, delete on public.safety_worker_documents from authenticated;
revoke select, insert, update, delete on public.safety_worker_certificates from authenticated;
revoke select, insert, update, delete on public.safety_project_assignments from authenticated;
revoke select, insert, update, delete on public.safety_cards from authenticated;
revoke select, insert, update, delete on public.safety_contractors from authenticated;
```

The private definer functions keep table access; authenticated receives execute only on public invoker wrappers and required upload Storage operations.

- [ ] **Step 4: Run pre-promotion UAT checkpoint**

Before moving the pending SQL, complete these external checks on the deployed frontend:

1. Actor limited to site A cannot view site B roster/detail/card.
2. Actor with both sites sees only the selected site per request.
3. Module Admin DA sees an explicitly selected site, not union rows.
4. B1 profile creation uses current site contractor/team.
5. B2 blocks a second active site and transfer works atomically.
6. B3 issue/print/renew/revoke works inside detail.
7. QR route still requires login.

Stop here and request user confirmation that the frontend bundle is deployed and UAT passed. Do not promote or execute cutover on an assumption.

- [ ] **Step 5: Promote with CLI, push and verify**

After explicit confirmation:

```bash
npx supabase migration new safety_workforce_rls_cutover
```

Copy the reviewed pending SQL verbatim into the CLI-generated migration, remove the pending file, then run:

```bash
npx vitest run lib/__tests__/safetyWorkforceRlsCutover.test.ts
npx supabase db push --linked --dry-run
npx supabase db push --linked --yes
npx supabase db query --linked --agent=no --file supabase/tests/safety_workforce_site_membership_smoke.sql
npx supabase db advisors --linked --type security --level error --fail-on none
```

Expected: only the cutover migration is pushed; A/B smoke and security advisor pass.

```bash
git add supabase/migrations/*_safety_workforce_rls_cutover.sql supabase/pending_migrations/safety_workforce_rls_cutover_after_uat.sql lib/__tests__/safetyWorkforceRlsCutover.test.ts
git commit -m "security: enforce scoped safety workforce access"
```

---

### Task 17: Verify performance, security and full regression

**Files:**
- Create: `supabase/audits/safety_workforce_performance.sql`
- Modify only for defects found: Safety Workforce files from Tasks 1–15.

**Interfaces:**
- Performance audit reports only aggregate timing/query text normalized by `pg_stat_statements`; it must not select PII.
- Request targets from the spec:
  - roster first open: one roster RPC + one batch photo signing request;
  - active list first open: one roster RPC + one batch photo signing request;
  - options: one RPC only after form/dialog opens;
  - sensitive attachments: zero requests before sensitive detail opens;
  - within TTL: zero duplicate read request;
  - site switch: zero stale row flash.

- [ ] **Step 1: Add the performance audit SQL**

Include:

```sql
select calls,
       round(total_exec_time::numeric, 2) as total_time_ms,
       round(mean_exec_time::numeric, 2) as mean_time_ms,
       query
from pg_stat_statements
where query ilike any (array[
  '%list_safety_site_worker_roster%',
  '%get_safety_site_worker_detail%',
  '%get_safety_passport_dashboard%'
])
order by total_exec_time desc;
```

Also include `explain (analyze, buffers, format text)` for roster membership/site/status/order and active assignment joins using the dynamically resolved Sơn Miền Bắc site/project, with no identity/document columns.

- [ ] **Step 2: Run the complete automated suite**

Run:

```bash
npx vitest run \
  lib/__tests__/safetyWorkforceModel.test.ts \
  lib/__tests__/safetyWorkforceCache.test.ts \
  lib/__tests__/safetyWorkforceApi.test.ts \
  lib/__tests__/safetyWorkforceFoundationMigration.test.ts \
  lib/__tests__/safetyWorkforceReadApiMigration.test.ts \
  lib/__tests__/safetyWorkforceCommandMigration.test.ts \
  lib/__tests__/safetyWorkforceBackfillMigration.test.ts \
  lib/__tests__/safetyWorkforceRlsCutover.test.ts \
  lib/__tests__/safetyWorkforceUiContract.test.ts \
  components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx \
  lib/__tests__/safetyPassportService.test.ts \
  lib/__tests__/safetyService.test.ts \
  lib/__tests__/routeAccess.test.ts
npm run lint
npm run build
```

Expected: all Vitest files pass, TypeScript exits 0 and Vite production build succeeds.

- [ ] **Step 3: Run fresh Cloud verification**

Run:

```bash
npx supabase migration list --linked
npx supabase db query --linked --agent=no --file supabase/tests/safety_workforce_site_membership_smoke.sql
npx supabase db query --linked --agent=no --file supabase/audits/safety_workforce_son_mien_bac_preflight.sql
npx supabase db query --linked --agent=no --file supabase/audits/safety_workforce_performance.sql
npx supabase db advisors --linked --type security --level error --fail-on none
npx supabase db advisors --linked --type performance --level error --fail-on none
```

Expected: migration history aligned; smoke rollback passes; preflight remains `54/0 errors`; read plans use membership/assignment indexes; no new advisor error.

- [ ] **Step 4: Measure browser request boundaries**

Open the deployed/local Vite UI with an authenticated session and record Network requests for:

1. first open Hồ sơ nhân công;
2. switch Hồ sơ → Nhân công CT → Hồ sơ within 45 seconds;
3. open create form;
4. open basic detail;
5. expand sensitive documents;
6. switch between Sơn Miền Bắc and another site.

Fail verification if list view triggers per-worker signed URL calls, any global `safety_worker_profiles?select=*` request, sensitive URL requests before expansion, duplicate same-key RPC within TTL or site-A rows after site-B selection.

- [ ] **Step 5: Review diff and commit final audit**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~1
```

Expected: no whitespace errors and only intended Safety Workforce/audit files changed.

If verification required a code or SQL correction, commit that correction with its focused tests before committing the audit file; do not mix an unverified fix into the audit-only commit.

```bash
git add supabase/audits/safety_workforce_performance.sql
git commit -m "test: verify safety workforce performance"
```

---

## Execution Checkpoints

1. **After Task 6:** review all four migrations and preflight output before any Cloud mutation.
2. **After Task 7:** confirm dry-run contains exactly four Safety Workforce migrations; Cloud data remains unchanged.
3. **After Task 14:** run full build and prepare the verified frontend commit for the coordinated rollout; chưa deploy trước backfill.
4. **At Task 15 Step 2:** require explicit confirmation of the write freeze and immediate frontend deployment window before pushing migrations.
5. **Before Task 16 Step 5:** require explicit user confirmation that A/B site UAT passed; pending RLS SQL must not be auto-promoted.
6. **After Task 17:** compare request count and `pg_stat_statements` evidence to the original audit before declaring the module complete.
