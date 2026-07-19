# Material Request Provenance Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline and sequentially in the current session. Do not use subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the B1 Material Request retirement provenance drift without restoring retired grants, changing entitlements, editing applied migrations, or exposing private identity/grant/audit payloads.

**Architecture:** Add one forward migration that fixes future full-draft Direct Grant replacement provenance retention and exposes a narrow governed repair command. The repair command derives prior provenance from the immediately preceding governed audit event on the server, updates only `granted_by`, `granted_at`, and `grant_reason`, writes one aggregate repair audit per successful target, and is driven by a fresh-preview UI action that sends no grant tuple or provenance value.

**Tech Stack:** PostgreSQL/Supabase migrations, linked Supabase Cloud rollback-only verification, Supabase JS RPC service wrappers, React 18, TypeScript 5.8, Vitest 4, existing Phase 02 governance UI.

## Global Constraints

- Work only in `/Users/admin/khotienthinh/.worktrees/material-request-readiness-tranche-b`.
- The written Remediation C spec is approved by the operator on 2026-07-19 before this plan was created.
- Do not edit `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`.
- Do not edit any applied migration, especially `supabase/migrations/20260718092455_unified_permission_change_command.sql` and `supabase/migrations/20260718123119_authorization_audit_readiness.sql`.
- Create the remediation migration only with `npx supabase migration new authorization_material_request_provenance_remediation`.
- Do not use `supabase db push`, local Supabase, Docker, `--local`, `supabase start`, or `supabase db reset`.
- Do not direct-SQL mutate Cloud grants, Business Roles, warning acceptances, rollout flags, readiness rows, migration history, or the 12 pending principals.
- Browser payloads must not include actor identity, provenance fields, grant tuples, raw audit payloads, Auth IDs, tokens, database URLs, or private manifest paths.
- Cloud evidence must be aggregate-only. Report counts, booleans, and approved fingerprints only.
- Stop fail-closed on any hard deny, warning, stale fingerprint, unexpected nonzero count, duplicate/ambiguous recovery tuple, enabled rollout flag, active retired key, or invariant drift.
- Do not run C1 migration apply or C2 repair saves without explicit operator approval at that checkpoint.
- Every behavior change follows TDD: write failing focused test, observe RED, implement minimum, observe GREEN, then widen verification.

---

## File Responsibility Map

**Database contracts and gates**

- Create: `lib/__tests__/authorizationProvenanceRemediationMigration.test.ts` - static contract for the forward migration, repair RPCs, ACLs, provenance-retention rule, aggregate audit, and rollback-only gates.
- Create: `supabase/tests/authorization_material_request_provenance_recovery_gate.sql` - rollback-only aggregate C0/C1 recovery evidence gate.
- Modify: `supabase/tests/authorization_governance_commands_smoke.sql` - existing command smoke gains forward provenance-retention and repair idempotency coverage.
- Modify: `supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql` - C3 reconstruction accepts inactive retired source rows carrying the approved B1 retirement reason and counts repair audits.
- Modify: `lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts` - static lock for the revised rollback-only manifest gate.
- Create: `supabase/migrations/<generated>_authorization_material_request_provenance_remediation.sql` - forward-only function replacements and repair RPCs.

**Frontend service and UI**

- Modify: `lib/permissions/authorizationGovernanceTypes.ts` - add aggregate-only repair preview/result types.
- Modify: `lib/permissions/authorizationGovernanceService.ts` - add actor-free repair preview/apply RPC wrappers and mappers.
- Modify: `lib/__tests__/authorizationGovernanceService.test.ts` - lock payload shape with no actor/provenance/grant tuple.
- Modify: `components/permissions/PrincipalDirectGrantPanel.tsx` - render a narrow repair action only after backend preview says eligible; keep existing Direct Grant edit unchanged.
- Modify: `lib/__tests__/authorizationAdminUiContract.test.ts` - static UI contract for fresh repair preview, no actor/provenance payload, and no repair control without eligibility.

**Verification and evidence**

- Verify only: `docs/superpowers/specs/2026-07-19-material-request-provenance-remediation-design.md`.
- Verify only until Cloud C3 PASS: `docs/security/phase02-task3-permission-readiness-matrix.md`.
- Verify only until Cloud C3 PASS: `docs/security/phase02-business-role-sod-live-apply-log.md`.

---

### Task 1: Add Failing Remediation Contracts And Recovery Gate

**Files:**
- Create: `lib/__tests__/authorizationProvenanceRemediationMigration.test.ts`
- Create: `supabase/tests/authorization_material_request_provenance_recovery_gate.sql`
- Modify: `lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts`

**Interfaces:**
- Consumes: current Phase 02 migration/test style, `permission_audit_events`, `user_permission_grants`, and the approved B1 reason.
- Produces: RED static coverage for a migration that does not exist yet, plus a rollback-only aggregate C0/C1 gate.

- [ ] **Step 1: Write the failing migration static contract**

Create `lib/__tests__/authorizationProvenanceRemediationMigration.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase', 'migrations');
const migrationFiles = fs.readdirSync(migrationDir)
  .filter(file => file.endsWith('_authorization_material_request_provenance_remediation.sql'))
  .sort();
const migrationSql = migrationFiles.length === 1
  ? fs.readFileSync(path.join(migrationDir, migrationFiles[0]), 'utf8')
  : '';
const normalized = migrationSql.replace(/\s+/g, ' ').trim();

const recoveryGatePath = path.resolve(
  process.cwd(),
  'supabase/tests/authorization_material_request_provenance_recovery_gate.sql',
);
const recoveryGateSql = fs.existsSync(recoveryGatePath)
  ? fs.readFileSync(recoveryGatePath, 'utf8')
  : '';

describe('Material Request provenance remediation migration', () => {
  it('creates one forward remediation migration', () => {
    expect(migrationFiles).toHaveLength(1);
    expect(normalized).toMatch(/create or replace function app_private\.replace_user_permission_grants_v2_impl/i);
    expect(normalized).toMatch(/existing\.granted_by/i);
    expect(normalized).toMatch(/existing\.granted_at/i);
    expect(normalized).toMatch(/existing\.grant_reason/i);
    expect(normalized).toMatch(/case when existing\.is_active and existing\.revoked_at is null/i);
    expect(normalized).not.toMatch(/delete from public\.user_permission_grants/i);
  });

  it('adds aggregate-only governed repair preview and apply RPCs', () => {
    expect(normalized).toMatch(/preview_material_request_retirement_provenance_repair/i);
    expect(normalized).toMatch(/apply_material_request_retirement_provenance_repair/i);
    expect(normalized).toMatch(/v_actor_user_id uuid := public\.current_app_user_id\(\)/i);
    expect(normalized).toMatch(/system\.authorization\.manage_grants/i);
    expect(normalized).toMatch(/direct_permission_grants_provenance_repaired/i);
    expect(normalized).toMatch(/changedCount/i);
    expect(normalized).toMatch(/expectedFingerprint/i);
    expect(normalized).not.toMatch(/p_actor|p_granted_by|p_granted_at|p_grant_reason/i);
  });

  it('keeps repair output and audit metadata aggregate-only', () => {
    expect(normalized).toMatch(/jsonb_build_object\([^;]*'eligible'/is);
    expect(normalized).toMatch(/jsonb_build_object\([^;]*'changedCount'/is);
    expect(normalized).toMatch(/jsonb_build_object\([^;]*'fingerprint'/is);
    expect(normalized).not.toMatch(/jsonb_agg\([^)]*user_id/is);
    expect(normalized).not.toMatch(/jsonb_agg\([^)]*permission_code/is);
    expect(normalized).not.toMatch(/before_grants,\s*v_before/is);
    expect(normalized).not.toMatch(/after_grants,\s*v_after/is);
  });

  it('uses safe definer boundaries and least execute privilege', () => {
    expect(normalized).toMatch(/security definer\s+set search_path = ''/i);
    expect(normalized).toMatch(/security invoker\s+set search_path = ''/i);
    expect(normalized).toMatch(/revoke all on function public\.preview_material_request_retirement_provenance_repair\(uuid\) from public, anon/i);
    expect(normalized).toMatch(/grant execute on function public\.preview_material_request_retirement_provenance_repair\(uuid\) to authenticated/i);
    expect(normalized).toMatch(/revoke all on function public\.apply_material_request_retirement_provenance_repair\(uuid,text,text\) from public, anon/i);
    expect(normalized).toMatch(/grant execute on function public\.apply_material_request_retirement_provenance_repair\(uuid,text,text\) to authenticated/i);
  });

  it('has a rollback-only aggregate recovery gate', () => {
    expect(recoveryGateSql).toMatch(/^begin;[\s\S]*rollback;\s*$/i);
    expect(recoveryGateSql).toContain('Task 13 Step 5: thu hồi quyền Material Request đã retire');
    expect(recoveryGateSql).toMatch(/app\.expected_affected_active_count/i);
    expect(recoveryGateSql).toMatch(/app\.expected_affected_sensitive_count/i);
    expect(recoveryGateSql).toMatch(/app\.expected_recoverable_count/i);
    expect(recoveryGateSql).toMatch(/authorization_material_request_provenance_recovery_gate_passed/i);
    expect(recoveryGateSql).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create)\b/i);
  });
});
```

- [ ] **Step 2: Write the rollback-only aggregate recovery gate**

Create `supabase/tests/authorization_material_request_provenance_recovery_gate.sql`:

```sql
begin;

do $$
declare
  v_expected_active_retired_count bigint :=
    current_setting('app.expected_active_retired_count', true)::bigint;
  v_expected_active_sensitive_count bigint :=
    current_setting('app.expected_active_sensitive_count', true)::bigint;
  v_expected_active_direct_grant_count bigint :=
    current_setting('app.expected_active_direct_grant_count', true)::bigint;
  v_expected_b1_audit_count bigint :=
    current_setting('app.expected_b1_audit_count', true)::bigint;
  v_expected_repair_audit_count bigint :=
    current_setting('app.expected_repair_audit_count', true)::bigint;
  v_expected_affected_active_count bigint :=
    current_setting('app.expected_affected_active_count', true)::bigint;
  v_expected_affected_sensitive_count bigint :=
    current_setting('app.expected_affected_sensitive_count', true)::bigint;
  v_expected_recoverable_count bigint :=
    current_setting('app.expected_recoverable_count', true)::bigint;
  v_expected_non_sensitive_fingerprint text :=
    current_setting('app.expected_non_sensitive_fingerprint', true);
  v_expected_durable_operator_count bigint :=
    current_setting('app.expected_durable_operator_count', true)::bigint;
  v_actual record;
begin
  with constants as (
    select
      'Task 13 Step 5: thu hồi quyền Material Request đã retire'::text as b1_reason,
      'Task 13 Step 5: khôi phục provenance sau thu hồi Material Request'::text as repair_reason
  ), b1_events as (
    select event_row.id, event_row.target_user_id, event_row.created_at
    from public.permission_audit_events event_row, constants c
    where event_row.event_type = 'direct_permission_grants_changed'
      and event_row.metadata ->> 'reason' = c.b1_reason
  ), b1_target_rollup as (
    select target_user_id, count(*) as event_count
    from b1_events
    group by target_user_id
  ), latest_b1_by_target as (
    select distinct on (target_user_id) id, target_user_id, created_at
    from b1_events
    order by target_user_id, created_at desc, id desc
  ), previous_direct_event as (
    select
      b1.target_user_id,
      previous_event.actor_user_id is not null as previous_actor_present,
      previous_event.created_at is not null as previous_timestamp_present,
      btrim(coalesce(previous_event.metadata ->> 'reason', '')) <> '' as previous_reason_present,
      previous_event.after_grants
    from latest_b1_by_target b1
    left join lateral (
      select event_row.actor_user_id, event_row.created_at, event_row.metadata, event_row.after_grants
      from public.permission_audit_events event_row
      where event_row.target_user_id = b1.target_user_id
        and event_row.created_at < b1.created_at
        and event_row.event_type in ('direct_permission_grants_changed', 'replace_user_permission_grants')
      order by event_row.created_at desc, event_row.id desc
      limit 1
    ) previous_event on true
  ), affected as (
    select grant_row.user_id, grant_row.permission_code, grant_row.scope_type, grant_row.scope_id, action_row.risk_level
    from public.user_permission_grants grant_row
    join latest_b1_by_target b1 on b1.target_user_id = grant_row.user_id
    join public.permission_actions action_row
      on action_row.permission_code = grant_row.permission_code
     and action_row.is_active
    join constants c on true
    where grant_row.is_active
      and grant_row.grant_reason = c.b1_reason
  ), previous_matches as (
    select
      affected.user_id,
      affected.permission_code,
      affected.scope_type,
      affected.scope_id,
      count(*) as match_count,
      bool_and(
        previous_event.previous_actor_present
        and previous_event.previous_timestamp_present
        and previous_event.previous_reason_present
      ) as event_provenance_present
    from affected
    join previous_direct_event previous_event
      on previous_event.target_user_id = affected.user_id
    join lateral jsonb_array_elements(coalesce(previous_event.after_grants, '[]'::jsonb)) prev_item(item)
      on coalesce(prev_item.item ->> 'permission_code', prev_item.item ->> 'permissionCode') = affected.permission_code
     and coalesce(prev_item.item ->> 'scope_type', prev_item.item ->> 'scopeType') = affected.scope_type
     and coalesce(prev_item.item ->> 'scope_id', prev_item.item ->> 'scopeId') = affected.scope_id
    group by affected.user_id, affected.permission_code, affected.scope_type, affected.scope_id
  ), affected_summary as (
    select
      count(*) as affected_active_count,
      count(*) filter (where risk_level = 'sensitive') as affected_sensitive_count,
      count(*) filter (
        where coalesce(match_count, 0) = 1
          and coalesce(event_provenance_present, false)
      ) as recoverable_count,
      count(*) filter (
        where coalesce(match_count, 0) <> 1
          or not coalesce(event_provenance_present, false)
      ) as unrecoverable_or_ambiguous_count
    from affected
    left join previous_matches using (user_id, permission_code, scope_type, scope_id)
  )
  select
    (select count(*) from public.user_permission_grants where is_active and permission_code in (
      'project.material_request.confirm',
      'project.material_request.verify'
    )) as active_retired_count,
    (select count(*) from public.user_permission_grants grant_row join public.permission_actions action_row
      on action_row.permission_code = grant_row.permission_code and action_row.is_active
      where grant_row.is_active and action_row.risk_level = 'sensitive') as active_sensitive_count,
    (select count(*) from public.user_permission_grants where is_active) as active_direct_grant_count,
    (select count(*) from b1_events) as b1_audit_count,
    (select count(*) from b1_target_rollup where event_count = 1) as b1_targets_with_exactly_one_audit,
    (select count(*) from public.permission_audit_events event_row, constants c
      where event_row.event_type = 'direct_permission_grants_provenance_repaired'
        and event_row.metadata ->> 'reason' = c.repair_reason) as repair_audit_count,
    affected_summary.affected_active_count,
    affected_summary.affected_sensitive_count,
    affected_summary.recoverable_count,
    affected_summary.unrecoverable_or_ambiguous_count,
    (select md5(coalesce(string_agg(concat_ws('|', grant_row.user_id::text,
      grant_row.permission_code, grant_row.scope_type, grant_row.scope_id,
      coalesce(to_char(grant_row.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '')),
      E'\n' order by grant_row.user_id, grant_row.permission_code, grant_row.scope_type, grant_row.scope_id), ''))
      from public.user_permission_grants grant_row
      join public.permission_actions action_row
        on action_row.permission_code = grant_row.permission_code and action_row.is_active
      where grant_row.is_active and action_row.risk_level <> 'sensitive') as non_sensitive_fingerprint,
    (select count(distinct user_row.id)
      from public.users user_row
      join public.principal_role_assignments assignment_row
        on assignment_row.principal_type = 'user'
       and assignment_row.principal_id = user_row.id
       and assignment_row.status = 'ACTIVE'
       and assignment_row.starts_at <= now()
       and assignment_row.expires_at is null
       and assignment_row.scope_type = 'global'
       and assignment_row.scope_id = '*'
      join public.role_permission_templates template_row
        on template_row.id = assignment_row.role_template_id and template_row.is_active
      join public.role_permission_template_items item_row
        on item_row.template_id = template_row.id
       and item_row.permission_code = 'system.authorization.manage_roles'
       and item_row.scope_type = 'global'
       and item_row.scope_id = '*'
      where user_row.role = 'ADMIN'
        and user_row.is_active
        and user_row.account_status = 'ACTIVE') as durable_operator_count,
    (select count(*) from app_private.permission_hardening_settings where value = 'true'::jsonb) as enabled_hardening_flag_count
  into v_actual
  from affected_summary;

  if v_actual.active_retired_count <> v_expected_active_retired_count
    or v_actual.active_sensitive_count <> v_expected_active_sensitive_count
    or v_actual.active_direct_grant_count <> v_expected_active_direct_grant_count
    or v_actual.b1_audit_count <> v_expected_b1_audit_count
    or v_actual.b1_targets_with_exactly_one_audit <> v_expected_b1_audit_count
    or v_actual.repair_audit_count <> v_expected_repair_audit_count
    or v_actual.affected_active_count <> v_expected_affected_active_count
    or v_actual.affected_sensitive_count <> v_expected_affected_sensitive_count
    or v_actual.recoverable_count <> v_expected_recoverable_count
    or v_actual.unrecoverable_or_ambiguous_count <> 0
    or v_actual.non_sensitive_fingerprint <> v_expected_non_sensitive_fingerprint
    or v_actual.durable_operator_count <> v_expected_durable_operator_count
    or v_actual.enabled_hardening_flag_count <> 0 then
    raise exception 'Material Request provenance recovery gate mismatch';
  end if;
end;
$$;

select 'authorization_material_request_provenance_recovery_gate_passed' as checkpoint;

rollback;
```

- [ ] **Step 3: Extend the manifest gate static test for C3**

Append to `lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts`:

```ts
  it('recognizes B1-retired historical source rows and remediation audit count', () => {
    const sql = fs.readFileSync(gatePath, 'utf8');
    expect(sql).toContain('Task 13 Step 5: thu hồi quyền Material Request đã retire');
    expect(sql).toMatch(/expected_repair_audit_count/i);
    expect(sql).toMatch(/direct_permission_grants_provenance_repaired/i);
  });
```

- [ ] **Step 4: Run focused tests and observe RED**

Run:

```bash
npx vitest run \
  lib/__tests__/authorizationProvenanceRemediationMigration.test.ts \
  lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts
```

Expected: FAIL because the remediation migration is absent and the existing manifest gate has not been updated for B1-retired source rows or repair audit count.

### Task 2: Implement Forward Migration With Provenance Retention And Repair RPCs

**Files:**
- Create: `supabase/migrations/<generated>_authorization_material_request_provenance_remediation.sql`
- Modify: `supabase/tests/authorization_governance_commands_smoke.sql`
- Modify: `supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql`

**Interfaces:**
- Consumes: existing `app_private.replace_user_permission_grants_v2_impl`, `public.current_app_user_id()`, `app_private.assert_authorization_permission(text)`, `permission_audit_events`, and `user_permission_grants`.
- Produces: future full-draft replacement retains unchanged active provenance; repair preview/apply RPCs restore only the three provenance fields from prior audit event provenance.

- [ ] **Step 1: Create the forward migration with Supabase CLI**

Run:

```bash
npx supabase migration --help
npx supabase migration new authorization_material_request_provenance_remediation
REMEDIATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_material_request_provenance_remediation\.sql$')"
test -n "$REMEDIATION_MIGRATION"
```

Expected: exactly one new migration path. Do not rename its timestamp.

- [ ] **Step 2: Replace direct-grant upsert provenance rules**

In the generated migration, redefine `app_private.replace_user_permission_grants_v2_impl(uuid,jsonb,text,jsonb)` by copying the current function body from `supabase/migrations/20260717093122_authorization_backend_checkpoint_hardening.sql` and changing only the `on conflict` update clause to:

```sql
on conflict (user_id, permission_code, scope_type, scope_id) do update
set is_active = true,
    granted_by = case
      when user_permission_grants.is_active
       and user_permission_grants.revoked_at is null
       and user_permission_grants.expires_at is not distinct from excluded.expires_at
      then user_permission_grants.granted_by
      else excluded.granted_by
    end,
    granted_at = case
      when user_permission_grants.is_active
       and user_permission_grants.revoked_at is null
       and user_permission_grants.expires_at is not distinct from excluded.expires_at
      then user_permission_grants.granted_at
      else excluded.granted_at
    end,
    expires_at = excluded.expires_at,
    grant_reason = case
      when user_permission_grants.is_active
       and user_permission_grants.revoked_at is null
       and user_permission_grants.expires_at is not distinct from excluded.expires_at
      then user_permission_grants.grant_reason
      else excluded.grant_reason
    end,
    revoked_at = null,
    revoked_by = null,
    revoked_reason = null,
    updated_at = now();
```

Keep the existing no-op check, target lock, validation, SoD warning recording, revoke behavior, audit event, and optional legacy projection call unchanged.

- [ ] **Step 3: Add private candidate and fingerprint helpers**

Add this helper family in the same migration:

```sql
create or replace function app_private.material_request_retirement_provenance_repair_fingerprint(
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(coalesce(string_agg(
    concat_ws('|',
      grant_row.user_id::text,
      grant_row.permission_code,
      grant_row.scope_type,
      grant_row.scope_id,
      coalesce(to_char(grant_row.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), ''),
      coalesce(grant_row.granted_by::text, ''),
      coalesce(to_char(grant_row.granted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), ''),
      coalesce(grant_row.grant_reason, '')
    ),
    E'\n'
    order by grant_row.permission_code, grant_row.scope_type, grant_row.scope_id
  ), ''))
  from public.user_permission_grants grant_row
  where grant_row.user_id = p_user_id
    and grant_row.is_active;
$$;

create or replace function app_private.material_request_retirement_provenance_repair_candidates(
  p_user_id uuid
)
returns table (
  grant_id uuid,
  permission_code text,
  scope_type text,
  scope_id text,
  previous_actor_user_id uuid,
  previous_granted_at timestamptz,
  previous_grant_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  with constants as (
    select 'Task 13 Step 5: thu hồi quyền Material Request đã retire'::text as b1_reason
  ), b1_event as (
    select event_row.target_user_id, event_row.created_at
    from public.permission_audit_events event_row, constants c
    where event_row.target_user_id = p_user_id
      and event_row.event_type = 'direct_permission_grants_changed'
      and event_row.metadata ->> 'reason' = c.b1_reason
    order by event_row.created_at desc, event_row.id desc
    limit 1
  ), previous_event as (
    select
      event_row.actor_user_id,
      event_row.created_at,
      btrim(coalesce(event_row.metadata ->> 'reason', '')) as reason,
      event_row.after_grants
    from b1_event b1
    join public.permission_audit_events event_row
      on event_row.target_user_id = b1.target_user_id
     and event_row.created_at < b1.created_at
     and event_row.event_type in ('direct_permission_grants_changed', 'replace_user_permission_grants')
    order by event_row.created_at desc, event_row.id desc
    limit 1
  )
  select
    grant_row.id,
    grant_row.permission_code,
    grant_row.scope_type,
    grant_row.scope_id,
    previous_event.actor_user_id,
    previous_event.created_at,
    previous_event.reason
  from public.user_permission_grants grant_row
  join constants c on true
  join previous_event on true
  where grant_row.user_id = p_user_id
    and grant_row.is_active
    and grant_row.grant_reason = c.b1_reason
    and previous_event.actor_user_id is not null
    and previous_event.created_at is not null
    and previous_event.reason <> ''
    and exists (
      select 1
      from jsonb_array_elements(coalesce(previous_event.after_grants, '[]'::jsonb)) prev_item(item)
      where coalesce(prev_item.item ->> 'permission_code', prev_item.item ->> 'permissionCode') = grant_row.permission_code
        and coalesce(prev_item.item ->> 'scope_type', prev_item.item ->> 'scopeType') = grant_row.scope_type
        and coalesce(prev_item.item ->> 'scope_id', prev_item.item ->> 'scopeId') = grant_row.scope_id
      group by 1
      having count(*) = 1
    );
$$;

revoke all on function app_private.material_request_retirement_provenance_repair_fingerprint(uuid)
  from public, anon, authenticated;
revoke all on function app_private.material_request_retirement_provenance_repair_candidates(uuid)
  from public, anon, authenticated;
```

- [ ] **Step 4: Add preview RPC with aggregate-only output**

Add:

```sql
create or replace function app_private.preview_material_request_retirement_provenance_repair_impl(
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_b1_audit_count bigint;
  v_active_retired_count bigint;
  v_candidate_count bigint;
  v_recoverable_count bigint;
  v_fingerprint text;
begin
  if v_actor_user_id is null
    or not app_private.has_permission(
      v_actor_user_id,
      'system.authorization.manage_grants',
      'global',
      '*'
    )
  then
    raise exception 'Authorization administration permission required'
      using errcode = '42501';
  end if;

  select count(*) into v_b1_audit_count
  from public.permission_audit_events event_row
  where event_row.target_user_id = p_user_id
    and event_row.event_type = 'direct_permission_grants_changed'
    and event_row.metadata ->> 'reason' =
      'Task 13 Step 5: thu hồi quyền Material Request đã retire';

  select count(*) into v_active_retired_count
  from public.user_permission_grants grant_row
  where grant_row.user_id = p_user_id
    and grant_row.is_active
    and grant_row.permission_code in (
      'project.material_request.confirm',
      'project.material_request.verify'
    );

  select count(*) into v_candidate_count
  from public.user_permission_grants grant_row
  where grant_row.user_id = p_user_id
    and grant_row.is_active
    and grant_row.grant_reason =
      'Task 13 Step 5: thu hồi quyền Material Request đã retire';

  select count(*) into v_recoverable_count
  from app_private.material_request_retirement_provenance_repair_candidates(p_user_id);

  v_fingerprint :=
    app_private.material_request_retirement_provenance_repair_fingerprint(p_user_id);

  return jsonb_build_object(
    'eligible',
      v_b1_audit_count = 1
      and v_active_retired_count = 0
      and v_candidate_count > 0
      and v_candidate_count = v_recoverable_count,
    'changedCount', v_candidate_count,
    'recoverableCount', v_recoverable_count,
    'activeRetiredCount', v_active_retired_count,
    'b1AuditCount', v_b1_audit_count,
    'expectedFingerprint', v_fingerprint
  );
end;
$$;

create or replace function public.preview_material_request_retirement_provenance_repair(
  p_user_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.preview_material_request_retirement_provenance_repair_impl(p_user_id);
$$;
```

- [ ] **Step 5: Add apply RPC with atomic repair and idempotent no-op**

Add:

```sql
create or replace function app_private.apply_material_request_retirement_provenance_repair_impl(
  p_user_id uuid,
  p_expected_fingerprint text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_preview jsonb;
  v_candidate_count bigint;
  v_repair_audit_count bigint;
  v_changed_count bigint := 0;
  v_command_id uuid := gen_random_uuid();
begin
  if v_actor_user_id is null
    or not app_private.has_permission(
      v_actor_user_id,
      'system.authorization.manage_grants',
      'global',
      '*'
    )
  then
    raise exception 'Authorization administration permission required'
      using errcode = '42501';
  end if;

  if v_reason <> 'Task 13 Step 5: khôi phục provenance sau thu hồi Material Request' then
    raise exception 'Material Request provenance repair reason is not approved'
      using errcode = '22023';
  end if;

  perform 1
  from public.users user_row
  where user_row.id = p_user_id
    and user_row.is_active
    and user_row.account_status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'Active target user required'
      using errcode = '23514';
  end if;

  v_preview :=
    app_private.preview_material_request_retirement_provenance_repair_impl(p_user_id);
  v_candidate_count := (v_preview ->> 'changedCount')::bigint;

  select count(*) into v_repair_audit_count
  from public.permission_audit_events event_row
  where event_row.target_user_id = p_user_id
    and event_row.event_type = 'direct_permission_grants_provenance_repaired'
    and event_row.metadata ->> 'reason' = v_reason;

  if v_candidate_count = 0 and v_repair_audit_count = 1 then
    return jsonb_build_object(
      'changedCount', 0,
      'noOp', true,
      'expectedFingerprint', v_preview ->> 'expectedFingerprint'
    );
  end if;

  if coalesce((v_preview ->> 'eligible')::boolean, false) is not true then
    raise exception 'Material Request provenance repair is not eligible'
      using errcode = '55000';
  end if;

  if p_expected_fingerprint is null
    or p_expected_fingerprint is distinct from v_preview ->> 'expectedFingerprint'
  then
    raise exception 'Permission state changed after repair preview'
      using errcode = '40001';
  end if;

  with candidates as (
    select *
    from app_private.material_request_retirement_provenance_repair_candidates(p_user_id)
  ), repaired as (
    update public.user_permission_grants grant_row
    set granted_by = candidates.previous_actor_user_id,
        granted_at = candidates.previous_granted_at,
        grant_reason = candidates.previous_grant_reason,
        updated_at = now()
    from candidates
    where grant_row.id = candidates.grant_id
      and grant_row.user_id = p_user_id
      and grant_row.is_active
      and grant_row.permission_code = candidates.permission_code
      and grant_row.scope_type = candidates.scope_type
      and grant_row.scope_id = candidates.scope_id
    returning grant_row.id
  )
  select count(*) into v_changed_count
  from repaired;

  if v_changed_count <> v_candidate_count then
    raise exception 'Material Request provenance repair changed-count mismatch'
      using errcode = '55000';
  end if;

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  ) values (
    v_actor_user_id,
    p_user_id,
    'direct_permission_grants_provenance_repaired',
    '[]'::jsonb,
    '[]'::jsonb,
    jsonb_build_object(
      'commandId', v_command_id,
      'reason', v_reason,
      'changedCount', v_changed_count,
      'beforeFingerprint', p_expected_fingerprint,
      'afterFingerprint',
        app_private.material_request_retirement_provenance_repair_fingerprint(p_user_id)
    )
  );

  return jsonb_build_object(
    'changedCount', v_changed_count,
    'noOp', false,
    'expectedFingerprint',
      app_private.material_request_retirement_provenance_repair_fingerprint(p_user_id)
  );
end;
$$;

create or replace function public.apply_material_request_retirement_provenance_repair(
  p_user_id uuid,
  p_expected_fingerprint text,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.apply_material_request_retirement_provenance_repair_impl(
    p_user_id,
    p_expected_fingerprint,
    p_reason
  );
$$;
```

Then add exact revokes/grants:

```sql
revoke all on function app_private.preview_material_request_retirement_provenance_repair_impl(uuid)
  from public, anon;
grant execute on function app_private.preview_material_request_retirement_provenance_repair_impl(uuid)
  to authenticated;
revoke all on function public.preview_material_request_retirement_provenance_repair(uuid)
  from public, anon;
grant execute on function public.preview_material_request_retirement_provenance_repair(uuid)
  to authenticated;

revoke all on function app_private.apply_material_request_retirement_provenance_repair_impl(uuid,text,text)
  from public, anon;
grant execute on function app_private.apply_material_request_retirement_provenance_repair_impl(uuid,text,text)
  to authenticated;
revoke all on function public.apply_material_request_retirement_provenance_repair(uuid,text,text)
  from public, anon;
grant execute on function public.apply_material_request_retirement_provenance_repair(uuid,text,text)
  to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 6: Extend SQL smoke for provenance retention and repair**

Append to the direct-grant section in `supabase/tests/authorization_governance_commands_smoke.sql`:

```sql
do $$
declare
  v_target_id uuid := (select second_target_id from phase2_governance_smoke_ids);
  v_before_actor uuid;
  v_before_at timestamptz;
  v_before_reason text;
  v_preview jsonb;
  v_apply jsonb;
  v_event_count bigint;
begin
  perform public.replace_user_permission_grants_v2(
    v_target_id,
    jsonb_build_array(jsonb_build_object(
      'permission_code', 'project.material_po.create',
      'scope_type', 'project',
      'scope_id', 'project-retain',
      'is_active', true,
      'expires_at', null
    )),
    'Initial provenance retained by later full draft',
    '[]'::jsonb
  );

  select granted_by, granted_at, grant_reason
  into v_before_actor, v_before_at, v_before_reason
  from public.user_permission_grants
  where user_id = v_target_id
    and permission_code = 'project.material_po.create'
    and scope_id = 'project-retain'
    and is_active;

  perform public.replace_user_permission_grants_v2(
    v_target_id,
    jsonb_build_array(jsonb_build_object(
      'permission_code', 'project.material_po.create',
      'scope_type', 'project',
      'scope_id', 'project-retain',
      'is_active', true,
      'expires_at', null
    ), jsonb_build_object(
      'permission_code', 'project.daily_log.view',
      'scope_type', 'project',
      'scope_id', 'project-retain',
      'is_active', true,
      'expires_at', null
    )),
    'Add adjacent direct grant without rewriting retained provenance',
    '[]'::jsonb
  );

  if not exists (
    select 1
    from public.user_permission_grants grant_row
    where grant_row.user_id = v_target_id
      and grant_row.permission_code = 'project.material_po.create'
      and grant_row.scope_id = 'project-retain'
      and grant_row.granted_by is not distinct from v_before_actor
      and grant_row.granted_at is not distinct from v_before_at
      and grant_row.grant_reason is not distinct from v_before_reason
  ) then
    raise exception 'Unchanged active direct grant provenance was rewritten';
  end if;

  update public.user_permission_grants
  set grant_reason = 'Task 13 Step 5: thu hồi quyền Material Request đã retire'
  where user_id = v_target_id
    and permission_code in ('project.material_po.create', 'project.daily_log.view')
    and scope_id = 'project-retain'
    and is_active;

  v_preview := public.preview_material_request_retirement_provenance_repair(v_target_id);
  if coalesce((v_preview ->> 'eligible')::boolean, false) is not true
    or (v_preview ->> 'changedCount')::integer <> 2
    or (v_preview ->> 'recoverableCount')::integer <> 2
    or v_preview ? 'grantRows'
    or v_preview ? 'provenance'
  then
    raise exception 'Provenance repair preview was not aggregate-only eligible';
  end if;

  v_apply := public.apply_material_request_retirement_provenance_repair(
    v_target_id,
    v_preview ->> 'expectedFingerprint',
    'Task 13 Step 5: khôi phục provenance sau thu hồi Material Request'
  );
  if (v_apply ->> 'changedCount')::integer <> 2 then
    raise exception 'Provenance repair changed-count mismatch';
  end if;

  select count(*) into v_event_count
  from public.permission_audit_events event_row
  where event_row.target_user_id = v_target_id
    and event_row.event_type = 'direct_permission_grants_provenance_repaired';

  perform public.apply_material_request_retirement_provenance_repair(
    v_target_id,
    v_preview ->> 'expectedFingerprint',
    'Task 13 Step 5: khôi phục provenance sau thu hồi Material Request'
  );

  if (
    select count(*)
    from public.permission_audit_events event_row
    where event_row.target_user_id = v_target_id
      and event_row.event_type = 'direct_permission_grants_provenance_repaired'
  ) <> v_event_count then
    raise exception 'Provenance repair retry duplicated audit event';
  end if;
end;
$$;
```

This smoke uses transaction-local fixtures only. It may mutate fixture rows inside the rollback transaction; it must never be run as a Cloud apply.

- [ ] **Step 7: Update the manifest revision gate for C3**

In `supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql`, add:

```sql
  v_repair_audit_setting text := current_setting('app.expected_repair_audit_count', true);
  v_expected_repair_audit_count bigint;
  v_repair_audit_count bigint;
```

Validate it with the other settings:

```sql
    or coalesce(v_repair_audit_setting, '') = ''
```

Assign:

```sql
  v_expected_repair_audit_count := v_repair_audit_setting::bigint;
```

Extend `source_rows` so the B1-retired inactive rows remain historical source rows:

```sql
        or (
          not grant_row.is_active
          and grant_row.permission_code in (
            'project.material_request.confirm',
            'project.material_request.verify'
          )
          and grant_row.revoked_reason =
            'Task 13 Step 5: thu hồi quyền Material Request đã retire'
        )
```

Add the repair audit assertion before the final `end;`:

```sql
  select count(*)
  into v_repair_audit_count
  from public.permission_audit_events event_row
  where event_row.event_type = 'direct_permission_grants_provenance_repaired'
    and event_row.metadata ->> 'reason' =
      'Task 13 Step 5: khôi phục provenance sau thu hồi Material Request';

  if v_repair_audit_count <> v_expected_repair_audit_count then
    raise exception 'Material Request provenance repair audit count changed';
  end if;
```

- [ ] **Step 8: Run focused static tests and rollback-only smoke**

Run:

```bash
npx vitest run \
  lib/__tests__/authorizationProvenanceRemediationMigration.test.ts \
  lib/__tests__/authorizationBusinessRoleMigration.test.ts \
  lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts
REMEDIATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_material_request_provenance_remediation\.sql$')"
git diff --check -- \
  "$REMEDIATION_MIGRATION" \
  supabase/tests/authorization_governance_commands_smoke.sql \
  supabase/tests/authorization_material_request_provenance_recovery_gate.sql \
  supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql \
  lib/__tests__/authorizationProvenanceRemediationMigration.test.ts \
  lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts
```

Expected: static tests PASS and no whitespace findings. SQL smoke execution waits for Task 5's linked rollback bundle because this environment does not use local Supabase.

### Task 3: Add Actor-Free Frontend Repair Service Contracts

**Files:**
- Modify: `lib/permissions/authorizationGovernanceTypes.ts`
- Modify: `lib/permissions/authorizationGovernanceService.ts`
- Modify: `lib/__tests__/authorizationGovernanceService.test.ts`

**Interfaces:**
- Consumes: new repair preview/apply RPCs.
- Produces: aggregate-only TypeScript types and wrappers that send target, expected fingerprint, and approved reason only.

- [ ] **Step 1: Write failing service test**

Append to `lib/__tests__/authorizationGovernanceService.test.ts`:

```ts
  it('previews and applies Material Request provenance repair without actor, grants, or provenance payload', async () => {
    supabaseMock.rpc
      .mockResolvedValueOnce({
        data: {
          eligible: true,
          changedCount: 121,
          recoverableCount: 121,
          activeRetiredCount: 0,
          b1AuditCount: 1,
          expectedFingerprint: 'fingerprint-before',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          changedCount: 121,
          noOp: false,
          expectedFingerprint: 'fingerprint-after',
        },
        error: null,
      });

    await expect(
      authorizationGovernanceService.previewMaterialRequestProvenanceRepair('user-1'),
    ).resolves.toMatchObject({
      eligible: true,
      changedCount: 121,
      expectedFingerprint: 'fingerprint-before',
    });

    await expect(
      authorizationGovernanceService.applyMaterialRequestProvenanceRepair(
        'user-1',
        'fingerprint-before',
        'Task 13 Step 5: khôi phục provenance sau thu hồi Material Request',
      ),
    ).resolves.toMatchObject({
      changedCount: 121,
      noOp: false,
    });

    expect(supabaseMock.rpc.mock.calls[0]).toEqual([
      'preview_material_request_retirement_provenance_repair',
      { p_user_id: 'user-1' },
    ]);
    expect(supabaseMock.rpc.mock.calls[1]).toEqual([
      'apply_material_request_retirement_provenance_repair',
      {
        p_user_id: 'user-1',
        p_expected_fingerprint: 'fingerprint-before',
        p_reason: 'Task 13 Step 5: khôi phục provenance sau thu hồi Material Request',
      },
    ]);
    for (const [, args] of supabaseMock.rpc.mock.calls) {
      const keys = Object.keys(args);
      expect(keys.some(key => /actor|grant|provenance|granted/i.test(key))).toBe(false);
    }
  });
```

- [ ] **Step 2: Run service test and observe RED**

Run:

```bash
npx vitest run lib/__tests__/authorizationGovernanceService.test.ts
```

Expected: FAIL because the service methods and types do not exist.

- [ ] **Step 3: Add repair types**

Append to `lib/permissions/authorizationGovernanceTypes.ts`:

```ts
export interface MaterialRequestProvenanceRepairPreview {
  eligible: boolean;
  changedCount: number;
  recoverableCount: number;
  activeRetiredCount: number;
  b1AuditCount: number;
  expectedFingerprint: string;
}

export interface MaterialRequestProvenanceRepairResult {
  changedCount: number;
  noOp: boolean;
  expectedFingerprint: string;
}
```

- [ ] **Step 4: Add service methods**

Import the two new types in `authorizationGovernanceService.ts`, then add inside `authorizationGovernanceService`:

```ts
  async previewMaterialRequestProvenanceRepair(
    targetUserId: string,
  ): Promise<MaterialRequestProvenanceRepairPreview> {
    if (!isSupabaseConfigured || !targetUserId) {
      return {
        eligible: false,
        changedCount: 0,
        recoverableCount: 0,
        activeRetiredCount: 0,
        b1AuditCount: 0,
        expectedFingerprint: '',
      };
    }
    const { data, error } = await supabase.rpc(
      'preview_material_request_retirement_provenance_repair',
      { p_user_id: targetUserId },
    );
    throwIfError(error);
    return {
      eligible: Boolean(data?.eligible),
      changedCount: Number(data?.changedCount || 0),
      recoverableCount: Number(data?.recoverableCount || 0),
      activeRetiredCount: Number(data?.activeRetiredCount || 0),
      b1AuditCount: Number(data?.b1AuditCount || 0),
      expectedFingerprint: String(data?.expectedFingerprint || ''),
    };
  },

  async applyMaterialRequestProvenanceRepair(
    targetUserId: string,
    expectedFingerprint: string,
    reason: string,
  ): Promise<MaterialRequestProvenanceRepairResult> {
    if (!isSupabaseConfigured || !targetUserId) {
      return { changedCount: 0, noOp: true, expectedFingerprint: '' };
    }
    const { data, error } = await supabase.rpc(
      'apply_material_request_retirement_provenance_repair',
      {
        p_user_id: targetUserId,
        p_expected_fingerprint: expectedFingerprint,
        p_reason: reason.trim(),
      },
    );
    throwIfError(error);
    return {
      changedCount: Number(data?.changedCount || 0),
      noOp: Boolean(data?.noOp),
      expectedFingerprint: String(data?.expectedFingerprint || ''),
    };
  },
```

- [ ] **Step 5: Run service test and observe GREEN**

Run:

```bash
npx vitest run lib/__tests__/authorizationGovernanceService.test.ts
```

Expected: PASS.

### Task 4: Add Fresh-Preview Repair UI In Direct Grant Panel

**Files:**
- Modify: `components/permissions/PrincipalDirectGrantPanel.tsx`
- Modify: `lib/__tests__/authorizationAdminUiContract.test.ts`

**Interfaces:**
- Consumes: service repair preview/apply methods.
- Produces: a narrow repair action that is absent unless eligible, disabled after any direct-grant draft change, and sends no tuple/provenance fields.

- [ ] **Step 1: Write failing UI contract**

Append to `lib/__tests__/authorizationAdminUiContract.test.ts`:

```ts
  it('exposes Material Request provenance repair only through a fresh aggregate preview', () => {
    const panel = read('components/permissions/PrincipalDirectGrantPanel.tsx');
    expect(panel).toContain('previewMaterialRequestProvenanceRepair');
    expect(panel).toContain('applyMaterialRequestProvenanceRepair');
    expect(panel).toContain('Task 13 Step 5: khôi phục provenance sau thu hồi Material Request');
    expect(panel).toContain('repairPreview');
    expect(panel).toContain('repairPreviewedDraftKey');
    expect(panel).toContain('repairPreview.eligible');
    expect(panel).not.toMatch(/grantedBy|grantedAt|grantReason|provenancePayload|p_actor/i);
  });
```

- [ ] **Step 2: Run UI contract and observe RED**

Run:

```bash
npx vitest run lib/__tests__/authorizationAdminUiContract.test.ts
```

Expected: FAIL because the repair UI is absent.

- [ ] **Step 3: Import repair service methods and type**

Update imports in `components/permissions/PrincipalDirectGrantPanel.tsx`:

```ts
import type {
  AuthorizationPrincipal,
  EffectivePermissionSource,
  MaterialRequestProvenanceRepairPreview,
  SodWarningAcceptanceInput,
  UnifiedPermissionPreview,
} from '../../lib/permissions/authorizationGovernanceTypes';
import {
  authorizationGovernanceService,
} from '../../lib/permissions/authorizationGovernanceService';
```

- [ ] **Step 4: Add repair state and reset it on direct draft change**

Add state:

```ts
const [repairPreview, setRepairPreview] = useState<MaterialRequestProvenanceRepairPreview | null>(null);
const [repairPreviewedDraftKey, setRepairPreviewedDraftKey] = useState<string | null>(null);
const [repairBusy, setRepairBusy] = useState<'preview' | 'save' | null>(null);
```

Inside the existing `useEffect` reset:

```ts
setRepairPreview(null);
setRepairPreviewedDraftKey(null);
```

Inside `updateDrafts`:

```ts
setRepairPreview(null);
setRepairPreviewedDraftKey(null);
```

Add:

```ts
const repairMatches = repairPreview !== null && repairPreviewedDraftKey === currentDraftKey;
```

- [ ] **Step 5: Add repair preview and apply handlers**

Add constants and handlers inside the component:

```ts
const MATERIAL_REQUEST_PROVENANCE_REPAIR_REASON =
  'Task 13 Step 5: khôi phục provenance sau thu hồi Material Request';

const handleRepairPreview = async () => {
  setRepairBusy('preview');
  setMessage('');
  try {
    const nextPreview = await authorizationGovernanceService
      .previewMaterialRequestProvenanceRepair(principal.userId);
    setRepairPreview(nextPreview);
    setRepairPreviewedDraftKey(currentDraftKey);
    if (!nextPreview.eligible) {
      setMessage('Principal này chưa đủ điều kiện khôi phục provenance Material Request.');
    }
  } catch {
    setMessage('Không thể preview khôi phục provenance Material Request.');
  } finally {
    setRepairBusy(null);
  }
};

const handleRepairSave = async () => {
  if (!repairPreview || !repairMatches || !repairPreview.eligible) {
    setMessage('Hãy preview lại khôi phục provenance trước khi lưu.');
    return;
  }
  if (!repairPreview.expectedFingerprint) {
    setMessage('Preview khôi phục provenance thiếu fingerprint.');
    return;
  }
  setRepairBusy('save');
  setMessage('');
  try {
    const result = await authorizationGovernanceService.applyMaterialRequestProvenanceRepair(
      principal.userId,
      repairPreview.expectedFingerprint,
      MATERIAL_REQUEST_PROVENANCE_REPAIR_REASON,
    );
    await onSaved();
    setRepairPreview(null);
    setRepairPreviewedDraftKey(null);
    setMessage(result.noOp
      ? 'Không có provenance cần khôi phục.'
      : `Đã khôi phục provenance cho ${result.changedCount} quyền.`);
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    setMessage(code === '40001'
      ? 'Dữ liệu quyền đã thay đổi; hãy tải lại và preview lại trước khi khôi phục provenance.'
      : 'Backend đã từ chối khôi phục provenance Material Request.');
  } finally {
    setRepairBusy(null);
  }
};
```

- [ ] **Step 6: Render the aggregate-only repair action**

Render below the retired Direct Grants removal block:

```tsx
<div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/60 p-3">
  <div className="text-[10px] font-black uppercase text-sky-800">
    Khôi phục provenance Material Request
  </div>
  {repairPreview?.eligible && repairMatches && (
    <div className="text-xs font-bold text-slate-700">
      Sẵn sàng khôi phục {repairPreview.changedCount} quyền.
    </div>
  )}
  <div className="flex justify-end gap-2">
    <button
      type="button"
      onClick={handleRepairPreview}
      disabled={panelDisabled || busy !== null || repairBusy !== null}
      className="flex items-center gap-2 rounded-lg border border-sky-200 px-4 py-2 text-xs font-black text-sky-700 disabled:opacity-50"
    >
      {repairBusy === 'preview' ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
      Preview repair
    </button>
    <button
      type="button"
      onClick={handleRepairSave}
      disabled={
        panelDisabled ||
        busy !== null ||
        repairBusy !== null ||
        !repairPreview?.eligible ||
        !repairMatches
      }
      className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50"
    >
      {repairBusy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
      Khôi phục provenance
    </button>
  </div>
</div>
```

This UI displays only aggregate counts and does not render candidate identities, grant keys, audit JSON, actor IDs, or provenance values.

- [ ] **Step 7: Run UI/service focused tests**

Run:

```bash
npx vitest run \
  lib/__tests__/authorizationAdminUiContract.test.ts \
  lib/__tests__/authorizationGovernanceService.test.ts
```

Expected: PASS.

### Task 5: Linked Rollback Verification Before Cloud C1

**Files:**
- Verify: all files from Tasks 1-4.

**Interfaces:**
- Consumes: local candidate migration plus SQL smokes and gates.
- Produces: aggregate rollback evidence that no Cloud schema/data persists before C1 approval.

- [ ] **Step 1: Run focused and full static verification**

Run:

```bash
npx vitest run \
  lib/__tests__/authorizationProvenanceRemediationMigration.test.ts \
  lib/__tests__/authorizationBusinessRoleMigration.test.ts \
  lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts \
  lib/__tests__/authorizationGovernanceService.test.ts \
  lib/__tests__/authorizationAdminUiContract.test.ts \
  lib/__tests__/authorizationGovernanceViewModel.test.ts
npm test
npx tsc --noEmit
git diff --check
git status --short
```

Expected: focused tests PASS, full suite PASS, TypeScript PASS, no whitespace findings. Only the Remediation C files are modified.

- [ ] **Step 2: Run C0 recovery gate on current Cloud before migration smoke**

Build a private `/tmp` SQL bundle with mode `0600` that sets:

```sql
select set_config('app.expected_active_retired_count', '0', true);
select set_config('app.expected_active_sensitive_count', '95', true);
select set_config('app.expected_active_direct_grant_count', '2274', true);
select set_config('app.expected_b1_audit_count', '3', true);
select set_config('app.expected_repair_audit_count', '0', true);
select set_config('app.expected_affected_active_count', '363', true);
select set_config('app.expected_affected_sensitive_count', '69', true);
select set_config('app.expected_recoverable_count', '363', true);
select set_config('app.expected_non_sensitive_fingerprint', '632d0ce644dcec52126eabf7b44909ca', true);
select set_config('app.expected_durable_operator_count', '1', true);
```

Then append `supabase/tests/authorization_material_request_provenance_recovery_gate.sql` and run:

```bash
npx supabase db query --linked --agent=no --file "$BUNDLE"
```

Expected: checkpoint `authorization_material_request_provenance_recovery_gate_passed`; transaction rolls back; aggregate counts only.

- [ ] **Step 3: Run migration plus SQL smokes in one linked rollback transaction**

Build a private `/tmp` bundle:

```bash
REMEDIATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_material_request_provenance_remediation\.sql$')"
BUNDLE="$(mktemp /tmp/provenance-remediation-rollback.XXXXXX)"
node - "$BUNDLE" "$REMEDIATION_MIGRATION" supabase/tests/authorization_governance_commands_smoke.sql <<'NODE'
const fs = require('fs');
const out = process.argv[2];
const files = process.argv.slice(3);
const sql = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
fs.writeFileSync(
  out,
  "begin; set local lock_timeout='5s'; set local statement_timeout='120s';\n" +
    sql +
    "\nselect 'authorization_material_request_provenance_remediation_rollback_passed' as checkpoint; rollback;\n",
  { mode: 0o600 },
);
NODE
test -s "$BUNDLE"
npx supabase db query --linked --agent=no --file "$BUNDLE"
```

Expected: checkpoint `authorization_material_request_provenance_remediation_rollback_passed`; Cloud schema/data unchanged because the outer transaction rolls back.

- [ ] **Step 4: Stop for Cloud Gate C1 approval**

Report only:

```text
Checkpoint C-local PASS:
- focused/full tests:
- TypeScript:
- diff check:
- C0 recovery gate:
- linked rollback migration smoke:
- Cloud mutation: none
Next: request C1 approval to apply exactly the CLI-generated remediation migration version printed by basename/cut.
```

Do not apply the migration until the operator explicitly approves C1.

### Task 6: Cloud Gate C1, C2, And C3 Procedures

**Files:**
- Modify only after C3 PASS: `docs/security/phase02-task3-permission-readiness-matrix.md`
- Modify only after C3 PASS: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**
- Consumes: operator approvals and local/rollback evidence.
- Produces: applied forward migration, three bounded governed repair saves, final rollback-only reconstruction proof, and aggregate-only documentation.

- [ ] **Step 1: C1 apply forward migration after explicit approval**

After approval, run only the new migration in one transaction:

```bash
REMEDIATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_material_request_provenance_remediation\.sql$')"
BUNDLE="$(mktemp /tmp/provenance-remediation-apply.XXXXXX)"
node - "$BUNDLE" "$REMEDIATION_MIGRATION" <<'NODE'
const fs = require('fs');
const out = process.argv[2];
const migration = process.argv[3];
const sql = fs.readFileSync(migration, 'utf8');
fs.writeFileSync(
  out,
  "begin; set local lock_timeout='5s'; set local statement_timeout='120s';\n" +
    sql +
    "\nselect 'authorization_material_request_provenance_remediation_applied' as checkpoint; commit;\n",
  { mode: 0o600 },
);
NODE
test -s "$BUNDLE"
npx supabase db query --linked --agent=no --file "$BUNDLE"
```

Expected: checkpoint `authorization_material_request_provenance_remediation_applied`. Do not repair migration history unless separately approved.

- [ ] **Step 2: Re-run C0 gate and C1 smoke after apply**

Run the C0 recovery gate with repair audit `0`, then run migration-specific smoke checks against committed schema inside a rollback transaction. Expected: C0 still PASS; RPCs exist; no repair audit exists; active retired `0`; Direct Grants `2274`; flags `0`.

- [ ] **Step 3: Stop for exact C2 reason and repair-save approval**

Ask the operator to confirm this exact reason:

```text
Task 13 Step 5: khôi phục provenance sau thu hồi Material Request
```

Do not repair through UI/RPC until the exact reason and C2 approval are confirmed.

- [ ] **Step 4: Run three bounded repair saves through authenticated governed UI**

For each of the three eligible principals:

1. Reload the selected principal.
2. Click `Preview repair`.
3. Stop on `eligible=false`, hard deny, warning, stale draft key, active retired count, or missing fingerprint.
4. Click `Khôi phục provenance` once with the exact approved reason.
5. Reload the principal.
6. Run the same repair apply only as the UI-supported identical retry/no-op proof if the UI/backend returns no additional event.

Report after each principal only:

```text
C2 principal <n>/3:
- changedCount:
- retry no-op:
- repair audits total:
- active retired:
- active sensitive:
- Direct Grants:
- flags:
Next:
```

Never print the principal identity, email, grant keys, audit JSON, actor, timestamp, or provenance values.

- [ ] **Step 5: Run C3 rollback-only reconstruction gate**

Run `supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql` with settings:

```sql
select set_config('app.expected_original_source_count', '467', true);
select set_config('app.expected_original_source_fingerprint', 'a3d0cf9514e487111c5ae27873c8f6cd', true);
select set_config('app.expected_original_regrant_count', '421', true);
select set_config('app.expected_original_regrant_fingerprint', '00a8f7f0f3a39721474a582592cf0b2e', true);
select set_config('app.expected_revised_regrant_count', '383', true);
select set_config('app.expected_revised_regrant_fingerprint', '43676e109ad8c48a83243adedcfa6e33', true);
select set_config('app.expected_non_sensitive_fingerprint', '632d0ce644dcec52126eabf7b44909ca', true);
select set_config('app.expected_active_direct_grant_count', '2274', true);
select set_config('app.expected_durable_operator_count', '1', true);
select set_config('app.expected_regrant_expires_at', '2026-10-16T12:10:00+07:00', true);
select set_config('app.expected_repair_audit_count', '3', true);
```

Expected: checkpoint `authorization_sensitive_grant_manifest_revision_gate_passed`; transaction rolls back.

- [ ] **Step 6: Commit aggregate evidence only after C3 PASS**

Update only the two evidence documents with aggregate counts and checkpoint timestamps:

```bash
npm test
npx tsc --noEmit
git diff --check
git add \
  docs/security/phase02-task3-permission-readiness-matrix.md \
  docs/security/phase02-business-role-sod-live-apply-log.md
git commit -m "docs(authz): record material provenance remediation"
```

Expected: no identity, raw grants, audit payloads, URLs, tokens, or private manifest paths are committed.

## Self-Review

- Spec coverage: future provenance retention, repair RPC contract, UI fresh-preview requirement, manifest source filter, C0/C1/C2/C3 gates, and non-goals are each mapped to at least one task.
- Placeholder scan: this plan contains no unfinished-marker text and no unspecified implementation bucket.
- Type consistency: frontend preview/result type names match service methods and SQL RPC result keys; SQL RPC names match the spec.
- Boundary review: no task edits applied migrations, no task uses local Docker/Supabase, no task mutates Cloud before explicit C1/C2 approvals, and no task touches the 12 blocked principals except the bounded C2 provenance repair targets.
