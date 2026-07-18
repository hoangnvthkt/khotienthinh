# VIOO Sensitive Direct-Grant Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng Task 13 Step 5 bằng cách xử lý chính xác 467 active sensitive direct grants chưa có expiry theo từng principal, giữ lại quyền được duyệt với một mốc hết hạn 90 ngày và thu hồi quyền không còn cần thiết, trước khi xin duyệt bật resolver.

**Architecture:** Không tạo bulk-migration hoặc đường ghi mới. Mỗi principal được tải lại toàn bộ direct-grant draft, phân loại `retain`/`revoke`, preview bằng `preview_direct_grant_replacement`, rồi ghi đúng một lần qua `replace_user_permission_grants_v2`; backend tiếp tục kiểm tra Permission Admin, expiry, SoD, scope, reason và audit. Mọi kiểm chứng Cloud chỉ ghi aggregate, còn principal ID và quyết định chi tiết chỉ tồn tại trong phiên vận hành đã xác thực.

**Tech Stack:** React Settings UI, Supabase Cloud Postgres/Auth/Data API, Supabase CLI `2.95.6+`, governed authorization RPCs, Vitest, TypeScript, Vite.

## Global Constraints

- Chỉ dùng Supabase Cloud; không dùng Docker, Supabase local, `--local`, `supabase start`, `supabase db reset` hoặc `supabase db push`.
- Giữ cả ba rollout flags ở `false` trong toàn bộ plan này; không gọi `set_authorization_rollout_flags`.
- Không update/insert trực tiếp `public.user_permission_grants`; mọi mutation đi qua `public.replace_user_permission_grants_v2` từ UI đã xác thực.
- Không sửa bảy Phase 2 migrations hoặc hai Auth forward-fix migrations đã apply.
- Không tự động giữ hoặc thu hồi quyền. Business owner phải phân loại từng sensitive grant thành `retain` hoặc `revoke`.
- Tất cả grant được `retain` dùng cùng một UTC cutoff, được tính một lần là 90 ngày từ lúc bắt đầu pilot.
- Mỗi principal là một atomic replacement command. Không chạy hai phiên permission editing song song cho cùng principal.
- Giữ nguyên mọi non-sensitive direct grant trong full draft trừ khi business owner mở một yêu cầu riêng ngoài plan này.
- Mọi thay đổi dùng reason: `Task 13 Step 5: rà soát quyền nhạy cảm theo phê duyệt 2026-07-18`.
- Warning SoD không được auto-accept. Phải có control owner độc lập, reason, compensating controls và future expiry qua `SodWarningPanel`; hard deny luôn dừng principal đó.
- Không ghi email, tên, user ID, Auth ID, access/refresh token hoặc payload chi tiết vào Git, apply log hay chat. Chỉ ghi aggregate.
- File dirty có sẵn `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md` thuộc operator; không stage, overwrite hoặc format file đó.
- Nếu canary phát hiện defect, dừng remediation; viết spec/plan TDD riêng và forward-fix mới. Không hot-patch Cloud.

## Scope Boundary

Plan này chỉ hoàn thành Task 13 Step 5 và dừng ở checkpoint trước Task 13 Step 7.

- In scope: 467 sensitive direct grants đang active và có `expires_at is null` hoặc đã quá hạn; audit/evidence trực tiếp của việc reissue/revoke.
- Out of scope: bật resolver, tắt legacy governance fallback, tắt System Admin business-approval bypass, tạo Business Role thay thế, thay đổi responsibility assignment, Daily Log Phase 4, Payment Phase 5, workflow hoặc UI mới.

---

### Task 1: Add a reproducible read-only remediation gate

**Files:**

- Create: `supabase/tests/authorization_sensitive_grant_remediation_gate.sql`
- Verify: `supabase/migrations/20260717084356_authorization_business_role_foundation.sql`
- Verify: `supabase/migrations/20260717090703_authorization_governance_commands.sql`

**Interfaces:**

- Consumes: `public.user_permission_grants`, `public.permission_actions`, `app_private.permission_hardening_settings`, role/assignment tables.
- Produces: checkpoint `authorization_sensitive_grant_remediation_gate_passed`; no persistent database mutation.

- [ ] **Step 1: Create the failing Cloud gate**

Create `supabase/tests/authorization_sensitive_grant_remediation_gate.sql` with exactly:

```sql
-- Task 13 Step 5 final gate. Read-only assertions only.

do $$
declare
  v_unresolved bigint;
  v_enabled_flags bigint;
  v_durable_operators bigint;
  v_disabled_assignments bigint;
  v_system_identity_direct bigint;
begin
  select count(*)
  into v_unresolved
  from public.user_permission_grants grant_row
  join public.permission_actions action_row
    on action_row.permission_code = grant_row.permission_code
   and action_row.is_active
  where grant_row.is_active
    and action_row.risk_level = 'sensitive'
    and (
      grant_row.expires_at is null
      or grant_row.expires_at <= now()
      or char_length(btrim(coalesce(grant_row.grant_reason, ''))) < 10
    );

  if v_unresolved <> 0 then
    raise exception 'Sensitive direct-grant remediation is incomplete: % unresolved rows',
      v_unresolved using errcode = '23514';
  end if;

  select count(*)
  into v_enabled_flags
  from app_private.permission_hardening_settings setting_row
  where setting_row.key in (
    'business_role_resolver_enabled',
    'legacy_governance_fallback_disabled',
    'system_admin_business_approval_bypass_disabled'
  )
    and setting_row.value <> 'false'::jsonb;

  if v_enabled_flags <> 0 then
    raise exception 'Authorization rollout flags changed during remediation'
      using errcode = '55000';
  end if;

  select count(distinct user_row.id)
  into v_durable_operators
  from public.users user_row
  join public.principal_role_assignments assignment_row
    on assignment_row.principal_type = 'user'
   and assignment_row.principal_id = user_row.id
   and assignment_row.status = 'ACTIVE'
   and assignment_row.starts_at <= now()
   and assignment_row.expires_at is null
  join public.role_permission_templates role_row
    on role_row.id = assignment_row.role_template_id
   and role_row.is_active
  join public.role_permission_template_items item_row
    on item_row.template_id = role_row.id
   and item_row.permission_code = 'system.authorization.manage_roles'
   and item_row.scope_type = 'global'
   and item_row.scope_id = '*'
  where user_row.role = 'ADMIN'
    and user_row.is_active
    and user_row.account_status = 'ACTIVE'
    and assignment_row.scope_type = 'global'
    and assignment_row.scope_id = '*';

  if v_durable_operators < 1 then
    raise exception 'Durable rollout operator is missing'
      using errcode = '55000';
  end if;

  select count(*)
  into v_disabled_assignments
  from public.principal_role_assignments assignment_row
  join public.users user_row
    on user_row.id = assignment_row.principal_id
  where assignment_row.principal_type = 'user'
    and assignment_row.status = 'ACTIVE'
    and (not user_row.is_active or user_row.account_status <> 'ACTIVE');

  if v_disabled_assignments <> 0 then
    raise exception 'Disabled accounts retain active Business Role assignments'
      using errcode = '23514';
  end if;

  select count(*)
  into v_system_identity_direct
  from public.user_permission_grants grant_row
  where grant_row.is_active
    and grant_row.permission_code = 'system.settings.manage';

  if v_system_identity_direct <> 0 then
    raise exception 'System identity permission exists as a direct grant'
      using errcode = '42501';
  end if;
end;
$$;

select 'authorization_sensitive_grant_remediation_gate_passed' as checkpoint;
```

- [ ] **Step 2: Run the gate and verify RED against current Cloud data**

Run:

```bash
set -a
source .env
set +a
npx supabase db query --linked --file \
  supabase/tests/authorization_sensitive_grant_remediation_gate.sql
```

Expected: non-zero exit with SQLSTATE `23514` and aggregate message showing `467 unresolved rows`. No row, flag or migration-history mutation persists.

- [ ] **Step 3: Run focused static verification**

Run:

```bash
npm test -- \
  lib/__tests__/authorizationBusinessRoleMigration.test.ts \
  lib/__tests__/authorizationGovernanceService.test.ts \
  lib/__tests__/authorizationGovernanceViewModel.test.ts \
  lib/__tests__/authorizationBackendCheckpointMigration.test.ts
git diff --check -- \
  supabase/tests/authorization_sensitive_grant_remediation_gate.sql
```

Expected: existing tests pass; only the intentional linked-Cloud gate remains RED.

- [ ] **Step 4: Do not commit the RED gate yet**

Leave only the new gate file uncommitted. Confirm the operator-owned dirty Phase 2 plan remains untouched:

```bash
git status --short
```

Expected: the new gate file plus the pre-existing operator-owned plan modification; nothing staged.

---

### Task 2: Freeze the baseline and prepare the 90-day control window

**Files:**

- Modify later: `docs/security/phase02-business-role-sod-live-apply-log.md`
- Verify: `pages/settings/SettingsAuthorizationGovernance.tsx`
- Verify: `components/permissions/PrincipalDirectGrantPanel.tsx`

**Interfaces:**

- Consumes: authenticated Permission Admin session and Cloud aggregate inventory.
- Produces: one fixed `REMEDIATION_EXPIRES_AT`, baseline aggregate, and an operator-approved pilot principal selected only in the UI.

- [ ] **Step 1: Reconfirm the exact repository and Cloud posture**

Run:

```bash
git status --short
git rev-parse HEAD
git branch --show-current
npx supabase migration list --linked | rg \
  '20260717084356|20260717084903|20260717085909|20260717090703|20260717092007|20260717092508|20260717093122|20260718012151|20260718031842'
```

Expected: all nine listed versions align local/remote; the only unrelated dirty file is the operator-owned Phase 2 plan.

- [ ] **Step 2: Capture aggregate baseline and prove flags remain off**

Run this read-only linked query:

```bash
set -a
source .env
set +a
npx supabase db query --linked --output json "
select
  count(*) as unresolved_rows,
  count(distinct grant_row.user_id) as affected_principals,
  count(distinct grant_row.permission_code) as affected_permission_codes,
  count(*) filter (where grant_row.expires_at is null) as null_expiry_rows,
  count(*) filter (where grant_row.expires_at <= now()) as past_expiry_rows,
  (select count(*)
   from app_private.permission_hardening_settings setting_row
   where setting_row.key in (
     'business_role_resolver_enabled',
     'legacy_governance_fallback_disabled',
     'system_admin_business_approval_bypass_disabled'
   ) and setting_row.value <> 'false'::jsonb) as enabled_rollout_flags
from public.user_permission_grants grant_row
join public.permission_actions action_row
  on action_row.permission_code = grant_row.permission_code
 and action_row.is_active
where grant_row.is_active
  and action_row.risk_level = 'sensitive'
  and (grant_row.expires_at is null or grant_row.expires_at <= now());
"
```

Expected baseline: `467` rows, `23` principals, `26` permission codes, `467` null-expiry rows, `0` past-expiry rows and `0` enabled rollout flags.

- [ ] **Step 3: Calculate one fixed 90-day expiry**

Run once in the execution shell:

```bash
REMEDIATION_EXPIRES_AT="$(node -e "const d=new Date(); d.setUTCDate(d.getUTCDate()+90); d.setUTCSeconds(0,0); process.stdout.write(d.toISOString())")"
REMEDIATION_EXPIRES_AT_LOCAL="$(node -e "const d=new Date(process.argv[1]); const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d); process.stdout.write(parts.replace(' ','T'))" "$REMEDIATION_EXPIRES_AT")"
node -e "const value=process.argv[1]; if (!(new Date(value) > new Date())) process.exit(1)" \
  "$REMEDIATION_EXPIRES_AT"
```

Expected: exit `0`. `REMEDIATION_EXPIRES_AT` is the canonical UTC value and
`REMEDIATION_EXPIRES_AT_LOCAL` is the exact `datetime-local` value entered in
the UI for timezone `Asia/Ho_Chi_Minh`. Record only the canonical cutoff and
aggregate baseline in the live apply log; do not record principal identities.

- [ ] **Step 4: Confirm the authenticated actor and choose the pilot**

In the application:

1. Open `Cài đặt` → `Phân quyền`.
2. Confirm the current actor can see Business Roles, Direct grant and Audit sections.
3. Select one active non-admin principal with the smallest business-approved remediation set.
4. Confirm the pilot is not the current Permission Admin and has no concurrent permission edit in progress.

Expected: one pilot is approved in the live session. Do not copy its name, email or ID into the plan/apply log.

- [ ] **Step 5: Stop at the pilot mutation checkpoint**

Present the fixed cutoff, pilot affected-row count, proposed retain count and proposed revoke count. Do not click `Lưu direct grant` until the operator approves those aggregate counts.

---

### Task 3: Remediate and verify one pilot principal

**Files:**

- Use: `components/permissions/PrincipalDirectGrantPanel.tsx`
- Use: `lib/permissions/permissionAdminService.ts`
- Use: `lib/permissions/authorizationGovernanceService.ts`
- Modify evidence after PASS: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**

- Consumes: complete fresh direct-grant draft, business-owner retain/revoke decisions, fixed cutoff and governed preview/mutation RPCs.
- Produces: one remediated principal, exactly one change audit event, zero unresolved sensitive grants for that principal.

- [ ] **Step 1: Capture pilot before-counts without identity evidence**

Immediately before UI editing, run the Task 2 aggregate query again and record in runtime:

- global unresolved count;
- global active direct-grant count;
- global `direct_permission_grants_changed` audit-event count.

Do not add principal filters or IDs to committed evidence.

- [ ] **Step 2: Build the full replacement draft in the UI**

For the selected principal:

1. Refresh the `Phân quyền` page so direct grants and effective sources are current.
2. Leave every non-sensitive direct grant unchanged.
3. For each affected sensitive grant classified `retain`, keep the checkbox selected and set the UI expiry to the fixed `REMEDIATION_EXPIRES_AT_LOCAL` value; after save it must round-trip to canonical UTC `REMEDIATION_EXPIRES_AT`.
4. For each affected sensitive grant classified `revoke`, clear only that exact permission/scope checkbox.
5. Enter reason `Task 13 Step 5: rà soát quyền nhạy cảm theo phê duyệt 2026-07-18`.

Expected: `PermissionDiffPreview` matches the approved retain/revoke counts and shows no unrelated direct-grant change. Role/Legacy badges are informational and must not change checkbox state.

- [ ] **Step 3: Run authoritative backend preview**

Click `Preview backend` once.

Expected:

- draft key remains unchanged after preview;
- no hard deny;
- no invented scope or adjacent permission;
- warnings, if any, are reviewed individually rather than auto-accepted.

If a warning exists, fill its `SodWarningPanel` with an independent control owner, reason of at least ten characters, concrete compensating controls and a future acceptance expiry. If the business owner does not approve the warning evidence, cancel this principal and leave data unchanged.

- [ ] **Step 4: Save exactly once**

Click `Lưu direct grant` once and wait for refresh.

Expected: the RPC completes successfully; the selected principal reloads with all retained sensitive grants using the fixed future expiry and revoked grants absent from the active draft.

- [ ] **Step 5: Verify the pilot postconditions**

Run aggregate verification immediately:

```sql
select
  count(*) filter (
    where grant_row.is_active
      and action_row.risk_level = 'sensitive'
      and (grant_row.expires_at is null or grant_row.expires_at <= now())
  ) as unresolved_rows,
  count(*) filter (where grant_row.is_active) as active_direct_grants,
  (select count(*)
   from public.permission_audit_events audit_row
   where audit_row.event_type = 'direct_permission_grants_changed') as change_events
from public.user_permission_grants grant_row
join public.permission_actions action_row
  on action_row.permission_code = grant_row.permission_code;
```

Expected:

- unresolved count decreases by exactly the pilot affected-row count;
- active direct-grant count changes only by the approved revoke count;
- change-event count increases by exactly `1`;
- all three rollout flags remain `false`.

In the UI, refresh effective sources and confirm each retained/revoked exact permission/scope result. An adjacent permission not present in the approved draft must remain absent.

- [ ] **Step 6: Verify exact retry is a no-op**

Without changing the refreshed draft, click `Preview backend` again. Submit only if the UI enables an exact no-op; otherwise the disabled Save state is sufficient UI evidence.

Expected: no new grant row, no expiry drift and no additional `direct_permission_grants_changed` audit event.

- [ ] **Step 7: Record aggregate pilot evidence and stop**

Update the live apply log with timestamp, fixed cutoff, before/after unresolved counts, retain/revoke counts, one audit event and flags `false`. Do not commit identities or raw grant payloads.

Stop for explicit approval before processing the remaining principals.

---

### Task 4: Process the remaining principals in bounded batches

**Files:**

- Modify after each batch: `docs/security/phase02-business-role-sod-live-apply-log.md`
- Use: existing Settings authorization UI and governed RPCs only.

**Interfaces:**

- Consumes: pilot PASS pattern and business-owner decisions for the next principals.
- Produces: monotonically decreasing unresolved count with an auditable one-command-per-principal history.

- [ ] **Step 1: Prepare a batch of at most three principals**

For each batch, the business owner must approve aggregate retain/revoke counts for no more than three active principals. Keep identities and row-level decisions in the authenticated UI session only.

Expected: no principal is included without a complete classification decision.

- [ ] **Step 2: Re-read the global baseline before the batch**

Run the Task 2 aggregate query and record unresolved rows, affected principals and enabled flags in runtime.

Expected: unresolved rows equal the prior checkpoint result and enabled flags equal `0`. Any unexplained drift stops the batch.

- [ ] **Step 3: Execute the full Task 3 preview/save/verify sequence per principal**

For each principal, sequentially:

1. refresh the principal draft;
2. preserve non-sensitive rows;
3. apply the fixed cutoff to retained sensitive rows;
4. clear revoked sensitive rows;
5. preview backend;
6. resolve approved warnings or stop;
7. save exactly once;
8. refresh and verify exact permission/scope sources;
9. confirm global unresolved count decreases by the approved amount and audit count increases by one.

Never prepare the next principal before the current principal's postconditions pass.

- [ ] **Step 4: Close the batch checkpoint**

After at most three principals, record only:

- processed-principal count;
- retained-row count;
- revoked-row count;
- unresolved-row count;
- audit-event delta;
- enabled rollout flags, expected `0`.

Run `git diff --check` on the live apply log. Stop for operator approval before the next batch.

- [ ] **Step 5: Repeat until the unresolved aggregate reaches zero**

Expected final operational aggregate:

- unresolved sensitive direct grants: `0`;
- affected principals remaining: `0`;
- retained active sensitive grants all have the fixed future cutoff and a reason of at least ten characters;
- revoked rows preserve revoke actor/time/reason history;
- no rollout flag changed.

---

### Task 5: Turn the gate GREEN and prepare the resolver approval checkpoint

**Files:**

- Verify: `supabase/tests/authorization_sensitive_grant_remediation_gate.sql`
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`
- Do not modify: `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`

**Interfaces:**

- Consumes: zero unresolved aggregate and completed batch evidence.
- Produces: committed remediation evidence and an exact stop point before resolver enablement.

- [ ] **Step 1: Run the read-only gate and verify GREEN**

Run:

```bash
set -a
source .env
set +a
npx supabase db query --linked --file \
  supabase/tests/authorization_sensitive_grant_remediation_gate.sql
```

Expected: exit `0` and checkpoint `authorization_sensitive_grant_remediation_gate_passed`.

- [ ] **Step 2: Re-run Cloud security/performance inventory**

Run:

```bash
npx supabase db advisors --linked --type security --level warn --agent=no -o json | jq 'length'
npx supabase db advisors --linked --type performance --level warn --agent=no -o json | jq 'length'
```

Expected: investigate any new warning before continuing; unchanged baselines are security `170` and performance `97`.

- [ ] **Step 3: Run repository verification**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected: 170 test files and 993 tests pass or a strictly higher expected count after adding contract coverage; TypeScript and build pass with only the existing large-chunk advisory. The operator-owned dirty Phase 2 plan remains unstaged.

- [ ] **Step 4: Finalize aggregate evidence**

Update `docs/security/phase02-business-role-sod-live-apply-log.md` with:

- fixed 90-day cutoff;
- total processed principals, retained rows and revoked rows;
- final unresolved count `0`;
- audit-event delta equal to the number of changed principals;
- no-op retry evidence;
- gate checkpoint PASS;
- all three flags still `false`;
- durable rollout-operator count at least `1`;
- advisors and repository verification results;
- explicit statement that no Business Role, responsibility assignment, migration history or rollout flag changed.

Do not include principal identities or raw before/after grant payloads.

- [ ] **Step 5: Commit only the gate and evidence**

Run:

```bash
git add \
  supabase/tests/authorization_sensitive_grant_remediation_gate.sql \
  docs/security/phase02-business-role-sod-live-apply-log.md
git diff --cached --check
git commit -m "docs(authz): record sensitive grant remediation gate"
git status --short
```

Expected: commit succeeds; the operator-owned Phase 2 plan modification remains unstaged.

- [ ] **Step 6: Push the evidence commit to the existing draft PR**

Run:

```bash
git push origin refactor/module-du-an-v1
```

Expected: existing draft PR `#1` advances to the evidence commit; no second PR is created.

- [ ] **Step 7: Stop before resolver mutation**

Present exact commit SHA, Cloud gate PASS, final aggregate `0`, flags `false`, advisor results and preview-deployment status. Request a new explicit approval for Task 13 Step 7.

Do not call:

```ts
await supabase.rpc('set_authorization_rollout_flags', {
  p_business_role_resolver_enabled: true,
  p_legacy_governance_fallback_disabled: false,
  p_admin_business_approval_bypass_disabled: false,
  p_reason: 'Enable additive Business Role resolver canary',
});
```

until that separate approval is received.

---

## Completion Criteria

- The linked Cloud gate reports zero active sensitive direct grants with null/past expiry or missing change reason.
- Every retained sensitive grant has the shared future 90-day cutoff.
- Every revoked row keeps audit history; every changed principal has exactly one replacement audit event.
- No unrelated non-sensitive direct grant changes.
- No Business Role, responsibility assignment, migration-history row or rollout flag changes.
- All three rollout flags remain `false` and at least one durable rollout operator remains active.
- Repository verification and Supabase advisors show no new failure.
- Execution stops before resolver enablement and waits for a new operator approval.
