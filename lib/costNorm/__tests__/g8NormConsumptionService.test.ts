import { beforeEach, describe, expect, it, vi } from 'vitest';

type Filter = { column: string; op: 'eq' | 'in'; value: any };

const baseTables = (): Record<string, any[]> => ({
  cost_norm_libraries: [
    {
      id: 'lib-active',
      name: 'G8 active',
      code: 'G8_ACTIVE',
      source: 'G8',
      status: 'active',
      created_at: '2026-06-13T08:00:00.000Z',
    },
    {
      id: 'lib-draft',
      name: 'G8 draft',
      code: 'G8_DRAFT',
      source: 'G8',
      status: 'draft',
      created_at: '2026-06-13T09:00:00.000Z',
    },
  ],
  cost_norm_items: [
    {
      id: 'norm-1',
      library_id: 'lib-active',
      code: 'AF.11111',
      name: 'Bê tông lót móng M150',
      unit: 'm3',
      search_text: 'af.11111 be tong lot mong m150',
    },
    {
      id: 'norm-draft',
      library_id: 'lib-draft',
      code: 'AF.99999',
      name: 'Định mức nháp',
      unit: 'm3',
      search_text: 'draft',
    },
  ],
  cost_norm_item_components: [
    {
      id: 'component-cement',
      norm_item_id: 'norm-1',
      resource_id: 'resource-cement',
      resource_type: 'material',
      raw_resource_code: 'XM001',
      raw_resource_name: 'Xi măng PCB 30',
      unit: 'kg',
      coefficient: 197.825,
      line_index: 0,
      is_adjustment: false,
    },
    {
      id: 'component-sand',
      norm_item_id: 'norm-1',
      resource_id: 'resource-sand',
      resource_type: 'material',
      raw_resource_code: 'VT00024',
      raw_resource_name: 'Cát vàng',
      unit: 'm3',
      coefficient: 0.573,
      line_index: 1,
      is_adjustment: false,
    },
    {
      id: 'component-labor',
      norm_item_id: 'norm-1',
      resource_id: 'resource-labor',
      resource_type: 'labor',
      raw_resource_code: 'NC0001',
      raw_resource_name: 'Nhân công bậc 3,0/7',
      unit: 'công',
      coefficient: 1.2,
      line_index: 2,
      is_adjustment: false,
    },
  ],
  cost_norm_resources: [
    { id: 'resource-cement', code: 'XM001', name: 'Xi măng PCB 30', type: 'material', unit: 'kg' },
    { id: 'resource-sand', code: 'VT00024', name: 'Cát vàng', type: 'material', unit: 'm3' },
    { id: 'resource-labor', code: 'NC0001', name: 'Nhân công bậc 3,0/7', type: 'labor', unit: 'công' },
  ],
  project_work_boq_items: [
    {
      id: 'work-1',
      project_id: 'project-1',
      construction_site_id: null,
      name: 'Bê tông lót móng',
      unit: 'm3',
      planned_qty: 10,
      unit_price: 0,
      sort_order: 0,
      sync_status: 'manual',
    },
  ],
  material_budget_items: [],
  project_work_boq_norm_mappings: [],
  project_work_boq_norm_component_estimates: [],
  material_request_boq_line_snapshots: [],
  material_request_fulfillment_lines: [],
  purchase_order_request_lines: [],
  material_issue_lines: [],
});

let tables: Record<string, any[]> = baseTables();
let suppressMappingUpsertReturn = false;

beforeEach(() => {
  tables = baseTables();
  suppressMappingUpsertReturn = false;
});

class MockQuery {
  private filters: Filter[] = [];
  private orText = '';
  private orderColumn = '';
  private ascending = true;
  private rangeFrom = 0;
  private rangeTo: number | null = null;
  private rowLimit: number | null = null;
  private operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
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

  upsert(payload: any) {
    this.operation = 'upsert';
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

  or(value: string) {
    this.orText = value;
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
    if (this.operation === 'upsert') return this.executeUpsert();
    return this.executeRows();
  }

  private executeInsert() {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
    tables[this.tableName] = [...(tables[this.tableName] || []), ...rows];
    return rows;
  }

  private executeUpsert() {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
    const existing = tables[this.tableName] || [];
    const result = rows.map(row => {
      const index = existing.findIndex(candidate => candidate.id === row.id);
      if (index >= 0) {
        existing[index] = { ...existing[index], ...row };
        return existing[index];
      }
      existing.push(row);
      return row;
    });
    tables[this.tableName] = existing;
    if (this.tableName === 'project_work_boq_norm_mappings' && suppressMappingUpsertReturn) return [];
    return result;
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
    if (this.orText) {
      const q = this.orText.match(/ilike\.%([^%]+)%/)?.[1]?.toLowerCase() || '';
      rows = rows.filter(row => [row.code, row.name, row.search_text].some(value => String(value || '').toLowerCase().includes(q)));
    }
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
    from: (tableName: string) => new MockQuery(tableName),
  },
}));

describe('g8NormConsumptionService', () => {
  it('searches only active G8 norm libraries', async () => {
    const { g8NormConsumptionService } = await import('../g8NormConsumptionService');
    const rows = await g8NormConsumptionService.searchActiveNormItems('AF', 10);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'norm-1',
      code: 'AF.11111',
      libraryId: 'lib-active',
    });
  });

  it('previews BOQ quantity multiplied by norm coefficients', async () => {
    const { g8NormConsumptionService } = await import('../g8NormConsumptionService');
    const preview = await g8NormConsumptionService.previewApplyNorm('work-1', 'norm-1');
    const sand = preview.components.find(component => component.componentId === 'component-sand');
    const labor = preview.components.find(component => component.componentId === 'component-labor');

    expect(sand).toMatchObject({
      resourceName: 'Cát vàng',
      selected: true,
      estimatedQty: 5.73,
    });
    expect(labor).toMatchObject({
      selected: false,
      estimatedQty: 12,
    });
  });

  it('applies a norm without duplicating materials on reapply', async () => {
    const { g8NormConsumptionService } = await import('../g8NormConsumptionService');
    const inventoryItems = [
      {
        id: 'inventory-sand',
        sku: 'VT00024',
        name: 'Cát vàng',
        category: 'Cát',
        unit: 'm3',
        priceIn: 100000,
        priceOut: 0,
        minStock: 0,
        stockByWarehouse: {},
      },
    ];

    const first = await g8NormConsumptionService.applyNormToWorkBoq('work-1', 'norm-1', {
      selectedComponentIds: ['component-sand'],
      inventoryItems,
    });
    const second = await g8NormConsumptionService.applyNormToWorkBoq('work-1', 'norm-1', {
      selectedComponentIds: ['component-sand'],
      inventoryItems,
    });

    expect(first.materialBudgetItems[0]).toMatchObject({
      inventoryItemId: 'inventory-sand',
      materialCode: 'VT00024',
      budgetQty: 5.73,
      sourceType: 'g8_norm',
      sourceNormCodeSnapshot: 'AF.11111',
    });
    expect(second.mapping.id).toBe(first.mapping.id);
    expect(tables.project_work_boq_norm_mappings).toHaveLength(1);
    expect(tables.material_budget_items).toHaveLength(1);
  });

  it('keeps estimate mapping_id when mapping upsert returns no selected row', async () => {
    suppressMappingUpsertReturn = true;
    const { g8NormConsumptionService } = await import('../g8NormConsumptionService');

    const result = await g8NormConsumptionService.applyNormToWorkBoq('work-1', 'norm-1', {
      selectedComponentIds: ['component-sand'],
    });

    expect(result.mapping.id).toBeTruthy();
    expect(tables.project_work_boq_norm_component_estimates).toHaveLength(3);
    expect(tables.project_work_boq_norm_component_estimates.every(row => row.mapping_id === result.mapping.id)).toBe(true);
    expect(tables.material_budget_items[0].source_norm_mapping_id).toBe(result.mapping.id);
  });

  it('blocks removing generated materials after downstream usage exists', async () => {
    const { g8NormConsumptionService } = await import('../g8NormConsumptionService');
    const result = await g8NormConsumptionService.applyNormToWorkBoq('work-1', 'norm-1', {
      selectedComponentIds: ['component-sand'],
    });
    tables.purchase_order_request_lines.push({
      id: 'po-link-1',
      material_budget_item_id: result.materialBudgetItems[0].id,
    });

    await expect(g8NormConsumptionService.removeNormMapping(result.mapping.id)).rejects.toThrow(/phát sinh/);
  });
});
