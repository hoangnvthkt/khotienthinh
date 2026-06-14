import { normalizeHeaderText } from './normalize';
import { CostNormResourceType } from './types';

const GROUP_PATTERNS: Array<{ type: CostNormResourceType; patterns: string[] }> = [
  { type: 'material', patterns: ['vat_lieu', 'v_l', 'vl'] },
  { type: 'labor', patterns: ['nhan_cong', 'n_c', 'nc'] },
  { type: 'machine', patterns: ['may_thi_cong', 'may_moc', 'may'] },
];

export const isWorkItemCode = (value: unknown): boolean => {
  const text = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{1,4}\.\d{2,}(?:[A-Z0-9_.-]*)?$/.test(text);
};

export const isResourceCode = (value: unknown): boolean => {
  const text = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{1,4}\d{3,}(?:\.\d+)?(?:_[A-Z0-9]+)?$/.test(text);
};

export const detectResourceTypeFromCode = (value: unknown): CostNormResourceType | null => {
  const text = String(value ?? '').trim().toUpperCase();
  if (!text) return null;
  if (/^(V|VL|VT)/.test(text)) return 'material';
  if (/^(N|NC)/.test(text)) return 'labor';
  if (text.startsWith('M')) return 'machine';
  return null;
};

export const detectGroupType = (value: unknown): CostNormResourceType | null => {
  const normalized = normalizeHeaderText(value);
  if (!normalized) return null;
  for (const group of GROUP_PATTERNS) {
    if (group.patterns.some(pattern => normalized === pattern || normalized.includes(pattern))) {
      return group.type;
    }
  }
  return null;
};

export const isLikelyUnit = (value: unknown): boolean => {
  const normalized = normalizeHeaderText(value);
  return /^(m|m2|m3|m_2|m_3|kg|g|tan|t|cai|bo|cong|ca|lit|l|%)$/.test(normalized);
};

export const isHeaderNoise = (value: unknown): boolean => {
  const normalized = normalizeHeaderText(value);
  return [
    'stt',
    'ma',
    'ma_hieu',
    'ma_hieu_don_gia',
    'ten_cong_tac',
    'thanh_phan_hao_phi',
    'don_vi',
    'dinh_muc',
    'ghi_chu',
  ].includes(normalized);
};
