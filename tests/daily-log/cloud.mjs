import { execFileSync } from 'node:child_process';
import { assertCloudTarget } from '../../scripts/lib/supabase-cloud-transaction.mjs';

export const ref = 'oymkraihhqahqvzahhtx';
export async function query(sql, readOnly = true) {
  assertCloudTarget(ref, 'oymkraihhqahqvzahhtx');
  if (!process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Cloud management token missing');
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify({ status: response.status, error: body }));
  return body;
}
export function branchConfig() {
  const config = JSON.parse(execFileSync('npx', ['--no-install', 'supabase', 'branches', 'get',
    'baseline-vioo-git', '--project-ref', 'ftciqmqhmfvjtwoycswe', '--agent=no', '-o', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assertCloudTarget(new URL(config.SUPABASE_URL).hostname.split('.')[0], ref);
  return config;
}
