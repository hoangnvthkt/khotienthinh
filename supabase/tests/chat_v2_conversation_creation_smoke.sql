begin;

set local role authenticated;
set local request.jwt.claim.sub = '94087920-3dc7-4304-a1c7-e9ff7d1aad2f';
set local request.jwt.claim.email = 'hadtt@tienthinhjsc.vn';
set local request.jwt.claims = '{"sub":"94087920-3dc7-4304-a1c7-e9ff7d1aad2f","email":"hadtt@tienthinhjsc.vn","role":"authenticated"}';

do $$
declare
  v_actor uuid := public.current_app_user_id();
  v_admin uuid;
  v_chungbq uuid;
  v_direct uuid;
  v_group uuid;
  v_other_group uuid;
  v_message uuid := 'aaaaaaaa-0000-4000-8000-000000000901';
  v_participant_count integer;
  v_cross_reply_blocked boolean := false;
begin
  if v_actor is null then
    raise exception 'Smoke actor hadtt was not resolved.';
  end if;

  select id into v_admin from public.users where username = 'admin';
  select id into v_chungbq from public.users where username = 'chungbq';

  if v_admin is null or v_chungbq is null then
    raise exception 'Smoke users admin/chungbq are required.';
  end if;

  v_direct := public.chat_v2_get_or_create_direct_conversation(v_admin);
  if v_direct is null then
    raise exception 'Direct conversation RPC returned null.';
  end if;

  v_group := public.chat_v2_create_group_conversation('Smoke group', array[v_admin, v_chungbq]);

  select count(*) into v_participant_count
  from public.chat_v2_participants
  where conversation_id = v_group
    and left_at is null;

  if v_participant_count <> 3 then
    raise exception 'Expected 3 group participants, got %.', v_participant_count;
  end if;

  insert into public.chat_v2_messages (
    id,
    conversation_id,
    sender_id,
    body,
    kind
  )
  values (
    v_message,
    v_group,
    v_actor,
    'Tin nhắn gốc',
    'text'
  );

  v_other_group := public.chat_v2_create_group_conversation('Smoke other group', array[v_admin]);

  begin
    insert into public.chat_v2_messages (
      conversation_id,
      sender_id,
      body,
      kind,
      reply_to_message_id
    )
    values (
      v_other_group,
      v_actor,
      'Reply sai hội thoại',
      'text',
      v_message
    );
  exception when others then
    v_cross_reply_blocked := true;
  end;

  if not v_cross_reply_blocked then
    raise exception 'Cross-conversation reply was not blocked.';
  end if;
end $$;

select 'chat_v2_conversation_creation_smoke' as check_name, 'ok' as result;

rollback;
