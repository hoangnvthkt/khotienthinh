import { describe, expect, it } from 'vitest';
import { isOverBoq, mapMaterialPlanError, materialBoqUsage } from '../projectMaterialPlanService';

describe('material plan BOQ usage', () => {
  it('is unknown without a BOQ quantity', () => {
    expect(materialBoqUsage({ boqQty: null, issuedQty: 0, requestedQty: 5 })).toBeNull();
    expect(isOverBoq({ boqQty: null, issuedQty: 0, requestedQty: 5 })).toBe(false);
  });
  it('counts issued plus requested against BOQ, tolerating 3-decimal rounding', () => {
    const line = { boqQty: 22616.254887, issuedQty: 0, requestedQty: 22616.255 };
    expect(isOverBoq(line)).toBe(false);
    expect(isOverBoq({ ...line, requestedQty: 22700 })).toBe(true);
    expect(materialBoqUsage({ boqQty: 100, issuedQty: 50, requestedQty: 30 })).toBe(80);
  });
  it('lists the over-BOQ materials missing a reason', () => {
    expect(mapMaterialPlanError({ message: 'MATERIAL_PLAN_OVER_BOQ_REASON_REQUIRED', details: 'Sika màu xám' }).message).toContain('(Sika màu xám)');
  });
});
