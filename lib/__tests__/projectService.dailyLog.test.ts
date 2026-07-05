import { beforeEach, describe, expect, it, vi } from 'vitest';

let dailyLogRows: any[] = [];
let blockDelete = false;

class MockQuery {
  private operation: 'select' | 'delete' = 'select';
  private filters: Record<string, any> = {};
  private selectedColumns = '*';

  constructor(private readonly tableName: string) {}

  select(columns = '*') {
    this.selectedColumns = columns;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column: string, value: any) {
    this.filters[column] = value;
    return this;
  }

  order() { return this; }
  or() { return this; }

  single() {
    const row = this.rows()[0];
    return Promise.resolve(row ? { data: row, error: null } : { data: null, error: { message: 'not found' } });
  }

  maybeSingle() {
    const result = this.execute();
    const first = Array.isArray(result.data) ? result.data[0] || null : result.data || null;
    return Promise.resolve({ data: first, error: result.error });
  }

  then(resolve: any, reject: any) {
    return Promise.resolve(this.execute()).then(resolve, reject);
  }

  private rows() {
    if (this.tableName !== 'daily_logs') return [];
    return dailyLogRows.filter(row => Object.entries(this.filters).every(([key, value]) => row[key] === value));
  }

  private execute() {
    if (this.tableName !== 'daily_logs') return { data: [], error: null };
    if (this.operation === 'delete') {
      const rows = this.rows();
      if (blockDelete) return { data: [], error: null };
      const ids = new Set(rows.map(row => row.id));
      dailyLogRows = dailyLogRows.filter(row => !ids.has(row.id));
      const data = this.selectedColumns === 'id' ? rows.map(row => ({ id: row.id })) : rows;
      return { data, error: null };
    }
    return { data: this.rows(), error: null };
  }
}

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn((tableName: string) => new MockQuery(tableName)),
  },
}));

vi.mock('../dailyLogDetailService', () => ({
  dailyLogDetailService: {
    listByLogIds: vi.fn(() => Promise.resolve({})),
    replaceForLog: vi.fn(() => Promise.resolve()),
  },
}));

beforeEach(() => {
  dailyLogRows = [];
  blockDelete = false;
});

describe('dailyLogService.remove', () => {
  it('throws when Supabase reports no deleted row', async () => {
    dailyLogRows = [{ id: 'log-1', status: 'rejected', ever_submitted: true }];
    blockDelete = true;

    const { dailyLogService } = await import('../projectService');

    await expect(dailyLogService.remove('log-1')).rejects.toThrow('Không xoá được nhật ký');
    expect(dailyLogRows).toHaveLength(1);
  });

  it('removes draft or rejected logs when Supabase returns the deleted row', async () => {
    dailyLogRows = [{ id: 'log-1', status: 'rejected', ever_submitted: true }];

    const { dailyLogService } = await import('../projectService');

    await expect(dailyLogService.remove('log-1')).resolves.toBeUndefined();
    expect(dailyLogRows).toHaveLength(0);
  });
});
