-- Trợ lý v2 · T4a "học từ việc người dùng làm thật" (chủ SP duyệt 18/10/2026). Không để AI tự sửa quy tắc của mình; AI chỉ học
-- cách gọi đã được NGƯỜI XÁC NHẬN bằng hành động (bấm Gửi / Lưu trên thẻ), và người dùng chấm điểm có lý do để Quản trị AI sửa.
--   1. Trí nhớ cách gọi cho vật tư + nhà cung cấp (bảng ai_memory_aliases sẵn có, kind item / vendor):
--      * đề xuất vật tư: "xi măng PCB40" → mã vật tư, theo DỰ ÁN; người dạy phải lập đề xuất được ở dự án đó.
--      * đơn mua: tên hàng trên báo giá → mã, tên NCC trên báo giá → NCC, theo CÔNG TY; người dạy phải quản lý Mua hàng.
--      Đích phải có thật (items / business_partners). Lượt sau thẻ chọn sẵn đúng mã / NCC ("Đã nhớ").
--   2. Dislike có lý do (Sai số liệu / Hiểu sai ý / Thiếu thông tin / Chậm / Khác + ghi chú tùy chọn) — chỉ ghi loại + ghi chú người dùng
--      tự gõ, không lưu câu hỏi / câu trả lời ở nhật ký (quyết định câu 3: Quản trị AI chỉ thấy số liệu).
--   3. get_ai_feedback_v1: Admin xem phản hồi N ngày theo skill × lý do + ghi chú gần đây.

alter table public.ai_runs add column if not exists feedback_reason text
  check (feedback_reason is null or feedback_reason in ('wrong_data', 'misunderstood', 'incomplete', 'slow', 'other'));
alter table public.ai_runs add column if not exists feedback_note text check (feedback_note is null or char_length(feedback_note) <= 300);

create or replace function public.ai_gateway_feedback_v2(p_run_id uuid, p_accepted boolean, p_reason text default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id();
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  if p_reason is not null and p_reason not in ('wrong_data', 'misunderstood', 'incomplete', 'slow', 'other') then
    raise exception 'AI_FEEDBACK_BAD_REASON' using errcode = '22023';
  end if;
  update public.ai_runs set accepted = p_accepted, feedback_at = now(),
    feedback_reason = case when p_accepted then null else p_reason end,
    feedback_note = case when p_accepted then null else left(nullif(btrim(coalesce(p_note, '')), ''), 300) end
  where id = p_run_id and user_id = a and status = 'ok';
  if not found then raise exception 'AI_RUN_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.get_ai_feedback_v1(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'skills', coalesce((select jsonb_agg(jsonb_build_object('skill', s.skill_code, 'runs', s.runs, 'likes', s.likes, 'dislikes', s.dislikes, 'reasons', s.reasons) order by s.runs desc)
      from (select r.skill_code, count(*) runs, count(*) filter (where r.accepted) likes, count(*) filter (where r.accepted = false) dislikes,
              coalesce((select jsonb_object_agg(x.reason, x.n) from (select coalesce(r2.feedback_reason, 'none') reason, count(*) n from public.ai_runs r2
                where r2.skill_code = r.skill_code and r2.created_at >= v_from and r2.accepted = false group by 1) x), '{}'::jsonb) reasons
            from public.ai_runs r where r.created_at >= v_from and r.status = 'ok' group by r.skill_code) s), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('at', n.feedback_at, 'skill', n.skill_code, 'reason', n.feedback_reason, 'note', n.feedback_note) order by n.feedback_at desc)
      from (select * from public.ai_runs r where r.created_at >= v_from and r.accepted = false and r.feedback_at is not null
            order by r.feedback_at desc limit 30) n), '[]'::jsonb));
end $$;

-- Ai được dạy / đọc trí nhớ theo từng việc.
create or replace function app_private.ai_learning_can(p_context text, p_project_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_user_id() is not null and case
    when p_context = 'material_request' then exists (select 1 from public.projects p where p.id = p_project_id
      and app_private.material_has_action(p.id, p.construction_site_id::text, 'project.material_request.create', public.current_app_user_id()))
    when p_context = 'purchase_order' then app_private.procurement_can('manage')
    else false end;
$$;
revoke all on function app_private.ai_learning_can(text, text) from public, anon, authenticated;

create or replace function public.get_ai_aliases_v2(p_context text, p_project_id text default null, p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.ai_learning_can(p_context, p_project_id) then raise exception 'AI_MEMORY_DENIED' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('kind', m.kind, 'alias', m.alias_text, 'aliasNorm', m.alias_norm, 'targetId', m.target_id,
      'targetLabel', m.target_label, 'hits', m.hits, 'lastUsedAt', m.last_used_at, 'scope', m.scope_type) order by m.hits desc, m.last_used_at desc)
    from (
      select * from public.ai_memory_aliases a
      where (p_context = 'material_request' and a.kind = 'item' and a.scope_type = 'project' and a.scope_id = p_project_id)
         or (p_context = 'purchase_order' and a.kind in ('item', 'vendor') and a.scope_type = 'company' and a.scope_id = 'procurement')
      order by a.hits desc, a.last_used_at desc
      limit least(greatest(coalesce(p_limit, 500), 1), 1000)
    ) m), '[]'::jsonb);
end $$;

-- Ghi cách gọi người dùng vừa xác nhận bằng hành động (lưu / gửi trên thẻ). Cùng chữ → cùng đích thì cộng lượt; tối đa 60 cặp mỗi lần.
create or replace function public.learn_ai_aliases_v2(p_context text, p_project_id text, p_pairs jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_app_user_id();
  v_pair jsonb; v_kind text; v_alias text; v_norm text; v_target_id text; v_label text;
  v_scope_type text; v_scope_id text; v_saved integer := 0;
begin
  if not app_private.ai_learning_can(p_context, p_project_id) then raise exception 'AI_MEMORY_DENIED' using errcode = '42501'; end if;
  if jsonb_typeof(p_pairs) is distinct from 'array' then raise exception using errcode = '22023', message = 'AI_MEMORY_PAIRS_REQUIRED'; end if;
  v_scope_type := case when p_context = 'material_request' then 'project' else 'company' end;
  v_scope_id := case when p_context = 'material_request' then p_project_id else 'procurement' end;
  for v_pair in select value from jsonb_array_elements(p_pairs) limit 60 loop
    v_kind := v_pair ->> 'kind';
    v_alias := left(btrim(coalesce(v_pair ->> 'alias', '')), 300);
    v_norm := left(app_private.ai_alias_norm(v_alias), 160);
    v_target_id := nullif(left(btrim(coalesce(v_pair ->> 'targetId', '')), 120), '');
    v_label := left(btrim(coalesce(v_pair ->> 'targetLabel', '')), 300);
    continue when char_length(v_norm) < 2 or v_label = '' or v_target_id is null;
    continue when not (v_kind = 'item' or (v_kind = 'vendor' and p_context = 'purchase_order'));
    continue when v_kind = 'item' and not exists (select 1 from public.items i where i.id = v_target_id and coalesce(i.status, 'active') <> 'retired');
    continue when v_kind = 'vendor' and not exists (select 1 from public.business_partners b where b.id::text = v_target_id);
    insert into public.ai_memory_aliases (scope_type, scope_id, kind, alias_norm, alias_text, target_id, target_label, created_by, updated_by)
    values (v_scope_type, v_scope_id, v_kind, v_norm, v_alias, v_target_id, v_label, v_me, v_me)
    on conflict (scope_type, scope_id, kind, alias_norm, target_key) do update
      set hits = public.ai_memory_aliases.hits + 1, alias_text = excluded.alias_text, target_label = excluded.target_label,
          last_used_at = now(), updated_by = v_me, updated_at = now();
    v_saved := v_saved + 1;
  end loop;
  return jsonb_build_object('saved', v_saved);
end $$;

revoke all on function public.ai_gateway_feedback_v2(uuid, boolean, text, text), public.get_ai_feedback_v1(integer),
  public.get_ai_aliases_v2(text, text, integer), public.learn_ai_aliases_v2(text, text, jsonb) from public, anon;
grant execute on function public.ai_gateway_feedback_v2(uuid, boolean, text, text), public.get_ai_feedback_v1(integer),
  public.get_ai_aliases_v2(text, text, integer), public.learn_ai_aliases_v2(text, text, jsonb) to authenticated;
