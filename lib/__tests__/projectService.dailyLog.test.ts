import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

let dailyLogRows: any[] = [];
let blockDelete = false;
let dailyLogUpdatePayloads: any[] = [];

class MockQuery {
  private operation: 'select' | 'delete' | 'update' = 'select';
  private filters: Record<string, any> = {};
  private selectedColumns = '*';
  private updatePayload: Record<string, any> | null = null;

  constructor(private readonly tableName: string) {}

  select(columns = '*') {
    this.selectedColumns = columns;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  update(payload: Record<string, any>) {
    this.operation = 'update';
    this.updatePayload = payload;
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
    if (this.operation === 'update') {
      const rows = this.rows();
      dailyLogUpdatePayloads.push(this.updatePayload);
      dailyLogRows = dailyLogRows.map(row => (
        rows.some(match => match.id === row.id)
          ? { ...row, ...this.updatePayload }
          : row
      ));
      return { data: rows, error: null };
    }
    return { data: this.rows(), error: null };
  }
}

vi.mock('../supabase', () => ({
  supabase: supabaseMock,
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
  dailyLogUpdatePayloads = [];
  supabaseMock.from.mockImplementation((tableName: string) => new MockQuery(tableName));
  supabaseMock.rpc.mockResolvedValue({ data: null, error: null });
});

describe('dailyLogService.updateStatus', () => {
  it('routes rejected verified logs through transition_daily_log_status instead of direct table update', async () => {
    dailyLogRows = [{ id: 'log-1', status: 'verified', created_by_id: 'owner-1' }];

    const { dailyLogService } = await import('../projectService');

    await expect(dailyLogService.updateStatus({
      logId: 'log-1',
      status: 'rejected',
      rejectionReason: 'Cần bổ sung ảnh hiện trường',
      actorUserId: 'reviewer-1',
    })).resolves.toBeUndefined();

    expect(supabaseMock.rpc).toHaveBeenCalledWith('transition_daily_log_status', {
      p_log_id: 'log-1',
      p_status: 'rejected',
      p_requested_verifier_id: null,
      p_requested_verifier_name: null,
      p_rejection_reason: 'Cần bổ sung ảnh hiện trường',
    });
    expect(dailyLogUpdatePayloads).toEqual([]);
    expect(dailyLogRows[0].status).toBe('verified');
  });
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
