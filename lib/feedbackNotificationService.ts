import { notificationService } from './notificationService';
import type { FeedbackComment, FeedbackItem, FeedbackWatcher } from './feedbackService';
import { Role, User } from '../types';

const FEEDBACK_LINK = (feedbackId: string) => `/feedback?feedbackId=${feedbackId}`;

export const isFeedbackManagerUser = (user: User) => (
  user.role === Role.ADMIN
  || (user.adminModules || []).includes('FEEDBACK')
  || Boolean(user.adminSubModules?.FEEDBACK)
);

export const uniqueFeedbackRecipientIds = (
  recipientIds: Array<string | null | undefined>,
  actorId?: string | null,
) => [...new Set(recipientIds.filter(Boolean) as string[])]
  .filter(userId => userId !== actorId);

export const getFeedbackManagerRecipientIds = (users: User[], actorId?: string | null) =>
  uniqueFeedbackRecipientIds(
    users
      .filter(user => user.isActive !== false && isFeedbackManagerUser(user))
      .map(user => user.id),
    actorId,
  );

export const getFeedbackCommentRecipientIds = (input: {
  item: FeedbackItem;
  comments: FeedbackComment[];
  watchers?: FeedbackWatcher[];
  users: User[];
  actorId?: string | null;
  isInternal?: boolean;
}) => {
  if (input.isInternal) return getFeedbackManagerRecipientIds(input.users, input.actorId);

  const activeUserIds = new Set(input.users.filter(user => user.isActive !== false).map(user => user.id));
  return uniqueFeedbackRecipientIds([
    input.item.createdBy,
    ...(input.watchers || []).map(watcher => watcher.userId),
    ...input.comments.map(comment => comment.authorUserId),
  ], input.actorId).filter(userId => activeUserIds.has(userId));
};

export const feedbackNotificationService = {
  async notifyCreated(input: {
    item: FeedbackItem;
    users: User[];
    actorId: string;
  }): Promise<string[]> {
    const recipientIds = getFeedbackManagerRecipientIds(input.users, input.actorId);
    return notificationService.notifyProjectUsers({
      recipientIds,
      actorId: input.actorId,
      type: 'info',
      category: 'feedback',
      title: 'Góp ý mới',
      message: input.item.title,
      severity: input.item.impactLevel === 'urgent' ? 'warning' : 'info',
      icon: '💬',
      link: FEEDBACK_LINK(input.item.id),
      sourceType: 'feedback',
      sourceId: input.item.id,
      metadata: {
        feedbackId: input.item.id,
        status: input.item.status,
        priority: input.item.priority,
        actorId: input.actorId,
      },
    });
  },

  async notifyComment(input: {
    item: FeedbackItem;
    comments: FeedbackComment[];
    watchers?: FeedbackWatcher[];
    users: User[];
    actorId: string;
    isInternal?: boolean;
  }): Promise<string[]> {
    const recipientIds = getFeedbackCommentRecipientIds(input);
    return notificationService.notifyProjectUsers({
      recipientIds,
      actorId: input.actorId,
      type: 'info',
      category: 'feedback',
      title: input.isInternal ? 'Bình luận nội bộ Feedback' : 'Bình luận Feedback',
      message: input.item.title,
      severity: 'info',
      icon: '💬',
      link: FEEDBACK_LINK(input.item.id),
      sourceType: 'feedback',
      sourceId: input.item.id,
      metadata: {
        feedbackId: input.item.id,
        status: input.item.status,
        priority: input.item.priority,
        actorId: input.actorId,
        isInternal: Boolean(input.isInternal),
      },
    });
  },

  async notifyAdminUpdate(input: {
    before: FeedbackItem;
    after: FeedbackItem;
    watchers?: FeedbackWatcher[];
    users: User[];
    actorId: string;
  }): Promise<string[]> {
    const changes = [
      input.before.status !== input.after.status ? `trạng thái ${input.after.status}` : '',
      input.before.priority !== input.after.priority ? `ưu tiên ${input.after.priority}` : '',
    ].filter(Boolean);
    if (changes.length === 0) return [];

    const recipientIds = uniqueFeedbackRecipientIds([
      input.after.createdBy,
      ...(input.watchers || []).map(watcher => watcher.userId),
    ], input.actorId);
    return notificationService.notifyProjectUsers({
      recipientIds,
      actorId: input.actorId,
      type: input.after.status === 'done' ? 'success' : input.after.status === 'rejected' ? 'warning' : 'info',
      category: 'feedback',
      title: 'Feedback được cập nhật',
      message: `${input.after.title}: ${changes.join(', ')}`,
      severity: input.after.priority === 'urgent' ? 'warning' : 'info',
      icon: '💬',
      link: FEEDBACK_LINK(input.after.id),
      sourceType: 'feedback',
      sourceId: input.after.id,
      metadata: {
        feedbackId: input.after.id,
        status: input.after.status,
        priority: input.after.priority,
        actorId: input.actorId,
      },
    });
  },
};
