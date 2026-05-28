import { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  buildStockReservations,
  filterStockReservationEntries,
  getStockSummaryFromReservationEntries,
  StockReservationOptions,
} from '../lib/inventoryStockGuard';

export function useReservedStock() {
  const { items, transactions, requests } = useApp();

  const reservations = useMemo(() => buildStockReservations(transactions, requests), [transactions, requests]);

  const getEntries = (itemId: string, warehouseId: string, options: StockReservationOptions = {}) => {
    return filterStockReservationEntries(reservations, itemId, warehouseId, options);
  };

  const getReservedQty = (itemId: string, warehouseId: string, options?: StockReservationOptions): number => {
    return getEntries(itemId, warehouseId, options).reduce((sum, entry) => sum + entry.quantity, 0);
  };

  const getOnHandStock = (itemId: string, warehouseId: string): number => {
    const item = items.find(i => i.id === itemId);
    return item?.stockByWarehouse[warehouseId] || 0;
  };

  const getAvailableStock = (itemId: string, warehouseId: string, options?: StockReservationOptions): number => {
    const onHand = getOnHandStock(itemId, warehouseId);
    const reserved = getReservedQty(itemId, warehouseId, options);
    return Math.max(0, onHand - reserved);
  };

  const getConflictingTxs = (itemId: string, warehouseId: string) => {
    const txIds = new Set(reservations
      .filter(entry => entry.sourceType === 'transaction' && entry.itemId === itemId && entry.warehouseId === warehouseId)
      .map(entry => entry.sourceId));
    return transactions.filter(tx => txIds.has(tx.id));
  };

  const getReservationDetails = (itemId: string, warehouseId: string, options?: StockReservationOptions) => {
    return getEntries(itemId, warehouseId, options);
  };

  const getStockSummary = (itemId: string, warehouseId: string, options?: StockReservationOptions) => {
    return getStockSummaryFromReservationEntries(items, getEntries(itemId, warehouseId, options), itemId, warehouseId);
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
