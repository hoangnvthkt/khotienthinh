-- Smoke Đợt 1 audit mẫu quyền (chạy trên Cloud trong giao dịch, luôn HOÀN TÁC):
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/permission_dot1_assigned_can_act_smoke.sql
-- Dùng dữ liệu thật 23/10/2026: RQ-2026-000030 (đang chờ Giang Xuân Kiên duyệt), WF-2026-304 (Phạm Đình Dương lập,
-- Nguyễn Hồng Quân theo dõi). Đặt claims sub = users.auth_id để chạy như người thật.
\set ON_ERROR_STOP 1
begin;
\ir ../migrations/20261028210000_permission_dot1_assigned_can_act.sql

create temp table smoke_people on commit drop as
select key, u.id, u.auth_id from (values
  ('kien', 'Giang Xuân Kiên'), ('thinh', 'Dương Xuân Thịnh'), ('duong', 'Phạm Đình Dương'),
  ('quan', 'Nguyễn Hồng Quân'), ('giang', 'Nguyễn Thị Giang')
) p(key, name) join public.users u on u.name = p.name and u.is_active;

create or replace function pg_temp.act_as(p_key text) returns text language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', auth_id, 'role', 'authenticated')::text, true)
  from smoke_people where key = p_key;
$$;
create or replace function pg_temp.uid(p_key text) returns uuid language sql as $$
  select id from smoke_people where key = p_key;
$$;

-- ===== Phiếu yêu cầu: được giao là duyệt được, không cần quyền =====
do $$
declare v_rq uuid; v_creator uuid;
begin
  select id, created_by into v_rq, v_creator from public.request_instances where code = 'RQ-2026-000030';
  -- Gỡ tạm mọi quyền Phiếu yêu cầu của anh Kiên để chứng minh không cần quyền riêng.
  update public.user_permission_grants set is_active = false
  where user_id = pg_temp.uid('kien') and (permission_code like 'request.%' or permission_code like 'system.rq.%');

  if not app_private.request_actor_has_lifecycle_action(v_rq, pg_temp.uid('kien'), 'APPROVE')
     or not app_private.request_actor_has_lifecycle_action(v_rq, pg_temp.uid('kien'), 'REJECT')
     or not app_private.request_actor_has_lifecycle_action(v_rq, pg_temp.uid('kien'), 'RETURN') then
    raise exception 'SMOKE: người giữ bước chờ duyệt phải duyệt/từ chối/trả lại được';
  end if;
  if app_private.request_actor_has_lifecycle_action(v_rq, pg_temp.uid('duong'), 'APPROVE') then
    raise exception 'SMOKE: người không được giao không được duyệt';
  end if;
  if not app_private.request_actor_has_lifecycle_action(v_rq, v_creator, 'RESUBMIT')
     or not app_private.request_actor_has_lifecycle_action(v_rq, v_creator, 'CANCEL')
     or app_private.request_actor_has_lifecycle_action(v_rq, pg_temp.uid('kien'), 'RESUBMIT') then
    raise exception 'SMOKE: chỉ người lập gửi lại / hủy phiếu của mình';
  end if;
  raise notice 'OK phiếu yêu cầu: được giao duyệt được, người khác bị chặn, người lập gửi lại/hủy được';
end $$;

-- Qua trigger thật: anh Kiên (không còn quyền) bấm Duyệt bước của mình.
select pg_temp.act_as('kien');
do $$
declare v_subject uuid; v_rows int;
begin
  select workflow_subject_id into v_subject from public.request_instances where code = 'RQ-2026-000030';
  update public.workflow_step_assignments set status = 'APPROVED'
  where workflow_subject_id = v_subject and assignee_user_id = pg_temp.uid('kien') and status = 'PENDING';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'SMOKE: không cập nhật được bước của anh Kiên (%)', v_rows; end if;
  raise notice 'OK trigger: anh Kiên duyệt bước được giao dù không có quyền Phiếu yêu cầu';
end $$;

select pg_temp.act_as('duong');
do $$
declare v_subject uuid;
begin
  select workflow_subject_id into v_subject from public.request_instances where code = 'RQ-2026-000030';
  begin
    update public.workflow_step_assignments set status = 'APPROVED'
    where workflow_subject_id = v_subject and assignee_user_id = pg_temp.uid('thinh') and status = 'PENDING';
    raise exception 'SMOKE: người khác duyệt thay được bước của anh Thịnh';
  exception when insufficient_privilege then
    raise notice 'OK trigger: người không được giao bị chặn (REQUEST_ACTION_FORBIDDEN)';
  end;
end $$;

-- ===== Quy trình: theo dõi =====
select pg_temp.act_as('duong');
do $$
declare v_wf uuid; v_watchers uuid[];
begin
  select id, array(select w::uuid from unnest(watchers) w) into v_wf, v_watchers
  from public.workflow_instances where code = 'WF-2026-304';
  perform public.update_workflow_instance_watchers(v_wf, v_watchers || pg_temp.uid('giang'), gen_random_uuid());
  if not exists (select 1 from public.workflow_instances where id = v_wf and pg_temp.uid('giang')::text = any(watchers)) then
    raise exception 'SMOKE: người lập chưa thêm được người theo dõi';
  end if;
  begin
    perform public.update_workflow_instance_watchers(v_wf, array_remove(v_watchers, pg_temp.uid('quan')) || pg_temp.uid('giang'), gen_random_uuid());
    raise exception 'SMOKE: người lập gỡ được người theo dõi khác';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK quy trình: người lập thêm được người theo dõi, không gỡ được người khác';
end $$;

select pg_temp.act_as('quan');
do $$
declare v_wf uuid; v_watchers uuid[];
begin
  select id, array(select w::uuid from unnest(watchers) w) into v_wf, v_watchers
  from public.workflow_instances where code = 'WF-2026-304';
  begin
    perform public.update_workflow_instance_watchers(v_wf, v_watchers || pg_temp.uid('kien'), gen_random_uuid());
    raise exception 'SMOKE: người chỉ theo dõi thêm được người khác';
  exception when insufficient_privilege then null;
  end;
  perform public.update_workflow_instance_watchers(v_wf, array_remove(v_watchers, pg_temp.uid('quan')), gen_random_uuid());
  if exists (select 1 from public.workflow_instances where id = v_wf and pg_temp.uid('quan')::text = any(watchers)) then
    raise exception 'SMOKE: người theo dõi chưa tự bỏ theo dõi được';
  end if;
  raise notice 'OK quy trình: người chỉ theo dõi không thêm người khác, tự bỏ theo dõi được';
end $$;

-- ===== Quy trình: hủy phiếu của mình =====
select pg_temp.act_as('quan');
do $$
declare v_wf uuid;
begin
  select id into v_wf from public.workflow_instances where code = 'WF-2026-304';
  begin
    perform public.cancel_workflow_instance(v_wf, 'smoke', gen_random_uuid());
    raise exception 'SMOKE: người không lập hủy được phiếu';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK quy trình: người không lập không hủy được';
end $$;

select pg_temp.act_as('duong');
do $$
declare v_wf uuid;
begin
  select id into v_wf from public.workflow_instances where code = 'WF-2026-304';
  perform public.cancel_workflow_instance(v_wf, 'smoke', gen_random_uuid());
  if (select status from public.workflow_instances where id = v_wf) <> 'CANCELLED' then
    raise exception 'SMOKE: người lập chưa hủy được phiếu của mình';
  end if;
  raise notice 'OK quy trình: người lập hủy được phiếu đang chạy của mình';
end $$;

-- ===== Quyền được giao không hết hạn =====
do $$ begin
  if exists (select 1 from public.permission_actions
             where permission_code in ('request.instance.approve_assigned', 'request.instance.reject_assigned')
               and direct_grant_requires_expiry) then
    raise exception 'SMOKE: quyền được giao vẫn bắt buộc hạn';
  end if;
  if exists (select 1 from public.user_permission_grants
             where permission_code in ('request.instance.approve_assigned', 'request.instance.reject_assigned')
               and is_active and expires_at is not null) then
    raise exception 'SMOKE: còn quyền được giao có hạn';
  end if;
  raise notice 'OK: quyền Duyệt / Từ chối yêu cầu được giao không còn hạn';
end $$;

rollback;
\echo 'SMOKE ĐẠT — đã hoàn tác, Cloud không đổi'
