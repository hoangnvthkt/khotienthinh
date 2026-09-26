// Real migration regression, rollback-only on the disposable PR #9 preview.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ref = 'xllopwgistvwjwpkchtb';
const dir = 'supabase/migrations/';
const target = '20260911041501_authorization_v2_task12_3_restore_own_attendance_scope.sql';
const prefix = [
  '20260903063822_authorization_room_catalog_bootstrap.sql',
  '20260910025910_authorization_v2_phase4_retire_view_only_rooms.sql',
  ...readdirSync(dir).sort().filter(file => file >= '20260910031856_' && file < target && file.endsWith('.sql')),
].map(file => readFileSync(dir + file, 'utf8')).join('\n');
const migration = readFileSync(dir + target, 'utf8');
assert(!/^\s*(?:begin|commit|rollback)\s*;/im.test(prefix + migration), 'Nested transaction; stop');

async function query(sql, readOnly = false) {
  assert(process.env.SUPABASE_ACCESS_TOKEN, 'Load the authorized root .env');
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  const body = await response.text();
  assert(response.ok, `Cloud regression failed (${response.status}): ${body}`);
  return JSON.parse(body);
}

const inventory = `select
  (select count(*) from auth.users) users,
  (select count(*) from public.users) profiles,
  (select count(*) from public.projects) projects,
  (select count(*) from public.project_permission_rooms) rooms,
  (select count(*) from public.role_permission_templates) templates,
  (select count(*) from public.role_permission_template_items) items,
  (select count(*) from public.principal_role_assignments) assignments,
  (select count(*) from public.user_permission_grants) grants`;
const before = await query(inventory, true);
assert.equal(before[0].users, 0, 'Not an empty disposable preview');
assert.equal(before[0].profiles, 0);
assert.equal(before[0].projects, 0);
assert.equal(before[0].rooms, 0);

const view = `insert into public.role_permission_templates(code,name)
  values ('LEGACY_HR_SMOKE_VIEW','Rollback view-only fixture');
insert into public.role_permission_template_items(template_id,permission_code,scope_type,scope_id)
  select id,'hrm.attendance.view','global','*' from public.role_permission_templates
  where code='LEGACY_HR_SMOKE_VIEW';`;
const operator = `insert into public.role_permission_templates(code,name)
  values ('LEGACY_HR_SMOKE_OPERATOR','Rollback operator fixture');
insert into public.role_permission_template_items(template_id,permission_code,scope_type,scope_id)
  select template.id,item.code,'global','*' from public.role_permission_templates template
  cross join (values ('hrm.attendance.view'),('hrm.attendance.edit')) item(code)
  where template.code='LEGACY_HR_SMOKE_OPERATOR';`;

async function run(name, fixture, assertion = '', error) {
  try {
    const pending = query(`begin;\n${prefix}\n${fixture}\n${migration}\n${assertion}\nrollback;`);
    if (error) await assert.rejects(pending, error);
    else await pending;
    console.log(`PASS: ${name}`);
  } finally {
    assert.deepEqual(await query(inventory, true), before, 'Every case must leave preview unchanged');
  }
}

await run('empty bootstrap succeeds without generating legacy HR profiles', '', `do $$ begin
  if exists(select 1 from public.role_permission_templates where code like 'LEGACY_HR_%')
    or exists(select 1 from public.principal_role_assignments)
    or exists(select 1 from public.user_permission_grants) then
    raise exception 'Empty bootstrap must not generate profiles or grants';
  end if;
end $$;`);
await run('canonical-only prerequisite still fails closed on empty bootstrap',
  `update app_private.permission_hardening_settings set value='false'::jsonb where key='legacy_fallback_disabled';`,
  '', /requires canonical-only authorization/);
await run('populated project database cannot bypass missing-profile guard',
  `insert into public.projects(code,name) values ('HRM-ROLLBACK-ONLY','Rollback fixture');`,
  '', /found no migrated view-only HR profile/);
await run('operator-only inventory still fails the view-only guard', operator, '', /found no migrated view-only HR profile/);
await run('view-only inventory still fails the operator-preservation guard', view, '', /removed global attendance scope from all operators/);
await run('view-only becomes own while operator scope and items are preserved', view + operator, `do $$ begin
  if (select count(*) from public.role_permission_template_items item
      join public.role_permission_templates template on template.id=item.template_id
      where template.code='LEGACY_HR_SMOKE_VIEW' and item.permission_code='hrm.attendance.view'
      and item.scope_type='own' and item.scope_id='*') <> 1
    or (select count(*) from public.role_permission_template_items item
      join public.role_permission_templates template on template.id=item.template_id
      where template.code='LEGACY_HR_SMOKE_OPERATOR' and item.scope_type='global' and item.scope_id='*') <> 2 then
    raise exception 'Incorrect view or operator reconciliation';
  end if;
end $$;`);
await run('pre-existing own item is retained without duplicate conflict', view + operator + `
insert into public.role_permission_template_items(template_id,permission_code,scope_type,scope_id)
select id,'hrm.attendance.view','own','*' from public.role_permission_templates where code='LEGACY_HR_SMOKE_VIEW';`, `do $$ begin
  if (select count(*) from public.role_permission_template_items item
    join public.role_permission_templates template on template.id=item.template_id
    where template.code='LEGACY_HR_SMOKE_VIEW') <> 1 then
    raise exception 'Duplicate own item or global scope left behind';
  end if;
end $$;`);
console.log('PASS: all HRM regression transactions rolled back');
