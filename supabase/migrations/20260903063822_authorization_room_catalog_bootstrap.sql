-- Rehydrate schema-only preview baselines before Authorization V2 depends on
-- the Room inventory. Deliberately ordered after PERF02 and before consumers.
-- Only archived reference metadata is replayed; never domain data or grants.
-- Existing catalogs (including partial ones) are not repaired by inference.
do $bootstrap$
begin
  lock table public.project_permission_rooms,
    app_private.project_permission_room_action_bindings in share row exclusive mode;
  if exists (select 1 from public.project_permission_rooms) then
    return;
  end if;
  if exists (select 1 from auth.users)
    or exists (select 1 from public.users)
    or exists (select 1 from public.projects)
    or exists (select 1 from public.project_staff)
    or exists (select 1 from public.project_permission_room_members)
    or exists (select 1 from public.project_permission_room_member_actions)
    or exists (select 1 from app_private.project_permission_room_action_bindings) then
    raise exception 'AUTHORIZATION_BOOTSTRAP_NONEMPTY: refusing to infer missing Room metadata in a populated database';
  end if;

-- Source: 20260722021252_project_permission_rooms.sql
insert into public.project_permission_rooms (
  code, group_code, name, description, allowed_actions, required_actions, sort_order
)
values
  ('daily_log', 'daily_log', 'Nhật ký công trường', 'Lập, kiểm tra và duyệt nhật ký.', array['view','edit','delete','submit','verify','approve'], array['verify','approve'], 10),
  ('material_planning', 'material', 'Kế hoạch & BOQ vật tư', 'Quản lý kế hoạch và BOQ vật tư.', array['view','edit','delete'], array[]::text[], 20),
  ('material_request', 'material', 'Đề xuất vật tư', 'Gửi, kiểm tra, duyệt và xác nhận cấp vật tư.', array['view','edit','delete','submit','verify','confirm','approve','view_available_stock'], array['approve','confirm'], 30),
  ('material_po', 'material', 'Đơn hàng PO', 'Tạo, gửi duyệt, duyệt và xác nhận nhận hàng.', array['view','edit','delete','submit','approve','confirm'], array['approve'], 40),
  ('material_waste', 'material', 'Hao hụt vật tư', 'Ghi nhận và duyệt hao hụt.', array['view','edit','approve'], array['approve'], 50),
  ('custom_material', 'material', 'Vật tư phi tiêu chuẩn', 'Tạo, sửa và duyệt vật tư phi tiêu chuẩn.', array['view','edit','approve'], array['approve'], 60),
  ('gantt', 'progress', 'Tiến độ Gantt', 'Quản lý công việc và xác nhận hoàn thành.', array['view','edit','delete','submit','verify','approve'], array['verify','approve'], 70),
  ('weekly_progress', 'progress', 'Chốt tiến độ ngày/tuần', 'Cập nhật, duyệt và khóa kỳ tiến độ.', array['view','edit','submit','verify','approve','confirm'], array['approve'], 80),
  ('quantity_acceptance', 'finance', 'Nghiệm thu khối lượng', 'Lập và duyệt nghiệm thu khối lượng.', array['view','edit','delete','submit','verify','approve'], array['approve'], 90),
  ('payment', 'finance', 'Thanh toán', 'Lập, duyệt và xác nhận thanh toán.', array['view','edit','delete','submit','verify','approve','confirm'], array['approve','confirm'], 100),
  ('boq_reconciliation', 'finance', 'Đối soát BOQ', 'Kiểm tra, duyệt và khóa đối soát.', array['view','edit','submit','verify','approve'], array['verify'], 110),
  ('quality', 'quality', 'Hồ sơ & checklist chất lượng', 'Lập, kiểm tra và duyệt chất lượng.', array['view','edit','delete','submit','verify','approve'], array['approve'], 120),
  ('safety', 'safety', 'Hồ sơ & sự cố an toàn', 'Quản lý hồ sơ và đóng sự cố.', array['view','edit','delete','submit','verify','confirm','approve'], array['approve'], 130),
  ('subcontract', 'subcontract', 'Nghiệm thu & thanh toán nhà thầu', 'Quản lý nghiệm thu và thanh toán nhà thầu.', array['view','edit','delete','submit','approve','confirm'], array['approve'], 140)
on conflict (code) do update
set group_code = excluded.group_code,
    name = excluded.name,
    description = excluded.description,
    allowed_actions = excluded.allowed_actions,
    required_actions = excluded.required_actions,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

-- Source: 20260803081928_project_room_permission_audit_pilots.sql
insert into app_private.project_permission_room_action_bindings (
  room_code,
  action_code,
  enforcement_status,
  relationship_description,
  verified_source
)
select
  room.code,
  action.action_code,
  'audit_only',
  'Chưa xác minh đầy đủ UI, frontend capability, backend RPC/RLS và database.',
  'project_room_permission_audit_v1'
from public.project_permission_rooms room
cross join lateral unnest(room.allowed_actions) as action(action_code)
where room.is_active
on conflict (room_code, action_code) do update
set updated_at = now();

-- Daily Log pilot. edit/delete are intentionally owner-scoped; broad PBAC
-- edit_all/delete_all/return grants remain visible exceptions and are not mapped.
update app_private.project_permission_room_action_bindings
set legacy_permission_codes = case action_code
      when 'view' then array['project.daily_log.view']::text[]
      when 'edit' then array['project.daily_log.create', 'project.daily_log.edit_own']::text[]
      when 'delete' then array['project.daily_log.delete_own']::text[]
      when 'submit' then array['project.daily_log.submit']::text[]
      when 'verify' then array['project.daily_log.verify', 'project.daily_log.summarize']::text[]
      when 'approve' then array['project.daily_log.approve']::text[]
      else '{}'::text[]
    end,
    enforcement_status = 'pilot',
    relationship_description = case action_code
      when 'edit' then 'Tạo và sửa nhật ký do chính actor lập ở trạng thái draft/rejected.'
      when 'delete' then 'Xóa nhật ký do chính actor lập ở trạng thái cho phép.'
      when 'verify' then 'KTT tổng hợp, kiểm tra hoặc trả lại nhật ký đang được giao.'
      when 'approve' then 'CHT duyệt hoặc trả lại nhật ký đang được giao.'
      else 'Quyền nghiệp vụ Nhật ký công trường theo đúng project/site.'
    end,
    verified_at = now(),
    verified_source = 'daily_log_room_pilot_2026_08_03',
    updated_at = now()
where room_code = 'daily_log';

-- Material BOQ pilot. project.material_boq.edit never implies delete.
update app_private.project_permission_room_action_bindings
set legacy_permission_codes = case action_code
      when 'view' then array['project.material_boq.view']::text[]
      when 'edit' then array['project.material_boq.edit']::text[]
      when 'delete' then array['project.material_boq.delete']::text[]
      else '{}'::text[]
    end,
    enforcement_status = 'pilot',
    relationship_description = case action_code
      when 'view' then 'Xem BOQ vật tư trong project/site.'
      when 'edit' then 'Thêm và cập nhật BOQ vật tư; không bao gồm xóa.'
      when 'delete' then 'Xóa BOQ vật tư; không được suy ra từ edit.'
      else ''
    end,
    verified_at = now(),
    verified_source = 'material_boq_room_pilot_2026_08_03',
    updated_at = now()
where room_code = 'material_planning';

-- Source: 20260804080612_material_po_room_permission_pilot.sql
update app_private.project_permission_room_action_bindings
set legacy_permission_codes = case action_code
      when 'view' then array['project.material_po.view']::text[]
      when 'edit' then array['project.material_po.create']::text[]
      when 'delete' then array['project.material_po.delete']::text[]
      when 'submit' then array['project.material_po.create']::text[]
      when 'approve' then array['project.material_po.approve']::text[]
      when 'confirm' then array['project.material_po.receive']::text[]
      else '{}'::text[]
    end,
    enforcement_status = 'pilot',
    relationship_description = case action_code
      when 'view' then 'Xem PO trong đúng project/site.'
      when 'edit' then 'Tạo và sửa PO do chính actor lập ở trạng thái draft/returned.'
      when 'delete' then 'Xóa hoặc lưu trữ PO do chính actor lập.'
      when 'submit' then 'Gửi PO draft/returned do chính actor lập đến recipient Room approve.'
      when 'approve' then 'Duyệt hoặc trả lại PO sent đang được giao cho actor.'
      when 'confirm' then 'Quản lý giao nhận và đóng PO; không thay thế quyền ghi nhận tồn kho WMS.'
      else ''
    end,
    verified_at = now(),
    verified_source = 'material_po_room_pilot_2026_08_04',
    updated_at = now()
where room_code = 'material_po'
  and action_code in ('view', 'edit', 'delete', 'submit', 'approve', 'confirm');

-- Source: 20260804095711_material_po_room_authoritative_cutover.sql
update app_private.project_permission_room_action_bindings
set pbac_fallback_enabled = false,
    updated_at = now()
where room_code = 'material_po'
  and action_code in ('view', 'edit', 'delete', 'submit', 'approve', 'confirm');

-- Source: 20260805090929_material_po_allow_empty_room_configuration.sql
update public.project_permission_rooms
set required_actions = '{}'::text[],
    updated_at = now()
where code = 'material_po';

-- Source: 20260805105313_material_request_room_authoritative_cutover.sql
update app_private.project_permission_room_action_bindings
set prerequisite_action_codes = case when action_code = 'view' then '{}'::text[] else array['view']::text[] end,
    updated_at = now()
where room_code in ('material_po', 'material_request')
  and action_code in ('view', 'edit', 'delete', 'submit', 'approve', 'confirm', 'view_available_stock');

update app_private.project_permission_room_action_bindings
set legacy_permission_codes = case action_code
      when 'view' then array['project.material_request.view']::text[]
      when 'edit' then array['project.material_request.create', 'project.material_request.edit_own']::text[]
      when 'delete' then array['project.material_request.delete_own']::text[]
      when 'submit' then array['project.material_request.submit']::text[]
      when 'approve' then array['project.material_request.approve']::text[]
      when 'confirm' then array['project.material_request.confirm_fulfillment']::text[]
      when 'view_available_stock' then array['project.material_request.view_available_stock']::text[]
      else legacy_permission_codes
    end,
    enforcement_status = case when action_code = 'verify' then 'audit_only' else 'pilot' end,
    pbac_fallback_enabled = case when action_code = 'verify' then true else false end,
    relationship_description = case action_code
      when 'view' then 'Full Material Request read access in this project/site.'
      when 'edit' then 'Create and edit own draft, rejected or returned request.'
      when 'delete' then 'Delete own request while deletion is allowed.'
      when 'submit' then 'Owner starts or resubmits the request workflow.'
      when 'approve' then 'Current assignee approves, returns or rejects the workflow step.'
      when 'confirm' then 'Current fulfillment assignee plans and manages fulfillment batches.'
      when 'view_available_stock' then 'Read aggregate available stock in an allowed project/WMS warehouse.'
      else 'Reserved for a future, separately verified workflow step.'
    end,
    verified_at = now(),
    verified_source = 'material_request_room_authoritative_cutover_2026_08_05',
    updated_at = now()
where room_code = 'material_request';

update public.project_permission_rooms
set required_actions = '{}'::text[], updated_at = now()
where code = 'material_request';

-- Source: 20260808080743_weekly_progress_period_state.sql
delete from app_private.project_permission_room_action_bindings
where room_code = 'weekly_progress'
  and action_code in ('submit', 'verify', 'approve');

update public.project_permission_rooms
set description = 'Nhập liệu và chốt/mở chốt tiến độ ngày hoặc tuần.',
    allowed_actions = array['view', 'edit', 'confirm']::text[],
    required_actions = '{}'::text[],
    updated_at = now()
where code = 'weekly_progress';

insert into app_private.project_permission_room_action_bindings (
  room_code,
  action_code,
  legacy_permission_codes,
  enforcement_status,
  relationship_description,
  verified_at,
  verified_source,
  updated_at,
  pbac_fallback_enabled,
  prerequisite_action_codes
)
values
  (
    'weekly_progress', 'view', array['project.weekly_progress.view']::text[], 'pilot',
    'Xem tiến độ và trạng thái kỳ trong đúng project/site.',
    now(), 'weekly_progress_period_state_2026_08_08', now(), true, '{}'::text[]
  ),
  (
    'weekly_progress', 'edit',
    array['project.weekly_progress.create', 'project.weekly_progress.edit_all']::text[], 'pilot',
    'Nhập tiến độ ngày/tuần khi kỳ tương ứng đang mở.',
    now(), 'weekly_progress_period_state_2026_08_08', now(), true, array['view']::text[]
  ),
  (
    'weekly_progress', 'confirm', array['project.weekly_progress.lock']::text[], 'pilot',
    'Chốt hoặc mở chốt kỳ tiến độ ngày/tuần.',
    now(), 'weekly_progress_period_state_2026_08_08', now(), true, array['view']::text[]
  )
on conflict (room_code, action_code) do update
set legacy_permission_codes = excluded.legacy_permission_codes,
    enforcement_status = excluded.enforcement_status,
    relationship_description = excluded.relationship_description,
    verified_at = excluded.verified_at,
    verified_source = excluded.verified_source,
    updated_at = excluded.updated_at,
    pbac_fallback_enabled = excluded.pbac_fallback_enabled,
    prerequisite_action_codes = excluded.prerequisite_action_codes;

-- Source: 20260813070319_gantt_room_authoritative_cutover.sql
delete from app_private.project_permission_room_action_bindings
where room_code = 'gantt'
  and action_code in ('submit', 'verify', 'approve');

update public.project_permission_rooms
set description = 'Quản lý hạng mục và tiến độ thi công.',
    allowed_actions = array['view', 'edit', 'delete']::text[],
    required_actions = '{}'::text[],
    updated_at = now()
where code = 'gantt';

insert into app_private.project_permission_room_action_bindings (
  room_code, action_code, legacy_permission_codes, enforcement_status,
  relationship_description, verified_at, verified_source, updated_at,
  pbac_fallback_enabled, prerequisite_action_codes
)
values
  (
    'gantt', 'view', array['project.gantt.view']::text[], 'pilot',
    'Xem tiến độ trong đúng project/site.', now(),
    'gantt_room_authoritative_cutover_2026_08_13', now(), false, '{}'::text[]
  ),
  (
    'gantt', 'edit', array[
      'project.gantt.create_task', 'project.gantt.edit_task',
      'project.gantt.assign_task', 'project.gantt.edit'
    ]::text[], 'pilot',
    'Tạo và sửa hạng mục, baseline, delay, forecast và liên kết BOQ.', now(),
    'gantt_room_authoritative_cutover_2026_08_13', now(), false, array['view']::text[]
  ),
  (
    'gantt', 'delete', '{}'::text[], 'pilot',
    'Xóa cây hạng mục khi không có chứng từ nghiệp vụ phụ thuộc.', now(),
    'gantt_room_authoritative_cutover_2026_08_13', now(), false, array['view']::text[]
  )
on conflict (room_code, action_code) do update
set legacy_permission_codes = excluded.legacy_permission_codes,
    enforcement_status = excluded.enforcement_status,
    relationship_description = excluded.relationship_description,
    verified_at = excluded.verified_at,
    verified_source = excluded.verified_source,
    updated_at = excluded.updated_at,
    pbac_fallback_enabled = false,
    prerequisite_action_codes = excluded.prerequisite_action_codes;

-- Source: 20260816075953_quality_room_authoritative_pilot.sql
update public.project_permission_rooms
set description = 'Quản lý hồ sơ, kiểm tra và phê duyệt chất lượng theo dự án/công trường.',
    allowed_actions = array['view', 'edit', 'delete', 'submit', 'verify', 'approve']::text[],
    required_actions = array['approve']::text[],
    updated_at = now()
where code = 'quality';

insert into app_private.project_permission_room_action_bindings (
  room_code, action_code, legacy_permission_codes, enforcement_status,
  relationship_description, verified_at, verified_source, updated_at,
  pbac_fallback_enabled, prerequisite_action_codes
)
values
  ('quality', 'view', array['project.quality.view']::text[], 'pilot',
    'Xem catalog và hồ sơ chất lượng trong đúng project/site.', now(),
    'quality_room_authoritative_pilot', now(), true, '{}'::text[]),
  ('quality', 'edit', array[
      'project.quality.edit_all', 'project.quality.checklist_edit_all',
      'project.quality.manage'
    ]::text[], 'pilot',
    'Tạo và sửa mọi hồ sơ draft/returned trong đúng project/site.', now(),
    'quality_room_authoritative_pilot', now(), true, array['view']::text[]),
  ('quality', 'delete', array[
      'project.quality.delete', 'project.quality.delete_all', 'project.quality.manage'
    ]::text[], 'pilot',
    'Xóa hồ sơ draft trong đúng project/site.', now(),
    'quality_room_authoritative_pilot', now(), true, array['view']::text[]),
  ('quality', 'submit', array[
      'project.quality.submit', 'project.quality.manage'
    ]::text[], 'pilot',
    'Gửi hồ sơ cho một approver hợp lệ trong đúng project/site.', now(),
    'quality_room_authoritative_pilot', now(), true, array['view', 'edit']::text[]),
  ('quality', 'verify', array[
      'project.quality.verify', 'project.quality.manage'
    ]::text[], 'pilot',
    'Dự phòng cho bước xác minh; chưa tham gia workflow hiện tại.', now(),
    'quality_room_authoritative_pilot', now(), true, array['view']::text[]),
  ('quality', 'approve', array[
      'project.quality.approve', 'project.quality.return', 'project.quality.manage'
    ]::text[], 'pilot',
    'Phê duyệt, trả lại hoặc hủy hồ sơ trong đúng project/site.', now(),
    'quality_room_authoritative_pilot', now(), true, array['view']::text[])
on conflict (room_code, action_code) do update
set legacy_permission_codes = excluded.legacy_permission_codes,
    enforcement_status = excluded.enforcement_status,
    relationship_description = excluded.relationship_description,
    verified_at = excluded.verified_at,
    verified_source = excluded.verified_source,
    updated_at = now(),
    pbac_fallback_enabled = true,
    prerequisite_action_codes = excluded.prerequisite_action_codes;

end;
$bootstrap$;
