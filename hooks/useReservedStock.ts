import { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { RequestStatus, TransactionStatus, TransactionType } from '../types';

interface ReservationOptions {
  excludeRequestId?: string;
  excludeTransactionId?: string;
}

interface ReservationEntry {
  itemId: string;
  warehouseId: string;
  quantity: number;
  level: 'soft' | 'hard';
  sourceType: 'transaction' | 'request';
  sourceId: string;
}

export function useReservedStock() {
  const { items, transactions, requests } = useApp();

  const reservations = useMemo<ReservationEntry[]>(() => {
    const entries: ReservationEntry[] = [];

    transactions
      .filter(
        tx =>
          (tx.status === TransactionStatus.PENDING || tx.status === TransactionStatus.APPROVED) &&
          (tx.type === TransactionType.EXPORT ||
            tx.type === TransactionType.TRANSFER ||
            tx.type === TransactionType.LIQUIDATION) &&
          tx.sourceWarehouseId
      )
      .forEach(tx => {
        tx.items.forEach(ti => {
          entries.push({
            itemId: ti.itemId,
            warehouseId: tx.sourceWarehouseId!,
            quantity: Number(ti.quantity) || 0,
            level: 'hard',
            sourceType: 'transaction',
            sourceId: tx.id,
          });
        });
      });

    requests
      .filter(req =>
        !!req.sourceWarehouseId &&
        (req.status === RequestStatus.PENDING ||
          req.status === RequestStatus.APPROVED ||
          req.status === RequestStatus.IN_TRANSIT)
      )
      .forEach(req => {
        const isProjectFulfillmentRequest = req.requestOrigin === 'project' || !!req.projectId || !!req.constructionSiteId;
        if (isProjectFulfillmentRequest && req.status !== RequestStatus.PENDING) {
          return;
        }
        const level: 'soft' | 'hard' = req.status === RequestStatus.PENDING ? 'soft' : 'hard';
        req.items.forEach(ri => {
          const quantity = level === 'soft' ? ri.requestQty : ri.approvedQty;
          if (!quantity || quantity <= 0) return;
          entries.push({
            itemId: ri.itemId,
            warehouseId: req.sourceWarehouseId!,
            quantity: Number(quantity) || 0,
            level,
            sourceType: 'request',
            sourceId: req.id,
          });
        });
      });

    return entries;
  }, [transactions, requests]);

  const getEntries = (itemId: string, warehouseId: string, options: ReservationOptions = {}) => {
    return reservations.filter(entry => {
      if (entry.itemId !== itemId || entry.warehouseId !== warehouseId) return false;
      if (options.excludeRequestId && entry.sourceType === 'request' && entry.sourceId === options.excludeRequestId) return false;
      if (options.excludeTransactionId && entry.sourceType === 'transaction' && entry.sourceId === options.excludeTransactionId) return false;
      return true;
    });
  };

  const getReservedQty = (itemId: string, warehouseId: string, options?: ReservationOptions): number => {
    return getEntries(itemId, warehouseId, options).reduce((sum, entry) => sum + entry.quantity, 0);
  };

  const getOnHandStock = (itemId: string, warehouseId: string): number => {
    const item = items.find(i => i.id === itemId);
    return item?.stockByWarehouse[warehouseId] || 0;
  };

  const getAvailableStock = (itemId: string, warehouseId: string, options?: ReservationOptions): number => {
    const onHand = getOnHandStock(itemId, warehouseId);
    const reserved = getReservedQty(itemId, warehouseId, options);
    return Math.max(0, onHand - reserved);
  };

  const getConflictingTxs = (itemId: string, warehouseId: string) => {
    return transactions.filter(
      tx =>
        (tx.status === TransactionStatus.PENDING || tx.status === TransactionStatus.APPROVED) &&
        (tx.type === TransactionType.EXPORT ||
          tx.type === TransactionType.TRANSFER ||
          tx.type === TransactionType.LIQUIDATION) &&
        tx.sourceWarehouseId === warehouseId &&
        tx.items.some(ti => ti.itemId === itemId)
    );
  };

  const getReservationDetails = (itemId: string, warehouseId: string, options?: ReservationOptions) => {
    return getEntries(itemId, warehouseId, options);
  };

  const getStockSummary = (itemId: string, warehouseId: string, options?: ReservationOptions) => {
    const onHand = getOnHandStock(itemId, warehouseId);
    const entries = getEntries(itemId, warehouseId, options);
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
    };
  };

  return {
    getReservedQty,
    getOnHandStock,
    getAvailableStock,
    getConflictingTxs,
    getReservationDetails,
    getStockSummary,
  };
}
