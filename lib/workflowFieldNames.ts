import type { WorkflowCustomField } from '../types';

const slug = (label: string) =>
  label.trim().toLowerCase().replace(/[^a-z0-9À-ɏḀ-ỿ]/g, '_').replace(/_+/g, '_') || 'truong';

/** Mã lưu dữ liệu của trường mới: sinh từ nhãn, thêm _2, _3… nếu đã có trường cùng mã (hai trường trùng mã ghi đè dữ liệu của nhau). */
export const buildWorkflowFieldName = (label: string, existing: Array<Pick<WorkflowCustomField, 'name'>>): string => {
  const taken = new Set(existing.map(field => field.name));
  const base = slug(label);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
};

/** Nhãn của các trường đang dùng chung mã với trường khác. */
export const findDuplicateWorkflowFieldLabels = (fields: Array<Pick<WorkflowCustomField, 'name' | 'label'>>): string[] => {
  const byName = new Map<string, string[]>();
  fields.forEach(field => byName.set(field.name, [...(byName.get(field.name) || []), field.label]));
  return Array.from(byName.values()).filter(labels => labels.length > 1).flat();
};
