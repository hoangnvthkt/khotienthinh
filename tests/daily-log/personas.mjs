import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { query, branchConfig, ref } from './cloud.mjs';
const config = branchConfig();
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, options);
export const personas = [
  ['author_a', 'Người lập Khu A'], ['author_b', 'Người lập Khu B'],
  ['summarizer', 'Người tổng hợp'], ['approver', 'CHT'], ['reader', 'QS chỉ đọc'], ['denied', 'Không có quyền'],
].map(([key, name], i) => ({ key, name, id: `72000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  email: `dl-wbs-${key}-20260925@example.invalid` }));
export async function loginPersonas() {
  const existing = await query("select id,email from public.users where email like 'dl-wbs-%-20260925@example.invalid'");
  for (const person of personas) {
    const profile = existing.find(row => row.email === person.email);
    if (profile && profile.id !== person.id) throw new Error('Unexpected persona ownership; refusing to overwrite');
    if (!profile) await query(`insert into public.users(id,name,email,username,role,allowed_modules,admin_modules,allowed_sub_modules,admin_sub_modules)
      values ('${person.id}','DL TEST ${person.name}','${person.email}','dl_wbs_${person.key}_20260925','EMPLOYEE',null,null,null,null)`, false);
  }
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  const sessions = {};
  for (const person of personas) {
    const password = randomBytes(32).toString('base64url');
    const user = listed.data.users.find(row => row.email === person.email);
    const response = user ? await admin.auth.admin.updateUserById(user.id, { password })
      : await admin.auth.admin.createUser({ email: person.email, password, email_confirm: true, user_metadata: { name: `DL TEST ${person.name}` } });
    if (response.error) throw new Error(`${person.key}: ${response.error.message}`);
    const client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, options);
    const login = await client.auth.signInWithPassword({ email: person.email, password });
    if (login.error) throw new Error(`${person.key} login: ${login.error.message}`);
    sessions[person.key] = { client, session: login.data.session, person };
    console.log(JSON.stringify({ ref, persona: person.key, appUserId: person.id, authUserId: login.data.user.id, signedIn: true }));
  }
  return sessions;
}
if (process.argv.includes('--create')) await loginPersonas();
