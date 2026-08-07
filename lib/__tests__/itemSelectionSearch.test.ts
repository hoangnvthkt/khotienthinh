import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '../../types';
import { getItemSelectionResults, ITEM_SELECTION_RESULT_LIMIT } from '../itemSelectionSearch';

const item = (id: string, name: string, stock = 1): InventoryItem => ({
  id,
  sku: `VT-${id}`,
  name,
  category: 'Vật tư',
  unit: 'Cái',
  priceIn: 0,
  priceOut: 0,
  minStock: 0,
  stockByWarehouse: { wh1: stock },
});

describe('getItemSelectionResults', () => {
  it('returns the first 50 eligible matches and the complete match count', () => {
    const items = Array.from({ length: 51 }, (_, index) => item(String(index + 1), `Vật tư ${index + 1}`));

    expect(getItemSelectionResults(items, { query: '', allowAllItems: true })).toEqual({
      items: items.slice(0, ITEM_SELECTION_RESULT_LIMIT),
      totalMatches: 51,
    });
  });

  it('keeps accent-insensitive matching and excludes zero warehouse stock', () => {
    const items = [item('1', 'Xi măng', 5), item('2', 'Xi măng dự phòng', 0), item('3', 'Cát vàng', 4)];

    expect(getItemSelectionResults(items, {
      query: 'xi mang',
      filterWarehouseId: 'wh1',
      allowAllItems: false,
    })).toEqual({
      items: [items[0]],
      totalMatches: 1,
    });
  });
});
