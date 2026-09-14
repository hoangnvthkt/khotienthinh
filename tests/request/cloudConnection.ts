import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

const EXPECTED = {
  name: 'baseline-vioo-git',
  projectRef: 'oymkraihhqahqvzahhtx',
  parentProjectRef: 'ftciqmqhmfvjtwoycswe',
} as const;

interface BranchIdentity {
  name: string;
  project_ref: string;
  parent_project_ref: string;
  is_default: boolean;
}

/** Resolve only the approved preview branch; never include credentials in thrown errors. */
export const resolveApprovedBranchConnection = (envFile: string | undefined) => {
  if (!envFile) throw new Error('CLOUD_TEST_CONFIG_REQUIRED');
  let environment: Record<string, string>;
  try { environment = parseEnv(readFileSync(resolve(envFile), 'utf8')); }
  catch { throw new Error('CLOUD_TEST_CONFIG_REQUIRED'); }
  let parentRef: string;
  try { parentRef = new URL(environment.VITE_SUPABASE_URL).hostname.split('.')[0]; }
  catch { throw new Error('CLOUD_TARGET_REJECTED'); }
  if (parentRef !== EXPECTED.parentProjectRef || !environment.SUPABASE_ACCESS_TOKEN) {
    throw new Error('CLOUD_TARGET_REJECTED');
  }
  const cli = resolve('node_modules/.bin/supabase');
  const run = (args: string[]) => {
    const result = spawnSync(cli, ['branches', ...args, '--project-ref', parentRef, '--output', 'json'], {
      encoding: 'utf8', timeout: 30_000, maxBuffer: 2_000_000,
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: environment.SUPABASE_ACCESS_TOKEN },
    });
    if (result.status !== 0) throw new Error('CLOUD_BRANCH_LOOKUP_FAILED');
    try { return JSON.parse(result.stdout); }
    catch { throw new Error('CLOUD_BRANCH_LOOKUP_FAILED'); }
  };
  const branches: unknown = run(['list']);
  if (!Array.isArray(branches)) throw new Error('CLOUD_BRANCH_LOOKUP_FAILED');
  const identity = branches.find((item: BranchIdentity) => item.name === EXPECTED.name) as BranchIdentity | undefined;
  if (!identity || identity.project_ref !== EXPECTED.projectRef
    || identity.parent_project_ref !== EXPECTED.parentProjectRef || identity.is_default) {
    throw new Error('CLOUD_TARGET_REJECTED');
  }
  const credentials = run(['get', EXPECTED.name]);
  if (typeof credentials.POSTGRES_URL !== 'string' || typeof credentials.SUPABASE_URL !== 'string') {
    throw new Error('CLOUD_BRANCH_LOOKUP_FAILED');
  }
  const apiRef = new URL(credentials.SUPABASE_URL).hostname.split('.')[0];
  const databaseHost = new URL(credentials.POSTGRES_URL).hostname;
  if (apiRef !== EXPECTED.projectRef || !databaseHost.includes(EXPECTED.projectRef)) {
    throw new Error('CLOUD_TARGET_REJECTED');
  }
  return { identity, databaseUrl: credentials.POSTGRES_URL as string };
};
