begin;

do $preflight$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'feedback-attachments'
      and public = false
      and file_size_limit = 26214400
  ) then
    raise exception 'feedback attachment bucket missing';
  end if;
end
$preflight$;

set local role authenticated;

do $smoke$
declare
  v_admin_id uuid;
  v_admin_auth_id uuid;
  v_user_a_id uuid;
  v_user_a_auth_id uuid;
  v_user_b_id uuid;
  v_user_b_auth_id uuid;
  v_public_feedback_id uuid := gen_random_uuid();
  v_private_feedback_id uuid := gen_random_uuid();
  v_normalized_feedback_id uuid := gen_random_uuid();
begin
  select u.id, u.auth_id
    into v_admin_id, v_admin_auth_id
  from public.users u
  where u.auth_id is not null
    and coalesce(u.is_active, true)
    and u.role::text = 'ADMIN'
  order by u.created_at
  limit 1;

  select u.id, u.auth_id
    into v_user_a_id, v_user_a_auth_id
  from public.users u
  where u.auth_id is not null
    and coalesce(u.is_active, true)
    and u.id <> v_admin_id
  order by u.created_at
  limit 1;

  select u.id, u.auth_id
    into v_user_b_id, v_user_b_auth_id
  from public.users u
  where u.auth_id is not null
    and coalesce(u.is_active, true)
    and u.id not in (v_admin_id, v_user_a_id)
  order by u.created_at
  limit 1;

  if v_admin_id is null or v_user_a_id is null or v_user_b_id is null then
    raise exception 'feedback V3 smoke prerequisites are missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'feedback_items'
      and column_name = 'due_at'
  ) then
    raise exception 'feedback V3 columns missing';
  end if;

  if (
    select count(*)
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in (
        'feedback_items',
        'feedback_comments',
        'feedback_votes',
        'feedback_checklist',
        'feedback_attachments',
        'feedback_status_logs',
        'feedback_watchers'
      )
  ) < 7 then
    raise exception 'feedback realtime publication incomplete';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_a_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user_a_auth_id, 'role', 'authenticated')::text,
    true
  );

  insert into public.feedback_items(
    id, title, description, type, module, impact_level, priority, status, visibility, created_by
  )
  values
    (
      v_public_feedback_id, 'Smoke V3 public feedback', 'Public feedback watcher smoke.',
      'feature', 'other', 'medium', 'medium', 'new', 'public', v_user_a_id
    ),
    (
      v_private_feedback_id, 'Smoke V3 private feedback', 'Private feedback watcher smoke.',
      'bug', 'other', 'high', 'medium', 'new', 'private', v_user_a_id
    );

  if not exists (
    select 1
    from public.feedback_watchers
    where feedback_id = v_public_feedback_id
      and user_id = v_user_a_id
  ) then
    raise exception 'creator was not auto-watched';
  end if;

  insert into public.feedback_items(
    id, title, description, type, module, impact_level, priority, status, visibility, created_by, due_at
  )
  values (
    v_normalized_feedback_id, 'Smoke V3 normalized insert', 'User create payload should be normalized.',
    'feature', 'other', 'medium', 'urgent', 'done', 'public', v_user_b_id, now()
  );

  if not exists (
    select 1
    from public.feedback_items
    where id = v_normalized_feedback_id
      and created_by = v_user_a_id
      and priority = 'medium'
      and status = 'new'
      and due_at is null
  ) then
    raise exception 'feedback insert payload was not normalized to current actor/default fields';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_b_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user_b_auth_id, 'role', 'authenticated')::text,
    true
  );

  if exists (select 1 from public.feedback_items where id = v_private_feedback_id) then
    raise exception 'user B can unexpectedly see private feedback before watching';
  end if;

  insert into public.feedback_watchers(feedback_id, user_id, created_by)
  values (v_public_feedback_id, v_user_b_id, v_user_b_id);

  if not exists (
    select 1 from public.feedback_watchers
    where feedback_id = v_public_feedback_id
      and user_id = v_user_b_id
  ) then
    raise exception 'user B could not follow public feedback';
  end if;

  update public.feedback_items
  set due_at = now() + interval '2 days',
      target_release = 'Smoke Release',
      roadmap_stage = 'planned',
      tags = array['smoke']
  where id = v_public_feedback_id;

  if exists (
    select 1
    from public.feedback_items
    where id = v_public_feedback_id
      and due_at is not null
  ) then
    raise exception 'normal user unexpectedly updated admin roadmap/SLA fields';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin_auth_id, 'role', 'authenticated')::text,
    true
  );

  update public.feedback_items
  set due_at = now() + interval '2 days',
      target_release = 'Smoke Release',
      roadmap_stage = 'planned',
      tags = array['smoke', 'v3'],
      assigned_to = v_user_b_id
  where id = v_public_feedback_id;

  if not exists (
    select 1
    from public.feedback_items
    where id = v_public_feedback_id
      and target_release = 'Smoke Release'
      and roadmap_stage = 'planned'
      and tags @> array['v3']
  ) then
    raise exception 'admin could not update roadmap/SLA fields';
  end if;

  if not exists (
    select 1
    from public.feedback_watchers
    where feedback_id = v_public_feedback_id
      and user_id = v_user_b_id
  ) then
    raise exception 'assignee was not auto-watched';
  end if;

  insert into public.feedback_watchers(feedback_id, user_id, created_by)
  values (v_private_feedback_id, v_user_b_id, v_admin_id)
  on conflict (feedback_id, user_id) do nothing;

  perform set_config('request.jwt.claim.sub', v_user_b_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user_b_auth_id, 'role', 'authenticated')::text,
    true
  );

  if not exists (select 1 from public.feedback_items where id = v_private_feedback_id) then
    raise exception 'private watcher cannot see watched private feedback';
  end if;

  delete from public.feedback_watchers
  where feedback_id = v_private_feedback_id
    and user_id = v_user_b_id;

  if exists (select 1 from public.feedback_items where id = v_private_feedback_id) then
    raise exception 'user B can still see private feedback after unfollow';
  end if;
end
$smoke$;

rollback;
