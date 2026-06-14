import { isSupabaseConfigured, supabase } from './supabase';

export const FEEDBACK_TYPES = ['bug', 'ui', 'feature', 'workflow', 'performance', 'permission', 'data', 'other'] as const;
export const FEEDBACK_MODULES = ['material', 'boq', 'warehouse', 'project', 'dashboard', 'acceptance', 'cost_library', 'auth', 'mobile', 'other'] as const;
export const FEEDBACK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const FEEDBACK_STATUSES = ['new', 'received', 'need_clarification', 'planned', 'in_progress', 'testing', 'done', 'rejected'] as const;
export const FEEDBACK_VISIBILITIES = ['public', 'private', 'internal'] as const;
export const FEEDBACK_ROADMAP_STAGES = ['planned', 'in_progress', 'testing', 'done'] as const;
export const FEEDBACK_ATTACHMENT_BUCKET = 'feedback-attachments';
export const MAX_FEEDBACK_ATTACHMENTS = 5;
export const MAX_FEEDBACK_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type FeedbackType = typeof FEEDBACK_TYPES[number];
export type FeedbackModule = typeof FEEDBACK_MODULES[number];
export type FeedbackPriority = typeof FEEDBACK_PRIORITIES[number];
export type FeedbackStatus = typeof FEEDBACK_STATUSES[number];
export type FeedbackVisibility = typeof FEEDBACK_VISIBILITIES[number];
export type FeedbackRoadmapStage = typeof FEEDBACK_ROADMAP_STAGES[number];

export interface FeedbackItem {
  id: string;
  title: string;
  description: string;
  type: FeedbackType;
  module: FeedbackModule;
  impactLevel: FeedbackPriority;
  priority: FeedbackPriority;
  status: FeedbackStatus;
  visibility: FeedbackVisibility;
  createdBy: string;
  assignedTo?: string | null;
  relatedRoute?: string | null;
  deviceInfo: Record<string, any>;
  appVersion?: string | null;
  rejectedReason?: string | null;
  metadata: Record<string, any>;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  dueAt?: string | null;
  targetRelease?: string | null;
  roadmapStage?: FeedbackRoadmapStage | null;
  closedBy?: string | null;
  tags: string[];
  voteCount: number;
  commentCount: number;
  hasVoted: boolean;
  watcherCount: number;
  isWatching: boolean;
}

export interface FeedbackComment {
  id: string;
  feedbackId: string;
  authorUserId: string;
  body: string;
  isInternal: boolean;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackAttachment {
  id: string;
  feedbackId: string;
  commentId?: string | null;
  uploadedBy: string;
  storageBucket: string;
  storagePath: string;
  fileName: string;
  mimeType?: string | null;
  fileSize?: number | null;
  kind: 'image' | 'file';
  metadata: Record<string, any>;
  createdAt: string;
}

export interface FeedbackStatusLog {
  id: string;
  feedbackId: string;
  oldStatus?: FeedbackStatus | null;
  newStatus: FeedbackStatus;
  changedBy?: string | null;
  reason?: string | null;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface FeedbackChecklistItem {
  id: string;
  feedbackId: string;
  title: string;
  isDone: boolean;
  sortOrder: number;
  createdBy?: string | null;
  doneBy?: string | null;
  doneAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackWatcher {
  id: string;
  feedbackId: string;
  userId: string;
  createdBy?: string | null;
  createdAt: string;
}

export interface FeedbackDetail {
  item: FeedbackItem;
  comments: FeedbackComment[];
  attachments: FeedbackAttachment[];
  statusLogs: FeedbackStatusLog[];
  checklist: FeedbackChecklistItem[];
  watchers: FeedbackWatcher[];
}

export interface FeedbackFilters {
  search?: string;
  status?: FeedbackStatus | 'all';
  type?: FeedbackType | 'all';
  module?: FeedbackModule | 'all';
  priority?: FeedbackPriority | 'all';
  createdBy?: string | 'all';
}

export interface CreateFeedbackInput {
  title: string;
  description: string;
  type: FeedbackType;
  module: FeedbackModule;
  impactLevel: FeedbackPriority;
  visibility?: Extract<FeedbackVisibility, 'public' | 'private'>;
  createdBy: string;
  relatedRoute?: string | null;
  deviceInfo?: Record<string, any>;
  appVersion?: string | null;
}

export interface CreateFeedbackCommentInput {
  feedbackId: string;
  authorUserId: string;
  body: string;
  isInternal?: boolean;
}

export interface UploadFeedbackAttachmentInput {
  feedbackId: string;
  commentId?: string | null;
  uploadedBy: string;
  file: File;
}

export interface FeedbackAdminUpdateInput {
  status?: FeedbackStatus;
  priority?: FeedbackPriority;
  assignedTo?: string | null;
  rejectedReason?: string | null;
  dueAt?: string | null;
  targetRelease?: string | null;
  roadmapStage?: FeedbackRoadmapStage | null;
  tags?: string[];
}

export interface CreateFeedbackChecklistInput {
  feedbackId: string;
  title: string;
  createdBy: string;
  sortOrder?: number;
}

export interface UpdateFeedbackChecklistInput {
  title?: string;
  isDone?: boolean;
  sortOrder?: number;
  actorUserId?: string;
}

export interface FeedbackDashboardMetrics {
  total: number;
  open: number;
  done: number;
  rejected: number;
  urgentHighBugs: number;
  overdue: number;
  averageResolutionHours: number | null;
  topModules: Array<{ module: FeedbackModule; count: number }>;
  topContributors: Array<{ userId: string; count: number }>;
}

type FeedbackCountState = {
  voteCountById?: Map<string, number>;
  commentCountById?: Map<string, number>;
  watcherCountById?: Map<string, number>;
  votedIds?: Set<string>;
  watchingIds?: Set<string>;
};

const nowIso = () => new Date().toISOString();

const safeJsonObject = (value: any): Record<string, any> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

export const getCurrentFeedbackActorUserId = async (fallbackUserId?: string | null): Promise<string> => {
  if (!isSupabaseConfigured) {
    if (!fallbackUserId) throw new Error('Thiếu người dùng hiện tại.');
    return fallbackUserId;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) {
    throw new Error('Phiên đăng nhập đã hết hạn. Anh đăng nhập lại rồi gửi góp ý giúp em.');
  }

  const { data, error } = await supabase.rpc('current_app_user_id');
  if (error) throw error;
  if (!data) {
    throw new Error('Không tìm thấy hồ sơ người dùng gắn với phiên đăng nhập hiện tại.');
  }
  return String(data);
};

const normalizeSearchText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export const sanitizeFeedbackAttachmentFileName = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'attachment';

export const isFeedbackAttachmentImage = (mimeType?: string | null) =>
  Boolean(mimeType && mimeType.startsWith('image/'));

export const buildFeedbackAttachmentStoragePath = (feedbackId: string, attachmentId: string, fileName: string) =>
  `feedback/${feedbackId}/${attachmentId}-${sanitizeFeedbackAttachmentFileName(fileName)}`;

const countByFeedbackId = (rows: any[] | null | undefined) => {
  const counts = new Map<string, number>();
  (rows || []).forEach(row => {
    const id = row.feedback_id || row.feedbackId;
    if (!id) return;
    counts.set(id, (counts.get(id) || 0) + 1);
  });
  return counts;
};

export const cleanFeedbackTags = (tags: string[] | undefined) => [...new Set((tags || [])
  .map(tag => tag.trim())
  .filter(Boolean)
  .slice(0, 12))];

export const mapFeedbackItemFromDb = (row: any, state: FeedbackCountState = {}): FeedbackItem => {
  const id = row.id;
  return {
    id,
    title: row.title || '',
    description: row.description || '',
    type: row.type || 'other',
    module: row.module || 'other',
    impactLevel: row.impact_level ?? row.impactLevel ?? 'medium',
    priority: row.priority || 'medium',
    status: row.status || 'new',
    visibility: row.visibility || 'public',
    createdBy: row.created_by ?? row.createdBy,
    assignedTo: row.assigned_to ?? row.assignedTo ?? null,
    relatedRoute: row.related_route ?? row.relatedRoute ?? null,
    deviceInfo: safeJsonObject(row.device_info ?? row.deviceInfo),
    appVersion: row.app_version ?? row.appVersion ?? null,
    rejectedReason: row.rejected_reason ?? row.rejectedReason ?? null,
    metadata: safeJsonObject(row.metadata),
    lastActivityAt: row.last_activity_at ?? row.lastActivityAt ?? row.updated_at ?? row.created_at ?? nowIso(),
    createdAt: row.created_at ?? row.createdAt ?? nowIso(),
    updatedAt: row.updated_at ?? row.updatedAt ?? row.created_at ?? nowIso(),
    completedAt: row.completed_at ?? row.completedAt ?? null,
    dueAt: row.due_at ?? row.dueAt ?? null,
    targetRelease: row.target_release ?? row.targetRelease ?? null,
    roadmapStage: row.roadmap_stage ?? row.roadmapStage ?? null,
    closedBy: row.closed_by ?? row.closedBy ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    voteCount: state.voteCountById?.get(id) || Number(row.vote_count ?? row.voteCount ?? 0),
    commentCount: state.commentCountById?.get(id) || Number(row.comment_count ?? row.commentCount ?? 0),
    hasVoted: state.votedIds?.has(id) || Boolean(row.has_voted ?? row.hasVoted),
    watcherCount: state.watcherCountById?.get(id) || Number(row.watcher_count ?? row.watcherCount ?? 0),
    isWatching: state.watchingIds?.has(id) || Boolean(row.is_watching ?? row.isWatching),
  };
};

export const mapFeedbackCommentFromDb = (row: any): FeedbackComment => ({
  id: row.id,
  feedbackId: row.feedback_id ?? row.feedbackId,
  authorUserId: row.author_user_id ?? row.authorUserId,
  body: row.body || '',
  isInternal: Boolean(row.is_internal ?? row.isInternal),
  metadata: safeJsonObject(row.metadata),
  createdAt: row.created_at ?? row.createdAt,
  updatedAt: row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt,
});

export const mapFeedbackAttachmentFromDb = (row: any): FeedbackAttachment => {
  const mimeType = row.mime_type ?? row.mimeType ?? null;
  return {
    id: row.id,
    feedbackId: row.feedback_id ?? row.feedbackId,
    commentId: row.comment_id ?? row.commentId ?? null,
    uploadedBy: row.uploaded_by ?? row.uploadedBy,
    storageBucket: row.storage_bucket ?? row.storageBucket ?? FEEDBACK_ATTACHMENT_BUCKET,
    storagePath: row.storage_path ?? row.storagePath,
    fileName: row.file_name ?? row.fileName ?? 'attachment',
    mimeType,
    fileSize: row.file_size ?? row.fileSize ?? null,
    kind: isFeedbackAttachmentImage(mimeType) ? 'image' : 'file',
    metadata: safeJsonObject(row.metadata),
    createdAt: row.created_at ?? row.createdAt,
  };
};

export const mapFeedbackStatusLogFromDb = (row: any): FeedbackStatusLog => ({
  id: row.id,
  feedbackId: row.feedback_id ?? row.feedbackId,
  oldStatus: row.old_status ?? row.oldStatus ?? null,
  newStatus: row.new_status ?? row.newStatus,
  changedBy: row.changed_by ?? row.changedBy ?? null,
  reason: row.reason ?? null,
  metadata: safeJsonObject(row.metadata),
  createdAt: row.created_at ?? row.createdAt,
});

export const mapFeedbackChecklistItemFromDb = (row: any): FeedbackChecklistItem => ({
  id: row.id,
  feedbackId: row.feedback_id ?? row.feedbackId,
  title: row.title || '',
  isDone: Boolean(row.is_done ?? row.isDone),
  sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
  createdBy: row.created_by ?? row.createdBy ?? null,
  doneBy: row.done_by ?? row.doneBy ?? null,
  doneAt: row.done_at ?? row.doneAt ?? null,
  createdAt: row.created_at ?? row.createdAt,
  updatedAt: row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt,
});

export const mapFeedbackWatcherFromDb = (row: any): FeedbackWatcher => ({
  id: row.id,
  feedbackId: row.feedback_id ?? row.feedbackId,
  userId: row.user_id ?? row.userId,
  createdBy: row.created_by ?? row.createdBy ?? null,
  createdAt: row.created_at ?? row.createdAt,
});

export const filterFeedbackItems = (items: FeedbackItem[], filters: FeedbackFilters): FeedbackItem[] => {
  const search = normalizeSearchText(filters.search || '');
  return items.filter(item => {
    if (filters.status && filters.status !== 'all' && item.status !== filters.status) return false;
    if (filters.type && filters.type !== 'all' && item.type !== filters.type) return false;
    if (filters.module && filters.module !== 'all' && item.module !== filters.module) return false;
    if (filters.priority && filters.priority !== 'all' && item.priority !== filters.priority) return false;
    if (filters.createdBy && filters.createdBy !== 'all' && item.createdBy !== filters.createdBy) return false;
    if (!search) return true;
    return normalizeSearchText(`${item.title} ${item.description}`).includes(search);
  });
};

export const buildFeedbackAdminUpdatePayload = (input: FeedbackAdminUpdateInput): Record<string, any> => {
  const payload: Record<string, any> = {};
  if (input.status !== undefined) {
    payload.status = input.status;
    payload.rejected_reason = input.status === 'rejected' ? (input.rejectedReason || null) : null;
  } else if (input.rejectedReason !== undefined) {
    payload.rejected_reason = input.rejectedReason || null;
  }
  if (input.priority !== undefined) payload.priority = input.priority;
  if (input.assignedTo !== undefined) payload.assigned_to = input.assignedTo || null;
  if (input.dueAt !== undefined) payload.due_at = input.dueAt || null;
  if (input.targetRelease !== undefined) payload.target_release = input.targetRelease?.trim() || null;
  if (input.roadmapStage !== undefined) payload.roadmap_stage = input.roadmapStage || null;
  if (input.tags !== undefined) payload.tags = cleanFeedbackTags(input.tags);
  return payload;
};

export const groupFeedbackByStatus = (items: FeedbackItem[]) => {
  const groups = new Map<FeedbackStatus, FeedbackItem[]>();
  FEEDBACK_STATUSES.forEach(status => groups.set(status, []));
  items.forEach(item => {
    groups.get(item.status)?.push(item);
  });
  groups.forEach(group => group.sort((a, b) => {
    const priorityScore = { urgent: 4, high: 3, medium: 2, low: 1 };
    return (priorityScore[b.priority] - priorityScore[a.priority])
      || (b.voteCount - a.voteCount)
      || new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  }));
  return groups;
};

export const getFeedbackRoadmapItems = (items: FeedbackItem[]) => {
  const priorityScore = { urgent: 4, high: 3, medium: 2, low: 1 };
  return items
    .filter(item => item.roadmapStage || ['planned', 'in_progress', 'testing', 'done'].includes(item.status))
    .map(item => ({
      ...item,
      roadmapStage: item.roadmapStage || (['planned', 'in_progress', 'testing', 'done'].includes(item.status) ? item.status as FeedbackRoadmapStage : null),
    }))
    .filter(item => item.roadmapStage)
    .sort((a, b) =>
      (priorityScore[b.priority] - priorityScore[a.priority])
      || (b.voteCount - a.voteCount)
      || new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );
};

export const buildFeedbackDashboardMetrics = (items: FeedbackItem[]): FeedbackDashboardMetrics => {
  const terminalStatuses = new Set<FeedbackStatus>(['done', 'rejected']);
  const now = Date.now();
  const topModules = new Map<FeedbackModule, number>();
  const topContributors = new Map<string, number>();
  const resolvedHours: number[] = [];

  items.forEach(item => {
    topModules.set(item.module, (topModules.get(item.module) || 0) + 1);
    topContributors.set(item.createdBy, (topContributors.get(item.createdBy) || 0) + 1);
    if (item.completedAt) {
      const createdAt = new Date(item.createdAt).getTime();
      const completedAt = new Date(item.completedAt).getTime();
      if (Number.isFinite(createdAt) && Number.isFinite(completedAt) && completedAt >= createdAt) {
        resolvedHours.push((completedAt - createdAt) / (1000 * 60 * 60));
      }
    }
  });

  const averageResolutionHours = resolvedHours.length
    ? Math.round((resolvedHours.reduce((sum, value) => sum + value, 0) / resolvedHours.length) * 10) / 10
    : null;

  return {
    total: items.length,
    open: items.filter(item => !terminalStatuses.has(item.status)).length,
    done: items.filter(item => item.status === 'done').length,
    rejected: items.filter(item => item.status === 'rejected').length,
    urgentHighBugs: items.filter(item => item.type === 'bug' && ['urgent', 'high'].includes(item.priority)).length,
    overdue: items.filter(item => item.dueAt && !terminalStatuses.has(item.status) && new Date(item.dueAt).getTime() < now).length,
    averageResolutionHours,
    topModules: [...topModules.entries()]
      .map(([module, count]) => ({ module, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    topContributors: [...topContributors.entries()]
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
};

const hydrateFeedbackItems = async (rows: any[], actorUserId?: string | null): Promise<FeedbackItem[]> => {
  const ids = rows.map(row => row.id).filter(Boolean);
  if (ids.length === 0) return [];

  const [votesResult, commentsResult, watchersResult] = await Promise.all([
    supabase.from('feedback_votes').select('feedback_id, user_id').in('feedback_id', ids),
    supabase.from('feedback_comments').select('feedback_id').in('feedback_id', ids),
    supabase.from('feedback_watchers').select('feedback_id, user_id').in('feedback_id', ids),
  ]);
  if (votesResult.error) throw votesResult.error;
  if (commentsResult.error) throw commentsResult.error;
  if (watchersResult.error) throw watchersResult.error;

  const votedIds = new Set<string>();
  const watchingIds = new Set<string>();
  (votesResult.data || []).forEach((vote: any) => {
    if (actorUserId && vote.user_id === actorUserId) votedIds.add(vote.feedback_id);
  });
  (watchersResult.data || []).forEach((watcher: any) => {
    if (actorUserId && watcher.user_id === actorUserId) watchingIds.add(watcher.feedback_id);
  });
  const voteCountById = countByFeedbackId(votesResult.data);
  const commentCountById = countByFeedbackId(commentsResult.data);
  const watcherCountById = countByFeedbackId(watchersResult.data);

  return rows.map(row => mapFeedbackItemFromDb(row, {
    voteCountById,
    commentCountById,
    watcherCountById,
    votedIds,
    watchingIds,
  }));
};

export const feedbackService = {
  async listItems(actorUserId?: string | null): Promise<FeedbackItem[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('feedback_items')
      .select('*')
      .order('last_activity_at', { ascending: false })
      .limit(250);
    if (error) throw error;
    return hydrateFeedbackItems(data || [], actorUserId);
  },

  async getDetail(id: string, actorUserId?: string | null): Promise<FeedbackDetail | null> {
    if (!id) return null;
    if (!isSupabaseConfigured) return null;

    const { data: itemRow, error: itemError } = await supabase
      .from('feedback_items')
      .select('*')
      .eq('id', id)
      .single();
    if (itemError) throw itemError;
    if (!itemRow) return null;

    const [item] = await hydrateFeedbackItems([itemRow], actorUserId);
    const [commentsResult, attachmentsResult, logsResult, checklistResult, watchersResult] = await Promise.all([
      supabase.from('feedback_comments').select('*').eq('feedback_id', id).order('created_at', { ascending: true }),
      supabase.from('feedback_attachments').select('*').eq('feedback_id', id).order('created_at', { ascending: true }),
      supabase.from('feedback_status_logs').select('*').eq('feedback_id', id).order('created_at', { ascending: true }),
      supabase.from('feedback_checklist').select('*').eq('feedback_id', id).order('sort_order', { ascending: true }),
      supabase.from('feedback_watchers').select('*').eq('feedback_id', id).order('created_at', { ascending: true }),
    ]);
    if (commentsResult.error) throw commentsResult.error;
    if (attachmentsResult.error) throw attachmentsResult.error;
    if (logsResult.error) throw logsResult.error;
    if (checklistResult.error) throw checklistResult.error;
    if (watchersResult.error) throw watchersResult.error;

    return {
      item,
      comments: (commentsResult.data || []).map(mapFeedbackCommentFromDb),
      attachments: (attachmentsResult.data || []).map(mapFeedbackAttachmentFromDb),
      statusLogs: (logsResult.data || []).map(mapFeedbackStatusLogFromDb),
      checklist: (checklistResult.data || []).map(mapFeedbackChecklistItemFromDb),
      watchers: (watchersResult.data || []).map(mapFeedbackWatcherFromDb),
    };
  },

  async createItem(input: CreateFeedbackInput): Promise<FeedbackItem> {
    const createdAt = nowIso();
    const actorUserId = await getCurrentFeedbackActorUserId(input.createdBy);
    const id = crypto.randomUUID();
    const payload = {
      id,
      title: input.title.trim(),
      description: input.description.trim(),
      type: input.type,
      module: input.module,
      impact_level: input.impactLevel,
      priority: 'medium',
      status: 'new',
      visibility: input.visibility || 'public',
      created_by: actorUserId,
      assigned_to: null,
      related_route: input.relatedRoute || null,
      device_info: input.deviceInfo || {},
      app_version: input.appVersion || null,
      rejected_reason: null,
      metadata: {},
    };

    if (!isSupabaseConfigured) {
      return mapFeedbackItemFromDb({
        ...payload,
        created_at: createdAt,
        updated_at: createdAt,
        last_activity_at: createdAt,
      });
    }

    const { error } = await supabase
      .from('feedback_items')
      .insert(payload);
    if (error) {
      console.error('Feedback create failed:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      if (/feedback actor profile not found/i.test(error.message || '')) {
        throw new Error('Phiên đăng nhập chưa gắn đúng hồ sơ người dùng. Anh đăng xuất/đăng nhập lại; nếu vẫn lỗi thì cần cập nhật auth_id hoặc email của user.');
      }
      if (error.code === '42501' || /row-level security/i.test(error.message || '')) {
        throw new Error('Không gửi được góp ý do quyền ghi feedback chưa hợp lệ trên Supabase. Em đã log lỗi gốc trong console để kiểm tra tiếp nếu còn xảy ra.');
      }
      throw error;
    }
    return mapFeedbackItemFromDb({
      ...payload,
      created_at: createdAt,
      updated_at: createdAt,
      last_activity_at: createdAt,
      completed_at: null,
      due_at: null,
      target_release: null,
      roadmap_stage: null,
      closed_by: null,
      tags: [],
    });
  },

  async createComment(input: CreateFeedbackCommentInput): Promise<FeedbackComment> {
    const body = input.body.trim();
    if (!body) throw new Error('Nội dung bình luận không được để trống.');
    const actorUserId = await getCurrentFeedbackActorUserId(input.authorUserId);
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    if (!isSupabaseConfigured) {
      return {
        id,
        feedbackId: input.feedbackId,
        authorUserId: actorUserId,
        body,
        isInternal: Boolean(input.isInternal),
        metadata: {},
        createdAt,
        updatedAt: createdAt,
      };
    }

    const payload = {
      id,
      feedback_id: input.feedbackId,
      author_user_id: actorUserId,
      body,
      is_internal: Boolean(input.isInternal),
      metadata: {},
    };
    const { error } = await supabase
      .from('feedback_comments')
      .insert(payload);
    if (error) throw error;
    return mapFeedbackCommentFromDb({
      ...payload,
      created_at: createdAt,
      updated_at: createdAt,
    });
  },

  async uploadAttachment(input: UploadFeedbackAttachmentInput): Promise<FeedbackAttachment> {
    if (!input.feedbackId) throw new Error('Thiếu feedback để upload file.');
    if (!input.uploadedBy) throw new Error('Thiếu người upload file.');
    if (!input.file) throw new Error('Thiếu file đính kèm.');
    if (input.file.size > MAX_FEEDBACK_ATTACHMENT_BYTES) throw new Error('File đính kèm tối đa 25MB.');

    const actorUserId = await getCurrentFeedbackActorUserId(input.uploadedBy);
    const id = crypto.randomUUID();
    const mimeType = input.file.type || 'application/octet-stream';
    const storagePath = buildFeedbackAttachmentStoragePath(input.feedbackId, id, input.file.name || 'attachment');
    const payload = {
      id,
      feedback_id: input.feedbackId,
      comment_id: input.commentId || null,
      uploaded_by: actorUserId,
      storage_bucket: FEEDBACK_ATTACHMENT_BUCKET,
      storage_path: storagePath,
      file_name: input.file.name || 'attachment',
      mime_type: mimeType,
      file_size: input.file.size,
      metadata: {},
    };

    if (!isSupabaseConfigured) {
      return mapFeedbackAttachmentFromDb({ ...payload, created_at: nowIso() });
    }

    const { error: uploadError } = await supabase.storage
      .from(FEEDBACK_ATTACHMENT_BUCKET)
      .upload(storagePath, input.file, {
        contentType: mimeType,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { error } = await supabase
      .from('feedback_attachments')
      .insert(payload);
    if (error) {
      await supabase.storage.from(FEEDBACK_ATTACHMENT_BUCKET).remove([storagePath]);
      throw error;
    }

    return mapFeedbackAttachmentFromDb({ ...payload, created_at: nowIso() });
  },

  async getAttachmentUrl(storagePath: string, expiresIn = 60 * 60): Promise<string> {
    if (!storagePath) throw new Error('Thiếu đường dẫn file đính kèm.');
    if (!isSupabaseConfigured) return storagePath;

    const { data, error } = await supabase.storage
      .from(FEEDBACK_ATTACHMENT_BUCKET)
      .createSignedUrl(storagePath, expiresIn);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error('Không tạo được link xem file.');
    return data.signedUrl;
  },

  async deleteAttachment(attachment: Pick<FeedbackAttachment, 'id' | 'storagePath'>): Promise<void> {
    if (!attachment.id) return;
    if (!isSupabaseConfigured) return;

    if (attachment.storagePath) {
      const { error: storageError } = await supabase
        .storage
        .from(FEEDBACK_ATTACHMENT_BUCKET)
        .remove([attachment.storagePath]);
      if (storageError) throw storageError;
    }

    const { error } = await supabase
      .from('feedback_attachments')
      .delete()
      .eq('id', attachment.id);
    if (error) throw error;
  },

  async watchFeedback(feedbackId: string, userId: string): Promise<FeedbackWatcher> {
    if (!feedbackId || !userId) throw new Error('Thiếu thông tin theo dõi feedback.');
    const actorUserId = await getCurrentFeedbackActorUserId(userId);
    const payload = {
      feedback_id: feedbackId,
      user_id: actorUserId,
      created_by: actorUserId,
    };

    if (!isSupabaseConfigured) {
      return mapFeedbackWatcherFromDb({
        id: crypto.randomUUID(),
        ...payload,
        created_at: nowIso(),
      });
    }

    const { data, error } = await supabase
      .from('feedback_watchers')
      .upsert(payload, { onConflict: 'feedback_id,user_id', ignoreDuplicates: true })
      .select('*')
      .single();
    if (error) {
      if (error.code !== 'PGRST116') throw error;
      const { data: existing, error: existingError } = await supabase
        .from('feedback_watchers')
        .select('*')
        .eq('feedback_id', feedbackId)
        .eq('user_id', actorUserId)
        .single();
      if (existingError) throw existingError;
      return mapFeedbackWatcherFromDb(existing);
    }
    return mapFeedbackWatcherFromDb(data);
  },

  async unwatchFeedback(feedbackId: string, userId: string): Promise<void> {
    if (!feedbackId || !userId || !isSupabaseConfigured) return;
    const actorUserId = await getCurrentFeedbackActorUserId(userId);
    const { error } = await supabase
      .from('feedback_watchers')
      .delete()
      .eq('feedback_id', feedbackId)
      .eq('user_id', actorUserId);
    if (error) throw error;
  },

  async toggleVote(feedbackId: string, userId: string): Promise<boolean> {
    if (!feedbackId || !userId) return false;
    if (!isSupabaseConfigured) return true;
    const actorUserId = await getCurrentFeedbackActorUserId(userId);

    const { data: existing, error: existingError } = await supabase
      .from('feedback_votes')
      .select('id')
      .eq('feedback_id', feedbackId)
      .eq('user_id', actorUserId)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing?.id) {
      const { error } = await supabase
        .from('feedback_votes')
        .delete()
        .eq('id', existing.id);
      if (error) throw error;
      return false;
    }

    const { error } = await supabase
      .from('feedback_votes')
      .insert({ feedback_id: feedbackId, user_id: actorUserId });
    if (error) {
      if (error.code === '23505') return true;
      throw error;
    }
    return true;
  },

  async createChecklistItem(input: CreateFeedbackChecklistInput): Promise<FeedbackChecklistItem> {
    const title = input.title.trim();
    if (!title) throw new Error('Tên checklist không được để trống.');
    const actorUserId = await getCurrentFeedbackActorUserId(input.createdBy);
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    const payload = {
      id,
      feedback_id: input.feedbackId,
      title,
      is_done: false,
      sort_order: input.sortOrder || 0,
      created_by: actorUserId,
      done_by: null,
      done_at: null,
    };

    if (!isSupabaseConfigured) {
      return mapFeedbackChecklistItemFromDb({
        ...payload,
        created_at: createdAt,
        updated_at: createdAt,
      });
    }

    const { error } = await supabase
      .from('feedback_checklist')
      .insert(payload);
    if (error) throw error;
    return mapFeedbackChecklistItemFromDb({
      ...payload,
      created_at: createdAt,
      updated_at: createdAt,
    });
  },

  async updateChecklistItem(id: string, input: UpdateFeedbackChecklistInput): Promise<FeedbackChecklistItem> {
    const payload: Record<string, any> = {};
    if (input.title !== undefined) payload.title = input.title.trim();
    if (input.sortOrder !== undefined) payload.sort_order = input.sortOrder;
    if (input.isDone !== undefined) {
      const actorUserId = input.isDone ? await getCurrentFeedbackActorUserId(input.actorUserId) : null;
      payload.is_done = input.isDone;
      payload.done_by = actorUserId;
      payload.done_at = input.isDone ? nowIso() : null;
    }
    if (Object.keys(payload).length === 0) throw new Error('Không có thay đổi checklist.');

    if (!isSupabaseConfigured) {
      return mapFeedbackChecklistItemFromDb({
        id,
        feedback_id: '',
        title: payload.title || '',
        is_done: payload.is_done || false,
        sort_order: payload.sort_order || 0,
        done_by: payload.done_by || null,
        done_at: payload.done_at || null,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }

    const { data, error } = await supabase
      .from('feedback_checklist')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return mapFeedbackChecklistItemFromDb(data);
  },

  async deleteChecklistItem(id: string): Promise<void> {
    if (!id || !isSupabaseConfigured) return;
    const { error } = await supabase
      .from('feedback_checklist')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  async updateAdminFields(id: string, input: FeedbackAdminUpdateInput): Promise<FeedbackItem> {
    const payload = buildFeedbackAdminUpdatePayload(input);
    if (Object.keys(payload).length === 0) throw new Error('Không có thay đổi để cập nhật.');
    if (!isSupabaseConfigured) {
      return mapFeedbackItemFromDb({
        id,
        title: '',
        description: '',
        type: 'other',
        module: 'other',
        impact_level: 'medium',
        priority: payload.priority || 'medium',
        status: payload.status || 'new',
        visibility: 'public',
        created_by: '',
        device_info: {},
        created_at: nowIso(),
        updated_at: nowIso(),
        last_activity_at: nowIso(),
        ...payload,
      });
    }

    const { data, error } = await supabase
      .from('feedback_items')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return mapFeedbackItemFromDb(data);
  },

  async bulkUpdateAdminFields(ids: string[], input: FeedbackAdminUpdateInput): Promise<FeedbackItem[]> {
    const targetIds = [...new Set(ids.filter(Boolean))];
    if (targetIds.length === 0) return [];
    const payload = buildFeedbackAdminUpdatePayload(input);
    if (Object.keys(payload).length === 0) throw new Error('Không có thay đổi để cập nhật.');
    if (!isSupabaseConfigured) return targetIds.map(id => mapFeedbackItemFromDb({ id, ...payload }));

    const { data, error } = await supabase
      .from('feedback_items')
      .update(payload)
      .in('id', targetIds)
      .select('*');
    if (error) throw error;
    return hydrateFeedbackItems(data || []);
  },
};
