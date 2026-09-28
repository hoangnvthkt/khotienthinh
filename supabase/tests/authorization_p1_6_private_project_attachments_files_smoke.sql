-- Run after authorization_p1_6_private_project_attachments_files. Rolls back.
begin;
create temporary table p16b_users on commit drop as
select u.id, u.auth_id, u.email, u.role::text role
from public.users u where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null;
create temporary table p16b_result (user_id uuid, role text, attachments int, files int) on commit drop;
grant select on p16b_users to authenticated;
grant select, insert on p16b_result to authenticated;

do $$ begin
  if exists (select 1 from storage.buckets where id in ('project-attachments', 'project-files') and public) then
    raise exception 'bucket still public';
  end if;
end $$;

set local role authenticated;
do $$
declare v_user record;
begin
  for v_user in select * from p16b_users loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user.auth_id, 'email', v_user.email, 'role', 'authenticated')::text, true);
    insert into p16b_result values (v_user.id, v_user.role,
      (select count(*) from storage.objects where bucket_id = 'project-attachments'),
      (select count(*) from storage.objects where bucket_id = 'project-files'));
  end loop;
end $$;
reset role;

do $$
declare v_att int; v_files int; v_admin_ok boolean; v_nobody_all boolean; v_some_quality boolean;
begin
  select count(*) into v_att from storage.objects where bucket_id = 'project-attachments';
  select count(*) into v_files from storage.objects where bucket_id = 'project-files';
  select bool_and(attachments = v_att and files = v_files) into v_admin_ok from p16b_result where role = 'ADMIN';
  if not v_admin_ok then raise exception 'an admin cannot read every file'; end if;
  -- Employees see only what their project work covers.
  if exists (select 1 from p16b_result where role <> 'ADMIN' and attachments = v_att and v_att > 5) then
    raise exception 'a non-admin reads every project attachment';
  end if;
  if not exists (select 1 from p16b_result where role <> 'ADMIN' and attachments > 0) then
    raise exception 'no employee can read any attachment (quality room viewers should)';
  end if;
  if not exists (select 1 from p16b_result where role <> 'ADMIN' and attachments = 0 and files = 0) then
    raise exception 'expected unrelated employees to read nothing';
  end if;
end $$;
rollback;
