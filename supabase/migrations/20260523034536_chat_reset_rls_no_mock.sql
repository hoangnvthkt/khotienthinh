-- Chat reset + RLS repair
-- Purpose:
-- - remove seeded/mock chat conversations so the app starts clean
-- - replace recursive/overlapping chat policies with a small non-recursive set

alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_pins enable row level security;
alter table public.chat_user_settings enable row level security;
alter table public.chat_call_sessions enable row level security;
alter table public.chat_call_participants enable row level security;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'chat_conversations',
        'chat_members',
        'chat_messages',
        'chat_pins',
        'chat_user_settings',
        'chat_call_sessions',
        'chat_call_participants'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', v_policy.policyname, v_policy.schemaname, v_policy.tablename);
  end loop;
end $$;

create policy chat_conversations_select
  on public.chat_conversations
  for select
  to authenticated
  using (
    public.is_admin()
    or created_by = public.current_app_user_id()::text
    or exists (
      select 1
      from public.chat_members cm
      where cm.conversation_id = chat_conversations.id
        and cm.user_id = public.current_app_user_id()::text
        and cm.left_at is null
    )
  );

create policy chat_conversations_insert
  on public.chat_conversations
  for insert
  to authenticated
  with check (
    public.is_admin()
    or created_by = public.current_app_user_id()::text
  );

create policy chat_conversations_update
  on public.chat_conversations
  for update
  to authenticated
  using (
    public.is_admin()
    or created_by = public.current_app_user_id()::text
    or exists (
      select 1
      from public.chat_members cm
      where cm.conversation_id = chat_conversations.id
        and cm.user_id = public.current_app_user_id()::text
        and cm.role = 'admin'
        and cm.left_at is null
    )
  )
  with check (
    public.is_admin()
    or created_by = public.current_app_user_id()::text
    or exists (
      select 1
      from public.chat_members cm
      where cm.conversation_id = chat_conversations.id
        and cm.user_id = public.current_app_user_id()::text
        and cm.role = 'admin'
        and cm.left_at is null
    )
  );

create policy chat_conversations_delete
  on public.chat_conversations
  for delete
  to authenticated
  using (
    public.is_admin()
    or created_by = public.current_app_user_id()::text
  );

-- Member rows are safe for authenticated users to read because the users
-- directory is already visible in-app, and conversation visibility is enforced
-- on chat_conversations/messages. Keeping this policy non-recursive is critical.
create policy chat_members_select
  on public.chat_members
  for select
  to authenticated
  using (true);

create policy chat_members_insert
  on public.chat_members
  for insert
  to authenticated
  with check (
    public.is_admin()
    or user_id = public.current_app_user_id()::text
    or exists (
      select 1
      from public.chat_conversations cc
      where cc.id = chat_members.conversation_id
        and cc.created_by = public.current_app_user_id()::text
        and cc.deleted_at is null
    )
  );

create policy chat_members_update
  on public.chat_members
  for update
  to authenticated
  using (
    public.is_admin()
    or user_id = public.current_app_user_id()::text
    or exists (
      select 1
      from public.chat_conversations cc
      where cc.id = chat_members.conversation_id
        and cc.created_by = public.current_app_user_id()::text
        and cc.deleted_at is null
    )
  )
  with check (
    public.is_admin()
    or user_id = public.current_app_user_id()::text
    or exists (
      select 1
      from public.chat_conversations cc
      where cc.id = chat_members.conversation_id
        and cc.created_by = public.current_app_user_id()::text
        and cc.deleted_at is null
    )
  );

create policy chat_members_delete
  on public.chat_members
  for delete
  to authenticated
  using (
    public.is_admin()
    or user_id = public.current_app_user_id()::text
    or exists (
      select 1
      from public.chat_conversations cc
      where cc.id = chat_members.conversation_id
        and cc.created_by = public.current_app_user_id()::text
        and cc.deleted_at is null
    )
  );

create policy chat_messages_select
  on public.chat_messages
  for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.chat_members cm
      where cm.conversation_id = chat_messages.conversation_id
        and cm.user_id = public.current_app_user_id()::text
        and cm.left_at is null
    )
  );

create policy chat_messages_insert
  on public.chat_messages
  for insert
  to authenticated
  with check (
    public.is_admin()
    or (
      sender_id = public.current_app_user_id()::text
      and exists (
        select 1
        from public.chat_members cm
        where cm.conversation_id = chat_messages.conversation_id
          and cm.user_id = public.current_app_user_id()::text
          and cm.left_at is null
      )
    )
  );

create policy chat_messages_update
  on public.chat_messages
  for update
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.chat_members cm
      where cm.conversation_id = chat_messages.conversation_id
        and cm.user_id = public.current_app_user_id()::text
        and cm.left_at is null
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1
      from public.chat_members cm
      where cm.conversation_id = chat_messages.conversation_id
        and cm.user_id = public.current_app_user_id()::text
        and cm.left_at is null
    )
  );

create policy chat_messages_delete
  on public.chat_messages
  for delete
  to authenticated
  using (
    public.is_admin()
    or sender_id = public.current_app_user_id()::text
  );

create policy chat_pins_member_access
  on public.chat_pins
  for all
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.chat_members cm
      where cm.conversation_id = chat_pins.conversation_id
        and cm.user_id = public.current_app_user_id()::text
        and cm.left_at is null
    )
  )
  with check (
    public.is_admin()
    or (
      pinned_by = public.current_app_user_id()
      and exists (
        select 1
        from public.chat_members cm
        where cm.conversation_id = chat_pins.conversation_id
          and cm.user_id = public.current_app_user_id()::text
          and cm.left_at is null
      )
    )
  );

create policy chat_user_settings_owner_access
  on public.chat_user_settings
  for all
  to authenticated
  using (user_id = public.current_app_user_id() or public.is_admin())
  with check (user_id = public.current_app_user_id() or public.is_admin());

create policy chat_call_sessions_member_access
  on public.chat_call_sessions
  for all
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.chat_members cm
      where cm.conversation_id = chat_call_sessions.conversation_id
        and cm.user_id = public.current_app_user_id()::text
        and cm.left_at is null
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1
      from public.chat_members cm
      where cm.conversation_id = chat_call_sessions.conversation_id
        and cm.user_id = public.current_app_user_id()::text
        and cm.left_at is null
    )
  );

create policy chat_call_participants_member_access
  on public.chat_call_participants
  for all
  to authenticated
  using (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or exists (
      select 1
      from public.chat_call_sessions ccs
      join public.chat_members cm on cm.conversation_id = ccs.conversation_id
      where ccs.id = chat_call_participants.call_session_id
        and cm.user_id = public.current_app_user_id()::text
        and cm.left_at is null
    )
  )
  with check (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or exists (
      select 1
      from public.chat_call_sessions ccs
      join public.chat_members cm on cm.conversation_id = ccs.conversation_id
      where ccs.id = chat_call_participants.call_session_id
        and cm.user_id = public.current_app_user_id()::text
        and cm.left_at is null
    )
  );

grant select, insert, update, delete on public.chat_conversations to authenticated;
grant select, insert, update, delete on public.chat_members to authenticated;
grant select, insert, update, delete on public.chat_messages to authenticated;
grant select, insert, update, delete on public.chat_pins to authenticated;
grant select, insert, update, delete on public.chat_user_settings to authenticated;
grant select, insert, update, delete on public.chat_call_sessions to authenticated;
grant select, insert, update, delete on public.chat_call_participants to authenticated;

delete from public.chat_conversations;
