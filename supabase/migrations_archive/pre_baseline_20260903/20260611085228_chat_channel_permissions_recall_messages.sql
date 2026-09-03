-- Chat channel permissions and recallable messages.
-- - Channel/group memberships now distinguish owner/admin/member.
-- - Messages are recalled through metadata instead of row deletion.
-- - Channel managers can add/remove members without being the original creator.

alter table public.chat_members
  drop constraint if exists chat_members_role_check;

alter table public.chat_members
  add constraint chat_members_role_check
  check (role in ('owner', 'admin', 'member'));

update public.chat_members cm
set role = 'owner'
from public.chat_conversations cc
where cc.id = cm.conversation_id
  and cc.created_by = cm.user_id
  and cc.type in ('group', 'channel_text', 'channel_voice')
  and cm.role = 'admin';

alter table public.chat_messages
  add column if not exists sender_name text,
  add column if not exists sender_avatar_url text,
  add column if not exists recalled_at timestamptz,
  add column if not exists recalled_by uuid references public.users(id);

create index if not exists idx_chat_messages_recalled
  on public.chat_messages(conversation_id, recalled_at)
  where recalled_at is not null;

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

create or replace function app_private.chat_conversation_can_manage(
  p_conversation_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_user_id is not null, false)
    and (
      exists (
        select 1
        from public.chat_conversations cc
        where cc.id = p_conversation_id
          and cc.created_by = p_user_id::text
          and cc.deleted_at is null
      )
      or exists (
        select 1
        from public.chat_members cm
        where cm.conversation_id = p_conversation_id
          and cm.user_id = p_user_id::text
          and cm.role in ('owner', 'admin')
          and cm.left_at is null
      )
    );
$$;

revoke all on function app_private.chat_conversation_can_manage(uuid, uuid) from public;
grant execute on function app_private.chat_conversation_can_manage(uuid, uuid) to authenticated;

create or replace function app_private.guard_chat_member_role_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_app_user_id();
  v_can_change_role boolean := false;
begin
  if new.role is distinct from old.role then
    select
      public.is_admin()
      or exists (
        select 1
        from public.chat_conversations cc
        where cc.id = old.conversation_id
          and cc.created_by = v_user_id::text
          and cc.deleted_at is null
      )
      or exists (
        select 1
        from public.chat_members cm
        where cm.conversation_id = old.conversation_id
          and cm.user_id = v_user_id::text
          and cm.role = 'owner'
          and cm.left_at is null
      )
    into v_can_change_role;

    if not coalesce(v_can_change_role, false) then
      raise exception 'Only channel owners can change chat member roles.';
    end if;

    if old.role = 'owner'
      and new.role <> 'owner'
      and not (
        public.is_admin()
        or exists (
          select 1
          from public.chat_conversations cc
          where cc.id = old.conversation_id
            and cc.created_by = v_user_id::text
            and cc.deleted_at is null
        )
      )
    then
      raise exception 'Only the channel creator or system admin can change the owner role.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function app_private.guard_chat_message_recall_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_app_user_id();
begin
  if old.recalled_at is not null and new.recalled_at is null then
    raise exception 'A recalled chat message cannot be restored.';
  end if;

  if new.recalled_at is distinct from old.recalled_at
    or new.recalled_by is distinct from old.recalled_by
  then
    if not (
      public.is_admin()
      or old.sender_id = v_user_id::text
      or app_private.chat_conversation_can_manage(old.conversation_id, v_user_id)
    ) then
      raise exception 'Only the sender or channel admins can recall this message.';
    end if;
    new.recalled_by = coalesce(new.recalled_by, v_user_id);
    new.recalled_at = coalesce(new.recalled_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_chat_member_role_guard on public.chat_members;
create trigger trg_chat_member_role_guard
  before update on public.chat_members
  for each row execute function app_private.guard_chat_member_role_update();

drop trigger if exists trg_chat_message_recall_guard on public.chat_messages;
create trigger trg_chat_message_recall_guard
  before update on public.chat_messages
  for each row execute function app_private.guard_chat_message_recall_update();

revoke all on function app_private.guard_chat_member_role_update() from public;
revoke all on function app_private.guard_chat_message_recall_update() from public;

drop policy if exists chat_conversations_update on public.chat_conversations;
create policy chat_conversations_update
  on public.chat_conversations
  for update
  to authenticated
  using (
    public.is_admin()
    or created_by = public.current_app_user_id()::text
    or app_private.chat_conversation_can_manage(id, public.current_app_user_id())
  )
  with check (
    public.is_admin()
    or created_by = public.current_app_user_id()::text
    or app_private.chat_conversation_can_manage(id, public.current_app_user_id())
  );

drop policy if exists chat_members_insert on public.chat_members;
create policy chat_members_insert
  on public.chat_members
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.chat_conversation_can_manage(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_members_update on public.chat_members;
create policy chat_members_update
  on public.chat_members
  for update
  to authenticated
  using (
    public.is_admin()
    or user_id = public.current_app_user_id()::text
    or app_private.chat_conversation_can_manage(conversation_id, public.current_app_user_id())
  )
  with check (
    public.is_admin()
    or user_id = public.current_app_user_id()::text
    or app_private.chat_conversation_can_manage(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_members_delete on public.chat_members;
create policy chat_members_delete
  on public.chat_members
  for delete
  to authenticated
  using (
    public.is_admin()
    or app_private.chat_conversation_can_manage(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_messages_delete on public.chat_messages;
revoke delete on table public.chat_messages from authenticated;
grant select, insert, update on table public.chat_messages to authenticated;
