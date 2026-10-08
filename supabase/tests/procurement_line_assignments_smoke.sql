-- Giao việc theo dòng (Mua hàng). Chạy trong transaction rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261009123000_procurement_line_assignments.sql \
--   --smoke supabase/tests/procurement_line_assignments_smoke.sql
-- Dùng 2 người có quyền Mua hàng — Quản trị và một phiếu đề xuất công trường còn mở có >= 2 dòng.
do $$
declare
  v_a record; v_b record; v_doc record; v_lines text[]; v_r jsonb; v_list jsonb; v_get jsonb; v_failed boolean;
begin
  select u.id, u.auth_id into v_a from public.users u where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null and u.role <> 'ADMIN'
    and app_private.has_permission(u.id, 'system.procurement.manage') order by u.id limit 1;
  select u.id, u.auth_id into v_b from public.users u where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null and u.role <> 'ADMIN'
    and app_private.has_permission(u.id, 'system.procurement.manage') and u.id <> v_a.id order by u.id limit 1;
  if v_b.id is null then raise exception 'SMOKE_SETUP: cần 2 người có quyền Mua hàng — Quản trị'; end if;
  select l.source_type, l.source_id, array_agg(l.line_id order by l.line_id) lines into v_doc
  from app_private.procurement_inbox_lines() l
  where l.source_type = 'material_request' and l.ordered_qty < l.need_qty
    and not exists (select 1 from public.procurement_need_closures c where c.source_type = l.source_type and c.source_id = l.source_id)
  group by 1, 2 having count(*) >= 2 limit 1;
  if v_doc.source_id is null then raise exception 'SMOKE_SETUP: không có phiếu mở >= 2 dòng'; end if;
  v_lines := v_doc.lines;
  delete from public.procurement_inbox_line_assignments where source_type = v_doc.source_type and source_id = v_doc.source_id;

  -- A điều phối cả phiếu.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a.auth_id, 'role', 'authenticated')::text, true);
  perform public.assign_procurement_inbox_v1(jsonb_build_object('sources', jsonb_build_array(jsonb_build_object('sourceType', v_doc.source_type, 'sourceId', v_doc.source_id)), 'assigneeUserId', v_a.id));

  -- A giao dòng 1 cho B.
  v_r := public.assign_procurement_inbox_lines_v1(jsonb_build_object('sourceType', v_doc.source_type, 'sourceId', v_doc.source_id,
    'lineIds', jsonb_build_array(v_lines[1]), 'assigneeUserId', v_b.id));
  if (v_r->>'assigned')::int <> 1 then raise exception 'FAIL assign: %', v_r; end if;
  if not exists (select 1 from public.notifications n where n.user_id = v_b.id::text and n.source_id like 'procurement_assign_lines:%' and n.created_at >= now()) then
    raise exception 'FAIL: B chưa được thông báo'; end if;

  v_get := public.get_procurement_inbox_document_v1(v_doc.source_type, v_doc.source_id);
  if (select count(*) from jsonb_array_elements(v_get->'lines') x where x->>'lineId' = v_lines[1] and x->>'assigneeUserId' = v_b.id::text) <> 1 then
    raise exception 'FAIL get: dòng 1 chưa ghi B'; end if;
  if (select count(*) from jsonb_array_elements(v_get->'lines') x where x->>'lineId' = v_lines[2] and x->>'assigneeUserId' is null) <> 1 then
    raise exception 'FAIL get: dòng 2 phải theo điều phối'; end if;

  -- Việc của B: thấy phiếu; danh sách tóm tắt có cả A và B.
  v_list := public.list_procurement_inbox_v1(jsonb_build_object('assigneeId', v_b.id::text, 'progress', 'all'));
  if not exists (select 1 from jsonb_array_elements(v_list->'documents') d where d->>'sourceId' = v_doc.source_id
      and (d->>'splitByLine')::boolean and jsonb_array_length(d->'lineAssignees') = 2 and (d->>'unassignedOpenLines')::int = 0) then
    raise exception 'FAIL list B: %', (select d from jsonb_array_elements(v_list->'documents') d where d->>'sourceId' = v_doc.source_id); end if;

  -- B nhận lại dòng của mình được; A nhận dòng đã của B thì bị từ chối.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_b.auth_id, 'role', 'authenticated')::text, true);
  perform public.assign_procurement_inbox_lines_v1(jsonb_build_object('sourceType', v_doc.source_type, 'sourceId', v_doc.source_id, 'lineIds', jsonb_build_array(v_lines[1]), 'claim', true));
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a.auth_id, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform public.assign_procurement_inbox_lines_v1(jsonb_build_object('sourceType', v_doc.source_type, 'sourceId', v_doc.source_id, 'lineIds', jsonb_build_array(v_lines[1]), 'claim', true));
  exception when others then v_failed := sqlerrm = 'PROCUREMENT_LINE_TAKEN'; end;
  if not v_failed then raise exception 'FAIL: A nhận được dòng của B'; end if;

  -- Dòng lạ bị từ chối.
  v_failed := false;
  begin
    perform public.assign_procurement_inbox_lines_v1(jsonb_build_object('sourceType', v_doc.source_type, 'sourceId', v_doc.source_id, 'lineIds', jsonb_build_array('khong-co-dong-nay'), 'assigneeUserId', v_b.id));
  exception when others then v_failed := sqlerrm = 'PROCUREMENT_LINE_NOT_FOUND'; end;
  if not v_failed then raise exception 'FAIL: dòng lạ được giao'; end if;

  -- Trả dòng 1 về điều phối: phiếu không còn chia dòng.
  perform public.assign_procurement_inbox_lines_v1(jsonb_build_object('sourceType', v_doc.source_type, 'sourceId', v_doc.source_id, 'lineIds', jsonb_build_array(v_lines[1]), 'assigneeUserId', null));
  v_list := public.list_procurement_inbox_v1(jsonb_build_object('assigneeId', v_b.id::text, 'progress', 'all'));
  if exists (select 1 from jsonb_array_elements(v_list->'documents') d where d->>'sourceId' = v_doc.source_id) then
    raise exception 'FAIL: B vẫn thấy phiếu sau khi trả dòng'; end if;

  -- Bỏ điều phối: phiếu thành "Chưa giao".
  perform public.assign_procurement_inbox_v1(jsonb_build_object('sources', jsonb_build_array(jsonb_build_object('sourceType', v_doc.source_type, 'sourceId', v_doc.source_id)), 'assigneeUserId', null));
  v_list := public.list_procurement_inbox_v1(jsonb_build_object('assigneeId', 'none'));
  if not exists (select 1 from jsonb_array_elements(v_list->'documents') d where d->>'sourceId' = v_doc.source_id and (d->>'unassignedOpenLines')::int >= 2) then
    raise exception 'FAIL: phiếu chưa giao không hiện ở bộ lọc Chưa giao'; end if;

  raise notice 'procurement line assignment smoke OK (%: % dòng)', v_doc.source_id, cardinality(v_lines);
end $$;
