-- Hide four permissions that nothing checks (no function, policy or screen uses them), so the
-- permission screen only offers boxes that actually do something:
--   booking.vehicle.trip.execute (trips are authorised by assignment), asset.catalog.manage,
--   asset.maintenance.manage (assets use the detailed create/edit/delete/... permissions),
--   request.category.manage (the request category table is no longer used).
-- Their 13 grants have no effect; they are revoked so saving those people keeps working, and the
-- 5 template rows are removed so templates can still be saved. Everything is backed up.

create table if not exists app_private.label_permission_retirement_backup (
  kind text not null check (kind in ('grant', 'template')),
  ref text not null,
  prev_row jsonb not null,
  retired_at timestamptz not null default now(),
  primary key (kind, ref)
);
revoke all on app_private.label_permission_retirement_backup from public, anon, authenticated;

create temporary table label_codes (code text primary key) on commit drop;
insert into label_codes values
  ('booking.vehicle.trip.execute'), ('asset.catalog.manage'), ('asset.maintenance.manage'), ('request.category.manage');

insert into app_private.label_permission_retirement_backup (kind, ref, prev_row)
select 'grant', g.id::text, to_jsonb(g)
from public.user_permission_grants g join label_codes c on c.code = g.permission_code
where g.is_active
on conflict do nothing;

insert into app_private.label_permission_retirement_backup (kind, ref, prev_row)
select 'template', t.code, jsonb_build_object('items', t.items)
from public.user_permission_templates t
where exists (select 1 from jsonb_array_elements(t.items) i join label_codes c on c.code = i ->> 'permissionCode')
on conflict do nothing;

update public.user_permission_grants g
set is_active = false, revoked_at = now(),
    revoked_reason = 'Quyền không có tác dụng, ẩn khỏi màn phân quyền (02/10/2026)', updated_at = now()
from label_codes c
where c.code = g.permission_code and g.is_active;

update public.user_permission_templates t
set items = coalesce((
      select jsonb_agg(i) from jsonb_array_elements(t.items) i
      where i ->> 'permissionCode' not in (select code from label_codes)), '[]'::jsonb),
    updated_at = now()
where exists (select 1 from jsonb_array_elements(t.items) i join label_codes c on c.code = i ->> 'permissionCode');

update public.permission_actions a
set is_active = false, updated_at = now()
from label_codes c
where c.code = a.permission_code and a.is_active;
