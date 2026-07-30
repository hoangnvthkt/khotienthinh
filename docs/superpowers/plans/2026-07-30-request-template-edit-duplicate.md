# Request Template Edit Duplicate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split request-template version editing from true template duplication, and repair the live publish validation for table fields.

**Architecture:** Keep "edit published template" as the existing same-lineage draft flow, but label it `Sửa mẫu`. Add a new atomic Supabase RPC that creates an independent draft template and returns the same draft record shape consumed by the editor. Keep frontend changes thin: service wrapper, list-page actions, and editor error formatting.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, lucide-react, Supabase PostgreSQL RPCs, Supabase migrations.

## Global Constraints
  
- Existing version-edit action label: `Sửa mẫu`.
- New independent duplicate action label: `Sao chép mẫu`.
- Copied template name starts as `<tên mẫu> - Bản sao`.
- If the copied name already exists, use `<tên mẫu> - Bản sao (2)`, then `(3)`, and so on.
- Copied template status must be `DRAFT`.
- Copied template must have an independent `request_templates.id`.
- Copy configuration must include general settings, form fields, approval flow, scope, watchers, print settings, and notification settings.
- After copying, navigate to `/rq/templates/<new-template-id>`.
- Publish validation must accept `table` fields.
- `REQUEST_FORM_SCHEMA_INVALID` must not display the concurrency message.
- Stage only files listed in each task; do not revert unrelated worktree changes.

---

## File Structure

- Modify `lib/__tests__/requestApprovalMigration.test.ts`
  - Adds migration contract tests for the duplicate RPC and table field publish validation.
- Create `supabase/migrations/<timestamp>_request_template_duplicate_and_table_publish.sql`
  - Replaces the live publish function with the source-controlled table-aware validation.
  - Adds `app_private.duplicate_request_template(uuid)`.
  - Adds `public.duplicate_request_template(uuid)` and execute grants.
- Create `lib/__tests__/requestTemplateServiceContract.test.ts`
  - Source-level service contract for the new duplicate wrapper.
- Modify `lib/requestTemplateService.ts`
  - Adds `requestTemplateService.duplicate(templateId: string)`.
- Modify `lib/__tests__/requestTemplateRouteContract.test.ts`
  - Adds list-page action label and navigation contract coverage.
- Modify `pages/request/RequestTemplates.tsx`
  - Renames the same-lineage edit action.
  - Adds the independent copy action.
- Modify `lib/__tests__/requestTemplateEditorPersistence.test.ts`
  - Adds schema-invalid error formatting contract.
- Modify `pages/request/RequestTemplateEditor.tsx`
  - Maps `REQUEST_FORM_SCHEMA_INVALID` to a form-schema-specific message.

---

### Task 1: Supabase Duplicate RPC And Publish Validation Migration

**Files:**
- Modify: `lib/__tests__/requestApprovalMigration.test.ts`
- Create: `supabase/migrations/<generated>_request_template_duplicate_and_table_publish.sql`

**Interfaces:**
- Consumes: existing `app_private.request_template_draft_payload(version_id uuid) returns jsonb`.
- Consumes: existing `app_private.request_user_can_manage(user_id uuid) returns boolean`.
- Produces: `public.duplicate_request_template(p_request_template_id uuid) returns jsonb`.
- Produces response keys: `id`, `draftVersionId`, `status`, `versionNumber`, `updatedAt`, `payload`.

- [ ] **Step 1: Write the failing migration contract tests**

Edit `lib/__tests__/requestApprovalMigration.test.ts` near the other migration file lookups:

```ts
const templateDuplicateFile = readdirSync(dir).find(name =>
  name.endsWith('_request_template_duplicate_and_table_publish.sql'));
const templateDuplicateSql = templateDuplicateFile
  ? readFileSync(join(dir, templateDuplicateFile), 'utf8')
  : '';
```

Add these tests inside `describe('request approval phase 1 schema', () => { ... })`:

```ts
  it('adds an atomic request template duplicate RPC', () => {
    expect(templateDuplicateSql).toContain('app_private.duplicate_request_template');
    expect(templateDuplicateSql).toContain('public.duplicate_request_template');
    expect(templateDuplicateSql).toContain("v_source_template.name || ' - Bản sao'");
    expect(templateDuplicateSql).toContain("'draftVersionId', v_target_version.id");
    expect(templateDuplicateSql).toContain('grant execute on function public.duplicate_request_template(uuid) to authenticated');
    expect(templateDuplicateSql).toMatch(
      /request_user_can_manage\(v_actor\)[\s\S]*?REQUEST_TEMPLATE_FORBIDDEN/i,
    );
  });

  it('copies request template configuration into an independent draft', () => {
    for (const snippet of [
      'insert into public.request_templates',
      "'DRAFT'",
      'v_source_version.form_schema',
      'v_source_version.usage_scope',
      'v_source_version.flow_mode',
      'v_source_version.completion_policy',
      'v_source_version.request_sla_hours',
      'v_source_version.print_config',
      'v_source_version.notification_config',
      'from public.request_approval_blocks',
      'from public.request_template_watchers',
      'from public.request_print_templates',
    ]) expect(templateDuplicateSql).toContain(snippet);
  });

  it('repairs live publish validation so table fields are valid', () => {
    expect(templateDuplicateSql).toContain('app_private.publish_request_template_version');
    expect(templateDuplicateSql).toMatch(
      /coalesce\(field ->> 'fieldType', ''\) not in \([\s\S]*?'table'[\s\S]*?\)/,
    );
  });
```

- [ ] **Step 2: Run the migration contract tests and verify they fail for the new contract**

Run:

```bash
npm test -- lib/__tests__/requestApprovalMigration.test.ts
```

Expected: FAIL because `templateDuplicateSql` is empty and the duplicate migration does not exist yet.

- [ ] **Step 3: Create the Supabase migration file with the CLI**

Run:

```bash
npx supabase migration --help
npx supabase migration new --help
npx supabase migration new request_template_duplicate_and_table_publish
```

Expected: a new file appears under `supabase/migrations/` ending with `_request_template_duplicate_and_table_publish.sql`.

- [ ] **Step 4: Write the migration**

In the generated migration file, first paste the current full `app_private.publish_request_template_version(uuid, timestamptz)` function definition from `supabase/migrations/20260728152736_request_template_publish_phase1.sql`. Keep the body identical to source control, and verify this exact field-type predicate is present:

```sql
       or coalesce(field ->> 'fieldType', '') not in (
         'text', 'textarea', 'number', 'date', 'select', 'table', 'user', 'file'
       )
```

Below that publish function, add this duplicate RPC:

```sql
create or replace function app_private.duplicate_request_template(
  p_request_template_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_source_template public.request_templates%rowtype;
  v_source_version public.request_template_versions%rowtype;
  v_target_template public.request_templates%rowtype;
  v_target_version public.request_template_versions%rowtype;
  v_base_name text;
  v_copy_name text;
  v_suffix integer := 1;
begin
  if v_actor is null or not app_private.request_user_can_manage(v_actor) then
    raise exception using errcode = '42501', message = 'REQUEST_TEMPLATE_FORBIDDEN';
  end if;

  select *
    into v_source_template
  from public.request_templates
  where id = p_request_template_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'REQUEST_TEMPLATE_NOT_FOUND';
  end if;

  select *
    into v_source_version
  from public.request_template_versions version
  where version.request_template_id = v_source_template.id
  order by
    case version.status
      when 'DRAFT' then 1
      when 'PUBLISHED' then 2
      when 'SUPERSEDED' then 3
      else 4
    end,
    version.version_number desc
  limit 1;

  if not found then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_VERSION_REQUIRED';
  end if;

  v_base_name := v_source_template.name || ' - Bản sao';
  v_copy_name := v_base_name;

  while exists (
    select 1
    from public.request_templates existing_template
    where lower(existing_template.name) = lower(v_copy_name)
  ) loop
    v_suffix := v_suffix + 1;
    v_copy_name := format('%s (%s)', v_base_name, v_suffix);
  end loop;

  insert into public.request_templates(
    name, description, lifecycle_status, current_version_id, created_by
  ) values (
    v_copy_name,
    coalesce(v_source_template.description, ''),
    'DRAFT',
    null,
    v_actor
  )
  returning * into v_target_template;

  insert into public.request_template_versions(
    request_template_id, version_number, form_schema, usage_scope,
    flow_mode, completion_policy, request_sla_hours, print_config,
    notification_config, status, created_by
  ) values (
    v_target_template.id,
    1,
    v_source_version.form_schema,
    v_source_version.usage_scope,
    v_source_version.flow_mode,
    v_source_version.completion_policy,
    v_source_version.request_sla_hours,
    v_source_version.print_config,
    v_source_version.notification_config,
    'DRAFT',
    v_actor
  )
  returning * into v_target_version;

  insert into public.request_approval_blocks(
    request_template_version_id, block_key, name, sort_order, approver_source,
    fixed_user_ids, minimum_dynamic_approvers, sla_hours, is_required
  )
  select
    v_target_version.id,
    block.block_key,
    block.name,
    block.sort_order,
    block.approver_source,
    block.fixed_user_ids,
    block.minimum_dynamic_approvers,
    block.sla_hours,
    block.is_required
  from public.request_approval_blocks block
  where block.request_template_version_id = v_source_version.id;

  insert into public.request_template_watchers(request_template_version_id, user_id)
  select v_target_version.id, watcher.user_id
  from public.request_template_watchers watcher
  where watcher.request_template_version_id = v_source_version.id
  on conflict do nothing;

  insert into public.request_print_templates(
    request_template_version_id, name, file_name, storage_path,
    validation_status, placeholder_schema
  )
  select
    v_target_version.id,
    print_template.name,
    print_template.file_name,
    print_template.storage_path,
    print_template.validation_status,
    print_template.placeholder_schema
  from public.request_print_templates print_template
  where print_template.request_template_version_id = v_source_version.id;

  return jsonb_build_object(
    'id', v_target_template.id,
    'draftVersionId', v_target_version.id,
    'status', v_target_version.status,
    'versionNumber', v_target_version.version_number,
    'updatedAt', v_target_template.updated_at,
    'payload', app_private.request_template_draft_payload(v_target_version.id)
  );
end;
$$;

create or replace function public.duplicate_request_template(
  p_request_template_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.duplicate_request_template(p_request_template_id);
$$;

revoke all on function app_private.duplicate_request_template(uuid)
  from public, anon, authenticated;
grant execute on function app_private.duplicate_request_template(uuid)
  to authenticated;

revoke all on function public.duplicate_request_template(uuid)
  from public, anon;
grant execute on function public.duplicate_request_template(uuid)
  to authenticated;
```

- [ ] **Step 5: Run the migration contract tests and verify they pass**

Run:

```bash
npm test -- lib/__tests__/requestApprovalMigration.test.ts
```

Expected: PASS for the migration contract file.

- [ ] **Step 6: Commit Task 1**

Stage only the migration contract test and new migration:

```bash
git add lib/__tests__/requestApprovalMigration.test.ts supabase/migrations/*_request_template_duplicate_and_table_publish.sql
git commit -m "feat: add request template duplicate rpc"
```

---

### Task 2: Request Template Service Duplicate Wrapper

**Files:**
- Create: `lib/__tests__/requestTemplateServiceContract.test.ts`
- Modify: `lib/requestTemplateService.ts`

**Interfaces:**
- Consumes: `public.duplicate_request_template(p_request_template_id uuid) returns jsonb`.
- Produces: `requestTemplateService.duplicate(templateId: string): Promise<RequestTemplateDraftRecord>`.

- [ ] **Step 1: Write the failing service contract test**

Create `lib/__tests__/requestTemplateServiceContract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('request template service contract', () => {
  const source = readFileSync('lib/requestTemplateService.ts', 'utf8');

  it('exposes a duplicate RPC wrapper that returns an editor draft record', () => {
    expect(source).toContain('duplicate(templateId: string)');
    expect(source).toContain("'duplicate_request_template'");
    expect(source).toContain('{ p_request_template_id: templateId }');
    expect(source).toContain('run<RequestTemplateDraftRecord>');
  });
});
```

- [ ] **Step 2: Run the service contract test and verify it fails**

Run:

```bash
npm test -- lib/__tests__/requestTemplateServiceContract.test.ts
```

Expected: FAIL because `requestTemplateService.duplicate` is not defined.

- [ ] **Step 3: Add the service wrapper**

In `lib/requestTemplateService.ts`, add this method after `createDraftFromPublished`:

```ts
  duplicate(templateId: string) {
    return run<RequestTemplateDraftRecord>('duplicate_request_template', {
      p_request_template_id: templateId,
    });
  },
```

- [ ] **Step 4: Run the service contract test and verify it passes**

Run:

```bash
npm test -- lib/__tests__/requestTemplateServiceContract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add lib/requestTemplateService.ts lib/__tests__/requestTemplateServiceContract.test.ts
git commit -m "feat: add request template duplicate service"
```

---

### Task 3: Template List Edit And Copy Actions

**Files:**
- Modify: `lib/__tests__/requestTemplateRouteContract.test.ts`
- Modify: `pages/request/RequestTemplates.tsx`

**Interfaces:**
- Consumes: `requestTemplateService.createDraftFromPublished(templateId)`.
- Consumes: `requestTemplateService.duplicate(templateId)`.
- Produces UI actions with titles `Sửa mẫu`, `Sửa bản nháp`, and `Sao chép mẫu`.

- [ ] **Step 1: Write the failing route/UI contract test**

Append this test to `lib/__tests__/requestTemplateRouteContract.test.ts`:

```ts
  it('separates same-lineage editing from independent template copy', () => {
    const templateList = readFileSync('pages/request/RequestTemplates.tsx', 'utf8');

    expect(templateList).toContain('title="Sửa mẫu"');
    expect(templateList).toContain('title="Sửa bản nháp"');
    expect(templateList).toContain('title="Sao chép mẫu"');
    expect(templateList).toContain('requestTemplateService.createDraftFromPublished');
    expect(templateList).toContain('requestTemplateService.duplicate');
    expect(templateList).toContain("navigate(`/rq/templates/${draft.id}`)");
    expect(templateList).not.toContain('title="Tạo bản nháp từ phiên bản đang áp dụng"');
    expect(templateList).not.toContain('Bạn đang chỉnh sửa bản sao');
  });
```

- [ ] **Step 2: Run the route contract test and verify it fails**

Run:

```bash
npm test -- lib/__tests__/requestTemplateRouteContract.test.ts
```

Expected: FAIL because the list still uses the old copy-labeled edit action and no duplicate service call.

- [ ] **Step 3: Implement the action split**

In `pages/request/RequestTemplates.tsx`, keep the lucide imports `Copy` and `Pencil`. Replace `duplicatePublished` with these two functions:

```ts
  const editPublished = async (template: RequestTemplateSummary) => {
    setIsMutatingId(template.id);
    try {
      const draft = await requestTemplateService.createDraftFromPublished(template.id);
      toast.success('Đã tạo bản nháp', `Bạn đang sửa mẫu “${template.name}”.`);
      navigate(`/rq/templates/${draft.id}`);
    } catch (cause) {
      console.error('Create request template draft from published failed:', cause);
      toast.error('Không thể sửa mẫu', 'Vui lòng thử lại.');
    } finally {
      setIsMutatingId(null);
    }
  };

  const copyTemplate = async (template: RequestTemplateSummary) => {
    setIsMutatingId(template.id);
    try {
      const draft = await requestTemplateService.duplicate(template.id);
      toast.success('Đã sao chép mẫu', `Đã tạo “${draft.payload.name}”.`);
      navigate(`/rq/templates/${draft.id}`);
    } catch (cause) {
      console.error('Duplicate request template failed:', cause);
      toast.error('Không thể sao chép mẫu', 'Vui lòng thử lại.');
    } finally {
      setIsMutatingId(null);
    }
  };
```

Replace the action buttons in each row with this structure:

```tsx
            {template.status === 'DRAFT' && <button disabled={busy} onClick={() => navigate(`/rq/templates/${template.id}`)} title="Sửa bản nháp" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-accent disabled:opacity-50 dark:hover:bg-slate-800"><Pencil size={16} /></button>}
            {template.status === 'PUBLISHED' && <button disabled={busy} onClick={() => void editPublished(template)} title="Sửa mẫu" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-accent disabled:opacity-50 dark:hover:bg-slate-800"><Pencil size={16} /></button>}
            <button disabled={busy} onClick={() => void copyTemplate(template)} title="Sao chép mẫu" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-accent disabled:opacity-50 dark:hover:bg-slate-800"><Copy size={16} /></button>
            {template.status !== 'DEACTIVATED' && <button disabled={busy} onClick={() => void deactivate(template)} title="Ngừng áp dụng" className="rounded-lg p-2 text-slate-500 transition hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50 dark:hover:bg-amber-950/30"><Power size={16} /></button>}
```

- [ ] **Step 4: Run the route contract test and verify it passes**

Run:

```bash
npm test -- lib/__tests__/requestTemplateRouteContract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add pages/request/RequestTemplates.tsx lib/__tests__/requestTemplateRouteContract.test.ts
git commit -m "feat: split request template edit and copy actions"
```

---

### Task 4: Schema Invalid Error Message

**Files:**
- Modify: `lib/__tests__/requestTemplateEditorPersistence.test.ts`
- Modify: `pages/request/RequestTemplateEditor.tsx`

**Interfaces:**
- Consumes: database error message `REQUEST_FORM_SCHEMA_INVALID`.
- Produces: user-facing message `Cấu hình trường dữ liệu của mẫu chưa hợp lệ. Vui lòng kiểm tra lại các trường dữ liệu và thử lại.`

- [ ] **Step 1: Write the failing editor error contract test**

Append this test to `lib/__tests__/requestTemplateEditorPersistence.test.ts`:

```ts
  it('shows schema validation errors without using the concurrency copy', () => {
    expect(source).toContain("rawMsg.includes('REQUEST_FORM_SCHEMA_INVALID')");
    expect(source).toContain('Cấu hình trường dữ liệu của mẫu chưa hợp lệ');
    expect(source.indexOf("rawMsg.includes('REQUEST_FORM_SCHEMA_INVALID')"))
      .toBeLessThan(source.indexOf("rawMsg.includes('CONFLICT')"));
  });
```

- [ ] **Step 2: Run the editor persistence test and verify it fails**

Run:

```bash
npm test -- lib/__tests__/requestTemplateEditorPersistence.test.ts
```

Expected: FAIL because `REQUEST_FORM_SCHEMA_INVALID` is not mapped yet.

- [ ] **Step 3: Add the schema-invalid mapping**

In `pages/request/RequestTemplateEditor.tsx`, inside `formatTemplateSaveError`, add this block before the `CONFLICT` block:

```ts
  if (rawMsg.includes('REQUEST_FORM_SCHEMA_INVALID')) {
    return 'Cấu hình trường dữ liệu của mẫu chưa hợp lệ. Vui lòng kiểm tra lại các trường dữ liệu và thử lại.';
  }
```

- [ ] **Step 4: Run the editor persistence test and verify it passes**

Run:

```bash
npm test -- lib/__tests__/requestTemplateEditorPersistence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add pages/request/RequestTemplateEditor.tsx lib/__tests__/requestTemplateEditorPersistence.test.ts
git commit -m "fix: clarify request template schema errors"
```

---

### Task 5: Full Local Verification

**Files:**
- No source files should be edited in this task.

**Interfaces:**
- Consumes: completed Tasks 1-4.
- Produces: verified local test and typecheck evidence.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- \
  lib/__tests__/requestApprovalMigration.test.ts \
  lib/__tests__/requestTemplateServiceContract.test.ts \
  lib/__tests__/requestTemplateRouteContract.test.ts \
  lib/__tests__/requestTemplateEditorPersistence.test.ts
```

Expected: PASS for all focused tests.

- [ ] **Step 2: Run the broader request/editor tests touched by this work**

Run:

```bash
npm test -- \
  lib/__tests__/requestFormBuilderModel.test.ts \
  lib/__tests__/requestApprovalMigration.test.ts \
  lib/__tests__/requestTemplateRouteContract.test.ts \
  lib/__tests__/requestTemplateEditorPersistence.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript lint**

Run:

```bash
npm run lint
```

Expected: TypeScript exits 0.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: no staged files. Any remaining unstaged files must be pre-existing unrelated work or files intentionally left for the current broader request-approval branch.

---

### Task 6: Apply Migration To Live Supabase And Browser Verify

**Files:**
- No source files should be edited in this task.

**Interfaces:**
- Consumes: generated migration SQL from Task 1.
- Consumes live project ref `ftciqmqhmfvjtwoycswe`.
- Produces: live database has `public.duplicate_request_template(uuid)` and table-aware publish validation.
- Produces: browser-verified admin flow for the VPP template.

- [ ] **Step 1: Apply the new migration SQL to the live project**

Use the existing Supabase management API pattern from this branch. Read `VITE_SUPABASE_ACCESS_TOKEN` or the existing management token from `.env` without printing it. Send the full contents of `supabase/migrations/*_request_template_duplicate_and_table_publish.sql` to:

```text
POST https://api.supabase.com/v1/projects/ftciqmqhmfvjtwoycswe/database/query
```

The JSON body shape is:

```json
{
  "query": "<migration SQL text>"
}
```

Expected: HTTP 200 with no SQL error.

- [ ] **Step 2: Verify live RPC and publish validation in a rollback transaction**

Run a live SQL query through the same management API:

```sql
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e99f1b85-ab8e-49ee-b068-e100fe698533","role":"authenticated"}',
  true
);

select proname
from pg_proc
where proname in ('duplicate_request_template', 'publish_request_template_version')
order by proname;

select pg_get_functiondef(
  'app_private.publish_request_template_version(uuid,timestamptz)'::regprocedure
) like '%''table''%' as publish_accepts_table;

with target_template as (
  select id
  from public.request_templates
  where name ilike 'Đề xuất cấp phát VPP%'
  order by updated_at desc
  limit 1
)
select
  duplicated ->> 'id' as copied_template_id,
  duplicated ->> 'draftVersionId' as copied_draft_version_id,
  duplicated #>> '{payload,name}' as copied_name,
  duplicated ->> 'status' as copied_status
from target_template
cross join lateral public.duplicate_request_template(target_template.id) duplicated;

rollback;
```

Expected: rows include `duplicate_request_template` and `publish_request_template_version`; `publish_accepts_table` is `true`; the duplicate result has a non-empty `copied_template_id`, a non-empty `copied_draft_version_id`, a copied name ending in `Bản sao` or a numeric suffix, and `copied_status = 'DRAFT'`.

- [ ] **Step 3: Start or reuse the local dev server**

Run:

```bash
npm run dev -- --host 0.0.0.0
```

Expected: Vite serves the app. If port 3001 is already running for this worktree, reuse `http://localhost:3001`.

- [ ] **Step 4: Browser verify the admin flow**

In the signed-in admin browser session:

1. Open `/rq/templates`.
2. Confirm the published VPP template row has separate tooltip actions `Sửa mẫu` and `Sao chép mẫu`.
3. Click `Sửa mẫu`, add or keep the table field configuration, save draft, then publish.
4. Confirm publish does not show `REQUEST_FORM_SCHEMA_INVALID`.
5. Return to `/rq/templates`.
6. Click `Sao chép mẫu` on the VPP template.
7. Confirm the editor opens a different template ID and the name is `Đề xuất cấp phát VPP - Bản sao` or the next numeric suffix.
8. Confirm form fields, approval blocks, watchers, scope, print settings, and notifications match the source.
9. Edit the copy name or a field and save draft.
10. Return to the source template and confirm the source was not changed by editing the copy.

Expected: all 10 checks pass.

- [ ] **Step 5: Final status check**

Run:

```bash
git status --short
```

Expected: no new uncommitted files from live verification. Any dev-server process started for verification is stopped before the task ends unless the user asks to keep it running.
