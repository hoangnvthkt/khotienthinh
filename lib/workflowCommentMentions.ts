import type { WorkflowCommentMention } from '../types';

export const MAX_WORKFLOW_COMMENT_MENTIONS = 20;

export interface WorkflowMentionTrigger {
  start: number;
  end: number;
  query: string;
}

export const findWorkflowMentionTrigger = (
  body: string,
  cursor: number,
): WorkflowMentionTrigger | null => {
  const safeCursor = Math.max(0, Math.min(cursor, body.length));
  const beforeCursor = body.slice(0, safeCursor);
  const match = beforeCursor.match(/(^|[\s(])@([^\s@]*)$/);
  if (!match) return null;

  const start = beforeCursor.lastIndexOf('@');
  return start < 0
    ? null
    : { start, end: safeCursor, query: match[2] || '' };
};

export const normalizeWorkflowCommentMentions = (
  value: unknown,
): WorkflowCommentMention[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const result: WorkflowCommentMention[] = [];
  for (const item of value) {
    const userId = typeof item?.userId === 'string' ? item.userId.trim() : '';
    const displayName = typeof item?.displayName === 'string' ? item.displayName.trim() : '';
    if (!userId || !displayName || seen.has(userId)) continue;
    seen.add(userId);
    result.push({ userId, displayName });
    if (result.length >= MAX_WORKFLOW_COMMENT_MENTIONS) break;
  }
  return result;
};

export const reconcileWorkflowCommentMentions = (
  body: string,
  mentions: WorkflowCommentMention[],
): WorkflowCommentMention[] => normalizeWorkflowCommentMentions(mentions)
  .filter(mention => body.includes(`@${mention.displayName}`));

export const insertWorkflowCommentMention = (input: {
  body: string;
  trigger: WorkflowMentionTrigger;
  mention: WorkflowCommentMention;
}): { body: string; caret: number } => {
  const tag = `@${input.mention.displayName} `;
  const suffix = input.body.slice(input.trigger.end).replace(/^[ \t]/, '');
  const body = `${input.body.slice(0, input.trigger.start)}${tag}${suffix}`;
  return {
    body,
    caret: input.trigger.start + tag.length,
  };
};
