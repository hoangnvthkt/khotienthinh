-- Kiểm soát viên — dải cảnh báo ngay trên chứng từ (chủ SP 24/10, mục 9): mở đơn mua / đề xuất là thấy lệch đang mở của chứng từ đó,
-- cách sửa và nút Chấp nhận (người có quyền). Cùng quyền xem với Lệch cần sửa (control_can_view): Admin thấy hết, người xử lý /
-- trưởng bộ phận thấy lệch của mình ở luật đã bật "Báo người xử lý".
create or replace function public.control_findings_for_doc_v1(p_po_id text default null, p_request_id text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if public.current_app_user_id() is null then raise exception 'CONTROL_LOGIN_REQUIRED' using errcode = '42501'; end if;
  if nullif(p_po_id, '') is null and nullif(p_request_id, '') is null then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(x order by x->>'severity', (x->>'happenedOn') desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object('id', f.id, 'rule', f.rule_code, 'ruleTitle', r.title, 'module', r.module, 'severity', r.severity, 'ownerHint', r.owner_hint,
      'fixHint', r.fix_hint, 'objectType', f.object_type, 'objectId', f.object_id, 'objectCode', f.object_code, 'projectId', f.project_id,
      'title', f.title, 'detail', f.detail, 'amount', f.amount, 'happenedOn', f.happened_on, 'link', f.link, 'legacy', f.legacy, 'status', f.status,
      'firstSeenAt', f.first_seen_at, 'lastSeenAt', f.last_seen_at,
      'assignees', (select coalesce(jsonb_agg(u.name order by u.name), '[]'::jsonb) from public.users u where u.id = any(f.assignee_ids)),
      'canAccept', app_private.control_can_accept(f), 'escalated', f.first_seen_at < now() - interval '3 days') x
    from public.control_findings f join public.control_rules r on r.code = f.rule_code
    where f.status = 'open'
      and ((nullif(p_po_id, '') is not null and f.link = '/procurement?po=' || p_po_id)
        or (nullif(p_request_id, '') is not null and f.object_type = 'material_request' and f.object_id = p_request_id))
      and app_private.control_can_view(f)
    order by case r.severity when 'P0' then 0 when 'P1' then 1 else 2 end
    limit 20) s);
end $$;
revoke all on function public.control_findings_for_doc_v1(text, text) from public, anon;
grant execute on function public.control_findings_for_doc_v1(text, text) to authenticated;
