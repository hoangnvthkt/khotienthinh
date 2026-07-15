import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface MigrationSource {
  file: string;
  sql: string;
}

const readMigrations = (): MigrationSource[] => {
  const migrationsDir = join(process.cwd(), 'supabase', 'migrations');

  return readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort()
    .map(file => ({
      file,
      sql: readFileSync(join(migrationsDir, file), 'utf8'),
    }));
};

const readLatestMigrationMatching = (
  pattern: RegExp,
  description: string,
): MigrationSource => {
  let latest: MigrationSource | undefined;

  for (const migration of readMigrations()) {
    pattern.lastIndex = 0;
    if (pattern.test(migration.sql)) latest = migration;
  }

  if (!latest) throw new Error(`No migration found for ${description}`);
  return latest;
};

const readLatestFunctionDefinition = (
  qualifiedNamePattern: RegExp,
  description: string,
): { definition: string; migration: MigrationSource } => {
  let latest:
    | { definition: string; migration: MigrationSource }
    | undefined;

  for (const migration of readMigrations()) {
    qualifiedNamePattern.lastIndex = 0;

    for (const match of migration.sql.matchAll(qualifiedNamePattern)) {
      const start = match.index;
      const remainingSql = migration.sql.slice(start);
      const bodyTagMatch = /\bas\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/i.exec(
        remainingSql,
      );

      if (!bodyTagMatch || bodyTagMatch.index === undefined) {
        throw new Error(`Missing function body tag for ${description} in ${migration.file}`);
      }

      const bodyTag = bodyTagMatch[1];
      const bodyStart = bodyTagMatch.index + bodyTagMatch[0].length;
      const bodyEnd = remainingSql.indexOf(`${bodyTag};`, bodyStart);

      if (bodyEnd === -1) {
        throw new Error(`Unterminated ${description} definition in ${migration.file}`);
      }

      const candidate = remainingSql.slice(0, bodyEnd + bodyTag.length + 1);
      if (/process_transaction_status/i.test(description)
          && !candidate.includes('app_private.assert_quantity_precision')) continue;
      latest = {
        definition: candidate,
        migration,
      };
    }
  }

  if (!latest) throw new Error(`No migration definition found for ${description}`);
  return latest;
};

const readSqlArtifact = (relativePath: string): string =>
  readFileSync(join(process.cwd(), ...relativePath.split('/')), 'utf8');

describe('WMS quantity precision policy migration contract', () => {
  it('creates a versioned, normalized, read-only policy catalog', () => {
    const { sql } = readLatestMigrationMatching(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.quantity_precision_policies\b/i,
      'quantity precision policy catalog',
    );

    expect(sql).toMatch(/id\s+uuid\s+primary\s+key\s+default\s+gen_random_uuid\s*\(\s*\)/i);
    expect(sql).toMatch(/unit_key\s+text\s+not\s+null/i);
    expect(sql).toMatch(/display_name\s+text\s+not\s+null/i);
    expect(sql).toMatch(/aliases\s+text\[\]\s+not\s+null\s+default\s+'\{\}'::text\[\]/i);
    expect(sql).toMatch(/max_fraction_digits\s+smallint\s+not\s+null/i);
    expect(sql).toMatch(/max_fraction_digits\s+between\s+0\s+and\s+6/i);
    expect(sql).toMatch(/conversion_rounding_mode\s+text\s+not\s+null\s+default\s+'half_away_from_zero'/i);
    expect(sql).toMatch(/conversion_rounding_mode\s*=\s*'half_away_from_zero'/i);
    expect(sql).toMatch(/comparison_tolerance\s+numeric\s*\(\s*8\s*,\s*7\s*\)\s+generated\s+always\s+as/i);
    expect(sql).toMatch(/version\s+integer\s+not\s+null/i);
    expect(sql).toMatch(/lifecycle_status\s+text\s+not\s+null/i);
    expect(sql).toMatch(/lifecycle_status\s+in\s*\(\s*'draft'\s*,\s*'active'\s*,\s*'retired'\s*\)/i);
    expect(sql).toMatch(/effective_from\s+timestamptz\s+not\s+null/i);
    expect(sql).toMatch(/effective_to\s+timestamptz/i);
    expect(sql).toMatch(/created_by\s+uuid/i);
    expect(sql).toMatch(/updated_by\s+uuid/i);
    expect(sql).toMatch(/created_at\s+timestamptz\s+not\s+null\s+default\s+(?:pg_catalog\.)?now\s*\(\s*\)/i);
    expect(sql).toMatch(/updated_at\s+timestamptz\s+not\s+null\s+default\s+(?:pg_catalog\.)?now\s*\(\s*\)/i);
    expect(sql).toMatch(/unit_key\s*=\s*app_private\.normalize_quantity_unit\s*\(\s*unit_key\s*\)/i);
    expect(sql).toMatch(/app_private\.quantity_policy_aliases_are_normalized\s*\(\s*unit_key\s*,\s*aliases\s*\)/i);
    expect(sql).toMatch(/create\s+unique\s+index[^;]+on\s+public\.quantity_precision_policies\s*\(\s*unit_key\s*\)[^;]+where\s+lifecycle_status\s*=\s*'active'/is);
    expect(sql).toMatch(/alter\s+table\s+public\.quantity_precision_policies\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+public\.quantity_precision_policies\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  });

  it('resolves only normalized canonical keys or declared aliases with a six-decimal default', () => {
    const { definition: normalizeDefinition } = readLatestFunctionDefinition(
      /create\s+or\s+replace\s+function\s+app_private\.normalize_quantity_unit\s*\(/gi,
      'normalize_quantity_unit',
    );
    const { definition: resolverDefinition, migration } = readLatestFunctionDefinition(
      /create\s+or\s+replace\s+function\s+app_private\.resolve_quantity_precision_policy\s*\(/gi,
      'resolve_quantity_precision_policy',
    );
    const { definition: publicWrapperDefinition } = readLatestFunctionDefinition(
      /create\s+or\s+replace\s+function\s+public\.resolve_quantity_precision_policy\s*\(/gi,
      'public resolve_quantity_precision_policy wrapper',
    );

    expect(normalizeDefinition).toMatch(/lower\s*\(/i);
    expect(normalizeDefinition).toMatch(/btrim\s*\(/i);
    expect(normalizeDefinition).toMatch(/regexp_replace\s*\([^;]+\[\[:space:\]\]\+/is);
    expect(normalizeDefinition).toMatch(/immutable/i);

    expect(resolverDefinition).toMatch(/security\s+definer/i);
    expect(resolverDefinition).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(resolverDefinition).toMatch(/p\.unit_key\s*=\s*v_normalized_unit/i);
    expect(resolverDefinition).toMatch(/v_normalized_unit\s*=\s*any\s*\(\s*p\.aliases\s*\)/i);
    expect(resolverDefinition).toMatch(/p\.lifecycle_status\s*=\s*'active'/i);
    expect(resolverDefinition).toMatch(/p\.effective_from\s*<=\s*(?:pg_catalog\.)?now\s*\(\s*\)/i);
    expect(resolverDefinition).toMatch(/p\.effective_to\s+is\s+null/i);
    expect(resolverDefinition).toMatch(/6::smallint/i);
    expect(resolverDefinition).toMatch(/0::integer/i);
    expect(resolverDefinition).toMatch(/'half_away_from_zero'/i);
    expect(resolverDefinition).not.toMatch(/similarity\s*\(|word_similarity\s*\(|levenshtein\s*\(/i);

    expect(publicWrapperDefinition).toMatch(/security\s+invoker/i);
    expect(publicWrapperDefinition).not.toMatch(/security\s+definer/i);
    expect(publicWrapperDefinition).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(publicWrapperDefinition).toContain('app_private.resolve_quantity_precision_policy');
    expect(migration.sql).toMatch(/revoke\s+all\s+on\s+function\s+app_private\.resolve_quantity_precision_policy\s*\(\s*text\s*\)\s+from\s+public\s*,\s*anon/i);
    expect(migration.sql).toMatch(/grant\s+execute\s+on\s+function\s+app_private\.resolve_quantity_precision_policy\s*\(\s*text\s*\)\s+to\s+authenticated/i);
    expect(migration.sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.resolve_quantity_precision_policy\s*\(\s*text\s*\)\s+to\s+authenticated/i);
  });

  it('rejects non-finite or over-scale quantities without rounding them', () => {
    const { definition, migration } = readLatestFunctionDefinition(
      /create\s+or\s+replace\s+function\s+app_private\.assert_quantity_precision\s*\(/gi,
      'assert_quantity_precision',
    );

    expect(definition).toMatch(/security\s+definer/i);
    expect(definition).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(definition).toMatch(/p_quantity_text::numeric/i);
    expect(definition).toMatch(/'nan'\s*,\s*'infinity'\s*,\s*'-infinity'/i);
    expect(definition).toMatch(/abs\s*\(\s*v_quantity\s*\)\s*>=\s*100000000000000::numeric/i);
    expect(definition).toMatch(/numeric\s*\(\s*20\s*,\s*6\s*\)\s+range/i);
    expect(definition).toMatch(/errcode\s*=\s*'22003'/i);
    expect(definition).toMatch(/v_quantity\s*<>\s*(?:pg_catalog\.)?round\s*\(\s*v_quantity\s*,\s*v_policy\.max_fraction_digits\s*\)/i);
    expect(definition).toMatch(/raise\s+exception\s+'[^']*at most % fractional digits[^']*'/i);
    expect(definition).not.toMatch(/v_quantity\s*:=\s*round\s*\(/i);
    expect(migration.sql).toMatch(/revoke\s+all\s+on\s+function\s+app_private\.assert_quantity_precision\s*\(\s*text\s*,\s*text\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  });

  it('uses the catalog or pending-item stock unit and rejects spoofed line units', () => {
    const { definition: equivalenceDefinition, migration } = readLatestFunctionDefinition(
      /create\s+or\s+replace\s+function\s+app_private\.quantity_units_are_equivalent\s*\(/gi,
      'quantity_units_are_equivalent',
    );
    const { definition } = readLatestFunctionDefinition(
      /create\s+or\s+replace\s+function\s+(?:public\.process_transaction_status|app_private\.process_transaction_status_a3_core)\s*\(/gi,
      'process_transaction_status',
    );

    const assertionIndex = definition.indexOf('app_private.assert_quantity_precision');
    const aggregationIndex = definition.indexOf('for v_check in');
    const catalogUnitIndex = definition.indexOf('i.unit');
    const catalogSourceIndex = definition.indexOf('from public.items i', catalogUnitIndex);
    const pendingUnitIndex = definition.indexOf("pending.value->>'unit'", catalogSourceIndex);
    const lineUnitIndex = definition.indexOf("v_line->>'unit'", pendingUnitIndex);
    const camelSnapshotIndex = definition.indexOf("v_line->>'unitSnapshot'", lineUnitIndex);
    const snakeSnapshotIndex = definition.indexOf("v_line->>'unit_snapshot'", camelSnapshotIndex);

    expect(equivalenceDefinition).toMatch(/security\s+definer/i);
    expect(equivalenceDefinition).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(equivalenceDefinition).toContain('app_private.resolve_quantity_precision_policy');
    expect(equivalenceDefinition).toMatch(/authoritative_policy\.policy_id\s*=\s*candidate_policy\.policy_id/i);
    expect(equivalenceDefinition).not.toMatch(/similarity\s*\(|word_similarity\s*\(|levenshtein\s*\(/i);
    expect(migration.sql).toMatch(/revoke\s+all\s+on\s+function\s+app_private\.quantity_units_are_equivalent\s*\(\s*text\s*,\s*text\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);

    expect(catalogUnitIndex).toBeGreaterThan(-1);
    expect(catalogSourceIndex).toBeGreaterThan(catalogUnitIndex);
    expect(pendingUnitIndex).toBeGreaterThan(catalogSourceIndex);
    expect(lineUnitIndex).toBeGreaterThan(pendingUnitIndex);
    expect(definition).toMatch(
      /select\s+coalesce\s*\(\s*nullif\s*\(\s*app_private\.normalize_quantity_unit\s*\(\s*pending\.value->>'unit'\s*\)\s*,\s*''\s*\)\s*,\s*app_private\.normalize_quantity_unit\s*\(\s*'Cái'\s*\)\s*\)/i,
    );
    expect(assertionIndex).toBeGreaterThan(-1);
    expect(aggregationIndex).toBeGreaterThan(assertionIndex);
    expect(camelSnapshotIndex).toBeGreaterThan(lineUnitIndex);
    expect(snakeSnapshotIndex).toBeGreaterThan(camelSnapshotIndex);
    expect(assertionIndex).toBeGreaterThan(snakeSnapshotIndex);
    expect(definition).toContain('app_private.quantity_units_are_equivalent');
    expect(definition).toMatch(/raise\s+exception\s+'[^']*unit snapshot[^']*authoritative stock unit[^']*'/i);
    expect(definition).toMatch(/jsonb_array_elements\s*\(\s*coalesce\s*\(\s*v_tx\.pending_items/i);
    expect(definition).not.toMatch(/round\s*\(\s*v_qty\s*,\s*4\s*\)/i);
    expect(definition).not.toMatch(/\bv_qty\s+integer\s*;/i);
    expect(definition).not.toMatch(/\b(?:v_qty|v_check\.qty)[^;]*::integer/i);
  });

  it('guards and widens only quantity columns while restoring generated expressions', () => {
    const { sql } = readLatestMigrationMatching(
      /alter\s+table\s+public\.inventory_ledger_entries[\s\S]+numeric\s*\(\s*20\s*,\s*6\s*\)/i,
      'six-decimal inventory ledger widening',
    );

    expect(sql).toMatch(/set\s+(?:local\s+)?lock_timeout\s*=\s*'[^']+'/i);
    expect(sql).toMatch(/set\s+(?:local\s+)?statement_timeout\s*=\s*'[^']+'/i);
    expect(sql).toMatch(/reltuples/i);
    expect(sql).toMatch(/count\s*\(\s*\*\s*\)[\s\S]+inventory_ledger_entries/i);
    expect(sql).toMatch(/count\s*\(\s*\*\s*\)[\s\S]+inventory_balances/i);
    expect(sql).toContain('1000000');
    expect(sql).toMatch(/expand[\s/-]*backfill[\s/-]*swap/i);
    expect(sql).toMatch(/lock\s+table\s+public\.inventory_ledger_entries\s*,\s*public\.inventory_balances\s+in\s+access\s+exclusive\s+mode/i);
    expect(sql).toMatch(/set\s+statement_timeout\s*=\s*'5s'\s*;[\s\S]+alter\s+table\s+public\.inventory_ledger_entries/i);
    expect(sql).toMatch(/alter\s+column\s+amount\s+set\s+expression[\s\S]+set\s+statement_timeout\s*=\s*'60s'/i);

    expect(sql).toMatch(/alter\s+column\s+quantity_delta\s+set\s+expression\s+as\s*\(\s*0::numeric\s*\)/i);
    expect(sql).toMatch(/alter\s+column\s+amount\s+set\s+expression\s+as\s*\(\s*0::numeric\s*\)/i);
    expect(sql).not.toMatch(/alter\s+column\s+(?:quantity_delta|amount)\s+drop\s+expression/i);
    for (const column of ['quantity_in', 'quantity_out', 'quantity_delta', 'balance_after_qty']) {
      expect(sql).toMatch(
        new RegExp(`alter\\s+column\\s+${column}\\s+type\\s+numeric\\s*\\(\\s*20\\s*,\\s*6\\s*\\)`, 'i'),
      );
    }
    expect(sql).toMatch(/alter\s+table\s+public\.inventory_balances[\s\S]+alter\s+column\s+on_hand_qty\s+type\s+numeric\s*\(\s*20\s*,\s*6\s*\)/i);
    expect(sql).toMatch(/alter\s+column\s+quantity_delta\s+set\s+expression\s+as\s*\(\s*quantity_in\s*-\s*quantity_out\s*\)/i);
    expect(sql).toMatch(/alter\s+column\s+amount\s+set\s+expression\s+as\s*\(\s*\(\s*quantity_in\s*-\s*quantity_out\s*\)\s*\*\s*unit_price\s*\)/i);
    expect(sql).not.toMatch(/alter\s+column\s+(?:unit_price|amount|balance_after_value|total_value|average_unit_cost)\s+type/i);
  });

  it('ships transactional SQL smoke coverage and a read-only production preflight', () => {
    const smoke = readSqlArtifact('supabase/tests/wms_quantity_precision_policy_smoke.sql');
    const preflight = readSqlArtifact('supabase/perf/wms_quantity_precision_preflight.sql');
    const postflight = readSqlArtifact('supabase/perf/wms_quantity_precision_postflight.sql');
    const rehearsal = readSqlArtifact('supabase/perf/wms_quantity_precision_rehearsal.sql');
    const analyze = readSqlArtifact('supabase/perf/wms_quantity_precision_analyze.sql');

    expect(smoke).toMatch(/^begin\s*;/im);
    expect(smoke).toMatch(/rollback\s*;\s*$/i);
    expect(smoke).toMatch(/max_fraction_digits[\s\S]+0[\s\S]+3/i);
    expect(smoke).toMatch(/aliases/i);
    expect(smoke).toMatch(/0\.123456/i);
    expect(smoke).toMatch(/malformed/i);
    expect(smoke).toMatch(/over[-_ ]scale/i);
    expect(smoke).toMatch(/spoofed unit/i);
    expect(smoke).toMatch(/blank pending unit/i);
    expect(smoke).toContain('99999999999999.999999');
    expect(smoke).toContain('100000000000000');
    expect(smoke).toMatch(/numeric\s*\(\s*20\s*,\s*6\s*\)/i);
    expect(smoke).toMatch(/quantity_delta/i);
    expect(smoke).toMatch(/attgenerated\s*=\s*'s'/i);
    expect(smoke).toMatch(/unchanged stock/i);
    expect(smoke).toMatch(/unchanged ledger/i);

    expect(preflight).toMatch(/^begin\s*;/im);
    expect(preflight).toMatch(/set\s+transaction\s+read\s+only/i);
    expect(preflight).toMatch(/rollback\s*;\s*$/i);
    expect(preflight).toMatch(/reltuples/i);
    expect(preflight).toMatch(/numeric_precision/i);
    expect(preflight).toMatch(/numeric_scale/i);
    expect(preflight).toMatch(/max\s*\(\s*abs\s*\(/i);
    expect(preflight).toMatch(/observed_fractional_scale/i);
    expect(preflight).toMatch(/pg_depend/i);
    expect(preflight).toMatch(/normalized inventory units/i);
    expect(preflight).not.toMatch(/from\s+public\.quantity_precision_policies/i);
    expect(preflight).toMatch(
      /coalesce\s*\(\s*nullif\s*\(\s*(?:pg_catalog\.)?btrim\s*\(\s*i\.unit\s*\)[\s\S]+pending\.value->>'unit'[\s\S]+line\.value->>'unit'/i,
    );
    expect(preflight).toMatch(
      /lower\s*\(\s*(?:pg_catalog\.)?btrim\s*\(\s*quantity_value::text\s*\)\s*\)\s+in\s*\(\s*'nan'\s*,\s*'infinity'\s*,\s*'-infinity'\s*\)/i,
    );

    expect(postflight).toMatch(/^begin\s*;/im);
    expect(postflight).toMatch(/set\s+transaction\s+read\s+only/i);
    expect(postflight).toMatch(/rollback\s*;\s*$/i);
    expect(postflight).toMatch(/from\s+public\.quantity_precision_policies/i);
    expect(postflight).toContain('public.resolve_quantity_precision_policy');
    expect(postflight).toMatch(/numeric\s*\(\s*20\s*,\s*6\s*\)/i);

    expect(rehearsal).toMatch(/clone/i);
    expect(rehearsal).toMatch(/^begin\s*;/im);
    expect(rehearsal).toMatch(/rollback\s*;\s*$/i);
    expect(rehearsal).toMatch(/clock_timestamp\s*\(\s*\)/i);
    expect(rehearsal).toMatch(/interval\s+'5 seconds'/i);
    expect(rehearsal).toMatch(/expand[\s/-]*backfill(?:[\s/-]*validate)?[\s/-]*swap/i);
    expect(rehearsal).toMatch(/alter\s+column\s+quantity_delta\s+set\s+expression\s+as\s*\(\s*0::numeric\s*\)/i);
    expect(rehearsal).toMatch(/alter\s+column\s+amount\s+set\s+expression\s+as\s*\(\s*\(\s*quantity_in\s*-\s*quantity_out\s*\)\s*\*\s*unit_price\s*\)/i);

    expect(analyze).toMatch(/analyze\s+public\.inventory_ledger_entries\s*\(/i);
    expect(analyze).toMatch(/analyze\s+public\.inventory_balances\s*\(/i);
  });
});
