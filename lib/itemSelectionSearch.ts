import type { InventoryItem } from '../types';
import { matchesSearchQueryMultiple } from './searchUtils';

export const ITEM_SELECTION_RESULT_LIMIT = 50;

interface ItemSelectionSearchOptions {
  query: string;
  filterWarehouseId?: string;
  allowAllItems: boolean;
  /** V1-3a: tên / mã cũ đã gộp vào mã này — gõ mã cũ vẫn ra mã giữ. */
  aliases?: Record<string, string[]>;
}

export function getItemSelectionResults(
  items: InventoryItem[],
  options: ItemSelectionSearchOptions,
): { items: InventoryItem[]; totalMatches: number } {
  const matches = items.filter(item => {
    const matchesSearch = matchesSearchQueryMultiple([item.name, item.sku, ...(options.aliases?.[item.id] || [])], options.query);

    if (options.allowAllItems) return matchesSearch;
    if (options.filterWarehouseId) {
      return matchesSearch && (item.stockByWarehouse[options.filterWarehouseId] || 0) > 0;
    }

    return matchesSearch;
  });

  return {
    items: matches.slice(0, ITEM_SELECTION_RESULT_LIMIT),
    totalMatches: matches.length,
  };
}
