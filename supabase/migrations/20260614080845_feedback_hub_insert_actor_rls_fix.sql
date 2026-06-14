-- Feedback Hub RLS fix: make create flow use the authenticated app user.
-- This keeps browser inserts from failing when local UI state carries a stale
-- or auth-user id instead of public.users.id.

create or replace function app_private.prepare_feedback_item_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
begin
  if v_actor is not null then
    new.created_by := v_actor;
  end if;

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

drop trigger if exists trg_feedback_items_prepare_insert on public.feedback_items;
create trigger trg_feedback_items_prepare_insert
before insert on public.feedback_items
for each row execute function app_private.prepare_feedback_item_insert();

drop policy if exists feedback_items_insert on public.feedback_items;
create policy feedback_items_insert
on public.feedback_items
for insert
to authenticated
with check (
  created_by = (select public.current_app_user_id())
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
