// Explicit, single-migration rollout. Never pushes another module's migrations.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const version = "20261004085552";
const project = new URL(process.env.VITE_SUPABASE_URL).hostname.split(".")[0];
if (process.argv[2] !== "--apply" || process.argv[3] !== project)
  throw new Error("Usage: node --env-file=.env scripts/office/apply-production.mjs --apply <expected-project-ref>");
if (!process.env.SUPABASE_ACCESS_TOKEN) throw new Error("Cloud access token is required");
const sql = readFileSync(`supabase/migrations/${version}_office_p0_document_lifecycle.sql`, "utf8");
const sha256 = createHash("sha256").update(sql).digest("hex");
const evidence = JSON.parse(readFileSync("docs/office/evidence/branch-validation.json", "utf8"));
if (sha256 !== evidence.migrationSha256) throw new Error("Migration differs from verified SQL");
if (/^\s*(commit|rollback|begin)\s*;/im.test(sql) || sql.includes("$office_migration$"))
  throw new Error("Unexpected transaction control or SQL delimiter");
const query = `begin;
set local lock_timeout='3s'; set local statement_timeout='45s';
select pg_advisory_xact_lock(hashtextextended('office-rollout-${version}',0));
do $guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version='${version}')
 or to_regclass('public.office_documents') is not null
 or exists(select 1 from storage.buckets where id='office-attachments') then
  raise exception 'Office already exists: inspect state, do not replay migration';
 end if;
end $guard$;
${sql}
insert into supabase_migrations.schema_migrations(version,name,statements)
values('${version}','office_p0_document_lifecycle',array[$office_migration$${sql}$office_migration$]);
notify pgrst, 'reload schema';
commit;
select version,name from supabase_migrations.schema_migrations where version='${version}';`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
const result = await response.json();
if (!response.ok) throw new Error(`Rollout HTTP ${response.status}: ${JSON.stringify(result)}. Inspect remote state before retrying.`);
const evidenceOut = { appliedAt: new Date().toISOString(), project, version, name: "office_p0_document_lifecycle", sha256, result };
writeFileSync("docs/office/evidence/production-migration.json", JSON.stringify(evidenceOut, null, 2) + "\n");
console.log(evidenceOut);
