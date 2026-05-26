-- Allow deleting a BOQ reconciliation group after it has been rolled back to draft.
--
-- For this document type, "submitted before" is not a downstream dependency by
-- itself. If reviewers return the comparison and the owner/admin rolls it back
-- to draft, deleting the draft task is a valid way to abandon that work.
-- Other project documents keep the stricter app_private.project_doc_can_delete
-- policy from the previous migration.

drop policy if exists boq_reconciliation_groups_delete
  on public.boq_reconciliation_groups;

create policy boq_reconciliation_groups_delete
  on public.boq_reconciliation_groups
  for delete
  to authenticated
  using (
    coalesce(status::text, 'draft') = 'draft'
    and (
      public.is_admin()
      or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'delete')
    )
  );

notify pgrst, 'reload schema';
