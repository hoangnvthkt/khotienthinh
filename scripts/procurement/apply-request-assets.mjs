// Apply only the exact Cloud rollback-tested migration; never business fixtures or grants.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const version = '20261008172000';
const name = 'request_purchase_assets';
const project = new URL(process.env.VITE_SUPABASE_URL).hostname.split('.')[0];
if (process.argv[2] !== '--apply' || process.argv[3] !== project || !process.env.SUPABASE_ACCESS_TOKEN) throw Error('Usage: node --env-file=.env scripts/procurement/apply-request-assets.mjs --apply <expected-project>');
const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
const evidence = JSON.parse(readFileSync('docs/procurement/evidence/request-assets-validation.json', 'utf8'));
const hash = createHash('sha256').update(sql).digest('hex');
if (hash !== evidence.migrationSha256 || !evidence.cloudRollbackPassed) throw Error('Migration differs from verified evidence');
const quote = s => "'" + s.replaceAll("'", "''") + "'";
const guards = evidence.baselineFunctions.map(f => `if md5(pg_get_functiondef(${quote(f.signature)}::regprocedure)) <> ${quote(f.md5)} then raise exception 'Baseline changed: %', ${quote(f.signature)}; end if;`).join('\n');
const query = `begin; set local lock_timeout='3s'; set local statement_timeout='45s';
select pg_advisory_xact_lock(hashtextextended('request-assets-${version}',0));
do $guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version='${version}') or to_regclass('app_private.request_purchase_po_links') is not null then raise exception 'Already applied; inspect before retry'; end if;
 ${guards}
end $guard$;
${sql}
do $guard$ begin
 if exists(select 1 from app_private.request_purchase_po_links) or exists(select 1 from app_private.request_purchase_assets) then raise exception 'Migration must not import business records'; end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${quote(sql)}]);
notify pgrst,'reload schema'; commit;
select '${version}' as applied_version;`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, { method:'POST', headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'}, body:JSON.stringify({query}) });
const result = await response.json();
if (!response.ok) throw Error(`Apply failed: ${JSON.stringify(result)}; inspect state before retrying.`);
writeFileSync('.office-run-logs/request-assets/applied.json', JSON.stringify({version, migrationSha256:hash, appliedAt:new Date().toISOString(), result}, null, 2));
console.log('Applied verified Request purchasing/assets migration. No historical requests or permissions changed.');
