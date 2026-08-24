# Safety Card Readiness Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagents in this repository.

**Goal:** Let a safety manager upload the required worker certificate and complete site-readiness conditions from the worker detail, so a card becomes issuable as soon as the worker meets every rule.

**Architecture:** Keep worker certificates in `safety_worker_certificates` and readiness on `safety_project_assignments`; do not introduce a second safety-card checklist store. A new scoped Supabase command writes a certificate as manager-confirmed, the existing scoped assignment command writes site conditions, and the database recomputes eligibility. The frontend receives active certificate types through the existing site-options read model, renders focused certificate/readiness sections in the detail modal, and invalidates the current scope after every command.

**Tech Stack:** React 18, TypeScript, Vitest, Supabase Cloud PostgreSQL/RPC/RLS, Supabase Storage, Vite.

**Spec:** `docs/superpowers/specs/2026-08-24-safety-card-readiness-completion-design.md`

## Global Constraints

- Only use the configured Supabase Cloud project; never Supabase local or Docker.
- Never expose a service-role/secret key in the frontend.
- Keep all sensitive files in the existing private `safety-passport-attachments` bucket; use authenticated Storage calls and in-memory object URLs only.
- New private RPC functions use `security definer`, `set search_path = ''`, derive actor with `public.current_app_user_id()`, and public wrappers use `security invoker` with `set search_path = ''`.
- Do not modify historical migrations; generate one additive migration with `supabase migration new` and apply it to Supabase Cloud only after tests pass.
- Certificate uploaded by a user with Safety manage permission is immediately saved as `approved`, with `verified_by` and `verified_at` populated.
- Preserve legacy certificate records with `status = submitted` as eligible evidence; reject/revoke records never satisfy a required certificate.
- A profile may satisfy the CCCD evidence rule through legacy `identity_attachments` or a canonical `identity_front`/`identity_back` document.
- Do not use subagents in this repository.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/<timestamp>_safety_card_readiness_completion.sql` | Additive Cloud migration: certificate command, options read-model extension, eligibility/profile-readiness compatibility, grants and audit. |
| `lib/__tests__/safetyCardReadinessMigration.test.ts` | Static contract tests that prevent removal of authorization, legacy compatibility, audit, and wrappers from the new migration. |
| `types.ts` | Add certificate types to site options plus typed certificate/readiness command inputs. |
| `lib/safetyWorkforceModel.ts` | Parse certificate types returned by the site-options RPC. |
| `lib/safetyWorkforceApi.ts` | Add scoped `saveCertificate` and `updateAssignmentReadiness` commands; invalidate detail/active/dashboard. |
| `lib/__tests__/safetyWorkforceModel.test.ts` | Test certificate-type parsing from the options model. |
| `lib/__tests__/safetyWorkforceApi.test.ts` | Test both command payloads, attachment upload path and scope-cache invalidation. |
| `components/project/safety/passport/SafetyWorkerCertificateSection.tsx` | Certificate list and manager-only add/edit form, including file upload. |
| `components/project/safety/passport/SafetyWorkerSiteReadinessSection.tsx` | Assignment-level training/commitment/PPE/toolbox controls and readiness summary. |
| `components/project/safety/passport/SafetyWorkerReadinessChecklist.tsx` | Compact, capability-aware summary of why card issuance is blocked. |
| `components/project/safety/SafetyPassportWorkerDetailModal.tsx` | Compose the new sections, load site options only for a manager, and keep existing sensitive-data boundaries. |
| `components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx` | Server-rendered UI contracts for the manager and viewer branches. |
| `supabase/tests/safety_card_readiness_completion_smoke.sql` | Cloud smoke test proving certificate + readiness changes make an eligible assignment issuable without destructive fixture changes. |

## Task 1: Lock the database contract with failing migration tests

**Files:**
- Create: `lib/__tests__/safetyCardReadinessMigration.test.ts`
- Test: `lib/__tests__/safetyCardReadinessMigration.test.ts`

**Interfaces:**
- Produces migration contract expectations for `upsert_safety_worker_certificate_for_site`, `list_safety_site_workforce_options`, `safety_assignment_eligibility_status`, and `safety_workforce_profile_readiness`.

- [ ] **Step 1: Write the failing migration contract test**

```ts
const migrationFile = readdirSync(migrationDirectory)
  .find(name => name.endsWith('_safety_card_readiness_completion.sql'));

it('defines a scoped manager-confirmed certificate command', () => {
  expect(sql).toContain('create or replace function app_private.upsert_safety_worker_certificate_for_site');
  expect(sql).toContain('create or replace function public.upsert_safety_worker_certificate_for_site');
  expect(privateBody).toContain('security definer');
  expect(privateBody).toContain("set search_path = ''");
  expect(privateBody).toContain('public.current_app_user_id()');
  expect(privateBody).toContain("status = 'approved'");
  expect(privateBody).toContain("'worker.certificate.upsert'");
});

it('keeps certificate and canonical-CCCD eligibility rules explicit', () => {
  expect(sql).toContain("certificate.status in ('approved', 'submitted')");
  expect(sql).toContain("certificate.status not in ('rejected', 'revoked')");
  expect(sql).toContain("document.document_type in ('identity_front', 'identity_back')");
  expect(sql).toContain("'certificateTypes'");
});
```

- [ ] **Step 2: Run the test and confirm it fails because the migration is absent**

Run: `npm test -- lib/__tests__/safetyCardReadinessMigration.test.ts`

Expected: FAIL because no matching migration exists.

- [ ] **Step 3: Commit the red test**

```bash
git add lib/__tests__/safetyCardReadinessMigration.test.ts
git commit -m "test(safety): specify card readiness migration contract"
```

## Task 2: Add the scoped Supabase Cloud migration

**Files:**
- Create: `supabase/migrations/<generated>_safety_card_readiness_completion.sql`
- Modify: `lib/__tests__/safetyCardReadinessMigration.test.ts`
- Test: `lib/__tests__/safetyCardReadinessMigration.test.ts`

**Interfaces:**
- Consumes `p_membership_id uuid`, `p_certificate jsonb`.
- Produces `public.upsert_safety_worker_certificate_for_site(uuid, jsonb) returns jsonb`; options now expose `certificateTypes`.

- [ ] **Step 1: Generate the migration filename through the CLI**

Run: `npx supabase migration new safety_card_readiness_completion`

Expected: exactly one new timestamped file under `supabase/migrations/`; use that generated path in every subsequent step.

- [ ] **Step 2: Implement the certificate command and its wrapper**

Implement a private definer that validates active certificate type, membership sensitive-manage access, non-empty attachments and date ordering. For insert/update, set manager confirmation server-side:

```sql
insert into public.safety_worker_certificates (
  worker_id, certificate_type_id, certificate_no, issue_date, expiry_date,
  attachments, status, verified_by, verified_at, note, created_by
) values (
  v_membership.worker_id, v_certificate_type_id,
  nullif(trim(p_certificate ->> 'certificateNo'), ''),
  nullif(p_certificate ->> 'issueDate', '')::date,
  nullif(p_certificate ->> 'expiryDate', '')::date,
  v_attachments, 'approved', v_actor::text, now(),
  nullif(trim(p_certificate ->> 'note'), ''), v_actor::text
)
returning id into v_certificate_id;
```

For an existing `p_certificate ->> 'id'`, lock it, verify `worker_id = v_membership.worker_id`, then update the same fields. Insert `worker.certificate.upsert` into `safety_audit_logs`, recompute every assignment for that worker, and return `app_private.safety_workforce_detail_for_membership(v_membership.id)`.

Add a `security invoker` public wrapper plus explicit revoke/grant only for authenticated. Do not accept actor, worker ID or verified fields from the client.

- [ ] **Step 3: Extend the options and eligibility/readiness functions in the same migration**

Override `app_private.list_safety_site_workforce_options` to append active certificate types:

```sql
'certificateTypes', coalesce((
  select jsonb_agg(jsonb_build_object(
    'id', certificate_type.id,
    'code', certificate_type.code,
    'name', certificate_type.name,
    'isRequiredDefault', certificate_type.is_required_default,
    'validityDays', certificate_type.validity_days,
    'appliesToRoles', certificate_type.applies_to_roles,
    'isActive', certificate_type.is_active,
    'sortOrder', certificate_type.sort_order
  ) order by certificate_type.sort_order, certificate_type.name, certificate_type.id)
  from public.safety_certificate_types certificate_type
  where certificate_type.is_active
), '[]'::jsonb)
```

Override both readiness functions so profile CCCD passes if legacy `identity_attachments` is non-empty **or** there is a non-rejected canonical `identity_front`/`identity_back` document with at least one attachment. In eligibility, select only `approved`/legacy `submitted` certificates and exclude `rejected`/`revoked`; retain the existing expiry and four assignment-readiness checks unchanged.

- [ ] **Step 4: Run the migration contract test and confirm it passes**

Run: `npm test -- lib/__tests__/safetyCardReadinessMigration.test.ts`

Expected: PASS.

- [ ] **Step 5: Apply only this additive migration to Supabase Cloud and verify the schema**

Run: `npx supabase db push --linked`

Then run the read-only query:

```sql
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'upsert_safety_worker_certificate_for_site';
```

Expected: one public routine. Do not run Supabase local or Docker.

- [ ] **Step 6: Commit the database deliverable**

```bash
git add supabase/migrations/<generated>_safety_card_readiness_completion.sql lib/__tests__/safetyCardReadinessMigration.test.ts
git commit -m "feat(safety): add card readiness certificate command"
```

## Task 3: Extend typed read/write client boundaries

**Files:**
- Modify: `types.ts:6341-6429`
- Modify: `lib/safetyWorkforceModel.ts:100-115,420-435`
- Modify: `lib/safetyWorkforceApi.ts:31-43,260-390`
- Modify: `lib/__tests__/safetyWorkforceModel.test.ts`
- Modify: `lib/__tests__/safetyWorkforceApi.test.ts`

**Interfaces:**
- Consumes `SafetyCertificateType` and existing `SafetyAttachment`.
- Produces:

```ts
export interface SafetyCertificateUpsertInput {
  id?: string;
  certificateTypeId: string;
  certificateNo?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  attachments: SafetyAttachment[];
  note?: string | null;
}

export type SafetyAssignmentReadinessPatch = Pick<SafetyProjectAssignment,
  'siteTrainingStatus' | 'commitmentStatus' | 'ppeStatus' | 'toolboxStatus'>;
```

- [ ] **Step 1: Write failing type/model tests**

Add a site-options fixture with `certificateTypes` and assert `parseSafetySiteWorkforceOptions` returns the active type. Add API tests asserting:

```ts
await safetyWorkforceApi.saveCertificate(scope, 'membership-1', {
  certificateTypeId: 'type-1', attachments: [attachment], expiryDate: '2027-08-24',
});
expect(supabaseMocks.rpc).toHaveBeenCalledWith('upsert_safety_worker_certificate_for_site', {
  p_membership_id: 'membership-1',
  p_certificate: expect.objectContaining({ certificateTypeId: 'type-1' }),
});
expect(cacheMocks.invalidate).toHaveBeenCalledWith(scope, ['roster', 'active', 'detail', 'dashboard']);
```

Also assert `updateAssignmentReadiness` calls `update_safety_worker_assignment` with only the four readiness keys.

- [ ] **Step 2: Run the two test files and confirm the new expectations fail**

Run: `npm test -- lib/__tests__/safetyWorkforceModel.test.ts lib/__tests__/safetyWorkforceApi.test.ts`

Expected: FAIL because `certificateTypes`, `saveCertificate`, and `updateAssignmentReadiness` do not yet exist.

- [ ] **Step 3: Implement types, parser and API methods**

Add `certificateTypes: SafetyCertificateType[]` to `SafetySiteWorkforceOptions`; make parser default it to `[]` and strictly parse only the properties emitted by the RPC. In `safetyWorkforceApi`, add:

```ts
async saveCertificate(scope, membershipId, input) {
  const detail = await commandDetail(scope, 'upsert_safety_worker_certificate_for_site', {
    p_membership_id: membershipId,
    p_certificate: input,
  });
  invalidate(scope, INVALIDATION.assignment);
  return detail;
}

async updateAssignmentReadiness(scope, assignmentId, patch) {
  const detail = await commandDetail(scope, 'update_safety_worker_assignment', {
    p_assignment_id: assignmentId,
    p_patch: patch,
  });
  invalidate(scope, INVALIDATION.assignment);
  return detail;
}
```

Validate nonblank IDs in the API before the RPC. Keep Storage upload in the existing `uploadWorkerAttachment`; certificate section uses category `certificate` and then passes the returned attachment to `saveCertificate`.

- [ ] **Step 4: Run focused tests and TypeScript**

Run: `npm test -- lib/__tests__/safetyWorkforceModel.test.ts lib/__tests__/safetyWorkforceApi.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit the typed client boundary**

```bash
git add types.ts lib/safetyWorkforceModel.ts lib/safetyWorkforceApi.ts lib/__tests__/safetyWorkforceModel.test.ts lib/__tests__/safetyWorkforceApi.test.ts
git commit -m "feat(safety): expose certificate and readiness commands"
```

## Task 4: Build manager-facing readiness controls

**Files:**
- Create: `components/project/safety/passport/SafetyWorkerReadinessChecklist.tsx`
- Create: `components/project/safety/passport/SafetyWorkerCertificateSection.tsx`
- Create: `components/project/safety/passport/SafetyWorkerSiteReadinessSection.tsx`
- Modify: `components/project/safety/SafetyPassportWorkerDetailModal.tsx`
- Modify: `components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx`

**Interfaces:**
- Consumes `SafetyWorkerDetailPayload`, `SafetySiteWorkforceOptions`, scoped API methods from Task 3, and `onChanged(detail)`.
- Produces UI actions that return the detail payload from the command and use the parent `onChanged` state setter.

- [ ] **Step 1: Write the failing UI contract tests**

Render the detail modal with a sensitive manager, active assignment `missing_certificate`, and an active certificate type. Assert markup includes:

```ts
expect(markup).toContain('Sẵn sàng cấp thẻ');
expect(markup).toContain('Huấn luyện an toàn cơ bản');
expect(markup).toContain('Thêm chứng chỉ');
expect(markup).toContain('Điều kiện tại công trường');
expect(markup).toContain('Đào tạo công trường');
```

Render the same worker with `canManageWorker: false` and assert it explains the block but does **not** contain `Thêm chứng chỉ`, certificate file inputs, or `Lưu điều kiện`.

- [ ] **Step 2: Run the UI test and confirm it fails**

Run: `npm test -- components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx`

Expected: FAIL because the new sections are absent.

- [ ] **Step 3: Implement `SafetyWorkerReadinessChecklist`**

Create a pure presentational component receiving active assignment, roster profile/health/insurance statuses, certificates and certificate types. Render exactly four rows: Hồ sơ, Sức khỏe & bảo hiểm, Chứng chỉ an toàn, Điều kiện công trường. Each row has `Đủ`/`Cần bổ sung`; the certificate row names each required type whose ID is missing, expired, rejected or revoked. It must not render attachment URLs or identity details.

- [ ] **Step 4: Implement `SafetyWorkerCertificateSection`**

For managers only, render existing certificate metadata and an “Thêm chứng chỉ” form. Require type and a local file before submit; accept `image/*,.pdf`. On submit:

```ts
const attachment = await safetyWorkforceApi.uploadWorkerAttachment(workerId, 'certificate', file);
const next = await safetyWorkforceApi.saveCertificate(scope, membershipId, {
  certificateTypeId, certificateNo: certificateNo.trim() || null,
  issueDate: issueDate || null, expiryDate: expiryDate || null,
  attachments: [attachment], note: note.trim() || null,
});
onChanged(next);
```

Show inline API errors, disable duplicate submit, and clear local form only after the command succeeds. Certificate file previews reuse the existing `previewAttachment` callback supplied by the parent; do not open stale signed URLs directly.

- [ ] **Step 5: Implement `SafetyWorkerSiteReadinessSection`**

For an active assignment and a manager, render four selects with only valid enum values:

```ts
siteTrainingStatus: ['pending', 'completed', 'expired']
commitmentStatus: ['pending', 'signed']
ppeStatus: ['missing', 'partial', 'complete']
toolboxStatus: ['pending', 'completed', 'expired']
```

Initialize from the active assignment; call `updateAssignmentReadiness(scope, assignment.id, patch)` on one “Lưu điều kiện” action, then invoke `onChanged`. Render read-only labels when viewer lacks manage capability or no active assignment exists.

- [ ] **Step 6: Compose sections into worker detail**

Load `useSafetyWorkforceOptions(scope)` only when `canManageWorker` is true. Place checklist immediately before `SafetyWorkerCardSection`; render the certificate and site-readiness sections inside the existing sensitive “Giấy tờ & chứng chỉ” block. Pass current command detail preferentially so card eligibility refreshes without closing the modal. Reuse parent `sensitiveNotice` for failures; do not expose sensitive content in basic-only response.

- [ ] **Step 7: Run the UI contract test and lint**

Run: `npm test -- components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx && npm run lint`

Expected: PASS.

- [ ] **Step 8: Commit the interface deliverable**

```bash
git add components/project/safety/SafetyPassportWorkerDetailModal.tsx components/project/safety/passport/SafetyWorkerReadinessChecklist.tsx components/project/safety/passport/SafetyWorkerCertificateSection.tsx components/project/safety/passport/SafetyWorkerSiteReadinessSection.tsx components/project/safety/passport/__tests__/SafetyWorkforceViews.test.tsx
git commit -m "feat(safety): add worker card readiness controls"
```

## Task 5: Run Cloud smoke validation and production verification

**Files:**
- Create: `supabase/tests/safety_card_readiness_completion_smoke.sql`
- Modify: `package.json`
- Test: `supabase/tests/safety_card_readiness_completion_smoke.sql`

**Interfaces:**
- Consumes deployed public RPCs and only existing Cloud fixture data selected inside a transaction.
- Produces a rollback-safe assertion that certificate upload plus four completed readiness fields returns `eligible`.

- [ ] **Step 1: Write the smoke SQL in a rollback-safe transaction**

Use `begin; ... rollback;`. Select one active assignment/membership with a worker and one active certificate type, then insert a temporary approved certificate with a harmless attachment descriptor, update all four readiness values, call `app_private.recompute_safety_assignment_eligibility(v_assignment_id)`, and assert `eligible`:

```sql
if v_eligibility <> 'eligible' then
  raise exception 'SAFETY_SMOKE_EXPECTED_ELIGIBLE, got %', v_eligibility;
end if;
rollback;
```

The SQL must reject a missing fixture rather than creating a worker/profile, and must never delete or mutate durable Cloud data after rollback.

- [ ] **Step 2: Add package script and run the smoke test against linked Cloud**

Add:

```json
"smoke:safety-card-readiness": "npx supabase db query --linked --agent=no --file supabase/tests/safety_card_readiness_completion_smoke.sql"
```

Run: `npm run smoke:safety-card-readiness`

Expected: command exits 0 and transaction rolls back.

- [ ] **Step 3: Run full verification**

Run:

```bash
git diff --check
npm test
npm run lint
npm run build
npm run smoke:safety-card-readiness
```

Expected: all tests pass, TypeScript exits 0, production build exits 0, Cloud smoke exits 0. Treat existing Vite chunk-size warnings as warnings only; do not suppress them in this change.

- [ ] **Step 4: Commit verification assets and push the branch**

```bash
git add supabase/tests/safety_card_readiness_completion_smoke.sql package.json
git commit -m "test(safety): add card readiness cloud smoke"
git push origin main
git push origin main:feature/booking-app
```

- [ ] **Step 5: Confirm Vercel deployment**

Run: `curl -fsSL "https://api.github.com/repos/hoangnvthkt/khotienthinh/commits/<HEAD>/status" | jq -r '.state, (.statuses[]? | [.context, .state] | @tsv)'`

Expected: overall `success` and `Vercel success` before reporting release completion.

## Plan Self-Review

- Spec coverage: Task 2 covers Cloud command, status/audit, current requirement data and legacy CCCD compatibility; Task 3 connects schema contracts to typed client boundaries; Task 4 covers checklist, certificate upload and four site conditions with role protection; Task 5 validates end-to-end Cloud eligibility and deployment.
- Placeholder scan: no unresolved implementation steps; the migration timestamp is intentionally CLI-generated to preserve repository migration ordering.
- Type consistency: Task 3 defines `SafetyCertificateUpsertInput` and `SafetyAssignmentReadinessPatch`; Task 4 consumes those only through `saveCertificate` and `updateAssignmentReadiness`.
