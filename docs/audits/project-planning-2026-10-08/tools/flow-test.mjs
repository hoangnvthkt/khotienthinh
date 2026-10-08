// Kiểm thử luồng Kế hoạch thi công → Kế hoạch vật tư → Mua hàng → Thực hiện (Chốt tiến độ / Nhật ký)
// trên dữ liệu thật SMB-2026, toàn bộ trong một giao dịch begin … ROLLBACK: không ghi lại gì.
// Kỳ thử: tháng 11/2026 (tuần 02/11, 09/11) để không đụng kế hoạch đang dùng của tháng 10.
// Chạy: node docs/audits/project-planning-2026-10-08/tools/flow-test.mjs
import { readFileSync } from 'node:fs'; import { parseEnv } from 'node:util';
const e = parseEnv(readFileSync('/Users/admin/khotienthinh/.env', 'utf8'));
// --migration: nạp thử migration "chỉ KH vật tư tuần vào Mua hàng" trong cùng giao dịch (vẫn rollback).
const mig = process.argv.includes('--migration')
  ? readFileSync(new URL('../../../../supabase/migrations/20261009150000_material_plan_week_to_procurement.sql', import.meta.url), 'utf8') : '';

const P = 'b4ce0810-2cac-44af-a83f-8bb1a361567a', S = '240ac280-756d-4955-b612-41661e7aedaf';
const KHOI = 'dfc81157-ecde-4ad1-b9fc-f2938c14e859' /* KS: view/edit/submit */, THANH = 'f16b6505-83d8-438e-b680-5f469f734b91' /* KS */;
const SON = 'd0a300a0-1586-4748-b6e7-71773addc004' /* CHT: verify */, ADMIN = 'e99f1b85-ab8e-49ee-b068-e100fe698533' /* Admin Hoàng: approve */;
const T1 = 'b80927c2-ab03-4c5a-8595-9fd8335b53b2', T2 = 'df27fc82-0473-4f25-9897-b15d650c2bec', T3 = 'a679736b-3c96-4e30-bc05-3dc472e6f879';
const M = '2026-11-01', W1 = '2026-11-02', W2 = '2026-11-09';

const as = s => `reset role; select set_config('request.jwt.claims',$c$${JSON.stringify({ sub: s, role: 'authenticated' })}$c$,true); select set_config('request.path','/rpc/x',true); set local role authenticated;`;
const T = (k, expr) => `do $x$ begin insert into t(k,v) select '${k}', (${expr})::text; exception when others then insert into t(k,v) values('${k}','LỖI '||sqlerrm); end $x$;`;
const id = k => `(select v from ids where k='${k}')`;
const rv = k => `(select row_version from public.project_work_plans where id=${id(k)}::uuid)`;
const mrv = k => `(select row_version from public.project_material_plans where id=${id(k)}::uuid)`;
const keep = (k, expr) => `do $x$ begin insert into ids(k,v) select '${k}', (${expr})->>'planId'; insert into t(k,v) values('${k}','OK'); exception when others then insert into t(k,v) values('${k}','LỖI '||sqlerrm); end $x$;`;
const line = (task, qty, s, en) => ({ taskId: task, plannedQty: qty, plannedStart: s, plannedEnd: en, crewLabel: 'Tổ thử', note: null });
const newPlan = (type, start, lines) => `public.save_project_work_plan_v1($j$${JSON.stringify({ projectId: P, constructionSiteId: S, periodType: type, periodStart: start, note: 'thử', lines })}$j$::jsonb)`;
const resave = (k, lines, extra = {}) => `public.save_project_work_plan_v1(jsonb_build_object('planId', ${id(k)}, 'expectedRowVersion', ${rv(k)}) || $j$${JSON.stringify({ note: 'thử', lines, ...extra })}$j$::jsonb)`;
const tr = (k, action, extra = '') => `public.transition_project_work_plan_v1(jsonb_build_object('planId', ${id(k)}, 'expectedRowVersion', ${rv(k)}, 'action', '${action}'${extra}))`;
const mtr = (k, action, extra = '') => `public.transition_project_material_plan_v1(jsonb_build_object('planId', ${id(k)}, 'expectedRowVersion', ${mrv(k)}, 'action', '${action}'${extra}))`;
const st = k => `(select status || ' · bản ' || revision_no from public.project_work_plans where id=${id(k)}::uuid)`;
const mst = k => `(select status || ' · bản ' || revision_no || ' · ' || (select count(*) from public.project_material_plan_lines l where l.plan_id=p.id and l.requested_qty>0) || ' vật tư có SL đề nghị' from public.project_material_plans p where id=${id(k)}::uuid)`;
const notes = k => `(select count(*) || ' thông báo → ' || coalesce(string_agg(distinct u.name, ', '), '-') from public.notifications n join public.users u on u.id::text = n.user_id where n.source_id like 'work_plan_' || ${id(k)} || ':%' or n.source_id like 'material_plan_' || ${id(k)} || ':%')`;
const board = (type, start, path) => `(select ${path} from public.get_project_work_plan_board_v1('${P}', '${S}', '${type}', '${start}') b)`;
const actual = (type, start, task) => board(type, start, `coalesce((select x->>'actualQty' from jsonb_array_elements(b->'approved'->'lines') x where x->>'taskId'='${task}'), 'null (Chưa có số liệu)')`);

const MONTH = [line(T1, 500, '2026-11-02', '2026-11-20'), line(T2, 600, '2026-11-02', '2026-11-25'), line(T3, 700, '2026-11-10', '2026-11-30')];

const sql = `begin; ${mig}
create temp table t(n serial, k text, v text); grant all on t to authenticated; grant all on sequence t_n_seq to authenticated;
create temp table ids(k text primary key, v text); grant all on ids to authenticated;

-- A. Kế hoạch tháng: lập → gửi → trả lại → sửa → gửi lại → duyệt
${as(KHOI)} ${keep('TC01 Khôi lập KH tháng 11 (3 việc)', newPlan('month', M, MONTH))}
reset role; update ids set k='m' where k like 'TC01%';
${as(KHOI)} ${T('TC02 Khôi gửi duyệt KH tháng', tr('m', 'submit'))}
reset role; ${T('TC02 · trạng thái + thông báo', `${st('m')} || ' · ' || ${notes('m')}`)}
${as(KHOI)} ${T('TC03 Khôi tự duyệt (phải bị chặn)', tr('m', 'approve'))}
${as(SON)} ${T('TC04 CHT Sơn duyệt KH tháng (phải bị chặn — tháng do GĐ/Admin duyệt)', tr('m', 'approve'))}
${as(ADMIN)} ${T('TC05a Admin trả lại không lý do (phải bị chặn)', tr('m', 'return'))}
${as(ADMIN)} ${T('TC05b Admin trả lại có lý do', tr('m', 'return', ", 'reason', 'Thiếu tổ đội cho trát ngoài'"))}
reset role; ${T('TC05 · trạng thái + thông báo', `${st('m')} || ' · ' || ${notes('m')}`)}
${as(KHOI)} ${T('TC06a Khôi sửa bản bị trả lại', resave('m', MONTH))}
${as(KHOI)} ${T('TC06b Khôi gửi lại', tr('m', 'submit'))}
${as(ADMIN)} ${T('TC06c Admin duyệt', tr('m', 'approve'))}
reset role; ${T('TC06 · trạng thái', st('m'))}

-- B. Kế hoạch tuần: gợi ý từ tiến độ + đối chiếu KH tháng → CHT duyệt
${as(THANH)} ${T('TC07a Gợi ý việc tuần 02/11 (có lịch trong tuần · có KL KH tháng)', `(select count(*) filter (where (x->>'inPeriod')::boolean) || ' có lịch · ' || count(*) filter (where x->>'monthPlanQty' is not null) || ' có KL KH tháng · T2 KH tháng=' || coalesce(max(x->>'monthPlanQty') filter (where x->>'taskId'='${T2}'),'null') from jsonb_array_elements(public.list_project_work_plan_candidates_v1('${P}', '${S}', 'week', '${W1}')::jsonb) x)`)}
${as(THANH)} ${keep('TC07b Thành lập KH tuần 02/11', newPlan('week', W1, [line(T1, 150, W1, '2026-11-08'), line(T2, 120, W1, '2026-11-08')]))}
reset role; update ids set k='w1' where k like 'TC07b%';
${as(THANH)} ${T('TC07c Thành gửi', tr('w1', 'submit'))}
${as(SON)} ${T('TC07e CHT Sơn duyệt KH tuần', tr('w1', 'approve'))}
reset role; ${T('TC07 · trạng thái + thông báo', `${st('w1')} || ' · ' || ${notes('w1')}`)}
${as(SON)} ${keep('TC08a Sơn tự lập KH tuần 09/11', newPlan('week', W2, [line(T2, 100, W2, '2026-11-15')]))}
reset role; update ids set k='w2' where k like 'TC08a%';
${as(SON)} ${T('TC08b Sơn gửi', tr('w2', 'submit'))}
${as(SON)} ${T('TC08c Sơn tự duyệt bản mình lập (phải bị chặn)', tr('w2', 'approve'))}

-- C. Kế hoạch vật tư tháng → CHT duyệt → Mua hàng nhận
${as(THANH)} ${keep('TC09a Thành lập KH vật tư tháng 11 từ KH tháng đã duyệt', `public.create_project_material_plan_v1(jsonb_build_object('workPlanId', ${id('m')}))`)}
reset role; update ids set k='mv' where k like 'TC09a%';
${T('TC09a · số vật tư / việc chưa quy đổi được', `(select jsonb_array_length(x->'lines') || ' vật tư · ' || jsonb_array_length(x->'gaps') || ' việc chưa quy đổi' from app_private.material_plan_json(${id('mv')}::uuid) x)`)}
${T('TC09b · dòng vượt BOQ cần lý do', `(select count(*) from app_private.material_plan_over_boq_lines((select p from public.project_material_plans p where id=${id('mv')}::uuid)))`)}
${as(THANH)} ${T('TC09c Gửi KH vật tư tháng', mtr('mv', 'submit'))}
${as(THANH)} ${T('TC09e Thành tự duyệt (phải bị chặn)', mtr('mv', 'approve'))}
${as(SON)} ${T('TC09f CHT Sơn duyệt KH vật tư', mtr('mv', 'approve'))}
reset role; ${T('TC09 · trạng thái + thông báo', `${mst('mv')} || ' · ' || ${notes('mv')}`)}
${T('TC10 Mua hàng · Cần mua nhận dòng từ KH vật tư tháng', `(select count(*) || ' dòng · tổng SL ' || coalesce(sum(need_qty)::text, '0') from app_private.procurement_inbox_lines() where source_id = ${id('mv')})`)}

-- D. Kế hoạch vật tư tuần trùng kỳ với tháng → Mua hàng thấy cả hai?
${as(THANH)} ${keep('TC11a Lập KH vật tư tuần 02/11', `public.create_project_material_plan_v1(jsonb_build_object('workPlanId', ${id('w1')}))`)}
reset role; update ids set k='mvw' where k like 'TC11a%';
${T('TC11a · SL gợi ý (nhu cầu − tồn kho CT)', `(select string_agg(item_name_snapshot || ': nhu cầu ' || need_qty || ', tồn ' || coalesce(stock_qty_snapshot::text, '?') || ', gợi ý ' || requested_qty, ' | ') from public.project_material_plan_lines where plan_id = ${id('mvw')}::uuid)`)}
-- KS nhập SL đề nghị = nhu cầu (công trường muốn đặt cho tuần); dòng đầu cố ý vượt BOQ, chưa ghi lý do.
update public.project_material_plan_lines set requested_qty = need_qty where plan_id = ${id('mvw')}::uuid;
update public.project_material_plan_lines set requested_qty = boq_qty_snapshot + need_qty
  where id = (select id from public.project_material_plan_lines where plan_id = ${id('mvw')}::uuid and boq_qty_snapshot > 0 order by sort_order limit 1);
${as(THANH)} ${T('TC11b Gửi khi 1 dòng vượt BOQ chưa có lý do (phải bị chặn)', mtr('mvw', 'submit'))}
reset role; update public.project_material_plan_lines set over_reason = 'thử' where plan_id = ${id('mvw')}::uuid;
${as(THANH)} ${T('TC11c Gửi sau khi ghi lý do', mtr('mvw', 'submit'))}
${as(SON)} ${T('TC11d Sơn duyệt', mtr('mvw', 'approve'))}
reset role; ${T('TC11e Mua hàng · Cần mua nhận dòng từ KH vật tư tuần', `(select count(*) || ' dòng' from app_private.procurement_inbox_lines() where source_id = ${id('mvw')})`)}
${T('TC11 Cần mua: vật tư có ở CẢ KH tháng lẫn KH tuần', `(select count(*) || ' vật tư trùng' || coalesce(' · ' || string_agg(a.item_name || ' tháng ' || a.m || ' + tuần ' || a.w, ' | '), '') from (select item_id, min(item_name) item_name, sum(need_qty) filter (where source_id = ${id('mv')}) m, sum(need_qty) filter (where source_id = ${id('mvw')}) w from app_private.procurement_inbox_lines() where source_id in (${id('mv')}, ${id('mvw')}) group by item_id having count(distinct source_id) = 2) a)`)}

-- E. Thực hiện: số đã làm chỉ có khi có tiến độ ngày (Chốt tiến độ, hoặc Nhật ký ở chế độ chính thức)
${as(ADMIN)} ${T('TC12a Thực hiện việc T1 trong tháng 11 trước khi nhập tiến độ', actual('month', M, T1))}
reset role;
insert into public.project_daily_task_progress (scope_key, project_id, construction_site_id, task_id, progress_date, week_start, progress_percent, quantity_done, daily_quantity_done)
select '${P}_${S}', '${P}', '${S}', '${T1}', '2026-11-03', '2026-11-02', least(coalesce(c.progress_percent, 0) + 5, 100), coalesce(c.quantity_done, 0) + 80, 80
from (select 1) one left join lateral app_private.work_plan_task_cumulative('${T1}', '2026-11-01') c on true;
${as(ADMIN)} ${T('TC12b Sau khi Chốt tiến độ ghi +80 ngày 03/11 · KH tháng', actual('month', M, T1))}
${as(ADMIN)} ${T('TC12c · KH tuần 02/11', actual('week', W1, T1))}
reset role; ${T('TC12d Chế độ Nhật ký của SMB (pilot = duyệt nhật ký KHÔNG ghi tiến độ)', `coalesce((select mode || ' từ ' || cutover_date from app_private.daily_log_wbs_rollout_scopes where project_id='${P}' order by updated_at desc limit 1), 'chưa bật')`)}

-- F. Điều chỉnh KH tháng sau khi đã có KH tuần + KH vật tư → cảnh báo lan xuống
${as(KHOI)} ${keep('TC13a Khôi tạo bản điều chỉnh KH tháng', `public.revise_project_work_plan_v1(jsonb_build_object('planId', ${id('m')}))`)}
reset role; update ids set k='m2' where k like 'TC13a%';
${as(KHOI)} ${T('TC13b Đổi KL trát ngoài 600 → 800, lý do biện pháp', resave('m2', [MONTH[0], { ...MONTH[1], plannedQty: 800, changeReasonCode: 'method' }, MONTH[2]], { changeReasonCode: 'method', responsibleParty: 'company', changeSummary: 'Đổi biện pháp trát ngoài, tăng khối lượng tháng 11' }))}
${as(KHOI)} ${T('TC13c Gửi bản điều chỉnh', tr('m2', 'submit'))}
${as(ADMIN)} ${T('TC13d Admin duyệt bản 2', tr('m2', 'approve'))}
reset role; ${T('TC13 · bản 1 / bản 2', `${st('m')} || ' | ' || ${st('m2')}`)}
${T('TC13 · KH tuần 02/11 cần xem lại', `coalesce((select needs_review_reason from public.project_work_plans where id=${id('w1')}::uuid), 'KHÔNG được đánh dấu')`)}
${T('TC13 · KH vật tư tháng cần tính lại', `coalesce((select needs_review_reason from public.project_material_plans where id=${id('mv')}::uuid), 'KHÔNG được đánh dấu')`)}
${T('TC13 · thông báo xem lại', `(select count(*) from public.notifications where source_type in ('work_plan_review', 'material_plan_review') and created_at > now() - interval '1 minute')`)}

-- G. Quyền xem
reset role; create temp table outsider as select u.id from public.users u where u.is_active and u.account_status = 'ACTIVE' and u.role::text <> 'ADMIN'
  and not exists (select 1 from public.project_permission_room_members m join public.project_staff s on s.id = m.project_staff_id
    where s.user_id = u.id::text and m.project_id = '${P}') limit 1;
reset role; select set_config('request.jwt.claims', json_build_object('sub', (select id from outsider), 'role', 'authenticated')::text, true); set local role authenticated;
${T('TC14 Người ngoài Room xem KH (phải bị chặn)', board('month', M, `b->>'code'`))}

-- H. Nhật ký: lịch tháng 10 của SMB đọc được (CHT)
${as(SON)} ${T('TC15 Lịch nhật ký tháng 10 (số ngày có phiếu/bản tổng hợp)', `(select jsonb_array_length(public.get_daily_log_calendar_v1('${P}', '${S}', '2026-10-01', '2026-10-31')))`)}

reset role; select k, v from t order by n; rollback;`;

const r = await fetch('https://api.supabase.com/v1/projects/ftciqmqhmfvjtwoycswe/database/query', { method: 'POST', headers: { Authorization: 'Bearer ' + e.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
const out = await r.json();
if (Array.isArray(out)) for (const x of out) console.log('##', x.k, '→', String(x.v).slice(0, 400)); else console.log(r.status, JSON.stringify(out).slice(0, 3000));
