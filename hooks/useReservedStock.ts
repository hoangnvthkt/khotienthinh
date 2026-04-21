
import { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { TransactionStatus, TransactionType } from '../types';

/**
 * Reserved Stock Hook — Tính toán tồn giữ chỗ và tồn khả dụng
 *
 * Tồn giữ chỗ (Reserved): Tổng số lượng đang bị chiếm bởi các phiếu
 *   EXPORT / TRANSFER / LIQUIDATION ở trạng thái PENDING hoặc APPROVED.
 *
 * Tồn khả dụng (Available) = On-hand - Reserved
 */
export function useReservedStock() {
  const { items, transactions } = useApp();

  /**
   * Map: { `${itemId}::${warehouseId}` → reservedQty }
   * Được tính 1 lần, tái sử dụng qua các lần gọi.
   */
  const reservedMap = useMemo(() => {
    const map: Record<string, number> = {};

    transactions
      .filter(
        tx =>
          (tx.status === TransactionStatus.PENDING ||
            tx.status === TransactionStatus.APPROVED) &&
          (tx.type === TransactionType.EXPORT ||
            tx.type === TransactionType.TRANSFER ||
            tx.type === TransactionType.LIQUIDATION) &&
          tx.sourceWarehouseId
      )
      .forEach(tx => {
        tx.items.forEach(ti => {
          const key = `${ti.itemId}::${tx.sourceWarehouseId}`;
          map[key] = (map[key] || 0) + ti.quantity;
        });
      });

    return map;
  }, [transactions]);

  /**
   * Số lượng đang bị giữ chỗ của 1 item trong 1 kho
   */
  const getReservedQty = (itemId: string, warehouseId: string): number => {
    return reservedMap[`${itemId}::${warehouseId}`] || 0;
  };

  /**
   * Tồn thực tế (On-hand) từ stockByWarehouse
   */
  const getOnHandStock = (itemId: string, warehouseId: string): number => {
    const item = items.find(i => i.id === itemId);
    return item?.stockByWarehouse[warehouseId] || 0;
  };

  /**
   * Tồn khả dụng = On-hand - Reserved (không âm)
   */
  const getAvailableStock = (itemId: string, warehouseId: string): number => {
    const onHand = getOnHandStock(itemId, warehouseId);
    const reserved = getReservedQty(itemId, warehouseId);
    return Math.max(0, onHand - reserved);
  };

  /**
   * Danh sách các phiếu đang giữ chỗ của 1 item trong 1 kho
   * Dùng để hiển thị tooltip chi tiết khi hover cảnh báo
   */
  const getConflictingTxs = (itemId: string, warehouseId: string) => {
    return transactions.filter(
      tx =>
        (tx.status === TransactionStatus.PENDING ||
          tx.status === TransactionStatus.APPROVED) &&
        (tx.type === TransactionType.EXPORT ||
          tx.type === TransactionType.TRANSFER ||
          tx.type === TransactionType.LIQUIDATION) &&
        tx.sourceWarehouseId === warehouseId &&
        tx.items.some(ti => ti.itemId === itemId)
    );
  };

  /**
   * Tổng hợp cho 1 item: { onHand, reserved, available, hasConflict }
   */
  const getStockSummary = (itemId: string, warehouseId: string) => {
    const onHand = getOnHandStock(itemId, warehouseId);
    const reserved = getReservedQty(itemId, warehouseId);
    const available = Math.max(0, onHand - reserved);
    return {
      onHand,
      reserved,
      available,
      hasConflict: reserved > 0,
      isCritical: available === 0 && onHand > 0, // Bị chiếm hết
    };
  };

  return {
    getReservedQty,
    getOnHandStock,
    getAvailableStock,
    getConflictingTxs,
    getStockSummary,
  };
}
