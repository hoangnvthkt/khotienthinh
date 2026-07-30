# Request Template Edit And Duplicate Design

## Context

The request template list currently exposes a button labeled like a copy action, `Tạo bản nháp từ phiên bản đang dùng`, but the behavior is actually version editing: it creates a draft version inside the same template lineage. This confuses users because they expect a new independent template, while the system prepares the existing template for a future version.

Admin Hoang also reproduced a publish failure when the active template contains a table field. The local migration allows the `table` field type during publish validation, but the live database function still rejects it, returning `REQUEST_FORM_SCHEMA_INVALID`. The implementation must repair that drift while changing the edit/copy workflow.

## Goals

1. Rename the existing version-edit action to `Sửa mẫu` so users understand it edits the current template by preparing a draft version.
2. Add a separate `Sao chép mẫu` action that creates an independent draft template.
3. The copied template name defaults to `<tên mẫu> - Bản sao`; if that name already exists in the same tenant, append a small numeric suffix.
4. The copy must preserve the source template configuration: general settings, form fields, approval flow, scope, watchers, print settings, and notification settings.
5. After copying, open the new draft template editor immediately so the admin can adjust it.
6. Publishing a template with table fields must succeed when the schema is otherwise valid.
7. Error messages should distinguish schema validation errors from concurrency errors instead of always implying another person updated the template.

## Non-Goals

- Do not change the request submission workflow.
- Do not alter approval semantics for requests that are already created from published templates.
- Do not migrate existing request instances to new copied templates.
- Do not duplicate uploaded DOCX binary files unless the storage model requires it; preserving the print template registration is enough if the file path is immutable and shared safely.

## UX Design

On the request template list:

- Published templates show a pencil action with tooltip/title `Sửa mẫu`. It calls the existing draft-from-published flow and opens the editor for the same template ID.
- Templates also show a copy action with tooltip/title `Sao chép mẫu`. It calls the new duplicate flow and opens the editor for the new template ID.
- Draft templates keep the edit action as `Sửa bản nháp` or equivalent existing wording, and also allow `Sao chép mẫu` from the current draft configuration.

In the editor:

- Saving remains `Lưu nháp`.
- Publishing remains `Phát hành`.
- When the database reports `REQUEST_FORM_SCHEMA_INVALID`, show a message that points to invalid form schema/fields. Do not show the concurrency wording for this case.
- Keep the current optimistic concurrency protection for real token mismatches.

## Data And API Design

Keep the existing edit-version path:

- `create_request_template_draft_from_published(template_id)` continues to mean "prepare an editable draft version for this existing template".
- The UI labels this path as `Sửa mẫu`.

Add a new atomic duplicate path:

- Add a database RPC such as `public.duplicate_request_template(template_id uuid)`.
- The public wrapper remains invoker-facing, while privileged writes stay in `app_private` security-definer functions.
- Require the same manage permission used by template create/edit/publish.
- Select the source configuration from the most relevant editable state:
  - If the template has a draft version, copy the draft.
  - Otherwise copy the current published version.
  - For inactive/superseded-only templates, copy the newest persisted version that still represents the latest configuration.
- Insert a new `request_templates` row in `DRAFT` lifecycle with no `current_version_id`.
- Insert version `1` in `DRAFT` status for the new template.
- Copy related child records: approval blocks, fixed approvers, watchers, and print template metadata.
- Return the same draft payload shape the editor already consumes, including the new template ID and draft version ID.

Naming:

- Start with `<source name> - Bản sao`.
- If another template in the same company already uses that exact name, generate `<source name> - Bản sao (2)`, then `(3)`, and so on.

Publish validation fix:

- Add a corrective migration that replaces the live publish validation with the same accepted field types used by the local model, including `table`.
- Add or update tests so the migration contract fails if `table` is omitted from publish validation again.

## Component Boundaries

- `lib/requestTemplateService.ts` owns the new duplicate RPC wrapper.
- `pages/request/RequestTemplates.tsx` owns the template list actions, navigation, and toast copy.
- `pages/request/RequestTemplateEditor.tsx` owns user-facing save/publish error formatting.
- Supabase migrations own the duplicate RPC, copied child rows, unique copy naming, and publish validation fix.

## Error Handling

- Permission failure: keep the existing "không có quyền quản lý mẫu đề xuất" meaning.
- Duplicate failure: show a concise "Không thể sao chép mẫu" message with the database detail only when useful.
- Schema invalid: show a form-schema-specific save/publish error.
- Concurrency token mismatch: keep the current message about the draft possibly being updated elsewhere.

## Testing Strategy

1. Unit/contract tests for the service layer to verify `duplicate_request_template` is called and its response routes to the new template editor.
2. Route/UI contract tests to confirm visible action labels distinguish `Sửa mẫu` and `Sao chép mẫu`.
3. Migration contract tests to confirm:
   - the duplicate RPC exists;
   - copied templates start as independent drafts;
   - table fields are accepted by publish validation;
   - child records for fields, approval flow, scope, watchers, print config, and notifications are preserved.
4. Manual verification in the signed-in admin session:
   - create or use the VPP template with a table field;
   - save draft;
   - publish successfully;
   - copy it;
   - confirm the copied template opens as a separate draft named `Đề xuất cấp phát VPP - Bản sao`;
   - edit the copy without changing the original.

## Rollout Notes

- Ship the database migration and frontend changes together, because the new UI depends on the duplicate RPC.
- Apply the corrective migration to the live Supabase project before final browser verification.
- Avoid reverting unrelated worktree changes; stage and commit only files from this feature step.
