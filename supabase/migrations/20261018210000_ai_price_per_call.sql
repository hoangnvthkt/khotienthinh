-- Chi phí AI theo lượt gọi (chủ SP 18/10/2026): cổng trung gian (RevidAPI) báo số token vào không ổn định (tự chèn ~6.900 token,
-- có lúc báo 100.000+), nên tính theo token làm trần tháng lệch xa tiền thật. Kết nối có thêm "giá mỗi lượt gọi" (USD):
-- chi phí một lượt AI = số lượt gọi model × giá mỗi lượt + token đầu ra × giá ra (câu dài như soạn văn bản, form tự tính thêm).
-- Có giá mỗi lượt thì bỏ giá token đầu vào. RevidAPI claude-sonnet-5-5: đo 18/10 trung bình 2,9 credit (~191đ ≈ 0,0074 USD) mỗi lượt
-- → đặt 0,008 USD (dư một chút). Admin chỉnh ở Cài đặt → Kết nối.

alter table public.integration_connections
  add column if not exists price_per_call numeric(10, 6) check (price_per_call is null or price_per_call between 0 and 10);
comment on column public.integration_connections.price_per_call is 'USD mỗi lượt gọi model (cổng tính token vào không ổn định); có thì bỏ giá token vào, vẫn cộng token ra × giá ra.';

update public.integration_connections set price_per_call = 0.008
  where base_url like 'https://revidapi.com%' and model like 'claude-%' and price_per_call is null;

create or replace function app_private.integration_row(c public.integration_connections)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name, 'baseUrl', c.base_url, 'model', c.model,
    'hasKey', c.secret_id is not null, 'keyHint', c.key_hint, 'enabled', c.enabled, 'status', c.status,
    'lastTestedAt', c.last_tested_at, 'lastTest', c.last_test, 'updatedAt', c.updated_at,
    'priceInPerM', c.price_in_per_m, 'priceOutPerM', c.price_out_per_m, 'pricePerCall', c.price_per_call,
    'updatedByName', (select u.name from public.users u where u.id = c.updated_by));
$$;

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
  return jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name, 'baseUrl', c.base_url, 'model', c.model, 'enabled', c.enabled, 'apiKey', v_key,
    'priceInPerM', c.price_in_per_m, 'priceOutPerM', c.price_out_per_m, 'pricePerCall', c.price_per_call);
end $$;
revoke all on function app_private.integration_secret_v1(uuid, text) from public, anon, authenticated;
grant execute on function app_private.integration_secret_v1(uuid, text) to service_role;

-- Admin thêm / sửa kết nối: như cũ + giá mỗi lượt gọi (chỉ đổi khi màn hình gửi trường; chuỗi rỗng = xóa).
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
  v_price_in numeric := nullif(btrim(coalesce(p->>'priceInPerM', '')), '')::numeric;
  v_price_out numeric := nullif(btrim(coalesce(p->>'priceOutPerM', '')), '')::numeric;
  v_price_call numeric := nullif(btrim(coalesce(p->>'pricePerCall', '')), '')::numeric;
  c public.integration_connections;
  v_secret uuid;
  v_changed boolean;
begin
  if not public.is_admin() then raise exception 'INTEGRATIONS_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if v_key is not null and length(v_key) > 4000 then raise exception 'INTEGRATIONS_KEY_TOO_LONG' using errcode = '22023'; end if;
  if (v_price_in is not null and (v_price_in < 0 or v_price_in > 1000)) or (v_price_out is not null and (v_price_out < 0 or v_price_out > 1000))
      or (v_price_call is not null and (v_price_call < 0 or v_price_call > 10)) then
    raise exception 'INTEGRATIONS_BAD_PRICE' using errcode = '22023';
  end if;
  if v_id is null then
    if v_key is null then raise exception 'INTEGRATIONS_KEY_REQUIRED' using errcode = '22023'; end if;
    insert into public.integration_connections (kind, name, base_url, model, enabled, price_in_per_m, price_out_per_m, price_per_call, created_by, updated_by)
      values (v_kind, v_name, v_url, v_model, coalesce((p->>'enabled')::boolean, true), v_price_in, v_price_out, v_price_call, a, a) returning * into c;
    v_secret := vault.create_secret(v_key, 'integration:' || c.id::text, 'Kết nối ' || v_name);
    update public.integration_connections set secret_id = v_secret, key_hint = right(v_key, 4) where id = c.id returning * into c;
    perform app_private.integration_audit(c.id::text, c.name, 'INSERT', 'Thêm kết nối',
      jsonb_build_object('kind', c.kind, 'baseUrl', c.base_url, 'model', c.model, 'priceInPerM', c.price_in_per_m, 'priceOutPerM', c.price_out_per_m, 'pricePerCall', c.price_per_call));
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
      price_in_per_m = case when p ? 'priceInPerM' then v_price_in else price_in_per_m end,
      price_out_per_m = case when p ? 'priceOutPerM' then v_price_out else price_out_per_m end,
      price_per_call = case when p ? 'pricePerCall' then v_price_call else price_per_call end,
      secret_id = v_secret, key_hint = case when v_key is not null then right(v_key, 4) else key_hint end,
      status = case when v_changed then 'untested' else status end,
      last_test = case when v_changed then '{}'::jsonb else last_test end,
      updated_by = a, updated_at = now()
    where id = c.id returning * into c;
    perform app_private.integration_audit(c.id::text, c.name, 'UPDATE', case when v_key is not null then 'Thay khóa kết nối' else 'Sửa kết nối' end,
      jsonb_build_object('kind', c.kind, 'baseUrl', c.base_url, 'model', c.model, 'enabled', c.enabled, 'keyChanged', v_key is not null,
        'priceInPerM', c.price_in_per_m, 'priceOutPerM', c.price_out_per_m, 'pricePerCall', c.price_per_call));
  end if;
  return app_private.integration_row(c);
end $$;

