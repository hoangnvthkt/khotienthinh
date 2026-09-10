// Cloud-only physical Storage probe. No task/user fixtures or notifications are created.
// Credentials stay in process memory; never print API keys or signed URLs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const ref = 'ftciqmqhmfvjtwoycswe';
if (readFileSync('supabase/.temp/project-ref','utf8').trim() !== ref) throw new Error('Project ref mismatch');
let keys;
try {
  keys = JSON.parse(execFileSync('npx',['--no-install','supabase','projects','api-keys','--project-ref',ref,'--output','json'], { encoding:'utf8', stdio:['ignore','pipe','pipe'] }));
} catch {
  // Child-process errors can embed captured stdout; never propagate credential output.
  throw new Error('Probe credential lookup failed');
}
const key = keys.find(x => x.name === 'service_role')?.api_key;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!key || !anonKey) throw new Error('Missing probe credentials');
const url = `https://${ref}.supabase.co`;
const admin = createClient(url,key,{ auth:{ persistSession:false,autoRefreshToken:false } });
const anon = createClient(url,anonKey,{ auth:{ persistSession:false,autoRefreshToken:false } });
const bucket = admin.storage.from('work-attachments');
const prefix = `_probe/${crypto.randomUUID()}`;
const path = `${prefix}/fixture.txt`;
const bytes = 'Vioo Work synthetic storage probe';
let passed = false;
try {
  const upload = await bucket.upload(path,new Blob([bytes],{type:'text/plain'}),{contentType:'text/plain',cacheControl:'60',upsert:false});
  if (upload.error) throw new Error('Storage probe upload failed');
  const denied = await anon.storage.from('work-attachments').download(path);
  if (!denied.error) throw new Error('Anonymous read was not denied');
  const direct = await fetch(`${url}/storage/v1/object/public/work-attachments/${path}`);
  if (direct.ok) throw new Error('Public bucket URL unexpectedly readable');
  const signed = await bucket.createSignedUrl(path,60,{download:'fixture.txt'});
  if (signed.error) throw new Error('Storage signing failed');
  const download = await fetch(signed.data.signedUrl);
  if (!download.ok || await download.text() !== bytes) throw new Error('Signed download mismatch');
  passed = true;
} finally {
  const removed = await bucket.remove([path]);
  if (removed.error) throw new Error('Probe cleanup failed; inspect the _probe prefix');
  const remaining = await bucket.list(prefix,{limit:10});
  if (remaining.error || remaining.data.length) throw new Error('Probe cleanup verification failed');
}
if (passed) console.log('Cloud Storage upload, anonymous/public deny, 60s signing/download and physical cleanup passed. No task fixtures created.');
