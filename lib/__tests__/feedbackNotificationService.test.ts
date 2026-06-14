import { describe, expect, it } from 'vitest';
import { Role, User } from '../../types';
import { getFeedbackCommentRecipientIds, getFeedbackManagerRecipientIds, uniqueFeedbackRecipientIds } from '../feedbackNotificationService';
import { resolveNotificationPath } from '../notificationRoutes';

const user = (patch: Partial<User> & Pick<User, 'id'>): User => ({
  id: patch.id,
  name: patch.name || patch.id,
  email: `${patch.id}@example.com`,
  role: patch.role || Role.EMPLOYEE,
  ...patch,
});

describe('feedback notification helpers', () => {
  it('dedupes recipients and excludes the actor', () => {
    expect(uniqueFeedbackRecipientIds(['u1', 'u1', 'u2', null], 'u1')).toEqual(['u2']);
  });

  it('finds admin and FEEDBACK managers', () => {
    const users = [
      user({ id: 'admin', role: Role.ADMIN }),
      user({ id: 'module-admin', adminModules: ['FEEDBACK'] }),
      user({ id: 'sub-admin', adminSubModules: { FEEDBACK: ['/feedback'] } }),
      user({ id: 'inactive', role: Role.ADMIN, isActive: false }),
      user({ id: 'employee' }),
    ];

    expect(getFeedbackManagerRecipientIds(users, 'admin')).toEqual(['module-admin', 'sub-admin']);
  });

  it('routes public comments to creator, watchers, and commenters only', () => {
    const users = [
      user({ id: 'creator' }),
      user({ id: 'assignee' }),
      user({ id: 'watcher' }),
      user({ id: 'commenter' }),
      user({ id: 'actor' }),
      user({ id: 'inactive-commenter', isActive: false }),
    ];

    expect(getFeedbackCommentRecipientIds({
      users,
      actorId: 'actor',
      item: {
        id: 'fb-1',
        title: 'Feedback',
        description: 'Desc',
        type: 'bug',
        module: 'other',
        impactLevel: 'medium',
        priority: 'medium',
        status: 'new',
        visibility: 'public',
        createdBy: 'creator',
        assignedTo: 'assignee',
        deviceInfo: {},
        metadata: {},
        lastActivityAt: '2026-06-14T04:00:00.000Z',
        createdAt: '2026-06-14T04:00:00.000Z',
        updatedAt: '2026-06-14T04:00:00.000Z',
        tags: [],
        voteCount: 0,
        commentCount: 0,
        hasVoted: false,
        watcherCount: 0,
        isWatching: false,
      },
      watchers: [
        {
          id: 'w1',
          feedbackId: 'fb-1',
          userId: 'watcher',
          createdBy: 'creator',
          createdAt: '2026-06-14T04:00:00.000Z',
        },
      ],
      comments: [
        {
          id: 'c1',
          feedbackId: 'fb-1',
          authorUserId: 'commenter',
          body: 'Ok',
          isInternal: false,
          metadata: {},
          createdAt: '2026-06-14T04:00:00.000Z',
          updatedAt: '2026-06-14T04:00:00.000Z',
        },
        {
          id: 'c2',
          feedbackId: 'fb-1',
          authorUserId: 'inactive-commenter',
          body: 'Ok',
          isInternal: false,
          metadata: {},
          createdAt: '2026-06-14T04:00:00.000Z',
          updatedAt: '2026-06-14T04:00:00.000Z',
        },
      ],
    })).toEqual(['creator', 'watcher', 'commenter']);
  });

  it('resolves feedback notification deep links', () => {
    expect(resolveNotificationPath({
      id: 'n1',
      type: 'info',
      category: 'feedback',
      title: 'Feedback',
      message: 'Updated',
      isRead: false,
      isDismissed: false,
      severity: 'info',
      sourceType: 'feedback',
      sourceId: 'fb-1',
      metadata: {},
      createdAt: '2026-06-14T04:00:00.000Z',
    })).toBe('/feedback?feedbackId=fb-1');
  });
});
