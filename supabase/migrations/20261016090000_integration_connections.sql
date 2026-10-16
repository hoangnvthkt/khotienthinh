-- Kết nối API nhà cung cấp (chủ SP 16/10/2026): Admin tự thêm endpoint + API key, kiểm tra kết nối, gán cho từng tính năng —
-- như cách Claude quản lý kết nối bên thứ ba. Đợt đầu chỉ kết nối AI: Anthropic · Gemini · OpenAI · chuẩn OpenAI khác (9Router…).
--   * integration_connections: tên, loại, endpoint, model, bật/tắt, kết quả thử gần nhất. API key KHÔNG nằm ở đây:
--     mã hóa trong Supabase Vault (vault.secrets), bảng chỉ giữ id bí mật + 4 ký tự cuối để nhận diện.
--   * integration_assignments: tính năng nào dùng kết nối nào (ai.fast, ai.reasoning, wms.doc_reader). Chưa gán → hàm máy chủ
--     dùng khóa trong Secrets như cũ.
--   * Trình duyệt không bao giờ nhận lại khóa. Chỉ app_private.integration_secret_v1 (chỉ service_role) giải mã cho edge function.
--   * Mọi thêm / sửa / thay khóa / xóa / gán ghi audit_trail (module INTEGRATIONS).

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('anthropic', 'gemini', 'openai', 'openai_compatible')),
  name text not null check (length(btrim(name)) between 1 and 80),
  base_url text not null check (base_url ~ '^https://[^\s]+$'),
  model text,
  secret_id uuid,
  key_hint text,
  enabled boolean not null default true,
  status text not null default 'untested' check (status in ('untested', 'ok', 'error')),
  last_tested_at timestamptz,
  last_test jsonb not null default '{}'::jsonb check (jsonb_typeof(last_test) = 'object'),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.integration_connections is 'Kết nối API nhà cung cấp (AI). Khóa mã hóa trong Vault (secret_id), bảng chỉ giữ 4 ký tự cuối.';

create table if not exists public.integration_assignments (
  feature text primary key check (feature in ('ai.fast', 'ai.reasoning', 'wms.doc_reader')),
  connection_id uuid references public.integration_connections(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.integration_assignments is 'Tính năng nào dùng kết nối nào; null = dùng khóa trong Secrets của edge function.';
insert into public.integration_assignments (feature) values ('ai.fast'), ('ai.reasoning'), ('wms.doc_reader') on conflict (feature) do nothing;

alter table public.integration_connections enable row level security;
alter table public.integration_assignments enable row level security;
drop policy if exists integration_connections_select on public.integration_connections;
create policy integration_connections_select on public.integration_connections for select to authenticated using (public.is_admin());
drop policy if exists integration_assignments_select on public.integration_assignments;
create policy integration_assignments_select on public.integration_assignments for select to authenticated using (public.is_admin());
revoke all on public.integration_connections, public.integration_assignments from anon;
revoke insert, update, delete on public.integration_connections, public.integration_assignments from authenticated;
grant select on public.integration_connections, public.integration_assignments to authenticated;

create or replace function app_private.integration_audit(p_record text, p_label text, p_action text, p_description text, p_context jsonb)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.audit_trail (table_name, record_id, record_label, action, user_id, user_name, module, description, context)
  values ('integration_connections', p_record, p_label, p_action, public.current_app_user_id()::text,
    (select u.name from public.users u where u.id = public.current_app_user_id()), 'INTEGRATIONS', p_description, coalesce(p_context, '{}'::jsonb));
$$;
revoke all on function app_private.integration_audit(text, text, text, text, jsonb) from public, anon, authenticated;

create or replace function app_private.integration_row(c public.integration_connections)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name, 'baseUrl', c.base_url, 'model', c.model,
    'hasKey', c.secret_id is not null, 'keyHint', c.key_hint, 'enabled', c.enabled, 'status', c.status,
    'lastTestedAt', c.last_tested_at, 'lastTest', c.last_test, 'updatedAt', c.updated_at,
    'updatedByName', (select u.name from public.users u where u.id = c.updated_by));
$$;

-- Admin: danh sách kết nối (không có khóa) + gán theo tính năng.
create or replace function public.get_integration_connections_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'INTEGRATIONS_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'connections', coalesce((select jsonb_agg(app_private.integration_row(c) order by c.created_at) from public.integration_connections c), '[]'::jsonb),
    'assignments', coalesce((select jsonb_object_agg(a.feature, a.connection_id) from public.integration_assignments a), '{}'::jsonb));
end $$;

-- Admin: thêm / sửa. apiKey chỉ có khi nhập mới (thêm hoặc Thay khóa); để trống = giữ khóa cũ. Đổi endpoint / khóa → về "Chưa thử".
create or replace function public.save_integration_connection_v1(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a uuid := public.current_app_user_id();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_key text := nullif(btrim(coalesce(p->>'apiKey', '')), '');
  v_kind text := coalesce(nullif(p->>'kind', ''), 'openai_compatible');
  v_name text := btrim(coalesce(p->>'name', ''));
  v_url text := rtrim(btrim(coalesce(p->>'baseUrl', '')), '/');
  v_model text := nullif(btrim(coalesce(p->>'model', '')), '');
  c public.integration_connections;
  v_secret uuid;
  v_changed boolean;
begin
  if not public.is_admin() then raise exception 'INTEGRATIONS_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if v_key is not null and length(v_key) > 4000 then raise exception 'INTEGRATIONS_KEY_TOO_LONG' using errcode = '22023'; end if;
  if v_id is null then
    if v_key is null then raise exception 'INTEGRATIONS_KEY_REQUIRED' using errcode = '22023'; end if;
    insert into public.integration_connections (kind, name, base_url, model, enabled, created_by, updated_by)
      values (v_kind, v_name, v_url, v_model, coalesce((p->>'enabled')::boolean, true), a, a) returning * into c;
    v_secret := vault.create_secret(v_key, 'integration:' || c.id::text, 'Kết nối ' || v_name);
    update public.integration_connections set secret_id = v_secret, key_hint = right(v_key, 4) where id = c.id returning * into c;
    perform app_private.integration_audit(c.id::text, c.name, 'INSERT', 'Thêm kết nối',
      jsonb_build_object('kind', c.kind, 'baseUrl', c.base_url, 'model', c.model));
  else
    select * into c from public.integration_connections where id = v_id for update;
    if c.id is null then raise exception 'INTEGRATIONS_NOT_FOUND' using errcode = 'P0002'; end if;
    v_changed := v_key is not null or v_url <> c.base_url or v_kind <> c.kind;
    if v_key is not null then
      if c.secret_id is null then
        v_secret := vault.create_secret(v_key, 'integration:' || c.id::text, 'Kết nối ' || v_name);
      else
        perform vault.update_secret(c.secret_id, v_key);
        v_secret := c.secret_id;
      end if;
    else
      v_secret := c.secret_id;
    end if;
    update public.integration_connections set
      kind = v_kind, name = v_name, base_url = v_url, model = v_model,
      enabled = coalesce((p->>'enabled')::boolean, enabled),
      secret_id = v_secret, key_hint = case when v_key is not null then right(v_key, 4) else key_hint end,
      status = case when v_changed then 'untested' else status end,
      last_test = case when v_changed then '{}'::jsonb else last_test end,
      updated_by = a, updated_at = now()
    where id = c.id returning * into c;
    perform app_private.integration_audit(c.id::text, c.name, 'UPDATE', case when v_key is not null then 'Thay khóa kết nối' else 'Sửa kết nối' end,
      jsonb_build_object('kind', c.kind, 'baseUrl', c.base_url, 'model', c.model, 'enabled', c.enabled, 'keyChanged', v_key is not null));
  end if;
  return app_private.integration_row(c);
end $$;

create or replace function public.delete_integration_connection_v1(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare c public.integration_connections;
begin
  if not public.is_admin() then raise exception 'INTEGRATIONS_ADMIN_REQUIRED' using errcode = '42501'; end if;
  delete from public.integration_connections where id = p_id returning * into c;
  if c.id is null then raise exception 'INTEGRATIONS_NOT_FOUND' using errcode = 'P0002'; end if;
  if c.secret_id is not null then delete from vault.secrets where id = c.secret_id; end if;
  perform app_private.integration_audit(c.id::text, c.name, 'DELETE', 'Xóa kết nối', jsonb_build_object('kind', c.kind, 'baseUrl', c.base_url));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.set_integration_assignment_v1(p_feature text, p_connection_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_name text;
begin
  if not public.is_admin() then raise exception 'INTEGRATIONS_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if p_connection_id is not null then
    select name into v_name from public.integration_connections where id = p_connection_id;
    if v_name is null then raise exception 'INTEGRATIONS_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  update public.integration_assignments set connection_id = p_connection_id, updated_by = public.current_app_user_id(), updated_at = now()
    where feature = p_feature;
  if not found then raise exception 'INTEGRATIONS_FEATURE_UNKNOWN' using errcode = '22023'; end if;
  perform app_private.integration_audit(p_feature, coalesce(v_name, 'Secrets'), 'UPDATE', 'Gán kết nối cho tính năng',
    jsonb_build_object('feature', p_feature, 'connectionId', p_connection_id));
  return jsonb_build_object('feature', p_feature, 'connectionId', p_connection_id);
end $$;

-- Edge function ghi kết quả thử (chạy bằng JWT của Admin vừa bấm Thử).
create or replace function public.record_integration_test_v1(p_id uuid, p_result jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare c public.integration_connections;
begin
  if not public.is_admin() then raise exception 'INTEGRATIONS_ADMIN_REQUIRED' using errcode = '42501'; end if;
  update public.integration_connections set
    status = case when (p_result->>'ok')::boolean then 'ok' else 'error' end,
    last_tested_at = now(),
    last_test = jsonb_build_object('ms', (p_result->>'ms')::integer, 'httpStatus', (p_result->>'httpStatus')::integer,
      'models', least(coalesce((p_result->>'models')::integer, 0), 100000), 'code', left(p_result->>'code', 40), 'message', left(p_result->>'message', 300))
  where id = p_id returning * into c;
  if c.id is null then raise exception 'INTEGRATIONS_NOT_FOUND' using errcode = 'P0002'; end if;
  return app_private.integration_row(c);
end $$;

-- Chỉ service_role (edge function): giải mã khóa để gọi nhà cung cấp. p_id = null + p_feature → kết nối đang gán cho tính năng (đang bật).
create or replace function app_private.integration_secret_v1(p_id uuid default null, p_feature text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.integration_connections; v_key text;
begin
  if p_id is null and p_feature is not null then
    select x.* into c from public.integration_assignments a join public.integration_connections x on x.id = a.connection_id
      where a.feature = p_feature and x.enabled;
  else
    select * into c from public.integration_connections where id = p_id;
  end if;
  if c.id is null then return null; end if;
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.id = c.secret_id;
  return jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name, 'baseUrl', c.base_url, 'model', c.model, 'enabled', c.enabled, 'apiKey', v_key);
end $$;
revoke all on function app_private.integration_secret_v1(uuid, text) from public, anon, authenticated;
grant usage on schema app_private to service_role;
grant execute on function app_private.integration_secret_v1(uuid, text) to service_role;

-- PostgREST chỉ thấy schema public: lớp mỏng cho service_role gọi qua RPC.
create or replace function public.integration_secret_v1(p_id uuid default null, p_feature text default null)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app_private.integration_secret_v1(p_id, p_feature) $$;
revoke all on function public.integration_secret_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.integration_secret_v1(uuid, text) to service_role;

revoke all on function public.get_integration_connections_v1(), public.save_integration_connection_v1(jsonb), public.delete_integration_connection_v1(uuid),
  public.set_integration_assignment_v1(text, uuid), public.record_integration_test_v1(uuid, jsonb) from public, anon;
grant execute on function public.get_integration_connections_v1(), public.save_integration_connection_v1(jsonb), public.delete_integration_connection_v1(uuid),
  public.set_integration_assignment_v1(text, uuid), public.record_integration_test_v1(uuid, jsonb) to authenticated;
