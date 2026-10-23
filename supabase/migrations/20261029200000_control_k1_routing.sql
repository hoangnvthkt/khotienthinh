-- Kiểm soát viên K1 (chủ SP chốt 5 câu 23/10/2026): đưa lệch tới đúng người.
--   (1) Người xử lý theo khâu: Mua hàng → người lập đơn (đề xuất chưa có đơn → người được giao dòng ở hộp thư Mua hàng); Kho → thủ kho
--       của kho; Công nợ → người có quyền Tài chính · Ghi nhận / Xác nhận; không xác định được → Admin.
--       Trưởng bộ phận = quản lý trực tiếp của người xử lý (sơ đồ tổ chức); không có → người Quản trị phân hệ.
--   (2) Chỉ lệch từ ngày luật tính (since_date 01/10) mới giao; dữ liệu cũ Admin dọn một lần ở tab Kiểm soát.
--   (3) Luật đã bật "Báo người xử lý" (mode live): P0 đẩy thông báo ngay cho người xử lý + Admin (một lần); mọi lệch hiện ở Việc của tôi
--       (nguồn 'control') và bản tin 07:00 hằng ngày (một thông báo gộp mỗi người) — không gửi từng lệch. Quá 3 ngày → trưởng bộ phận.
--   (5) Chấp nhận lệch: trưởng bộ phận của lệch, người Quản trị phân hệ, Admin; lý do lưu vĩnh viễn (audit_trail).
-- Người xử lý xem lệch của mình ở /kiem-soat (cùng màn tab Kiểm soát, chỉ lệch của mình). Luật mặc định vẫn chạy thử (shadow) — Admin bật từng luật.

alter table public.control_rules add column if not exists route text[] not null default '{}';
alter table public.control_rules add column if not exists module_key text;
update public.control_rules set module_key = case module when 'Kho' then 'WMS' when 'Công nợ' then 'FINANCE' else 'PROCUREMENT' end;
update public.control_rules r set route = x.route from (values
  ('po_total_mismatch', '{buyer}'::text[]), ('po_received_mismatch', '{buyer,warehouse}'), ('batch_wms_status', '{warehouse,buyer}'),
  ('ledger_vs_accepted', '{warehouse}'), ('ap_vs_accepted', '{payable}'), ('accepted_value_calc', '{payable}'), ('ap_without_receipt', '{payable}'),
  ('receipt_without_ap', '{payable}'), ('batch_vat_differs', '{payable}'), ('statement_price_no_reason', '{payable}'), ('return_no_resolution', '{buyer}'),
  ('return_over_received', '{warehouse,buyer}'), ('ledger_double_post', '{warehouse}'), ('mr_completed_short', '{buyer}'), ('mr_ended_po_open', '{buyer}'),
  ('order_over_need', '{buyer}'), ('received_over', '{buyer,warehouse}'), ('batch_quality_stuck', '{warehouse}')) x(code, route)
where r.code = x.code;

alter table public.control_findings add column if not exists assignee_ids uuid[] not null default '{}';
alter table public.control_findings add column if not exists escalate_ids uuid[] not null default '{}';
alter table public.control_findings add column if not exists routed_at timestamptz;
alter table public.control_findings add column if not exists notified_at timestamptz;
create index if not exists control_findings_assignees_idx on public.control_findings using gin (assignee_ids) where status = 'open';
create index if not exists control_findings_escalate_idx on public.control_findings using gin (escalate_ids) where status = 'open';

-- Người xử lý lệch xem được lệch của mình (luật đã bật, không phải dữ liệu cũ) — đọc qua RPC; chính sách để đọc thẳng nhất quán.
drop policy if exists control_findings_mine_select on public.control_findings;
create policy control_findings_mine_select on public.control_findings for select to authenticated using (
  not legacy and ((select public.current_app_user_id()) = any(assignee_ids) or (select public.current_app_user_id()) = any(escalate_ids))
  and exists (select 1 from public.control_rules r where r.code = rule_code and r.mode = 'live'));
drop policy if exists control_rules_live_select on public.control_rules;
create policy control_rules_live_select on public.control_rules for select to authenticated using (mode = 'live');

-- ── Ai xử lý ────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.control_finance_people() returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(u.id order by u.name), '{}'::uuid[]) from public.users u
  where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null
    and (app_private.has_permission(u.id, 'system.finance.record', 'global', '*') or app_private.has_permission(u.id, 'system.finance.confirm', 'global', '*'));
$$;

create or replace function app_private.control_route(p_rule public.control_rules, p_f public.control_findings, p_finance uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_po text := substring(coalesce(p_f.link, '') from 'po=([^&#]+)');
  v_wh text := p_f.warehouse_id;
  v_ids uuid[] := '{}'; v_esc uuid[] := '{}'; v_u uuid;
begin
  if v_po is not null and v_wh is null then select po.target_warehouse_id into v_wh from public.purchase_orders po where po.id = v_po; end if;
  if 'buyer' = any(p_rule.route) then
    if v_po is not null then
      select u.id into v_u from public.purchase_orders po join public.users u on u.id::text = po.created_by_id
      where po.id = v_po and u.is_active and u.account_status = 'ACTIVE';
      if v_u is not null then v_ids := v_ids || v_u; end if;
    end if;
    if p_f.object_type = 'material_request' and cardinality(v_ids) = 0 then
      v_ids := v_ids || coalesce((select array_agg(distinct a.assignee_user_id) from public.procurement_inbox_line_assignments a
        join public.users u on u.id = a.assignee_user_id and u.is_active and u.account_status = 'ACTIVE'
        where a.source_type = 'material_request' and a.source_id::text = p_f.object_id), '{}'::uuid[]);
    end if;
  end if;
  if 'warehouse' = any(p_rule.route) and v_wh is not null then
    v_ids := v_ids || coalesce((select array_agg(k) from app_private.wms_warehouse_keepers(v_wh) k), '{}'::uuid[]);
  end if;
  if 'payable' = any(p_rule.route) then v_ids := v_ids || coalesce(p_finance, '{}'::uuid[]); end if;
  -- Không xác định được người phụ trách (đơn cũ không ghi người lập, đề xuất chưa có đơn / chưa giao dòng): chỉ giao Admin — không rải
  -- cho mọi người có quyền Quản trị phân hệ (thử 23/10: 9 người cùng nhận một lệch).
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('assignees', to_jsonb(app_private.alert_admin_ids()), 'escalate', '[]'::jsonb, 'fallback', true);
  end if;
  v_ids := array(select distinct x from unnest(v_ids) x where x is not null);
  -- Trưởng bộ phận: quản lý trực tiếp của từng người xử lý (không trùng người xử lý); không có thì người Quản trị phân hệ.
  v_esc := array(select distinct m from unnest(v_ids) a cross join lateral (select app_private.resolve_active_direct_manager(a) m) z
    where m is not null and not (m = any(v_ids)));
  if cardinality(v_esc) = 0 then
    v_esc := array(select x from unnest(app_private.alert_module_manager_ids(array[coalesce(p_rule.module_key, 'PROCUREMENT')])) x where not (x = any(v_ids)));
  end if;
  return jsonb_build_object('assignees', to_jsonb(v_ids), 'escalate', to_jsonb(v_esc));
end $$;

-- Giao lại 6 giờ một lần (người nghỉ việc, đổi thủ kho, đổi quản lý); lệch mới giao ngay ở lượt phát hiện.
create or replace function app_private.control_route_pending() returns integer language plpgsql volatile security definer set search_path = '' as $$
declare f public.control_findings; r public.control_rules; v jsonb; v_fin uuid[]; v_n integer := 0;
begin
  v_fin := case when exists (select 1 from public.control_findings x join public.control_rules y on y.code = x.rule_code
      where x.status <> 'resolved' and 'payable' = any(y.route) and (x.routed_at is null or x.routed_at < now() - interval '6 hours'))
    then app_private.control_finance_people() else '{}'::uuid[] end;
  for f in select * from public.control_findings where status <> 'resolved' and (routed_at is null or routed_at < now() - interval '6 hours') loop
    select * into r from public.control_rules where code = f.rule_code;
    v := app_private.control_route(r, f, v_fin);
    update public.control_findings set
      assignee_ids = array(select jsonb_array_elements_text(v->'assignees')::uuid),
      escalate_ids = array(select jsonb_array_elements_text(v->'escalate')::uuid),
      routed_at = now()
    where id = f.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- P0 của luật đã bật: một thông báo đẩy ngay cho người xử lý + Admin, mỗi lệch một lần.
create or replace function app_private.control_notify_p0() returns integer language plpgsql volatile security definer set search_path = '' as $$
declare f record; v_n integer := 0;
begin
  for f in select x.*, r.title rule_title from public.control_findings x join public.control_rules r on r.code = x.rule_code
    where r.mode = 'live' and r.severity = 'P0' and x.status = 'open' and not x.legacy and x.notified_at is null and cardinality(x.assignee_ids) > 0 loop
    insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id, priority, push_enabled, metadata)
    select u::text, 'error', 'control', 'Lệch cần sửa: ' || f.rule_title, f.title, f.title, 'critical', '🛡️', coalesce(f.link, '/kiem-soat'),
      'control_finding', f.id::text, 'high', true, jsonb_build_object('rule', f.rule_code, 'findingId', f.id, 'deliveredBy', 'control_k1')
    from (select distinct u from unnest(f.assignee_ids || app_private.alert_admin_ids()) u where u is not null) z;
    update public.control_findings set notified_at = now() where id = f.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Bản tin 07:00: mỗi người một thông báo gộp (lệch của mình + lệch quá 3 ngày ở bộ phận mình). Mỗi ngày một lần.
create or replace function app_private.control_daily_digest() returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_n integer;
begin
  with mine as (
    select distinct u, f.id, f.title, r.severity, f.first_seen_at
    from public.control_findings f
    join public.control_rules r on r.code = f.rule_code and r.mode = 'live'
    cross join lateral unnest(f.assignee_ids || case when f.first_seen_at < now() - interval '3 days' then f.escalate_ids else '{}'::uuid[] end) u
    where f.status = 'open' and not f.legacy),
  per_user as (
    select u, count(*) n, count(*) filter (where severity = 'P0') p0,
      (array_agg(title order by severity, first_seen_at))[1:3] top
    from mine group by u),
  ins as (
    insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id, priority, push_enabled, metadata)
    select p.u::text, case when p.p0 > 0 then 'error' else 'warning' end, 'control',
      format('%s lệch dữ liệu cần sửa%s', p.n, case when p.p0 > 0 then format(' (%s P0)', p.p0) else '' end),
      array_to_string(p.top, ' · ') || case when p.n > 3 then format(' · +%s lệch khác', p.n - 3) else '' end,
      array_to_string(p.top, ' · '), case when p.p0 > 0 then 'critical' else 'warning' end, '🛡️', '/kiem-soat',
      'control_digest', 'control_digest:' || p.u || ':' || v_today, 'normal', true, jsonb_build_object('count', p.n, 'p0', p.p0, 'deliveredBy', 'control_k1')
    from per_user p
    where not exists (select 1 from public.notifications x where x.source_type = 'control_digest' and x.source_id = 'control_digest:' || p.u || ':' || v_today)
    returning 1)
  select count(*) into v_n from ins;
  return v_n;
end $$;

-- Ai thấy / ai chấp nhận được một lệch.
create or replace function app_private.control_can_view(p_f public.control_findings) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or (not p_f.legacy and exists (select 1 from public.control_rules r where r.code = p_f.rule_code and r.mode = 'live')
    and (public.current_app_user_id() = any(p_f.assignee_ids) or public.current_app_user_id() = any(p_f.escalate_ids)));
$$;
create or replace function app_private.control_can_accept(p_f public.control_findings) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or public.current_app_user_id() = any(p_f.escalate_ids)
    or public.current_app_user_id() = any(app_private.alert_module_manager_ids(array[(select coalesce(r.module_key, 'PROCUREMENT') from public.control_rules r where r.code = p_f.rule_code)]));
$$;

create or replace function app_private.control_run(p_rule text default null, p_trigger text default 'cron')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.control_rules;
  v_run bigint; v_rules int := 0; v_opened int := 0; v_resolved int := 0; v_n int; v_errors jsonb := '[]'::jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('cron:control_run')) then
    return jsonb_build_object('skipped', true, 'reason', 'đang có lượt khác chạy');
  end if;
  insert into public.control_runs(trigger) values (left(coalesce(p_trigger, 'cron'), 20)) returning id into v_run;
  create temp table if not exists pg_temp.control_now (object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
    title text, detail jsonb, amount numeric, happened_on date, link text) on commit drop;
  for r in select * from public.control_rules where mode <> 'off' and (p_rule is null or code = p_rule) order by sort_order, code loop
    begin
      if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app_private' and p.proname = r.fn) then
        raise exception 'CONTROL_RULE_FN_MISSING %', r.fn;
      end if;
      truncate pg_temp.control_now;
      execute format('insert into pg_temp.control_now select * from app_private.%I()', r.fn);
      -- Lệch mới → mở; đang có → cập nhật bằng chứng; đã tự đóng mà lệch lại → mở lại (giữ "chấp nhận" nếu Admin đã chấp nhận).
      with up as (
        insert into public.control_findings as f (rule_code, object_key, object_type, object_id, object_code, project_id, warehouse_id, title, detail, amount, happened_on, link, legacy)
        select distinct on (n.object_key) r.code, n.object_key, n.object_type, n.object_id, n.object_code, n.project_id, n.warehouse_id, left(n.title, 400), coalesce(n.detail, '{}'::jsonb),
          n.amount, n.happened_on, n.link, n.happened_on is not null and n.happened_on < r.since_date
        from pg_temp.control_now n where n.object_key is not null order by n.object_key
        on conflict (rule_code, object_key) do update set
          object_code = excluded.object_code, project_id = excluded.project_id, warehouse_id = excluded.warehouse_id, title = excluded.title, detail = excluded.detail,
          amount = excluded.amount, happened_on = excluded.happened_on, link = excluded.link, legacy = excluded.legacy, last_seen_at = now(),
          status = case when f.status = 'resolved' then 'open' else f.status end,
          first_seen_at = case when f.status = 'resolved' then now() else f.first_seen_at end,
          resolved_at = case when f.status = 'resolved' then null else f.resolved_at end
        returning (xmax = 0) as inserted)
      select count(*) into v_n from up where inserted;
      v_opened := v_opened + coalesce(v_n, 0);
      -- Hết lệch → tự đóng (cả hồ sơ đã chấp nhận).
      update public.control_findings f set status = 'resolved', resolved_at = now()
      where f.rule_code = r.code and f.status <> 'resolved' and not exists (select 1 from pg_temp.control_now n where n.object_key = f.object_key);
      get diagnostics v_n = row_count;
      v_resolved := v_resolved + v_n;
      v_rules := v_rules + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('rule', r.code, 'error', left(sqlerrm, 300));
    end;
  end loop;
  -- K1: giao người xử lý cho lệch còn mở, rồi báo ngay lệch P0 của luật đã bật "Báo người xử lý".
  begin
    perform app_private.control_route_pending();
    perform app_private.control_notify_p0();
  exception when others then
    v_errors := v_errors || jsonb_build_object('rule', '(giao người xử lý)', 'error', left(sqlerrm, 300));
  end;
  update public.control_runs set finished_at = now(), rules = v_rules, opened = v_opened, resolved = v_resolved, errors = v_errors,
    open_total = (select count(*) from public.control_findings where status = 'open')
  where id = v_run;
  return jsonb_build_object('run', v_run, 'rules', v_rules, 'opened', v_opened, 'resolved', v_resolved, 'errors', v_errors);
end $$;
revoke all on function app_private.control_run(text, text) from public, anon, authenticated;


-- ── Lệnh cho người dùng (Admin thấy hết; người xử lý / trưởng bộ phận thấy lệch của mình) ─────────────────────────────
create or replace function public.control_overview_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_admin boolean := public.is_admin(); v_me uuid := public.current_app_user_id();
begin
  if v_me is null then raise exception 'CONTROL_LOGIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'isAdmin', v_admin,
    'rules', (select coalesce(jsonb_agg(jsonb_build_object(
        'code', r.code, 'module', r.module, 'title', r.title, 'principle', r.principle, 'fixHint', r.fix_hint, 'ownerHint', r.owner_hint,
        'severity', r.severity, 'mode', r.mode, 'sinceDate', r.since_date,
        'open', (select count(*) from public.control_findings f where f.rule_code = r.code and f.status = 'open' and not f.legacy and app_private.control_can_view(f)),
        'openLegacy', (select count(*) from public.control_findings f where f.rule_code = r.code and f.status = 'open' and f.legacy and app_private.control_can_view(f)),
        'accepted', (select count(*) from public.control_findings f where f.rule_code = r.code and f.status = 'accepted' and app_private.control_can_view(f)),
        'resolved7d', (select count(*) from public.control_findings f where f.rule_code = r.code and f.status = 'resolved' and f.resolved_at > now() - interval '7 days' and app_private.control_can_view(f)),
        'amountOpen', (select round(sum(abs(f.amount))) from public.control_findings f where f.rule_code = r.code and f.status = 'open' and app_private.control_can_view(f)))
      order by r.sort_order, r.code), '[]'::jsonb) from public.control_rules r where v_admin or r.mode = 'live'),
    'lastRun', (select jsonb_build_object('id', x.id, 'startedAt', x.started_at, 'finishedAt', x.finished_at, 'trigger', x.trigger, 'rules', x.rules,
        'opened', x.opened, 'resolved', x.resolved, 'openTotal', x.open_total, 'errors', case when v_admin then x.errors else '[]'::jsonb end)
      from public.control_runs x order by x.id desc limit 1));
end $$;

create or replace function public.control_findings_v1(p_rule text default null, p_status text default 'open', p_legacy boolean default null, p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if public.current_app_user_id() is null then raise exception 'CONTROL_LOGIN_REQUIRED' using errcode = '42501'; end if;
  if coalesce(p_status, 'open') not in ('open', 'accepted', 'resolved', 'all') then raise exception 'CONTROL_BAD_STATUS' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(x order by x->>'severity', (x->>'happenedOn') desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object('id', f.id, 'rule', f.rule_code, 'ruleTitle', r.title, 'module', r.module, 'severity', r.severity, 'ownerHint', r.owner_hint,
      'objectType', f.object_type, 'objectId', f.object_id, 'objectCode', f.object_code, 'projectId', f.project_id,
      'projectName', (select coalesce(nullif(p.code, ''), p.name) from public.projects p where p.id = f.project_id),
      'title', f.title, 'detail', f.detail, 'amount', f.amount, 'happenedOn', f.happened_on, 'link', f.link, 'legacy', f.legacy, 'status', f.status,
      'firstSeenAt', f.first_seen_at, 'lastSeenAt', f.last_seen_at, 'resolvedAt', f.resolved_at,
      'acceptedAt', f.accepted_at, 'acceptedReason', f.accepted_reason, 'acceptedBy', (select u.name from public.users u where u.id = f.accepted_by),
      'assignees', (select coalesce(jsonb_agg(u.name order by u.name), '[]'::jsonb) from public.users u where u.id = any(f.assignee_ids)),
      'canAccept', app_private.control_can_accept(f), 'escalated', f.status = 'open' and f.first_seen_at < now() - interval '3 days') x
    from public.control_findings f join public.control_rules r on r.code = f.rule_code
    where (p_rule is null or f.rule_code = p_rule)
      and (coalesce(p_status, 'open') = 'all' or f.status = coalesce(p_status, 'open'))
      and (p_legacy is null or f.legacy = p_legacy)
      and app_private.control_can_view(f)
    order by case r.severity when 'P0' then 0 when 'P1' then 1 else 2 end, f.happened_on desc nulls last
    limit least(greatest(coalesce(p_limit, 200), 1), 500)) s);
end $$;

create or replace function public.control_finding_accept_v1(p_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v public.control_findings; v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v from public.control_findings where id = p_id;
  if v.id is null or not app_private.control_can_view(v) or not app_private.control_can_accept(v) then raise exception 'CONTROL_ACCEPT_DENIED' using errcode = '42501'; end if;
  if length(v_reason) < 10 then raise exception 'CONTROL_REASON_REQUIRED' using errcode = '22023'; end if;
  update public.control_findings set status = 'accepted', accepted_at = now(), accepted_by = public.current_app_user_id(), accepted_reason = left(v_reason, 500)
  where id = p_id and status = 'open' returning * into v;
  if v.id is null then raise exception 'CONTROL_FINDING_NOT_OPEN' using errcode = 'PT409'; end if;
  insert into public.audit_trail(table_name, record_id, record_label, action, old_data, new_data, user_id, user_name, module, description, impact_level, context)
  values ('control_findings', v.id::text, coalesce(v.object_code, v.rule_code), 'UPDATE', jsonb_build_object('status', 'open'), jsonb_build_object('status', 'accepted', 'reason', v.accepted_reason),
    public.current_app_user_id()::text, (select name from public.users where id = public.current_app_user_id()), 'Kiểm soát', 'Chấp nhận lệch: ' || v.title, 'normal', jsonb_build_object('rule', v.rule_code));
  return jsonb_build_object('id', v.id, 'status', v.status);
end $$;

create or replace function public.control_finding_reopen_v1(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v public.control_findings;
begin
  select * into v from public.control_findings where id = p_id;
  if v.id is null or not app_private.control_can_view(v) or not app_private.control_can_accept(v) then raise exception 'CONTROL_ACCEPT_DENIED' using errcode = '42501'; end if;
  update public.control_findings set status = 'open', accepted_at = null, accepted_by = null, accepted_reason = null
  where id = p_id and status = 'accepted' returning * into v;
  if v.id is null then raise exception 'CONTROL_FINDING_NOT_ACCEPTED' using errcode = 'PT409'; end if;
  insert into public.audit_trail(table_name, record_id, record_label, action, old_data, new_data, user_id, user_name, module, description, impact_level, context)
  values ('control_findings', v.id::text, coalesce(v.object_code, v.rule_code), 'UPDATE', jsonb_build_object('status', 'accepted'), jsonb_build_object('status', 'open'),
    public.current_app_user_id()::text, (select name from public.users where id = public.current_app_user_id()), 'Kiểm soát', 'Mở lại lệch: ' || v.title, 'normal', jsonb_build_object('rule', v.rule_code));
  return jsonb_build_object('id', v.id, 'status', v.status);
end $$;

-- Admin bật / tắt "Báo người xử lý" cho từng luật (shadow = chạy thử, live = báo người xử lý, off = tắt).
create or replace function public.control_rule_set_mode_v1(p_code text, p_mode text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_old text;
begin
  if not public.is_admin() then raise exception 'CONTROL_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if p_mode not in ('shadow', 'live', 'off') then raise exception 'CONTROL_BAD_MODE' using errcode = '22023'; end if;
  select mode into v_old from public.control_rules where code = p_code for update;
  if v_old is null then raise exception 'CONTROL_RULE_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.control_rules set mode = p_mode, updated_at = now(), updated_by = public.current_app_user_id() where code = p_code;
  insert into public.audit_trail(table_name, record_id, record_label, action, old_data, new_data, user_id, user_name, module, description, impact_level, context)
  values ('control_rules', p_code, p_code, 'UPDATE', jsonb_build_object('mode', v_old), jsonb_build_object('mode', p_mode),
    public.current_app_user_id()::text, (select name from public.users where id = public.current_app_user_id()), 'Kiểm soát',
    'Đổi chế độ luật ' || p_code || ': ' || v_old || ' → ' || p_mode, 'normal', '{}'::jsonb);
  return jsonb_build_object('code', p_code, 'mode', p_mode);
end $$;

-- Trợ lý: "PO-609 có gì lệch?" — lệch đang mở / đã chấp nhận của một mã chứng từ, theo quyền xem như trên.
create or replace function public.control_findings_for_code_v1(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if public.current_app_user_id() is null then raise exception 'CONTROL_LOGIN_REQUIRED' using errcode = '42501'; end if;
  if length(v_code) < 3 or length(v_code) > 60 then raise exception 'CONTROL_BAD_CODE' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('ma', f.object_code, 'luat', r.title, 'muc', r.severity, 'lech', f.title, 'chenh', f.amount,
      'trang_thai', f.status, 'du_lieu_cu', f.legacy, 'cach_xu_ly', r.fix_hint, 'ai_xu_ly', r.owner_hint, 'phat_hien', f.first_seen_at, 'link', f.link,
      'ly_do_chap_nhan', f.accepted_reason) order by r.severity), '[]'::jsonb)
    from public.control_findings f join public.control_rules r on r.code = f.rule_code
    where f.status in ('open', 'accepted') and (upper(f.object_code) like '%' || v_code || '%' or upper(f.title) like '%' || v_code || '%')
      and app_private.control_can_view(f)
    limit 10);
end $$;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private' and p.proname in ('control_finance_people', 'control_route', 'control_route_pending', 'control_notify_p0', 'control_daily_digest', 'control_can_view', 'control_can_accept') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
revoke all on function public.control_rule_set_mode_v1(text, text), public.control_findings_for_code_v1(text) from public, anon;
grant execute on function public.control_rule_set_mode_v1(text, text), public.control_findings_for_code_v1(text) to authenticated;

select cron.schedule('control-daily-digest', '0 0 * * *', 'select app_private.control_daily_digest();');

-- Giao người xử lý ngay cho lệch đang mở (không chờ lượt 15 phút).
select app_private.control_route_pending();

-- ── Việc của tôi: thêm nguồn 'control' ───────────────────────────────────────────────────────────────────────────────
create or replace function public.vcc_my_work_items_v1(p_tab text DEFAULT 'mine'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := app_private.center_actor_v1();
  v_me text := v_actor::text;
  v_tab text := coalesce(nullif(btrim(p_tab), ''), 'mine');
  v_employee uuid := app_private.hrm_current_employee_id();
  v_hr boolean := app_private.has_hrm_template_permission(v_actor, 'hrm.employee.view_sensitive');
  v_hr_manage boolean := app_private.has_hrm_template_permission(v_actor, 'hrm.master_data.manage');
  v_work boolean := app_private.has_permission(v_actor, 'work.module.access', 'global', '*');
  v_fin_record boolean := app_private.finance_can('record');
  v_fin_confirm boolean := app_private.finance_can('confirm');
  v_buyer boolean := app_private.receipt_recon_is_buyer();
  v_role text := (select u.role::text from public.users u where u.id = v_actor);
  v_limit constant integer := 200;
  v_items jsonb := '[]'::jsonb;
  v_part jsonb;
  v_truncated text[] := '{}';
begin
  if v_tab not in ('mine', 'sent', 'watch') then
    raise exception using errcode = '22023', message = 'CENTER_TAB_INVALID';
  end if;

  -- 1. Đề xuất (module Yêu cầu) ───────────────────────────────────────────────────────────────
  select coalesce(jsonb_agg(app_private.vcc_item('rq', 'request',
      case when r.status = 'RETURNED' then 'do' when v_tab = 'mine' then 'approve' when v_tab = 'sent' then 'wait' else 'watch' end,
      r.id::text, r.code, r.title,
      case when r.status = 'RETURNED' then 'Bị trả lại để sửa' else app_private.vcc_user_name(r.created_by::text) || ' lập' end,
      r.created_by::text, coalesce(t.name, 'Yêu cầu'), r.due_at, r.status,
      jsonb_build_object('requestId', r.id))), '[]'::jsonb)
  into v_part
  from (select * from public.request_instances r
        where case v_tab
          when 'mine' then (r.status = 'PENDING' and exists (select 1 from public.workflow_step_assignments a
              where a.workflow_subject_id = r.workflow_subject_id and a.assignee_user_id = v_actor and a.status = 'PENDING'))
            or (r.status = 'RETURNED' and r.created_by = v_actor)
          when 'sent' then r.status = 'PENDING' and r.created_by = v_actor
          else r.status = 'PENDING' and r.created_by <> v_actor and exists (select 1 from public.workflow_participants p
              where p.workflow_subject_id = r.workflow_subject_id and p.user_id = v_actor and p.role = 'WATCHER' and p.is_active)
          end
        order by r.due_at nulls last, r.created_at limit v_limit) r
  left join public.request_templates t on t.id = r.request_template_id;
  v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'rq'; end if;

  -- 2. Đề xuất vật tư (module Dự án) ──────────────────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('mr', 'project', case when v_tab = 'mine' then 'approve' else 'wait' end,
        r.id, r.code, r.title,
        case when v_tab = 'mine' then app_private.vcc_user_name(r.requester_id::text) || ' lập'
          else coalesce(r.submitted_to_name || ' đang duyệt', case r.status when 'APPROVED' then 'Đang cung ứng' when 'IN_TRANSIT' then 'Đang chuyển' else 'Chờ duyệt' end) end,
        r.requester_id::text,
        jsonb_array_length(coalesce(r.items, '[]'::jsonb)) || ' dòng · cần ' || to_char(r.expected_date, 'DD/MM')
          || coalesce(' · ' || p.code, ''),
        coalesce(r.workflow_step_due_at, r.expected_date), r.status::text,
        jsonb_build_object('requestId', r.id, 'projectId', r.project_id, 'requestOrigin', r.request_origin, 'siteWarehouseId', r.site_warehouse_id))), '[]'::jsonb)
    into v_part
    from (select * from public.requests r
          where case v_tab
            when 'mine' then r.status = 'PENDING' and (r.submitted_to_user_id = v_me
              or (r.workflow_subject_id is not null and app_private.project_workflow_actor_can_act(r.workflow_subject_id, v_actor)))
            else r.requester_id = v_actor and r.status in ('PENDING', 'APPROVED', 'IN_TRANSIT') end
          order by coalesce(r.workflow_step_due_at, r.expected_date), r.created_date limit v_limit) r
    left join public.projects p on p.id = r.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'mr'; end if;
  end if;

  -- 3. Phiếu kho (module Vật tư) ─────────────────────────────────────────────────────────────
  -- Mỗi wms_has_action ~30 ms (tới 5 lần kiểm quyền). Gọi một lần cho mỗi bộ duy nhất
  -- (việc, kho nguồn, kho đích, tôi là người lập?, tôi được giao?) thay vì từng phiếu — cùng kết quả,
  -- vì hàm chỉ xét người lập / người được giao khi đó chính là người gọi.
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('wms_tx', 'warehouse',
        case when v_tab = 'sent' then 'wait' when t.status = 'PENDING' then 'approve' else 'confirm' end,
        t.id, t.id,
        'Phiếu ' || case t.type::text when 'IMPORT' then 'nhập' when 'EXPORT' then 'xuất' when 'TRANSFER' then 'chuyển'
          when 'ADJUSTMENT' then 'điều chỉnh' else 'thanh lý' end || ' kho'
          || coalesce(' · ' || coalesce(wt.name, ws.name), ''),
        case when v_tab = 'sent' then case t.status::text when 'PENDING' then 'Chờ duyệt' else 'Chờ kho xác nhận' end
          else coalesce(app_private.vcc_user_name(t.requester_id::text), app_private.vcc_user_name(t.created_by::text)) || ' lập' end,
        coalesce(t.requester_id, t.created_by)::text,
        jsonb_array_length(coalesce(t.items, '[]'::jsonb)) || ' dòng' || coalesce(' · ' || left(t.note, 60), ''),
        t.date, t.status::text,
        jsonb_build_object('transactionId', t.id, 'type', t.type, 'sourceWarehouseId', t.source_warehouse_id, 'targetWarehouseId', t.target_warehouse_id))), '[]'::jsonb)
    into v_part
    from (
      with open_tx as (
        select x.*,
          case when x.status = 'PENDING' and x.type in ('ADJUSTMENT', 'LIQUIDATION') then 'wms.transaction.exception_approve'
            when x.status = 'PENDING' then 'wms.transaction.approve' else 'wms.transaction.complete' end as code,
          case when x.requester_id = v_actor then v_actor end as req_me,
          case when x.approver_id = v_actor then v_actor end as appr_me
        from public.transactions x
        where x.status in ('PENDING', 'APPROVED')
          and (v_tab = 'mine' or x.requester_id = v_actor)
      ), allowed as materialized (
        select k.code, k.source_warehouse_id, k.target_warehouse_id, k.req_me, k.appr_me,
          app_private.wms_has_action(k.code, k.source_warehouse_id, k.target_warehouse_id, k.req_me, k.appr_me, v_actor) as ok
        from (select distinct code, source_warehouse_id, target_warehouse_id, req_me, appr_me from open_tx) k
        where v_tab = 'mine'
      )
      select o.* from open_tx o
      where v_tab = 'sent'
        or (not (o.code = 'wms.transaction.exception_approve' and o.requester_id = v_actor)
          and exists (select 1 from allowed a where a.ok and a.code = o.code
            and a.source_warehouse_id is not distinct from o.source_warehouse_id
            and a.target_warehouse_id is not distinct from o.target_warehouse_id
            and a.req_me is not distinct from o.req_me and a.appr_me is not distinct from o.appr_me))
      order by o.date desc limit v_limit) t
    left join public.warehouses ws on ws.id = t.source_warehouse_id
    left join public.warehouses wt on wt.id = t.target_warehouse_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'wms_tx'; end if;
  end if;

  -- 4. Nhật ký thi công + phiếu kỹ sư (module Dự án) ──────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('daily_log', 'project', case when v_tab = 'mine' then 'approve' else 'wait' end,
        d.id, 'NK ' || coalesce(to_char(app_private.vcc_date(d.date), 'DD/MM'), d.date),
        'Nhật ký ' || coalesce(to_char(app_private.vcc_date(d.date), 'DD/MM'), d.date) || coalesce(' · ' || s.name, ''),
        case when v_tab = 'mine' then coalesce(app_private.vcc_user_name(d.submitted_by_id), app_private.vcc_user_name(d.created_by_id)) || ' gửi'
          else coalesce(d.submitted_to_name, 'Người duyệt') || ' đang duyệt' end,
        coalesce(d.submitted_by_id, d.created_by_id),
        d.worker_count || ' công' || case when d.summary_contribution_count > 0 then ' · ' || d.summary_contribution_count || ' phiếu kỹ sư' else '' end,
        app_private.vcc_date(d.date)::timestamptz, d.status,
        jsonb_build_object('dailyLogId', d.id, 'projectId', d.project_id, 'constructionSiteId', d.construction_site_id))), '[]'::jsonb)
    into v_part
    from (select * from public.daily_logs d
          where d.status = 'submitted' and case v_tab when 'mine' then d.submitted_to_user_id = v_me else d.created_by_id = v_me end
          order by d.date desc limit v_limit) d
    left join public.hrm_construction_sites s on s.id::text = d.construction_site_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'daily_log'; end if;

    select coalesce(jsonb_agg(app_private.vcc_item('daily_slip', 'project', case when v_tab = 'mine' then 'do' else 'wait' end,
        c.id::text, 'Phiếu ' || to_char(c.date, 'DD/MM'),
        'Phiếu kỹ sư ' || to_char(c.date, 'DD/MM') || coalesce(' · ' || s.name, '')
          || case when c.status = 'returned' then ' bị trả lại' else '' end,
        case when c.status = 'returned' then coalesce(c.returned_by_name, 'Người tổng hợp') || ' trả lại'
          else coalesce(c.submitted_to_name, 'Người tổng hợp') || ' đang tổng hợp' end,
        coalesce(c.returned_by, c.submitted_to_user_id),
        coalesce(left(c.return_reason, 80), left(c.content, 80)),
        c.date::timestamptz, c.status,
        jsonb_build_object('contributionId', c.id, 'projectId', c.project_id, 'constructionSiteId', c.construction_site_id, 'date', c.date))), '[]'::jsonb)
    into v_part
    from (select * from public.daily_log_contributions c
          where c.author_user_id = v_me and c.status = case v_tab when 'mine' then 'returned' else 'submitted' end
          order by c.date desc limit v_limit) c
    left join public.hrm_construction_sites s on s.id::text = c.construction_site_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'daily_slip'; end if;
  end if;

  -- 5. Kế hoạch tuần / tháng (module Dự án) ───────────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('work_plan', 'project',
        case when w.status = 'returned' then 'do' when v_tab = 'mine' then 'approve' else 'wait' end,
        w.id::text, w.code,
        'Kế hoạch ' || case w.period_type when 'week' then 'tuần ' else 'tháng ' end
          || to_char(w.period_start, 'DD/MM') || '–' || to_char(w.period_end, 'DD/MM')
          || case when w.status = 'returned' then ' bị trả lại' else '' end,
        case when w.status = 'returned' then coalesce(app_private.vcc_user_name(w.returned_by::text), 'Người duyệt') || ' trả lại'
          when v_tab = 'mine' then coalesce(app_private.vcc_user_name(w.submitted_by::text), app_private.vcc_user_name(w.created_by::text)) || ' gửi'
          else coalesce(app_private.vcc_user_name(w.submitted_to_user_id::text), 'Người duyệt') || ' đang duyệt' end,
        coalesce(w.submitted_by, w.created_by)::text,
        coalesce(p.code, '') || case when w.status = 'returned' then coalesce(' · ' || left(w.return_reason, 80), '') else '' end,
        coalesce(w.submitted_at, w.updated_at), w.status,
        jsonb_build_object('planId', w.id, 'projectId', w.project_id, 'constructionSiteId', w.construction_site_id, 'periodType', w.period_type, 'periodStart', w.period_start))), '[]'::jsonb)
    into v_part
    from (select * from public.project_work_plans w
          where case v_tab
            when 'mine' then (w.status = 'submitted' and w.submitted_to_user_id = v_actor) or (w.status = 'returned' and w.created_by = v_actor)
            else w.status = 'submitted' and w.created_by = v_actor end
          order by w.submitted_at desc nulls last limit v_limit) w
    left join public.projects p on p.id = w.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'work_plan'; end if;
  end if;

  -- 6. Đơn hàng + đợt giao (module Mua hàng) ──────────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('po', 'procurement',
        case when o.status = 'returned' then 'do' when v_tab = 'mine' then 'approve' else 'wait' end,
        o.id, o.po_number,
        coalesce(o.vendor_name, 'Nhà cung cấp') || ' · ' || app_private.vcc_money(o.total_amount)
          || case when o.status = 'returned' then ' · bị trả lại' else '' end,
        case when v_tab = 'mine' and o.status <> 'returned' then coalesce(app_private.vcc_user_name(o.created_by_id), 'Mua hàng') || ' lập'
          else coalesce(o.submitted_to_name || ' đang duyệt', 'Chờ duyệt') end,
        o.created_by_id,
        jsonb_array_length(coalesce(o.items, '[]'::jsonb)) || ' dòng' || coalesce(' · ' || p.code, ''),
        app_private.vcc_date(o.expected_delivery_date)::timestamptz, o.status,
        jsonb_build_object('poId', o.id, 'projectId', o.project_id))), '[]'::jsonb)
    into v_part
    from (select * from public.purchase_orders o
          where o.archived_at is null and case v_tab
            when 'mine' then (o.status = 'sent' and o.submitted_to_user_id = v_me) or (o.status = 'returned' and o.created_by_id = v_me)
            else o.status = 'sent' and o.created_by_id = v_me end
          order by o.created_at desc limit v_limit) o
    left join public.projects p on p.id = o.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'po'; end if;

    select coalesce(jsonb_agg(app_private.vcc_item('po_delivery', 'procurement', case when v_tab = 'mine' then 'approve' else 'wait' end,
        b.id::text, o.po_number,
        'Đợt giao ' || b.delivery_no || ' · ' || coalesce(o.vendor_name, 'Nhà cung cấp'),
        case when v_tab = 'mine' then coalesce(app_private.vcc_user_name(b.created_by::text), 'Mua hàng') || ' gửi duyệt'
          else coalesce(app_private.vcc_user_name(b.approval_assignee_user_id::text), 'Người duyệt') || ' đang duyệt' end,
        b.created_by::text,
        coalesce('giao ' || to_char(b.planned_delivery_date, 'DD/MM'), 'chưa có ngày giao') || coalesce(' · ' || p.code, ''),
        b.planned_delivery_date::timestamptz, b.approval_status,
        jsonb_build_object('poId', o.id, 'deliveryId', b.id, 'projectId', b.project_id))), '[]'::jsonb)
    into v_part
    from (select * from public.purchase_order_delivery_batches b
          where b.approval_status = 'pending_approval' and b.status = 'planned'
            and case v_tab when 'mine' then b.approval_assignee_user_id = v_actor else b.created_by = v_actor end
          order by b.planned_delivery_date nulls last limit v_limit) b
    join public.purchase_orders o on o.id = b.purchase_order_id
    left join public.projects p on p.id = b.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'po_delivery'; end if;
  end if;

  -- 7. Mua nóng / CCDC (module Mua hàng) ──────────────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('hot', 'procurement', case when v_tab = 'mine' then 'approve' else 'wait' end,
        h.id::text, h.code,
        coalesce(h.supplier_name_snapshot, 'Mua nóng') || ' · ' || app_private.vcc_money(h.total_amount),
        case when v_tab = 'mine' then coalesce(app_private.vcc_user_name(h.created_by::text), 'Công trường') || ' lập'
          else coalesce(h.submitted_to_name || ' đang duyệt', 'Chờ duyệt') end,
        h.created_by::text,
        coalesce(p.code, '') || case h.purchase_mode when 'immediate' then ' · đã mua' else ' · xin mua' end,
        h.purchase_date::timestamptz, h.status,
        jsonb_build_object('hotPurchaseId', h.id, 'projectId', h.project_id))), '[]'::jsonb)
    into v_part
    from (select * from public.site_direct_purchases h
          where h.status = 'submitted' and case v_tab when 'mine' then h.submitted_to_user_id = v_me else h.created_by = v_actor end
          order by h.created_at desc limit v_limit) h
    left join public.projects p on p.id = h.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'hot'; end if;
  end if;

  -- 8. Đề nghị chi (module Tài chính) ─────────────────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('fin_payment', 'finance',
        case when r.status = 'returned' then 'do' when v_tab = 'sent' then 'wait' when r.status = 'approved' then 'confirm' else 'approve' end,
        r.id::text, r.code,
        r.supplier_name || ' · ' || app_private.vcc_money(r.amount)
          || case r.status when 'returned' then ' · bị trả lại' when 'approved' then ' · đã duyệt, chờ chi' else '' end,
        case when v_tab = 'mine' and r.status = 'pending' then coalesce(app_private.vcc_user_name(r.created_by::text), 'Kế toán') || ' lập'
          when r.status = 'approved' then 'Chờ xác nhận đã chi'
          when r.status = 'returned' then 'Bị trả lại để sửa'
          else 'Bước ' || coalesce(r.route -> r.current_step ->> 'label', 'duyệt') end,
        r.created_by::text,
        coalesce(r.route -> r.current_step ->> 'label', '') || ' · chi ' || to_char(r.planned_date, 'DD/MM'),
        r.planned_date::timestamptz, r.status,
        jsonb_build_object('requestId', r.id, 'supplierId', r.supplier_id))), '[]'::jsonb)
    into v_part
    from (select * from public.finance_payment_requests r
          where case v_tab
            when 'mine' then
              (r.status = 'pending' and r.created_by is distinct from v_actor
                and (v_me in (select jsonb_array_elements_text(r.route -> r.current_step -> 'eligibleIds'))
                  or exists (select 1 from jsonb_array_elements_text(r.route -> r.current_step -> 'approverIds') a
                    where v_actor = any(app_private.finance_active_delegates(a::uuid))))
                and not exists (select 1 from public.finance_payment_request_steps s where s.request_id = r.id
                  and s.submission_no = r.submission_no and s.action = 'approve' and s.actor_id = v_actor))
              or (r.status = 'approved' and v_fin_confirm and r.created_by is distinct from v_actor)
              or (r.status = 'returned' and r.created_by = v_actor)
            else r.status in ('pending', 'approved') and r.created_by = v_actor end
          order by r.planned_date, r.created_at limit v_limit) r;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'fin_payment'; end if;
  end if;

  -- 9. Quỹ công trường: khoản chi + đầu kỳ (module Tài chính) ─────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('fin_site_expense', 'finance', case when v_tab = 'mine' then 'approve' else 'wait' end,
        x.id::text, x.code, x.description || ' · ' || app_private.vcc_money(x.amount),
        case when v_tab = 'mine' then coalesce(app_private.vcc_user_name(x.created_by::text), 'Công trường') || ' gửi' else 'Chờ kế toán duyệt' end,
        x.created_by::text, coalesce(p.code, '') || coalesce(' · ' || f.name, ''),
        x.spent_date::timestamptz, x.status,
        jsonb_build_object('expenseId', x.id, 'accountId', x.account_id, 'projectId', x.project_id))), '[]'::jsonb)
    into v_part
    from (select x.* from public.finance_site_expenses x join public.cash_funds f on f.id = x.account_id
          where x.status = 'submitted' and case v_tab
            when 'mine' then v_fin_record and x.created_by is distinct from v_actor and f.holder_user_id is distinct from v_actor
            else x.created_by = v_actor end
          order by x.spent_date desc limit v_limit) x
    join public.cash_funds f on f.id = x.account_id
    left join public.projects p on p.id = x.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'fin_site_expense'; end if;

    select coalesce(jsonb_agg(app_private.vcc_item('fin_fund_opening', 'finance', case when v_tab = 'mine' then 'confirm' else 'wait' end,
        o.id::text, 'Đầu kỳ', 'Đầu kỳ quỹ công trường ' || coalesce(p.code, ''),
        case when v_tab = 'mine' then coalesce(app_private.vcc_user_name(o.created_by::text), 'Kế toán') || ' khai' else 'Chờ xác nhận' end,
        o.created_by::text, 'số dư ' || app_private.vcc_money(o.balance) || ' · tới ' || to_char(o.cutover_date, 'DD/MM'),
        o.created_at, o.status,
        jsonb_build_object('openingId', o.id, 'projectId', o.project_id))), '[]'::jsonb)
    into v_part
    from (select * from public.finance_project_fund_openings o
          where o.status = 'submitted' and case v_tab
            when 'mine' then v_fin_confirm and o.created_by is distinct from v_actor else o.created_by = v_actor end
          order by o.created_at desc limit v_limit) o
    left join public.projects p on p.id = o.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'fin_fund_opening'; end if;
  end if;

  -- 10. Nghỉ phép (module Nhân sự) ────────────────────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('leave', 'hrm', case when v_tab = 'mine' then 'approve' else 'wait' end,
        l.id::text, coalesce(l.code, 'Nghỉ phép'),
        coalesce(e.full_name::text, 'Nhân viên') || ' nghỉ ' || lower(coalesce(lt.name, l.type)) || ' ' || l."totalDays" || ' ngày '
          || coalesce(to_char(app_private.vcc_date(l."startDate"), 'DD/MM'), l."startDate")
          || case when l."endDate" <> l."startDate" then '–' || coalesce(to_char(app_private.vcc_date(l."endDate"), 'DD/MM'), l."endDate") else '' end,
        case when v_tab = 'mine' then coalesce(e.full_name::text, 'Nhân viên') || ' gửi'
          else 'Chờ ' || coalesce(l.step ->> 'name', l.step ->> 'label', 'người duyệt') end,
        e.user_id::text, left(l.reason, 80),
        app_private.vcc_date(l."startDate")::timestamptz, l.status,
        jsonb_build_object('requestId', l.id, 'employeeId', l."employeeId"))), '[]'::jsonb)
    into v_part
    from (select l.*, l.approvers -> (coalesce(l.current_step, 1) - 1) as step from public.hrm_leave_requests l
          where l.status = 'pending' and case v_tab
            when 'mine' then (l.approvers -> (coalesce(l.current_step, 1) - 1) ->> 'userId') = v_me
              or ((l.approvers -> (coalesce(l.current_step, 1) - 1) ->> 'kind') = 'hr' and v_hr)
            else v_employee is not null and l."employeeId" = v_employee end
          order by l."startDate" limit v_limit) l
    left join public.employees e on e.id = l."employeeId"
    left join public.hrm_leave_types lt on lt.code = l.type;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'leave'; end if;
  end if;

  -- 11. Chấm công bù (module Nhân sự) ─────────────────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('makeup', 'hrm', case when v_tab = 'mine' then 'approve' else 'wait' end,
        a.id::text, 'Bù công ' || to_char(a.date, 'DD/MM'),
        coalesce(app_private.vcc_employee_name(a."targetEmployeeId"), 'Nhân viên') || ' đề nghị chấm công bù ' || to_char(a.date, 'DD/MM'),
        case when v_tab = 'mine' then coalesce(app_private.vcc_employee_name(a."proposerEmployeeId"), 'Nhân viên') || ' gửi'
          else coalesce(a."submittedToName", 'Người duyệt') || ' đang duyệt' end,
        a."submittedToUserId", left(a.reason, 80), a.date::timestamptz, a."proposalStatus",
        jsonb_build_object('proposalId', a.id, 'date', a.date))), '[]'::jsonb)
    into v_part
    from (select * from public.hrm_attendance_proposals a
          where a."proposalStatus" = 'pending' and case v_tab
            when 'mine' then a."submittedToUserId" = v_me
            else v_employee is not null and a."proposerEmployeeId" = v_employee::text end
          order by a.date desc limit v_limit) a;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'makeup'; end if;
  end if;

  -- 12. Điều động công trường (module Nhân sự) ────────────────────────────────────────────────
  select coalesce(jsonb_agg(app_private.vcc_item('site_assignment', 'hrm', case v_tab when 'mine' then 'approve' when 'sent' then 'wait' else 'watch' end,
      a.id::text, a.code,
      coalesce(e.full_name::text, 'Nhân viên') || ' đến ' || coalesce(s.name, 'công trường') || ' từ ' || to_char(a.start_date, 'DD/MM')
        || case a.kind when 'temporary' then ' (tạm)' when 'concurrent' then ' (kiêm nhiệm)' else '' end,
      case when v_tab = 'sent' then 'Chờ HR Manage duyệt' else coalesce(app_private.vcc_user_name(a.created_by::text), 'HR') || ' lập' end,
      a.created_by::text, left(a.reason, 80), a.start_date::timestamptz, a.status,
      jsonb_build_object('assignmentId', a.id, 'employeeId', a.employee_id, 'siteId', a.site_id))), '[]'::jsonb)
  into v_part
  from (select * from public.hrm_site_assignments a
        where a.status = 'pending' and case v_tab
          when 'mine' then v_hr_manage
          when 'sent' then a.created_by = v_actor
          else not v_hr_manage and a.created_by is distinct from v_actor
            and (app_private.hrm_is_site_leader(v_actor, a.site_id) or (a.from_site_id is not null and app_private.hrm_is_site_leader(v_actor, a.from_site_id))) end
        order by a.start_date limit v_limit) a
  left join public.employees e on e.id = a.employee_id
  left join public.hrm_construction_sites s on s.id = a.site_id;
  v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'site_assignment'; end if;

  -- 13. Chốt công tháng (module Nhân sự) ──────────────────────────────────────────────────────
  if v_tab = 'mine' then
    select coalesce(jsonb_agg(app_private.vcc_item('timesheet', 'hrm', case when t.status = 'reviewing' then 'do' else 'approve' end,
        t.id::text, 'Kỳ công ' || lpad(t.month::text, 2, '0') || '/' || t.year,
        'Bảng công tháng ' || lpad(t.month::text, 2, '0') || '/' || t.year
          || case when t.status = 'reviewing' then ' đang rà soát' else ' chờ chốt' end,
        case when t.status = 'reviewing' then coalesce(app_private.vcc_user_name(t.opened_by::text), 'HR') || ' mở kỳ'
          else coalesce(app_private.vcc_user_name(t.submitted_by::text), 'HR') || ' gửi chốt' end,
        coalesce(t.submitted_by, t.opened_by)::text,
        case when t.status = 'reviewing' then 'HR rà soát rồi gửi chốt' else 'HR Manage duyệt để khóa tháng' end,
        coalesce(t.submitted_at, t.opened_at), t.status,
        jsonb_build_object('year', t.year, 'month', t.month))), '[]'::jsonb)
    into v_part
    from (select * from public.hrm_timesheet_periods t
          where (t.status = 'reviewing' and v_hr) or (t.status = 'submitted' and v_hr_manage)
          order by t.year desc, t.month desc limit v_limit) t;
    v_items := v_items || v_part;
  end if;

  -- 14. Hồ sơ nhân sự chờ duyệt (module Nhân sự) ──────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('profile_change', 'hrm', case when v_tab = 'mine' then 'approve' else 'wait' end,
        c.id::text, 'Hồ sơ',
        coalesce(e.full_name::text, 'Nhân viên') || ' cập nhật ' || case c.kind when 'address' then 'địa chỉ' when 'identity' then 'giấy tờ tùy thân'
          when 'insurance' then 'bảo hiểm' when 'dependent' then 'người phụ thuộc' when 'bank' then 'tài khoản ngân hàng' when 'tax' then 'thuế'
          when 'qualification' then 'bằng cấp' when 'certification' then 'chứng chỉ' else 'thông tin khác' end,
        case when v_tab = 'mine' then coalesce(app_private.vcc_user_name(c.requested_by::text), 'Nhân viên') || ' gửi' else 'Chờ HR duyệt' end,
        c.requested_by::text, left(c.note, 80), c.created_at, c.status,
        jsonb_build_object('changeId', c.id, 'employeeId', c.employee_id))), '[]'::jsonb)
    into v_part
    from (select * from public.hrm_profile_change_requests c
          where c.status = 'pending' and case v_tab when 'mine' then v_hr else c.requested_by = v_actor end
          order by c.created_at limit v_limit) c
    left join public.employees e on e.id = c.employee_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'profile_change'; end if;
  end if;

  -- 15. Văn bản (module Office) ───────────────────────────────────────────────────────────────
  select coalesce(jsonb_agg(app_private.vcc_item('office', 'office', d.kind, d.id::text,
      coalesce(d.document_number, t.code), d.title,
      case d.kind when 'approve' then d.creator_name || ' trình' when 'do' then d.creator_name || ' gửi'
        when 'read' then d.creator_name || ' phát hành' when 'wait' then 'Chờ ' || d.step_label else d.creator_name || ' phát hành' end,
      d.created_by::text,
      case d.kind when 'approve' then 'Duyệt nội dung' when 'do' then case when d.status = 'WAITING_NUMBER' then 'Cấp số văn bản'
          when d.status = 'RETURNED' then 'Bị trả lại để sửa' else 'Xử lý văn bản được giao' end
        when 'read' then 'Yêu cầu xác nhận đã đọc' when 'wait' then case d.status when 'PENDING_APPROVAL' then 'Đang duyệt' else 'Chờ cấp số' end
        else 'Đang theo dõi' end
        || case d.urgency when 'URGENT' then ' · khẩn' when 'VERY_URGENT' then ' · hỏa tốc' else '' end,
      coalesce(d.due_date::timestamptz, d.updated_at), d.status,
      jsonb_build_object('documentId', d.id))), '[]'::jsonb)
  into v_part
  from (
    select d.*, x.kind, x.step_label from (
      select 'approve' as kind, null::text as step_label, d.id from app_private.office_filtered('{"view":"approval"}'::jsonb) d where v_tab = 'mine'
      union all select 'do', null, d.id from app_private.office_filtered('{"view":"numbering"}'::jsonb) d where v_tab = 'mine'
      union all select 'do', null, d.id from app_private.office_filtered('{"view":"assigned"}'::jsonb) d where v_tab = 'mine'
      union all select 'do', null, d.id from app_private.office_filtered('{"view":"created","status":"RETURNED"}'::jsonb) d where v_tab = 'mine'
      union all select 'read', null, d.id from app_private.office_filtered('{"view":"unread"}'::jsonb) d where v_tab = 'mine' and d.require_acknowledgement
      union all select 'wait', coalesce((select a.label from public.office_document_approvals a where a.document_id = d.id and a.round = d.approval_round and a.status = 'PENDING' order by a.step limit 1), 'văn thư'), d.id
        from app_private.office_filtered('{"view":"created"}'::jsonb) d where v_tab = 'sent' and d.status in ('PENDING_APPROVAL', 'WAITING_NUMBER')
      union all select 'watch', null, d.id from app_private.office_filtered('{"view":"following"}'::jsonb) d where v_tab = 'watch' and d.status not in ('ARCHIVED', 'CANCELLED', 'REVOKED')
    ) x join public.office_documents d on d.id = x.id
    order by d.due_date nulls last, d.updated_at desc limit v_limit
  ) d
  left join public.office_document_types t on t.id = d.document_type_id;
  v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'office'; end if;

  -- 16. Vioo Work (module Công việc) ──────────────────────────────────────────────────────────
  if v_work then
    select coalesce(jsonb_agg(app_private.vcc_item('work', 'work', w.kind, w.id::text, w.task_code, w.title,
        case w.kind when 'approve' then coalesce(app_private.vcc_user_name(w.done_by), 'Người thực hiện') || ' nộp kết quả'
          when 'wait' then 'Đang chờ người thực hiện' when 'watch' then coalesce(app_private.vcc_user_name(w.created_by::text), '') || ' giao'
          else coalesce(app_private.vcc_user_name(w.created_by::text), '') || ' giao' end,
        w.created_by::text,
        case w.status when 'pending_acknowledgement' then 'Chờ nhận việc' when 'clarification_requested' then 'Đang hỏi lại'
          when 'not_started' then 'Chưa bắt đầu' when 'in_progress' then 'Đang làm' when 'blocked' then 'Bị chặn'
          when 'awaiting_review' then 'Chờ duyệt kết quả' when 'changes_requested' then 'Cần sửa lại' else w.status end
          || case w.priority when 'urgent' then ' · khẩn' when 'important' then ' · quan trọng' else '' end,
        w.deadline_at, w.status,
        jsonb_build_object('taskId', w.id, 'taskCode', w.task_code))), '[]'::jsonb)
    into v_part
    from (select t.*,
            case when v_tab = 'mine' and t.status = 'awaiting_review' then 'approve' when v_tab = 'mine' then 'do' when v_tab = 'sent' then 'wait' else 'watch' end as kind,
            (select x.user_id::text from public.work_task_assignments x where x.task_id = t.id and x.state = 'completed' order by x.completed_at desc nulls last limit 1) as done_by
          from public.work_tasks t
          where t.status not in ('draft', 'completed', 'cancelled') and case v_tab
            when 'mine' then
              (t.status in ('pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'changes_requested')
                and exists (select 1 from public.work_task_assignments x where x.task_id = t.id and x.user_id = v_actor
                  and x.ended_at is null and x.state not in ('completed', 'cancelled')))
              or (t.status = 'awaiting_review' and (t.reviewer_user_id = v_actor or (t.review_policy = 'creator_review' and t.created_by = v_actor)))
            when 'sent' then t.created_by = v_actor
              and not (t.status = 'awaiting_review' and (t.reviewer_user_id = v_actor or (t.review_policy = 'creator_review' and t.created_by = v_actor)))
            else t.created_by <> v_actor and exists (select 1 from public.work_task_participants x where x.task_id = t.id and x.user_id = v_actor
              and x.participant_role = 'watcher' and x.ended_at is null) end
          order by t.deadline_at nulls last, t.updated_at desc limit v_limit) w;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'work'; end if;
  end if;

  -- 17. Đặt xe (module Đặt xe) ────────────────────────────────────────────────────────────────
  if v_tab = 'mine' then
    select coalesce(jsonb_agg(app_private.vcc_item('vehicle', 'vehicle', 'approve', v.id::text, v.booking_code,
        v.purpose || ' · ' || v.destination_text,
        coalesce(v.requester_employee_name, app_private.vcc_user_name(v.requester_user_id::text), 'Nhân viên') || ' đặt',
        v.requester_user_id::text,
        to_char(v.requested_pickup_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') || ' · ' || v.passenger_count || ' người',
        v.requested_pickup_at, v.status, jsonb_build_object('bookingId', v.id))), '[]'::jsonb)
    into v_part
    from (select * from app_private.get_pending_vehicle_booking_approval_cards_impl(v_actor) order by requested_pickup_at limit v_limit) v;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'vehicle'; end if;
  elsif v_tab = 'sent' then
    select coalesce(jsonb_agg(app_private.vcc_item('vehicle', 'vehicle', 'wait', v.id::text, v.booking_code,
        v.purpose || ' · ' || v.destination_text, 'Chờ duyệt chuyến xe', v.requester_user_id::text,
        to_char(v.requested_pickup_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') || ' · ' || v.passenger_count || ' người',
        v.requested_pickup_at, v.status, jsonb_build_object('bookingId', v.id))), '[]'::jsonb)
    into v_part
    from (select * from public.vehicle_bookings v where v.requester_user_id = v_actor and v.status = 'PENDING_APPROVAL'
          order by v.requested_pickup_at limit v_limit) v;
    v_items := v_items || v_part;
  end if;

  -- 18. Kiểm kê (module Vật tư) ───────────────────────────────────────────────────────────────
  if v_tab = 'mine' then
    select coalesce(jsonb_agg(app_private.vcc_item('stock_count', 'warehouse', 'do', c.id::text, c.count_no,
        'Kiểm kê ' || coalesce(w.name, 'kho') || ' đang đếm',
        coalesce(app_private.vcc_user_name(c.created_by::text), 'Thủ kho') || ' mở', c.created_by::text,
        left(c.reason, 80), c.snapshot_at, c.status,
        jsonb_build_object('countId', c.id, 'warehouseId', c.warehouse_id))), '[]'::jsonb)
    into v_part
    from (select * from public.wms_inventory_counts c
          where c.status = 'counting' and app_private.wms_has_action('wms.inventory.edit', c.warehouse_id, null, null, null, v_actor)
          order by c.snapshot_at desc limit v_limit) c
    left join public.warehouses w on w.id = c.warehouse_id;
    v_items := v_items || v_part;
  end if;

  -- 19. Đối chiếu nhận hàng (module Mua hàng) ─────────────────────────────────────────────────
  if v_tab = 'mine' then
    select coalesce(jsonb_agg(app_private.vcc_item('reconciliation', 'procurement', 'confirm', r.id::text, o.po_number,
        'Đối chiếu ' || o.po_number || ' · đợt ' || b.delivery_no || ' · ' || coalesce(o.vendor_name, ''),
        coalesce(app_private.vcc_user_name(r.created_by::text), 'Kho') || ' lập', r.created_by::text,
        coalesce(w.name, '') || case r.decision when 'full' then ' · nhận đủ' when 'partial' then ' · nhận một phần' else ' · không nhận' end,
        r.arrival_date::timestamptz, r.status,
        jsonb_build_object('reconciliationId', r.id, 'poId', r.purchase_order_id, 'deliveryId', r.delivery_batch_id, 'warehouseId', r.warehouse_id))), '[]'::jsonb)
    into v_part
    from (select * from public.procurement_receipt_reconciliations r
          where r.status = 'open' and (
            (v_buyer and r.buyer_confirmed_by is null and r.keeper_confirmed_by is distinct from v_actor)
            or (r.keeper_confirmed_by is null and r.buyer_confirmed_by is distinct from v_actor and app_private.receipt_recon_is_keeper(r.warehouse_id)))
          order by r.created_at desc limit v_limit) r
    join public.purchase_orders o on o.id = r.purchase_order_id
    join public.purchase_order_delivery_batches b on b.id = r.delivery_batch_id
    left join public.warehouses w on w.id = r.warehouse_id;
    v_items := v_items || v_part;
  end if;

  -- 20. Phiếu quy trình (module Quy trình) ────────────────────────────────────────────────────
  -- Cùng luật "Chờ tôi duyệt" của màn /wf và process_workflow_instance_fast: người được giao bước hiện tại
  -- (giao riêng trên phiếu, không thì người mặc định của bước, hoặc đúng vai trò của bước); bước "tất cả phải
  -- duyệt" mà tôi đã duyệt thì thôi; người lập khi phiếu bị yêu cầu sửa ở bước đầu. Quản trị / quản lý mẫu
  -- không tính là "chờ tôi" (họ thấy mọi phiếu ở màn /wf). Bỏ quy trình cấp vật tư (đã có ở Dự án) và phiếu
  -- của module Yêu cầu (đã có ở mục 1) — màn /wf cũng không liệt kê hai loại này.
  select coalesce(jsonb_agg(app_private.vcc_item('wf', 'workflow', w.kind, w.id::text, w.code, w.title,
      case when w.kind = 'do' and w.revision then 'Bị yêu cầu sửa'
        when w.kind = 'wait' then 'Đang ở bước ' || coalesce(nullif(btrim(w.node_label), ''), 'xử lý')
        else coalesce(app_private.vcc_user_name(w.created_by::text), 'Người lập') || ' lập' end,
      w.created_by::text,
      coalesce(w.template_name, 'Quy trình') || case when w.kind <> 'wait' then coalesce(' · ' || nullif(btrim(w.node_label), ''), '') else '' end,
      w.due_at, w.status::text,
      jsonb_build_object('instanceId', w.id, 'nodeId', w.current_node_id))), '[]'::jsonb)
  into v_part
  from (
    select x.*,
      case when v_tab = 'sent' then 'wait' when v_tab = 'watch' then 'watch'
        when x.assigned and x.node_type = 'APPROVAL' then 'approve' else 'do' end as kind
    from (
      select i.id, i.code, i.title, i.created_by, i.current_node_id, i.status, i.created_at,
        n.label as node_label, n.type::text as node_type, t.name as template_name,
        case when nullif(n.config ->> 'slaHours', '') ~ '^[0-9]+(\.[0-9]+)?$' then
          coalesce((select max(l.created_at) from public.workflow_instance_logs l where l.instance_id = i.id), i.created_at)
            + (n.config ->> 'slaHours')::float8 * interval '1 hour' end as due_at,
        coalesce(n.type::text not in ('START', 'END')
          and (case when jsonb_typeof(i.step_assignees -> n.id::text) = 'array' and jsonb_array_length(i.step_assignees -> n.id::text) > 0
                 then (i.step_assignees -> n.id::text) ? v_me
               when jsonb_typeof(i.step_assignees -> n.id::text) = 'string' and nullif(i.step_assignees ->> n.id::text, '') is not null
                 then i.step_assignees ->> n.id::text = v_me
               else coalesce(n.config ->> 'assigneeUserId', '') = v_me end
            or (v_role is not null and nullif(n.config ->> 'assigneeRole', '') = v_role))
          and not (coalesce(n.config ->> 'approvalPolicy', 'ANY_ONE') = 'ALL'
            and jsonb_typeof(i.step_approvals -> n.id::text) = 'array' and (i.step_approvals -> n.id::text) ? v_me), false) as assigned,
        coalesce(i.created_by = v_actor
          and i.current_node_id = (select e.target_node_id from public.workflow_edges e
            join public.workflow_nodes s on s.id = e.source_node_id
            where s.template_id = i.template_id and s.type = 'START' limit 1)
          and exists (select 1 from public.workflow_instance_logs l where l.instance_id = i.id and l.action = 'REVISION_REQUESTED'), false) as revision,
        coalesce(i.watchers @> array[v_me] or t.default_watchers @> array[v_me], false) as watching
      from public.workflow_instances i
      join public.workflow_templates t on t.id = i.template_id
      join public.workflow_nodes n on n.id = i.current_node_id
      where i.status = 'RUNNING'
        and t.owner_subject_type is distinct from 'material_request' and t.owner_project_id is null
        and lower(btrim(t.name)) <> lower('Quy trình cấp vật tư công trường')
        and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(t.custom_fields) = 'array' then t.custom_fields else '[]'::jsonb end) f
          where jsonb_typeof(f) = 'object' and coalesce(btrim(f ->> '_requestTemplateId'), '') <> '')
        and not exists (select 1 from public.request_instances r where r.workflow_instance_id = i.id)
        and (v_tab <> 'sent' or i.created_by = v_actor)
    ) x
    where case v_tab
      when 'mine' then x.assigned or x.revision
      when 'sent' then not x.assigned and not x.revision
      else x.watching and x.created_by <> v_actor and not x.assigned end
    order by x.due_at nulls last, x.created_at limit v_limit
  ) w;
  v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'wf'; end if;

  -- 21. Sự cố an toàn (module Dự án) ──────────────────────────────────────────────────────────
  -- Chờ tôi: sự cố được giao cho tôi khắc phục (màn An toàn cho người được giao sửa phiếu của mình) và sự cố
  -- chờ xác nhận khắc phục ở dự án tôi có quyền xác nhận (room action safety.verify — trigger
  -- authorization_v2_enforce_safety_issue_status đòi đúng quyền này khi chuyển Đã khắc phục / Từ chối).
  -- Tôi gửi: sự cố tôi ghi nhận còn đang xử lý.
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('safety', 'project', s.kind, s.id::text, s.code, s.title,
        case s.kind when 'do' then coalesce(app_private.vcc_user_name(s.created_by), 'Cán bộ an toàn') || ' giao'
          when 'confirm' then coalesce(s.assigned_to_name, app_private.vcc_user_name(s.assigned_to_user_id), 'Người xử lý') || ' báo đã khắc phục'
          else coalesce(s.assigned_to_name || ' đang xử lý', 'Chưa giao người xử lý') end,
        coalesce(s.assigned_to_user_id, s.created_by),
        'An toàn · ' || case s.severity when 'critical' then 'nghiêm trọng' when 'high' then 'mức cao' when 'medium' then 'trung bình' else 'mức thấp' end
          || case s.status when 'rejected' then ' · bị từ chối, làm lại' when 'overdue' then ' · quá hạn' else '' end
          || coalesce(' · ' || p.code, ''),
        s.due_at, s.status,
        jsonb_build_object('safetyId', s.id, 'projectId', s.project_id, 'constructionSiteId', s.construction_site_id))), '[]'::jsonb)
    into v_part
    from (select x.*, case when v_tab = 'sent' then 'wait' when x.status = 'waiting_verification' then 'confirm' else 'do' end as kind
          from public.safety_issues x
          where case v_tab
            when 'mine' then (x.assigned_to_user_id = v_me and x.status in ('new', 'assigned', 'in_progress', 'overdue', 'rejected'))
              or (x.status = 'waiting_verification' and x.project_id is not null
                and app_private.project_actor_has_effective_room_action(v_actor, x.project_id, x.construction_site_id, 'safety', 'verify'))
            else x.created_by = v_me and x.status in ('new', 'assigned', 'in_progress', 'waiting_verification', 'overdue', 'rejected')
              and x.assigned_to_user_id is distinct from v_me end
          order by x.due_at nulls last, x.created_at desc limit v_limit) s
    left join public.projects p on p.id = s.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'safety'; end if;
  end if;

  -- Kiểm soát (K1, chủ SP 23/10/2026): lệch dữ liệu giao cho tôi sửa (luật đã bật "Báo người xử lý", phát sinh từ ngày luật tính);
  -- trưởng bộ phận (quản lý trực tiếp người xử lý) thấy khi lệch quá 3 ngày chưa xử lý. Hạn = 3 ngày từ lúc phát hiện.
  if v_tab = 'mine' then
    select coalesce(jsonb_agg(app_private.vcc_item('control',
        case c.module when 'Kho' then 'warehouse' when 'Công nợ' then 'finance' else 'procurement' end, 'do',
        c.id::text, c.object_code, c.title,
        case when v_actor = any(c.assignee_ids) then 'Lệch cần sửa' else 'Quá 3 ngày chưa xử lý' end, null,
        'Kiểm soát · ' || c.rule_title || ' · ' || c.severity, c.first_seen_at + interval '3 days', c.status,
        jsonb_build_object('findingId', c.id, 'link', c.link, 'rule', c.rule_code, 'severity', c.severity))
      order by c.severity, c.first_seen_at), '[]'::jsonb)
    into v_part
    from (select f.*, r.title rule_title, r.severity, r.module
          from public.control_findings f join public.control_rules r on r.code = f.rule_code and r.mode = 'live'
          where f.status = 'open' and not f.legacy
            and (v_actor = any(f.assignee_ids) or (v_actor = any(f.escalate_ids) and f.first_seen_at < now() - interval '3 days'))
          order by r.severity, f.first_seen_at limit v_limit) c;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'control'; end if;
  end if;

  return jsonb_build_object(
    'tab', v_tab,
    'generatedAt', now(),
    'total', jsonb_array_length(v_items),
    'truncatedSources', to_jsonb(v_truncated),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'count', s.n) order by s.source), '[]'::jsonb)
      from (select i ->> 'source' as source, count(*) as n from jsonb_array_elements(v_items) i group by 1) s),
    'items', v_items);
end $function$;
