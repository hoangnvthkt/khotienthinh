import type {
  CustomMaterialRequestLine,
  CustomMaterialTemplateKey,
} from '../types';

export const CUSTOM_MATERIAL_TEMPLATE_OPTIONS: Array<{
  key: CustomMaterialTemplateKey;
  label: string;
  workSection: string;
}> = [
  { key: 'generic', label: 'Khác / Generic', workSection: 'Khác' },
  { key: 'xa_go', label: 'Xà gồ', workSection: 'Xà gồ' },
];

export const CUSTOM_MATERIAL_TEMPLATE_LABELS: Record<CustomMaterialTemplateKey, string> = {
  generic: 'Khác / Generic',
  xa_go: 'Xà gồ',
};

export const CUSTOM_MATERIAL_PROFILE_LABELS: Record<string, string> = {
  xa_go: 'Xà gồ',
  ton_seam_lock: 'Tôn seam lock',
  ton_5_song: 'Tôn 5 sóng',
  ton_thung: 'Tôn thưng',
  phu_kien: 'Phụ kiện',
  ket_cau_thep: 'Kết cấu thép',
  other: 'Khác',
};

export const getCustomMaterialTemplateOption = (key?: string | null) =>
  CUSTOM_MATERIAL_TEMPLATE_OPTIONS.find(option => option.key === key) || CUSTOM_MATERIAL_TEMPLATE_OPTIONS[0];

export const normalizeCustomMaterialTemplateKey = (key?: string | null): CustomMaterialTemplateKey =>
  key === 'xa_go' ? 'xa_go' : 'generic';

export const isXaGoLine = (line: Partial<CustomMaterialRequestLine>) =>
  line.profileType === 'xa_go' || line.groupKey === 'xa_go' || line.specJson?.templateKey === 'xa_go';

export const roundCustomMaterialNumber = (value: number, precision = 2) => {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export const calculateXaGoWeightKg = (quantity: number, lengthMm: number, kgPerM: number) => {
  if (!Number.isFinite(quantity) || !Number.isFinite(lengthMm) || !Number.isFinite(kgPerM)) return 0;
  return roundCustomMaterialNumber(quantity * (lengthMm / 1000) * kgPerM, 2);
};

export const getSpecNumber = (spec: Record<string, unknown> | undefined, key: string) => {
  const value = Number(spec?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
};

export const formatCustomMaterialNumber = (value?: number | null, maximumFractionDigits = 2) => {
  if (value == null || !Number.isFinite(Number(value))) return '';
  return Number(value).toLocaleString('vi-VN', { maximumFractionDigits });
};

export const buildXaGoSpec = (line: Partial<CustomMaterialRequestLine>) => {
  const spec = { ...(line.specJson || {}) } as Record<string, unknown>;
  const quantity = Number(line.quantity || 0);
  const lengthMm = getSpecNumber(spec, 'length_mm');
  const kgPerM = getSpecNumber(spec, 'kg_per_m');
  const calculatedWeightKg = calculateXaGoWeightKg(quantity, lengthMm, kgPerM);
  const weightKg = getSpecNumber(spec, 'weight_kg') || calculatedWeightKg || 0;

  return {
    ...spec,
    templateKey: 'xa_go',
    chung_loai: String(spec.chung_loai || ''),
    quy_cach: String(spec.quy_cach || ''),
    length_mm: lengthMm || null,
    kg_per_m: kgPerM || null,
    weight_kg: weightKg || null,
    calculated_weight_kg: calculatedWeightKg || null,
  };
};

export const formatCustomMaterialLineSpec = (line: Partial<CustomMaterialRequestLine>) => {
  const spec = line.specJson || {};
  if (isXaGoLine(line)) {
    return [
      spec.quy_cach ? String(spec.quy_cach) : '',
      spec.chung_loai ? String(spec.chung_loai) : '',
      getSpecNumber(spec, 'length_mm') ? `Dài ${formatCustomMaterialNumber(getSpecNumber(spec, 'length_mm'), 0)} mm` : '',
      getSpecNumber(spec, 'kg_per_m') ? `${formatCustomMaterialNumber(getSpecNumber(spec, 'kg_per_m'), 3)} kg/m` : '',
      getSpecNumber(spec, 'weight_kg') ? `KL ${formatCustomMaterialNumber(getSpecNumber(spec, 'weight_kg'))} kg` : '',
    ].filter(Boolean).join(' • ');
  }

  return [
    line.effectiveWidth ? `Khổ ${formatCustomMaterialNumber(Number(line.effectiveWidth), 3)}` : '',
    line.length ? `Dài ${formatCustomMaterialNumber(Number(line.length), 3)}` : '',
    line.thickness ? `Dày ${formatCustomMaterialNumber(Number(line.thickness), 3)}` : '',
    line.color || '',
  ].filter(Boolean).join(' • ');
};
