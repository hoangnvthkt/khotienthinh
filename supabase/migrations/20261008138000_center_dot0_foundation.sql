-- Trung tâm điều hành (Vioo Command Center) — đợt 0, PR-A: quyền, bật theo người, bố cục cá nhân.
-- Additive. Không cấp quyền cho người thật, không bật cho ai: chủ sản phẩm bật từng người bằng
-- app_private.center_rollout_actors (có hạn, bắt buộc lý do, ghi audit_trail). Center không có
-- dữ liệu nghiệp vụ riêng; đợt 0 chỉ đọc qua RPC sẵn có của từng module.

insert into public.permission_applications(code,name,description,sort_order,is_active,member_assignable)
values('center','Trung tâm điều hành','Màn làm việc chung: việc của tôi, hôm nay, mở hồ sơ các module',5,true,true)
on conflict(code) do update set name=excluded.name,description=excluded.description,is_active=true;

insert into public.permission_modules(application_code,code,name,routes,sort_order,is_active)
values ('center','center.module','Trung tâm điều hành',array['/center'],10,true),
       ('center','center.layout','Bố cục của tôi','{}',20,true)
on conflict(code) do update set name=excluded.name,routes=excluded.routes,is_active=true;

insert into public.permission_actions(module_code,action,permission_code,label,scope_modes,sort_order,is_active,risk_level,is_business_action,is_business_approval,grant_readiness,access_application_code)
values ('center.module','access','center.module.access','Truy cập Trung tâm điều hành',array['global'],1,true,'normal',false,false,'enforced','center'),
       ('center.layout','manage','center.layout.manage','Tùy chỉnh bố cục của tôi',array['own'],10,true,'normal',false,false,'enforced','center')
on conflict(permission_code) do update set label=excluded.label,scope_modes=excluded.scope_modes,grant_readiness='enforced',is_active=true;

-- Bật theo người (mẫu G9: fail-closed, có hạn, có lý do, có audit).
-- mode 'on' = dùng đầy đủ; 'read_only' = chỉ xem (thao tác nhanh ở PR-D sẽ khóa).
create table app_private.center_rollout_actors (
  user_id uuid primary key references public.users(id) on delete restrict,
  mode text not null default 'on' check (mode in ('read_only','on')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reason text not null check (btrim(reason) <> ''),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (expires_at > starts_at)
);
create index center_rollout_actors_created_by_idx on app_private.center_rollout_actors(created_by);
create index center_rollout_actors_updated_by_idx on app_private.center_rollout_actors(updated_by);
revoke all on app_private.center_rollout_actors from public, anon, authenticated;
grant all on app_private.center_rollout_actors to service_role;

-- Mọi thay đổi phải có lý do: thêm mới dùng cột reason; sửa thì đổi reason hoặc đặt
-- app.center_rollout_reason; xóa bắt buộc app.center_rollout_reason.
create function app_private.audit_center_rollout_change_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(btrim(current_setting('app.center_rollout_reason', true)), '');
  v_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  v_actor uuid := public.current_app_user_id();
begin
  if v_reason is null and (tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.reason is distinct from old.reason)) then
    v_reason := new.reason;
  end if;
  if v_reason is null then
    raise exception using errcode = '22023', message = 'CENTER_ROLLOUT_REASON_REQUIRED';
  end if;
  insert into public.audit_trail(table_name,record_id,record_label,action,old_data,new_data,user_id,user_name,module,description,impact_level,context)
  values ('center_rollout_actors', v_user::text, (select name from public.users where id = v_user), tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end,
    case when tg_op <> 'DELETE' then to_jsonb(new) else '{}'::jsonb end,
    v_actor::text, (select name from public.users where id = v_actor), 'CENTER',
    case tg_op when 'INSERT' then 'Bật Trung tâm điều hành' when 'UPDATE' then 'Đổi chế độ / thời hạn Trung tâm điều hành' else 'Tắt Trung tâm điều hành' end,
    'high', jsonb_build_object('reason', v_reason, 'databaseUser', session_user));
  return null;
end $$;
revoke all on function app_private.audit_center_rollout_change_v1() from public, anon, authenticated;

create trigger trg_center_rollout_actors_audit
after insert or update or delete on app_private.center_rollout_actors
for each row execute function app_private.audit_center_rollout_change_v1();

-- Bố cục cá nhân (widget ẩn/hiện/thứ tự — giao diện ở PR-E). Chỉ đọc/ghi qua RPC.
create table public.center_user_layouts (
  user_id uuid primary key references public.users(id) on delete cascade,
  layout jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  constraint center_user_layouts_layout_object check (jsonb_typeof(layout) = 'object'),
  constraint center_user_layouts_layout_size check (octet_length(layout::text) <= 16384)
);
alter table public.center_user_layouts enable row level security;
revoke all on public.center_user_layouts from public, anon, authenticated;
grant all on public.center_user_layouts to service_role;

-- Người gọi được dùng Center: có quyền truy cập + đang trong thời hạn bật. Không thì 42501.
create function app_private.center_actor_v1()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null
     or not app_private.has_permission(v_actor, 'center.module.access', 'global', '*')
     or not exists (select 1 from app_private.center_rollout_actors r
       where r.user_id = v_actor and r.starts_at <= statement_timestamp() and r.expires_at > statement_timestamp()) then
    raise exception using errcode = '42501', message = 'CENTER_ACCESS_DENIED';
  end if;
  return v_actor;
end $$;
revoke all on function app_private.center_actor_v1() from public, anon, authenticated;

create function public.get_center_access_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_row app_private.center_rollout_actors%rowtype;
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'center.module.access', 'global', '*') then
    return jsonb_build_object('enabled', false, 'mode', 'off', 'reason', 'no_permission');
  end if;
  select * into v_row from app_private.center_rollout_actors r
  where r.user_id = v_actor and r.starts_at <= statement_timestamp() and r.expires_at > statement_timestamp();
  if not found then
    return jsonb_build_object('enabled', false, 'mode', 'off', 'reason', 'not_in_rollout');
  end if;
  return jsonb_build_object('enabled', true, 'mode', v_row.mode, 'expiresAt', v_row.expires_at);
end $$;
revoke all on function public.get_center_access_v1() from public, anon;
grant execute on function public.get_center_access_v1() to authenticated, service_role;

create function public.get_center_layout_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.center_actor_v1();
  v_row public.center_user_layouts%rowtype;
begin
  select * into v_row from public.center_user_layouts where user_id = v_actor;
  return jsonb_build_object(
    'layout', coalesce(v_row.layout, '{}'::jsonb),
    'version', coalesce(v_row.version, 0),
    'updatedAt', v_row.updated_at,
    'canManage', app_private.has_permission(v_actor, 'center.layout.manage', 'own', '*'));
end $$;
revoke all on function public.get_center_layout_v1() from public, anon;
grant execute on function public.get_center_layout_v1() to authenticated, service_role;

create function public.save_center_layout_v1(p_layout jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.center_actor_v1();
  v_row public.center_user_layouts%rowtype;
begin
  if not app_private.has_permission(v_actor, 'center.layout.manage', 'own', '*') then
    raise exception using errcode = '42501', message = 'CENTER_LAYOUT_DENIED';
  end if;
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' or octet_length(p_layout::text) > 16384 then
    raise exception using errcode = '22023', message = 'CENTER_LAYOUT_INVALID';
  end if;
  insert into public.center_user_layouts as l(user_id, layout) values (v_actor, p_layout)
  on conflict (user_id) do update set layout = excluded.layout, version = l.version + 1, updated_at = now()
  returning * into v_row;
  return jsonb_build_object('layout', v_row.layout, 'version', v_row.version, 'updatedAt', v_row.updated_at);
end $$;
revoke all on function public.save_center_layout_v1(jsonb) from public, anon;
grant execute on function public.save_center_layout_v1(jsonb) to authenticated, service_role;
