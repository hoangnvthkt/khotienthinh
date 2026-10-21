-- Trợ lý v2 · T1 "tự tra cứu bằng công cụ theo quyền" (chủ SP 18/10/2026).
--
-- 1. ai_stock_by_items_v1: tồn hiện tại theo kho của vài vật tư, SECURITY INVOKER — RLS của inventory_balances (kho người hỏi
--    được xem), items, warehouses quyết định dòng nào thấy. Chỉ số lượng, không giá trị tồn.
-- 2. ai_thread_save_turn_v1: nguồn của câu trả lời giờ có cả hồ sơ (loại + id + mã + tên để màn hình mở đúng màn), nên nới
--    giới hạn lưu nguồn (30 mục, 16.000 ký tự). Phần còn lại giữ nguyên.

create or replace function public.ai_stock_by_items_v1(p_item_ids text[])
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('itemId', x.material_id, 'sku', x.sku, 'name', x.name, 'unit', x.unit,
      'warehouseId', x.warehouse_id, 'warehouseName', x.warehouse_name, 'qty', x.qty) order by x.name, x.qty desc), '[]'::jsonb)
  from (
    select b.material_id, i.sku, i.name, i.unit, b.warehouse_id, w.name as warehouse_name, round(sum(b.on_hand_qty), 4) as qty
    from public.inventory_balances b
    join public.items i on i.id = b.material_id
    join public.warehouses w on w.id = b.warehouse_id and not coalesce(w.is_archived, false)
    where b.material_id = any ((coalesce(p_item_ids, '{}'::text[]))[1:10])
    group by b.material_id, i.sku, i.name, i.unit, b.warehouse_id, w.name
    having abs(sum(b.on_hand_qty)) > 0.0000005
    limit 120
  ) x;
$$;
comment on function public.ai_stock_by_items_v1(text[]) is 'Trợ lý: tồn hiện tại theo kho của tối đa 10 vật tư, theo RLS của người hỏi (SECURITY INVOKER). Chỉ số lượng.';
revoke all on function public.ai_stock_by_items_v1(text[]) from public, anon;
grant execute on function public.ai_stock_by_items_v1(text[]) to authenticated;

create or replace function public.ai_thread_save_turn_v1(p_thread_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a uuid := public.current_app_user_id();
  v_thread uuid; v_question text; v_answer text; v_sources jsonb; v_run uuid; v_user_msg uuid; v_ai_msg uuid;
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  v_question := left(btrim(coalesce(p->>'question', '')), 8000);
  v_answer := left(btrim(coalesce(p->>'answer', '')), 8000);
  if v_question = '' or v_answer = '' then raise exception 'AI_THREAD_BAD_TURN' using errcode = '22023'; end if;
  v_sources := case when jsonb_typeof(p->'sources') = 'array' then p->'sources' else '[]'::jsonb end;
  if jsonb_array_length(v_sources) > 30 or length(v_sources::text) > 16000 then v_sources := '[]'::jsonb; end if;
  v_run := nullif(p->>'runId', '')::uuid;
  if v_run is not null and not exists (select 1 from public.ai_runs where id = v_run and user_id = a) then v_run := null; end if;

  if p_thread_id is null then
    insert into public.assistant_threads (user_id, title, project_id)
      values (a, left(regexp_replace(v_question, '\s+', ' ', 'g'), 80), left(nullif(p->>'projectId', ''), 80))
      returning id into v_thread;
  else
    select id into v_thread from public.assistant_threads where id = p_thread_id and user_id = a for update;
    if v_thread is null then raise exception 'AI_THREAD_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;

  -- clock_timestamp: thứ tự tin đúng cả khi nhiều lượt ghi trong cùng một giao dịch.
  insert into public.assistant_messages (thread_id, role, content, created_at) values (v_thread, 'user', v_question, clock_timestamp()) returning id into v_user_msg;
  insert into public.assistant_messages (thread_id, role, content, sources, run_id, created_at)
    values (v_thread, 'assistant', v_answer, v_sources, v_run, clock_timestamp()) returning id into v_ai_msg;
  update public.assistant_threads set message_count = message_count + 2, last_message_at = now() where id = v_thread;
  return jsonb_build_object('threadId', v_thread, 'userMessageId', v_user_msg, 'messageId', v_ai_msg);
end $$;
