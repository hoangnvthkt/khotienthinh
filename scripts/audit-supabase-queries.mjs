#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { scanWorkspace } from './lib/supabaseQueryAudit.mjs';

const rootDir = process.cwd();
const args = process.argv.slice(2);
const valueAfter = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const policyPath = resolve(rootDir, 'scripts/supabase-query-policy.json');
const policy = existsSync(policyPath) ? JSON.parse(readFileSync(policyPath, 'utf8')) : { allowlist: [] };
const report = scanWorkspace(rootDir, policy);

const writePath = valueAfter('--write');
if (writePath) {
  const absolutePath = resolve(rootDir, writePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
}
if (args.includes('--summary') || !writePath) {
  process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
}

const baselinePath = valueAfter('--check');
if (baselinePath) {
  if (!existsSync(resolve(rootDir, baselinePath))) {
    process.stderr.write(`Missing Supabase query baseline: ${baselinePath}\n`);
    process.exitCode = 1;
  } else {
    const baseline = JSON.parse(readFileSync(resolve(rootDir, baselinePath), 'utf8'));
    const known = new Set((baseline.findings || []).map(row => row.fingerprint));
    const current = new Set(report.findings.map(row => row.fingerprint));
    const newFindings = report.findings.filter(row => !known.has(row.fingerprint));
    const missingAllowlistMetadata = (policy.allowlist || []).filter(entry => (
      !entry.fingerprint
      || !entry.classification
      || !entry.owner
      || !entry.reason
      || !entry.reviewBy
    ));
    const staleAllowlist = (policy.allowlist || []).filter(entry => !current.has(entry.fingerprint));

    if (newFindings.length > 0 || missingAllowlistMetadata.length > 0 || staleAllowlist.length > 0) {
      if (newFindings.length > 0) {
        process.stderr.write(`New Supabase query findings (${newFindings.length}):\n`);
        newFindings.forEach(row => process.stderr.write(`- ${row.file}:${row.line} ${row.rule} ${row.table}\n`));
      }
      if (missingAllowlistMetadata.length > 0) {
        process.stderr.write(`Allowlist entries missing metadata: ${missingAllowlistMetadata.length}\n`);
      }
      if (staleAllowlist.length > 0) {
        process.stderr.write(`Stale allowlist entries: ${staleAllowlist.length}\n`);
      }
      process.exitCode = 1;
    }
  }
}
