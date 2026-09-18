# Authorization V2 — Request Cohort Gate and Pilot-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Workspace policy prohibits sub-agents, so execute with the primary agent only. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa cohort Request từ `owner_pending` tới trạng thái có quyết định owner, readiness kỹ thuật đã được chứng minh và sẵn sàng cho một pilot V2 có thời hạn — không tạo manifest thu hồi, không thu hồi compatibility shell và không mở Task 13.

**Architecture:** `task12-4-2-owner-decisions.json` là nguồn quyết định nghiệp vụ; blueprint chỉ là tập capability đề xuất và không tự cấp quyền. Catalog Cloud quyết định readiness từng capability; UI, RLS và RPC phải cùng thực thi một boundary trước khi capability được nâng lên `enforced` hoặc `verified`. Chỉ sau approval + readiness, template/assignment mới đi qua các command V2 có preview, fingerprint, audit và revoke.

**Tech Stack:** React 18, TypeScript 5.8, Vitest 4, PostgreSQL/Supabase Cloud main, Supabase CLI 2.117.0.

**Spec:** `docs/security/authorization-v2-task12-4-2-handoff-2026-09-18.md`, `docs/security/authorization-v2-task12-4-2-role-template-decision-pack.md`, `docs/security/authorization-v2-task12-4-2-e23-non-wms-cohort-audit.md`, `scripts/authorization-v2/task12-4-2-owner-decisions.json`, `scripts/authorization-v2/task12-4-2-role-template-blueprints.json`, `docs/security/authorization-v2-task13-runbook.md`.

## Global Constraints

- Dùng worktree `/Users/admin/khotienthinh/.worktrees/authorization-v2-task12-4-2` và branch `feature/authorization-v2-task12-4-2`; fast-forward từ `origin/main` trước mỗi checkpoint.
- Database duy nhất là Supabase Cloud main `ftciqmqhmfvjtwoycswe`, cấu hình bằng `/Users/admin/khotienthinh/.env`; không dùng Supabase local, Docker, Branch hay SQL mutation trực tiếp vào bảng authorization.
- E36 đã PASS nhưng chỉ chứng minh Workflow; không suy ra approval cho Request, không gán lại Workflow role và không gửi lại cleanup command Workflow.
- Cohort Request giữ `owner_pending` cho đến khi Request workflow owner ký nhận actor, action và scope cho cả ba template. Không tự diễn giải blueprint thành approval.
- Không tạo executable manifest, không revoke `system.rq.*` hoặc shell tương thích khác, không đặt observation `T0`, không sửa/drop bốn cột legacy và không mở Task 13 trong kế hoạch này.
- Template chỉ chứa snapshot action tường minh; scope assignment và item phải giao nhau, không được mở rộng quyền record-bound thành `global`.
- Mọi mutation tương lai dùng command V2 có preview/version/fingerprint/audit. Không dùng `replace_user_permission_grants`, script legacy hay DML trực tiếp để “test nhanh”.
- Không ghi UUID, email, token, payload nghiệp vụ hoặc PII vào Git/rollout log. Evidence chỉ gồm count, trạng thái, fingerprint đã redacted và UTC.
- Mỗi checkpoint có targeted test, Cloud smoke trong transaction rollback nếu thay đổi backend, `git diff --check`, commit riêng và rollout evidence.

---

## File Map

- Create: `docs/security/authorization-v2-request-cohort-decision-record.md` — bản ghi phê duyệt Request có actor/action/scope và chữ ký owner.
- Create: `docs/security/authorization-v2-request-readiness-audit.md` — access-map Request, bảy blocker catalog, surface UI/RPC/RLS và boundary cần harden.
- Modify after signed approval: `scripts/authorization-v2/task12-4-2-owner-decisions.json` — chỉ đổi entry `request` sang `owner_approved` cùng evidence và decision được ký.
- Modify after signed approval: `scripts/authorization-v2/task12-4-2-role-template-blueprints.json` — thêm scope tường minh cho mỗi Request capability đã được owner duyệt.
- Modify after signed approval: `docs/security/authorization-v2-task12-4-2-role-template-decision-pack.md` — ghi decision và giới hạn pilot Request.
- Modify after signed approval: `lib/__tests__/authorizationE28RoleTemplateReadiness.test.ts` — kiểm cohort Request được xét readiness chỉ sau approval.
- Modify after signed approval: `lib/__tests__/authorizationRoleTemplateBlueprints.test.ts` — kiểm action/scope Request và cấm đại diện capability nháp chưa tồn tại.
- Inspect for hardening plan: `supabase/migrations/20260916110000_authorization_v2_task12_4_2_request_lifecycle_capabilities.sql`, `supabase/migrations/20260914092853_authorization_v2_task12_4_2_request_surface_parity.sql`, `App.tsx`, `lib/routeAccess.ts`, `pages/request/RequestList.tsx`, `pages/request/RequestTemplates.tsx`.
- Existing read-only verifier: `scripts/authorization-v2/check-task12-4-2-role-template-readiness.mjs`.
- Existing regression inputs: `lib/__tests__/requestActionAvailability.test.ts`, `lib/__tests__/requestWorkflowBoundaryMigration.test.ts`, `pages/request/__tests__/RequestTemplatesAuthorization.test.tsx`.

---

### Task 1: Freeze Request baseline and prepare the owner decision record

**Files:**
- Create: `docs/security/authorization-v2-request-cohort-decision-record.md`
- Read: all files in File Map, plus `docs/security/authorization-v2-task12-4-2-rollout-log.md`
- Test: `lib/__tests__/authorizationE28RoleTemplateReadiness.test.ts`, `lib/__tests__/authorizationRoleTemplateBlueprints.test.ts`

**Consumes:** E36 final state and Request blueprint proposal.

**Produces:** A dated, PII-free Request decision record and a reproducible Cloud baseline. It does not change Request authorization status.

- [ ] **Step 1: Run non-mutating repository and Cloud preflight**

Run from the designated worktree:

```bash
git status --short --branch
git fetch origin --prune
git merge --ff-only origin/main
npx --yes supabase@2.117.0 db push --linked --dry-run --include-all --skip-vault --yes
npm run check:supabase-migrations
node scripts/authorization-v2/check-task12-4-2-role-template-readiness.mjs ftciqmqhmfvjtwoycswe
```

Expected: the linked project is `ftciqmqhmfvjtwoycswe`; migration dry-run is `upToDate=true`; migration baseline passes; current approved cohorts remain `wms_manage` and `workflow`; Request is absent from the readiness report while it remains `owner_pending`. A changed project ref, a non-empty migration dry-run or a dirty unrelated worktree stops the checkpoint before any document edit.

- [ ] **Step 2: Capture the Request catalog baseline without identifiers**

Run this read-only query:

```bash
npx --yes supabase@2.117.0 db query --linked --agent=no --output json "select permission_code as \"permissionCode\", grant_readiness as \"grantReadiness\", scope_modes as \"scopeTypes\" from public.permission_actions where permission_code in ('request.instance.view_own','request.instance.create','request.instance.edit_own_content','request.instance.resubmit_own','request.instance.cancel','request.category.view','request.template.view','request.instance.view_all','request.instance.approve_assigned','request.instance.reject_assigned','request.instance.return_assigned','request.instance.reassign','request.category.manage','request.template.manage') order by permission_code"
```

Record the returned action code, readiness and permitted scope modes in the decision record. The baseline captured on 2026-09-18 has seven unique blockers: `request.instance.view_own`, `request.instance.create`, `request.instance.view_all`, `request.category.view` and `request.template.view` are `declared`; `request.category.manage` and `request.template.manage` are `legacy`. The remaining lifecycle actions are `enforced`.

- [ ] **Step 3: Create a decision record that requests a bounded, signed choice**

Create `docs/security/authorization-v2-request-cohort-decision-record.md` with these sections:

```markdown
# Request cohort — owner decision record

## Status

`AWAITING_OWNER_DECISION`; this record is not authorization approval.

## Candidate templates from the existing blueprint

| Template | Candidate actions | Scope decision the owner must sign |
| --- | --- | --- |
| `REQUEST_USER` | `view_own`, `create`, `edit_own_content`, `resubmit_own`, `cancel`, category/template view | own for requester-owned lifecycle; explicit decision for shared category/template viewing |
| `REQUEST_PROCESSOR` | `view_all`, `approve_assigned`, `reject_assigned`, `return_assigned`, category/template view | assigned for step actions; explicit decision whether list visibility is assigned or global |
| `REQUEST_TEMPLATE_ADMIN` | `view_all`, `cancel`, `reassign`, category/template view/manage | explicit global-only administration decision |

## Required owner attestation

The Request workflow owner must identify the intended actor for each template, one allowed item scope for every capability, the assignment scope, whether `system.rq.*` stays retained through pilot, an expiry policy, and the pilot personas. The owner must explicitly accept or reject each candidate action; no Draft create/save/delete action is in scope.

## Current technical blockers

List the seven catalog blockers captured above. A blocker cannot be resolved by editing only `grant_readiness`; it requires a tested UI/RPC/RLS boundary.
```

- [ ] **Step 4: Verify the current proposal remains fail-closed**

Run:

```bash
npx vitest run lib/__tests__/authorizationE28RoleTemplateReadiness.test.ts lib/__tests__/authorizationRoleTemplateBlueprints.test.ts
git diff --check
```

Expected: both suites pass while Request remains `owner_pending`, and the blueprint test continues to prohibit `request.instance.create_draft`, `request.instance.save_draft` and `request.instance.delete_own_draft`.

- [ ] **Step 5: Commit the decision-gate artifact only**

```bash
git add docs/security/authorization-v2-request-cohort-decision-record.md
git commit -m "docs(auth): prepare Request owner decision gate"
```

**Exit:** the next task requires a signed decision from the Request workflow owner. Until that arrives, the correct status is `owner_pending`; no Request template, assignment, manifest or legacy revoke is permitted.

---

### Task 2: Materialize only a signed Request owner decision

**Files:**
- Modify: `scripts/authorization-v2/task12-4-2-owner-decisions.json`
- Modify: `scripts/authorization-v2/task12-4-2-role-template-blueprints.json`
- Modify: `docs/security/authorization-v2-task12-4-2-role-template-decision-pack.md`
- Modify: `lib/__tests__/authorizationE28RoleTemplateReadiness.test.ts`
- Modify: `lib/__tests__/authorizationRoleTemplateBlueprints.test.ts`

**Consumes:** the signed record created in Task 1.

**Produces:** a machine-readable Request approval whose templates have explicit action scopes. It intentionally does not create a persistent business role, assignment, direct grant or manifest.

- [ ] **Step 1: Validate the approval inputs before touching JSON**

Accept the checkpoint only when the record identifies all of the following for `REQUEST_USER`, `REQUEST_PROCESSOR` and `REQUEST_TEMPLATE_ADMIN`:

1. named business actor class;
2. every retained capability from the candidate row or an explicit removal;
3. an item scope supported by the Cloud catalog for every retained capability;
4. a concrete assignment scope;
5. compatibility-shell disposition `retain_until_pilot_verified` or an explicit longer retention decision;
6. bounded pilot personas and expiry; and
7. dated approval evidence attributable to the Request workflow owner.

Reject an approval that adds a Draft create/save/delete capability, uses an unsupported scope, treats `system.rq.manage` as a direct grant, or attempts legacy revocation in the same change.

- [ ] **Step 2: Write failing approval-contract tests first**

Extend `authorizationE28RoleTemplateReadiness.test.ts` so the test changes only once the signed decision exists:

```ts
expect(approved.map((decision: { cohort: string }) => decision.cohort).sort())
  .toEqual(['request', 'wms_manage', 'workflow']);
expect(decisions.decisions.filter((decision: { status: string }) =>
  decision.status === 'owner_pending')).toHaveLength(12);

const request = decisions.decisions.find((decision: { cohort: string }) => decision.cohort === 'request');
expect(request).toMatchObject({
  status: 'owner_approved',
  decision: { applicationCode: 'request' },
});
```

Extend `authorizationRoleTemplateBlueprints.test.ts` to require a `permissionScopes` entry for each Request permission code and keep the three absent Draft capability codes forbidden. Run the two tests and confirm they fail before editing the decision/blueprint data.

- [ ] **Step 3: Encode the approved action/scope snapshot exactly once**

Update the existing `request` decision object with `status: "owner_approved"`, its dated evidence, `decision.applicationCode: "request"`, and `decision.legacyDisposition: "retain_until_pilot_verified"`. Add exactly three approved templates whose codes are `REQUEST_USER`, `REQUEST_PROCESSOR`, and `REQUEST_TEMPLATE_ADMIN`.

For each approved template, store its signed actor class and concrete assignment scope in the decision object. In the Request blueprint, add `permissionScopes` for every permission code using the owner-signed scope and only a value returned by the Task 1 Cloud query. Preserve all excluded actions, particularly the three unsupported Draft lifecycle actions. Do not add `system.rq.view` or `system.rq.manage` as a role-template item.

- [ ] **Step 4: Run approval and readiness checks**

Run:

```bash
npx vitest run lib/__tests__/authorizationE28RoleTemplateReadiness.test.ts lib/__tests__/authorizationRoleTemplateBlueprints.test.ts
node scripts/authorization-v2/check-task12-4-2-role-template-readiness.mjs ftciqmqhmfvjtwoycswe
git diff --check
```

Expected immediately after approval: the checker evaluates three Request templates, but exits with status `2` until all seven catalog blockers are hardened. Confirm the report names only the declared/legacy Request actions above; a missing action or unsupported scope is a separate fail-closed blocker.

- [ ] **Step 5: Document and commit the decision, not a rollout**

Add the signed decision summary and blocker state to the decision pack and rollout log without PII, then commit:

```bash
git add scripts/authorization-v2/task12-4-2-owner-decisions.json \
  scripts/authorization-v2/task12-4-2-role-template-blueprints.json \
  docs/security/authorization-v2-task12-4-2-role-template-decision-pack.md \
  docs/security/authorization-v2-task12-4-2-rollout-log.md \
  lib/__tests__/authorizationE28RoleTemplateReadiness.test.ts \
  lib/__tests__/authorizationRoleTemplateBlueprints.test.ts
git commit -m "docs(auth): record approved Request role boundaries"
```

**Exit:** Request is owner-approved but still cannot pilot while any Request template has a `declared`, `legacy`, missing or unsupported capability.

---

### Task 3: Produce the Request technical-readiness audit and split the hardening safely

**Files:**
- Create: `docs/security/authorization-v2-request-readiness-audit.md`
- Create: `docs/superpowers/plans/2026-09-18-request-instance-canonical-authorization.md`
- Create: `docs/superpowers/plans/2026-09-18-request-category-canonical-authorization.md`
- Create: `docs/superpowers/plans/2026-09-18-request-template-canonical-authorization.md`
- Read: Request migrations, route/UI files and regressions named in File Map

**Consumes:** the owner-approved Request action/scope snapshot and the failed readiness report from Task 2.

**Produces:** three independently reviewable hardening plans based on actual current call paths. This task does not alter catalog readiness or Cloud data.

- [ ] **Step 1: Map each blocker to its actual enforcement boundary**

Use these searches and record every result in `request-readiness-audit.md`:

```bash
rg -n -C 3 "request\.instance\.(view_own|view_all|create)" App.tsx lib pages components supabase/migrations supabase/tests
rg -n -C 3 "request\.category\.(view|manage)" App.tsx lib pages components supabase/migrations supabase/tests
rg -n -C 3 "request\.template\.(view|manage)" App.tsx lib pages components supabase/migrations supabase/tests
rg -n -C 3 "request_actor_has_lifecycle_action|request_user_can_manage|request_user_can_view_templates" supabase/migrations supabase/tests
```

For each action, map `route/UI control → client service/RPC → public wrapper → private helper/RLS/trigger → record boundary → current compatibility fallback`. `App.tsx` currently protects Request only with the feature flag; the audit must state whether each canonical capability is also checked at route, UI and server boundaries.

- [ ] **Step 2: State the seven testable contracts before proposing code**

The audit must define these contracts with a permitted actor and a denied actor for each:

1. `request.instance.view_own`: creator can read only their request; unrelated actor cannot read it.
2. `request.instance.create`: active user with the approved canonical capability can create only the currently supported non-Draft request lifecycle; an actor without it cannot create.
3. `request.instance.view_all`: access obeys the owner-approved `assigned` or `global` scope and does not reveal unrelated requests.
4. `request.category.view`: viewer can list only the categories allowed by its approved scope.
5. `request.category.manage`: manager can mutate category data through the guarded command; viewer cannot mutate it.
6. `request.template.view`: viewer can list/select only permitted templates without gaining edit/publish capability.
7. `request.template.manage`: manager can create/edit/publish through guarded commands; viewer and anonymous actors are denied.

`approve_assigned`, `reject_assigned`, `return_assigned`, `edit_own_content`, `resubmit_own`, `cancel`, and `reassign` remain regression controls because their catalog state is already `enforced`; do not weaken their owner/assignee/global checks while adding the seven contracts.

- [ ] **Step 3: Write one implementation plan per independent boundary**

The instance plan covers only `view_own`, `create`, and `view_all`, including Request list/detail route guard and record-scoped RPC/RLS tests. The category plan covers only `category.view/manage`. The template plan covers only `template.view/manage`, including `/rq/templates` and editor routes. Each plan must include:

1. a failing Vitest contract test and a Cloud rollback SQL smoke using an authenticated JWT actor, not `service_role`;
2. one CLI-generated migration per subplan: `authorization_v2_request_instance_canonical_authorization`, `authorization_v2_request_category_canonical_authorization`, or `authorization_v2_request_template_canonical_authorization`;
3. `SECURITY DEFINER` only in private schema with `search_path=''`, explicit PUBLIC/anon ACL revocation, and RLS-aware public wrappers;
4. a proof that UI visibility, route access and server mutation all match; and
5. a postflight query proving only the intended `grant_readiness` values changed.

No subplan may use `DROP ... CASCADE`, change `system.rq.*`, create template/assignment records, or elevate a catalog row without the corresponding runtime proof.

- [ ] **Step 4: Verify documentation and commit the audit/plans**

Run:

```bash
npx vitest run lib/__tests__/requestActionAvailability.test.ts \
  lib/__tests__/requestWorkflowBoundaryMigration.test.ts \
  pages/request/__tests__/RequestTemplatesAuthorization.test.tsx
rg -n "[T]ODO|[T]BD|implement[[:space:]]later|fill[[:space:]]in" docs/security/authorization-v2-request-readiness-audit.md docs/superpowers/plans/2026-09-18-request-*-canonical-authorization.md
git diff --check
```

Expected: existing Request regression tests pass; the placeholder scan has no matches; the audit includes a boundary for every one of seven blockers. Commit with:

```bash
git add docs/security/authorization-v2-request-readiness-audit.md \
  docs/superpowers/plans/2026-09-18-request-instance-canonical-authorization.md \
  docs/superpowers/plans/2026-09-18-request-category-canonical-authorization.md \
  docs/superpowers/plans/2026-09-18-request-template-canonical-authorization.md
git commit -m "docs(auth): map Request canonical readiness work"
```

**Exit:** hardening begins only through the three focused plans. This avoids bundling instance visibility, category administration and template lifecycle into one unreviewable authorization change.

---

### Task 4: Execute the three hardening checkpoints and prove Request readiness

**Files:**
- Modify/create only the exact code, migration, smoke and test files defined by the three Task 3 plans
- Modify: `scripts/authorization-v2/task12-4-2-role-template-blueprints.json` only if a signed owner scope decision changes
- Modify: `docs/security/authorization-v2-task12-4-2-rollout-log.md`

**Consumes:** reviewed Task 3 plans and their failing tests.

**Produces:** seven canonical Request actions in `enforced` or `verified` state, with no compatibility-shell revocation.

- [ ] **Step 1: Execute instance hardening in its own commit and Cloud rollback smoke**

Implement only the three Request instance contracts. Run its targeted Vitest suite, transaction rollback smoke, `npm run check:supabase-migrations` and `git diff --check`. Apply a reviewed migration to Cloud only after dry-run lists exactly that migration; record postflight readiness and commit the instance checkpoint.

- [ ] **Step 2: Execute category hardening in its own commit and Cloud rollback smoke**

Implement only category view/manage contracts. The mutation boundary must reject a category viewer, preserve authenticated ACL/RLS requirements and prevent direct table writes from bypassing the command. Repeat targeted tests, rollback smoke, dry-run, postflight and a separate commit.

- [ ] **Step 3: Execute template hardening in its own commit and Cloud rollback smoke**

Implement only template view/manage contracts. A template viewer may list/select but cannot reach editor mutation; a manager must be checked at both route/UI and command boundary. Preserve existing published-template access where it is intentionally record-based. Repeat targeted tests, rollback smoke, dry-run, postflight and a separate commit.

- [ ] **Step 4: Re-run the cross-template readiness gate**

Run:

```bash
npx vitest run lib/__tests__/authorizationE28RoleTemplateReadiness.test.ts \
  lib/__tests__/authorizationRoleTemplateBlueprints.test.ts \
  lib/__tests__/requestActionAvailability.test.ts \
  lib/__tests__/requestWorkflowBoundaryMigration.test.ts \
  pages/request/__tests__/RequestTemplatesAuthorization.test.tsx
node scripts/authorization-v2/check-task12-4-2-role-template-readiness.mjs ftciqmqhmfvjtwoycswe
npx --yes supabase@2.117.0 db push --linked --dry-run --include-all --skip-vault --yes
```

Expected: `REQUEST_USER`, `REQUEST_PROCESSOR`, and `REQUEST_TEMPLATE_ADMIN` all have `canPilot=true`; the report has no Request blocker. Any remaining blocker ends the checkpoint and does not permit a pilot.

- [ ] **Step 5: Record technical readiness without changing runtime assignments**

Append redacted readiness evidence to the rollout log, verify no template/assignment/direct-grant data was created by hardening, then commit the evidence separately.

**Exit:** technical readiness is necessary but not a grant. A bounded pilot still requires specific owner-nominated active personas, a Permission Admin session and a Production release check.

---

### Task 5: Run a bounded Request pilot only after the gates above are green

**Files:**
- Modify: `docs/security/authorization-v2-task12-4-2-rollout-log.md`
- Modify: `docs/security/authorization-v2-task12-4-2-handoff-2026-09-18.md`
- Read: `scripts/authorization-v2/check-task12-4-2-role-template-readiness.mjs`, Cloud audit/reconciliation commands

**Consumes:** a signed decision, zero Request readiness blockers, a production release containing the hardening, and owner-nominated active pilot personas.

**Produces:** a short-lived, audited Request persona evidence checkpoint followed by final revoke. It does not produce a transition manifest or Task 13 evidence.

- [ ] **Step 1: Preflight the actual pilot release and persons**

Verify `HEAD` is fast-forwarded from `origin/main`, the production deployment is `READY` on the tested SHA, Cloud dry-run is `upToDate=true`, the Permission Admin has an active session, and each nominated pilot persona has an active session/refresh in the acceptance window. Resolve identities outside Git and do not print them. If any preflight condition fails, do not preview or assign.

- [ ] **Step 2: Preview before every assignment**

For each owner-approved template, call the V2 preview as Permission Admin with the owner-signed assignment scope and a 24-hour expiry. Require matching template version/fingerprint, zero hard denies, and an independently recorded SoD acceptance for any warning. A stale preview, hard deny, missing session or warning without the independent acceptance stops that persona.

- [ ] **Step 3: Test the allow/deny matrix without unbounded business mutations**

Use only the owner-approved pilot personas and a clearly identified test request/template/category. Verify:

| Persona | Must allow | Must deny |
| --- | --- | --- |
| `REQUEST_USER` | own request read/create/edit/resubmit/cancel and approved shared template/category viewing | another user's request, assigned-step approval, reassignment, category/template management |
| `REQUEST_PROCESSOR` | assigned approval/reject/return and the signed request visibility scope | unassigned step action, reassignment, category/template management |
| `REQUEST_TEMPLATE_ADMIN` | signed global category/template administration and signed request administration | any action excluded from the signed snapshot |

Record route, UI, RPC result and audit reference in redacted form. Do not create a Draft capability, direct grant, manifest or shell revoke merely to make a test pass.

- [ ] **Step 4: Reconcile and revoke immediately**

Confirm effective sources equal the template snapshots plus retained baseline sources; direct Request grants, unexpected gain/loss and unexpected scope expansion must be zero. Confirm audit events for assign/role use the Permission Admin actor. Revoke every Request pilot assignment through `revoke_business_role_assignment` immediately after evidence, then re-read Cloud state: assignments `REVOKED`, active pilot assignment count `0`, templates unchanged, no ledger/manifest change.

- [ ] **Step 5: Close evidence without opening Task 13**

Run the relevant targeted tests, full regression, TypeScript, production build, migration baseline, query audit, `git diff --check` and Cloud dry-run. Append redacted release SHA, UTC, allow/deny, reconciliation and final revoke to rollout log and handoff; commit/push the branch.

**Exit:** a Request pilot PASS authorizes only its documented follow-up. It does not authorize compatibility-shell revocation, an executable manifest, observation `T0`, legacy schema drop or Task 13.

---

## Task 13 Hold Point

After a Request pilot, re-run `supabase/tests/authorization_v2_task13_readiness.sql` read-only and record its result as inventory only. Do not set `T0`: all 13 cohort decisions and their manifests/reconciliation are still required, along with the complete persona/backup/dependency/observation gates in `docs/security/authorization-v2-task13-runbook.md`. No `DROP`, `DROP ... CASCADE`, snapshot deletion or legacy helper removal belongs to this plan.

## Self-Review

- [x] E36 is treated as Workflow-only evidence; no Request or Task 13 gate is inferred from it.
- [x] The next candidate is Request because its blueprint and runtime lifecycle exist, but its owner decision and seven catalog blockers are explicitly retained as gates.
- [x] All seven current blockers are named and divided across independent instance, category and template boundaries.
- [x] Approval, technical readiness, preview, persona evidence, reconciliation and revoke are separate gates with no direct authorization-table mutation.
- [x] The plan preserves `system.rq.*`, forbids a manifest/T0/Task 13 change, and requires final revoke after any pilot.
