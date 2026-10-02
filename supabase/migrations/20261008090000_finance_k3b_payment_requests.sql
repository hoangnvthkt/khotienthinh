-- ===========================================================================
-- K3b — Đề nghị chi NCC → duyệt theo ma trận → xác nhận đã chi → đảo (02/10/2026)
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/08-trung-tam-tai-chinh-k3.md mục 12; mockup .superpowers/review/work-plan/k3b.html
--
-- Luật nghiệp vụ (chủ sản phẩm duyệt 02/10):
-- * Đề nghị chi lập ở cấp công ty theo NCC, gom chứng từ của nhiều dự án; chi một phần được. Số chi không vượt phần còn nợ
--   trừ khoản chi ngoài đang chờ xác nhận và trừ phần đã nằm trong đề nghị khác chưa xong.
-- * Luồng duyệt lấy theo ma trận hiện hành và CHỐT tại lúc gửi (sửa ma trận không ảnh hưởng đề nghị đang chờ).
--   Ngưỡng xét theo số tiền cộng dồn các đề nghị cùng NCC trong 7 ngày (chống chia nhỏ né duyệt).
-- * Tách nhiệm (máy chủ chặn, kể cả Admin): người lập không duyệt; một người không duyệt hai bước; người nhận hàng / lập-chốt
--   đối soát / lập-duyệt phiếu nhập của chứng từ không duyệt và không xác nhận chi; người xác nhận chi khác người lập và người duyệt.
--   Ủy quyền tạm thời (finance_approval_delegations) đang hiệu lực được tính là người duyệt thay.
-- * Người duyệt: Duyệt / Trả lại (về người lập sửa, gửi lại) / Từ chối (kết thúc). Người lập rút được khi chưa duyệt xong.
--   Đã duyệt chưa chi thì hủy được (bắt buộc lý do). Mọi bước ghi nhật ký bất biến.
-- * Xác nhận đã chi: ngày chi, số UNC/phiếu chi (không trùng theo NCC), file UNC bắt buộc; hệ thống tách phiếu chi theo dự án
--   (supplier_payment_batches) và ghi sổ qua engine G7 (giảm công nợ, ghi dòng chi tiền dự án). Đảo phiếu chi qua engine G7.
-- * Chuyển khoản cần số tài khoản NCC (hồ sơ đối tác). Đơn vị nội bộ không chi tiền.
-- ===========================================================================

create sequence public.finance_payment_request_seq;

create table public.finance_payment_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  supplier_id text not null,
  supplier_name text not null,
  method text not null check (method in ('bank_transfer', 'cash')),
  bank_snapshot jsonb,
  planned_date date not null,
  amount numeric(18,2) not null check (amount > 0),
  note text,
  status text not null check (status in ('pending', 'returned', 'approved', 'paid', 'rejected', 'withdrawn', 'cancelled', 'reversed')),
  matrix_version_id uuid references public.finance_approval_matrix_versions(id),
  threshold_amount numeric(18,2) not null,
  prior_requests jsonb not null default '[]'::jsonb,
  route jsonb not null,
  current_step integer not null default 0,
  submission_no integer not null default 1,
  paid jsonb,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1
);
create index finance_payment_requests_supplier_idx on public.finance_payment_requests (supplier_id, created_at);

create table public.finance_payment_request_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.finance_payment_requests(id) on delete cascade,
  payable_document_id uuid not null references public.supplier_payable_documents(id),
  project_id text,
  construction_site_id text,
  document_no text not null,
  outstanding_snapshot numeric(18,2) not null,
  amount numeric(18,2) not null check (amount > 0),
  unique (request_id, payable_document_id)
);
create index finance_payment_request_lines_doc_idx on public.finance_payment_request_lines (payable_document_id);

create table public.finance_payment_request_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.finance_payment_requests(id) on delete cascade,
  submission_no integer not null,
  step_no integer,
  label text not null,
  action text not null check (action in ('submit', 'approve', 'return', 'reject', 'withdraw', 'cancel', 'paid', 'reverse')),
  actor_id uuid references public.users(id),
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index finance_payment_request_steps_req_idx on public.finance_payment_request_steps (request_id, created_at);

do $$ declare t text; begin
  foreach t in array array['finance_payment_requests', 'finance_payment_request_lines', 'finance_payment_request_steps'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app_private.finance_can(''view''))', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on sequence public.finance_payment_request_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Trợ giúp: phần đã giữ trong đề nghị khác, người đã xử lý chứng từ, luồng duyệt
-- ---------------------------------------------------------------------------
create function app_private.finance_doc_reserved(p_doc uuid, p_exclude uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.amount), 0) from public.finance_payment_request_lines l join public.finance_payment_requests r on r.id = l.request_id
  where l.payable_document_id = p_doc and r.status in ('pending', 'returned', 'approved') and r.id is distinct from p_exclude;
$$;

-- Người đã nhận hàng / lập-chốt-ghi đối soát / lập-duyệt phiếu nhập của chứng từ: không duyệt, không xác nhận chi.
create function app_private.finance_doc_handlers(p_doc uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_remove(array_agg(distinct u), null), '{}'::uuid[]) from (
    select b.received_by u from public.supplier_payable_documents d join public.purchase_order_delivery_batches b on b.id::text = d.source_id
      where d.id = p_doc and d.source_type = 'purchase_delivery_receipt'
    union all select s.created_by from public.supplier_payable_documents d join public.supplier_delivery_statements s on s.id::text = d.source_id
      where d.id = p_doc and d.source_type = 'supplier_delivery_statement'
    union all select s.posted_by from public.supplier_payable_documents d join public.supplier_delivery_statements s on s.id::text = d.source_id
      where d.id = p_doc and d.source_type = 'supplier_delivery_statement'
    union all select x from public.supplier_payable_documents d join public.transactions t on t.id = d.source_id
      cross join lateral unnest(array[t.created_by, t.requester_id, t.approver_id]) x
      where d.id = p_doc and d.source_type = 'direct_supplier_receipt'
  ) q;
$$;

create function app_private.finance_active_delegates(p_user uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct to_user_id), '{}'::uuid[]) from public.finance_approval_delegations
  where from_user_id = p_user and revoked_at is null
    and (now() at time zone 'Asia/Ho_Chi_Minh')::date between valid_from and valid_to;
$$;

-- Luồng duyệt cho số tiền (cộng dồn 7 ngày cùng NCC), loại người lập + người đã xử lý chứng từ.
create function app_private.finance_payment_route(p_supplier text, p_amount numeric, p_docs uuid[], p_creator uuid, p_exclude uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_version uuid; v_prior numeric; v_prior_codes jsonb; v_threshold numeric; v_rule record; v_steps jsonb := '[]'::jsonb; s jsonb;
  v_handlers uuid[]; v_ids uuid[]; v_eligible uuid[]; v_problem text;
begin
  select id into v_version from public.finance_approval_matrix_versions where is_current;
  select coalesce(sum(amount), 0), coalesce(jsonb_agg(jsonb_build_object('code', code, 'amount', amount, 'status', status) order by created_at), '[]'::jsonb)
    into v_prior, v_prior_codes
  from public.finance_payment_requests
  where supplier_id = p_supplier and status in ('pending', 'returned', 'approved', 'paid') and id is distinct from p_exclude
    and created_at >= now() - interval '7 days';
  v_threshold := p_amount + v_prior;
  select * into v_rule from public.finance_approval_rules where version_id = v_version
    and (v_threshold > min_amount or min_amount = 0) and (max_amount is null or v_threshold <= max_amount)
  order by tier_no limit 1;
  if not found then raise exception using errcode = 'P0001', message = 'FINANCE_MATRIX_MISSING'; end if;
  select coalesce(array_agg(distinct h), '{}'::uuid[]) into v_handlers from unnest(p_docs) d cross join lateral unnest(app_private.finance_doc_handlers(d)) h;
  for s in select value from jsonb_array_elements(v_rule.steps) loop
    select coalesce(array_agg((x)::uuid), '{}'::uuid[]) into v_ids from jsonb_array_elements_text(s->'approverIds') x;
    select coalesce(array_agg(distinct u), '{}'::uuid[]) into v_eligible
    from (select unnest(v_ids) u union select unnest(app_private.finance_active_delegates(i)) from unnest(v_ids) i) q
    join public.users usr on usr.id = q.u and coalesce(usr.is_active, true)
    where q.u is distinct from p_creator and not (q.u = any(v_handlers));
    if cardinality(v_eligible) = 0 and v_problem is null then v_problem := s->>'label'; end if;
    v_steps := v_steps || jsonb_build_object('label', s->>'label', 'approverIds', to_jsonb(v_ids), 'eligibleIds', to_jsonb(v_eligible),
      'approverNames', (select coalesce(jsonb_agg(app_private.finance_user_name(i)), '[]'::jsonb) from unnest(v_ids) i),
      'eligibleNames', (select coalesce(jsonb_agg(app_private.finance_user_name(i)), '[]'::jsonb) from unnest(v_eligible) i));
  end loop;
  return jsonb_build_object('versionId', v_version, 'tierNo', v_rule.tier_no, 'amount', p_amount, 'priorAmount', v_prior, 'priorRequests', v_prior_codes,
    'thresholdAmount', v_threshold, 'steps', v_steps, 'handlers', to_jsonb(v_handlers),
    'handlerNames', (select coalesce(jsonb_agg(app_private.finance_user_name(h)), '[]'::jsonb) from unnest(v_handlers) h), 'problemStep', v_problem);
end $$;

create function app_private.finance_notify(p_users uuid[], p_title text, p_message text, p_request uuid, p_actor uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
    priority, push_enabled, metadata, delivery_reason)
  select u::text, 'info', 'finance', p_title, p_message, p_message, 'info', '🏦', '/#/finance?section=requests&request=' || p_request,
    'finance_payment_request', 'finance_payment_request:' || p_request || ':' || gen_random_uuid(), 'high', true, '{}'::jsonb, 'responsible'
  from (select distinct unnest(p_users) u) q where u is not null and u is distinct from p_actor;
$$;

-- Kiểm tra và giữ dòng chứng từ cho một đề nghị (dùng khi lập / gửi lại / xác nhận chi).
create function app_private.finance_check_request_lines(p_supplier text, p_lines jsonb, p_exclude uuid)
returns table (doc_id uuid, amount numeric, project_id text, site_id text, document_no text, outstanding numeric, source_type text, source_id text, recognized numeric, paid numeric)
language plpgsql security definer set search_path = '' as $$
declare a jsonb; d record; v_amount numeric; v_seen uuid[] := '{}';
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ALLOCATIONS_REQUIRED'; end if;
  for a in select value from jsonb_array_elements(p_lines) loop
    v_amount := round(nullif(a->>'amount', '')::numeric, 2);
    if v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
    select r.* into d from app_private.finance_payable_rows() r where r.id = (a->>'documentId')::uuid;
    if not found or d.supplier_id is distinct from p_supplier or d.status not in ('open', 'partial') then
      raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_SCOPE'; end if;
    if d.id = any(v_seen) then raise exception using errcode = '22023', message = 'FINANCE_DUPLICATE_DOCUMENT'; end if;
    v_seen := v_seen || d.id;
    perform 1 from public.supplier_payable_documents where id = d.id for update;
    if v_amount > d.outstanding - d.pending_external - app_private.finance_doc_reserved(d.id, p_exclude) + 0.005 then
      raise exception using errcode = '22023', message = 'FINANCE_OVER_OUTSTANDING'; end if;
    doc_id := d.id; amount := v_amount; project_id := d.project_id; site_id := d.construction_site_id; document_no := d.document_no;
    outstanding := d.outstanding; source_type := d.source_type; source_id := d.source_id; recognized := d.recognized; paid := d.paid;
    return next;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Xem trước luồng duyệt (để người lập thấy ai duyệt, cảnh báo cộng dồn / thiếu người duyệt / thiếu TK)
-- ---------------------------------------------------------------------------
create function public.preview_finance_payment_request_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_supplier text := p_input->>'supplierId'; v_req uuid := nullif(p_input->>'requestId', '')::uuid;
  v_total numeric; v_docs uuid[]; v_bp record;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select coalesce(sum(round(nullif(a->>'amount', '')::numeric, 2)), 0), coalesce(array_agg((a->>'documentId')::uuid), '{}'::uuid[]) into v_total, v_docs
  from jsonb_array_elements(coalesce(p_input->'lines', '[]'::jsonb)) a;
  select id, name, bank_name, bank_account, tax_code into v_bp from public.business_partners where id = v_supplier;
  return jsonb_build_object('route', app_private.finance_payment_route(v_supplier, greatest(v_total, 0.01), v_docs, v_actor, v_req),
    'bank', case when nullif(btrim(coalesce(v_bp.bank_account, '')), '') is null then null else jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
    'internal', exists (select 1 from public.finance_internal_partners where supplier_id = v_supplier),
    'reserved', (select coalesce(jsonb_object_agg(d::text, app_private.finance_doc_reserved(d, v_req)), '{}'::jsonb) from unnest(v_docs) d),
    'canRecord', app_private.finance_can('record'));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Lập / gửi lại đề nghị chi
-- ---------------------------------------------------------------------------
create function public.save_finance_payment_request_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_supplier text := p_input->>'supplierId'; v_req public.finance_payment_requests%rowtype;
  v_method text := coalesce(nullif(p_input->>'method', ''), 'bank_transfer'); v_date date := nullif(p_input->>'plannedDate', '')::date;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_bp record; v_total numeric; v_docs uuid[]; v_route jsonb; v_id uuid;
  v_code text; v_submission integer := 1;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_method not in ('bank_transfer', 'cash') then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_METHOD_INVALID'; end if;
  if v_date is null or v_date < v_today - 30 then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
  if exists (select 1 from public.finance_internal_partners where supplier_id = v_supplier) then
    raise exception using errcode = '22023', message = 'FINANCE_INTERNAL_PARTNER'; end if;
  select id, name, bank_name, bank_account into v_bp from public.business_partners where id = v_supplier;
  if not found then raise exception using errcode = '22023', message = 'FINANCE_SUPPLIER_NOT_FOUND'; end if;
  if v_method = 'bank_transfer' and nullif(btrim(coalesce(v_bp.bank_account, '')), '') is null then
    raise exception using errcode = '22023', message = 'FINANCE_SUPPLIER_BANK_REQUIRED'; end if;
  if nullif(p_input->>'requestId', '') is not null then
    select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
    if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_req.status <> 'returned' or v_req.created_by is distinct from v_actor then
      raise exception using errcode = '42501', message = 'FINANCE_REQUEST_STATE'; end if;
    if v_req.supplier_id is distinct from v_supplier then raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_SCOPE'; end if;
    v_submission := v_req.submission_no + 1;
  end if;

  create temp table if not exists pg_temp.fin_req_lines (doc_id uuid, amount numeric, project_id text, site_id text, document_no text, outstanding numeric,
    source_type text, source_id text, recognized numeric, paid numeric) on commit drop;
  truncate pg_temp.fin_req_lines;
  insert into pg_temp.fin_req_lines select * from app_private.finance_check_request_lines(v_supplier, p_input->'lines', v_req.id);
  select sum(amount), array_agg(doc_id) into v_total, v_docs from pg_temp.fin_req_lines;
  v_route := app_private.finance_payment_route(v_supplier, v_total, v_docs, v_actor, v_req.id);
  if v_route->>'problemStep' is not null then
    raise exception using errcode = '22023', message = 'FINANCE_NO_ELIGIBLE_APPROVER: ' || (v_route->>'problemStep'); end if;

  if v_req.id is null then
    v_code := 'ĐNC-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.finance_payment_request_seq')::text, 3, '0');
    insert into public.finance_payment_requests (code, supplier_id, supplier_name, method, bank_snapshot, planned_date, amount, note, status,
      matrix_version_id, threshold_amount, prior_requests, route, current_step, created_by)
    values (v_code, v_supplier, v_bp.name, v_method,
      case when v_method = 'bank_transfer' then jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
      v_date, v_total, nullif(btrim(p_input->>'note'), ''), 'pending', (v_route->>'versionId')::uuid, (v_route->>'thresholdAmount')::numeric,
      v_route->'priorRequests', v_route->'steps', 0, v_actor)
    returning id into v_id;
  else
    v_id := v_req.id;
    delete from public.finance_payment_request_lines where request_id = v_id;
    update public.finance_payment_requests set method = v_method,
      bank_snapshot = case when v_method = 'bank_transfer' then jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
      planned_date = v_date, amount = v_total, note = nullif(btrim(p_input->>'note'), ''), status = 'pending',
      matrix_version_id = (v_route->>'versionId')::uuid, threshold_amount = (v_route->>'thresholdAmount')::numeric, prior_requests = v_route->'priorRequests',
      route = v_route->'steps', current_step = 0, submission_no = v_submission, submitted_at = now(), decided_at = null,
      updated_at = now(), row_version = row_version + 1
    where id = v_id;
  end if;
  insert into public.finance_payment_request_lines (request_id, payable_document_id, project_id, construction_site_id, document_no, outstanding_snapshot, amount)
  select v_id, doc_id, project_id, site_id, document_no, outstanding, amount from pg_temp.fin_req_lines;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, payload)
  values (v_id, v_submission, case when v_submission = 1 then 'Lập và gửi duyệt' else 'Sửa và gửi lại' end, 'submit', v_actor,
    jsonb_build_object('amount', v_total, 'thresholdAmount', v_route->'thresholdAmount', 'tierNo', v_route->'tierNo'));
  select code into v_code from public.finance_payment_requests where id = v_id;
  perform app_private.finance_notify(array(select jsonb_array_elements_text(v_route->'steps'->0->'eligibleIds')::uuid),
    'Đề nghị chi chờ bạn duyệt', v_code || ' · ' || v_bp.name || ' · ' || to_char(v_total, 'FM999G999G999G990') || ' đ', v_id, v_actor);
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('payment_request', v_id::text, v_supplier, 'payment_request_submit', v_actor, jsonb_build_object('code', v_code, 'amount', v_total, 'submission', v_submission));
  return jsonb_build_object('requestId', v_id, 'code', v_code, 'amount', v_total, 'route', v_route);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Duyệt / trả lại / từ chối / rút / hủy
-- ---------------------------------------------------------------------------
create function public.decide_finance_payment_request_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_req public.finance_payment_requests%rowtype; v_step jsonb; v_label text; v_eligible boolean; v_next jsonb; v_confirmers uuid[];
begin
  select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
  if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_action in ('approve', 'return', 'reject') then
    if v_req.status <> 'pending' then raise exception using errcode = '22023', message = 'FINANCE_REQUEST_STATE'; end if;
    v_step := v_req.route->v_req.current_step; v_label := v_step->>'label';
    -- Người duyệt hợp lệ: trong danh sách (đã loại người lập / người xử lý chứng từ) hoặc đang được ủy quyền; chưa duyệt bước khác.
    v_eligible := v_actor is not null and v_actor is distinct from v_req.created_by
      and (v_actor::text in (select jsonb_array_elements_text(v_step->'eligibleIds'))
        or exists (select 1 from jsonb_array_elements_text(v_step->'approverIds') a where v_actor = any(app_private.finance_active_delegates(a::uuid))))
      and not (v_actor = any(select unnest(app_private.finance_doc_handlers(l.payable_document_id)) from public.finance_payment_request_lines l where l.request_id = v_req.id))
      and not exists (select 1 from public.finance_payment_request_steps s where s.request_id = v_req.id and s.submission_no = v_req.submission_no
        and s.action = 'approve' and s.actor_id = v_actor);
    if not v_eligible then raise exception using errcode = '42501', message = 'FINANCE_NOT_APPROVER'; end if;
    if v_action in ('return', 'reject') and v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    insert into public.finance_payment_request_steps (request_id, submission_no, step_no, label, action, actor_id, reason)
    values (v_req.id, v_req.submission_no, v_req.current_step, v_label, v_action, v_actor, v_reason);
    if v_action = 'approve' then
      if v_req.current_step + 1 >= jsonb_array_length(v_req.route) then
        update public.finance_payment_requests set current_step = current_step + 1, status = 'approved', decided_at = now(), updated_at = now(), row_version = row_version + 1
        where id = v_req.id;
        select coalesce(array_agg(u.id), '{}') into v_confirmers from public.users u where coalesce(u.is_active, true)
          and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.finance.confirm'));
        perform app_private.finance_notify(v_confirmers || v_req.created_by, 'Đề nghị chi đã duyệt — chờ chi', v_req.code || ' · ' || v_req.supplier_name, v_req.id, v_actor);
      else
        update public.finance_payment_requests set current_step = current_step + 1, updated_at = now(), row_version = row_version + 1 where id = v_req.id;
        v_next := v_req.route->(v_req.current_step + 1);
        perform app_private.finance_notify(array(select jsonb_array_elements_text(v_next->'eligibleIds')::uuid), 'Đề nghị chi chờ bạn duyệt',
          v_req.code || ' · ' || v_req.supplier_name || ' — ' || (v_next->>'label'), v_req.id, v_actor);
      end if;
    else
      update public.finance_payment_requests set status = case v_action when 'return' then 'returned' else 'rejected' end,
        decided_at = now(), updated_at = now(), row_version = row_version + 1 where id = v_req.id;
      perform app_private.finance_notify(array[v_req.created_by], case v_action when 'return' then 'Đề nghị chi bị trả lại' else 'Đề nghị chi bị từ chối' end,
        v_req.code || ': ' || v_reason, v_req.id, v_actor);
    end if;
  elsif v_action = 'withdraw' then
    if v_req.status not in ('pending', 'returned') or v_req.created_by is distinct from v_actor then
      raise exception using errcode = '42501', message = 'FINANCE_WITHDRAW_DENIED'; end if;
    update public.finance_payment_requests set status = 'withdrawn', decided_at = now(), updated_at = now(), row_version = row_version + 1 where id = v_req.id;
    insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, reason)
    values (v_req.id, v_req.submission_no, 'Người lập rút đề nghị', 'withdraw', v_actor, v_reason);
  elsif v_action = 'cancel' then
    if v_req.status <> 'approved' then raise exception using errcode = '22023', message = 'FINANCE_REQUEST_STATE'; end if;
    if not (v_actor = v_req.created_by or app_private.finance_can('confirm')) then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    update public.finance_payment_requests set status = 'cancelled', decided_at = now(), updated_at = now(), row_version = row_version + 1 where id = v_req.id;
    insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, reason)
    values (v_req.id, v_req.submission_no, 'Hủy đề nghị đã duyệt', 'cancel', v_actor, v_reason);
    perform app_private.finance_notify(array[v_req.created_by], 'Đề nghị chi đã bị hủy', v_req.code || ': ' || v_reason, v_req.id, v_actor);
  else
    raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID';
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('payment_request', v_req.id::text, v_req.supplier_id, 'payment_request_' || v_action, v_actor, v_reason,
    jsonb_build_object('code', v_req.code, 'amount', v_req.amount, 'step', v_req.current_step));
  select * into v_req from public.finance_payment_requests where id = v_req.id;
  return jsonb_build_object('requestId', v_req.id, 'status', v_req.status, 'currentStep', v_req.current_step, 'rowVersion', v_req.row_version);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Xác nhận đã chi → phiếu chi theo dự án, ghi sổ G7; đảo phiếu chi
-- ---------------------------------------------------------------------------
create function public.confirm_finance_payment_request_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_req public.finance_payment_requests%rowtype;
  v_date date := nullif(p_input->>'paymentDate', '')::date; v_ref text := nullif(btrim(p_input->>'documentRef'), '');
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_lines jsonb; g record; v_bid uuid; v_batches jsonb := '[]'::jsonb;
  v_last_approver uuid;
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
  if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_req.status <> 'approved' then raise exception using errcode = '22023', message = 'FINANCE_REQUEST_STATE'; end if;
  if v_actor = v_req.created_by or exists (select 1 from public.finance_payment_request_steps s where s.request_id = v_req.id
      and s.submission_no = v_req.submission_no and s.action = 'approve' and s.actor_id = v_actor)
    or v_actor = any(select unnest(app_private.finance_doc_handlers(l.payable_document_id)) from public.finance_payment_request_lines l where l.request_id = v_req.id) then
    raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
  if v_date is null or v_date > v_today then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
  if v_ref is null then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_REF_REQUIRED'; end if;
  if jsonb_typeof(p_input->'attachments') is distinct from 'array' or jsonb_array_length(p_input->'attachments') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
  if exists (select 1 from public.supplier_payment_batches where supplier_id = v_req.supplier_id and document_ref = v_ref and status in ('submitted', 'paid')) then
    raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_REF_DUPLICATE'; end if;
  select actor_id into v_last_approver from public.finance_payment_request_steps where request_id = v_req.id and submission_no = v_req.submission_no
    and action = 'approve' order by created_at desc limit 1;

  -- Kiểm lại phần còn nợ tại lúc chi (có thể đã chi ngoài trong lúc chờ).
  select jsonb_agg(jsonb_build_object('documentId', payable_document_id, 'amount', amount)) into v_lines from public.finance_payment_request_lines where request_id = v_req.id;
  create temp table if not exists pg_temp.fin_pay_lines (doc_id uuid, amount numeric, project_id text, site_id text, document_no text, outstanding numeric,
    source_type text, source_id text, recognized numeric, paid numeric) on commit drop;
  truncate pg_temp.fin_pay_lines;
  insert into pg_temp.fin_pay_lines select * from app_private.finance_check_request_lines(v_req.supplier_id, v_lines, v_req.id);

  perform set_config('app.finance_context', 'on', true);
  for g in select project_id, site_id, sum(amount) total, sum(recognized) recognized from pg_temp.fin_pay_lines group by project_id, site_id loop
    v_bid := gen_random_uuid();
    insert into public.supplier_payment_batches (id, code, project_id, construction_site_id, supplier_id, supplier_name_snapshot, payment_date, payment_method,
      bank_account_snapshot, document_ref, total_recognized_snapshot, payment_amount, currency, allocation_mode, status, attachments, metadata, created_by, approved_by, approved_at, note)
    values (v_bid, 'PC-' || to_char(v_today, 'YYMMDD') || '-' || upper(substr(replace(v_bid::text, '-', ''), 1, 5)), g.project_id, g.site_id, v_req.supplier_id,
      v_req.supplier_name, v_date, v_req.method, v_req.bank_snapshot->>'account', v_ref, g.recognized, g.total, 'VND', 'manual', 'submitted', p_input->'attachments',
      jsonb_build_object('kind', 'payment_request', 'requestId', v_req.id, 'requestCode', v_req.code)
        || case when g.project_id is null and g.site_id is null then jsonb_build_object('scope', 'company') else '{}'::jsonb end,
      v_req.created_by, v_last_approver, now(), nullif(btrim(p_input->>'note'), ''));
    insert into public.supplier_payment_allocations (payment_batch_id, payable_document_id, source_type, source_id, document_no_snapshot,
      recognized_amount_snapshot, paid_before_snapshot, outstanding_before_snapshot, allocated_amount, allocation_mode, note)
    select v_bid, doc_id, source_type, source_id, document_no, recognized, paid, outstanding, amount, 'manual', v_req.code
    from pg_temp.fin_pay_lines l where l.project_id is not distinct from g.project_id and l.site_id is not distinct from g.site_id;
    perform app_private.post_supplier_payment_batch(v_bid, v_actor);
    v_batches := v_batches || jsonb_build_object('batchId', v_bid, 'projectId', g.project_id, 'amount', g.total);
  end loop;
  perform set_config('app.finance_context', 'off', true);

  update public.finance_payment_requests set status = 'paid', updated_at = now(), row_version = row_version + 1,
    paid = jsonb_build_object('paymentDate', v_date, 'documentRef', v_ref, 'attachments', p_input->'attachments', 'batches', v_batches,
      'by', v_actor, 'byName', app_private.finance_user_name(v_actor), 'at', now(), 'note', nullif(btrim(p_input->>'note'), ''))
  where id = v_req.id;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, payload)
  values (v_req.id, v_req.submission_no, 'Xác nhận đã chi ' || v_ref, 'paid', v_actor, jsonb_build_object('batches', v_batches, 'paymentDate', v_date));
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('payment_request', v_req.id::text, v_req.supplier_id, 'payment_request_paid', v_actor,
    jsonb_build_object('code', v_req.code, 'amount', v_req.amount, 'documentRef', v_ref, 'batches', v_batches));
  perform app_private.finance_notify(array[v_req.created_by], 'Đề nghị chi đã chi', v_req.code || ' · ' || v_ref, v_req.id, v_actor);
  return jsonb_build_object('requestId', v_req.id, 'status', 'paid', 'batches', v_batches);
exception when others then
  perform set_config('app.finance_context', 'off', true);
  raise;
end $$;

create function public.reverse_finance_payment_request_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_req public.finance_payment_requests%rowtype; v_reason text := nullif(btrim(p_input->>'reason'), ''); b jsonb;
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
  if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_req.status <> 'paid' then raise exception using errcode = '22023', message = 'FINANCE_REQUEST_STATE'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  perform set_config('app.finance_context', 'on', true);
  for b in select value from jsonb_array_elements(v_req.paid->'batches') loop
    perform app_private.reverse_supplier_payment_batch((b->>'batchId')::uuid, v_actor);
    update public.supplier_payment_batches set metadata = metadata || jsonb_build_object('g7ReversalReason', v_reason) where id = (b->>'batchId')::uuid;
  end loop;
  perform set_config('app.finance_context', 'off', true);
  update public.finance_payment_requests set status = 'reversed', updated_at = now(), row_version = row_version + 1,
    paid = paid || jsonb_build_object('reversal', jsonb_build_object('reason', v_reason, 'by', v_actor, 'byName', app_private.finance_user_name(v_actor), 'at', now()))
  where id = v_req.id;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, reason)
  values (v_req.id, v_req.submission_no, 'Đảo phiếu chi', 'reverse', v_actor, v_reason);
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('payment_request', v_req.id::text, v_req.supplier_id, 'payment_request_reverse', v_actor, v_reason, jsonb_build_object('code', v_req.code, 'amount', v_req.amount));
  perform app_private.finance_notify(array[v_req.created_by], 'Phiếu chi đã bị đảo', v_req.code || ': ' || v_reason, v_req.id, v_actor);
  return jsonb_build_object('requestId', v_req.id, 'status', 'reversed');
exception when others then
  perform set_config('app.finance_context', 'off', true);
  raise;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Danh sách cho các bước Đề nghị chi / Chờ chi / Đã chi
-- ---------------------------------------------------------------------------
create function public.list_finance_payment_requests_v1(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_stage text := coalesce(nullif(p_filter->>'stage', ''), 'request');
  v_confirm boolean := app_private.finance_can('confirm'); v_record boolean := app_private.finance_can('record');
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return jsonb_build_object(
    'counts', (select jsonb_build_object(
      'request', count(*) filter (where status in ('pending', 'returned')),
      'approved', count(*) filter (where status = 'approved'),
      'approvedAmount', coalesce(sum(amount) filter (where status = 'approved'), 0),
      'paid', count(*) filter (where status in ('paid', 'reversed')),
      'waitingMe', count(*) filter (where status = 'pending' and v_actor is distinct from created_by
        and v_actor::text in (select jsonb_array_elements_text(route->current_step->'eligibleIds'))
        and not exists (select 1 from public.finance_payment_request_steps s where s.request_id = r.id and s.submission_no = r.submission_no
          and s.action = 'approve' and s.actor_id = v_actor)))
      from public.finance_payment_requests r),
    'requests', coalesce((select jsonb_agg(x order by (x->>'createdAt') desc) from (
      select jsonb_build_object('id', r.id, 'code', r.code, 'supplierId', r.supplier_id, 'supplierName', r.supplier_name, 'method', r.method,
        'bank', r.bank_snapshot, 'plannedDate', r.planned_date, 'amount', r.amount, 'note', r.note, 'status', r.status, 'route', r.route,
        'currentStep', r.current_step, 'thresholdAmount', r.threshold_amount, 'priorRequests', r.prior_requests, 'paid', r.paid,
        'createdBy', r.created_by, 'createdByName', app_private.finance_user_name(r.created_by), 'createdAt', r.created_at, 'rowVersion', r.row_version,
        'submissionNo', r.submission_no,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object('documentId', l.payable_document_id, 'documentNo', l.document_no, 'code', d.code,
            'sourceType', d.source_type, 'projectId', l.project_id, 'projectCode', (select code from public.projects p where p.id = l.project_id),
            'amount', l.amount, 'outstandingSnapshot', l.outstanding_snapshot, 'dueDate', d.due_date) order by d.due_date nulls last), '[]'::jsonb)
          from public.finance_payment_request_lines l join public.supplier_payable_documents d on d.id = l.payable_document_id where l.request_id = r.id),
        'steps', (select coalesce(jsonb_agg(jsonb_build_object('submissionNo', s.submission_no, 'stepNo', s.step_no, 'label', s.label, 'action', s.action,
            'actorName', app_private.finance_user_name(s.actor_id), 'reason', s.reason, 'at', s.created_at) order by s.created_at), '[]'::jsonb)
          from public.finance_payment_request_steps s where s.request_id = r.id),
        'approvedBy', (select coalesce(jsonb_agg(s.actor_id), '[]'::jsonb) from public.finance_payment_request_steps s
          where s.request_id = r.id and s.submission_no = r.submission_no and s.action = 'approve'),
        'canApprove', r.status = 'pending' and v_actor is distinct from r.created_by
          and v_actor::text in (select jsonb_array_elements_text(r.route->r.current_step->'eligibleIds'))
          and not exists (select 1 from public.finance_payment_request_steps s where s.request_id = r.id and s.submission_no = r.submission_no
            and s.action = 'approve' and s.actor_id = v_actor),
        'canWithdraw', r.status in ('pending', 'returned') and r.created_by = v_actor,
        'canResubmit', r.status = 'returned' and r.created_by = v_actor and v_record,
        'canCancel', r.status = 'approved' and (r.created_by = v_actor or v_confirm),
        'canConfirm', r.status = 'approved' and v_confirm and v_actor is distinct from r.created_by
          and not exists (select 1 from public.finance_payment_request_steps s where s.request_id = r.id and s.submission_no = r.submission_no
            and s.action = 'approve' and s.actor_id = v_actor)
          and not (v_actor = any(select unnest(app_private.finance_doc_handlers(l.payable_document_id)) from public.finance_payment_request_lines l where l.request_id = r.id)),
        'canReverse', r.status = 'paid' and v_confirm) x
      from public.finance_payment_requests r
      where (v_stage = 'request' and r.status in ('pending', 'returned'))
         or (v_stage = 'approved' and r.status = 'approved')
         or (v_stage = 'paid' and r.status in ('paid', 'reversed'))
         or (v_stage = 'closed' and r.status in ('rejected', 'withdrawn', 'cancelled'))
         or (v_stage = 'all')
    ) q), '[]'::jsonb));
end $$;

revoke all on function app_private.finance_doc_reserved(uuid, uuid), app_private.finance_doc_handlers(uuid), app_private.finance_active_delegates(uuid),
  app_private.finance_payment_route(text, numeric, uuid[], uuid, uuid), app_private.finance_notify(uuid[], text, text, uuid, uuid),
  app_private.finance_check_request_lines(text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.preview_finance_payment_request_v1(jsonb), public.save_finance_payment_request_v1(jsonb), public.decide_finance_payment_request_v1(jsonb),
  public.confirm_finance_payment_request_v1(jsonb), public.reverse_finance_payment_request_v1(jsonb), public.list_finance_payment_requests_v1(jsonb) from public, anon;
grant execute on function public.preview_finance_payment_request_v1(jsonb), public.save_finance_payment_request_v1(jsonb), public.decide_finance_payment_request_v1(jsonb),
  public.confirm_finance_payment_request_v1(jsonb), public.reverse_finance_payment_request_v1(jsonb), public.list_finance_payment_requests_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
