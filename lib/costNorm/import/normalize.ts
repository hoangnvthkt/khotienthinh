import { CostNormResourceType } from './types';

export const stripVietnameseAccents = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');

export const normalizeHeaderText = (value: unknown): string =>
  stripVietnameseAccents(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const normalizeSearchText = (value: unknown): string =>
  stripVietnameseAccents(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const cleanG8Name = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/^[-–—•]+/u, '')
    .trim()
    .replace(/\s+/g, ' ');

export const parseVietnameseNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const compact = raw.replace(/\s|\u00a0/g, '');
  const numeric = compact.match(/^-?\d+(?:[.,]\d{3})*(?:[,.]\d+)?|-?\d+(?:[,.]\d+)?/);
  if (!numeric) return null;
  const text = numeric[0];
  const commaIndex = text.lastIndexOf(',');
  const dotIndex = text.lastIndexOf('.');
  let normalized = text;

  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (commaIndex >= 0) {
    normalized = text.replace(/\./g, '').replace(',', '.');
  } else if (/\.\d{3}(?:\.|$)/.test(text)) {
    normalized = text.replace(/\./g, '');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildSearchText = (...parts: unknown[]): string =>
  normalizeSearchText(parts.filter(part => String(part ?? '').trim()).join(' '));

export const resourceTypeLabel = (type: CostNormResourceType): string => {
  if (type === 'material') return 'Vật liệu';
  if (type === 'labor') return 'Nhân công';
  if (type === 'machine') return 'Máy thi công';
  if (type === 'adjustment') return 'Điều chỉnh';
  return 'Khác';
};
