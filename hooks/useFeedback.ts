import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CreateFeedbackCommentInput,
  CreateFeedbackChecklistInput,
  CreateFeedbackInput,
  FeedbackAdminUpdateInput,
  FeedbackDetail,
  FeedbackFilters,
  FeedbackItem,
  UpdateFeedbackChecklistInput,
  UploadFeedbackAttachmentInput,
  buildFeedbackDashboardMetrics,
  getFeedbackRoadmapItems,
  groupFeedbackByStatus,
  feedbackService,
  filterFeedbackItems,
} from '../lib/feedbackService';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

const DEFAULT_FILTERS: FeedbackFilters = {
  search: '',
  status: 'all',
  type: 'all',
  module: 'all',
  priority: 'all',
  createdBy: 'all',
};

export const useFeedback = (actorUserId?: string | null) => {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [detail, setDetail] = useState<FeedbackDetail | null>(null);
  const [filters, setFilters] = useState<FeedbackFilters>(DEFAULT_FILTERS);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detailIdRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextItems = await feedbackService.listItems(actorUserId);
      setItems(nextItems);
    } catch (err: any) {
      setError(err?.message || 'Không tải được danh sách góp ý.');
    } finally {
      setIsLoading(false);
    }
  }, [actorUserId]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null);
      return null;
    }
    setIsDetailLoading(true);
    setError(null);
    try {
      const nextDetail = await feedbackService.getDetail(id, actorUserId);
      setDetail(nextDetail);
      detailIdRef.current = nextDetail?.item.id || null;
      return nextDetail;
    } catch (err: any) {
      setError(err?.message || 'Không tải được chi tiết góp ý.');
      throw err;
    } finally {
      setIsDetailLoading(false);
    }
  }, [actorUserId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    detailIdRef.current = detail?.item.id || null;
  }, [detail?.item.id]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const tables = [
      'feedback_items',
      'feedback_comments',
      'feedback_votes',
      'feedback_checklist',
      'feedback_attachments',
      'feedback_status_logs',
      'feedback_watchers',
    ];
    const channel = supabase.channel(`feedback-hub-${actorUserId || 'anonymous'}`);
    const scheduleRefresh = (payload: any) => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        void loadItems();
        const detailId = detailIdRef.current;
        const changedFeedbackId = payload?.new?.feedback_id || payload?.old?.feedback_id || payload?.new?.id || payload?.old?.id;
        if (detailId && (!changedFeedbackId || changedFeedbackId === detailId)) {
          void loadDetail(detailId);
        }
      }, 500);
    };

    tables.forEach(table => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefresh);
    });
    channel.subscribe();

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [actorUserId, loadDetail, loadItems]);

  const filteredItems = useMemo(() => filterFeedbackItems(items, filters), [items, filters]);
  const groupedByStatus = useMemo(() => groupFeedbackByStatus(filteredItems), [filteredItems]);
  const dashboardMetrics = useMemo(() => buildFeedbackDashboardMetrics(items), [items]);
  const roadmapItems = useMemo(() => getFeedbackRoadmapItems(filteredItems), [filteredItems]);

  const createItem = useCallback(async (input: CreateFeedbackInput) => {
    const created = await feedbackService.createItem(input);
    setItems(prev => [created, ...prev]);
    setDetail({ item: created, comments: [], attachments: [], statusLogs: [], checklist: [], watchers: [] });
    return created;
  }, []);

  const createComment = useCallback(async (input: CreateFeedbackCommentInput) => {
    const comment = await feedbackService.createComment(input);
    setDetail(prev => prev && prev.item.id === input.feedbackId
      ? {
          ...prev,
          item: { ...prev.item, commentCount: prev.item.commentCount + 1, lastActivityAt: new Date().toISOString() },
          comments: [...prev.comments, comment],
        }
      : prev);
    setItems(prev => prev.map(item => item.id === input.feedbackId
      ? { ...item, commentCount: item.commentCount + 1, lastActivityAt: new Date().toISOString() }
      : item));
    return comment;
  }, []);

  const uploadAttachment = useCallback(async (input: UploadFeedbackAttachmentInput) => {
    const attachment = await feedbackService.uploadAttachment(input);
    setDetail(prev => prev && prev.item.id === input.feedbackId
      ? { ...prev, attachments: [...prev.attachments, attachment] }
      : prev);
    setItems(prev => prev.map(item => item.id === input.feedbackId
      ? { ...item, lastActivityAt: new Date().toISOString() }
      : item));
    return attachment;
  }, []);

  const deleteAttachment = useCallback(async (attachmentId: string) => {
    const attachment = detail?.attachments.find(item => item.id === attachmentId);
    if (!attachment) return;
    await feedbackService.deleteAttachment(attachment);
    setDetail(prev => prev
      ? { ...prev, attachments: prev.attachments.filter(item => item.id !== attachmentId) }
      : prev);
  }, [detail?.attachments]);

  const toggleVote = useCallback(async (feedbackId: string) => {
    if (!actorUserId) return false;
    const item = items.find(entry => entry.id === feedbackId) || detail?.item;
    const wasVoted = Boolean(item?.hasVoted);
    const optimisticHasVoted = !wasVoted;
    const optimisticDelta = optimisticHasVoted ? 1 : -1;

    setItems(prev => prev.map(entry => entry.id === feedbackId
      ? { ...entry, hasVoted: optimisticHasVoted, voteCount: Math.max(0, entry.voteCount + optimisticDelta) }
      : entry));
    setDetail(prev => prev && prev.item.id === feedbackId
      ? { ...prev, item: { ...prev.item, hasVoted: optimisticHasVoted, voteCount: Math.max(0, prev.item.voteCount + optimisticDelta) } }
      : prev);

    try {
      const hasVoted = await feedbackService.toggleVote(feedbackId, actorUserId);
      setItems(prev => prev.map(entry => entry.id === feedbackId
        ? {
            ...entry,
            hasVoted,
            voteCount: Math.max(0, entry.voteCount + (hasVoted === entry.hasVoted ? 0 : (hasVoted ? 1 : -1))),
          }
        : entry));
      setDetail(prev => prev && prev.item.id === feedbackId
        ? {
            ...prev,
            item: {
              ...prev.item,
              hasVoted,
              voteCount: Math.max(0, prev.item.voteCount + (hasVoted === prev.item.hasVoted ? 0 : (hasVoted ? 1 : -1))),
            },
          }
        : prev);
      return hasVoted;
    } catch (err) {
      setItems(prev => prev.map(entry => entry.id === feedbackId
        ? { ...entry, hasVoted: wasVoted, voteCount: Math.max(0, entry.voteCount - optimisticDelta) }
        : entry));
      setDetail(prev => prev && prev.item.id === feedbackId
        ? { ...prev, item: { ...prev.item, hasVoted: wasVoted, voteCount: Math.max(0, prev.item.voteCount - optimisticDelta) } }
        : prev);
      throw err;
    }
  }, [actorUserId, detail?.item, items]);

  const updateAdminFields = useCallback(async (id: string, input: FeedbackAdminUpdateInput) => {
    const updated = await feedbackService.updateAdminFields(id, input);
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...updated } : item));
    await loadDetail(id);
    return updated;
  }, [loadDetail]);

  const bulkUpdateAdminFields = useCallback(async (ids: string[], input: FeedbackAdminUpdateInput) => {
    const updatedItems = await feedbackService.bulkUpdateAdminFields(ids, input);
    setItems(prev => prev.map(item => updatedItems.find(updated => updated.id === item.id) || item));
    const detailId = detailIdRef.current;
    if (detailId && ids.includes(detailId)) await loadDetail(detailId);
    return updatedItems;
  }, [loadDetail]);

  const toggleWatch = useCallback(async (feedbackId: string) => {
    if (!actorUserId) return false;
    const item = items.find(entry => entry.id === feedbackId) || detail?.item;
    const nextWatching = !item?.isWatching;
    if (nextWatching) {
      const watcher = await feedbackService.watchFeedback(feedbackId, actorUserId);
      setDetail(prev => prev && prev.item.id === feedbackId
        ? {
            ...prev,
            item: { ...prev.item, isWatching: true, watcherCount: prev.item.isWatching ? prev.item.watcherCount : prev.item.watcherCount + 1 },
            watchers: prev.watchers.some(entry => entry.userId === actorUserId) ? prev.watchers : [...prev.watchers, watcher],
          }
        : prev);
    } else {
      await feedbackService.unwatchFeedback(feedbackId, actorUserId);
      setDetail(prev => prev && prev.item.id === feedbackId
        ? {
            ...prev,
            item: { ...prev.item, isWatching: false, watcherCount: Math.max(0, prev.item.watcherCount - 1) },
            watchers: prev.watchers.filter(entry => entry.userId !== actorUserId),
          }
        : prev);
    }
    setItems(prev => prev.map(entry => entry.id === feedbackId
      ? { ...entry, isWatching: nextWatching, watcherCount: Math.max(0, entry.watcherCount + (nextWatching ? 1 : -1)) }
      : entry));
    return nextWatching;
  }, [actorUserId, detail?.item, items]);

  const createChecklistItem = useCallback(async (input: CreateFeedbackChecklistInput) => {
    const checklistItem = await feedbackService.createChecklistItem(input);
    setDetail(prev => prev && prev.item.id === input.feedbackId
      ? { ...prev, checklist: [...prev.checklist, checklistItem].sort((a, b) => a.sortOrder - b.sortOrder) }
      : prev);
    return checklistItem;
  }, []);

  const updateChecklistItem = useCallback(async (id: string, input: UpdateFeedbackChecklistInput) => {
    const checklistItem = await feedbackService.updateChecklistItem(id, input);
    setDetail(prev => prev
      ? { ...prev, checklist: prev.checklist.map(item => item.id === id ? checklistItem : item).sort((a, b) => a.sortOrder - b.sortOrder) }
      : prev);
    return checklistItem;
  }, []);

  const deleteChecklistItem = useCallback(async (id: string) => {
    await feedbackService.deleteChecklistItem(id);
    setDetail(prev => prev
      ? { ...prev, checklist: prev.checklist.filter(item => item.id !== id) }
      : prev);
  }, []);

  return {
    items,
    filteredItems,
    groupedByStatus,
    dashboardMetrics,
    roadmapItems,
    detail,
    filters,
    isLoading,
    isDetailLoading,
    error,
    setFilters,
    setDetail,
    loadItems,
    loadDetail,
    createItem,
    createComment,
    uploadAttachment,
    deleteAttachment,
    toggleVote,
    toggleWatch,
    updateAdminFields,
    bulkUpdateAdminFields,
    createChecklistItem,
    updateChecklistItem,
    deleteChecklistItem,
  };
};
