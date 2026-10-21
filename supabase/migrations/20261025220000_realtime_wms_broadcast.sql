-- Realtime đợt 2 (audit 20/10/2026, mục H2): Broadcast theo kho cho 3 bảng ghi nhiều của Kho.
--
-- postgres_changes: mỗi thay đổi × mỗi người đang nghe = một lần Realtime chạy RLS thay người đó (một luồng, nối đuôi).
-- Broadcast: trigger gửi dòng vào kênh (topic) theo phạm vi; Realtime kiểm quyền MỘT LẦN lúc người dùng tham gia kênh
-- (RLS trên realtime.messages), sau đó chỉ phát lại. Quyền kênh dùng đúng hàm quyền của RLS bảng nên không lệch.
--
-- Kênh (client lấy danh sách được phép bằng RPC public.wms_realtime_topics_v1()):
--   transactions (policy transactions_phase4_select = wms_action_scope_tokens(['wms.transaction.view']) && …)
--     wms:tx:anywh              dòng có kho nguồn/đích        ← token global:* hoặc warehouse:*
--     wms:tx:nowh               dòng không kho                ← token global:*
--     wms:tx:wh:<kho>           dòng có kho nguồn/đích = <kho> ← token warehouse:<kho>
--     wms:tx:own:<người>        requester_id = <người>        ← <người> = tôi và token own:*
--     wms:tx:assigned:<người>   approver_id = <người>         ← <người> = tôi và token assigned:*
--   activities (policy activities_select)
--     wms:act:all               mọi dòng                      ← is_admin()
--     wms:act:user:<người>      user_id = <người>             ← <người> = tôi
--     wms:act:wh:<kho>          type INVENTORY/TRANSACTION/REQUEST, warehouse_id = <kho> ← scope.all hoặc <kho> ∈ scope.warehouses
--     wms:act:nowh              type như trên, warehouse_id null ← scope.all hoặc scope.any
--   items (policy items_phase4_select ∨ items_settings_select, không lọc theo dòng)
--     wms:items                                               ← cùng biểu thức hai policy
-- UPDATE làm một kênh mất quyền xem dòng: kênh đó chỉ nhận {id} kiểu DELETE (không lộ nội dung mới).
-- Gửi kênh lỗi không bao giờ làm hỏng lệnh ghi (realtime.send tự nuốt lỗi; trigger bọc thêm exception).
-- Bảng vẫn giữ trong publication supabase_realtime để client quay về postgres_changes khi RPC/kênh lỗi.

-- 1. Quyền tham gia một kênh wms:* (dùng cho RLS realtime.messages và RPC danh sách kênh).
create or replace function app_private.wms_realtime_topic_allowed(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_app_user_id();
  v_tokens text[];
  v_scope jsonb;
begin
  if v_me is null or p_topic is null or p_topic not like 'wms:%' then
    return false;
  end if;

  if p_topic like 'wms:tx:%' then
    v_tokens := app_private.wms_action_scope_tokens(array['wms.transaction.view']);
    return case
      when p_topic = 'wms:tx:anywh' then v_tokens && array['global:*', 'warehouse:*']
      when p_topic = 'wms:tx:nowh' then 'global:*' = any (v_tokens)
      when p_topic like 'wms:tx:wh:%' then ('warehouse:' || substr(p_topic, 11)) = any (v_tokens)
      when p_topic = 'wms:tx:own:' || v_me::text then 'own:*' = any (v_tokens)
      when p_topic = 'wms:tx:assigned:' || v_me::text then 'assigned:*' = any (v_tokens)
      else false
    end;
  end if;

  if p_topic like 'wms:act:%' then
    if p_topic = 'wms:act:all' then return public.is_admin(); end if;
    if p_topic = 'wms:act:user:' || v_me::text then return true; end if;
    if p_topic = 'wms:act:nowh' or p_topic like 'wms:act:wh:%' then
      v_scope := app_private.activity_wms_scope();
      if coalesce((v_scope ->> 'all')::boolean, false) then return true; end if;
      if p_topic = 'wms:act:nowh' then return coalesce((v_scope ->> 'any')::boolean, false); end if;
      return coalesce((v_scope -> 'warehouses') ? substr(p_topic, 12), false);
    end if;
    return false;
  end if;

  if p_topic = 'wms:items' then
    return public.is_module_admin('WMS')
      or app_private.wms_has_action('wms.inventory.view')
      or app_private.wms_has_action('wms.inventory.edit')
      or app_private.wms_has_action('wms.master_data.manage')
      or app_private.settings_has_action('master_data', false);
  end if;

  return false;
end;
$$;

-- 2. Danh sách kênh người đang đăng nhập được tham gia (đã bỏ kênh bị kênh rộng hơn bao trùm).
create or replace function public.wms_realtime_topics_v1()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with me as materialized (select public.current_app_user_id() as id),
  candidates as (
    select t from unnest(array['wms:tx:anywh', 'wms:tx:nowh', 'wms:act:all', 'wms:act:nowh', 'wms:items']) t
    union all select 'wms:tx:own:' || me.id from me where me.id is not null
    union all select 'wms:tx:assigned:' || me.id from me where me.id is not null
    union all select 'wms:act:user:' || me.id from me where me.id is not null
    union all select 'wms:tx:wh:' || w.id from public.warehouses w
    union all select 'wms:act:wh:' || w.id from public.warehouses w
  ),
  allowed as materialized (
    select t from candidates where app_private.wms_realtime_topic_allowed(t)
  ),
  flags as materialized (
    select
      exists (select 1 from allowed where t = 'wms:tx:anywh') as tx_anywh,
      exists (select 1 from allowed where t = 'wms:tx:nowh') as tx_nowh,
      exists (select 1 from allowed where t = 'wms:act:all') as act_all
    from (select 1) one
  )
  select coalesce(array_agg(a.t order by a.t), '{}'::text[])
  from allowed a, flags f
  where not (f.tx_anywh and a.t like 'wms:tx:wh:%')
    and not (f.tx_anywh and f.tx_nowh and (a.t like 'wms:tx:own:%' or a.t like 'wms:tx:assigned:%'))
    and not (f.act_all and a.t like 'wms:act:%' and a.t <> 'wms:act:all');
$$;

revoke all on function app_private.wms_realtime_topic_allowed(text) from public, anon;
revoke all on function public.wms_realtime_topics_v1() from public, anon;
grant execute on function app_private.wms_realtime_topic_allowed(text) to authenticated;
grant execute on function public.wms_realtime_topics_v1() to authenticated;

-- 3. Kênh nhận của từng dòng.
create or replace function app_private.wms_transaction_topics(p_source text, p_target text, p_requester uuid, p_approver uuid)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array_remove(array[
    case when p_source is not null or p_target is not null then 'wms:tx:anywh' else 'wms:tx:nowh' end,
    case when p_source is not null then 'wms:tx:wh:' || p_source end,
    case when p_target is not null and p_target is distinct from p_source then 'wms:tx:wh:' || p_target end,
    case when p_requester is not null then 'wms:tx:own:' || p_requester::text end,
    case when p_approver is not null then 'wms:tx:assigned:' || p_approver::text end
  ], null);
$$;

create or replace function app_private.wms_activity_topics(p_type text, p_warehouse text, p_user uuid)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array_remove(array[
    'wms:act:all',
    case when p_user is not null then 'wms:act:user:' || p_user::text end,
    case when p_type in ('INVENTORY', 'TRANSACTION', 'REQUEST') then
      case when p_warehouse is not null then 'wms:act:wh:' || p_warehouse else 'wms:act:nowh' end
    end
  ], null);
$$;

-- 4. Gửi: dòng mới tới kênh của dòng mới; kênh chỉ có ở dòng cũ (mất quyền / DELETE) nhận {id} kiểu DELETE.
create or replace function app_private.wms_broadcast_send(p_table text, p_op text, p_new jsonb, p_old_id text, p_new_topics text[], p_old_topics text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic text;
  v_delete jsonb := jsonb_build_object('table', p_table, 'eventType', 'DELETE', 'new', null, 'old', jsonb_build_object('id', p_old_id));
begin
  if p_op <> 'DELETE' then
    foreach v_topic in array coalesce(p_new_topics, '{}'::text[]) loop
      perform realtime.send(
        jsonb_build_object('table', p_table, 'eventType', p_op, 'new', p_new, 'old',
          case when p_old_id is not null then jsonb_build_object('id', p_old_id) end),
        p_op, v_topic, true);
    end loop;
  end if;
  foreach v_topic in array coalesce(p_old_topics, '{}'::text[]) loop
    if p_op = 'DELETE' or not (v_topic = any (coalesce(p_new_topics, '{}'::text[]))) then
      perform realtime.send(v_delete, 'DELETE', v_topic, true);
    end if;
  end loop;
exception when others then
  raise warning 'wms_broadcast_send %: %', p_table, sqlerrm;
end;
$$;

create or replace function app_private.trg_wms_broadcast_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.wms_broadcast_send(
    'transactions', tg_op,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    case when tg_op <> 'INSERT' then old.id::text end,
    case when tg_op <> 'DELETE' then app_private.wms_transaction_topics(new.source_warehouse_id, new.target_warehouse_id, new.requester_id, new.approver_id) end,
    case when tg_op <> 'INSERT' then app_private.wms_transaction_topics(old.source_warehouse_id, old.target_warehouse_id, old.requester_id, old.approver_id) end
  );
  return null;
end;
$$;

create or replace function app_private.trg_wms_broadcast_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.wms_broadcast_send(
    'activities', tg_op,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    case when tg_op <> 'INSERT' then old.id::text end,
    case when tg_op <> 'DELETE' then app_private.wms_activity_topics(new.type::text, new.warehouse_id, new.user_id) end,
    case when tg_op <> 'INSERT' then app_private.wms_activity_topics(old.type::text, old.warehouse_id, old.user_id) end
  );
  return null;
end;
$$;

create or replace function app_private.trg_wms_broadcast_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.wms_broadcast_send(
    'items', tg_op,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    case when tg_op <> 'INSERT' then old.id::text end,
    case when tg_op <> 'DELETE' then array['wms:items'] end,
    case when tg_op <> 'INSERT' then array['wms:items'] end
  );
  return null;
end;
$$;

revoke all on function app_private.wms_broadcast_send(text, text, jsonb, text, text[], text[]) from public, anon, authenticated;
revoke all on function app_private.trg_wms_broadcast_transaction() from public, anon, authenticated;
revoke all on function app_private.trg_wms_broadcast_activity() from public, anon, authenticated;
revoke all on function app_private.trg_wms_broadcast_item() from public, anon, authenticated;

drop trigger if exists zz_wms_broadcast_transaction on public.transactions;
create trigger zz_wms_broadcast_transaction
after insert or update or delete on public.transactions
for each row execute function app_private.trg_wms_broadcast_transaction();

drop trigger if exists zz_wms_broadcast_activity on public.activities;
create trigger zz_wms_broadcast_activity
after insert or update or delete on public.activities
for each row execute function app_private.trg_wms_broadcast_activity();

drop trigger if exists zz_wms_broadcast_item on public.items;
create trigger zz_wms_broadcast_item
after insert or update or delete on public.items
for each row execute function app_private.trg_wms_broadcast_item();

-- 5. Nhận: chỉ kênh wms:* và chỉ khi được phép (Realtime kiểm khi tham gia kênh private).
drop policy if exists wms_broadcast_receive on realtime.messages;
create policy wms_broadcast_receive on realtime.messages
for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) like 'wms:%'
  and app_private.wms_realtime_topic_allowed((select realtime.topic()))
);
