-- Fix Safety Passport recompute trigger shared by worker profiles and certificates.

create or replace function app_private.touch_safety_worker_assignment_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_worker_id uuid;
  v_old_worker_id uuid;
begin
  if tg_table_name = 'safety_worker_profiles' then
    v_new_worker_id := case when tg_op = 'DELETE' then null else new.id end;
    v_old_worker_id := case when tg_op = 'INSERT' then null else old.id end;
  else
    v_new_worker_id := case when tg_op = 'DELETE' then null else new.worker_id end;
    v_old_worker_id := case when tg_op = 'INSERT' then null else old.worker_id end;
  end if;

  if tg_op = 'DELETE' then
    perform app_private.recompute_safety_worker_assignments(v_old_worker_id);
    return old;
  end if;

  perform app_private.recompute_safety_worker_assignments(v_new_worker_id);
  if tg_op = 'UPDATE' and v_old_worker_id is distinct from v_new_worker_id then
    perform app_private.recompute_safety_worker_assignments(v_old_worker_id);
  end if;
  return new;
end;
$$;
