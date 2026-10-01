import { describe, expect, it } from 'vitest';
import {
  buildSafeTemplateDraft,
  isActionConfigurable,
  prerequisitesOf,
  toggleBlockedReason,
  toggleRoomAction,
  type RoomRulesByRoom,
} from '../projectRoomPersonDraft';

// payment: approve is not fully enforced yet; gantt: edit needs view (server rule).
const rules: RoomRulesByRoom = {
  payment: {
    actionEnforcement: { view: 'enforced', edit: 'enforced', submit: 'enforced', approve: 'audit_only' },
    actionPrerequisites: {},
  },
  gantt: {
    actionEnforcement: { view: 'enforced', edit: 'enforced', delete: 'enforced' },
    actionPrerequisites: { edit: ['view'], delete: ['view'] },
  },
};

describe('person Room draft', () => {
  it('treats an action without a status as locked', () => {
    expect(isActionConfigurable(rules, 'payment', 'edit')).toBe(true);
    expect(isActionConfigurable(rules, 'payment', 'approve')).toBe(false);
    expect(isActionConfigurable(rules, 'payment', 'confirm')).toBe(false);
    expect(isActionConfigurable({}, 'payment', 'view')).toBe(false);
  });

  it('adds prerequisites and removes dependents', () => {
    expect(prerequisitesOf(rules, 'gantt', 'edit')).toEqual(['view']);
    expect(prerequisitesOf(rules, 'gantt', 'view')).toEqual([]);
    const on = toggleRoomAction({}, 'gantt', 'edit', rules);
    expect([...on.gantt!].sort()).toEqual(['edit', 'view']);
    const withDelete = toggleRoomAction(on, 'gantt', 'delete', rules);
    expect([...withDelete.gantt!].sort()).toEqual(['delete', 'edit', 'view']);
    expect(toggleRoomAction(withDelete, 'gantt', 'view', rules)).toEqual({});
    const noEdit = toggleRoomAction(withDelete, 'gantt', 'edit', rules);
    expect([...noEdit.gantt!].sort()).toEqual(['delete', 'view']);
  });

  it('never grants or removes an action that is not fully enforced', () => {
    expect(toggleBlockedReason({}, 'payment', 'approve', rules)).toBe('Chưa áp dụng đầy đủ');
    expect(toggleRoomAction({}, 'payment', 'approve', rules)).toEqual({});
    const held = { payment: ['view', 'approve'] } as const;
    expect(toggleRoomAction({ ...held } as any, 'payment', 'approve', rules)).toEqual(held);
    // "view" is a prerequisite of the held approve, so it cannot be removed either.
    expect(toggleBlockedReason({ ...held } as any, 'payment', 'view', rules)).toBe('Cần cho quyền chưa áp dụng đầy đủ');
    expect(toggleRoomAction({ ...held } as any, 'payment', 'view', rules)).toEqual(held);
  });

  it('keeps locked actions and skips new locked ones when filling from a template', () => {
    const current = { payment: ['view', 'approve'] } as any;
    const template = { payment: ['view', 'edit', 'approve', 'submit'], gantt: ['edit'] } as any;

    const replace = buildSafeTemplateDraft({ payment: ['view'] } as any, template, 'replace', rules);
    expect(replace.skipped).toBe(1); // approve is new and not enforced
    expect([...replace.draft.payment!].sort()).toEqual(['edit', 'submit', 'view']);
    expect([...replace.draft.gantt!].sort()).toEqual(['edit', 'view']);

    // The person already has approve: replacing with a template must not drop it.
    const keep = buildSafeTemplateDraft(current, { gantt: ['view'] } as any, 'replace', rules);
    expect([...keep.draft.payment!].sort()).toEqual(['approve', 'view']);
    expect(keep.skipped).toBe(0);

    const merge = buildSafeTemplateDraft(current, template, 'merge', rules);
    expect([...merge.draft.payment!].sort()).toEqual(['approve', 'edit', 'submit', 'view']);
  });

  it('drops a template action whose prerequisite cannot be granted', () => {
    const strict: RoomRulesByRoom = {
      payment: { actionEnforcement: { view: 'audit_only', edit: 'enforced' }, actionPrerequisites: {} },
    };
    const result = buildSafeTemplateDraft({}, { payment: ['view', 'edit'] } as any, 'replace', strict);
    expect(result.draft).toEqual({});
    expect(result.skipped).toBe(2);
  });
});
