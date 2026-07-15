import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');
const migrationSuffix = '_wms_reconciliation_anchor_ledger_scanner_hardening.sql';
const canonicalWf001LegacyFunctionHash = '036fecf083043ad2a722291a598ecf60c2f12ab9ca215242edae11733ec9a5fc';
const fakeWf001LegacyFunctionHash = '136fecf083043ad2a722291a598ecf60c2f12ab9ca215242edae11733ec9a5fc';
const knownWf001HashFunction = 'app_private.wms_reconciliation_known_wf001_legacy_function_hash';
const frozenTransactionValidator = 'app_private.validate_wms_reconciliation_frozen_transaction';

const stripSqlComments = (value: string): string => value
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--.*$/gm, '');

const loadMigration = (): { file: string; sql: string } => {
  const files = fs.readdirSync(migrationsDir).filter(file => file.endsWith(migrationSuffix));
  expect(files, `expected exactly one *${migrationSuffix} migration`).toHaveLength(1);
  if (files.length !== 1) return { file: '', sql: '' };
  return {
    file: files[0],
    sql: stripSqlComments(fs.readFileSync(path.join(migrationsDir, files[0]), 'utf8')),
  };
};

const exactFunction = (
  sql: string,
  name: string,
): { body: string; definition: string; header: string } => {
  const escaped = name.replace(/\./g, '\\.');
  const start = new RegExp('create\\s+or\\s+replace\\s+function\\s+' + escaped + '\\s*\\(', 'i').exec(sql);
  expect(start, name + ' is missing').not.toBeNull();
  if (!start) return { body: '', definition: '', header: '' };
  const tail = sql.slice(start.index);
  const bodyStart = /\bas\s+(\$\$|\$[a-z_][a-z0-9_]*\$)/i.exec(tail);
  expect(bodyStart, name + ' has no SQL function body').not.toBeNull();
  if (!bodyStart) return { body: '', definition: '', header: '' };
  const delimiter = bodyStart[1];
  const contentStart = bodyStart.index + bodyStart[0].length;
  const contentEnd = tail.indexOf(delimiter, contentStart);
  expect(contentEnd, name + ' has an unterminated SQL function body').toBeGreaterThanOrEqual(contentStart);
  if (contentEnd < contentStart) return { body: '', definition: '', header: '' };
  return {
    body: tail.slice(contentStart, contentEnd),
    definition: tail.slice(0, contentEnd + delimiter.length),
    header: tail.slice(0, bodyStart.index),
  };
};

const functionBody = (sql: string, name: string): string => exactFunction(sql, name).body;

const compactSql = (value: string): string => value.replace(/\s+/g, ' ').trim();
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sqlCallAfter = (sql: string, marker: string, functionName: string): string => {
  const markerIndex = sql.indexOf(marker);
  expect(markerIndex, marker + ' is missing').toBeGreaterThanOrEqual(0);
  if (markerIndex < 0) return '';
  const tail = sql.slice(markerIndex + marker.length);
  const callMatch = new RegExp('\\b' + escapeRegExp(functionName) + '\\s*\\(', 'i').exec(tail);
  expect(callMatch, functionName + ' value after ' + marker + ' is missing').not.toBeNull();
  if (!callMatch) return '';
  const start = markerIndex + marker.length + callMatch.index;
  const open = sql.indexOf('(', start);
  let depth = 0;
  let inString = false;
  for (let index = open; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'") {
      if (inString && sql[index + 1] === "'") {
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return sql.slice(start, index + 1);
    }
  }
  expect.fail(functionName + ' value after ' + marker + ' is unterminated');
  return '';
};

const relationSourcesInStatement = (statement: string): string[] => {
  const sources: string[] = [];
  for (const fromMatch of statement.matchAll(/\bfrom\b/gi)) {
    const before = statement.slice(0, fromMatch.index ?? 0);
    if (/\bdistinct\s*$/i.test(before)) continue;
    const start = (fromMatch.index ?? 0) + fromMatch[0].length;
    const relationStarts = [start];
    let depth = 0;
    let inString = false;
    let end = statement.length;
    for (let index = start; index < statement.length; index += 1) {
      const character = statement[index];
      if (character === "'") {
        if (inString && statement[index + 1] === "'") {
          index += 1;
          continue;
        }
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (character === '(') depth += 1;
      if (character === ')') {
        if (depth === 0) {
          end = index;
          break;
        }
        depth -= 1;
        continue;
      }
      if (depth !== 0) continue;
      if (character === ',') relationStarts.push(index + 1);
      const keyword = statement.slice(index).match(/^(where|group\s+by|order\s+by|having|limit|union|except|intersect|returning)\b/i);
      if (keyword) {
        end = index;
        break;
      }
      const join = statement.slice(index).match(/^join\b/i);
      if (join) relationStarts.push(index + join[0].length);
    }
    for (const relationStart of relationStarts.filter(index => index < end)) {
      const token = statement.slice(relationStart, end).trimStart()
        .replace(/^lateral\s+/i, '')
        .match(/^(only\s+\(|only\s+)?(?:([a-z_][a-z0-9_$.]*)|(\())/i);
      if (!token) continue;
      if (/^only\s+\(/i.test(token[0])) {
        sources.push('only (');
      } else {
        sources.push((token[2] ?? token[3] ?? token[0]).toLowerCase());
      }
    }
  }
  return sources;
};

const expectIfCondition = (sql: string, description: string, required: RegExp[]): void => {
  const blocks = [...sql.matchAll(/\bif\b([\s\S]*?)\bthen\b([\s\S]*?)\bend\s+if\s*;/gi)];
  expect(
    blocks.some(block => (
      required.every(pattern => pattern.test(block[1]))
      && /^\s*raise\s+exception\b/i.test(block[2])
    )),
    description,
  ).toBe(true);
};

const statementRecords = (sql: string): Array<{ index: number; text: string }> => {
  const records: Array<{ index: number; text: string }> = [];
  let index = 0;
  for (const text of sql.split(';')) {
    records.push({ index, text });
    index += text.length + 1;
  }
  return records;
};

const existsClauses = (condition: string): Array<{ negated: boolean; sql: string }> => {
  const clauses: Array<{ negated: boolean; sql: string }> = [];
  for (const match of condition.matchAll(/\b(not\s+)?exists\s*\(/gi)) {
    const open = condition.indexOf('(', match.index ?? 0);
    let depth = 0;
    let inString = false;
    for (let index = open; index < condition.length; index += 1) {
      const character = condition[index];
      if (character === "'") {
        if (inString && condition[index + 1] === "'") {
          index += 1;
          continue;
        }
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (character === '(') depth += 1;
      if (character === ')') {
        depth -= 1;
        if (depth === 0) {
          clauses.push({ negated: Boolean(match[1]), sql: condition.slice(open + 1, index) });
          break;
        }
      }
    }
  }
  return clauses;
};

const expectExecutableSmokeFlow = (
  smoke: string,
  description: string,
  setup: RegExp[],
  scanner: RegExp,
  outcome: { polarity: 'exists' | 'not exists'; predicates: RegExp[] },
): void => {
  const statements = statementRecords(smoke);
  const setupStatement = statements.find(statement => setup.every(pattern => pattern.test(statement.text)));
  expect(setupStatement, description + ': executable fixture setup is missing').toBeDefined();
  const scanStatement = statements.find(statement => (
    statement.index > (setupStatement?.index ?? Number.MAX_SAFE_INTEGER)
    && scanner.test(statement.text)
  ));
  expect(scanStatement, description + ': scanner invocation after setup is missing').toBeDefined();
  const scanCall = scanStatement?.text.match(
    /\b([a-z_][a-z0-9_]*)\s*:=\s*app_private\.scan_wms_reconciliation_phase_[a-z_]+\s*\(\s*([a-z_][a-z0-9_]*)\s*,[\s\S]*,\s*([a-z_][a-z0-9_]*)\s*\)\s*$/i,
  );
  expect(scanCall, description + ': scanner result/run/snapshot variables must be captured').not.toBeNull();
  const scanResult = scanCall?.[1] ?? 'missing_scan_result';
  const runVariable = scanCall?.[2] ?? 'missing_run_id';
  const snapshotVariable = scanCall?.[3] ?? 'missing_snapshot';
  expect(
    statements.some(statement => (
      statement.index < (scanStatement?.index ?? -1)
      && /insert\s+into\s+public\.wms_reconciliation_runs/i.test(statement.text)
      && new RegExp('\\b' + escapeRegExp(runVariable) + '\\b', 'i').test(statement.text)
      && new RegExp('\\b' + escapeRegExp(snapshotVariable) + '\\b', 'i').test(statement.text)
    )),
    description + ': scanner run and snapshot must come from the executable run fixture',
  ).toBe(true);
  const blocks = [...smoke.matchAll(/\bif\b([\s\S]*?)\bthen\b([\s\S]*?)\bend\s+if\s*;/gi)]
    .map(match => ({ index: match.index ?? -1, condition: match[1], body: match[2] }));
  expect(
    blocks.some(block => (
      block.index > (scanStatement?.index ?? Number.MAX_SAFE_INTEGER)
      && existsClauses(block.condition).some(clause => (
        clause.negated === (outcome.polarity === 'not exists')
        && outcome.predicates.every(pattern => pattern.test(clause.sql))
        && new RegExp(
          '\\b(?:[a-z_][a-z0-9_]*\\.)?run_id\\s*=\\s*' + escapeRegExp(runVariable) + '\\b',
          'i',
        ).test(clause.sql)
      ))
      && new RegExp(
        "(?:\\(?\\s*" + escapeRegExp(scanResult) + "\\s*->>\\s*'complete'\\s*\\)?\\s*::\\s*boolean\\s+is\\s+not\\s+true"
        + "|coalesce\\s*\\([^)]*" + escapeRegExp(scanResult) + "[^)]*'complete'[^)]*\\)\\s+is\\s+not\\s+true)",
        'i',
      ).test(block.condition)
      && /\bor\b/i.test(block.condition)
      && !/\b(?:and\s+false|false\s+and|or\s+true|true\s+or)\b/i.test(block.condition)
      && /^\s*raise\s+exception\b/i.test(block.body)
    )),
    description + ': linked outcome must use the correct EXISTS polarity and raise on mismatch',
  ).toBe(true);
};

const phases = ['physical_anchor', 'opening_balance', 'transaction_ledger'];

describe('WMS reconciliation B2b scanner review hardening', () => {
  it('is a forward-only migration after the rejected B2b implementation', () => {
    const { file, sql } = loadMigration();
    expect(file.localeCompare('20260715210000_wms_reconciliation_anchor_ledger_scanner.sql')).toBeGreaterThan(0);
    expect(sql).not.toMatch(/drop\s+table\s+public\.(transactions|inventory_transactions|inventory_ledger_entries)/i);
  });

  it('atomically freezes scoped candidates and immutable header/entry evidence at run insertion', () => {
    const { sql } = loadMigration();
    expect(sql).toMatch(/create\s+table\s+app_private\.wms_reconciliation_frozen_sources/i);
    expect(sql).toMatch(/after\s+insert\s+on\s+public\.wms_reconciliation_runs/i);
    expect(sql).toMatch(/security\s+definer[\s\S]*set\s+search_path\s*=\s*''/i);
    expect(sql).toMatch(/insert\s+into\s+app_private\.wms_reconciliation_frozen_sources/i);
    expect(sql).toMatch(/public\.transactions/i);
    expect(sql).toMatch(/public\.inventory_transactions/i);
    expect(sql).toMatch(/public\.inventory_ledger_entries/i);
    expect(sql).toMatch(/warehouseIds/i);
    expect(sql).toMatch(/itemIds/i);
    expect(sql).toMatch(/affected_from/i);
    expect(sql).toMatch(/new\.as_of/i);
    expect(sql).toMatch(/revoke\s+all\s+privileges\s+on\s+table\s+app_private\.wms_reconciliation_frozen_sources/i);
    for (const phase of phases) {
      const body = functionBody(sql, `app_private.scan_wms_reconciliation_phase_${phase}`);
      expect(body).toMatch(/app_private\.wms_reconciliation_frozen_sources/i);
      expect(body).not.toMatch(/from\s+public\.(audit_sessions|project_opening_balances|transactions)\b/i);
    }
  });

  it('lets only valid anchors create replay exclusions', () => {
    const { sql } = loadMigration();
    for (const phase of ['physical_anchor', 'opening_balance']) {
      const body = functionBody(sql, `app_private.scan_wms_reconciliation_phase_${phase}`);
      expect(body).toMatch(/v_anchor_valid/i);
      expect(body).toMatch(/if\s+v_anchor_valid[\s\S]*insert\s+into\s+app_private\.wms_reconciliation_run_work/i);
      expect(body).not.toMatch(/if\s+not\s+v_anchor_valid[\s\S]{0,800}insert\s+into\s+app_private\.wms_reconciliation_run_work/i);
    }
    const ledger = functionBody(sql, 'app_private.scan_wms_reconciliation_phase_transaction_ledger');
    expect(ledger).toMatch(/anchor_work[\s\S]*payload\s*->>\s*'validAnchor'\s*=\s*'true'/i);
  });

  it('gates WF-001 confidence through an operator-owned exposure window and legacy fingerprint', () => {
    const { sql } = loadMigration();
    expect(sql).toMatch(/create\s+table\s+app_private\.wms_reconciliation_wf001_exposure_windows/i);
    expect(sql).toMatch(/legacy_function_hash/i);
    expect(sql).toMatch(/effective_from/i);
    expect(sql).toMatch(/effective_to/i);
    expect(sql).toMatch(/revoke\s+all\s+privileges[\s\S]*wms_reconciliation_wf001_exposure_windows/i);
    const ledger = functionBody(sql, 'app_private.scan_wms_reconciliation_phase_transaction_ledger');
    expect(sql).toMatch(/scoped_transactions[\s\S]*wms_reconciliation_wf001_exposure_windows/i);
    expect(ledger).toMatch(/exposureWindows/i);
    expect(ledger).toMatch(/posted_at|completed_at/i);
    expect(ledger).toMatch(/legacyFunctionHash/i);
    expect(ledger).toMatch(/confidence[\s\S]*high/i);
    expect(ledger).toMatch(/quarantined/i);
  });

  it('pins the canonical WF-001 fingerprint to immutable code and posted ledger time', () => {
    const { sql } = loadMigration();
    const freezer = functionBody(sql, 'app_private.freeze_wms_reconciliation_run_sources');
    const fingerprintAssertion = functionBody(sql, 'app_private.assert_wms_reconciliation_b2b_fingerprints');
    const exactHelper = exactFunction(sql, knownWf001HashFunction);
    const manifestStart = freezer.indexOf("'manifest'::text");
    const manifestEnd = freezer.indexOf('union all', manifestStart);
    const manifest = manifestStart >= 0 && manifestEnd > manifestStart
      ? freezer.slice(manifestStart, manifestEnd)
      : '';
    const helperDefinitionHash = /app_private\.wms_reconciliation_function_hash\s*\(\s*'app_private\.wms_reconciliation_known_wf001_legacy_function_hash\(\)'\s*::\s*regprocedure\s*\)/i;
    const validatorDefinitionHash = /app_private\.wms_reconciliation_function_hash\s*\(\s*'app_private\.validate_wms_reconciliation_frozen_transaction\(jsonb,jsonb\)'\s*::\s*regprocedure\s*\)/i;

    expect(exactHelper.header).toMatch(
      /wms_reconciliation_known_wf001_legacy_function_hash\s*\(\s*\)\s*returns\s+text\b[\s\S]*\blanguage\s+(?:sql|plpgsql)\b[\s\S]*\bimmutable\b[\s\S]*\bparallel\s+safe\b/i,
    );
    expect(compactSql(exactHelper.body)).toMatch(new RegExp(
      "^(?:select\\s+)?'" + canonicalWf001LegacyFunctionHash + "'(?:\\s*::\\s*text)?\\s*;?$"
      + "|^begin\\s+return\\s+'" + canonicalWf001LegacyFunctionHash
      + "'(?:\\s*::\\s*text)?\\s*;\\s*end\\s*;?$",
      'i',
    ));
    expect(manifest).toMatch(
      /'[^']*(?:canonical|wf001|legacy)[^']*'\s*,\s*app_private\.wms_reconciliation_known_wf001_legacy_function_hash\s*\(\s*\)/i,
    );
    const helperManifestEntry = manifest.match(new RegExp(
      "'([^']+)'\\s*,\\s*(" + helperDefinitionHash.source + ')',
      'i',
    ));
    const validatorManifestEntry = manifest.match(new RegExp(
      "'([^']+)'\\s*,\\s*(" + validatorDefinitionHash.source + ')',
      'i',
    ));
    expect(helperManifestEntry, 'manifest must store the helper definition hash under its own key').not.toBeNull();
    expect(validatorManifestEntry, 'manifest must store the validator definition hash under its own key').not.toBeNull();
    expect(helperManifestEntry?.[1]).not.toBe(validatorManifestEntry?.[1]);

    const fingerprintIfBlocks = [...fingerprintAssertion.matchAll(
      /\bif\b([\s\S]*?)\bthen\b([\s\S]*?)\bend\s+if\s*;/gi,
    )];
    const expectManifestHashGuard = (key: string, currentHash: RegExp, description: string): void => {
      const escapedKey = escapeRegExp(key);
      const storedPath = "v_manifest\\s*(?:#>>\\s*'\\{[^']*" + escapedKey
        + "\\}'|(?:->\\s*'[^']+'\\s*)*->>\\s*'" + escapedKey + "')";
      const directComparison = new RegExp(
        '^\\s*\\(*\\s*(?:' + storedPath + '\\s+is\\s+distinct\\s+from\\s+' + currentHash.source
        + '|' + currentHash.source + '\\s+is\\s+distinct\\s+from\\s+' + storedPath + ')\\s*\\)*\\s*$',
        'i',
      );
      expect(
        fingerprintIfBlocks.some(block => (
          directComparison.test(block[1])
          && /^\s*raise\s+exception[\s\S]*errcode\s*=\s*'40001'/i.test(block[2])
        )),
        description,
      ).toBe(true);
    };
    expectManifestHashGuard(
      helperManifestEntry?.[1] ?? 'missingHelperDefinitionHash',
      helperDefinitionHash,
      'stored helper definition hash must be compared directly with the current helper definition hash',
    );
    expectManifestHashGuard(
      validatorManifestEntry?.[1] ?? 'missingValidatorDefinitionHash',
      validatorDefinitionHash,
      'stored validator definition hash must be compared directly with the current validator definition hash',
    );
    expect(fingerprintAssertion).toMatch(
      /(?:v_manifest|p_source_snapshot)[\s\S]{0,320}(?:canonical|wf001|legacy)[\s\S]{0,320}is\s+distinct\s+from\s+app_private\.wms_reconciliation_known_wf001_legacy_function_hash\s*\(\s*\)/i,
    );
    const postingFingerprintAssignments = [
      ...sql.matchAll(/'postingFunctionFingerprint'\s*,/gi),
    ];
    expect(postingFingerprintAssignments).toHaveLength(1);
    expect(sql).toMatch(
      /'postingFunctionFingerprint'\s*,\s*app_private\.wms_reconciliation_known_wf001_legacy_function_hash\s*\(\s*\)\s*(?:,|\))/i,
    );
    expect(sql).not.toMatch(
      /jsonb_(?:set|insert)\s*\([^;]{0,600}postingFunctionFingerprint|postingFunctionFingerprint[^;]{0,300}\blegacy_function_hash\b/i,
    );
    const exposureFreeze = freezer.slice(
      freezer.indexOf("'exposureWindows'"),
      freezer.indexOf("'postingFunctionFingerprint'"),
    );
    expect(exposureFreeze).toMatch(
      /\b[a-z_][a-z0-9_]*\.posting_engine_version\s+is\s+not\s+distinct\s+from\s+[a-z_][a-z0-9_]*\.posting_engine_version/i,
    );
    expect(exposureFreeze).toMatch(
      /\b[a-z_][a-z0-9_]*\.posted_at\s*>=\s*[a-z_][a-z0-9_]*\.effective_from[\s\S]{0,240}\b[a-z_][a-z0-9_]*\.posted_at\s*<\s*[a-z_][a-z0-9_]*\.effective_to/i,
    );
    expect(exposureFreeze).not.toMatch(
      /\b[a-z_][a-z0-9_]*\.date\s*(?:>=|<)\s*[a-z_][a-z0-9_]*\.effective_(?:from|to)/i,
    );
    const helperRevoke = sql.match(
      /revoke\s+all\s+on\s+function\s+app_private\.wms_reconciliation_known_wf001_legacy_function_hash\s*\(\s*\)\s+from\s+([^;]+)/i,
    );
    expect(helperRevoke, 'canonical helper must remain private').not.toBeNull();
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      expect(helperRevoke?.[1] ?? '').toMatch(new RegExp('\\b' + role + '\\b', 'i'));
    }

  });

  it('uses one pure frozen validator for exact ledger identity and signed adjustments', () => {
    const { sql } = loadMigration();
    const validator = functionBody(sql, frozenTransactionValidator);
    const ledger = functionBody(sql, 'app_private.scan_wms_reconciliation_phase_transaction_ledger');
    const escapedValidator = frozenTransactionValidator.replace(/\./g, '\\.');
    const exactValidator = exactFunction(sql, frozenTransactionValidator);

    expect(exactValidator.header).toMatch(
      /validate_wms_reconciliation_frozen_transaction\s*\(\s*(?:[a-z_][a-z0-9_]*\s+)?jsonb\s*,\s*(?:[a-z_][a-z0-9_]*\s+)?jsonb\s*\)\s*returns\s+jsonb\b/i,
    );
    expect(exactValidator.header).toMatch(/\blanguage\s+(?:sql|plpgsql)\b/i);
    expect(exactValidator.header).toMatch(/\bimmutable\b/i);
    expect(exactValidator.header).toMatch(/\bset\s+search_path\s*=\s*''/i);
    const validatorRevoke = sql.match(new RegExp(
      'revoke\\s+all\\s+on\\s+function\\s+' + escapedValidator
      + '\\s*\\(\\s*jsonb\\s*,\\s*jsonb\\s*\\)\\s+from\\s+([^;]+)',
      'i',
    ));
    expect(validatorRevoke, 'frozen transaction validator must remain private').not.toBeNull();
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      expect(validatorRevoke?.[1] ?? '').toMatch(new RegExp('\\b' + role + '\\b', 'i'));
    }
    expect(validator).not.toMatch(
      /\b(?:insert\s+into|update\s+(?:only\s+)?[a-z_][a-z0-9_$.]*\s+set|delete\s+from|merge\s+into|truncate(?:\s+table)?|execute|call)\b/i,
    );
    expect(validator).not.toMatch(
      /\b(?:from|join|table)\s+(?:lateral\s+)?(?:only\s+)?"/i,
    );
    expect(validator).not.toMatch(/\btable\s+(?:only\s+)?(?:[a-z_][a-z0-9_$.]*|\()/i);
    const jsonbSetReturningSource = /^(?:pg_catalog\.)?jsonb_(?:array_elements(?:_text)?|each(?:_text)?|to_record(?:set)?)$/i;
    for (const statement of validator.split(';')) {
      const statementCtes = new Set(
        [...statement.matchAll(/(?:\bwith(?:\s+recursive)?|,)\s*([a-z_][a-z0-9_]*)\s+as\s+(?:not\s+materialized\s+|materialized\s+)?\(/gi)]
          .map(match => match[1].toLowerCase()),
      );
      const statementSources = relationSourcesInStatement(statement);
      for (const source of statementSources) {
        expect(
          source === '(' || source === 'values' || statementCtes.has(source) || jsonbSetReturningSource.test(source),
          'pure validator relation source is not statement-local frozen-JSON/CTE data: ' + source,
        ).toBe(true);
      }
    }
    const allowedValidatorCalls = new Set([
      'abs', 'array', 'bigint', 'boolean', 'coalesce', 'count', 'dense_rank', 'greatest',
      'integer', 'jsonb', 'least', 'nullif', 'numeric', 'round', 'row_number', 'sum', 'text',
      'jsonb_agg', 'jsonb_array_elements', 'jsonb_array_elements_text',
      'jsonb_build_array', 'jsonb_build_object', 'jsonb_each', 'jsonb_each_text',
      'jsonb_object_agg', 'jsonb_to_record', 'jsonb_to_recordset',
      'app_private.normalize_quantity_unit',
      'app_private.try_wms_reconciliation_numeric_20_6',
    ]);
    const relationAliasCalls = new Set(
      [...validator.matchAll(/\)\s+(?:as\s+)?([a-z_][a-z0-9_]*)\s*\(/gi)].map(match => match[1].toLowerCase()),
    );
    const sqlCallKeywords = new Set([
      'and', 'begin', 'by', 'case', 'exists', 'filter', 'if', 'in', 'lateral', 'not',
      'or', 'over', 'return', 'then', 'values', 'when', 'within',
    ]);
    for (const call of validator.matchAll(/\b((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)\s*\(/gi)) {
      const name = call[1].toLowerCase();
      if (
        name.startsWith('pg_catalog.') || allowedValidatorCalls.has(name)
        || relationAliasCalls.has(name) || sqlCallKeywords.has(name)
      ) continue;
      expect.fail('pure validator calls an unapproved indirect helper: ' + name);
    }
    expect(validator).not.toMatch(
      /\b(?:clock_timestamp|statement_timestamp|transaction_timestamp|random|nextval|currval|setval|set_config)\s*\(/i,
    );

    const identityResult = validator.match(
      /'entryIdentityValid'\s*,\s*([a-z_][a-z0-9_]*)/i,
    );
    expect(identityResult, 'validator must return its computed entry identity flag').not.toBeNull();
    const identityVariable = identityResult?.[1] ?? 'missing_identity_variable';
    const identityAssignment = validator.match(new RegExp(
      identityVariable + '\\s*:=\\s*not\\s+exists\\s*\\(([\\s\\S]*?)\\)\\s*;',
      'i',
    ));
    expect(
      identityAssignment,
      'entryIdentityValid must come from a bijective expected-vs-actual NOT EXISTS comparison',
    ).not.toBeNull();
    const identityComparison = identityAssignment?.[1] ?? '';
    for (const [expectedField, actualField] of [
      ['entryNo', 'entry_no'],
      ['sourceLineId', 'source_line_id'],
      ['sourceCode', 'source_code'],
      ['transactionDate', 'transaction_date'],
      ['transactionType', 'transaction_type'],
    ]) {
      expect(identityComparison, expectedField + ' must compare directly with ' + actualField).toMatch(
        new RegExp(
          "(?:[a-z_][a-z0-9_.]*\\s*->>\\s*'" + expectedField
          + "'\\s+is\\s+distinct\\s+from\\s+[a-z_][a-z0-9_.]*\\s*->>\\s*'" + actualField
          + "'|[a-z_][a-z0-9_.]*\\s*->>\\s*'" + actualField
          + "'\\s+is\\s+distinct\\s+from\\s+[a-z_][a-z0-9_.]*\\s*->>\\s*'" + expectedField + "')",
          'i',
        ),
      );
    }
    expect(identityComparison).toMatch(
      /[a-z_][a-z0-9_.]*\s*->\s*'metadata'\s*(?:is\s+distinct\s+from|<@|@>)\s*[a-z_][a-z0-9_.]*\s*->\s*'metadata'/i,
    );
    expect(identityComparison).toMatch(
      /full\s+(?:outer\s+)?join|jsonb_array_length[\s\S]{0,180}(?:=|<>|is\s+distinct\s+from)[\s\S]{0,180}jsonb_array_length/i,
    );

    const returnedKeys = [
      'expectedEntries', 'actualEntries', 'sourceValid', 'headerExists', 'headerValid',
      'entryIdentityValid', 'quantityExact', 'quantityRounded',
    ];
    for (const key of returnedKeys) {
      expect(validator, 'validator result is missing ' + key).toMatch(
        new RegExp("'" + key + "'\\s*,\\s*[a-z_][a-z0-9_]*", 'i'),
      );
    }
    const sourceValidResult = validator.match(/'sourceValid'\s*,\s*([a-z_][a-z0-9_]*)/i);
    expect(sourceValidResult).not.toBeNull();
    const sourceValidAssignment = validator.match(new RegExp(
      '\\b' + (sourceValidResult?.[1] ?? 'missing_source_valid') + '\\s*:=\\s*([\\s\\S]*?)\\s*;',
      'i',
    ));
    expect(sourceValidAssignment, 'sourceValid must be assigned from frozen source data').not.toBeNull();
    const sourceValidExpression = sourceValidAssignment?.[1] ?? '';
    expect(sourceValidExpression).toMatch(
      /'ADJUSTMENT'[\s\S]{0,500}(?:->>\s*'quantity'|\b[a-z_][a-z0-9_.]*quantity\b|\bquantity\b)[\s\S]{0,80}<>\s*0|(?:->>\s*'quantity'|\b[a-z_][a-z0-9_.]*quantity\b|\bquantity\b)[\s\S]{0,80}<>\s*0[\s\S]{0,500}'ADJUSTMENT'/i,
    );
    expect(sourceValidExpression, 'sourceValid must accept negative ADJUSTMENT quantities').not.toMatch(
      /(?:->>\s*'quantity'|\b[a-z_][a-z0-9_.]*quantity\b|\bquantity\b|\([^;\n)]*quantity[^;\n)]*\))\s*>\s*=?\s*0|0\s*<\s*=?\s*(?:\([^;\n)]*quantity[^;\n)]*\)|[a-z_][a-z0-9_.]*quantity\b|quantity\b)/i,
    );
    expect(validator).toMatch(
      /jsonb_array_elements\s*\([^)]*(?:items|transaction)[^)]*\)\s+with\s+ordinality/i,
    );
    for (const [type, entryType, direction] of [
      ['IMPORT', 'purchase_receipt', 'in'],
      ['EXPORT', 'project_issue', 'out'],
      ['LIQUIDATION', 'loss_issue', 'out'],
    ]) {
      expect(validator, type + ' expected-entry mapping is missing').toMatch(new RegExp(
        "'" + type + "'[\\s\\S]{0,600}'" + entryType + "'[\\s\\S]{0,240}'" + direction + "'",
        'i',
      ));
    }
    expect(validator).toMatch(
      /'TRANSFER'[\s\S]{0,1800}'transfer_issue'[\s\S]{0,360}'out'[\s\S]{0,1800}'transfer_receipt'[\s\S]{0,360}'in'/i,
    );
    expect(validator).toMatch(
      /'ADJUSTMENT'[\s\S]{0,900}quantity[\s\S]{0,100}<>\s*0[\s\S]{0,500}case[\s\S]{0,240}quantity[\s\S]{0,100}>\s*0[\s\S]{0,180}'in'[\s\S]{0,180}'out'/i,
    );
    expect(validator).toMatch(
      /'ADJUSTMENT'[\s\S]{0,1400}(?:quantityIn|quantityOut|quantityDelta)[\s\S]{0,300}(?:pg_catalog\.)?abs\s*\([^)]*quantity/i,
    );

    const validationCall = ledger.match(new RegExp(
      '([a-z_][a-z0-9_]*)\\s*:=\\s*' + escapedValidator
      + "\\s*\\(\\s*v_source\\s*,\\s*(?:v_frozen\\.payload\\s*->\\s*'ledgerHeaders'|[a-z_][a-z0-9_]*)\\s*\\)",
      'i',
    ));
    expect(validationCall, 'ledger scanner must assign the validator result').not.toBeNull();
    const validationVariable = validationCall?.[1] ?? 'missing_validation_result';
    for (const key of ['headerExists', 'headerValid', 'entryIdentityValid', 'quantityExact', 'quantityRounded']) {
      expect(ledger).toMatch(new RegExp(
        validationVariable + "\\s*(?:#>>\\s*'\\{?" + key + "\\}?'|->>\\s*'" + key + "')",
        'i',
      ));
    }
    for (const [key, findingType] of [
      ['headerExists', 'TX_LEDGER_MISSING'],
      ['entryIdentityValid', 'LINEAGE_GAP'],
      ['quantityRounded', 'DECIMAL_APPLY'],
      ['quantityExact', 'TX_LEDGER_MISMATCH'],
    ]) {
      expect(ledger, findingType + ' must be classified from validator.' + key).toMatch(new RegExp(
        validationVariable + "[\\s\\S]{0,120}'" + key + "'[\\s\\S]{0,700}'" + findingType + "'"
        + "|'" + findingType + "'[\\s\\S]{0,700}" + validationVariable + "[\\s\\S]{0,120}'" + key + "'",
        'i',
      ));
    }
    expect(ledger).not.toMatch(
      /(?:coalesce\s*\(\s*)?(?:[a-z_][a-z0-9_.]*quantity|[a-z_][a-z0-9_.]*->>\s*'quantity')(?:\s*,\s*0\s*\))?\s*>\s*0|0\s*<\s*(?:[a-z_][a-z0-9_.]*quantity|[a-z_][a-z0-9_.]*->>\s*'quantity')/i,
    );

  });

  it('validates full command, line, stock transaction and ledger quantity provenance for anchors', () => {
    const { sql } = loadMigration();
    for (const phase of ['physical_anchor', 'opening_balance']) {
      const body = functionBody(sql, `app_private.scan_wms_reconciliation_phase_${phase}`);
      expect(body).toMatch(/commandResult/i);
      expect(body).toMatch(/stockTransaction/i);
      expect(body).toMatch(/transactionItems/i);
      expect(body).toMatch(/ledgerEntries/i);
      expect(body).toMatch(/quantity_in/i);
      expect(body).toMatch(/quantity_out/i);
      expect(body).toMatch(/ledgerQuantities/i);
      expect(body).toMatch(/precondition_hash/i);
    }
  });

  it('requires exact audit and deterministic original/reversal anchor provenance', () => {
    const { sql } = loadMigration();
    const freezer = functionBody(sql, 'app_private.freeze_wms_reconciliation_run_sources');
    const physical = functionBody(sql, 'app_private.scan_wms_reconciliation_phase_physical_anchor');
    const opening = functionBody(sql, 'app_private.scan_wms_reconciliation_phase_opening_balance');
    const exactAuditSnapshot = /(?:v_command_result\s*#>\s*'\{result,audit_session\}'\s*(?:-\s*'totalLossValue')?\s+is\s+distinct\s+from\s+v_source(?:\s*-\s*'totalLossValue')?|v_source(?:\s*-\s*'totalLossValue')?\s+is\s+distinct\s+from\s+v_command_result\s*#>\s*'\{result,audit_session\}'\s*(?:-\s*'totalLossValue')?)/i;
    const exactAuditTransaction = /(?:v_command_result\s*#>\s*'\{result,stock_transaction\}'\s+is\s+distinct\s+from\s+v_stock_transaction|v_stock_transaction\s+is\s+distinct\s+from\s+v_command_result\s*#>\s*'\{result,stock_transaction\}')/i;

    expect(physical).toMatch(exactAuditSnapshot);
    expect(physical).toMatch(exactAuditTransaction);
    const physicalValidation = physical.match(
      /([a-z_][a-z0-9_]*)\s*:=\s*app_private\.validate_wms_reconciliation_frozen_transaction\s*\(\s*v_stock_transaction\s*,\s*(?:v_frozen\.payload\s*->\s*'ledgerHeaders'|[a-z_][a-z0-9_]*)\s*\)/i,
    );
    expect(physicalValidation, 'physical anchor must consume the pure validator').not.toBeNull();
    const physicalValidationVariable = physicalValidation?.[1] ?? 'missing_physical_validation';
    expect(physical).toMatch(new RegExp(
      "if[\\s\\S]{0,700}" + physicalValidationVariable
      + "[\\s\\S]{0,120}'entryIdentityValid'[\\s\\S]{0,400}v_anchor_valid\\s*:=\\s*false",
      'i',
    ));
    const zeroArtifactGuard = new RegExp(
      "^\\s*not\\s+exists\\s*\\((?=[\\s\\S]{0,900}'delta'[\\s\\S]{0,160}(?:<>|is\\s+distinct\\s+from)\\s*0)"
      + "[\\s\\S]*?\\)\\s+and\\s*\\(\\s*"
      + "v_source\\s*->>\\s*'transactionId'\\s+is\\s+not\\s+null\\s+or\\s+"
      + "v_command_result\\s*#>\\s*'\\{result,stock_transaction\\}'\\s*(?:is\\s+not\\s+null|<>\\s*'null'::jsonb)\\s+or\\s+"
      + "v_stock_transaction\\s*(?:is\\s+not\\s+null|<>\\s*'null'::jsonb)\\s+or\\s+"
      + "(?:pg_catalog\\.)?jsonb_array_length\\s*\\(\\s*v_frozen\\.payload\\s*->\\s*'ledgerHeaders'\\s*\\)\\s*<>\\s*0"
      + "\\s*\\)\\s*$",
      'i',
    );
    const zeroArtifactCondition = [...physical.matchAll(/\bif\b([\s\S]*?)\bthen\b/gi)]
      .map(match => match[1])
      .find(condition => zeroArtifactGuard.test(condition));
    expect(
      zeroArtifactCondition,
      'all-zero guard must be exactly zero_delta AND (artifact1 OR artifact2 OR artifact3 OR artifact4)',
    ).toBeDefined();

    const frozenEvidenceVariables = new Map<string, string>();
    const evidenceSpecs = [
      { key: 'originalStockTransactions', ids: 'stock_transaction_ids', relation: 'public.transactions', field: 'id' },
      { key: 'originalLedgerHeaders', ids: 'stock_transaction_ids', relation: 'public.inventory_transactions', field: 'source_id' },
      { key: 'reversalStockTransactions', ids: 'reversal_stock_transaction_ids', relation: 'public.transactions', field: 'id' },
      { key: 'reversalLedgerHeaders', ids: 'reversal_stock_transaction_ids', relation: 'public.inventory_transactions', field: 'source_id' },
    ];
    for (const spec of evidenceSpecs) {
      const aggregate = sqlCallAfter(freezer, "'" + spec.key + "'", 'coalesce');
      expect(aggregate, spec.key + ' must be its own executable JSON aggregate').toMatch(
        /select\s+(?:pg_catalog\.)?jsonb_agg\s*\(/i,
      );
      const filterIndex = aggregate.search(/\bwhere\b/i);
      expect(filterIndex, spec.key + ' aggregate needs its own ID-array filter').toBeGreaterThanOrEqual(0);
      const filter = filterIndex >= 0 ? aggregate.slice(filterIndex) : '';
      const relationAlias = aggregate.match(new RegExp(
        '\\bfrom\\s+' + escapeRegExp(spec.relation) + '\\s+(?:as\\s+)?([a-z_][a-z0-9_]*)',
        'i',
      ));
      expect(relationAlias, spec.key + ' must aggregate the correct source relation ' + spec.relation).not.toBeNull();
      const row = new RegExp(
        '\\b' + escapeRegExp(relationAlias?.[1] ?? 'missing_relation_alias')
        + '\\.' + escapeRegExp(spec.field) + '\\b',
        'i',
      );
      const directContainment = new RegExp(
        "(?:\\b[a-z_][a-z0-9_]*\\." + spec.ids + "\\b|->\\s*'" + spec.ids
        + "'|#>\\s*'\\{" + spec.ids + "\\}')\\s*\\?\\s*"
        + row.source,
        'i',
      );
      const directInSubquery = new RegExp(
        row.source + "\\s+in\\s*\\(\\s*select[\\s\\S]{0,400}jsonb_array_elements_text"
        + "\\s*\\([^)]*'" + spec.ids + "'[^)]*\\)",
        'i',
      );
      const idsElement = new RegExp(
        "jsonb_array_elements_text\\s*\\([^)]*'" + spec.ids
        + "'[^)]*\\)\\s+(?:as\\s+)?([a-z_][a-z0-9_]*)(?:\\s*\\(\\s*([a-z_][a-z0-9_]*)\\s*\\))?",
        'i',
      ).exec(filter);
      const member = idsElement
        ? escapeRegExp(idsElement[1] + (idsElement[2] ? '.' + idsElement[2] : '.value'))
        : 'missing_id_member';
      const directElementEquality = new RegExp(
        '(?:' + row.source + '\\s*(?:=|is\\s+not\\s+distinct\\s+from)\\s*' + member
        + '|' + member + '\\s*(?:=|is\\s+not\\s+distinct\\s+from)\\s*' + row.source + ')',
        'i',
      );
      expect(
        directContainment.test(filter) || directInSubquery.test(filter) || directElementEquality.test(filter),
        spec.key + ' must filter its row identity directly through ' + spec.ids,
      ).toBe(true);
      expect(filter, spec.key + ' membership must be positive and undiluted').not.toMatch(/\b(?:not|or)\b/i);

      const payloadAssignment = opening.match(new RegExp(
        "\\b([a-z_][a-z0-9_]*)\\s*:=\\s*v_frozen\\.payload\\s*->\\s*'" + spec.key + "'",
        'i',
      ));
      expect(payloadAssignment, 'opening scanner must bind its own ' + spec.key + ' array').not.toBeNull();
      frozenEvidenceVariables.set(spec.key, payloadAssignment?.[1] ?? 'missing_' + spec.key);
    }
    expect(opening).toMatch(
      /v_command_result\s*#>\s*'\{result,stock_transactions\}'\s+is\s+distinct\s+from\s+v_original_stock_transactions/i,
    );
    expect(opening).toMatch(
      /v_reversal_result\s*#>\s*'\{result,compensating_stock_transactions\}'\s+is\s+distinct\s+from\s+v_reversal_stock_transactions/i,
    );
    expect(opening).toMatch(
      /v_reversal_result\s*#>\s*'\{result,stock_transaction_map\}'[\s\S]{0,240}originalTransactionId[\s\S]{0,240}compensatingTransactionId/i,
    );
    expect(physical).toMatch(
      /(?:v_source\s*->>\s*'transactionId'\s+is\s+distinct\s+from\s+v_stock_transaction\s*->>\s*'id'|v_stock_transaction\s*->>\s*'id'\s+is\s+distinct\s+from\s+v_source\s*->>\s*'transactionId')/i,
    );

    const evidenceValidations: Array<{ label: string; result: string }> = [];
    for (const [label, stockKey, headerKey] of [
      ['original', 'originalStockTransactions', 'originalLedgerHeaders'],
      ['reversal', 'reversalStockTransactions', 'reversalLedgerHeaders'],
    ] as const) {
      const stockVariable = frozenEvidenceVariables.get(stockKey) ?? 'missing_' + stockKey;
      const headerVariable = frozenEvidenceVariables.get(headerKey) ?? 'missing_' + headerKey;
      const expandedLoop = opening.match(new RegExp(
        "for\\s+([a-z_][a-z0-9_]*)\\s+in\\s+select\\s+([a-z_][a-z0-9_]*)\\.value\\s+from\\s+"
        + "(?:pg_catalog\\.)?jsonb_array_elements\\s*\\(\\s*" + escapeRegExp(stockVariable)
        + "\\s*\\)\\s+(?:as\\s+)?\\2\\s*\\(\\s*value\\s*\\)\\s+loop([\\s\\S]*?)end\\s+loop",
        'i',
      ));
      expect(expandedLoop, label + ' validator must iterate rows from its own stock array').not.toBeNull();
      const rowVariable = expandedLoop?.[1] ?? 'missing_' + label + '_row';
      const loopBody = expandedLoop?.[3] ?? '';
      const boundValidation = loopBody.match(new RegExp(
        "select\\s+coalesce\\s*\\([\\s\\S]{0,1200}into\\s+([a-z_][a-z0-9_]*)\\s+from\\s+"
        + "(?:pg_catalog\\.)?jsonb_array_elements\\s*\\(\\s*" + escapeRegExp(headerVariable)
        + "\\s*\\)[\\s\\S]{0,500}where[\\s\\S]{0,400}source_id[\\s\\S]{0,120}(?:=|is\\s+not\\s+distinct\\s+from)\\s*"
        + escapeRegExp(rowVariable) + "\\.value\\s*->>\\s*'id'\\s*;\\s*"
        + "([a-z_][a-z0-9_]*)\\s*:=\\s*app_private\\.validate_wms_reconciliation_frozen_transaction\\s*\\(\\s*"
        + escapeRegExp(rowVariable) + "\\.value\\s*,\\s*\\1\\s*\\)\\s*;",
        'i',
      ));
      expect(
        boundValidation,
        label + ' validator must immediately consume the expanded row and headers filtered from its own array',
      ).not.toBeNull();
      const resultVariable = boundValidation?.[2] ?? 'missing_' + label + '_validation';
      evidenceValidations.push({ label, result: resultVariable });

      const resultAtom = "\\(?\\s*\\(?\\s*" + escapeRegExp(resultVariable)
        + "\\s*->>\\s*'(?:sourceValid|headerValid|entryIdentityValid|quantityExact)'\\s*\\)?"
        + "\\s*::\\s*boolean\\s+is\\s+not\\s+true\\s*\\)?";
      const exactInvalidation = new RegExp(
        '^\\s*' + resultAtom + '(?:\\s+or\\s+' + resultAtom + '){3}\\s*$',
        'i',
      );
      const invalidation = [...loopBody.matchAll(/\bif\b([\s\S]*?)\bthen\b([\s\S]*?)\bend\s+if\s*;/gi)]
        .find(block => exactInvalidation.test(block[1])
          && /^\s*v_anchor_valid\s*:=\s*false\s*;/i.test(block[2]));
      expect(invalidation, label + ' validator failure guard must be operative and undiluted').toBeDefined();
      for (const key of ['sourceValid', 'headerValid', 'entryIdentityValid', 'quantityExact']) {
        expect(invalidation?.[1] ?? '').toContain("'" + key + "'");
      }
    }
    expect(evidenceValidations[0]?.result).not.toBe(evidenceValidations[1]?.result);
    const exactOpeningSuffix = "(?:[a-z_][a-z0-9_.]*\\s*->>\\s*'warehouse_id'|[a-z_][a-z0-9_]*warehouse_id)";
    expect(opening).toMatch(new RegExp(
      "is\\s+distinct\\s+from\\s+'opening-balance:'\\s*\\|\\|\\s*\\(?v_source\\s*->>\\s*'id'\\)?"
      + "\\s*\\|\\|\\s*':'\\s*\\|\\|\\s*pg_catalog\\.left\\s*\\(\\s*app_private\\.sha256_text"
      + "\\s*\\(\\s*" + exactOpeningSuffix + "\\s*\\)\\s*,\\s*16\\s*\\)",
      'i',
    ));
    expect(opening).toMatch(new RegExp(
      "is\\s+distinct\\s+from\\s+'opening-reversal:'\\s*\\|\\|\\s*\\(?v_source\\s*->>\\s*'id'\\)?"
      + "\\s*\\|\\|\\s*':'\\s*\\|\\|\\s*pg_catalog\\.left\\s*\\(\\s*app_private\\.sha256_text"
      + "\\s*\\(\\s*" + exactOpeningSuffix + "\\s*\\)\\s*,\\s*16\\s*\\)",
      'i',
    ));
    expect(opening).not.toMatch(/\b(?:not\s+)?(?:i?like)\b/i);
    expect(opening).toMatch(
      /project_opening_balance_reversal[\s\S]{0,5000}(?:->>\s*'quantity'|quantity)\s*<\s*0[\s\S]{0,1600}(?:quantityOut|quantity_out)[\s\S]{0,360}(?:pg_catalog\.)?abs\s*\([^)]*quantity/i,
    );
    expect(opening).toMatch(
      /project_opening_balance_reversal[\s\S]{0,5000}(?:quantityDelta|quantity_delta)[\s\S]{0,360}(?:=\s*[^;\n]*->>\s*'quantity'|=\s*-\s*(?:pg_catalog\.)?abs\s*\()/i,
    );

  });

  it('fails closed on warehouse, UOM, catalog and hostile numeric text without contaminating aggregates', () => {
    const { sql } = loadMigration();
    expect(sql).toMatch(/try_wms_reconciliation_numeric_20_6/i);
    const helper = functionBody(sql, 'app_private.try_wms_reconciliation_numeric_20_6');
    expect(helper).toMatch(/numeric_value_out_of_range/i);
    expect(helper).toMatch(/invalid_text_representation/i);
    for (const phase of phases) {
      const body = functionBody(sql, `app_private.scan_wms_reconciliation_phase_${phase}`);
      expect(body).toMatch(/warehouse.*missing|missing.*warehouse/i);
      expect(body).toMatch(/UOM_PRECISION|catalog/i);
      expect(body).toMatch(/validLine|line_valid/i);
    }
  });

  it('scopes ledger-only evidence and quarantines mixed units instead of choosing one', () => {
    const { sql } = loadMigration();
    const body = functionBody(sql, 'app_private.scan_wms_reconciliation_phase_transaction_ledger');
    expect(body).toMatch(/warehouseIds/i);
    expect(body).toMatch(/itemIds/i);
    expect(body).toMatch(/count\s*\(\s*distinct\s+[^)]*unit/i);
    expect(body).toMatch(/mixed ledger units/i);
    expect(body).not.toMatch(/min\s*\(\s*[^)]*unit/i);
  });

  it('checks current phase and recheck hashes on every scan and invalidates pre-hardening open runs', () => {
    const { sql } = loadMigration();
    expect(sql).toMatch(/assert_wms_reconciliation_b2b_fingerprints/i);
    expect(sql).toMatch(/wms_reconciliation_function_hash/i);
    expect(sql).toMatch(/scanPhases/i);
    expect(sql).toMatch(/recheck/i);
    for (const phase of phases) {
      const body = functionBody(sql, `app_private.scan_wms_reconciliation_phase_${phase}`);
      expect(body).toMatch(/assert_wms_reconciliation_b2b_fingerprints/i);
    }
    expect(sql).toMatch(/update\s+public\.wms_reconciliation_runs[\s\S]*status\s*=\s*'failed'/i);
    expect(sql).toMatch(/B2b frozen candidate snapshot/i);
  });

  it('ships an executable rollback smoke that seeds every critical path', () => {
    const smokePath = path.resolve(process.cwd(), 'supabase/tests/wms_reconciliation_anchor_ledger_scanner_smoke.sql');
    const smoke = stripSqlComments(fs.readFileSync(smokePath, 'utf8'));
    expect(smoke).toMatch(/^\s*begin\s*;/i);
    expect(smoke).toMatch(/rollback\s*;\s*$/i);
    expect(smoke).toMatch(/insert\s+into\s+public\.audit_sessions/i);
    expect(smoke).toMatch(/insert\s+into\s+public\.project_opening_balances/i);
    expect(smoke).toMatch(/insert\s+into\s+public\.transactions/i);
    expect(smoke).toMatch(/scan_wms_reconciliation_phase_physical_anchor/i);
    expect(smoke).toMatch(/scan_wms_reconciliation_phase_opening_balance/i);
    expect(smoke).toMatch(/scan_wms_reconciliation_phase_transaction_ledger/i);
    for (const pathName of ['PHYSICAL_ANCHOR', 'TX_LEDGER_MISSING', 'TX_LEDGER_MISMATCH', 'LINEAGE_GAP']) {
      expect(smoke).toContain(pathName);
    }
    expect(smoke).toMatch(/TRANSFER/i);
    expect(smoke).toMatch(/retry|idempot/i);
    expect(smoke).toMatch(/source counts|source_counts/i);
  });

  it('drives adversarial smoke cases through real cursors, retries and stale fingerprints', () => {
    const smokePath = path.resolve(process.cwd(), 'supabase/tests/wms_reconciliation_anchor_ledger_scanner_smoke.sql');
    const smoke = stripSqlComments(fs.readFileSync(smokePath, 'utf8'));

    expect(smoke).toMatch(/^\s*begin\s*;/i);
    expect(smoke).toMatch(/rollback\s*;\s*$/i);
    expect(smoke).not.toMatch(
      /insert\s+into\s+(?:public\.wms_reconciliation_findings|app_private\.wms_reconciliation_run_work)\b/i,
    );
    expect(smoke).toContain(canonicalWf001LegacyFunctionHash);
    const hashLiterals: string[] = smoke.match(/\b[0-9a-f]{64}\b/gi) ?? [];
    expect(
      hashLiterals.some(hash => hash.toLowerCase() !== canonicalWf001LegacyFunctionHash),
      'smoke needs a non-canonical fake 64-hex posting hash',
    ).toBe(true);
    expect(fakeWf001LegacyFunctionHash).not.toBe(canonicalWf001LegacyFunctionHash);
    const statements = statementRecords(smoke);
    const hasStatement = (patterns: RegExp[]): boolean => statements.some(
      statement => patterns.every(pattern => pattern.test(statement.text)),
    );
    expect(hasStatement([
      /insert\s+into\s+app_private\.wms_reconciliation_wf001_exposure_windows/i,
      /\blegacy_function_hash\b/i,
      new RegExp(canonicalWf001LegacyFunctionHash, 'i'),
    ]), 'canonical hash must be inserted as exposure evidence').toBe(true);
    expect(hasStatement([
      /insert\s+into\s+app_private\.wms_reconciliation_wf001_exposure_windows/i,
      /\blegacy_function_hash\b/i,
      new RegExp(fakeWf001LegacyFunctionHash, 'i'),
    ]), 'fake hash must be inserted into an exposure row, not left as an unrelated literal').toBe(true);
    expect(hasStatement([
      /insert\s+into\s+app_private\.wms_reconciliation_wf001_exposure_windows/i,
      /b2b-smoke-window-outside/i,
      /effective_from[\s\S]*effective_to/i,
      /\bactive\b/i,
    ]), 'outside-window fixture must have executable non-covering bounds').toBe(true);
    expect(hasStatement([
      /insert\s+into\s+app_private\.wms_reconciliation_wf001_exposure_windows/i,
      /b2b-smoke-window-overlap/i,
      /values[\s\S]*\)[\s\S]*,\s*\(/i,
    ]), 'overlap fixture must insert at least two active windows in one executable setup').toBe(true);

    const smokeIfBlocks = [...smoke.matchAll(
      /\bif\b([\s\S]*?)\bthen\b([\s\S]*?)\bend\s+if\s*;/gi,
    )].map(match => ({ condition: match[1], body: match[2] }));
    const outsideGeometry = smokeIfBlocks.flatMap(block => (
      /^\s*raise\s+exception\b/i.test(block.body)
        ? existsClauses(block.condition).filter(clause => !clause.negated).map(clause => ({ block, clause }))
        : []
    )).find(({ clause }) => (
      /\bfrom\s+app_private\.wms_reconciliation_wf001_exposure_windows\b/i.test(clause.sql)
      && /\b(?:join|,)\s+public\.inventory_transactions\b/i.test(clause.sql)
      && (clause.sql.match(/b2b-smoke-window-outside/gi)?.length ?? 0) >= 2
    ));
    expect(outsideGeometry, 'outside fixture must fail if its real posted header is covered').toBeDefined();
    const outsideAliases = outsideGeometry?.clause.sql.match(
      /from\s+app_private\.wms_reconciliation_wf001_exposure_windows\s+(?:as\s+)?([a-z_][a-z0-9_]*)[\s\S]{0,500}(?:join|,)\s+public\.inventory_transactions\s+(?:as\s+)?([a-z_][a-z0-9_]*)/i,
    );
    expect(outsideAliases).not.toBeNull();
    if (outsideAliases) {
      expect(outsideGeometry?.clause.sql ?? '').toMatch(new RegExp(
        escapeRegExp(outsideAliases[2]) + '\\.posted_at\\s*>=\\s*'
        + escapeRegExp(outsideAliases[1]) + '\\.effective_from',
        'i',
      ));
      expect(outsideGeometry?.clause.sql ?? '').toMatch(new RegExp(
        escapeRegExp(outsideAliases[2]) + '\\.posted_at\\s*<\\s*'
        + escapeRegExp(outsideAliases[1]) + '\\.effective_to',
        'i',
      ));
      expect(outsideGeometry?.clause.sql ?? '').toMatch(new RegExp(
        escapeRegExp(outsideAliases[2]) + "\\.source_id\\s*=\\s*'b2b-smoke-window-outside'",
        'i',
      ));
      expect(outsideGeometry?.clause.sql ?? '').toMatch(new RegExp(
        escapeRegExp(outsideAliases[1]) + "\\.reason\\s*=\\s*'b2b-smoke-window-outside'",
        'i',
      ));
      expect(outsideGeometry?.clause.sql ?? '').toMatch(new RegExp(
        escapeRegExp(outsideAliases[2]) + '\\.posting_engine_version\\s+is\\s+not\\s+distinct\\s+from\\s*'
        + escapeRegExp(outsideAliases[1]) + '\\.posting_engine_version',
        'i',
      ));
    }

    const overlapGeometry = smokeIfBlocks.flatMap(block => (
      /^\s*raise\s+exception\b/i.test(block.body)
        ? existsClauses(block.condition).filter(clause => clause.negated).map(clause => ({ block, clause }))
        : []
    )).find(({ clause }) => (
      (clause.sql.match(/app_private\.wms_reconciliation_wf001_exposure_windows/gi)?.length ?? 0) >= 2
      && (clause.sql.match(/b2b-smoke-window-overlap/gi)?.length ?? 0) >= 2
    ));
    expect(overlapGeometry, 'overlap fixture must prove two real window rows intersect').toBeDefined();
    const overlapAliases = overlapGeometry?.clause.sql.match(
      /from\s+app_private\.wms_reconciliation_wf001_exposure_windows\s+(?:as\s+)?([a-z_][a-z0-9_]*)[\s\S]{0,500}join\s+app_private\.wms_reconciliation_wf001_exposure_windows\s+(?:as\s+)?([a-z_][a-z0-9_]*)/i,
    );
    expect(overlapAliases).not.toBeNull();
    if (overlapAliases) {
      expect(overlapAliases[1]).not.toBe(overlapAliases[2]);
      expect(overlapGeometry?.clause.sql ?? '').toMatch(new RegExp(
        escapeRegExp(overlapAliases[1]) + '\\.id\\s*<>\\s*' + escapeRegExp(overlapAliases[2]) + '\\.id',
        'i',
      ));
      for (const alias of [overlapAliases[1], overlapAliases[2]]) {
        expect(overlapGeometry?.clause.sql ?? '').toMatch(new RegExp(
          escapeRegExp(alias) + "\\.reason\\s*=\\s*'b2b-smoke-window-overlap'",
          'i',
        ));
        expect(overlapGeometry?.clause.sql ?? '').toMatch(new RegExp(
          escapeRegExp(alias) + "\\.status\\s*=\\s*'active'",
          'i',
        ));
      }
      expect(overlapGeometry?.clause.sql ?? '').toMatch(new RegExp(
        escapeRegExp(overlapAliases[1]) + '\\.effective_from\\s*<\\s*'
        + escapeRegExp(overlapAliases[2]) + '\\.effective_to',
        'i',
      ));
      expect(overlapGeometry?.clause.sql ?? '').toMatch(new RegExp(
        escapeRegExp(overlapAliases[2]) + '\\.effective_from\\s*<\\s*'
        + escapeRegExp(overlapAliases[1]) + '\\.effective_to',
        'i',
      ));
    }

    const expectedFinding = (
      id: string,
      findingType: string,
      confidence: 'high' | 'low',
      status: 'open' | 'quarantined',
    ): { polarity: 'not exists'; predicates: RegExp[] } => ({
      polarity: 'not exists',
      predicates: [
        /\bfrom\s+public\.wms_reconciliation_findings\b/i,
        new RegExp(
          "(?:[a-z_][a-z0-9_]*\\.)?evidence\\s*#>>\\s*'\\{source,id\\}'\\s*=\\s*'" + escapeRegExp(id) + "'",
          'i',
        ),
        new RegExp("(?:[a-z_][a-z0-9_]*\\.)?finding_type\\s*=\\s*'" + findingType + "'", 'i'),
        new RegExp("(?:[a-z_][a-z0-9_]*\\.)?confidence\\s*=\\s*'" + confidence + "'", 'i'),
        new RegExp("(?:[a-z_][a-z0-9_]*\\.)?status\\s*=\\s*'" + status + "'", 'i'),
      ],
    });
    const noFinding = (id: string): { polarity: 'exists'; predicates: RegExp[] } => ({
      polarity: 'exists',
      predicates: [
        /\bfrom\s+public\.wms_reconciliation_findings\b/i,
        new RegExp(
          "(?:[a-z_][a-z0-9_]*\\.)?evidence\\s*#>>\\s*'\\{source,id\\}'\\s*=\\s*'" + escapeRegExp(id) + "'",
          'i',
        ),
      ],
    });

    const findingFlows: Array<{
      description: string;
      id: string;
      setup: RegExp[];
      phase: string;
      outcome: { polarity: 'exists' | 'not exists'; predicates: RegExp[] };
    }> = [
      {
        description: 'canonical fingerprint high-confidence path',
        id: 'b2b-smoke-fingerprint-canonical',
        setup: [/insert\s+into\s+public\.transactions/i, /b2b-smoke-fingerprint-canonical/i],
        phase: 'transaction_ledger',
        outcome: expectedFinding('b2b-smoke-fingerprint-canonical', 'DECIMAL_APPLY', 'high', 'open'),
      },
      {
        description: 'fake canonical fingerprint quarantine',
        id: 'b2b-smoke-fingerprint-fake',
        setup: [/insert\s+into\s+public\.transactions/i, /b2b-smoke-fingerprint-fake/i],
        phase: 'transaction_ledger',
        outcome: expectedFinding('b2b-smoke-fingerprint-fake', 'DECIMAL_APPLY', 'low', 'quarantined'),
      },
      {
        description: 'outside-window quarantine',
        id: 'b2b-smoke-window-outside',
        setup: [/insert\s+into\s+public\.transactions/i, /b2b-smoke-window-outside/i],
        phase: 'transaction_ledger',
        outcome: expectedFinding('b2b-smoke-window-outside', 'DECIMAL_APPLY', 'low', 'quarantined'),
      },
      {
        description: 'overlapping-window quarantine',
        id: 'b2b-smoke-window-overlap',
        setup: [/insert\s+into\s+public\.transactions/i, /b2b-smoke-window-overlap/i],
        phase: 'transaction_ledger',
        outcome: expectedFinding('b2b-smoke-window-overlap', 'DECIMAL_APPLY', 'low', 'quarantined'),
      },
      {
        description: 'aggregate-equal entry identity corruption',
        id: 'b2b-smoke-aggregate-equal-identity',
        setup: [
          /insert\s+into\s+public\.inventory_ledger_entries/i,
          /b2b-smoke-aggregate-equal-identity/i,
          /\bentry_no\b/i,
          /\bsource_line_id\b/i,
          /\bsource_code\b/i,
          /\bmetadata\b/i,
        ],
        phase: 'transaction_ledger',
        outcome: expectedFinding('b2b-smoke-aggregate-equal-identity', 'LINEAGE_GAP', 'low', 'quarantined'),
      },
      {
        description: 'negative signed adjustment',
        id: 'b2b-smoke-negative-adjustment',
        setup: [
          /insert\s+into\s+public\.transactions/i,
          /b2b-smoke-negative-adjustment/i,
          /ADJUSTMENT/i,
          /'quantity'\s*,\s*(?:to_jsonb\s*\()?\s*-\d|'"quantity"\s*:\s*-\d/i,
        ],
        phase: 'transaction_ledger',
        outcome: noFinding('b2b-smoke-negative-adjustment'),
      },
      {
        description: 'tampered command snapshot',
        id: 'b2b-smoke-tampered-command',
        setup: [/insert\s+into\s+app_private\.inventory_audit_command_results/i, /b2b-smoke-tampered-command/i, /audit_session/i],
        phase: 'physical_anchor',
        outcome: expectedFinding('b2b-smoke-tampered-command', 'LINEAGE_GAP', 'low', 'quarantined'),
      },
      {
        description: 'tampered ledger header identity',
        id: 'b2b-smoke-tampered-header',
        setup: [/insert\s+into\s+public\.inventory_transactions/i, /b2b-smoke-tampered-header/i, /\bsource_code\b/i, /\bmetadata\b/i],
        phase: 'transaction_ledger',
        outcome: expectedFinding('b2b-smoke-tampered-header', 'LINEAGE_GAP', 'low', 'quarantined'),
      },
      {
        description: 'tampered source items',
        id: 'b2b-smoke-tampered-items',
        setup: [/insert\s+into\s+public\.transactions/i, /b2b-smoke-tampered-items/i, /items/i],
        phase: 'transaction_ledger',
        outcome: expectedFinding('b2b-smoke-tampered-items', 'LINEAGE_GAP', 'low', 'quarantined'),
      },
      {
        description: 'tampered posting request hash',
        id: 'b2b-smoke-tampered-posting-hash',
        setup: [/insert\s+into\s+public\.transactions/i, /b2b-smoke-tampered-posting-hash/i, /posting_request_hash/i],
        phase: 'opening_balance',
        outcome: expectedFinding('b2b-smoke-tampered-posting-hash', 'LINEAGE_GAP', 'low', 'quarantined'),
      },
      {
        description: 'huge exponent rejection',
        id: 'b2b-smoke-hostile-exponent',
        setup: [/insert\s+into\s+public\.transactions/i, /b2b-smoke-hostile-exponent/i, /1e[1-9][0-9]{5,}/i],
        phase: 'transaction_ledger',
        outcome: expectedFinding('b2b-smoke-hostile-exponent', 'LINEAGE_GAP', 'low', 'quarantined'),
      },
      {
        description: 'numeric overflow rejection',
        id: 'b2b-smoke-numeric-overflow',
        setup: [/insert\s+into\s+public\.transactions/i, /b2b-smoke-numeric-overflow/i, /[1-9][0-9]{20,}/i],
        phase: 'transaction_ledger',
        outcome: expectedFinding('b2b-smoke-numeric-overflow', 'LINEAGE_GAP', 'low', 'quarantined'),
      },
      {
        description: 'missing warehouse rejection',
        id: 'b2b-smoke-missing-warehouse',
        setup: [/insert\s+into\s+public\.transactions/i, /b2b-smoke-missing-warehouse/i, /warehouse/i],
        phase: 'transaction_ledger',
        outcome: expectedFinding('b2b-smoke-missing-warehouse', 'LINEAGE_GAP', 'low', 'quarantined'),
      },
      {
        description: 'missing UOM rejection',
        id: 'b2b-smoke-missing-uom',
        setup: [/insert\s+into\s+public\.transactions/i, /b2b-smoke-missing-uom/i, /items/i],
        phase: 'transaction_ledger',
        outcome: expectedFinding('b2b-smoke-missing-uom', 'UOM_PRECISION', 'low', 'quarantined'),
      },
      {
        description: 'missing catalog rejection',
        id: 'b2b-smoke-missing-catalog',
        setup: [/insert\s+into\s+public\.transactions/i, /b2b-smoke-missing-catalog/i, /items/i],
        phase: 'transaction_ledger',
        outcome: expectedFinding('b2b-smoke-missing-catalog', 'UOM_PRECISION', 'low', 'quarantined'),
      },
      {
        description: 'mixed-unit ledger-only quarantine',
        id: 'b2b-smoke-mixed-unit-ledger-only',
        setup: [/insert\s+into\s+public\.inventory_ledger_entries/i, /b2b-smoke-mixed-unit-ledger-only/i, /\bunit\b/i],
        phase: 'transaction_ledger',
        outcome: expectedFinding('b2b-smoke-mixed-unit-ledger-only', 'UOM_PRECISION', 'low', 'quarantined'),
      },
    ];
    for (const flow of findingFlows) {
      expectExecutableSmokeFlow(
        smoke,
        flow.description,
        flow.setup,
        new RegExp('scan_wms_reconciliation_phase_' + flow.phase + '\\s*\\(', 'i'),
        flow.outcome,
      );
    }

    const negativeValidatorProbe = statements.find(statement => (
      /select[\s\S]*app_private\.validate_wms_reconciliation_frozen_transaction\s*\(/i.test(statement.text)
      && /\bfrom\s+public\.transactions\b/i.test(statement.text)
      && /public\.inventory_transactions/i.test(statement.text)
      && /public\.inventory_ledger_entries/i.test(statement.text)
      && /b2b-smoke-negative-adjustment/i.test(statement.text)
    ));
    expect(
      negativeValidatorProbe,
      'negative ADJUSTMENT fixture must be passed through the real frozen validator dataflow',
    ).toBeDefined();
    const negativeValidationVariable = negativeValidatorProbe?.text.match(
      /\binto\s+([a-z_][a-z0-9_]*negative[a-z0-9_]*validation[a-z0-9_]*)\b/i,
    )?.[1] ?? 'missing_negative_validation';
    const negativeValidationGuard = smokeIfBlocks.find(block => {
      const condition = block.condition;
      return (block as { condition: string; body: string }).body.match(/^\s*raise\s+exception\b/i)
        && new RegExp(
          escapeRegExp(negativeValidationVariable) + "\\s*->>\\s*'sourceValid'[\\s\\S]{0,80}is\\s+not\\s+true",
          'i',
        ).test(condition)
        && new RegExp(
          escapeRegExp(negativeValidationVariable) + "\\s*->>\\s*'entryIdentityValid'[\\s\\S]{0,80}is\\s+not\\s+true",
          'i',
        ).test(condition)
        && new RegExp(
          escapeRegExp(negativeValidationVariable) + "\\s*->>\\s*'quantityExact'[\\s\\S]{0,80}is\\s+not\\s+true",
          'i',
        ).test(condition)
        && new RegExp(
          "jsonb_path_exists\\s*\\(\\s*" + escapeRegExp(negativeValidationVariable)
          + "\\s*->\\s*'expectedEntries'[\\s\\S]{0,500}adjustment_out[\\s\\S]{0,200}out[\\s\\S]{0,200}\\)"
          + "\\s+is\\s+not\\s+true",
          'i',
        ).test(condition)
        && !/\b(?:and\s+false|false\s+and|or\s+true|true\s+or)\b/i.test(condition);
    });
    expect(
      negativeValidationGuard,
      'negative validator probe must fail unless signed source, out identity, and exact quantity are all accepted',
    ).toBeDefined();

    expectExecutableSmokeFlow(
      smoke,
      'negative physical audit with signed ledger',
      [
        /insert\s+into\s+public\.audit_sessions/i,
        /b2b-smoke-audit-negative/i,
        /'delta'\s*,\s*'-[0-9]/i,
      ],
      /scan_wms_reconciliation_phase_physical_anchor\s*\(/i,
      {
        polarity: 'not exists',
        predicates: [
          /\bfrom\s+app_private\.wms_reconciliation_run_work\b/i,
          /b2b-smoke-audit-negative/i,
          /payload\s*->>\s*'validAnchor'\s*=\s*'true'/i,
          /payload\s*->\s*'excludedTransactionIds'\s*\?\s*'b2b-smoke-audit-negative'/i,
        ],
      },
    );
    expect(hasStatement([
      /insert\s+into\s+public\.inventory_ledger_entries/i,
      /b2b-smoke-negative-adjustment/i,
      /\bout\b/i,
      /quantity_out/i,
      /quantity_delta/i,
      /-\d/i,
    ]), 'negative adjustment needs positive quantity_out and negative quantity_delta evidence').toBe(true);
    expectExecutableSmokeFlow(
      smoke,
      'valid void opening reversal',
      [
        /insert\s+into\s+public\.project_opening_balances/i,
        /b2b-smoke-valid-void-reversal/i,
        /'void'|\bvoid\b/i,
        /reversal_stock_transaction_ids/i,
      ],
      /scan_wms_reconciliation_phase_opening_balance\s*\(/i,
      {
        polarity: 'not exists',
        predicates: [
          /\bfrom\s+app_private\.wms_reconciliation_run_work\b/i,
          /b2b-smoke-valid-void-reversal/i,
          /payload\s*->>\s*'validAnchor'\s*=\s*'true'/i,
          /payload\s*->\s*'excludedTransactionIds'[\s\S]{0,240}\?\s*'opening-balance:/i,
          /payload\s*->\s*'excludedTransactionIds'[\s\S]{0,240}\?\s*'opening-reversal:/i,
        ],
      },
    );

    const lateInsert = statements.find(statement => (
      /insert\s+into\s+public\.transactions/i.test(statement.text)
      && /b2b-smoke-late-backdated/i.test(statement.text)
    ));
    const runInsert = statements.find(statement => /insert\s+into\s+public\.wms_reconciliation_runs/i.test(statement.text));
    expect(lateInsert?.index ?? -1).toBeGreaterThan(runInsert?.index ?? Number.MAX_SAFE_INTEGER);
    expectIfCondition(smoke, 'late backdated source must be checked against the already-frozen set', [
      /wms_reconciliation_frozen_sources/i,
      /b2b-smoke-late-backdated/i,
      /\bexists\b/i,
    ]);

    const cursorResume = smoke.match(
      /([a-z_][a-z0-9_]*)\s*:=\s*app_private\.scan_wms_reconciliation_phase_([a-z_]+)\s*\(\s*([a-z_][a-z0-9_]*)\s*,\s*1\s*,\s*([^,]+)\s*,\s*([a-z_][a-z0-9_]*)\s*\)\s*;[\s\S]{0,900}([a-z_][a-z0-9_]*)\s*:=\s*app_private\.scan_wms_reconciliation_phase_\2\s*\(\s*\3\s*,\s*1\s*,\s*\1\s*(?:->|#>)\s*'\{?cursor\}?'\s*,\s*\5\s*\)/i,
    );
    expect(cursorResume, 'batch-size-1 must pass the first real returned cursor into the second call').not.toBeNull();
    expectIfCondition(smoke, 'batch-size-1 resume must assert progress/completion', [
      new RegExp(cursorResume?.[1] ?? 'missing_first_page', 'i'),
      new RegExp(cursorResume?.[6] ?? 'missing_second_page', 'i'),
      /processed|complete|lastKey/i,
    ]);

    expect(smoke).toMatch(
      /select\s+pg_catalog\.count\(\*\)\s+into\s+([a-z_][a-z0-9_]*retry[a-z0-9_]*before[a-z0-9_]*)[\s\S]{0,1200}([a-z_][a-z0-9_]*retry[a-z0-9_]*first[a-z0-9_]*)\s*:=\s*app_private\.scan_wms_reconciliation_phase_([a-z_]+)\s*\(([^;]+)\)\s*;[\s\S]{0,900}([a-z_][a-z0-9_]*retry[a-z0-9_]*(?:second|again)[a-z0-9_]*)\s*:=\s*app_private\.scan_wms_reconciliation_phase_\3\s*\(\4\)\s*;[\s\S]{0,900}select\s+pg_catalog\.count\(\*\)\s+into\s+([a-z_][a-z0-9_]*retry[a-z0-9_]*after[a-z0-9_]*)/i,
    );
    expectIfCondition(smoke, 'retry must compare result equality and finding-count stability', [
      /retry[a-z0-9_]*first[\s\S]{0,120}is\s+distinct\s+from[\s\S]{0,120}retry[a-z0-9_]*(?:second|again)/i,
      /retry[a-z0-9_]*before[\s\S]{0,120}is\s+distinct\s+from[\s\S]{0,120}retry[a-z0-9_]*after/i,
    ]);

    expect(smoke).toMatch(new RegExp(
      "([a-z_][a-z0-9_]*stale[a-z0-9_]*snapshot[a-z0-9_]*)\\s*:=\\s*"
      + "pg_catalog\\.jsonb_set\\s*\\([^;]{0,700}" + fakeWf001LegacyFunctionHash
      + "[^;]{0,300}\\)\\s*;[\\s\\S]{0,700}begin[\\s\\S]{0,500}"
      + "scan_wms_reconciliation_phase_[a-z_]+\\s*\\([^;]{0,500}\\1[^;]{0,500}\\)\\s*;"
      + "[\\s\\S]{0,300}raise\\s+exception[^;]*(?:accepted|did not fail)[^;]*;"
      + "[\\s\\S]{0,240}exception\\s+when\\s+sqlstate\\s+'40001'",
      'i',
    ));
    expect(smoke).toMatch(
      /select\s+pg_catalog\.jsonb_object_agg\s*\(\s*(?:frozen\.)?source_key\s*,\s*(?:frozen\.)?source_hash[\s\S]{0,500}into\s+([a-z_][a-z0-9_]*source[a-z0-9_]*hash[a-z0-9_]*before[a-z0-9_]*)[\s\S]{0,1600}select\s+pg_catalog\.jsonb_object_agg\s*\(\s*(?:frozen\.)?source_key\s*,\s*(?:frozen\.)?source_hash[\s\S]{0,500}into\s+([a-z_][a-z0-9_]*source[a-z0-9_]*hash[a-z0-9_]*after[a-z0-9_]*)/i,
    );
    expectIfCondition(smoke, 'deterministic frozen source-content hashes must remain identical', [
      /source[a-z0-9_]*hash[a-z0-9_]*before[\s\S]{0,120}is\s+distinct\s+from[\s\S]{0,120}source[a-z0-9_]*hash[a-z0-9_]*after/i,
    ]);

    for (const phase of phases) {
      expect(smoke).toMatch(new RegExp(`scan_wms_reconciliation_phase_${phase}`, 'i'));
    }
    for (const pathName of ['PHYSICAL_ANCHOR', 'TX_LEDGER_MISSING', 'TX_LEDGER_MISMATCH', 'LINEAGE_GAP']) {
      expect(smoke).toContain(pathName);
    }
  });
});
