// Chuyển Nhật ký SMB-2026 và DA29 từ thí điểm (pilot) sang CHÍNH THỨC (enforced) — chủ SP chốt 08/10/2026.
// Chính thức: CHT duyệt bản tổng hợp = công bố tiến độ ngày; Chốt tiến độ ngày từ 01/10 chỉ đọc (vẫn chốt tuần, khóa kỳ).
// Mặc định CHẠY THỬ (rollback). Chỉ ghi khi có --commit.
// --override-gate: bỏ qua chốt "đối chiếu thí điểm phải khớp" (chủ SP chọn Nhật ký là nguồn duy nhất nên số lệch với
//   Chốt tiến độ là đương nhiên). Giữ nguyên cutover + release của pilot; ghi permission_audit_events kèm lý do.
// Chạy: node docs/audits/project-planning-2026-10-08/tools/daily-log-enforce.mjs [--override-gate] [--commit]
import { readFileSync } from 'node:fs'; import { parseEnv } from 'node:util';
const e = parseEnv(readFileSync('/Users/admin/khotienthinh/.env', 'utf8'));
const commit = process.argv.includes('--commit');
const override = process.argv.includes('--override-gate');
// Mốc chính thức khi bỏ qua chốt (mặc định 09/10/2026): ngày trước mốc vẫn nhập ở Chốt tiến độ; từ mốc, Nhật ký là nguồn duy nhất.
const cutover = (process.argv.find(a => a.startsWith('--cutover=')) || '--cutover=2026-10-09').split('=')[1];
if (!/^\d{4}-\d{2}-\d{2}$/.test(cutover)) throw new Error('--cutover=YYYY-MM-DD');

const projects = [
  { code: 'SMB-2026', projectId: 'b4ce0810-2cac-44af-a83f-8bb1a361567a', siteId: '240ac280-756d-4955-b612-41661e7aedaf', cht: 'd0a300a0-1586-4748-b6e7-71773addc004' },
  { code: 'DA29', projectId: 'd3d25b49-0623-40eb-99ac-b96f6ac0855a', siteId: '0415101d-9790-47ea-a2c2-db0a613ca8e0', cht: '98f1dc6f-cf5c-41d3-8559-1461dfd2524a' },
];
const reason = 'Chủ sản phẩm chốt trong chat 08/10/2026: chuyển Nhật ký sang chính thức — CHT duyệt nhật ký là công bố tiến độ ngày, bỏ nhập trùng ở Chốt tiến độ. Thực hiện bởi Claude Code (operator).';

let sql = `begin; create temp table t(n serial, k text, v text);\n`;
for (const p of projects) {
  const scope = `(select s from app_private.daily_log_wbs_rollout_scopes s where s.project_id='${p.projectId}' and s.construction_site_id='${p.siteId}')`;
  sql += `
insert into t(k,v) select '${p.code} · hiện tại', coalesce((select (s).mode || ' · cutover ' || (s).cutover_date || ' · release ' || (s).release_id from (select ${scope} s) x), 'chưa có phạm vi');
insert into t(k,v) select '${p.code} · nhật ký tổng hợp từ cutover', (select count(*) || ' bản · ' || count(*) filter (where status='submitted') || ' chờ duyệt · ' || count(*) filter (where status in ('approved','published','verified')) || ' đã duyệt'
  from public.daily_logs where project_id='${p.projectId}' and construction_site_id='${p.siteId}' and summary_source_type='member_contributions' and date::date >= '2026-10-01');
insert into t(k,v) select '${p.code} · đối chiếu thí điểm (shadow)', (select count(*) || ' lần · ' || count(*) filter (where mismatch_count<>0) || ' lần lệch'
  from app_private.daily_log_shadow_comparisons where project_id='${p.projectId}' and construction_site_id='${p.siteId}');
insert into t(k,v) select '${p.code} · lệch ngày ' || l.date || ' (' || l.status || ')', string_agg(coalesce(tk.wbs_code || ' ', '') || left(tk.name, 40)
    || ': nhật ký ' || coalesce(x->>'proposedQuantity', '—') || ' lũy kế / ' || coalesce(x->>'proposedDailyQuantity', '—') || ' ngày'
    || ' · Chốt tiến độ ' || coalesce(x->>'currentQuantity', 'chưa nhập') || ' / ' || coalesce(x->>'currentDailyQuantity', '—'), ' | ')
  from public.daily_logs l cross join lateral jsonb_array_elements(app_private.daily_log_shadow_rows_v1(l.id)) x
  left join public.project_tasks tk on tk.id = x->>'taskId'
  where l.project_id='${p.projectId}' and l.construction_site_id='${p.siteId}' and l.summary_source_type='member_contributions'
    and l.date::date >= '2026-10-01' and l.superseded_by_daily_log_id is null and not (x->>'matches')::boolean
  group by l.date, l.status;
do $x$ declare s app_private.daily_log_wbs_rollout_scopes%rowtype; r jsonb; begin
  select * into s from app_private.daily_log_wbs_rollout_scopes where project_id='${p.projectId}' and construction_site_id='${p.siteId}';
  if s.id is null or s.mode<>'pilot' then insert into t(k,v) values('${p.code} · chuyển chính thức','BỎ QUA — không ở chế độ pilot'); return; end if;
  begin
    if ${override} then
      update app_private.daily_log_wbs_rollout_scopes set mode='enforced', cutover_date='${cutover}'::date, owner_user_id='${p.cht}'::uuid,
        reason=$r$${reason} Bỏ qua chốt đối chiếu thí điểm theo quyết định chủ SP 08/10/2026; chính thức từ ${cutover}, ngày trước đó vẫn nhập ở Chốt tiến độ.$r$,
        updated_at=clock_timestamp() where id=s.id;
      r := jsonb_build_object('mode','enforced','cutoverDate','${cutover}','pilotCutoverDate',s.cutover_date,'releaseId',s.release_id,'gateOverride',true);
    else
      r := app_private.configure_daily_log_pilot_v1('${p.projectId}','${p.siteId}','enforced',s.cutover_date,s.release_id,'${p.cht}'::uuid,$r$${reason}$r$);
    end if;
    insert into public.permission_audit_events(actor_user_id,event_type,before_grants,after_grants,metadata)
    values('${p.cht}'::uuid,'daily_log_rollout_changed',jsonb_build_array(to_jsonb(s)),
      jsonb_build_array((select to_jsonb(x) from app_private.daily_log_wbs_rollout_scopes x where x.id=s.id)),
      jsonb_build_object('release_id',s.release_id,'reason',$r$${reason}$r$,'operator_role',current_user,'receipt',r));
    insert into t(k,v) values('${p.code} · chuyển chính thức','ĐẠT → '||r::text);
  exception when others then insert into t(k,v) values('${p.code} · chuyển chính thức','CHƯA ĐẠT '||sqlerrm);
  end;
end $x$;
`;
  sql += `
insert into t(k,v) select '${p.code} · nguồn tiến độ ngày', string_agg(to_char(d, 'DD/MM') || ': ' || case when exists (select 1 from app_private.daily_log_wbs_rollout_scopes s where s.project_id = '${p.projectId}' and s.construction_site_id = '${p.siteId}' and s.mode = 'enforced' and d >= s.cutover_date) then 'Nhật ký (Chốt tiến độ chỉ đọc)' else 'Chốt tiến độ' end, ' · ' order by d)
  from unnest(array[date '${cutover}' - 1, date '${cutover}']) d;
`;
  // Chỉ khi chạy thử: CHT (người được gửi duyệt) duyệt + công bố bản tổng hợp đang chờ ở chế độ chính thức.
  if (!commit) sql += `
create temp table pend_${p.code.replace('-', '_')} as select id, last_action_at, submitted_to_user_id from public.daily_logs
  where project_id='${p.projectId}' and construction_site_id='${p.siteId}' and summary_source_type='member_contributions'
    and status='submitted' and date::date >= '2026-10-01' and superseded_by_daily_log_id is null;
grant select on pend_${p.code.replace('-', '_')} to authenticated; grant all on t to authenticated; grant all on sequence t_n_seq to authenticated;
do $x$ declare l record; r jsonb; begin
  for l in select * from pend_${p.code.replace('-', '_')} loop
    perform set_config('request.jwt.claims', json_build_object('sub', coalesce(l.submitted_to_user_id::text, '${p.cht}'), 'role', 'authenticated')::text, true);
    perform set_config('request.path', '/rpc/publish_daily_log_summary_v1', true);
    begin
      execute 'set local role authenticated';
      r := public.publish_daily_log_summary_v1(l.id, l.last_action_at, gen_random_uuid());
      execute 'reset role';
      insert into t(k,v) values('${p.code} · thử CHT duyệt bản chờ (chính thức)', 'ĐƯỢC → ' || coalesce(jsonb_array_length(r->'publishedTaskIds'), 0) || ' việc công bố tiến độ · ' || left(r::text, 200));
    exception when others then execute 'reset role'; insert into t(k,v) values('${p.code} · thử CHT duyệt bản chờ (chính thức)', 'BỊ CHẶN ' || sqlerrm);
    end;
  end loop;
end $x$;
`;
}
sql += `select k, v from t order by n; ${commit ? 'commit;' : 'rollback;'}`;

const r = await fetch('https://api.supabase.com/v1/projects/ftciqmqhmfvjtwoycswe/database/query', { method: 'POST', headers: { Authorization: 'Bearer ' + e.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
const out = await r.json();
console.log(commit ? '== ĐÃ GHI (commit) ==' : '== CHẠY THỬ (rollback, chưa ghi gì) ==');
if (Array.isArray(out)) for (const x of out) console.log('##', x.k, '→', String(x.v).slice(0, 500)); else console.log(r.status, JSON.stringify(out).slice(0, 3000));
