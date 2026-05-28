import {
  InventoryItem,
  MaterialRequest,
  RequestItem,
  RequestStatus,
  Transaction,
  TransactionItem,
  TransactionStatus,
  TransactionType,
  Warehouse,
} from '../types';

export interface StockReservationOptions {
  excludeRequestId?: string;
  excludeTransactionId?: string;
}

export interface StockReservationEntry {
  itemId: string;
  warehouseId: string;
  quantity: number;
  level: 'soft' | 'hard';
  sourceType: 'transaction' | 'request';
  sourceId: string;
  sourceCode?: string;
  sourceStatus?: string;
}

export interface StockSummary {
  onHand: number;
  softReserved: number;
  hardReserved: number;
  reserved: number;
  available: number;
  hasConflict: boolean;
  isCritical: boolean;
  entries: StockReservationEntry[];
}

export interface StockDecreaseLine {
  itemId: string;
  quantity: number;
  warehouseId?: string;
  lineName?: string;
}

export interface StockDecreaseIssue {
  itemId: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  requestedQty: number;
  onHand: number;
  softReserved: number;
  hardReserved: number;
  reserved: number;
  available: number;
  missingOnHand: number;
  missingAvailable: number;
  blockers: StockReservationEntry[];
}

const toQty = (value: unknown): number => {
  const qty = Number(value || 0);
  return Number.isFinite(qty) ? qty : 0;
};

const isStockOutTransaction = (tx: Transaction): boolean =>
  tx.type === TransactionType.EXPORT ||
  tx.type === TransactionType.TRANSFER ||
  tx.type === TransactionType.LIQUIDATION;

const isReservableTransaction = (tx: Transaction): boolean =>
  (tx.status === TransactionStatus.PENDING || tx.status === TransactionStatus.APPROVED) &&
  isStockOutTransaction(tx) &&
  !!tx.sourceWarehouseId;

const getRequestLineReservationQty = (line: RequestItem, level: 'soft' | 'hard'): number =>
  level === 'soft' ? toQty(line.requestQty) : toQty(line.approvedQty);

export const buildStockReservations = (
  transactions: Transaction[],
  requests: MaterialRequest[],
): StockReservationEntry[] => {
  const entries: StockReservationEntry[] = [];

  transactions
    .filter(isReservableTransaction)
    .forEach(tx => {
      tx.items.forEach((line: TransactionItem) => {
        const quantity = toQty(line.quantity);
        if (quantity <= 0) return;
        entries.push({
          itemId: line.itemId,
          warehouseId: tx.sourceWarehouseId!,
          quantity,
          level: 'hard',
          sourceType: 'transaction',
          sourceId: tx.id,
          sourceCode: tx.code || tx.id.slice(-6),
          sourceStatus: tx.status,
        });
      });
    });

  requests
    .filter(req =>
      !!req.sourceWarehouseId &&
      (
        req.status === RequestStatus.PENDING ||
        req.status === RequestStatus.APPROVED ||
        req.status === RequestStatus.IN_TRANSIT
      )
    )
    .forEach(req => {
      const isProjectFulfillmentRequest = req.requestOrigin === 'project' || !!req.projectId || !!req.constructionSiteId;
      if (isProjectFulfillmentRequest && req.status !== RequestStatus.PENDING) return;

      const level: 'soft' | 'hard' = req.status === RequestStatus.PENDING ? 'soft' : 'hard';
      req.items.forEach(line => {
        const quantity = getRequestLineReservationQty(line, level);
        if (quantity <= 0) return;
        entries.push({
          itemId: line.itemId,
          warehouseId: req.sourceWarehouseId!,
          quantity,
          level,
          sourceType: 'request',
          sourceId: req.id,
          sourceCode: req.code,
          sourceStatus: req.status,
        });
      });
    });

  return entries;
};

export const getStockReservationEntries = (
  transactions: Transaction[],
  requests: MaterialRequest[],
  itemId: string,
  warehouseId: string,
  options: StockReservationOptions = {},
): StockReservationEntry[] => {
  return filterStockReservationEntries(buildStockReservations(transactions, requests), itemId, warehouseId, options);
};

export const filterStockReservationEntries = (
  entries: StockReservationEntry[],
  itemId: string,
  warehouseId: string,
  options: StockReservationOptions = {},
): StockReservationEntry[] => {
  return entries.filter(entry => {
    if (entry.itemId !== itemId || entry.warehouseId !== warehouseId) return false;
    if (options.excludeRequestId && entry.sourceType === 'request' && entry.sourceId === options.excludeRequestId) return false;
    if (options.excludeTransactionId && entry.sourceType === 'transaction' && entry.sourceId === options.excludeTransactionId) return false;
    return true;
  });
};

export const getStockSummary = (
  items: InventoryItem[],
  transactions: Transaction[],
  requests: MaterialRequest[],
  itemId: string,
  warehouseId: string,
  options: StockReservationOptions = {},
): StockSummary => {
  const entries = getStockReservationEntries(transactions, requests, itemId, warehouseId, options);
  return getStockSummaryFromReservationEntries(items, entries, itemId, warehouseId);
};

export const getStockSummaryFromReservationEntries = (
  items: InventoryItem[],
  entries: StockReservationEntry[],
  itemId: string,
  warehouseId: string,
): StockSummary => {
  const item = items.find(i => i.id === itemId);
  const onHand = toQty(item?.stockByWarehouse?.[warehouseId]);
  const softReserved = entries.filter(entry => entry.level === 'soft').reduce((sum, entry) => sum + entry.quantity, 0);
  const hardReserved = entries.filter(entry => entry.level === 'hard').reduce((sum, entry) => sum + entry.quantity, 0);
  const reserved = softReserved + hardReserved;
  const available = Math.max(0, onHand - reserved);
  return {
    onHand,
    softReserved,
    hardReserved,
    reserved,
    available,
    hasConflict: reserved > 0,
    isCritical: available === 0 && onHand > 0,
    entries,
  };
};

export const getStockDecreaseLinesForTransaction = (tx: Transaction): StockDecreaseLine[] => {
  const warehouseId =
    tx.type === TransactionType.ADJUSTMENT
      ? tx.targetWarehouseId
      : tx.sourceWarehouseId;

  if (!warehouseId) return [];

  if (tx.type === TransactionType.EXPORT || tx.type === TransactionType.TRANSFER || tx.type === TransactionType.LIQUIDATION) {
    return tx.items
      .map(line => ({ itemId: line.itemId, quantity: toQty(line.quantity), warehouseId }))
      .filter(line => line.quantity > 0);
  }

  if (tx.type === TransactionType.ADJUSTMENT) {
    return tx.items
      .map(line => ({ itemId: line.itemId, quantity: Math.abs(Math.min(0, toQty(line.quantity))), warehouseId }))
      .filter(line => line.quantity > 0);
  }

  return [];
};

export const getStockDecreaseIssues = ({
  items,
  warehouses,
  transactions,
  requests,
  lines,
  defaultWarehouseId,
  options,
}: {
  items: InventoryItem[];
  warehouses: Warehouse[];
  transactions: Transaction[];
  requests: MaterialRequest[];
  lines: StockDecreaseLine[];
  defaultWarehouseId?: string;
  options?: StockReservationOptions;
}): StockDecreaseIssue[] => {
  const grouped = new Map<string, StockDecreaseLine>();
  lines.forEach(line => {
    const warehouseId = line.warehouseId || defaultWarehouseId;
    const quantity = toQty(line.quantity);
    if (!line.itemId || !warehouseId || quantity <= 0) return;
    const key = `${warehouseId}::${line.itemId}`;
    const current = grouped.get(key);
    grouped.set(key, {
      itemId: line.itemId,
      warehouseId,
      lineName: current?.lineName || line.lineName,
      quantity: (current?.quantity || 0) + quantity,
    });
  });

  return Array.from(grouped.values()).flatMap(line => {
    const warehouseId = line.warehouseId || defaultWarehouseId;
    if (!warehouseId) return [];
    const summary = getStockSummary(items, transactions, requests, line.itemId, warehouseId, options);
    if (line.quantity <= summary.available) return [];

    const item = items.find(inv => inv.id === line.itemId);
    const warehouse = warehouses.find(wh => wh.id === warehouseId);
    return [{
      itemId: line.itemId,
      itemName: line.lineName || item?.name || line.itemId,
      warehouseId,
      warehouseName: warehouse?.name || warehouseId,
      requestedQty: line.quantity,
      onHand: summary.onHand,
      softReserved: summary.softReserved,
      hardReserved: summary.hardReserved,
      reserved: summary.reserved,
      available: summary.available,
      missingOnHand: Math.max(0, line.quantity - summary.onHand),
      missingAvailable: Math.max(0, line.quantity - summary.available),
      blockers: summary.entries,
    }];
  });
};

const formatSource = (entry: StockReservationEntry): string => {
  const code = entry.sourceCode || entry.sourceId.slice(-6);
  const status = entry.sourceStatus ? `/${entry.sourceStatus}` : '';
  const label = entry.sourceType === 'transaction' ? 'phiếu kho' : 'phiếu yêu cầu';
  return `${label} ${code}${status}: ${entry.quantity}`;
};

export const formatReservationSourceList = (entries: StockReservationEntry[], limit = 3): string => {
  if (entries.length === 0) return '';
  return `${entries.slice(0, limit).map(formatSource).join('; ')}${entries.length > limit ? `; +${entries.length - limit} phiếu khác` : ''}`;
};

export const formatStockDecreaseIssues = (
  issues: StockDecreaseIssue[],
  actionLabel = 'xuất/trả kho',
): string => {
  if (issues.length === 0) return '';
  return issues.map(issue => {
    const blockerText = issue.blockers.length > 0
      ? ` Vị trí đang giữ chỗ: ${formatReservationSourceList(issue.blockers)}.`
      : '';
    const reason = issue.missingOnHand > 0
      ? `tồn thực thiếu ${issue.missingOnHand}`
      : `tồn khả dụng thiếu ${issue.missingAvailable}`;
    return `Kho "${issue.warehouseName}" - "${issue.itemName}": cần ${actionLabel} ${issue.requestedQty}, tồn thực ${issue.onHand}, đang giữ ${issue.reserved} (chờ duyệt ${issue.softReserved}, đã giữ ${issue.hardReserved}), khả dụng ${issue.available}; ${reason}.${blockerText}`;
  }).join('\n');
};
