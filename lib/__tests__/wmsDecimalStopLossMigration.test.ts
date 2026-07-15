import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROCESS_TRANSACTION_STATUS_PATTERN =
  /create\s+or\s+replace\s+function\s+(?:public\.process_transaction_status|app_private\.process_transaction_status_a3_core)\s*\(/gi;

const readLatestProcessTransactionStatusDefinition = (): {
  definition: string;
  migrationSql: string;
} => {
  const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
  const migrationFiles = readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  let latest: { definition: string; migrationSql: string } | undefined;

  for (const file of migrationFiles) {
    const migrationSql = readFileSync(join(migrationsDir, file), 'utf8');
    PROCESS_TRANSACTION_STATUS_PATTERN.lastIndex = 0;

    for (const match of migrationSql.matchAll(PROCESS_TRANSACTION_STATUS_PATTERN)) {
      const start = match.index;
      const end = migrationSql.indexOf('\n$$;', start);
      if (end === -1) {
        throw new Error(`Unterminated process_transaction_status definition in ${file}`);
      }

      const candidate = migrationSql.slice(start, end + '\n$$;'.length);
      if (!candidate.includes('v_qty numeric') || !candidate.includes('app_private.wms_has_action')) continue;
      latest = {
        definition: candidate,
        migrationSql,
      };
    }
  }

  if (!latest) {
    throw new Error('No process_transaction_status migration definition found');
  }

  return latest;
};

describe('WMS decimal stop-loss migration contract', () => {
  it('keeps decimal quantities exact through availability checks and stock mutation', () => {
    const { definition } = readLatestProcessTransactionStatusDefinition();

    expect(definition).toMatch(/\bv_qty\s+numeric\s*;/i);
    expect(definition).not.toMatch(/\bv_qty\s+integer\s*;/i);
    expect(definition).not.toMatch(/\bv_qty\s*:=\s*[^;]*::integer\s*;/i);
    expect(definition).toContain('app_private.assert_quantity_precision');
    expect(definition).not.toMatch(
      /\bv_qty\s*<>\s*round\s*\(\s*v_qty\s*,\s*4\s*\)/i,
    );
    expect(definition).not.toMatch(/raise\s+exception\s+'[^']*4 fractional digits[^']*'/i);
  });

  it('keeps the Phase 4 PBAC, reservation, transition, and security contract', () => {
    const { definition } = readLatestProcessTransactionStatusDefinition();

    expect(definition).toMatch(
      /p_transaction_id\s+text,\s*p_status\s+public\.transaction_status,\s*p_approver_id\s+uuid/is,
    );
    expect(definition).toMatch(/returns\s+public\.transactions/i);
    expect(definition).toMatch(/security\s+definer/i);
    expect(definition).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(definition).toContain("app_private.wms_has_action(\n    'wms.transaction.approve'");
    expect(definition).toContain("app_private.wms_has_action(\n    'wms.transaction.complete'");
    expect(definition).toContain("using errcode = '42501'");
    expect(definition).toContain('if v_tx.status = p_status then');
    expect(definition).toContain("if v_tx.status = 'CANCELLED'::public.transaction_status then");
    expect(definition).toContain("if v_tx.status = 'COMPLETED'::public.transaction_status then");
    expect(definition).toContain('v_is_fulfillment_transfer');
    expect(definition).toContain('v_tx_reserved');
    expect(definition).toContain('v_request_reserved');
    expect(definition).toContain('v_available := greatest(0, v_on_hand - v_reserved);');
    expect(definition).toContain("jsonb_array_elements(coalesce(v_tx.pending_items, '[]'::jsonb))");
    expect(definition).toContain('p_approver_id is distinct from v_user.id');
    expect(definition).toContain('approver_id = v_user.id');
  });

  it('denies direct stock helper execution while retaining authenticated outer RPC access', () => {
    const { migrationSql } = readLatestProcessTransactionStatusDefinition();

    expect(migrationSql).toMatch(
      /revoke\s+(?:all|execute)\s+on\s+function\s+public\.apply_stock_change\s*\(\s*text\s*,\s*text\s*,\s*numeric\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated(?:\s*,\s*service_role)?\s*;/i,
    );
    expect(migrationSql).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.apply_stock_change\s*\(\s*text\s*,\s*text\s*,\s*numeric\s*\)/i,
    );
    expect(migrationSql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.process_transaction_status\s*\(\s*text\s*,\s*public\.transaction_status\s*,\s*uuid\s*\)\s+to\s+authenticated\s*;/i,
    );
  });
});
