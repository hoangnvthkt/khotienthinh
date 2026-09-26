// Rollback-only regression against the disposable, no-data PR #9 preview.
// Never accepts production or arbitrary project refs.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const ref = 'xllopwgistvwjwpkchtb';
const path = 'supabase/migrations/20260903063822_authorization_room_catalog_bootstrap.sql';
const bootstrap = existsSync(path) ? readFileSync(path, 'utf8') : '';
const retire = readFileSync('supabase/migrations/20260910025910_authorization_v2_phase4_retire_view_only_rooms.sql', 'utf8');
const enforce = readFileSync('supabase/migrations/20260910031856_authorization_v2_phase4_remaining_enforced_rooms.sql', 'utf8');

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

const inventorySql = `select
  (select count(*) from public.project_permission_rooms) rooms,
  (select count(*) from app_private.project_permission_room_action_bindings) bindings,
  (select count(*) from auth.users) users,
  (select count(*) from public.projects) projects,
  (select count(*) from public.project_permission_room_members) memberships,
  (select count(*) from public.project_permission_room_member_actions) grants`;
const before = await query(inventorySql, true);
assert.deepEqual(before, [{ rooms: 0, bindings: 0, users: 0, projects: 0, memberships: 0, grants: 0 }], 'Not an empty disposable preview; stop');

await query(`begin;
${bootstrap}
do $$ begin
  if (select count(*) from public.project_permission_rooms) <> 14 then
    raise exception 'Bootstrap must restore exactly the 14 archived Rooms';
  end if;
  if exists (select 1 from public.project_permission_room_members)
    or exists (select 1 from public.project_permission_room_member_actions) then
    raise exception 'Bootstrap must not create memberships or actor grants';
  end if;
end $$;
${retire}
${enforce}
do $$ begin
  if (select count(*) from app_private.authorization_room_retirement_dispositions) <> 4 then
    raise exception 'Missing retirement inventory';
  end if;
end $$;
rollback;`);
console.log('PASS: empty bootstrap and original Phase 4 retirement/enforcement guards');

await query(`begin;
insert into public.project_permission_rooms(code,group_code,name,allowed_actions,sort_order)
values ('bootstrap_sentinel','test','Do not change',array['view'],999);
${bootstrap}
do $$ begin
  if (select count(*) from public.project_permission_rooms) <> 1
    or (select name from public.project_permission_rooms where code='bootstrap_sentinel') <> 'Do not change'
    or exists (select 1 from app_private.project_permission_room_action_bindings) then
    raise exception 'An existing catalog must be untouched, even if incomplete';
  end if;
end $$;
rollback;`);
console.log('PASS: populated catalog is a strict no-op');

await assert.rejects(query(`begin;
insert into public.projects(code,name) values ('BOOTSTRAP-ROLLBACK-ONLY','Rollback guard fixture');
${bootstrap}
rollback;`), /AUTHORIZATION_BOOTSTRAP_NONEMPTY/);
console.log('PASS: missing catalog in a populated database fails closed');

const throughHrm = process.argv.includes('--through-hrm');
if (process.argv.includes('--remaining-chain') || throughHrm) {
  const chain = readdirSync('supabase/migrations').sort()
    .filter(file => file >= '20260910031856_' && file.endsWith('.sql'))
    .filter(file => !throughHrm || file <= '20260911041501_authorization_v2_task12_3_restore_own_attendance_scope.sql')
    .map(file => readFileSync(`supabase/migrations/${file}`, 'utf8'));
  // A nested COMMIT would violate this runner's rollback-only contract.
  assert(!/^\s*(?:begin|commit|rollback)\s*;/im.test(chain.join('\n')), 'Migration owns a transaction; stop');
  try {
    await query(`begin;\n${bootstrap}\n${retire}\n${chain.join('\n')}\nrollback;`);
    console.log(`PASS: ${chain.length} migrations ${throughHrm ? 'through HRM Task 12.3' : 'in remaining chain'} execute in Cloud rollback`);
  } finally {
    assert.deepEqual(await query(inventorySql, true), before, 'Failed chain must also leave preview unchanged');
  }
}
assert.deepEqual(await query(inventorySql, true), before, 'Rollback must leave the preview unchanged');
console.log('PASS: preview unchanged after rollback');
