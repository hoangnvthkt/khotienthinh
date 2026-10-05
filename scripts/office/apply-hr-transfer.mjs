// Apply one verified migration and an explicitly prepared pilot seed, atomically.
// The seed is local-only personnel data; never commit it or run the rollback smoke here.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const version='20261005021048';
const name='request_hr_office_transfer_bridge';
const project=new URL(process.env.VITE_SUPABASE_URL).hostname.split('.')[0];
const [mode,expectedProject,seedPath]=process.argv.slice(2);
if(mode!=='--apply'||expectedProject!==project||!seedPath||!process.env.SUPABASE_ACCESS_TOKEN) throw Error('Usage: node --env-file=.env scripts/office/apply-hr-transfer.mjs --apply <expected-project> <verified-pilot-seed.sql>');
const sql=readFileSync(`supabase/migrations/${version}_${name}.sql`,'utf8');
const seed=readFileSync(seedPath,'utf8');
const digest=s=>createHash('sha256').update(s).digest('hex');
const evidence=JSON.parse(readFileSync('docs/office/evidence/hr-transfer-validation.json','utf8'));
if(digest(sql)!==evidence.migrationSha256||digest(seed)!==evidence.pilotSeedSha256) throw Error('Migration/seed differs from verified rollback inputs');
if([sql,seed].some(s=>/^\s*(commit|rollback|begin)\s*;/im.test(s)||s.includes('$office_migration$')))throw Error('Unexpected transaction control/delimiter');
const baseline=JSON.parse(readFileSync('.office-run-logs/transfer-live/baseline-now.json','utf8'));
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const baselineGuards=baseline.map(r=>`if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=${quote(r.name)} and md5(case when p.prokind='f' then pg_get_functiondef(p.oid) end)=${quote(createHash('md5').update(r.definition).digest('hex'))}) then raise exception 'Baseline function changed: %',${quote(r.name)}; end if;`).join('\n');
const query=`begin;
set local lock_timeout='3s'; set local statement_timeout='45s';
select pg_advisory_xact_lock(hashtextextended('office-rollout-${version}',0));
do $guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version='${version}') or to_regclass('app_private.hr_transfer_routes') is not null then raise exception 'Already applied or baseline differs; inspect before retry'; end if;
 ${baselineGuards}
end $guard$;
${sql}
${seed}
insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[$office_migration$${sql}$office_migration$]);
notify pgrst,'reload schema';
commit;
select f.*,r.code,r.status from hr_transfer_fixture f join public.request_instances r on r.id=f.request_id;`;
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query})});
const result=await response.json();
if(!response.ok)throw Error(`Apply HTTP ${response.status}: ${JSON.stringify(result)}. Inspect remote state before retrying.`);
writeFileSync('.office-run-logs/transfer-live/production-result.json',JSON.stringify({appliedAt:new Date().toISOString(),project,version,migrationSha256:digest(sql),result},null,2)+'\n');
console.log('Applied verified migration and pilot seed; result saved locally. Human approvals were not executed.');
