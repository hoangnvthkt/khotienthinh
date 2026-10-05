-- ===========================================================================
-- Xuất bản Module Tài chính — P2 (05/10/2026): tách hẳn Tài chính khỏi Module Dự án
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/14-xuat-ban-module-tai-chinh.md (chủ SP duyệt câu 2: bỏ tab Tài chính,
-- Điều hành giữ 1 thẻ tóm tắt cho người có quyền xem tài chính dự án).
-- Hàm nhẹ cho thẻ tóm tắt: người không được xem thì trả null (thẻ tự ẩn, không báo lỗi trên màn Dự án).
-- ===========================================================================
create function public.get_finance_project_summary_v1(p_project_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_p public.projects%rowtype; cs jsonb; f jsonb; m record; ap record;
begin
  select * into v_p from public.projects where id = p_project_id;
  if not found or not app_private.finance_project_visible(v_p.id) then return null; end if;
  cs := app_private.finance_project_cost_summary(v_p.id);
  f := app_private.finance_project_fund(v_p.id);
  select coalesce(sum((x.m->>'gross')::numeric), 0) gross, coalesce(sum((x.m->>'received')::numeric), 0) received,
    coalesce(sum((x.m->>'outstanding')::numeric), 0) outstanding, coalesce(sum((x.m->>'overdue')::numeric), 0) overdue,
    sum((x.m->>'estOutput')::numeric / (1 + x.vat / 100)) est_net, bool_or(x.m->>'opening' = 'todo') opening_todo, count(*) n
    into m
  from (select app_private.finance_customer_contract_metrics(c.id) m, coalesce(c.vat_percent, 0) vat from public.customer_contracts c
    where c.project_id = v_p.id and coalesce(c.status, '') not in ('cancelled', 'draft')) x;
  select coalesce(sum(x.outstanding), 0) payable, coalesce(sum(x.outstanding) filter (where x.due_date < v_today), 0) overdue into ap
  from app_private.finance_payable_rows() x where x.project_id = v_p.id and x.outstanding > 0.5 and not x.internal;
  return jsonb_build_object('projectId', v_p.id, 'code', v_p.code, 'contracts', m.n, 'progress', cs->'progress',
    'contractGross', m.gross, 'received', m.received, 'receivable', m.outstanding, 'receivableOverdue', m.overdue, 'openingTodo', coalesce(m.opening_todo, false),
    'cost', cs->'actual', 'committed', cs->'committed', 'eac', cs->'eac', 'overItems', cs->'overItems',
    'margin', case when m.est_net is not null then round(m.est_net - (cs->>'actual')::numeric, 2) end,
    'payable', ap.payable, 'payableOverdue', ap.overdue, 'fundBalance', f->'balance');
end $$;
revoke all on function public.get_finance_project_summary_v1(text) from public, anon;
grant execute on function public.get_finance_project_summary_v1(text) to authenticated;
