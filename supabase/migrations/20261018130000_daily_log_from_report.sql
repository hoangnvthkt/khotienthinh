-- Nhật ký · PR-2 "Dán báo cáo Zalo / chụp sổ → phiếu nháp" + trí nhớ chung bản đầu (chủ SP 17/10/2026).
--
-- 1. Skill daily_log_from_report (cổng AI, kết nối đọc ảnh): báo cáo nhiều ngày → ngày × mũi × dòng việc gắn mã hạng mục, tổ đội, số người.
--    Máy kiểm lại mã có thật; phiếu tạo ra là NHÁP của người dán, đi qua đúng RPC phiếu kỹ sư sẵn có. Thử thật 17/10: tin Zalo 15/10 11 s,
--    tin 3 ngày 31 s, tách đúng khối nhà / phân đoạn / trục.
-- 2. Trí nhớ chung (chủ SP 17/10: "mọi AI học tích lũy, hiểu cấu trúc dự án và thói quen người dùng"): bảng ai_memory_aliases lưu cách gọi
--    người dùng đã XÁC NHẬN (chữ gốc → hạng mục / tổ đội / mũi…), theo dự án. Đọc trước khi gọi AI (khớp ngay + gợi ý cho AI),
--    ghi khi người dùng tạo phiếu nháp. Không học từ câu trả lời của AI. Chỉ đọc / ghi qua RPC, theo quyền Room Nhật ký của dự án.

insert into public.ai_skills (code, name, description, tier, mode, enabled, daily_limit, model_class) values
  ('daily_log_from_report', 'Nhật ký từ báo cáo Zalo / ảnh sổ',
   'Nhật ký: tin Zalo hoặc ảnh sổ viết tay (có thể nhiều ngày) → phiếu kỹ sư nháp theo ngày và mũi, dòng việc gắn hạng mục kế hoạch, tổ đội, số người.',
   'base', 'draft', true, 40, 'fast')
on conflict (code) do nothing;

create table if not exists public.ai_memory_aliases (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('project', 'company')),
  scope_id text not null,
  kind text not null check (kind in ('task', 'crew', 'area', 'item', 'vendor')),
  alias_norm text not null check (char_length(alias_norm) between 2 and 160),
  alias_text text not null check (char_length(alias_text) between 1 and 300),
  target_id text,
  target_label text not null check (char_length(target_label) between 1 and 300),
  target_key text generated always as (coalesce(target_id, 'label:' || lower(target_label))) stored,
  hits integer not null default 1 check (hits >= 1),
  last_used_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_type, scope_id, kind, alias_norm, target_key)
);
create index if not exists ai_memory_aliases_lookup on public.ai_memory_aliases (scope_type, scope_id, kind, hits desc);
alter table public.ai_memory_aliases enable row level security;
revoke all on public.ai_memory_aliases from public, anon, authenticated;
comment on table public.ai_memory_aliases is 'Trí nhớ chung của các skill AI: cách gọi người dùng đã xác nhận (chữ gốc → đối tượng), theo dự án. Chỉ qua RPC.';

-- Chuẩn hóa cách gọi: chữ thường, bỏ dấu tiếng Việt, chỉ chữ + số, một dấu cách (khớp fold() phía trình duyệt).
create or replace function app_private.ai_alias_norm(p_text text)
returns text language sql stable set search_path = '' as $$
  select btrim(regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, replace(replace(coalesce(p_text, ''), 'đ', 'd'), 'Đ', 'D'))), '[^a-z0-9]+', ' ', 'g'));
$$;

-- Quyền Room Nhật ký thường gắn theo công trường của dự án nên kiểm theo đúng (dự án, công trường) màn hình đang mở.
create or replace function app_private.ai_memory_can(p_project_id text, p_site_id text, p_actions text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_user_id() is not null and exists (
    select 1 from unnest(p_actions) action
    where app_private.current_actor_has_effective_room_action(p_project_id, nullif(p_site_id, ''), 'daily_log', action));
$$;
revoke all on function app_private.ai_memory_can(text, text, text[]) from public, anon, authenticated;

-- Đọc trí nhớ của dự án (và của công ty) cho các loại cần dùng; nhiều lần xác nhận, dùng gần đây lên trước.
create or replace function public.get_ai_memory_aliases_v1(p_project_id text, p_construction_site_id text default null, p_kinds text[] default array['task', 'crew', 'area'], p_limit integer default 300)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.ai_memory_can(p_project_id, p_construction_site_id, array['view']) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_VIEW_REQUIRED';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('kind', m.kind, 'alias', m.alias_text, 'aliasNorm', m.alias_norm, 'targetId', m.target_id,
      'targetLabel', m.target_label, 'hits', m.hits, 'lastUsedAt', m.last_used_at, 'scope', m.scope_type) order by m.hits desc, m.last_used_at desc)
    from (
      select * from public.ai_memory_aliases a
      where a.kind = any(coalesce(p_kinds, array['task', 'crew', 'area']))
        and ((a.scope_type = 'project' and a.scope_id = p_project_id) or a.scope_type = 'company')
      order by a.hits desc, a.last_used_at desc
      limit least(greatest(coalesce(p_limit, 300), 1), 1000)
    ) m), '[]'::jsonb);
end;
$$;
revoke all on function public.get_ai_memory_aliases_v1(text, text, text[], integer) from public, anon;
grant execute on function public.get_ai_memory_aliases_v1(text, text, text[], integer) to authenticated;

-- Ghi cách gọi người dùng vừa xác nhận (tạo phiếu nháp từ báo cáo). Cùng chữ → cùng đích thì cộng lượt; tối đa 80 cặp mỗi lần.
-- Người ghi phải có quyền làm việc với Nhật ký của dự án (gửi phiếu / tổng hợp / duyệt) — người chỉ xem không dạy được AI.
create or replace function public.learn_ai_memory_aliases_v1(p_project_id text, p_construction_site_id text, p_pairs jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_app_user_id();
  v_pair jsonb;
  v_kind text; v_alias text; v_norm text; v_target_id text; v_label text;
  v_saved integer := 0;
begin
  if v_me is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if not app_private.ai_memory_can(p_project_id, p_construction_site_id, array['submit', 'verify', 'approve']) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_SUBMIT_REQUIRED';
  end if;
  if jsonb_typeof(p_pairs) is distinct from 'array' then raise exception using errcode = '22023', message = 'AI_MEMORY_PAIRS_REQUIRED'; end if;
  for v_pair in select value from jsonb_array_elements(p_pairs) limit 80 loop
    v_kind := v_pair ->> 'kind';
    v_alias := left(btrim(coalesce(v_pair ->> 'alias', '')), 300);
    v_norm := left(app_private.ai_alias_norm(v_alias), 160);
    v_target_id := nullif(left(btrim(coalesce(v_pair ->> 'targetId', '')), 120), '');
    v_label := left(btrim(coalesce(v_pair ->> 'targetLabel', '')), 300);
    continue when v_kind not in ('task', 'crew', 'area') or char_length(v_norm) < 2 or v_label = '';
    -- Hạng mục phải thuộc dự án này (trí nhớ không trỏ sang dự án khác).
    continue when v_kind = 'task' and not exists (select 1 from public.project_tasks t where t.id::text = v_target_id and t.project_id::text = p_project_id);
    insert into public.ai_memory_aliases (scope_type, scope_id, kind, alias_norm, alias_text, target_id, target_label, created_by, updated_by)
    values ('project', p_project_id, v_kind, v_norm, v_alias, v_target_id, v_label, v_me, v_me)
    on conflict (scope_type, scope_id, kind, alias_norm, target_key) do update
      set hits = public.ai_memory_aliases.hits + 1, alias_text = excluded.alias_text, target_label = excluded.target_label,
          last_used_at = now(), updated_by = v_me, updated_at = now();
    v_saved := v_saved + 1;
  end loop;
  return jsonb_build_object('saved', v_saved);
end;
$$;
revoke all on function public.learn_ai_memory_aliases_v1(text, text, jsonb) from public, anon;
grant execute on function public.learn_ai_memory_aliases_v1(text, text, jsonb) to authenticated;
