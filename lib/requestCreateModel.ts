export interface RequestCreateField {
  key: string;
  label: string;
  required: boolean;
}

export interface RequestCreateApprovalBlock {
  key: string;
  name: string;
  source: string;
  minimumDynamicApprovers: number | null;
}

export const normalizeDynamicApprovers = (
  selections: Record<string, string[]>,
  approvalBlocks: RequestCreateApprovalBlock[],
): Record<string, string[]> => Object.fromEntries(
  approvalBlocks
    .filter(block => block.source === 'DYNAMIC_CREATOR_SELECT')
    .map(block => [
      block.key,
      [...new Set((selections[block.key] ?? []).map(userId => userId.trim()).filter(Boolean))],
    ]),
);

export const validateRequestSubmission = ({
  title,
  formData,
  fields,
  dynamicApproversByBlock,
  approvalBlocks,
  creatorUserId,
}: {
  title: string;
  formData: Record<string, unknown>;
  fields: RequestCreateField[];
  dynamicApproversByBlock: Record<string, string[]>;
  approvalBlocks: RequestCreateApprovalBlock[];
  creatorUserId?: string;
}): string[] => {
  const errors: string[] = [];
  if (!title.trim()) errors.push('Tiêu đề đề xuất là bắt buộc.');

  for (const field of fields) {
    const value = formData[field.key];
    const isEmpty = value === null
      || value === undefined
      || (typeof value === 'string' && !value.trim())
      || (Array.isArray(value) && (value.length === 0 || value.every(row => typeof row === 'object' && row !== null && Object.values(row).every(v => !String(v ?? '').trim()))));
    if (field.required && isEmpty) errors.push(`${field.label} là bắt buộc.`);
  }

  const normalized = normalizeDynamicApprovers(dynamicApproversByBlock, approvalBlocks);
  if (
    creatorUserId
    && Object.values(normalized).some(userIds => userIds.includes(creatorUserId))
  ) {
    errors.push('Bạn không thể chọn chính mình làm người duyệt.');
  }
  for (const block of approvalBlocks) {
    if (block.source !== 'DYNAMIC_CREATOR_SELECT') continue;
    const minimum = block.minimumDynamicApprovers ?? 1;
    if ((normalized[block.key] ?? []).length < minimum) {
      errors.push(`Khối “${block.name}” cần chọn tối thiểu ${minimum} người duyệt.`);
    }
  }
  return errors;
};
