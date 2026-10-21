// DỰ PHÒNG: đưa Nhật ký SMB-2026 / DA29 từ chính thức về lại thí điểm (pilot, cutover 01/10) nếu công bố tiến độ trục trặc.
// Tiến độ đã công bố giữ nguyên; chỉ đổi chế độ để Chốt tiến độ ngày nhập được trở lại. Có ghi permission_audit_events.
// Mặc định CHẠY THỬ (rollback). Ghi thật: --commit. Chỉ một dự án: --only=SMB-2026 | --only=DA29
import { readFileSync } from 'node:fs'; import { parseEnv } from 'node:util';
const e = parseEnv(readFileSync('/Users/admin/khotienthinh/.env', 'utf8'));
const commit = process.argv.includes('--commit');
const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
const projects = [
  { code: 'SMB-2026', projectId: 'b4ce0810-2cac-44af-a83f-8bb1a361567a', siteId: '240ac280-756d-4955-b612-41661e7aedaf', cht: 'd0a300a0-1586-4748-b6e7-71773addc004' },
  { code: 'DA29', projectId: 'd3d25b49-0623-40eb-99ac-b96f6ac0855a', siteId: '0415101d-9790-47ea-a2c2-db0a613ca8e0', cht: '98f1dc6f-cf5c-41d3-8559-1461dfd2524a' },
].filter(p => !only || p.code === only);
const reason = 'Đưa Nhật ký về thí điểm (dự phòng sau khi chuyển chính thức 08/10/2026). Thực hiện bởi Claude Code (operator) theo yêu cầu chủ SP.';
let sql = `begin; create temp table t(n serial, k text, v text);\n`;
for (const p of projects) sql += `
do $x$ declare s app_private.daily_log_wbs_rollout_scopes%rowtype; begin
  select * into s from app_private.daily_log_wbs_rollout_scopes where project_id='${p.projectId}' and construction_site_id='${p.siteId}';
  if s.id is null or s.mode <> 'enforced' then insert into t(k,v) values('${p.code}', 'BỎ QUA — không ở chế độ chính thức'); return; end if;
  update app_private.daily_log_wbs_rollout_scopes set mode='pilot', cutover_date='2026-10-01', reason=$r$${reason}$r$, updated_at=clock_timestamp() where id=s.id;
  insert into public.permission_audit_events(actor_user_id,event_type,before_grants,after_grants,metadata)
  values('${p.cht}'::uuid,'daily_log_rollout_changed',jsonb_build_array(to_jsonb(s)),
    jsonb_build_array((select to_jsonb(x) from app_private.daily_log_wbs_rollout_scopes x where x.id=s.id)),
    jsonb_build_object('release_id',s.release_id,'reason',$r$${reason}$r$,'operator_role',current_user));
  insert into t(k,v) values('${p.code}', 'enforced từ ' || s.cutover_date || ' → pilot từ 2026-10-01');
end $x$;
`;
sql += `select k, v from t order by n; ${commit ? 'commit;' : 'rollback;'}`;
const r = await fetch('https://api.supabase.com/v1/projects/ftciqmqhmfvjtwoycswe/database/query', { method: 'POST', headers: { Authorization: 'Bearer ' + e.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
const out = await r.json();
console.log(commit ? '== ĐÃ GHI (commit) ==' : '== CHẠY THỬ (rollback, chưa ghi gì) ==');
if (Array.isArray(out)) for (const x of out) console.log('##', x.k, '→', x.v); else console.log(r.status, JSON.stringify(out).slice(0, 3000));
