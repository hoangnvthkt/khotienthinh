// ═══════════════════════════════════════════════════════════════
//  PO Specs Utils — Dynamic Technical Specifications & Pricing
//  Handles area/length/weight/volume-based pricing for PO items
// ═══════════════════════════════════════════════════════════════

import type { PurchaseOrderItem } from '../types';

// ─── Types ───────────────────────────────────────────────────

export interface SpecValue {
  value: number | string;
  unit?: string;   // mm, m, kg, m², m³ ...
  label?: string;  // "Chiều rộng", "Độ dày"
}

export type PricingMode = 'standard' | 'by_area' | 'by_length' | 'by_weight' | 'by_volume';

export interface SpecFieldDef {
  key: string;
  label: string;
  unit: string;
  type: 'number' | 'text';
}

export interface SpecPreset {
  label: string;
  pricingMode: PricingMode;
  fields: SpecFieldDef[];
  priceUnit?: string; // "đ/m²", "đ/m", "đ/kg"
}

export const DEFAULT_SPEC_METADATA: Record<string, { label: string; unit: string }> = {
  width: { label: 'Rộng', unit: 'mm' },
  height: { label: 'Cao', unit: 'mm' },
  length: { label: 'Dài', unit: 'mm' },
  thickness: { label: 'Độ dày', unit: 'mm' },
  weight: { label: 'Trọng lượng', unit: 'kg' },
  diameter: { label: 'Đường kính', unit: 'mm' },
  material: { label: 'Chất liệu', unit: '' },
  color: { label: 'Màu sắc', unit: '' },
  filling: { label: 'Lõi', unit: '' },
  type: { label: 'Chủng loại', unit: '' },
  model: { label: 'Model', unit: '' },
  power: { label: 'Công suất', unit: 'kW' },
};

export const SPEC_KEY_ORDER = ['length', 'width', 'height', 'thickness', 'diameter', 'weight', 'power', 'material', 'color', 'filling', 'type', 'model'];

// ─── Presets ─────────────────────────────────────────────────

export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  standard:  'Tiêu chuẩn (SL × Đơn giá)',
  by_area:   'Theo diện tích (DT × SL × Đơn giá/m²)',
  by_length: 'Theo chiều dài (Dài × SL × Đơn giá/m)',
  by_weight: 'Theo trọng lượng (TL × SL × Đơn giá/kg)',
  by_volume: 'Theo thể tích (V × SL × Đơn giá/m³)',
};

export const PRICING_MODE_PRICE_UNITS: Record<PricingMode, string> = {
  standard:  'đ',
  by_area:   'đ/m²',
  by_length: 'đ/m',
  by_weight: 'đ/kg',
  by_volume: 'đ/m³',
};

export const SPEC_PRESETS: Record<string, SpecPreset> = {
  cua_thep: {
    label: 'Cửa thép',
    pricingMode: 'by_area',
    priceUnit: 'đ/m²',
    fields: [
      { key: 'width',     label: 'Rộng',      unit: 'mm', type: 'number' },
      { key: 'height',    label: 'Cao',        unit: 'mm', type: 'number' },
      { key: 'thickness', label: 'Độ dày',     unit: 'mm', type: 'number' },
      { key: 'material',  label: 'Chất liệu',  unit: '',   type: 'text' },
      { key: 'color',     label: 'Màu sắc',    unit: '',   type: 'text' },
      { key: 'filling',   label: 'Lõi',         unit: '',   type: 'text' },
    ],
  },
  kinh: {
    label: 'Kính',
    pricingMode: 'by_area',
    priceUnit: 'đ/m²',
    fields: [
      { key: 'width',     label: 'Rộng',      unit: 'mm', type: 'number' },
      { key: 'height',    label: 'Cao',        unit: 'mm', type: 'number' },
      { key: 'thickness', label: 'Độ dày',     unit: 'mm', type: 'number' },
      { key: 'type',      label: 'Chủng loại', unit: '',   type: 'text' },
    ],
  },
  panel: {
    label: 'Panel',
    pricingMode: 'by_area',
    priceUnit: 'đ/m²',
    fields: [
      { key: 'width',     label: 'Rộng',      unit: 'mm', type: 'number' },
      { key: 'height',    label: 'Cao',        unit: 'mm', type: 'number' },
      { key: 'thickness', label: 'Độ dày',     unit: 'mm', type: 'number' },
      { key: 'type',      label: 'Chủng loại', unit: '',   type: 'text' },
    ],
  },
  ton: {
    label: 'Tôn',
    pricingMode: 'by_length',
    priceUnit: 'đ/m',
    fields: [
      { key: 'length',    label: 'Dài',       unit: 'mm', type: 'number' },
      { key: 'width',     label: 'Rộng',      unit: 'mm', type: 'number' },
      { key: 'thickness', label: 'Độ dày',     unit: 'mm', type: 'number' },
      { key: 'color',     label: 'Màu sắc',    unit: '',   type: 'text' },
    ],
  },
  ket_cau_thep: {
    label: 'Kết cấu thép',
    pricingMode: 'by_weight',
    priceUnit: 'đ/kg',
    fields: [
      { key: 'weight',    label: 'Trọng lượng', unit: 'kg', type: 'number' },
      { key: 'length',    label: 'Dài',         unit: 'mm', type: 'number' },
      { key: 'type',      label: 'Chủng loại',   unit: '',   type: 'text' },
    ],
  },
  ong_gio: {
    label: 'Ống gió',
    pricingMode: 'by_length',
    priceUnit: 'đ/m',
    fields: [
      { key: 'diameter',  label: 'Đường kính', unit: 'mm', type: 'number' },
      { key: 'length',    label: 'Dài',        unit: 'mm', type: 'number' },
      { key: 'thickness', label: 'Độ dày',      unit: 'mm', type: 'number' },
    ],
  },
  thiet_bi_mep: {
    label: 'Thiết bị MEP',
    pricingMode: 'standard',
    priceUnit: 'đ',
    fields: [
      { key: 'model',  label: 'Model',       unit: '',   type: 'text' },
      { key: 'power',  label: 'Công suất',   unit: 'kW', type: 'number' },
      { key: 'weight', label: 'Trọng lượng', unit: 'kg', type: 'number' },
    ],
  },
  custom: {
    label: 'Tùy chỉnh',
    pricingMode: 'standard',
    fields: [],
  },
};

// ─── Helpers ─────────────────────────────────────────────────

/** Get numeric value from specs by key, returns 0 if not found */
export function getSpecNumeric(specs: Record<string, SpecValue> | undefined, key: string): number {
  if (!specs || !specs[key]) return 0;
  return Number(specs[key].value) || 0;
}

/** Calculate area in m² from width × height (both in mm) */
export function calculateArea(specs?: Record<string, SpecValue>): number {
  if (!specs) return 0;
  const w = getSpecNumeric(specs, 'width') / 1000;  // mm → m
  const h = getSpecNumeric(specs, 'height') / 1000;
  if (w <= 0 || h <= 0) return 0;
  return Math.round(w * h * 10000) / 10000; // 4 decimals for precision
}

/** Calculate volume in m³ from width × height × length (all in mm) */
export function calculateVolume(specs?: Record<string, SpecValue>): number {
  if (!specs) return 0;
  const w = getSpecNumeric(specs, 'width') / 1000;
  const h = getSpecNumeric(specs, 'height') / 1000;
  const l = getSpecNumeric(specs, 'length') / 1000;
  if (w <= 0 || h <= 0 || l <= 0) return 0;
  return Math.round(w * h * l * 10000) / 10000;
}

/** Get length in meters from specs.length (mm) */
export function getLengthMeters(specs?: Record<string, SpecValue>): number {
  if (!specs) return 0;
  const l = getSpecNumeric(specs, 'length');
  return l > 0 ? l / 1000 : 0;
}

// ─── Line Total Calculation ──────────────────────────────────

/** Calculate the line total for a PO item based on its pricingMode */
export function calculateLineTotal(item: PurchaseOrderItem): number {
  const qty = Number(item.qty) || 0;
  const unitPrice = Number(item.unitPrice) || 0;
  const mode: PricingMode = (item as any).pricingMode || 'standard';
  const specs = (item as any).specs as Record<string, SpecValue> | undefined;

  if (qty <= 0 || unitPrice <= 0) return 0;

  switch (mode) {
    case 'by_area': {
      const area = Number((item as any).computedArea) || calculateArea(specs);
      if (area <= 0) return qty * unitPrice; // fallback
      return Math.round(area * qty * unitPrice);
    }
    case 'by_length': {
      const lengthM = getLengthMeters(specs);
      if (lengthM <= 0) return qty * unitPrice;
      return Math.round(lengthM * qty * unitPrice);
    }
    case 'by_weight': {
      const weight = Number((item as any).computedWeight) || getSpecNumeric(specs, 'weight');
      if (weight <= 0) return qty * unitPrice;
      return Math.round(weight * qty * unitPrice);
    }
    case 'by_volume': {
      const vol = calculateVolume(specs);
      if (vol <= 0) return qty * unitPrice;
      return Math.round(vol * qty * unitPrice);
    }
    default:
      return Math.round(qty * unitPrice);
  }
}

/** Get the computed dimension value for display (area/length/weight/volume) */
export function getComputedDimension(item: PurchaseOrderItem): { value: number; unit: string; formula: string } | null {
  const mode: PricingMode = (item as any).pricingMode || 'standard';
  const specs = (item as any).specs as Record<string, SpecValue> | undefined;

  switch (mode) {
    case 'by_area': {
      const area = Number((item as any).computedArea) || calculateArea(specs);
      if (area <= 0) return null;
      const w = getSpecNumeric(specs, 'width');
      const h = getSpecNumeric(specs, 'height');
      return { value: area, unit: 'm²', formula: w && h ? `${w}×${h}mm` : '' };
    }
    case 'by_length': {
      const lengthM = getLengthMeters(specs);
      if (lengthM <= 0) return null;
      return { value: lengthM, unit: 'm', formula: `${getSpecNumeric(specs, 'length')}mm` };
    }
    case 'by_weight': {
      const weight = Number((item as any).computedWeight) || getSpecNumeric(specs, 'weight');
      if (weight <= 0) return null;
      return { value: weight, unit: 'kg', formula: '' };
    }
    case 'by_volume': {
      const vol = calculateVolume(specs);
      if (vol <= 0) return null;
      return { value: vol, unit: 'm³', formula: '' };
    }
    default:
      return null;
  }
}

/** Format specs as a short summary string for badges */
export function formatSpecsSummary(item: PurchaseOrderItem): string[] {
  const specs = (item as any).specs as Record<string, SpecValue> | undefined;
  if (!specs || Object.keys(specs).length === 0) return [];

  const badges: string[] = [];
  const w = getSpecNumeric(specs, 'width');
  const h = getSpecNumeric(specs, 'height');
  const l = getSpecNumeric(specs, 'length');

  // Dimension badge
  if (w && h) {
    const area = calculateArea(specs);
    badges.push(`${w}×${h}mm = ${area}m²`);
  } else if (l) {
    badges.push(`Dài ${l}mm`);
  }

  // Weight badge
  const weight = getSpecNumeric(specs, 'weight');
  if (weight) badges.push(`${weight}kg`);

  // Thickness badge
  const thickness = getSpecNumeric(specs, 'thickness');
  if (thickness) badges.push(`Dày ${thickness}mm`);

  // Text specs (material, color, type)
  for (const key of ['material', 'color', 'type', 'filling', 'model']) {
    const val = specs[key];
    if (val && typeof val.value === 'string' && val.value.trim()) {
      badges.push(val.value.trim());
    }
  }

  return badges;
}

/** Format pricing formula for display */
export function formatPricingFormula(item: PurchaseOrderItem): string {
  const mode: PricingMode = (item as any).pricingMode || 'standard';
  const qty = Number(item.qty) || 0;
  const unitPrice = Number(item.unitPrice) || 0;
  const dim = getComputedDimension(item);
  const fmt = (n: number) => n.toLocaleString('vi-VN');

  if (!dim || mode === 'standard') {
    return `${fmt(qty)} × ${fmt(unitPrice)}`;
  }

  return `${dim.value} ${dim.unit} × ${fmt(qty)} × ${fmt(unitPrice)}`;
}
