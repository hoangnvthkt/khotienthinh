begin;

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
  v_denied boolean;
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
    raise exception 'feedback smoke prerequisites are missing';
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
      v_public_feedback_id, 'Smoke public feedback', 'Public feedback should be visible to other users.',
      'bug', 'other', 'high', 'medium', 'new', 'public', v_user_a_id
    ),
    (
      v_private_feedback_id, 'Smoke private feedback', 'Private feedback should only be visible to owner and managers.',
      'bug', 'other', 'medium', 'medium', 'new', 'private', v_user_a_id
    );

  perform set_config('request.jwt.claim.sub', v_user_b_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user_b_auth_id, 'role', 'authenticated')::text,
    true
  );

  if not exists (select 1 from public.feedback_items where id = v_public_feedback_id) then
    raise exception 'user B cannot see public feedback';
  end if;

  if exists (select 1 from public.feedback_items where id = v_private_feedback_id) then
    raise exception 'user B can unexpectedly see private feedback';
  end if;

  insert into public.feedback_comments(feedback_id, author_user_id, body)
  values (v_public_feedback_id, v_user_b_id, 'Smoke public comment');

  v_denied := false;
  begin
    insert into public.feedback_comments(feedback_id, author_user_id, body)
    values (v_private_feedback_id, v_user_b_id, 'Smoke private comment should fail');
  exception when others then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'user B unexpectedly commented on private feedback';
  end if;

  insert into public.feedback_votes(feedback_id, user_id)
  values (v_public_feedback_id, v_user_b_id);

  v_denied := false;
  begin
    insert into public.feedback_votes(feedback_id, user_id)
    values (v_public_feedback_id, v_user_b_id);
  exception when unique_violation then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'duplicate vote unexpectedly allowed';
  end if;

  update public.feedback_items
  set status = 'in_progress'
  where id = v_public_feedback_id;

  if exists (
    select 1
    from public.feedback_items
    where id = v_public_feedback_id
      and status = 'in_progress'
  ) then
    raise exception 'non-manager unexpectedly updated feedback status';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin_auth_id, 'role', 'authenticated')::text,
    true
  );

  update public.feedback_items
  set status = 'done',
      priority = 'urgent',
      assigned_to = v_admin_id
  where id = v_public_feedback_id;

  if not exists (
    select 1
    from public.feedback_status_logs
    where feedback_id = v_public_feedback_id
      and old_status = 'new'
      and new_status = 'done'
  ) then
    raise exception 'status log was not created for admin update';
  end if;

  insert into public.feedback_comments(feedback_id, author_user_id, body, is_internal)
  values (v_public_feedback_id, v_admin_id, 'Smoke internal comment', true);

  perform set_config('request.jwt.claim.sub', v_user_b_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user_b_auth_id, 'role', 'authenticated')::text,
    true
  );

  if exists (
    select 1
    from public.feedback_comments
    where feedback_id = v_public_feedback_id
      and is_internal = true
  ) then
    raise exception 'user B can unexpectedly see internal comments';
  end if;
end
$smoke$;

rollback;
