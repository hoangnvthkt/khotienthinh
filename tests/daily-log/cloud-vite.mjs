import { spawn } from 'node:child_process';
import { branchConfig } from './cloud.mjs';
const config = branchConfig();
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4197','--strictPort'], {
  stdio: 'inherit', env: { ...process.env, VITE_SUPABASE_URL: config.SUPABASE_URL, VITE_SUPABASE_ANON_KEY: config.SUPABASE_ANON_KEY },
});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
