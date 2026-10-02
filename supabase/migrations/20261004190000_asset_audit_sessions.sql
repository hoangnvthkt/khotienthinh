-- Asset audits (Tài sản → Kiểm kê) were never stored: the page kept them in memory and said
-- "đã lưu". One row per finished audit; the auditor is taken from the signed-in account; totals
-- must match the item list; rows cannot be edited, only an Admin may delete one.

create table if not exists public.asset_audit_sessions (
  id uuid primary key default gen_random_uuid(),
  audited_at timestamptz not null default now(),
  auditor_user_id uuid not null references public.users(id),
  auditor_name text not null,
  items jsonb not null,
  total_items integer not null,
  total_good integer not null,
  total_damaged integer not null,
  total_lost integer not null,
  total_wrong_location integer not null,
  note text,
  created_at timestamptz not null default now(),
  constraint asset_audit_sessions_items_array check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  constraint asset_audit_sessions_totals check (
    total_items = jsonb_array_length(items)
    and least(total_good, total_damaged, total_lost, total_wrong_location) >= 0
    and total_good + total_damaged + total_lost + total_wrong_location = total_items)
);
create index if not exists asset_audit_sessions_audited_at_idx on public.asset_audit_sessions (audited_at desc);

-- The auditor is whoever is signed in, never what the browser sends.
create or replace function app_private.asset_audit_sessions_stamp_auditor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_user public.users%rowtype;
begin
  select * into v_user from public.users where id = public.current_app_user_id();
  if v_user.id is null then
    raise exception 'ASSET_AUDIT_ACTOR_REQUIRED' using errcode = '42501';
  end if;
  new.auditor_user_id := v_user.id;
  new.auditor_name := coalesce(nullif(btrim(v_user.name), ''), v_user.email);
  new.audited_at := now();
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists asset_audit_sessions_stamp_auditor on public.asset_audit_sessions;
create trigger asset_audit_sessions_stamp_auditor
before insert on public.asset_audit_sessions
for each row execute function app_private.asset_audit_sessions_stamp_auditor();

alter table public.asset_audit_sessions enable row level security;
revoke all on public.asset_audit_sessions from anon;
grant select, insert, delete on public.asset_audit_sessions to authenticated;

create policy asset_audit_sessions_active_actor_gate on public.asset_audit_sessions
  as restrictive for all to authenticated
  using ((select public.current_app_user_id()) is not null)
  with check ((select public.current_app_user_id()) is not null);

create policy asset_audit_sessions_select on public.asset_audit_sessions
  for select to authenticated
  using ((select public.is_admin())
    or (select app_private.asset_has_any_action('asset.audit.view'))
    or (select app_private.asset_has_any_action('asset.audit.perform')));

create policy asset_audit_sessions_insert on public.asset_audit_sessions
  for insert to authenticated
  with check ((select public.is_admin()) or (select app_private.asset_has_any_action('asset.audit.perform')));

create policy asset_audit_sessions_delete on public.asset_audit_sessions
  for delete to authenticated
  using ((select public.is_admin()));

-- asset.audit.perform now guards a real write.
update public.permission_actions set grant_readiness = 'enforced', updated_at = now()
where permission_code = 'asset.audit.perform' and grant_readiness <> 'enforced';
