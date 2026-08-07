import type { InventoryItem } from '../types';
import { matchesSearchQueryMultiple } from './searchUtils';

export const ITEM_SELECTION_RESULT_LIMIT = 50;

interface ItemSelectionSearchOptions {
  query: string;
  filterWarehouseId?: string;
  allowAllItems: boolean;
}

export function getItemSelectionResults(
  items: InventoryItem[],
  options: ItemSelectionSearchOptions,
): { items: InventoryItem[]; totalMatches: number } {
  const matches = items.filter(item => {
    const matchesSearch = matchesSearchQueryMultiple([item.name, item.sku], options.query);

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
