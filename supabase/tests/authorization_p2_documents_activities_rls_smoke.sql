-- Run after authorization_p2_documents_activities_rls. Rolls back.
begin;
create temporary table dar_out (k text, v text) on commit drop;
grant all on dar_out to authenticated;

do $$
declare
  u record;
  v_doc record;
  v_viewer record;
  v_outsider record;
  v_admin_action record;
  v_n int;
begin
  select * into v_doc from public.project_documents limit 1;

  -- Find a non-admin who can view that project's documents and one who cannot.
  for u in select id, auth_id, email from public.users
           where role::text <> 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u.auth_id, 'email', u.email, 'role', 'authenticated')::text, true);
    if app_private.project_documents_can(v_doc.project_id, v_doc.construction_site_id, array['view', 'manage']) then
      if v_viewer is null then v_viewer := u; end if;
    elsif v_outsider is null then
      v_outsider := u;
    end if;
    exit when v_viewer is not null and v_outsider is not null;
  end loop;
  if v_viewer is null or v_outsider is null then raise exception 'need a document viewer and an outsider'; end if;
  select * into v_admin_action from public.activities
  where type::text = 'SYSTEM' and user_id is distinct from v_outsider.id limit 1;

  -- Outsider: no documents, no one else's admin actions, cannot write as someone else.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_outsider.auth_id, 'email', v_outsider.email, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.project_documents where id = v_doc.id;
  insert into dar_out values ('outsider_doc', v_n::text);
  select count(*) into v_n from public.activities where id = v_admin_action.id;
  insert into dar_out values ('outsider_admin_action', v_n::text);
  begin
    insert into public.project_documents (id, project_id, construction_site_id, category, title, file_name, storage_path)
    values (gen_random_uuid(), v_doc.project_id, v_doc.construction_site_id, 'general', 'x', 'x.pdf', 'x/x.pdf');
    insert into dar_out values ('outsider_insert_doc', 'allowed');
  exception when insufficient_privilege then insert into dar_out values ('outsider_insert_doc', 'blocked');
  end;
  -- Writing as someone else is re-stamped with the real actor (P0-B trigger).
  insert into public.activities (id, user_id, user_name, type, action, description, timestamp, status)
  values ('dar-smoke-act-1', v_viewer.id, 'Giả mạo', 'SYSTEM', 'x', 'x', now(), 'INFO');
  select count(*) into v_n from public.activities where id = 'dar-smoke-act-1' and user_id = v_outsider.id;
  insert into dar_out values ('spoof_activity', case when v_n = 1 then 'restamped' else 'kept' end);
  insert into public.activities (id, user_id, user_name, type, action, description, timestamp, status)
  values ('dar-smoke-act-2', v_outsider.id, 'Chính mình', 'SYSTEM', 'x', 'x', now(), 'INFO');
  select count(*) into v_n from public.activities where id = 'dar-smoke-act-2';
  insert into dar_out values ('own_activity_visible', v_n::text);
  execute 'reset role';

  -- Viewer: sees the document, cannot delete it without a delete permission.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_viewer.auth_id, 'email', v_viewer.email, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.project_documents where id = v_doc.id;
  insert into dar_out values ('viewer_doc', v_n::text);
  execute 'reset role';
end $$;

do $$
declare v jsonb := (select jsonb_object_agg(k, v) from dar_out);
begin
  if v <> '{"outsider_doc":"0","outsider_admin_action":"0","outsider_insert_doc":"blocked","spoof_activity":"restamped","own_activity_visible":"1","viewer_doc":"1"}'::jsonb then
    raise exception 'unexpected access: %', v;
  end if;
end $$;
rollback;
