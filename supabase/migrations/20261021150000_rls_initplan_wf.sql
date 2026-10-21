-- Hiệu năng RLS module Quy trình (audit 20/10/2026, mục H1, PR-2 sau Kho #267): hàm quyền gọi theo TỪNG DÒNG.
--
-- Policy SELECT của workflow_instances gọi app_private.workflow_instance_actor_can_select(id) cho mỗi phiếu quét;
-- với phiếu không có subject, hàm này gọi has_permission(view toàn cục) + has_permission(administer toàn cục)
-- (≈12 ms, chỉ phụ thuộc NGƯỜI DÙNG) rồi mới tới phần phụ thuộc dòng (người theo dõi ≈2 ms). Đo với nhân viên
-- thường: 50 phiếu mới nhất 2,3 s (quét 270 phiếu), danh sách mẫu 0,4 s (65 mẫu × 8,5 ms), nodes/edges 2 s.
--
-- Cách sửa (mẫu #267): tính MỘT LẦN mỗi câu lệnh (InitPlan)
--   * cờ của người dùng: admin / quản trị WF / xem-quản trị phiếu toàn cục / quyền xem mẫu (global, own, assigned);
--   * tập subject nhìn thấy (project_workflow_actor_can_select theo tập hợp);
--   * tập phiếu nhìn thấy = phiếu có subject nhìn thấy ∪ phiếu không subject mà (cờ toàn cục ∨ quản lý/giám sát
--     của mẫu ∨ đang theo dõi theo workflow_instance_user_follows viết dạng tập hợp);
--   * tập mẫu nhìn thấy (workflow_template_actor_can_view theo tập hợp).
-- Policy chỉ còn `cột = any((select hàm()))`: một InitPlan, không gọi hàm theo dòng.
--
-- Giữ đúng nghĩa cũ (chứng minh + kiểm hồi quy ở docs/performance/rls-initplan-wf-2026-10.md):
--   * project_workflow_actor_can_select(subject): subject material_request ⇔ dòng requests nhìn thấy theo
--     material_request_can_select_v2 (= biểu thức requests_select sau #267); subject khác ⇔ tôi là participant
--     active của subject (workflow_subject_can_select chỉ đúng với material_request nên không góp thêm).
--   * workflow_instance_user_can_select: has_permission(view|administer, global) ∨ managers/default_watchers
--     của mẫu chứa tôi ∨ workflow_instance_user_follows — viết lại theo tập participant của tôi, giữ nguyên
--     từng điều kiện (vai ≠ ASSIGNEE, handlers_follow_after_step, tới lượt ở bước hiện tại, chưa xử lý bước nào).
--   * workflow_template_actor_can_view: is_admin ∨ workflow_has_action(template.view, created_by) [= global
--     ∨ (created_by = tôi ∧ own) ∨ is_module_admin('WF')] ∨ (tôi ∈ managers ∧ assigned) ∨ mẫu có phiếu có subject
--     nhìn thấy ∨ quyền phòng material_request.view của dự án chủ mẫu ∨ tôi là participant active của phiếu
--     thuộc mẫu. has_permission(mã, 'own'|'assigned', tôi) ⇔ nguồn global hoặc nguồn cùng loại với id '*'/tôi
--     (scope_covers), tức token 'global:*' hoặc 'own:*' / 'assigned:*' (permission_source_token).
--   * Policy INSERT/UPDATE/DELETE, chốt RESTRICTIVE active_actor_gate, wf_logs_select (đi qua RLS của
--     workflow_instances) và workflow_print_templates không đổi.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Cờ của người đang đăng nhập (một lần mỗi câu lệnh).
--    'admin'        = public.is_admin()
--    'wf_admin'     = public.is_module_admin('WF')  (ADMIN có auth_id khớp, hoặc system.wf.manage toàn cục)
--    'inst_view'    = has_permission(workflow.instance.view, global)
--    'inst_admin'   = has_permission(workflow.instance.administer, global)
--    'tpl_view:<token>' = token nguồn quyền workflow.template.view ('global:*', 'own:*', 'assigned:*')
create or replace function app_private.workflow_actor_flags()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with me as materialized (
    select u.id, u.role, u.auth_id = (select auth.uid()) as auth_matches
    from public.users u
    where u.id = public.current_app_user_id()
  ),
  sources as materialized (
    select source.permission_code, source.scope_type, source.scope_id
    from me
    cross join app_private.resolve_effective_permission_sources(me.id, null, null, null, now()) source
    where source.permission_code in (
      'system.wf.manage', 'workflow.instance.view', 'workflow.instance.administer', 'workflow.template.view'
    )
  ),
  flags as (
    select 'admin' as flag from me where me.role = 'ADMIN'
    union all
    select 'wf_admin'
    from me
    where me.auth_matches
      and (
        me.role = 'ADMIN'
        or exists (
          select 1 from sources where sources.permission_code = 'system.wf.manage' and sources.scope_type = 'global'
        )
      )
    union all
    select 'inst_view'
    from sources
    where sources.permission_code = 'workflow.instance.view' and sources.scope_type = 'global'
    union all
    select 'inst_admin'
    from sources
    where sources.permission_code = 'workflow.instance.administer' and sources.scope_type = 'global'
    union all
    select 'tpl_view:' || app_private.permission_source_token(sources.scope_type, sources.scope_id, me.id)
    from me, sources
    where sources.permission_code = 'workflow.template.view'
      and app_private.permission_source_token(sources.scope_type, sources.scope_id, me.id) is not null
  )
  select coalesce(array_agg(distinct flag), '{}'::text[]) from flags;
$$;

-- 2. Subject nhìn thấy (nghĩa project_workflow_actor_can_select) — một lần mỗi câu lệnh.
create or replace function app_private.workflow_visible_subject_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with me as materialized (select public.current_app_user_id() as id),
  -- dòng requests nhìn thấy theo material_request_can_select_v2 (biểu thức requests_select sau #267)
  visible_requests as materialized (
    select request.id
    from public.requests request
    where exists (
        select 1 from public.workflow_subjects ws
        where ws.subject_type = 'material_request' and ws.subject_id = request.id
      )
      and case when coalesce(request.request_origin, 'wms') = 'project' then
        request.project_id is not null
        and (
          app_private.rls_scope_key(request.project_id, request.construction_site_id)
            = any ((select app_private.material_request_view_scope_keys(true))::text[])
          or (
            not (
              app_private.rls_scope_key(request.project_id, request.construction_site_id)
                = any ((select app_private.material_request_view_scope_keys(false))::text[])
            )
            and app_private.current_actor_has_effective_room_action(
              request.project_id, request.construction_site_id, 'material_request', 'view'
            )
          )
        )
      else
        (select app_private.wms_action_scope_tokens(array['wms.request.view'])) && array[
          'global:*',
          case when request.source_warehouse_id is not null or request.site_warehouse_id is not null then 'warehouse:*' end,
          'warehouse:' || request.source_warehouse_id,
          'warehouse:' || request.site_warehouse_id,
          case when request.requester_id = (select me.id from me) then 'own:*' end,
          case when nullif(request.submitted_to_user_id, '')::uuid = (select me.id from me) then 'assigned:*' end
        ]
        or request.requester_id = (select me.id from me)
        or (
          request.submitted_to_user_id is not null
          and request.submitted_to_user_id = (select me.id from me)::text
        )
      end
  )
  select coalesce(array_agg(ws.id), '{}'::uuid[])
  from public.workflow_subjects ws
  where (select me.id from me) is not null
    and case when ws.subject_type = 'material_request' then
      exists (select 1 from visible_requests vr where vr.id = ws.subject_id)
    else
      exists (
        select 1 from public.workflow_participants participant
        where participant.workflow_subject_id = ws.id
          and participant.user_id = (select me.id from me)
          and coalesce(participant.is_active, true)
      )
    end;
$$;

-- 3. Phiếu có subject nhìn thấy (một phiếu có nhiều subject: thấy nếu có subject nào nhìn thấy).
create or replace function app_private.workflow_subject_visible_instance_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct ws.workflow_instance_id), '{}'::uuid[])
  from public.workflow_subjects ws
  where ws.workflow_instance_id is not null
    and ws.id = any ((select app_private.workflow_visible_subject_ids())::uuid[]);
$$;

-- 4. Phiếu nhìn thấy (nghĩa workflow_instance_actor_can_select).
create or replace function app_private.workflow_visible_instance_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with me as materialized (select public.current_app_user_id() as id),
  flags as materialized (select app_private.workflow_actor_flags() as flags),
  -- workflow_instance_user_follows viết theo tập participant active của tôi
  followed as materialized (
    select instance_row.id
    from public.workflow_instance_participants participant_row
    join public.workflow_instances instance_row on instance_row.id = participant_row.instance_id
    left join public.workflow_templates template_row on template_row.id = instance_row.template_id
    left join public.workflow_nodes node_row on node_row.id = instance_row.current_node_id
    where participant_row.user_id = (select me.id from me)
      and participant_row.ended_at is null
      and (
        participant_row.participant_role <> 'ASSIGNEE'
        or coalesce(template_row.handlers_follow_after_step, true)
        or (
          instance_row.status = 'RUNNING'
          and (
            instance_row.step_assignees ->> instance_row.current_node_id::text = (select me.id from me)::text
            or coalesce(instance_row.step_assignees -> instance_row.current_node_id::text, '[]'::jsonb) ? (select me.id from me)::text
            or node_row.config ->> 'assigneeUserId' = (select me.id from me)::text
          )
        )
        or not exists (
          select 1 from public.workflow_instance_logs log_row
          where log_row.instance_id = instance_row.id
            and log_row.acted_by = (select me.id from me)
            and log_row.action in ('APPROVED', 'REJECTED', 'REVISION_REQUESTED')
        )
      )
  ),
  plain as (
    select instance_row.id
    from public.workflow_instances instance_row
    left join public.workflow_templates template_row on template_row.id = instance_row.template_id
    where (select me.id from me) is not null
      and not exists (
        select 1 from public.workflow_subjects subject_row
        where subject_row.workflow_instance_id = instance_row.id
      )
      and (
        (select flags.flags from flags) && array['admin', 'wf_admin', 'inst_view', 'inst_admin']
        or coalesce(template_row.managers, '{}'::text[]) @> array[(select me.id from me)::text]
        or coalesce(template_row.default_watchers, '{}'::text[]) @> array[(select me.id from me)::text]
        or instance_row.id in (select followed.id from followed)
      )
  )
  select coalesce(array_agg(id), '{}'::uuid[])
  from (
    select unnest(app_private.workflow_subject_visible_instance_ids()) as id
    union
    select plain.id from plain
  ) visible;
$$;

-- 5. Mẫu nhìn thấy (nghĩa workflow_template_actor_can_view(id, current_app_user_id())).
create or replace function app_private.workflow_visible_template_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with me as materialized (select public.current_app_user_id() as id),
  flags as materialized (select app_private.workflow_actor_flags() as flags),
  subject_instances as materialized (select unnest(app_private.workflow_subject_visible_instance_ids()) as id),
  -- dự án chủ mẫu (owner_subject_type material_request) mà tôi có quyền phòng material_request.view
  owner_projects as materialized (
    select distinct template_row.owner_project_id
    from public.workflow_templates template_row
    where template_row.owner_subject_type = 'material_request'
      and template_row.owner_project_id is not null
      and (select me.id from me) is not null
      and app_private.project_actor_has_effective_room_action(
        (select me.id from me), template_row.owner_project_id, null, 'material_request', 'view'
      )
  )
  select coalesce(array_agg(template_row.id), '{}'::uuid[])
  from public.workflow_templates template_row
  where (select me.id from me) is not null
    and (
      (select flags.flags from flags) && array['admin', 'wf_admin', 'tpl_view:global:*']
      or (
        template_row.created_by = (select me.id from me)
        and (select flags.flags from flags) && array['tpl_view:own:*']
      )
      or (
        (select me.id from me)::text = any (coalesce(template_row.managers, '{}'::text[]))
        and (select flags.flags from flags) && array['tpl_view:assigned:*']
      )
      or exists (
        select 1 from public.workflow_instances instance_row
        where instance_row.template_id = template_row.id
          and instance_row.id in (select subject_instances.id from subject_instances)
      )
      or template_row.owner_project_id in (select owner_projects.owner_project_id from owner_projects)
      or exists (
        select 1
        from public.workflow_instances instance_row
        join public.workflow_instance_participants participant_row
          on participant_row.instance_id = instance_row.id
         and participant_row.user_id = (select me.id from me)
         and participant_row.ended_at is null
        where instance_row.template_id = template_row.id
      )
    );
$$;

revoke all on function app_private.workflow_actor_flags() from public, anon;
revoke all on function app_private.workflow_visible_subject_ids() from public, anon;
revoke all on function app_private.workflow_subject_visible_instance_ids() from public, anon;
revoke all on function app_private.workflow_visible_instance_ids() from public, anon;
revoke all on function app_private.workflow_visible_template_ids() from public, anon;
grant execute on function app_private.workflow_actor_flags() to authenticated;
grant execute on function app_private.workflow_visible_subject_ids() to authenticated;
grant execute on function app_private.workflow_subject_visible_instance_ids() to authenticated;
grant execute on function app_private.workflow_visible_instance_ids() to authenticated;
grant execute on function app_private.workflow_visible_template_ids() to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Phiếu và các bảng theo phiếu.
alter policy workflow_instances_select on public.workflow_instances
using (id = any ((select app_private.workflow_visible_instance_ids())::uuid[]));

alter policy workflow_instance_comments_select on public.workflow_instance_comments
using (instance_id = any ((select app_private.workflow_visible_instance_ids())::uuid[]));

-- Policy ALL: USING cũng là WITH CHECK (giữ nguyên nghĩa cũ: mọi lệnh đều cần nhìn thấy phiếu).
alter policy workflow_step_tasks_instance_access on public.workflow_step_tasks
using (instance_id = any ((select app_private.workflow_visible_instance_ids())::uuid[]))
with check (instance_id = any ((select app_private.workflow_visible_instance_ids())::uuid[]));

-- Subject và các bảng theo subject.
alter policy workflow_subjects_select on public.workflow_subjects
using (id = any ((select app_private.workflow_visible_subject_ids())::uuid[]));

alter policy workflow_participants_select on public.workflow_participants
using (workflow_subject_id = any ((select app_private.workflow_visible_subject_ids())::uuid[]));

alter policy workflow_step_assignments_select on public.workflow_step_assignments
using (workflow_subject_id = any ((select app_private.workflow_visible_subject_ids())::uuid[]));

alter policy workflow_sla_notifications_select on public.workflow_sla_notifications
using (workflow_subject_id = any ((select app_private.workflow_visible_subject_ids())::uuid[]));

alter policy workflow_subject_comments_select on public.workflow_subject_comments
using (workflow_subject_id = any ((select app_private.workflow_visible_subject_ids())::uuid[]));

alter policy workflow_instance_nodes_select on public.workflow_instance_nodes
using (workflow_instance_id = any ((select app_private.workflow_subject_visible_instance_ids())::uuid[]));

alter policy workflow_instance_edges_select on public.workflow_instance_edges
using (workflow_instance_id = any ((select app_private.workflow_subject_visible_instance_ids())::uuid[]));

-- Phiên bản mẫu: cũ = is_admin ∨ is_module_admin('WF') ∨ có subject nhìn thấy dùng phiên bản này.
alter policy workflow_template_versions_select on public.workflow_template_versions
using (
  (select app_private.workflow_actor_flags()) && array['admin', 'wf_admin']
  or exists (
    select 1 from public.workflow_subjects ws
    where ws.template_version_id = workflow_template_versions.id
      and ws.id = any ((select app_private.workflow_visible_subject_ids())::uuid[])
  )
);

-- Mẫu, node, cạnh.
alter policy workflow_templates_select on public.workflow_templates
using (id = any ((select app_private.workflow_visible_template_ids())::uuid[]));

alter policy workflow_nodes_select on public.workflow_nodes
using (template_id = any ((select app_private.workflow_visible_template_ids())::uuid[]));

alter policy workflow_edges_select on public.workflow_edges
using (template_id = any ((select app_private.workflow_visible_template_ids())::uuid[]));
