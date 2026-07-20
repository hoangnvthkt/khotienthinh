-- Feedback Hub create RLS hardening:
-- let the BEFORE INSERT trigger be the single authority for actor/default fields.

create or replace function app_private.prepare_feedback_item_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null then
    raise exception 'feedback actor profile not found for current auth session'
      using errcode = '28000';
  end if;

  new.created_by := v_actor;
  new.status := 'new';
  new.priority := 'medium';
  new.assigned_to := null;
  new.rejected_reason := null;
  new.completed_at := null;
  new.closed_by := null;
  new.due_at := null;
  new.target_release := null;
  new.roadmap_stage := null;
  new.tags := '{}'::text[];
  new.device_info := coalesce(new.device_info, '{}'::jsonb);
  new.metadata := coalesce(new.metadata, '{}'::jsonb);

  return new;
end;
$$;

revoke all on function app_private.prepare_feedback_item_insert() from public;

drop policy if exists feedback_items_insert on public.feedback_items;
create policy feedback_items_insert
on public.feedback_items
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and created_by is not null
  and status = 'new'
  and priority = 'medium'
  and assigned_to is null
  and rejected_reason is null
  and completed_at is null
  and closed_by is null
  and due_at is null
  and target_release is null
  and roadmap_stage is null
  and coalesce(array_length(tags, 1), 0) = 0
  and visibility in ('public', 'private')
);

notify pgrst, 'reload schema';
