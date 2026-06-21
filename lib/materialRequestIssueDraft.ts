import { MaterialRequestFulfillmentSourceType } from '../types';

export const getMaterialIssueDraftQty = (
  sourceType: MaterialRequestFulfillmentSourceType,
  remainingQty: number,
  onHandQty: number,
) => Math.max(0, Number(sourceType === 'stock' ? onHandQty : remainingQty) || 0);
