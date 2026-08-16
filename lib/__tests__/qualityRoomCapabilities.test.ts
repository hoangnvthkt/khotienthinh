import { describe, expect, it } from 'vitest';

import {
  getQualityChecklistCapabilities,
  getQualityRoomCapabilities,
} from '../qualityRoomCapabilities';

describe('Quality Room capability matrix', () => {
  it.each([
    ['viewer', ['view'], { canView: true, canEdit: false, canDelete: false, canSubmit: false, canApprove: false }],
    ['editor', ['view', 'edit'], { canView: true, canEdit: true, canDelete: false, canSubmit: false, canApprove: false }],
    ['submitter', ['view', 'edit', 'submit'], { canView: true, canEdit: true, canDelete: false, canSubmit: true, canApprove: false }],
    ['approver', ['view', 'approve'], { canView: true, canEdit: false, canDelete: false, canSubmit: false, canApprove: true }],
    ['delete-only', ['view', 'delete'], { canView: true, canEdit: false, canDelete: true, canSubmit: false, canApprove: false }],
    ['no access', [], { canView: false, canEdit: false, canDelete: false, canSubmit: false, canApprove: false }],
    ['System Admin', ['view', 'edit', 'delete', 'submit', 'verify', 'approve'], { canView: true, canEdit: true, canDelete: true, canSubmit: true, canApprove: true }],
  ])('derives %s actions', (_role, actions, expected) => {
    expect(getQualityRoomCapabilities(actions)).toEqual(expected);
  });

  it('applies workflow status gates independently', () => {
    const full = getQualityRoomCapabilities(['view', 'edit', 'delete', 'submit', 'approve']);

    expect(getQualityChecklistCapabilities(full, 'draft')).toEqual({
      canEdit: true, canDelete: true, canSubmit: true, canApprove: false,
    });
    expect(getQualityChecklistCapabilities(full, 'submitted')).toEqual({
      canEdit: false, canDelete: false, canSubmit: false, canApprove: true,
    });
    expect(getQualityChecklistCapabilities(full, 'approved')).toEqual({
      canEdit: false, canDelete: false, canSubmit: false, canApprove: false,
    });
  });
});
