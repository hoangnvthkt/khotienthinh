-- Bật THÍ ĐIỂM Trung tâm điều hành đợt 0 cho đội SMB-2026 (kế hoạch 07 mục 6, PR-F).
-- Chạy SAU khi deploy 20261008138000 … 20261008138003. Chủ sản phẩm chạy (ghi vào production).
--
-- Mặc định kết thúc bằng ROLLBACK = diễn tập: xem danh sách in ra cuối cùng. Đúng người thì đổi dòng
-- cuối thành COMMIT rồi chạy lại:
--   npx supabase db query --linked --agent=no --file supabase/operations/center_dot0_pilot.sql
--
-- Ai được bật: người đang trong Tổ chức dự án SMB-2026 + người đang được điều động (H2) tới công trường
-- SMB-2026 hôm nay. Thêm người ngoài danh sách ở mục 3 (bỏ chú thích, điền email).
-- Làm gì: cấp quyền trực tiếp "Truy cập Trung tâm điều hành" (toàn công ty) + "Tùy chỉnh bố cục của tôi"
-- (của tôi) nếu chưa có; bật theo người 30 ngày, chế độ "on". Mọi lần bật ghi audit_trail kèm lý do.
-- Tắt sớm: supabase/operations/center_dot0_pilot_off.sql.
begin;
select pg_advisory_xact_lock(hashtextextended('center_dot0_pilot', 0));
select set_config('app.center_rollout_reason', 'Thí điểm Trung tâm điều hành đợt 0 — đội SMB-2026', true);

do $$ begin
  if to_regprocedure('public.vcc_my_actions_v1(text)') is null or to_regclass('app_private.center_rollout_actors') is null then
    raise exception 'CENTER_PILOT_NOT_DEPLOYED: chưa deploy đủ migration 20261008138000 … 20261008138003';
  end if;
  if not exists (select 1 from public.projects where code = 'SMB-2026') then
    raise exception 'CENTER_PILOT_PROJECT_MISSING: không thấy dự án SMB-2026';
  end if;
end $$;

create temporary table vcc_pilot (user_id uuid primary key, name text not null, source text not null) on commit drop;

-- 1) Tổ chức dự án SMB-2026 (đang hiệu lực).
insert into vcc_pilot (user_id, name, source)
select distinct on (u.id) u.id, u.name, 'Tổ chức dự án SMB-2026'
from public.projects p
join public.project_staff s on s.project_id = p.id
join public.users u on u.id::text = s.user_id
where p.code = 'SMB-2026' and (s.end_date is null or s.end_date >= current_date)
  and u.is_active and u.account_status = 'ACTIVE'
order by u.id
on conflict (user_id) do nothing;

-- 2) Đang được điều động (H2) tới công trường SMB-2026 hôm nay.
insert into vcc_pilot (user_id, name, source)
select distinct on (u.id) u.id, u.name, 'Điều động tới công trường SMB-2026'
from public.projects p
join public.hrm_site_assignments a on a.site_id = p.construction_site_id and a.status = 'approved'
  and a.start_date <= current_date and (a.end_date is null or a.end_date >= current_date)
join public.employees e on e.id = a.employee_id
join public.users u on u.id = e.user_id
where p.code = 'SMB-2026' and u.is_active and u.account_status = 'ACTIVE'
order by u.id
on conflict (user_id) do nothing;

-- 3) Thêm người ngoài danh sách (Ban giám đốc, kế toán, mua hàng… cùng thí điểm): bỏ chú thích, điền email.
-- insert into vcc_pilot (user_id, name, source)
-- select id, name, 'Thêm tay' from public.users
-- where lower(email) in ('ten1@tienthinhjsc.vn', 'ten2@tienthinhjsc.vn') and is_active and account_status = 'ACTIVE'
-- on conflict (user_id) do nothing;

do $$ begin
  if (select count(*) from vcc_pilot) = 0 then raise exception 'CENTER_PILOT_EMPTY: danh sách thí điểm rỗng'; end if;
end $$;

insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, grant_reason)
select v.user_id, g.code, g.scope, '*', 'Thí điểm Trung tâm điều hành đợt 0 — đội SMB-2026'
from vcc_pilot v
cross join (values ('center.module.access', 'global'), ('center.layout.manage', 'own')) g(code, scope)
on conflict (user_id, permission_code, scope_type, scope_id) do nothing;

insert into app_private.center_rollout_actors (user_id, mode, expires_at, reason)
select user_id, 'on', now() + interval '30 days', 'Thí điểm Trung tâm điều hành đợt 0 — đội SMB-2026'
from vcc_pilot
on conflict (user_id) do update set mode = 'on', expires_at = excluded.expires_at, reason = excluded.reason, updated_at = now();

-- Kiểm: mọi người trong danh sách vào được Center (quyền còn hiệu lực + đang trong hạn bật).
do $$ declare missing int; begin
  select count(*) into missing from vcc_pilot v
  where not app_private.has_permission(v.user_id, 'center.module.access', 'global', '*')
     or not exists (select 1 from app_private.center_rollout_actors r where r.user_id = v.user_id and r.expires_at > now());
  if missing > 0 then
    raise exception 'CENTER_PILOT_ACCESS_MISSING: % người chưa vào được (quyền trực tiếp đã bị thu hồi trước đó?)', missing;
  end if;
end $$;

select v.name as "Người được bật", v.source as "Lý do có tên", to_char(r.expires_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') as "Hết hạn"
from vcc_pilot v join app_private.center_rollout_actors r on r.user_id = v.user_id
order by v.source, v.name;

rollback; -- Diễn tập. Đúng danh sách thì đổi thành: commit;
