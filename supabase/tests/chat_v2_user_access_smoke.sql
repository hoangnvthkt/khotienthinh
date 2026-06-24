do $$
declare
  v_allowed_user_id uuid := '55555555-5555-4555-8555-555555555551';
  v_disabled_user_id uuid := '55555555-5555-4555-8555-555555555552';
  v_conversation_id uuid := '55555555-5555-4555-8555-555555555553';
  v_message_id uuid := '55555555-5555-4555-8555-555555555554';
  v_count integer;
  v_insert_blocked boolean := false;
begin
  insert into public.users (id, name, email, username, role, is_active, allowed_modules)
  values
    (v_allowed_user_id, 'Chat Access Allowed', 'chat.access.allowed@example.test', 'chat_access_allowed', 'EMPLOYEE', true, array['CHAT']),
    (v_disabled_user_id, 'Chat Access Disabled', 'chat.access.disabled@example.test', 'chat_access_disabled', 'EMPLOYEE', true, array['HRM'])
  on conflict (id) do update
  set email = excluded.email,
      username = excluded.username,
      role = excluded.role,
      is_active = excluded.is_active,
      allowed_modules = excluded.allowed_modules;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"55555555-5555-4555-8555-555555555561","email":"chat.access.allowed@example.test","role":"authenticated"}',
    true
  );

  insert into public.chat_v2_conversations (id, type, name, created_by)
  values (v_conversation_id, 'group', 'Chat access smoke', v_allowed_user_id)
  on conflict (id) do nothing;

  insert into public.chat_v2_participants (conversation_id, user_id, role)
  values
    (v_conversation_id, v_allowed_user_id, 'owner'),
    (v_conversation_id, v_disabled_user_id, 'member')
  on conflict (conversation_id, user_id) do nothing;

  insert into public.chat_v2_messages (id, conversation_id, sender_id, kind, body)
  values (v_message_id, v_conversation_id, v_allowed_user_id, 'text', 'Chat access smoke')
  on conflict (id) do nothing;

  execute 'set local role authenticated';
  perform set_config(
    'request.jwt.claims',
    '{"sub":"55555555-5555-4555-8555-555555555561","email":"chat.access.allowed@example.test","role":"authenticated"}',
    true
  );

  select count(*)
  into v_count
  from public.chat_v2_messages
  where id = v_message_id;

  if v_count <> 1 then
    raise exception 'CHAT-enabled participant should see the test message, got % row(s).', v_count;
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"55555555-5555-4555-8555-555555555562","email":"chat.access.disabled@example.test","role":"authenticated"}',
    true
  );

  select count(*)
  into v_count
  from public.chat_v2_messages
  where id = v_message_id;

  if v_count <> 0 then
    raise exception 'CHAT-disabled participant should see 0 messages, got %.', v_count;
  end if;

  begin
    insert into public.chat_v2_messages (conversation_id, sender_id, kind, body)
    values (v_conversation_id, v_disabled_user_id, 'text', 'This insert must be blocked');
  exception
    when insufficient_privilege then
      v_insert_blocked := true;
  end;

  if not v_insert_blocked then
    raise exception 'CHAT-disabled participant unexpectedly inserted a message.';
  end if;

  execute 'reset role';

  delete from public.notifications
  where source_type = 'chat_v2_message'
    and source_id = v_message_id::text;
  execute 'alter table public.chat_v2_participants disable trigger trg_guard_chat_v2_participant_mutation';
  delete from public.chat_v2_conversations where id = v_conversation_id;
  execute 'alter table public.chat_v2_participants enable trigger trg_guard_chat_v2_participant_mutation';
  delete from public.users where id in (v_allowed_user_id, v_disabled_user_id);
end;
$$;
