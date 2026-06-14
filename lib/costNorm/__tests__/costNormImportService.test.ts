import { beforeEach, describe, expect, it, vi } from 'vitest';

type Filter = { column: string; op: 'eq' | 'in'; value: any };

const baseTables = (): Record<string, any[]> => ({
  cost_norm_libraries: [
    {
      id: 'lib-1',
      name: 'G8 sample',
      code: 'G8_SAMPLE',
      source: 'G8',
      version: 'TT12',
      region: 'HN',
      status: 'draft',
      created_at: '2026-06-12T09:00:00.000Z',
      updated_at: '2026-06-12T09:00:00.000Z',
    },
  ],
  cost_norm_items: [
    {
      id: 'item-1',
      library_id: 'lib-1',
      code: 'AA.22111',
      name: 'Phá dỡ bê tông bằng búa căn khí nén',
      unit: 'm3',
      search_text: 'aa.22111 pha do be tong bua can khi nen',
      source_sheet_name: 'G8',
      source_row_start: 2,
      source_row_end: 10,
      raw_data: {},
    },
  ],
  cost_norm_item_components: [
    {
      id: 'component-1',
      norm_item_id: 'item-1',
      resource_id: 'resource-1',
      resource_type: 'material',
      raw_resource_code: 'V00515',
      raw_resource_name: 'Que hàn',
      unit: 'kg',
      coefficient: 0.96,
      line_index: 0,
      is_adjustment: false,
      raw_data: {},
    },
  ],
  cost_norm_resources: [
    {
      id: 'resource-1',
      code: 'V00515',
      name: 'Que hàn',
      type: 'material',
      unit: 'kg',
      raw_data: {},
    },
  ],
  cost_norm_import_jobs: [
    {
      id: 'job-1',
      library_id: 'lib-1',
      file_name: 'g8.xlsx',
      status: 'committed',
      total_rows: 10,
      parsed_items: 1,
      parsed_components: 1,
      warning_count: 0,
      error_count: 0,
      parser_version: 'g8-v1',
      result_summary: {},
      created_at: '2026-06-12T09:05:00.000Z',
    },
  ],
  cost_norm_import_errors: [],
  cost_norm_import_raw_rows: [
    {
      id: 'raw-1',
      import_job_id: 'job-1',
      library_id: 'lib-1',
      sheet_name: 'G8',
      row_number: 2,
      row_type: 'work_item',
      row_text: 'AA.22111 | Phá dỡ bê tông bằng búa căn khí nén | m3',
      work_item_code: 'AA.22111',
      parsed_data: {},
      warnings: [],
    },
  ],
  cost_norm_change_logs: [],
});

let tables: Record<string, any[]> = baseTables();

beforeEach(() => {
  tables = baseTables();
});

class MockQuery {
  private filters: Filter[] = [];
  private orderColumn = '';
  private ascending = true;
  private rangeFrom = 0;
  private rangeTo: number | null = null;
  private rowLimit: number | null = null;
  private operation: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: any = null;

  constructor(private readonly tableName: string) {}

  select() { return this; }

  insert(payload: any) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: any) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ column, op: 'eq', value });
    return this;
  }

  in(column: string, value: any[]) {
    this.filters.push({ column, op: 'in', value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderColumn = column;
    this.ascending = options?.ascending !== false;
    return this;
  }

  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  limit(limit: number) {
    this.rowLimit = limit;
    return this;
  }

  single() {
    const rows = this.execute();
    return Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'not found' } });
  }

  maybeSingle() {
    const rows = this.execute();
    return Promise.resolve({ data: rows[0] || null, error: null });
  }

  then(resolve: any, reject: any) {
    return Promise.resolve({ data: this.execute(), error: null }).then(resolve, reject);
  }

  private execute() {
    if (this.operation === 'insert') return this.executeInsert();
    if (this.operation === 'update') return this.executeUpdate();
    if (this.operation === 'delete') return this.executeDelete();
    return this.executeRows();
  }

  private executeInsert() {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
    tables[this.tableName] = [...(tables[this.tableName] || []), ...rows];
    return rows;
  }

  private executeUpdate() {
    const rows = this.executeRows();
    const ids = new Set(rows.map(row => row.id));
    tables[this.tableName] = (tables[this.tableName] || []).map(row => ids.has(row.id) ? { ...row, ...this.payload } : row);
    return tables[this.tableName].filter(row => ids.has(row.id));
  }

  private executeDelete() {
    const rows = this.executeRows();
    const ids = new Set(rows.map(row => row.id));
    tables[this.tableName] = (tables[this.tableName] || []).filter(row => !ids.has(row.id));
    return rows;
  }

  private executeRows() {
    let rows = [...(tables[this.tableName] || [])];
    this.filters.forEach(filter => {
      rows = rows.filter(row => {
        if (filter.op === 'eq') return row[filter.column] === filter.value;
        return filter.value.includes(row[filter.column]);
      });
    });
    if (this.orderColumn) {
      rows.sort((a, b) => {
        const left = a[this.orderColumn] ?? '';
        const right = b[this.orderColumn] ?? '';
        const result = String(left).localeCompare(String(right));
        return this.ascending ? result : -result;
      });
    }
    if (this.rangeTo !== null) rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    if (this.rowLimit !== null) rows = rows.slice(0, this.rowLimit);
    return rows;
  }
}

vi.doMock('../../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn((tableName: string) => new MockQuery(tableName)),
  },
}));

describe('g8CostNormImportService load methods', () => {
  it('loads imported libraries', async () => {
    const { g8CostNormImportService } = await import('../costNormImportService');
    const libraries = await g8CostNormImportService.listLibraries();

    expect(libraries).toHaveLength(1);
    expect(libraries[0]).toMatchObject({
      id: 'lib-1',
      code: 'G8_SAMPLE',
      createdAt: '2026-06-12T09:00:00.000Z',
    });
  });

  it('loads import jobs for a library', async () => {
    const { g8CostNormImportService } = await import('../costNormImportService');
    const jobs = await g8CostNormImportService.listImportJobs('lib-1');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 'job-1',
      fileName: 'g8.xlsx',
      parserVersion: 'g8-v1',
    });
  });

  it('loads library details with components, resources, jobs, and raw rows', async () => {
    const { g8CostNormImportService } = await import('../costNormImportService');
    const details = await g8CostNormImportService.getLibraryDetails('lib-1');

    expect(details?.library.code).toBe('G8_SAMPLE');
    expect(details?.items).toHaveLength(1);
    expect(details?.items[0].components[0]).toMatchObject({
      rawResourceCode: 'V00515',
      coefficient: 0.96,
      resource: {
        code: 'V00515',
        name: 'Que hàn',
      },
    });
    expect(details?.importJobs[0].id).toBe('job-1');
    expect(details?.rawRows[0]).toMatchObject({
      rowType: 'work_item',
      workItemCode: 'AA.22111',
    });
    expect(details?.changeLogs).toHaveLength(0);
  });

  it('updates library metadata and writes a change log', async () => {
    const { g8CostNormImportService } = await import('../costNormImportService');
    const updated = await g8CostNormImportService.updateLibraryMetadata('lib-1', { name: 'G8 edited', status: 'active' }, 'actor-1');

    expect(updated).toMatchObject({ id: 'lib-1', name: 'G8 edited', status: 'active' });
    expect(tables.cost_norm_change_logs).toHaveLength(1);
    expect(tables.cost_norm_change_logs[0]).toMatchObject({
      library_id: 'lib-1',
      action: 'library_update',
      actor_id: 'actor-1',
    });
  });

  it('updates a norm item and writes a change log', async () => {
    const { g8CostNormImportService } = await import('../costNormImportService');
    const updated = await g8CostNormImportService.updateNormItem('item-1', {
      code: 'AA.22112',
      name: 'Phá dỡ bê tông đã sửa',
      unit: 'm3',
    }, 'actor-1');

    expect(updated).toMatchObject({ id: 'item-1', code: 'AA.22112', name: 'Phá dỡ bê tông đã sửa' });
    expect(tables.cost_norm_items[0]).toMatchObject({
      code: 'AA.22112',
      search_text: 'aa.22112 pha do be tong da sua m3',
      updated_by: 'actor-1',
    });
    expect(tables.cost_norm_change_logs[0]).toMatchObject({
      library_id: 'lib-1',
      norm_item_id: 'item-1',
      action: 'item_update',
    });
  });

  it('creates and deletes a component with change logs', async () => {
    const { g8CostNormImportService } = await import('../costNormImportService');
    const created = await g8CostNormImportService.createComponent('item-1', {
      resourceType: 'machine',
      rawResourceCode: 'M112.4002_TT11',
      rawResourceName: 'Biến thế hàn',
      unit: 'ca',
      coefficient: 0.23,
    }, 'actor-1');

    expect(created).toMatchObject({
      normItemId: 'item-1',
      rawResourceCode: 'M112.4002_TT11',
      resourceType: 'machine',
      coefficient: 0.23,
    });
    expect(tables.cost_norm_resources.some(row => row.code === 'M112.4002_TT11')).toBe(true);
    expect(tables.cost_norm_change_logs.some(row => row.action === 'component_create')).toBe(true);

    await g8CostNormImportService.deleteComponent(created.id, 'actor-1');
    expect(tables.cost_norm_item_components.some(row => row.id === created.id)).toBe(false);
    expect(tables.cost_norm_change_logs.some(row => row.action === 'component_delete')).toBe(true);
  });

  it('updates a component coefficient from Vietnamese number text', async () => {
    const { g8CostNormImportService } = await import('../costNormImportService');
    const updated = await g8CostNormImportService.updateComponent('component-1', {
      resourceType: 'labor',
      rawResourceCode: 'NC0006',
      rawResourceName: 'Nhân công bậc 3,0/7',
      unit: 'công',
      coefficient: '1,33' as any,
      lineIndex: 0,
    }, 'actor-1');

    expect(updated).toMatchObject({
      id: 'component-1',
      resourceType: 'labor',
      coefficient: 1.33,
    });
    expect(tables.cost_norm_item_components[0]).toMatchObject({
      raw_resource_code: 'NC0006',
      coefficient: 1.33,
    });
    expect(tables.cost_norm_change_logs.some(row => row.action === 'component_update')).toBe(true);
  });
});
