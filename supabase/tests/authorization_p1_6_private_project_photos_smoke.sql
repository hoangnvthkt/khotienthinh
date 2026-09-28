-- Run after authorization_p1_6_private_project_photos. Rolls back.
begin;
create temporary table pp_out (k text, v text) on commit drop;
grant all on pp_out to authenticated;

do $$
declare
  v_photo record;
  v_project text;
  u record;
  v_viewer record;
  v_outsider record;
  v_n int;
begin
  if (select public from storage.buckets where id = 'project-photos') then raise exception 'bucket still public'; end if;
  select id, name into v_photo from storage.objects where bucket_id = 'project-photos' limit 1;
  v_project := split_part(v_photo.name, '/', 2);

  for u in select id, auth_id, email from public.users
           where role::text <> 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u.auth_id, 'email', u.email, 'role', 'authenticated')::text, true);
    if app_private.project_photo_folder_visible(v_project) then
      if v_viewer is null then v_viewer := u; end if;
    elsif v_outsider is null and not exists (select 1 from storage.objects o where o.bucket_id = 'project-photos' and o.owner_id = u.auth_id::text) then
      v_outsider := u;
    end if;
    exit when v_viewer is not null and v_outsider is not null;
  end loop;
  if v_viewer is null or v_outsider is null then raise exception 'need a daily log viewer and an outsider'; end if;

  -- Viewer reads the photo.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_viewer.auth_id, 'email', v_viewer.email, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from storage.objects where id = v_photo.id;
  insert into pp_out values ('viewer_reads', v_n::text);
  execute 'reset role';

  -- Outsider neither reads it nor uploads into that project's folder.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_outsider.auth_id, 'email', v_outsider.email, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from storage.objects where id = v_photo.id;
  insert into pp_out values ('outsider_reads', v_n::text);
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('project-photos', 'dailylogs/' || v_project || '/pp-smoke.jpg', v_outsider.auth_id::text);
    insert into pp_out values ('outsider_uploads', 'allowed');
  exception when insufficient_privilege then insert into pp_out values ('outsider_uploads', 'blocked');
  end;
  execute 'reset role';
end $$;

do $$
declare v jsonb := (select jsonb_object_agg(k, v) from pp_out);
begin
  if v <> '{"viewer_reads":"1","outsider_reads":"0","outsider_uploads":"blocked"}'::jsonb then
    raise exception 'unexpected access: %', v;
  end if;
end $$;
rollback;
