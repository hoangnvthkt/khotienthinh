// Read-only proof that the pre-activation rollback suite left no Office fixtures.
import { writeFileSync } from "node:fs";
const project = new URL(process.env.VITE_SUPABASE_URL).hostname.split(".")[0];
if (!project || !process.env.SUPABASE_ACCESS_TOKEN)
  throw new Error("Load the repository .env");
const query = `select
 not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app_private') and c.relname like 'office_%') office_schema_absent,
 not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname like 'office_%') office_functions_absent,
 not exists(select 1 from public.permission_applications where code='office') office_permissions_absent,
 not exists(select 1 from storage.buckets where id='office-attachments') office_bucket_absent,
 not exists(select 1 from supabase_migrations.schema_migrations where version='20261004085552') migration_unapplied,
 not exists(select 1 from public.users where email like 'office-test-%@invalid.local') test_users_absent,
 not exists(select 1 from public.org_units where code like 'OFFICE-QA-%') test_departments_absent,
 not exists(select 1 from public.notifications where source_type='office_document') office_notifications_absent;`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  },
);
if (!response.ok) throw new Error(`Cloud postflight HTTP ${response.status}`);
const [checks] = await response.json();
if (
  !checks ||
  Object.keys(checks).length !== 8 ||
  Object.values(checks).some((value) => value !== true)
)
  throw new Error(
    "Cloud postflight found Office state; inspect before proceeding",
  );
const result = {
  checkedAt: new Date().toISOString(),
  project,
  mode: "transaction-rollback-only",
  ...checks,
};
writeFileSync(
  "docs/office/evidence/cloud-postflight.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(result);
