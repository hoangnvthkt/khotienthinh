-- Fix RLS false-success on admin rollback/unlock actions.
--
-- The previous function allowed step updates only for editable statuses
-- or waiting statuses. A locked BOQ reconciliation group therefore matched
-- zero rows under RLS when admin tried to unlock it, while PostgREST still
-- returned a successful empty update. Admin must be able to perform explicit
-- rollback/unlock actions; app code still validates the business policy.

create or replace function app_private.project_doc_can_update_step(
  p_project_id text,
  p_construction_site_id text,
  p_status text,
  p_submitted_to_user_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or app_private.project_doc_can_edit(p_project_id, p_construction_site_id, p_status)
    or (
      coalesce(p_status, 'draft') in ('submitted', 'pending', 'verified', 'approved', 'reviewed')
      and app_private.project_doc_is_current_handler(p_submitted_to_user_id)
    );
$$;

notify pgrst, 'reload schema';
