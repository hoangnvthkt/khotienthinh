-- E26-C: guard both sides of a SUPER_ADMIN role transition and direct DELETE.
-- Generated with `supabase migration new`; renamed after the Asia/Ho_Chi_Minh
-- release ledger because the CLI filename uses UTC.

create or replace function app_private.guard_super_admin_assignment()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=public.current_app_user_id();
  v_new_role_code text;
  v_old_role_code text;
  v_other_count integer;
begin
  if tg_op<>'DELETE' then
    select code into v_new_role_code
    from public.role_permission_templates where id=new.role_template_id;
  end if;
  if tg_op<>'INSERT' then
    select code into v_old_role_code
    from public.role_permission_templates where id=old.role_template_id;
  end if;

  if v_new_role_code is distinct from 'SUPER_ADMIN'
     and v_old_role_code is distinct from 'SUPER_ADMIN' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if not app_private.actor_has_permission_admin_role(v_actor) then
    raise exception 'SUPER_ADMIN_REQUIRES_PERMISSION_ADMIN' using errcode='42501';
  end if;

  if tg_op='INSERT' then
    if new.principal_type<>'user' or new.principal_id=v_actor
       or new.scope_type<>'global' or new.scope_id<>'*'
       or new.status<>'ACTIVE' or new.starts_at>now() or new.expires_at is not null then
      raise exception 'SUPER_ADMIN_ASSIGNMENT_INVALID' using errcode='22023';
    end if;
    if not exists (
      select 1 from public.users target
      where target.id=new.principal_id and target.is_active and target.account_status='ACTIVE'
    ) then
      raise exception 'SUPER_ADMIN_TARGET_INACTIVE' using errcode='23514';
    end if;
    return new;
  end if;

  if tg_op='UPDATE' and (
    new.principal_id is distinct from old.principal_id
    or new.role_template_id is distinct from old.role_template_id
    or new.scope_type is distinct from old.scope_type
    or new.scope_id is distinct from old.scope_id
    or new.starts_at is distinct from old.starts_at
    or new.expires_at is distinct from old.expires_at
  ) then
    raise exception 'SUPER_ADMIN_ASSIGNMENT_IMMUTABLE' using errcode='55000';
  end if;

  if tg_op='DELETE' or (old.status='ACTIVE' and new.status<>'ACTIVE') then
    select count(*) into v_other_count
    from public.principal_role_assignments assignment
    join public.role_permission_templates template_row
      on template_row.id=assignment.role_template_id and template_row.code='SUPER_ADMIN'
    join public.users target
      on target.id=assignment.principal_id and target.is_active and target.account_status='ACTIVE'
    where assignment.id<>old.id
      and assignment.principal_type='user'
      and assignment.status='ACTIVE'
      and assignment.starts_at<=now()
      and assignment.expires_at is null
      and assignment.scope_type='global'
      and assignment.scope_id='*';
    if v_other_count=0 then
      raise exception 'LAST_SUPER_ADMIN_REQUIRED' using errcode='55000';
    end if;
  elsif tg_op='UPDATE' and old.status<>'ACTIVE' and new.status='ACTIVE' then
    raise exception 'SUPER_ADMIN_REACTIVATION_REQUIRES_NEW_ASSIGNMENT' using errcode='55000';
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function app_private.guard_super_admin_assignment()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_guard_super_admin_assignment on public.principal_role_assignments;
create trigger trg_guard_super_admin_assignment
before insert or update or delete on public.principal_role_assignments
for each row execute function app_private.guard_super_admin_assignment();
