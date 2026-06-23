begin;

insert into public.users (id, name, email, username, role, is_active)
values
  ('11111111-1111-4111-8111-111111111111', 'Chat Actor', 'chat.actor@example.test', 'chat_actor_smoke', 'EMPLOYEE', true),
  ('22222222-2222-4222-8222-222222222222', 'Chat Peer', 'chat.peer@example.test', 'chat_peer_smoke', 'EMPLOYEE', true),
  ('33333333-3333-4333-8333-333333333333', 'Chat Outsider', 'chat.outsider@example.test', 'chat_outsider_smoke', 'EMPLOYEE', true)
on conflict (id) do update
set name = excluded.name,
    email = excluded.email,
    username = excluded.username,
    role = excluded.role,
    is_active = excluded.is_active;

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claim.email = 'chat.actor@example.test';
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","email":"chat.actor@example.test","role":"authenticated"}';

insert into public.chat_v2_conversations (id, type, name, created_by)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'group', 'Structured smoke', '11111111-1111-4111-8111-111111111111');

insert into public.chat_v2_participants (conversation_id, user_id, role, last_read_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner', now()),
  ('aaaaaaaa-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'member', null);

insert into public.chat_v2_messages (id, conversation_id, sender_id, kind, body, metadata)
values
  (
    'aaaaaaaa-0000-4000-8000-000000000101',
    'aaaaaaaa-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'poll',
    '',
    '{"question":"Chọn giờ họp","options":[{"id":"opt_1","text":"8h30"},{"id":"opt_2","text":"14h"}],"multiple":false}'::jsonb
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000102',
    'aaaaaaaa-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'checklist',
    '',
    '{"title":"Checklist giao hàng"}'::jsonb
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000103',
    'aaaaaaaa-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'quick_confirm',
    '',
    '{"title":"Xác nhận bản vẽ","options":[{"id":"received","text":"Đã nhận"},{"id":"issue","text":"Có vướng mắc"}]}'::jsonb
  );

insert into public.chat_v2_checklist_items (conversation_id, message_id, content, sort_order)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000102', 'Kiểm tra số lượng', 1),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000102', 'Chụp ảnh biên bản', 2);

select
  'actor_inbox_cache' as check_name,
  last_message_preview,
  unread_count
from public.chat_v2_participants
where conversation_id = 'aaaaaaaa-0000-4000-8000-000000000001'
  and user_id = '11111111-1111-4111-8111-111111111111';

select
  'peer_inbox_cache' as check_name,
  last_message_preview,
  unread_count
from public.chat_v2_participants
where conversation_id = 'aaaaaaaa-0000-4000-8000-000000000001'
  and user_id = '22222222-2222-4222-8222-222222222222';

set local request.jwt.claim.email = 'chat.peer@example.test';
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","email":"chat.peer@example.test","role":"authenticated"}';

insert into public.chat_v2_poll_votes (conversation_id, message_id, option_id, user_id)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000101', 'opt_1', '22222222-2222-4222-8222-222222222222');

update public.chat_v2_checklist_items
set is_done = true,
    done_by = '22222222-2222-4222-8222-222222222222',
    done_at = now()
where message_id = 'aaaaaaaa-0000-4000-8000-000000000102'
  and sort_order = 1;

insert into public.chat_v2_quick_confirm_responses (conversation_id, message_id, option_id, user_id)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000103', 'received', '22222222-2222-4222-8222-222222222222');

select 'peer_structured_counts' as check_name,
  (select count(*) from public.chat_v2_poll_votes where message_id = 'aaaaaaaa-0000-4000-8000-000000000101') as poll_votes,
  (select count(*) from public.chat_v2_checklist_items where message_id = 'aaaaaaaa-0000-4000-8000-000000000102' and is_done) as done_items,
  (select count(*) from public.chat_v2_quick_confirm_responses where message_id = 'aaaaaaaa-0000-4000-8000-000000000103') as confirmations;

set local request.jwt.claim.email = 'chat.outsider@example.test';
set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","email":"chat.outsider@example.test","role":"authenticated"}';

select 'outsider_cannot_read_structured' as check_name,
  (select count(*) from public.chat_v2_poll_votes where conversation_id = 'aaaaaaaa-0000-4000-8000-000000000001') as visible_poll_votes,
  (select count(*) from public.chat_v2_checklist_items where conversation_id = 'aaaaaaaa-0000-4000-8000-000000000001') as visible_checklist_items,
  (select count(*) from public.chat_v2_quick_confirm_responses where conversation_id = 'aaaaaaaa-0000-4000-8000-000000000001') as visible_confirmations;

rollback;
