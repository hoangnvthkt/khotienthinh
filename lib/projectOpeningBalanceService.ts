import {
  InventoryItem,
  ProjectFinance,
  ProjectOpeningBalance,
  ProjectOpeningBalanceImportRow,
  ProjectOpeningBalanceLine,
  ProjectTransaction,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { getExcelCell, parseExcelRows } from './excelImport';
import { getWeekStart, projectWeeklyProgressService } from './projectWeeklyProgressService';
import { isSupabaseConfigured, supabase } from './supabase';

const BALANCE_TABLE = 'project_opening_balances';
const LINE_TABLE = 'project_opening_balance_lines';

const numberOrZero = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const clampPercent = (value: unknown): number => Math.min(100, Math.max(0, numberOrZero(value)));

const cleanUndefined = <T extends Record<string, unknown>>(input: T): T =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;

export const calculateOpeningRecognizedValue = (purchasedValue: number, issuedValue: number): number =>
  Math.max(0, Number(purchasedValue || 0), Number(issuedValue || 0));

export const normalizeOpeningBalance = (
  balance: ProjectOpeningBalance,
): ProjectOpeningBalance => ({
  ...balance,
  contractValue: Math.max(0, Number(balance.contractValue || 0)),
  constructionProgressPercent: clampPercent(balance.constructionProgressPercent),
  purchasedValue: Math.max(0, Number(balance.purchasedValue || 0)),
  issuedValue: Math.max(0, Number(balance.issuedValue || 0)),
  usedValue: Math.max(0, Number(balance.usedValue || 0)),
  recognizedValue: calculateOpeningRecognizedValue(balance.purchasedValue, balance.issuedValue),
  stockTransactionIds: balance.stockTransactionIds || [],
});

const normalizeLine = (line: ProjectOpeningBalanceLine): ProjectOpeningBalanceLine => {
  const unitPrice = Math.max(0, Number(line.unitPrice || 0));
  const remainingQty = Math.max(0, Number(line.remainingQty || 0));
  return {
    ...line,
    sku: String(line.sku || '').trim(),
    itemName: String(line.itemName || '').trim(),
    unit: String(line.unit || 'Cái').trim() || 'Cái',
    warehouseId: String(line.warehouseId || '').trim(),
    purchasedQty: Math.max(0, Number(line.purchasedQty || 0)),
    issuedQty: Math.max(0, Number(line.issuedQty || 0)),
    usedQty: Math.max(0, Number(line.usedQty || 0)),
    remainingQty,
    unitPrice,
    remainingValue: Math.max(0, Number(line.remainingValue || remainingQty * unitPrice || 0)),
  };
};

const mapBalance = (row: any): ProjectOpeningBalance => ({
  ...(fromDb(row) as ProjectOpeningBalance),
  stockTransactionIds: row.stock_transaction_ids || row.stockTransactionIds || [],
  materialProjectTransactionId: row.material_project_transaction_id ?? row.materialProjectTransactionId ?? null,
});

const mapLine = (row: any): ProjectOpeningBalanceLine => fromDb(row) as ProjectOpeningBalanceLine;

const balanceToDb = (balance: ProjectOpeningBalance): Record<string, unknown> => {
  const normalized = normalizeOpeningBalance(balance);
  const payload = cleanUndefined(toDb({
    ...normalized,
    stockTransactionIds: normalized.stockTransactionIds || [],
  }));
  if (!payload.id) delete payload.id;
  delete payload.created_at;
  delete payload.updated_at;
  return payload;
};

const lineToDb = (line: ProjectOpeningBalanceLine, openingBalanceId: string): Record<string, unknown> => {
  const payload = cleanUndefined(toDb({
    ...normalizeLine(line),
    openingBalanceId,
  }));
  if (!payload.id) delete payload.id;
  delete payload.created_at;
  delete payload.updated_at;
  return payload;
};

const itemToDb = (item: InventoryItem): Record<string, unknown> => ({
  id: item.id,
  sku: item.sku,
  name: item.name,
  category: item.category || 'Đầu kỳ',
  unit: item.unit || 'Cái',
  purchase_unit: item.purchaseUnit || null,
  price_in: Number(item.priceIn || 0),
  price_out: Number(item.priceOut || 0),
  min_stock: Number(item.minStock || 0),
  supplier_id: item.supplierId || null,
  image_url: item.imageUrl || null,
  stock_by_warehouse: item.stockByWarehouse || {},
  location: item.location || null,
});

const transactionToDb = (tx: Transaction): Record<string, unknown> => ({
  id: tx.id,
  type: tx.type,
  date: tx.date,
  items: tx.items || [],
  source_warehouse_id: tx.sourceWarehouseId || null,
  target_warehouse_id: tx.targetWarehouseId || null,
  supplier_id: tx.supplierId || null,
  requester_id: tx.requesterId,
  approver_id: tx.approverId || null,
  status: tx.status,
  note: tx.note || null,
  related_request_id: tx.relatedRequestId || null,
  pending_items: tx.pendingItems || [],
});

const projectTransactionToDb = (tx: ProjectTransaction): Record<string, unknown> => ({
  id: tx.id,
  project_id: tx.projectId || null,
  project_finance_id: tx.projectFinanceId || null,
  construction_site_id: tx.constructionSiteId || null,
  type: tx.type,
  category: tx.category,
  amount: tx.amount,
  description: tx.description,
  date: tx.date,
  source: tx.source,
  source_ref: tx.sourceRef || null,
  attachments: tx.attachments || [],
  created_by: tx.createdBy || null,
  created_at: tx.createdAt,
});

const projectFinanceToDb = (finance: ProjectFinance): Record<string, unknown> => ({
  id: finance.id,
  project_id: finance.projectId || null,
  construction_site_id: finance.constructionSiteId,
  contractValue: Number(finance.contractValue || 0),
  contractSignDate: finance.contractSignDate || null,
  estimatedEndDate: finance.estimatedEndDate || null,
  budgetMaterials: Number(finance.budgetMaterials || 0),
  budgetLabor: Number(finance.budgetLabor || 0),
  budgetSubcontract: Number(finance.budgetSubcontract || 0),
  budgetMachinery: Number(finance.budgetMachinery || 0),
  budgetOverhead: Number(finance.budgetOverhead || 0),
  actualMaterials: Number(finance.actualMaterials || 0),
  actualLabor: Number(finance.actualLabor || 0),
  actualSubcontract: Number(finance.actualSubcontract || 0),
  actualMachinery: Number(finance.actualMachinery || 0),
  actualOverhead: Number(finance.actualOverhead || 0),
  revenueReceived: Number(finance.revenueReceived || 0),
  revenuePending: Number(finance.revenuePending || 0),
  progressPercent: clampPercent(finance.progressPercent),
  status: finance.status,
  notes: finance.notes || null,
  updatedAt: finance.updatedAt,
});

const defaultFinance = (balance: ProjectOpeningBalance, financeId?: string): ProjectFinance => ({
  id: financeId || crypto.randomUUID(),
  projectId: balance.projectId || null,
  constructionSiteId: balance.constructionSiteId || '',
  contractValue: balance.contractValue,
  budgetMaterials: 0,
  budgetLabor: 0,
  budgetSubcontract: 0,
  budgetMachinery: 0,
  budgetOverhead: 0,
  actualMaterials: 0,
  actualLabor: 0,
  actualSubcontract: 0,
  actualMachinery: 0,
  actualOverhead: 0,
  revenueReceived: 0,
  revenuePending: 0,
  progressPercent: balance.constructionProgressPercent,
  status: 'active',
  notes: balance.note || undefined,
  updatedAt: new Date().toISOString(),
});

const buildFinance = (
  balance: ProjectOpeningBalance,
  existingFinance?: ProjectFinance | null,
): ProjectFinance => {
  const base = existingFinance || defaultFinance(balance);
  return {
    ...base,
    projectId: balance.projectId || base.projectId || null,
    constructionSiteId: balance.constructionSiteId || base.constructionSiteId,
    contractValue: Number(balance.contractValue || base.contractValue || 0),
    progressPercent: base.progressPercent > 0 ? base.progressPercent : balance.constructionProgressPercent,
    status: base.status === 'planning' && balance.constructionProgressPercent > 0 ? 'active' : base.status,
    notes: [base.notes, balance.note ? `Đầu kỳ ${balance.asOfDate}: ${balance.note}` : 'Đầu kỳ dự án đã được chốt.']
      .filter(Boolean)
      .join('\n'),
    updatedAt: new Date().toISOString(),
  };
};

const buildItemsForLines = (
  lines: ProjectOpeningBalanceLine[],
  existingItems: InventoryItem[],
): { itemByLineKey: Map<string, InventoryItem>; createdItems: InventoryItem[] } => {
  const byId = new Map(existingItems.map(item => [item.id, item]));
  const bySku = new Map(existingItems.map(item => [item.sku.trim().toLowerCase(), item]));
  const createdItems: InventoryItem[] = [];
  const itemByLineKey = new Map<string, InventoryItem>();

  lines.forEach((line, index) => {
    const normalized = normalizeLine(line);
    const skuKey = normalized.sku.toLowerCase();
    let item = normalized.inventoryItemId ? byId.get(normalized.inventoryItemId) : undefined;
    if (!item && skuKey) item = bySku.get(skuKey);
    if (!item) {
      item = {
        id: normalized.inventoryItemId || crypto.randomUUID(),
        sku: normalized.sku || `OPEN-${String(index + 1).padStart(4, '0')}`,
        name: normalized.itemName || normalized.sku || `Vật tư đầu kỳ ${index + 1}`,
        category: 'Đầu kỳ',
        unit: normalized.unit || 'Cái',
        priceIn: normalized.unitPrice,
        priceOut: normalized.unitPrice,
        minStock: 0,
        stockByWarehouse: {},
      };
      createdItems.push(item);
      byId.set(item.id, item);
      bySku.set(item.sku.trim().toLowerCase(), item);
    }
    itemByLineKey.set(String(index), item);
  });

  return { itemByLineKey, createdItems };
};

export interface ProjectOpeningBalanceLockResult {
  openingBalance: ProjectOpeningBalance;
  lines: ProjectOpeningBalanceLine[];
  projectFinance: ProjectFinance;
  materialProjectTransaction?: ProjectTransaction;
  stockTransactions: Transaction[];
  createdItems: InventoryItem[];
}

export const projectOpeningBalanceService = {
  async getOpeningBalanceByScope(scopeKey: string): Promise<ProjectOpeningBalance | null> {
    if (!isSupabaseConfigured || !scopeKey) return null;
    const { data, error } = await supabase
      .from(BALANCE_TABLE)
      .select('*')
      .eq('scope_key', scopeKey)
      .neq('status', 'void')
      .order('status', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('project opening balance unavailable', error.message);
      return null;
    }
    return data ? mapBalance(data) : null;
  },

  async getLockedByScope(scopeKey: string): Promise<ProjectOpeningBalance | null> {
    if (!isSupabaseConfigured || !scopeKey) return null;
    const { data, error } = await supabase
      .from(BALANCE_TABLE)
      .select('*')
      .eq('scope_key', scopeKey)
      .eq('status', 'locked')
      .maybeSingle();
    if (error) {
      console.warn('project opening balance unavailable', error.message);
      return null;
    }
    return data ? mapBalance(data) : null;
  },

  async listLines(openingBalanceId: string): Promise<ProjectOpeningBalanceLine[]> {
    if (!isSupabaseConfigured || !openingBalanceId) return [];
    const { data, error } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .eq('opening_balance_id', openingBalanceId)
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('project opening balance lines unavailable', error.message);
      return [];
    }
    return (data || []).map(mapLine);
  },

  async saveOpeningBalanceDraft(input: {
    openingBalance: ProjectOpeningBalance;
    lines: ProjectOpeningBalanceLine[];
  }): Promise<{ openingBalance: ProjectOpeningBalance; lines: ProjectOpeningBalanceLine[] }> {
    const balance = normalizeOpeningBalance({ ...input.openingBalance, status: 'draft' });
    if (!isSupabaseConfigured) {
      const id = balance.id || crypto.randomUUID();
      return {
        openingBalance: { ...balance, id },
        lines: input.lines.map(line => ({ ...normalizeLine(line), openingBalanceId: id })),
      };
    }

    const { data, error } = await supabase
      .from(BALANCE_TABLE)
      .upsert(balanceToDb(balance), { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;

    const saved = mapBalance(data);
    if (!saved.id) throw new Error('Không tạo được bản đầu kỳ.');

    await supabase.from(LINE_TABLE).delete().eq('opening_balance_id', saved.id);
    const normalizedLines = input.lines.map(line => normalizeLine(line)).filter(line => line.sku && line.itemName && line.warehouseId);
    if (normalizedLines.length > 0) {
      const { data: lineRows, error: lineError } = await supabase
        .from(LINE_TABLE)
        .insert(normalizedLines.map(line => lineToDb(line, saved.id!)))
        .select();
      if (lineError) throw lineError;
      return { openingBalance: saved, lines: (lineRows || []).map(mapLine) };
    }

    return { openingBalance: saved, lines: [] };
  },

  async lockOpeningBalance(input: {
    openingBalance: ProjectOpeningBalance;
    lines: ProjectOpeningBalanceLine[];
    existingItems: InventoryItem[];
    existingFinance?: ProjectFinance | null;
    actorUserId?: string;
  }): Promise<ProjectOpeningBalanceLockResult> {
    const balance = normalizeOpeningBalance(input.openingBalance);
    if (!balance.scopeKey) throw new Error('Thiếu scope dự án/công trường.');
    if (!balance.constructionSiteId && !balance.projectId) throw new Error('Thiếu dự án hoặc công trường.');

    const lines = input.lines.map(normalizeLine).filter(line => line.sku && line.itemName && line.warehouseId);
    const locked = await this.getLockedByScope(balance.scopeKey);
    if (locked && locked.id !== balance.id) {
      throw new Error('Dự án/công trường này đã có dữ liệu đầu kỳ đã khóa.');
    }

    const projectFinance = buildFinance(balance, input.existingFinance);
    const { itemByLineKey, createdItems } = buildItemsForLines(lines, input.existingItems);
    const linesWithItems = lines.map((line, index) => ({
      ...line,
      inventoryItemId: itemByLineKey.get(String(index))?.id || line.inventoryItemId || null,
    }));
    const stockEntries = linesWithItems
      .map((line, index) => ({ line, index }))
      .filter(entry => entry.line.remainingQty > 0);
    const stockTransactions: Transaction[] = [];
    let materialProjectTransaction: ProjectTransaction | undefined;

    if (isSupabaseConfigured) {
      if (createdItems.length > 0) {
        const { error: itemError } = await supabase
          .from('items')
          .upsert(createdItems.map(itemToDb), { onConflict: 'id' });
        if (itemError) throw itemError;
      }

      const saved = await this.saveOpeningBalanceDraft({ openingBalance: balance, lines: linesWithItems });
      const openingId = saved.openingBalance.id;
      if (!openingId) throw new Error('Không tạo được bản đầu kỳ.');

      const { error: financeError } = await supabase
        .from('project_finances')
        .upsert(projectFinanceToDb(projectFinance), { onConflict: 'id' });
      if (financeError) throw financeError;

      const allItemIds = [...new Set(linesWithItems.map(line => line.inventoryItemId).filter(Boolean) as string[])];
      const { data: itemRows, error: itemReadError } = allItemIds.length > 0
        ? await supabase.from('items').select('*').in('id', allItemIds)
        : { data: [], error: null } as any;
      if (itemReadError) throw itemReadError;

      const dbItemById = new Map<string, any>((itemRows || []).map((row: any) => [row.id, row]));
      const stockDeltaByItem = new Map<string, Record<string, number>>();
      stockEntries.forEach(({ line, index }) => {
        const item = itemByLineKey.get(String(index));
        if (!item) return;
        const byWarehouse = stockDeltaByItem.get(item.id) || {};
        byWarehouse[line.warehouseId] = (byWarehouse[line.warehouseId] || 0) + line.remainingQty;
        stockDeltaByItem.set(item.id, byWarehouse);
      });

      for (const [itemId, deltaByWarehouse] of stockDeltaByItem.entries()) {
        const dbItem = dbItemById.get(itemId);
        const current = { ...(dbItem?.stock_by_warehouse || {}) };
        Object.entries(deltaByWarehouse).forEach(([warehouseId, qty]) => {
          current[warehouseId] = Number(current[warehouseId] || 0) + Number(qty || 0);
        });
        const { error: stockError } = await supabase
          .from('items')
          .update({ stock_by_warehouse: current })
          .eq('id', itemId);
        if (stockError) throw stockError;
      }

      const linesByWarehouse = new Map<string, Array<{ line: ProjectOpeningBalanceLine; index: number }>>();
      stockEntries.forEach(({ line, index }) => {
        const list = linesByWarehouse.get(line.warehouseId) || [];
        list.push({ line, index });
        linesByWarehouse.set(line.warehouseId, list);
      });

      for (const [warehouseId, warehouseEntries] of linesByWarehouse.entries()) {
        const tx: Transaction = {
          id: crypto.randomUUID(),
          type: TransactionType.ADJUSTMENT,
          date: balance.asOfDate,
          targetWarehouseId: warehouseId,
          requesterId: input.actorUserId || '',
          createdBy: input.actorUserId,
          approverId: input.actorUserId,
          status: TransactionStatus.COMPLETED,
          note: `Nhập tồn đầu kỳ dự án ${balance.scopeKey} (${balance.asOfDate})`,
          items: warehouseEntries.map(({ line, index }) => {
            const item = itemByLineKey.get(String(index));
            return {
              itemId: item?.id || line.inventoryItemId || line.sku,
              quantity: Number(line.remainingQty || 0),
              price: Number(line.unitPrice || 0),
            };
          }),
        };
        const { error: txError } = await supabase.from('transactions').insert(transactionToDb(tx));
        if (txError) throw txError;
        stockTransactions.push(tx);
      }

      if (balance.purchasedValue > 0) {
        const sourceRef = `opening_balance:${openingId}:materials`;
        const tx: ProjectTransaction = {
          id: crypto.randomUUID(),
          projectId: balance.projectId || null,
          projectFinanceId: projectFinance.id,
          constructionSiteId: balance.constructionSiteId || '',
          type: 'expense',
          category: 'materials',
          amount: balance.purchasedValue,
          description: `Chi phí vật tư đầu kỳ đến ${balance.asOfDate}`,
          date: balance.asOfDate,
          source: 'import',
          sourceRef,
          attachments: [],
          createdBy: input.actorUserId,
          createdAt: new Date().toISOString(),
        };
        const { data: txData, error: projectTxError } = await supabase
          .from('project_transactions')
          .upsert(projectTransactionToDb(tx), { onConflict: 'source_ref' })
          .select()
          .single();
        if (projectTxError) throw projectTxError;
        materialProjectTransaction = txData ? fromDb(txData) as ProjectTransaction : tx;
      }

      const stockTransactionIds = stockTransactions.map(tx => tx.id);
      const { data: lockedRow, error: lockError } = await supabase
        .from(BALANCE_TABLE)
        .update({
          status: 'locked',
          locked_by: input.actorUserId || null,
          locked_at: new Date().toISOString(),
          stock_transaction_ids: stockTransactionIds,
          material_project_transaction_id: materialProjectTransaction?.id || null,
        })
        .eq('id', openingId)
        .select()
        .single();
      if (lockError) throw lockError;

      await projectWeeklyProgressService.upsertSnapshot({
        scopeKey: balance.scopeKey,
        projectId: balance.projectId,
        constructionSiteId: balance.constructionSiteId,
        weekStart: getWeekStart(balance.asOfDate),
        constructionProgressPercent: balance.constructionProgressPercent,
        valueMetric: {
          contractTotalValue: balance.contractValue,
          purchasedValue: balance.purchasedValue,
          issuedValue: balance.issuedValue,
          recognizedValue: balance.recognizedValue,
          valueProgressPercent: balance.contractValue > 0
            ? Math.min(100, Math.round((balance.recognizedValue / balance.contractValue) * 100))
            : 0,
        },
        progressMode: 'opening_balance',
        calculatedAt: new Date().toISOString(),
      });

      const savedLines = await this.listLines(openingId);
      return {
        openingBalance: mapBalance(lockedRow),
        lines: savedLines,
        projectFinance,
        materialProjectTransaction,
        stockTransactions,
        createdItems,
      };
    }

    if (balance.purchasedValue > 0) {
      materialProjectTransaction = {
        id: crypto.randomUUID(),
        projectId: balance.projectId || null,
        projectFinanceId: projectFinance.id,
        constructionSiteId: balance.constructionSiteId || '',
        type: 'expense',
        category: 'materials',
        amount: balance.purchasedValue,
        description: `Chi phí vật tư đầu kỳ đến ${balance.asOfDate}`,
        date: balance.asOfDate,
        source: 'import',
        sourceRef: `opening_balance:${balance.id || 'local'}:materials`,
        attachments: [],
        createdBy: input.actorUserId,
        createdAt: new Date().toISOString(),
      };
    }

    return {
      openingBalance: {
        ...balance,
        id: balance.id || crypto.randomUUID(),
        status: 'locked',
        lockedBy: input.actorUserId,
        lockedAt: new Date().toISOString(),
      },
      lines: linesWithItems,
      projectFinance,
      materialProjectTransaction,
      stockTransactions,
      createdItems,
    };
  },

  async voidOpeningBalance(openingBalanceId: string): Promise<void> {
    if (!isSupabaseConfigured || !openingBalanceId) return;
    const { error } = await supabase
      .from(BALANCE_TABLE)
      .update({ status: 'void', updated_at: new Date().toISOString() })
      .eq('id', openingBalanceId);
    if (error) throw error;
  },

  async parseOpeningBalanceImport(file: File): Promise<ProjectOpeningBalanceImportRow[]> {
    const rows = await parseExcelRows(file);
    return rows.map((row, index) => {
      const sku = getExcelCell(row, ['Mã vật tư', 'Ma vat tu', 'SKU', 'sku', 'Mã hàng', 'Ma hang']);
      const itemName = getExcelCell(row, ['Tên vật tư', 'Ten vat tu', 'Tên hàng', 'Ten hang', 'Item', 'itemName']);
      const unit = getExcelCell(row, ['Đơn vị', 'Don vi', 'Unit', 'unit']) || 'Cái';
      const warehouseId = getExcelCell(row, ['Kho', 'warehouseId', 'warehouse_id', 'Mã kho', 'Ma kho', 'Tên kho', 'Ten kho']);
      const purchasedQty = numberOrZero(getExcelCell(row, ['SL đã mua', 'So luong da mua', 'Purchased Qty', 'purchasedQty']));
      const issuedQty = numberOrZero(getExcelCell(row, ['SL đã xuất', 'SL đã cấp', 'So luong da xuat', 'Issued Qty', 'issuedQty']));
      const usedQty = numberOrZero(getExcelCell(row, ['SL đã sử dụng', 'So luong da su dung', 'Used Qty', 'usedQty']));
      const remainingQty = numberOrZero(getExcelCell(row, ['SL tồn hiện tại', 'Ton hien tai', 'Remaining Qty', 'remainingQty', 'Tồn kho']));
      const unitPrice = numberOrZero(getExcelCell(row, ['Đơn giá', 'Don gia', 'Unit Price', 'unitPrice']));
      const remainingValue = numberOrZero(getExcelCell(row, ['Thành tiền tồn', 'Thanh tien ton', 'Remaining Value', 'remainingValue']));
      const note = getExcelCell(row, ['Ghi chú', 'Ghi chu', 'Note', 'note']);
      const errors: string[] = [];
      if (!sku) errors.push('Thiếu mã vật tư.');
      if (!itemName) errors.push('Thiếu tên vật tư.');
      if (!warehouseId) errors.push('Thiếu kho.');
      return {
        rowNumber: index + 2,
        inventoryItemId: null,
        sku,
        itemName,
        unit,
        warehouseId,
        purchasedQty,
        issuedQty,
        usedQty,
        remainingQty,
        unitPrice,
        remainingValue: remainingValue || remainingQty * unitPrice,
        note,
        errors,
      };
    }).filter(row => row.sku || row.itemName || row.warehouseId || row.remainingQty > 0);
  },
};
