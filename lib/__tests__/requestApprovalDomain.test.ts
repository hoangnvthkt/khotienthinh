import { describe, expect, it } from 'vitest';
import { projectRequestApproval } from '../requestApprovalDomain';

describe('projectRequestApproval', () => {
  it('advances a sequential ALL request only after the current block is complete', () => {
    expect(projectRequestApproval({
      flowMode: 'SEQUENTIAL',
      completionPolicy: 'ALL',
      orderedBlockKeys: ['manager', 'director'],
      currentBlockKey: 'manager',
      assignments: [
        { id: 'a1', blockKey: 'manager', status: 'APPROVED', sortOrder: 1 },
      ],
    })).toMatchObject({
      isApproved: false,
      activeBlockKeys: ['director'],
      nextBlockKey: 'director',
    });
  });

  it('finishes parallel ANY_ONE and skips every remaining assignment', () => {
    expect(projectRequestApproval({
      flowMode: 'PARALLEL',
      completionPolicy: 'ANY_ONE',
      orderedBlockKeys: ['manager', 'director'],
      assignments: [
        { id: 'a1', blockKey: 'manager', status: 'APPROVED', sortOrder: 1 },
        { id: 'a2', blockKey: 'director', status: 'PENDING', sortOrder: 2 },
      ],
    })).toEqual({
      isApproved: true,
      activeBlockKeys: [],
      assignmentIdsToSkip: ['a2'],
    });
  });

  it('does not count RETURNED or CANCELLED as approvals', () => {
    expect(projectRequestApproval({
      flowMode: 'PARALLEL',
      completionPolicy: 'ALL',
      orderedBlockKeys: ['manager', 'director'],
      assignments: [
        { id: 'a1', blockKey: 'manager', status: 'APPROVED', sortOrder: 1 },
        { id: 'a2', blockKey: 'director', status: 'RETURNED', sortOrder: 2 },
      ],
    }).isApproved).toBe(false);
  });

  it('advances sequential ANY_ONE after one approval in the current block', () => {
    expect(projectRequestApproval({
      flowMode: 'SEQUENTIAL',
      completionPolicy: 'ANY_ONE',
      orderedBlockKeys: ['board', 'finance'],
      currentBlockKey: 'board',
      assignments: [
        { id: 'a1', blockKey: 'board', status: 'APPROVED', sortOrder: 1 },
        { id: 'a2', blockKey: 'board', status: 'PENDING', sortOrder: 2 },
      ],
    })).toEqual({
      isApproved: false,
      activeBlockKeys: ['finance'],
      assignmentIdsToSkip: ['a2'],
      nextBlockKey: 'finance',
    });
  });
});
