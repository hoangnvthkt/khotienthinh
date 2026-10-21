import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// PostgREST tự chạy lại giao dịch khi gặp SQLSTATE 40001; xung đột phiên bản do ứng dụng
// raise thì không bao giờ hết nên request lặp vô hạn (sự cố 10–11/10/2026).
const fixMigration = '20261011230000_rpc_conflict_errcode_pt409.sql';
const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const raises40001 = /(errcode\s*=\s*|sqlstate\s+)'40001'/i;

const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

describe('RPC conflict errcode', () => {
  it('rewrites every app-raised 40001 to PT409', () => {
    const sql = readFileSync(join(migrationsDir, fixMigration), 'utf8');
    expect(sql).toContain("'PT409'");
    expect(sql).toContain("raise exception 'functions still raise SQLSTATE 40001 after PT409 rewrite'");
  });

  it('keeps later migrations from raising SQLSTATE 40001', () => {
    const offenders = readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql') && file > fixMigration)
      .filter(file => raises40001.test(stripComments(readFileSync(join(migrationsDir, file), 'utf8'))));
    expect(offenders, "Dùng errcode = 'PT409' cho xung đột phiên bản, không dùng 40001").toEqual([]);
  });
});
