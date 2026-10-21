-- Mở Trợ lý AI cho nhóm thí điểm 15 người (chủ SP chốt 18/10/2026): 5 "Nâng cao" + 10 "Tiêu chuẩn", trần chung 80 USD/tháng,
-- 2 mẫu có thêm DeepSeek Flash để chọn ở ô hỏi. Đoàn Văn Dương chưa có Trung tâm điều hành → thêm vào thí điểm tới 31/12/2026.
-- Cấp phát chạy bằng Admin Hoàng (Quản trị AI) qua đúng RPC của Trung tâm AI → có audit. Mặc định chạy thử bằng tham số --rollback.
begin;
-- 1. Trung tâm điều hành cho Đoàn Văn Dương (như center_dot0_pilot.sql: quyền trực tiếp + dòng thí điểm có lý do).
insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, grant_reason)
select u.id, g.code, g.scope, '*', 'Thí điểm Trợ lý AI 18/10/2026 — nhóm 15 người'
from public.users u cross join (values ('center.module.access', 'global'), ('center.layout.manage', 'own')) g(code, scope)
where u.name = 'Đoàn Văn Dương'
on conflict (user_id, permission_code, scope_type, scope_id) do nothing;
insert into app_private.center_rollout_actors (user_id, mode, expires_at, reason)
select u.id, 'on', timestamptz '2026-12-31 23:59:59+07', 'Thí điểm Trợ lý AI 18/10/2026 — nhóm 15 người' from public.users u where u.name = 'Đoàn Văn Dương'
on conflict (user_id) do nothing;

-- 2. Cấp phát bằng Admin Hoàng.
create temp table op_admin on commit drop as select u.auth_id, u.email from public.users u where u.name = 'Admin Hoàng' and u.role = 'ADMIN' and u.auth_id is not null limit 1;
create temp table op_people(name text primary key, tpl text) on commit drop;
insert into op_people values
  ('Dương Xuân Thịnh', 'Nâng cao'), ('Nguyễn Thị Mơ', 'Nâng cao'), ('Hà Đức Chuẩn', 'Nâng cao'), ('Nguyễn Thị Hương', 'Nâng cao'), ('Đặng Thị Thu Hà', 'Nâng cao'),
  ('Phạm Thị Thủy', 'Tiêu chuẩn'), ('Bùi Thị Tâm', 'Tiêu chuẩn'), ('Nguyễn Văn Luật', 'Tiêu chuẩn'), ('Nguyễn Văn Năm', 'Tiêu chuẩn'), ('Đoàn Văn Dương', 'Tiêu chuẩn'),
  ('Bùi Quang Chung', 'Tiêu chuẩn'), ('Bùi Thùy Linh', 'Tiêu chuẩn'), ('Nguyễn Thị Phương Thảo', 'Tiêu chuẩn'), ('Nguyễn Thành Đô', 'Tiêu chuẩn'), ('Nguyễn Thị Giang', 'Tiêu chuẩn');
create temp table op_ids on commit drop as select p.name, p.tpl, u.id from op_people p join public.users u on u.name = p.name and coalesce(u.is_active, true);
do $$ begin if (select count(*) from op_ids) <> 15 then raise exception 'OP_PEOPLE_MISMATCH: chỉ khớp % / 15 người', (select count(*) from op_ids); end if; end $$;
grant select on op_admin, op_ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from op_admin;
do $$
declare o jsonb; t jsonb; deep text;
begin
  perform public.set_ai_settings_v1(jsonb_build_object('monthlyCostCapUsd', 80, 'monthlyRunCap', 10000));
  o := public.get_ai_admin_overview_v1();
  select c->>'id' into deep from jsonb_array_elements(o->'connections') c where c->>'model' like 'deepseek%' and (c->>'enabled')::boolean limit 1;
  for t in select x from jsonb_array_elements(o->'templates') x where x->>'name' in ('Tiêu chuẩn', 'Nâng cao') loop
    perform public.ai_admin_template_save_v1(t || jsonb_build_object('extraConnectionIds', case when deep is null then '[]'::jsonb else jsonb_build_array(deep) end));
  end loop;
  perform public.ai_admin_grant_save_v1(array(select id from op_ids where tpl = 'Nâng cao'),
    jsonb_build_object('templateId', (select x->>'id' from jsonb_array_elements(o->'templates') x where x->>'name' = 'Nâng cao'), 'note', 'Thí điểm 18/10'));
  perform public.ai_admin_grant_save_v1(array(select id from op_ids where tpl = 'Tiêu chuẩn'),
    jsonb_build_object('templateId', (select x->>'id' from jsonb_array_elements(o->'templates') x where x->>'name' = 'Tiêu chuẩn'), 'note', 'Thí điểm 18/10'));
end $$;
reset role;

select (select count(*) from public.ai_user_grants g join op_ids i on i.id = g.user_id where g.enabled) as da_cap,
  (select string_agg(t.name || ':' || (select count(*) from public.ai_user_grants g where g.template_id = t.id), ', ') from public.ai_grant_templates t) as theo_mau,
  (select monthly_cost_cap_usd from public.ai_settings where id = 1) as tran_chung,
  (select count(*) from app_private.center_rollout_actors r join op_ids i on i.id = r.user_id where r.expires_at > now()) as co_trung_tam;
commit;
