# VIOO Sensitive Direct-Grant Revoke-All/Regrant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thu hồi toàn bộ 467 active sensitive direct grants thiếu expiry, chứng minh checkpoint active sensitive source bằng không, rồi chỉ cấp lại direct grants được business owner duyệt với đúng permission/scope và một cutoff chung 90 ngày.

**Architecture:** Quy trình global two-phase dùng một manifest cục bộ bảo mật đã duyệt trước maintenance, nhưng không lưu identity hoặc raw grant payload trong Git/chat. Mỗi principal được preview và mutate tuần tự qua `preview_direct_grant_replacement` và `replace_user_permission_grants_v2`; hai read-only Cloud gates kiểm tra zero-source giữa hai pha và exact approved regrant ở cuối. Không có bulk SQL mutation, Business Role replacement hoặc rollout-flag change.

**Tech Stack:** Node.js ESM, React Settings authorization UI, Supabase Cloud Postgres/Data API, Supabase CLI `2.95.6+`, governed authorization RPCs, Vitest, TypeScript, Vite.

## Global Constraints

- Design source: `docs/superpowers/specs/2026-07-18-vioo-sensitive-direct-grant-revoke-all-regrant-design.md`.
- Chỉ dùng Supabase Cloud; không dùng Docker, Supabase local, `--local`, `supabase start`, `supabase db reset` hoặc `supabase db push`.
- Giữ cả ba rollout flags ở `false` trong toàn bộ plan; không gọi `set_authorization_rollout_flags`.
- Không update/insert trực tiếp `public.user_permission_grants`; mọi mutation đi qua authenticated Permission Admin và `public.replace_user_permission_grants_v2`.
- Không sửa migrations đã apply, không tạo privileged bulk command và không hot-patch Cloud.
- Preflight phải đúng 467 unique source keys, 23 principals và 26 permission codes; unexplained drift là blocker.
- Business owner phải quyết định đủ 467 rows thành `REGRANT` hoặc `DROP` trước mutation đầu tiên; `REGRANT + DROP = 467` và không còn `UNDECIDED`.
- Tất cả regranted rows dùng cùng một UTC expiry chính xác 90 ngày từ khi mở maintenance window.
- Non-sensitive direct grants phải giữ nguyên fingerprint qua cả hai pha.
- Revoke phase phải hoàn tất global zero-source gate trước regrant đầu tiên.
- Warning SoD không được auto-accept; hard deny luôn dừng principal hiện tại.
- Không ghi principal name/ID, email, Auth ID, token, manifest path hoặc raw grant payload vào Git, apply log hay chat. Chỉ ghi counts, timestamps và fingerprints.
- Manifest và raw Cloud export là local temporary secrets, mode `0600`, nằm trong một `mktemp -d` path và chỉ bị xóa sau final gate PASS cùng operator confirmation.
- File dirty có sẵn `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md` thuộc operator; không stage, overwrite hoặc format file đó.
- Nếu canary phát hiện defect, dừng Cloud mutation; viết forward-fix spec/plan riêng. Không mở rộng sang UI/module khác.

## File Map

- Create: `supabase/tests/authorization_sensitive_grant_revoke_all_gate.sql` — zero-source checkpoint giữa hai pha.
- Create: `supabase/tests/authorization_sensitive_grant_regrant_gate.sql` — exact final regrant/fingerprint/expiry checkpoint.
- Modify during execution: `docs/security/phase02-business-role-sod-live-apply-log.md` — aggregate evidence only.
- Use without modification: `components/permissions/PrincipalDirectGrantPanel.tsx`.
- Use without modification: `lib/permissions/permissionAdminService.ts`.
- Use without modification: `lib/permissions/authorizationGovernanceService.ts`.

---

### Task 1: Build and validate the private approved manifest

**Files:**

- Private runtime: a `mktemp -d` directory, raw query JSON and manifest JSON; never add them to Git.
- Modify evidence after approval: `docs/security/phase02-business-role-sod-live-apply-log.md`.

**Interfaces:**

- Consumes: current Cloud source set and business-owner decisions.
- Produces: safe runtime values `SOURCE_FINGERPRINT`, `REGRANT_FINGERPRINT`, `REGRANT_COUNT`, `DROP_COUNT`, `REGRANT_PRINCIPAL_COUNT`, and `NON_SENSITIVE_FINGERPRINT`.

- [ ] **Step 1: Reconfirm exact baseline and flags**

Run a read-only linked query proving:

```sql
select
  count(*) as source_rows,
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
   ) and setting_row.value <> 'false'::jsonb) as enabled_flags
from public.user_permission_grants grant_row
join public.permission_actions action_row
  on action_row.permission_code = grant_row.permission_code
 and action_row.is_active
where grant_row.is_active
  and action_row.risk_level = 'sensitive';
```

Expected: `467`, `23`, `26`, `467`, `0`, `0`. This also proves no future-expiring active sensitive row exists outside the source set. Separately prove all 23 source principals are active. The current Cloud posture has one active Permission Admin and that principal is inside the source set; retain this as a safe aggregate, not an identity.

- [ ] **Step 2: Create the private directory and capture timestamp**

Run:

```bash
umask 077
PRIVATE_DIR="$(mktemp -d /tmp/vioo-sensitive-regrant.XXXXXX)"
RAW_EXPORT="$PRIVATE_DIR/source.json"
MANIFEST="$PRIVATE_DIR/manifest.json"
SOURCE_CAPTURED_AT="$(node -e "const d=new Date(); d.setUTCSeconds(0,0); process.stdout.write(d.toISOString())")"
chmod 700 "$PRIVATE_DIR"
```

Expected: directory mode `0700`; files inherit mode `0600`. Do not print the directory path outside the execution shell.

- [ ] **Step 3: Export the exact source set without terminal output**

Run `npx supabase db query --linked --agent=no --output json` with the following SQL and redirect stdout only to `RAW_EXPORT`:

```sql
select
  grant_row.user_id as principal_id,
  user_row.name as principal_label,
  grant_row.permission_code,
  grant_row.scope_type,
  grant_row.scope_id,
  app_private.has_permission(
    grant_row.user_id,
    'system.authorization.manage_grants',
    'global',
    '*'
  ) as is_permission_admin
from public.user_permission_grants grant_row
join public.permission_actions action_row
  on action_row.permission_code = grant_row.permission_code
 and action_row.is_active
join public.users user_row
  on user_row.id = grant_row.user_id
where grant_row.is_active
  and action_row.risk_level = 'sensitive'
order by grant_row.user_id, grant_row.permission_code,
  grant_row.scope_type, grant_row.scope_id;
```

Expected: the private JSON array contains 467 rows and never appears in chat/apply log. CLI notices remain on stderr and are not written into the JSON file.

- [ ] **Step 4: Bootstrap the private manifest**

Run this local transformation; it prints only a safe count:

```bash
node --input-type=module - "$RAW_EXPORT" "$MANIFEST" \
  "$SOURCE_CAPTURED_AT" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';

const [rawPath, manifestPath, sourceCapturedAt] = process.argv.slice(2);
const sourceRows = JSON.parse(readFileSync(rawPath, 'utf8'));
if (!Array.isArray(sourceRows) || sourceRows.length !== 467) {
  throw new Error('Expected exactly 467 source rows');
}
const rows = sourceRows.map(row => ({
  principalId: row.principal_id,
  principalLabel: row.principal_label,
  permissionCode: row.permission_code,
  scopeType: row.scope_type,
  scopeId: row.scope_id,
  isPermissionAdmin: row.is_permission_admin,
  decision: 'UNDECIDED',
}));
writeFileSync(manifestPath, JSON.stringify({ sourceCapturedAt, rows }, null, 2), {
  mode: 0o600,
});
process.stdout.write(JSON.stringify({ sourceCount: rows.length }));
NODE
```

Expected: output `{"sourceCount":467}` only.

- [ ] **Step 5: Complete business decisions before maintenance**

Using the private manifest and `Cài đặt` → `Phân quyền`, change every `UNDECIDED` to exactly `REGRANT` or `DROP`. Do not edit principal, permission or scope keys. Finish all 467 decisions before the first Cloud mutation.

- [ ] **Step 6: Validate decisions and calculate safe fingerprints**

Run this validator; it prints no identity:

```bash
MANIFEST_SUMMARY="$(node --input-type=module - "$MANIFEST" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!Array.isArray(manifest.rows) || manifest.rows.length !== 467) {
  throw new Error('Expected exactly 467 manifest rows');
}
const captured = new Date(manifest.sourceCapturedAt);
if (!Number.isFinite(captured.getTime())) throw new Error('Invalid source capture timestamp');
const keys = [];
const regrantKeys = [];
const principals = new Set();
const regrantPrincipals = new Set();
const permissionAdmins = new Set();
const regrantPermissionAdmins = new Set();
const seen = new Set();
let regrantCount = 0;
let dropCount = 0;
let undecidedCount = 0;
for (const [index, row] of manifest.rows.entries()) {
  if (typeof row.isPermissionAdmin !== 'boolean') {
    throw new Error(`Invalid Permission Admin marker at row ${index + 1}`);
  }
  if (!['REGRANT', 'DROP', 'UNDECIDED'].includes(row.decision)) {
    throw new Error(`Invalid decision at row ${index + 1}`);
  }
  const key = [row.principalId, row.permissionCode, row.scopeType, row.scopeId].join('|');
  if (seen.has(key)) throw new Error(`Duplicate key at row ${index + 1}`);
  seen.add(key);
  keys.push(key);
  principals.add(row.principalId);
  if (row.isPermissionAdmin) permissionAdmins.add(row.principalId);
  if (row.decision === 'REGRANT') {
    regrantCount += 1;
    regrantKeys.push(key);
    regrantPrincipals.add(row.principalId);
    if (row.isPermissionAdmin) regrantPermissionAdmins.add(row.principalId);
  } else if (row.decision === 'DROP') {
    dropCount += 1;
  } else {
    undecidedCount += 1;
  }
}
if (undecidedCount !== 0) throw new Error(`Manifest contains ${undecidedCount} undecided rows`);
if (principals.size !== 23 || permissionAdmins.size !== 1
  || regrantCount + dropCount !== 467) {
  throw new Error('Manifest aggregate does not match approved source inventory');
}
const hash = values => createHash('md5').update(values.sort().join('\n')).digest('hex');
process.stdout.write(JSON.stringify({
  sourceCount: keys.length,
  principalCount: principals.size,
  regrantPrincipalCount: regrantPrincipals.size,
  permissionAdminPrincipalCount: permissionAdmins.size,
  regrantPermissionAdminPrincipalCount: regrantPermissionAdmins.size,
  regrantCount,
  dropCount,
  sourceFingerprint: hash(keys),
  regrantFingerprint: hash(regrantKeys),
}));
NODE
)"
SOURCE_FINGERPRINT="$(printf '%s' "$MANIFEST_SUMMARY" | jq -r '.sourceFingerprint')"
REGRANT_FINGERPRINT="$(printf '%s' "$MANIFEST_SUMMARY" | jq -r '.regrantFingerprint')"
REGRANT_COUNT="$(printf '%s' "$MANIFEST_SUMMARY" | jq -r '.regrantCount')"
DROP_COUNT="$(printf '%s' "$MANIFEST_SUMMARY" | jq -r '.dropCount')"
REGRANT_PRINCIPAL_COUNT="$(printf '%s' "$MANIFEST_SUMMARY" | jq -r '.regrantPrincipalCount')"
PERMISSION_ADMIN_PRINCIPAL_COUNT="$(printf '%s' "$MANIFEST_SUMMARY" | jq -r '.permissionAdminPrincipalCount')"
REGRANT_PERMISSION_ADMIN_PRINCIPAL_COUNT="$(printf '%s' "$MANIFEST_SUMMARY" | jq -r '.regrantPermissionAdminPrincipalCount')"
```

Expected: exit `0`, no identities in `MANIFEST_SUMMARY`, and `REGRANT_COUNT + DROP_COUNT = 467`.

Because the current Cloud aggregate has exactly one active Permission Admin inside the source set, `REGRANT_PERMISSION_ADMIN_PRINCIPAL_COUNT > 0` is a blocker unless a second independently authenticated Permission Admin already exists before maintenance. Backend forbids sensitive self-grant. Do not create that second operator inside this plan: either the business owner approves `DROP` for all sensitive rows of the sole Permission Admin, or a separate approved bootstrap change must complete first and the 467-row snapshot/manifest must then be rebuilt.

- [ ] **Step 7: Match the manifest to fresh Cloud and freeze non-sensitive state**

Compute fresh Cloud source fingerprint with canonical sorted keys:

```sql
select md5(coalesce(string_agg(
  concat_ws('|', grant_row.user_id::text, grant_row.permission_code,
    grant_row.scope_type, grant_row.scope_id),
  E'\n' order by grant_row.user_id, grant_row.permission_code,
    grant_row.scope_type, grant_row.scope_id
), '')) as source_fingerprint
from public.user_permission_grants grant_row
join public.permission_actions action_row
  on action_row.permission_code = grant_row.permission_code
 and action_row.is_active
where grant_row.is_active
  and action_row.risk_level = 'sensitive';
```

Expected: Cloud hash equals `SOURCE_FINGERPRINT`.

Capture `NON_SENSITIVE_FINGERPRINT` with the exact expression used by both gates:

```sql
select md5(coalesce(string_agg(
  concat_ws('|', grant_row.user_id::text, grant_row.permission_code,
    grant_row.scope_type, grant_row.scope_id,
    coalesce(to_char(grant_row.expires_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US'), '')),
  E'\n' order by grant_row.user_id, grant_row.permission_code,
    grant_row.scope_type, grant_row.scope_id
), '')) as non_sensitive_fingerprint
from public.user_permission_grants grant_row
join public.permission_actions action_row
  on action_row.permission_code = grant_row.permission_code
 and action_row.is_active
where grant_row.is_active
  and action_row.risk_level <> 'sensitive';
```

This fingerprint must remain unchanged through both phases.

Also capture the active non-sensitive count and past-expiry count. The current read-only baseline is `2177` active rows and `0` past-expiry rows. Any past-expiry row is a blocker because the governed RPC replaces the full active direct-grant draft for a principal.

- [ ] **Step 8: Record safe aggregate approval and stop**

Record only capture timestamp, source/regrant/drop counts, principal counts, Permission Admin aggregate counts and fingerprints in the apply log. Do not commit private data or path. The 90-day cutoff is intentionally not calculated until maintenance actually opens.

Stop for explicit approval to open maintenance and begin revoke mutation.

---

### Task 2: Add the two read-only Cloud gates

**Files:**

- Create: `supabase/tests/authorization_sensitive_grant_revoke_all_gate.sql`.
- Create: `supabase/tests/authorization_sensitive_grant_regrant_gate.sql`.

**Interfaces:**

- Revoke gate requires session setting `app.expected_non_sensitive_fingerprint`.
- Final gate requires session settings `app.expected_non_sensitive_fingerprint`, `app.expected_regrant_count`, `app.expected_regrant_fingerprint`, and `app.expected_regrant_expires_at`.

- [ ] **Step 1: Write the zero-source gate**

Create `supabase/tests/authorization_sensitive_grant_revoke_all_gate.sql`:

```sql
begin;

do $$
declare
  v_expected_non_sensitive_fingerprint text :=
    current_setting('app.expected_non_sensitive_fingerprint', true);
  v_active_sensitive_count bigint;
  v_non_sensitive_fingerprint text;
  v_flag_count bigint;
  v_false_flag_count bigint;
begin
  if coalesce(v_expected_non_sensitive_fingerprint, '') = '' then
    raise exception 'Missing app.expected_non_sensitive_fingerprint';
  end if;

  select count(*)
  into v_active_sensitive_count
  from public.user_permission_grants grant_row
  join public.permission_actions action_row
    on action_row.permission_code = grant_row.permission_code
   and action_row.is_active
  where grant_row.is_active
    and action_row.risk_level = 'sensitive';

  if v_active_sensitive_count <> 0 then
    raise exception 'Expected zero active sensitive direct grants, found %',
      v_active_sensitive_count;
  end if;

  select md5(coalesce(string_agg(
    concat_ws('|', grant_row.user_id::text, grant_row.permission_code,
      grant_row.scope_type, grant_row.scope_id,
      coalesce(to_char(grant_row.expires_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US'), '')),
    E'\n' order by grant_row.user_id, grant_row.permission_code,
      grant_row.scope_type, grant_row.scope_id
  ), ''))
  into v_non_sensitive_fingerprint
  from public.user_permission_grants grant_row
  join public.permission_actions action_row
    on action_row.permission_code = grant_row.permission_code
   and action_row.is_active
  where grant_row.is_active
    and action_row.risk_level <> 'sensitive';

  if v_non_sensitive_fingerprint <> v_expected_non_sensitive_fingerprint then
    raise exception 'Non-sensitive direct-grant fingerprint changed';
  end if;

  select
    count(*),
    count(*) filter (where setting_row.value = 'false'::jsonb)
  into v_flag_count, v_false_flag_count
  from app_private.permission_hardening_settings setting_row
  where setting_row.key in (
    'business_role_resolver_enabled',
    'legacy_governance_fallback_disabled',
    'system_admin_business_approval_bypass_disabled'
  );

  if v_flag_count <> 3 or v_false_flag_count <> 3 then
    raise exception 'Authorization rollout flags must all remain false';
  end if;
end;
$$;

select 'authorization_sensitive_grant_revoke_all_gate_passed' as checkpoint;

rollback;
```

- [ ] **Step 2: Prove the zero-source gate is RED before mutation**

Run the file against linked Cloud after setting the expected non-sensitive fingerprint in the same transaction/session. Expected failure: `Expected zero active sensitive direct grants, found 467`. Any earlier or different failure must be fixed before mutation.

- [ ] **Step 3: Write the exact final-regrant gate**

Create `supabase/tests/authorization_sensitive_grant_regrant_gate.sql`:

```sql
begin;

do $$
declare
  v_expected_non_sensitive_fingerprint text :=
    current_setting('app.expected_non_sensitive_fingerprint', true);
  v_expected_regrant_count bigint;
  v_expected_regrant_fingerprint text :=
    current_setting('app.expected_regrant_fingerprint', true);
  v_expected_regrant_expires_at timestamptz;
  v_sensitive_count bigint;
  v_sensitive_fingerprint text;
  v_invalid_sensitive_count bigint;
  v_non_sensitive_fingerprint text;
  v_flag_count bigint;
  v_false_flag_count bigint;
  v_operator_count bigint;
begin
  if coalesce(current_setting('app.expected_regrant_count', true), '') = ''
    or coalesce(v_expected_regrant_fingerprint, '') = ''
    or coalesce(current_setting('app.expected_regrant_expires_at', true), '') = ''
    or coalesce(v_expected_non_sensitive_fingerprint, '') = ''
  then
    raise exception 'Missing expected final-gate session settings';
  end if;

  v_expected_regrant_count :=
    current_setting('app.expected_regrant_count')::bigint;
  v_expected_regrant_expires_at :=
    current_setting('app.expected_regrant_expires_at')::timestamptz;

  select
    count(*),
    md5(coalesce(string_agg(
      concat_ws('|', grant_row.user_id::text, grant_row.permission_code,
        grant_row.scope_type, grant_row.scope_id),
      E'\n' order by grant_row.user_id, grant_row.permission_code,
        grant_row.scope_type, grant_row.scope_id
    ), '')),
    count(*) filter (
      where grant_row.expires_at is distinct from v_expected_regrant_expires_at
         or grant_row.grant_reason is distinct from
           'Task 13 Step 5: tái cấp quyền nhạy cảm đã được phê duyệt'
    )
  into v_sensitive_count, v_sensitive_fingerprint, v_invalid_sensitive_count
  from public.user_permission_grants grant_row
  join public.permission_actions action_row
    on action_row.permission_code = grant_row.permission_code
   and action_row.is_active
  where grant_row.is_active
    and action_row.risk_level = 'sensitive';

  if v_sensitive_count <> v_expected_regrant_count
    or v_sensitive_fingerprint <> v_expected_regrant_fingerprint
  then
    raise exception 'Active sensitive direct grants do not match approved manifest';
  end if;

  if v_invalid_sensitive_count <> 0 then
    raise exception 'Active sensitive direct grants require exact expiry and reason';
  end if;

  select md5(coalesce(string_agg(
    concat_ws('|', grant_row.user_id::text, grant_row.permission_code,
      grant_row.scope_type, grant_row.scope_id,
      coalesce(to_char(grant_row.expires_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US'), '')),
    E'\n' order by grant_row.user_id, grant_row.permission_code,
      grant_row.scope_type, grant_row.scope_id
  ), ''))
  into v_non_sensitive_fingerprint
  from public.user_permission_grants grant_row
  join public.permission_actions action_row
    on action_row.permission_code = grant_row.permission_code
   and action_row.is_active
  where grant_row.is_active
    and action_row.risk_level <> 'sensitive';

  if v_non_sensitive_fingerprint <> v_expected_non_sensitive_fingerprint then
    raise exception 'Non-sensitive direct-grant fingerprint changed';
  end if;

  select
    count(*),
    count(*) filter (where setting_row.value = 'false'::jsonb)
  into v_flag_count, v_false_flag_count
  from app_private.permission_hardening_settings setting_row
  where setting_row.key in (
    'business_role_resolver_enabled',
    'legacy_governance_fallback_disabled',
    'system_admin_business_approval_bypass_disabled'
  );

  if v_flag_count <> 3 or v_false_flag_count <> 3 then
    raise exception 'Authorization rollout flags must all remain false';
  end if;

  select count(distinct user_row.id)
  into v_operator_count
  from public.users user_row
  join public.principal_role_assignments assignment_row
    on assignment_row.principal_type = 'user'
   and assignment_row.principal_id = user_row.id
   and assignment_row.status = 'ACTIVE'
   and assignment_row.starts_at <= now()
   and assignment_row.expires_at is null
   and assignment_row.scope_type = 'global'
   and assignment_row.scope_id = '*'
  join public.role_permission_templates role_row
    on role_row.id = assignment_row.role_template_id
   and role_row.is_active
  join public.role_permission_template_items item
    on item.template_id = role_row.id
   and item.permission_code = 'system.authorization.manage_roles'
   and item.scope_type = 'global'
   and item.scope_id = '*'
  where user_row.role = 'ADMIN'
    and user_row.is_active
    and user_row.account_status = 'ACTIVE';

  if v_operator_count < 1 then
    raise exception 'At least one durable rollout operator is required';
  end if;
end;
$$;

select 'authorization_sensitive_grant_regrant_gate_passed' as checkpoint;

rollback;
```

- [ ] **Step 4: Prove the final gate is RED before mutation**

Run the final gate against linked Cloud with the four expected settings. Expected failure: active sensitive count/fingerprint does not match the approved regrant subset. If the approved subset happens to equal the entire source set, expiry validation must still fail because the 467 source rows lack the 90-day cutoff.

- [ ] **Step 5: Verify and commit only the read-only gates**

Run:

```bash
git diff --check
rg -n "insert|update|delete|truncate|alter|drop|create" \
  supabase/tests/authorization_sensitive_grant_revoke_all_gate.sql \
  supabase/tests/authorization_sensitive_grant_regrant_gate.sql
git diff -- \
  supabase/tests/authorization_sensitive_grant_revoke_all_gate.sql \
  supabase/tests/authorization_sensitive_grant_regrant_gate.sql
git add \
  supabase/tests/authorization_sensitive_grant_revoke_all_gate.sql \
  supabase/tests/authorization_sensitive_grant_regrant_gate.sql
git commit -m "test(authz): add sensitive grant reset gates"
```

The `rg` output may contain only transaction/test text such as `begin`, `rollback` and exception messages; it must expose no data mutation statement.

---

### Task 3: Execute revoke-all and prove the global zero-source checkpoint

**Files:**

- Use without modification: `components/permissions/PrincipalDirectGrantPanel.tsx`.
- Modify aggregate evidence: `docs/security/phase02-business-role-sod-live-apply-log.md`.
- Verify: `supabase/tests/authorization_sensitive_grant_revoke_all_gate.sql`.

**Interfaces:**

- Consumes: approved manifest, authenticated Permission Admin, complete full-direct-grant drafts.
- Produces: all 23 source principals revoked, exactly 23 revoke audit events, zero active sensitive direct grants, unchanged non-sensitive fingerprint.

- [ ] **Step 1: Open maintenance and revalidate the frozen input**

After explicit approval, announce the permission-maintenance window and freeze every other permission edit. Calculate the shared cutoff exactly once:

```bash
MAINTENANCE_STARTED_AT="$(node -e "const d=new Date(); d.setUTCSeconds(0,0); process.stdout.write(d.toISOString())")"
REGRANT_EXPIRES_AT="$(node -e "const d=new Date(process.argv[1]); d.setUTCDate(d.getUTCDate()+90); process.stdout.write(d.toISOString())" "$MAINTENANCE_STARTED_AT")"
REGRANT_EXPIRES_AT_LOCAL="$(node -e "const d=new Date(process.argv[1]); const value=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d); process.stdout.write(value.replace(' ','T'))" "$REGRANT_EXPIRES_AT")"
node --input-type=module - "$MANIFEST" "$MAINTENANCE_STARTED_AT" "$REGRANT_EXPIRES_AT" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';

const [manifestPath, maintenanceStartedAt, expiresAt] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const started = new Date(maintenanceStartedAt);
const expires = new Date(expiresAt);
if (!Number.isFinite(started.getTime()) || !Number.isFinite(expires.getTime())
  || expires.getTime() - started.getTime() !== 90 * 24 * 60 * 60 * 1000) {
  throw new Error('Regrant expiry must be exactly 90 days after maintenance start');
}
writeFileSync(manifestPath, JSON.stringify({
  ...manifest,
  maintenanceStartedAt: started.toISOString(),
  expiresAt: expires.toISOString(),
}, null, 2), { mode: 0o600 });
NODE
```

Immediately repeat Task 1 baseline, source fingerprint and manifest validation.

Expected: source count/fingerprint still equals `467`/`SOURCE_FINGERPRINT`, non-sensitive fingerprint still equals `NON_SENSITIVE_FINGERPRINT`, all three flags are `false`, and the manifest file is still mode `0600`. Any drift closes the maintenance window without mutation.

- [ ] **Step 2: Capture safe audit baselines**

Run this read-only aggregate query and retain the counts in the execution shell:

```bash
npx supabase db query --linked --agent=no --output json "
select
  count(*) filter (
    where audit_row.event_type = 'direct_permission_grants_changed'
  ) as direct_change_events,
  count(*) filter (
    where audit_row.created_at >= '$MAINTENANCE_STARTED_AT'::timestamptz
      and audit_row.metadata ->> 'reason' =
        'Task 13 Step 5: thu hồi toàn bộ quyền nhạy cảm trước tái cấp'
  ) as maintenance_revoke_events,
  count(*) filter (
    where audit_row.created_at >= '$MAINTENANCE_STARTED_AT'::timestamptz
      and audit_row.metadata ->> 'reason' =
        'Task 13 Step 5: tái cấp quyền nhạy cảm đã được phê duyệt'
  ) as maintenance_regrant_events
from public.permission_audit_events audit_row;
"
```

Expected: regrant events `0`; a fresh maintenance window also has revoke events `0`. Do not put IDs or audit payloads in evidence.

- [ ] **Step 3: Revoke one approved pilot principal**

Choose one active, non-actor principal from the manifest. In `Cài đặt` → `Phân quyền`:

1. refresh the target and load the complete active direct-grant draft;
2. leave every non-sensitive grant unchanged, including its exact scope and expiry;
3. clear every sensitive permission/scope key listed for that principal in the source manifest;
4. enter reason `Task 13 Step 5: thu hồi toàn bộ quyền nhạy cảm trước tái cấp`;
5. click `Preview backend` and compare the diff count to that principal's source count;
6. stop on any hard deny; review every warning and accept it only with approved independent-control evidence;
7. click `Lưu direct grant` exactly once and wait for the panel to reload.

Expected: no unrelated diff; global active sensitive count falls by exactly the pilot source count; active non-sensitive fingerprint is unchanged; total audit count and standardized revoke-reason count each increase by exactly `1`; rollout flags remain `false`.

- [ ] **Step 4: Prove pilot retry is an exact no-op**

Refresh, preview the already-revoked full draft again and submit only if the UI permits the exact no-op.

Expected: active counts/fingerprints do not change and no additional audit event is created. If no-op behavior differs, stop and create a narrowly scoped forward-fix; do not process a second principal.

- [ ] **Step 5: Record pilot aggregate evidence and stop**

Record only pilot source-row count, remaining active-sensitive count, unchanged non-sensitive fingerprint, audit delta `1`, and flags `false`. Stop for explicit approval to continue the revoke phase.

- [ ] **Step 6: Revoke the remaining principals in batches of at most three**

For each principal, sequentially repeat Step 3. Before each save, reload current Cloud state and confirm the number of sensitive keys to remove equals the remaining source-manifest keys for that principal. After each save, prove:

- remaining active sensitive count decreases by exactly that principal's source count;
- non-sensitive fingerprint remains `NON_SENSITIVE_FINGERPRINT`;
- revoke-reason audit count increases by exactly one;
- regrant-reason audit count remains zero;
- all rollout flags remain `false`.

Close each batch after at most three principals, add only aggregate counts to the apply log, run `git diff --check` on the log, and request the next approval. Never regrant during this task.

Process the current authenticated Permission Admin, if present in the source set, last in the revoke phase. Backend permits sensitive self-removal, but after that save immediately open a fresh page/session and prove `can_manage_permissions()` plus `preview_direct_grant_replacement` still work through the unchanged legacy-governance fallback. If either check fails, stop before regrant. Sensitive self-regrant is never allowed: a `REGRANT` row for that principal requires the independent Permission Admin proven in Task 1.

- [ ] **Step 7: Run the zero-source gate before any regrant**

Build a private gate bundle that injects the expected non-sensitive fingerprint into the same transaction/session:

```bash
REVOKE_GATE_BUNDLE="$PRIVATE_DIR/revoke-gate.sql"
node --input-type=module - \
  supabase/tests/authorization_sensitive_grant_revoke_all_gate.sql \
  "$REVOKE_GATE_BUNDLE" "$NON_SENSITIVE_FINGERPRINT" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';

const [sourcePath, outputPath, fingerprint] = process.argv.slice(2);
const source = readFileSync(sourcePath, 'utf8');
const setting = `select set_config('app.expected_non_sensitive_fingerprint', '${fingerprint}', true);`;
writeFileSync(outputPath, source.replace(/^begin;$/m, `begin;\n${setting}`), { mode: 0o600 });
NODE
npx supabase db query --linked --agent=no --file "$REVOKE_GATE_BUNDLE"
```

Expected: exit `0` and checkpoint `authorization_sensitive_grant_revoke_all_gate_passed`.

- [ ] **Step 8: Verify revoke-phase audit arithmetic and stop**

Run aggregate checks proving:

- active sensitive direct grants: `0`;
- revoke-reason audit delta since `MAINTENANCE_STARTED_AT`: `23`;
- regrant-reason audit delta: `0`;
- non-sensitive fingerprint equals `NON_SENSITIVE_FINGERPRINT`;
- active Business Role assignments and responsibility assignments equal their pre-maintenance counts;
- all rollout flags remain `false`.

Record the zero-source checkpoint and safe aggregates. Stop for a new explicit approval before the first regrant mutation.

---

### Task 4: Regrant only the approved subset

**Files:**

- Use without modification: existing Settings authorization UI and governed RPCs.
- Modify aggregate evidence: `docs/security/phase02-business-role-sod-live-apply-log.md`.
- Verify later: `supabase/tests/authorization_sensitive_grant_regrant_gate.sql`.

**Interfaces:**

- Consumes: zero-source PASS and private `REGRANT` subset.
- Produces: exact approved sensitive key set with shared expiry, one regrant audit event per regranted principal, no active `DROP` key.

- [ ] **Step 1: Revalidate the boundary before regrant**

After approval, rerun the manifest validator and the Task 3 zero-source gate.

Expected: manifest fingerprints/counts are unchanged, active sensitive count is still `0`, non-sensitive fingerprint is unchanged, regrant audit count is `0`, and flags remain `false`. A failure blocks regrant.

- [ ] **Step 2: Regrant one pilot principal**

Choose one principal with at least one `REGRANT` row. In the authenticated UI:

1. refresh the complete current direct-grant draft;
2. preserve every currently active row exactly;
3. add only the manifest's `REGRANT` permission/scope keys for this principal;
4. set every added sensitive row to the exact `REGRANT_EXPIRES_AT_LOCAL` value;
5. enter reason `Task 13 Step 5: tái cấp quyền nhạy cảm đã được phê duyệt`;
6. preview and compare exact key/scope count against the manifest;
7. stop on a hard deny;
8. for a warning, proceed only after an independent control owner, reason, concrete compensating controls and future acceptance expiry are approved;
9. save exactly once and wait for a fresh reload.

Expected: this principal's active sensitive keys equal its exact `REGRANT` subset; all use canonical UTC `REGRANT_EXPIRES_AT`; every `DROP` key remains inactive; non-sensitive fingerprint remains unchanged; regrant audit count increases by exactly `1`.

When the target is a Permission Admin, the authenticated actor must be the distinct independent Permission Admin proven before maintenance. Never self-regrant a sensitive permission.

If `REGRANT_COUNT = 0`, record that the approved subset is empty, skip Steps 2–5, and continue directly to Step 6 with expected active sensitive and regrant audit counts both equal to `0`.

- [ ] **Step 3: Prove the regrant pilot retry is a no-op**

Refresh and preview the exact same full draft. Submit only if the UI permits the no-op.

Expected: no expiry/grant timestamp churn and no additional audit event. Any change blocks the remaining regrant phase.

- [ ] **Step 4: Record pilot aggregate evidence and stop**

Record only approved row count, resulting active-sensitive count/fingerprint, exact cutoff, audit delta `1`, unchanged non-sensitive fingerprint and flags `false`. Stop for explicit approval before continuing.

- [ ] **Step 5: Regrant remaining approved principals in batches of at most three**

Repeat Step 2 sequentially. Principals whose manifest rows are all `DROP` require no regrant command. After every save, verify the cumulative active-sensitive count/fingerprint against the cumulative processed `REGRANT` subset, and verify the audit delta is exactly one.

Close each batch after at most three principals and request approval for the next. Never add an unlisted permission, widen a scope, replace a project/construction-site scope with global, or change a `DROP` decision during execution; such a change requires a new approved manifest and a restarted maintenance procedure.

- [ ] **Step 6: Prove operational totals before the final gate**

Expected aggregates:

- active sensitive count equals `REGRANT_COUNT`;
- active sensitive canonical-key fingerprint equals `REGRANT_FINGERPRINT`;
- every active sensitive expiry equals `REGRANT_EXPIRES_AT` and has the standardized regrant reason;
- regrant-reason audit delta equals `REGRANT_PRINCIPAL_COUNT`;
- total maintenance change-event delta equals `23 + REGRANT_PRINCIPAL_COUNT`;
- non-sensitive fingerprint remains `NON_SENSITIVE_FINGERPRINT`;
- all rollout flags remain `false`.

Do not close maintenance until the final gate in Task 5 passes.

---

### Task 5: Pass the exact final gate, publish aggregate evidence, and stop

**Files:**

- Verify: `supabase/tests/authorization_sensitive_grant_revoke_all_gate.sql`.
- Verify: `supabase/tests/authorization_sensitive_grant_regrant_gate.sql`.
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`.
- Never stage: `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`.

**Interfaces:**

- Consumes: complete regrant phase and safe expected runtime values.
- Produces: final PASS evidence committed to the existing draft PR; no resolver or flag mutation.

- [ ] **Step 1: Run the exact final Cloud gate**

Retain the already-recorded zero-source PASS as the immutable between-phase checkpoint. Build and run the final gate in one private transaction/session:

```bash
FINAL_GATE_BUNDLE="$PRIVATE_DIR/final-gate.sql"
node --input-type=module - \
  supabase/tests/authorization_sensitive_grant_regrant_gate.sql \
  "$FINAL_GATE_BUNDLE" "$NON_SENSITIVE_FINGERPRINT" \
  "$REGRANT_COUNT" "$REGRANT_FINGERPRINT" "$REGRANT_EXPIRES_AT" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';

const [sourcePath, outputPath, nonSensitiveFingerprint,
  regrantCount, regrantFingerprint, expiresAt] = process.argv.slice(2);
const source = readFileSync(sourcePath, 'utf8');
const settings = [
  ['app.expected_non_sensitive_fingerprint', nonSensitiveFingerprint],
  ['app.expected_regrant_count', regrantCount],
  ['app.expected_regrant_fingerprint', regrantFingerprint],
  ['app.expected_regrant_expires_at', expiresAt],
].map(([key, value]) =>
  `select set_config('${key}', '${value}', true);`
).join('\n');
writeFileSync(outputPath, source.replace(/^begin;$/m, `begin;\n${settings}`), { mode: 0o600 });
NODE
npx supabase db query --linked --agent=no --file "$FINAL_GATE_BUNDLE"
```

Expected: exit `0` and checkpoint `authorization_sensitive_grant_regrant_gate_passed`. Any failure leaves maintenance open and blocks evidence completion.

- [ ] **Step 2: Run final read-only scope and audit checks**

Prove and record aggregate results only:

- source inventory `467 = REGRANT_COUNT + DROP_COUNT`;
- active sensitive count/key fingerprint exactly matches approved `REGRANT`;
- standardized revoke audit delta is `23`;
- standardized regrant audit delta is `REGRANT_PRINCIPAL_COUNT`;
- total direct-grant change audit delta is `23 + REGRANT_PRINCIPAL_COUNT`;
- active non-sensitive fingerprint is unchanged;
- Business Role and responsibility-assignment counts match pre-maintenance;
- all three rollout flags exist and remain `false`;
- durable rollout-operator count is at least `1`.

If unrelated administrative activity occurred during the window, do not explain away the delta; identify it read-only and reopen the appropriate verification checkpoint.

- [ ] **Step 3: Run linked advisors and repository verification**

Run:

```bash
npx supabase db advisors --linked --type security --level warn --agent=no -o json | jq 'length'
npx supabase db advisors --linked --type performance --level warn --agent=no -o json | jq 'length'
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected: no new advisor finding; known baselines remain security `170` and performance `97` unless independently documented. All 170 test files/993 tests (or a strictly higher expected count), TypeScript and production build pass; only the existing large-chunk advisory may remain.

- [ ] **Step 4: Finalize aggregate evidence and close maintenance**

Update `docs/security/phase02-business-role-sod-live-apply-log.md` with:

- manifest capture and maintenance timestamps;
- shared canonical UTC cutoff;
- source/regrant/drop/principal counts and non-sensitive/source/regrant fingerprints;
- pilot and bounded-batch approvals as aggregate checkpoints;
- global zero-source PASS timestamp before regrant;
- final gate PASS and audit arithmetic;
- flags `false`, durable operator count, advisor counts and repository verification;
- explicit confirmation that no Business Role, responsibility assignment, migration history or rollout flag changed.

Do not include identities, raw grant keys, credentials, private file paths or warning payloads. Close the permission-maintenance window only after the evidence matches Cloud.

- [ ] **Step 5: Commit and push only the intended evidence files**

Run:

```bash
git add docs/security/phase02-business-role-sod-live-apply-log.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs(authz): record global sensitive grant reset"
git push origin refactor/module-du-an-v1
git status --short
```

Expected: the evidence file is committed after the earlier two-gate commit, and both commits are pushed to existing draft PR `#1`; the operator-owned Phase 2 plan remains unstaged and no second PR is created.

- [ ] **Step 6: Delete private artifacts only after confirmed PASS**

After the operator confirms the final evidence, validate the exact temporary-directory shape and remove only the private artifacts:

```bash
case "$PRIVATE_DIR" in
  /tmp/vioo-sensitive-regrant.*) ;;
  *) echo 'Refusing unsafe private-directory cleanup' >&2; exit 1 ;;
esac
rm -f -- "$RAW_EXPORT" "$MANIFEST" "$REVOKE_GATE_BUNDLE" "$FINAL_GATE_BUNDLE"
rmdir -- "$PRIVATE_DIR"
```

Expected: the exact private directory is empty and removed. Never use a recursive delete or an unresolved path.

- [ ] **Step 7: Stop before resolver enablement**

Present commit SHA, PR URL, final aggregates, Cloud gate PASS, flags `false`, advisors and repository results. Request a separate explicit approval for Task 13 Step 7.

Do not call `set_authorization_rollout_flags`, enable the resolver, disable fallback, or alter System Admin business approval in this plan.

---

## Completion Criteria

- All 467 source rows were classified before mutation and revoked before the first regrant.
- The zero-source Cloud gate passed between phases.
- Active sensitive direct grants equal the exact approved `REGRANT` key set and shared 90-day cutoff; every `DROP` key remains inactive.
- Revoke audit delta is exactly `23`; regrant audit delta is exactly `REGRANT_PRINCIPAL_COUNT`; exact no-op retries add no event.
- The active non-sensitive fingerprint is unchanged.
- No Business Role, responsibility assignment, migration-history row or rollout flag changed.
- All three rollout flags remain `false` and at least one durable rollout operator remains active.
- Cloud advisors and repository verification show no new failure.
- Private identity-bearing artifacts are deleted only after final PASS and operator confirmation.
- Execution stops before resolver enablement and waits for a new approval.
