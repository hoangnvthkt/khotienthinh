// Apply only the verified intake migration. Never include fixtures or historical backfill.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const version='20261008171002';
const name='procurement_external_intake';
const project=new URL(process.env.VITE_SUPABASE_URL).hostname.split('.')[0];
const [mode,expectedProject]=process.argv.slice(2);
if(mode!=='--apply'||expectedProject!==project||!process.env.SUPABASE_ACCESS_TOKEN) throw Error('Usage: node --env-file=.env scripts/procurement/apply-external-intake.mjs --apply <expected-project>');
const sql=readFileSync(`supabase/migrations/${version}_${name}.sql`,'utf8');
const evidence=JSON.parse(readFileSync('docs/procurement/evidence/external-intake-validation.json','utf8'));
const hash=createHash('sha256').update(sql).digest('hex');
if(hash!==evidence.migrationSha256) throw Error('Migration differs from rollback-tested input');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const guards=evidence.baselineFunctions.map(f=>`if md5(pg_get_functiondef(${quote(f.signature)}::regprocedure))<>${quote(f.md5)} then raise exception 'Procurement baseline changed'; end if;`).join('\n');
const query=`begin;
set local lock_timeout='3s'; set local statement_timeout='45s';
select pg_advisory_xact_lock(hashtextextended('procurement-intake-${version}',0));
do $guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version='${version}') or to_regclass('app_private.procurement_source_receipts') is not null then raise exception 'Already applied; inspect state before retrying'; end if;
 ${guards}
end $guard$;
${sql}
do $guard$ begin
 if (select count(*) from app_private.procurement_source_routes)<>2 then raise exception 'Expected both approved source templates'; end if;
 if exists(select 1 from app_private.procurement_source_receipts) then raise exception 'Unexpected historical intake'; end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${quote(sql)}]);
notify pgrst,'reload schema';
commit;
select source_type,template_id,enabled_at from app_private.procurement_source_routes;`;
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query})});
const result=await response.json();
if(!response.ok)throw Error(`Apply failed (${response.status}): ${JSON.stringify(result)}. Inspect remote state before retry.`);
writeFileSync('.office-run-logs/procurement-bridge/applied.json',JSON.stringify({version,migrationSha256:hash,appliedAt:new Date().toISOString(),result},null,2));
console.log('Applied external intake migration; two routes active, zero historical records imported.');
