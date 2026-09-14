-- Task-domain notifications are backend-owned. Keep the legacy permissive insert
-- policy for unrelated modules until those producers are migrated separately.
create function app_private.task_notification_source_guard()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_old_protected boolean:=false;
  v_new_protected boolean;
begin
  if current_user in ('postgres','service_role','supabase_admin') then
    return new;
  end if;

  v_new_protected:=(
    new.source_type = 'work_task'
    or new.entity_type = 'work_task'
    or lower(coalesce(new.module,'')) = 'work'
    or new.source_type like 'workflow%'
    or new.entity_type like 'workflow%'
    or lower(coalesce(new.module,'')) in ('wf','workflow')
    or new.source_type = 'request_instance'
    or new.entity_type = 'request_instance'
    or new.category in ('work','workflow','request')
  );

  if tg_op='INSERT' then
    if v_new_protected then
      raise exception 'TASK_NOTIFICATION_BACKEND_ONLY' using errcode='42501';
    end if;
    return new;
  end if;

  v_old_protected:=(
    old.source_type = 'work_task'
    or old.entity_type = 'work_task'
    or lower(coalesce(old.module,'')) = 'work'
    or old.source_type like 'workflow%'
    or old.entity_type like 'workflow%'
    or lower(coalesce(old.module,'')) in ('wf','workflow')
    or old.source_type = 'request_instance'
    or old.entity_type = 'request_instance'
    or old.category in ('work','workflow','request')
  );
  if v_old_protected or v_new_protected then
    if old.user_id is distinct from public.current_app_user_id()::text then
      raise exception 'TASK_NOTIFICATION_OWNER_ONLY' using errcode='42501';
    end if;
    if (to_jsonb(new)-array['read_at','is_read','is_dismissed'])
      is distinct from
      (to_jsonb(old)-array['read_at','is_read','is_dismissed']) then
      raise exception 'TASK_NOTIFICATION_IMMUTABLE' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.task_notification_source_guard()
from public,anon,authenticated;

create trigger task_notification_source_guard
before insert or update on public.notifications
for each row execute function app_private.task_notification_source_guard();
