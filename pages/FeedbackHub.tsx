import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bug,
  CalendarDays,
  CheckCircle2,
  CheckSquare2,
  Columns3,
  ClipboardList,
  Clock,
  Download,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Milestone,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Square,
  Sparkles,
  Tag,
  ThumbsUp,
  Trash2,
  Upload,
  Users,
  UserCircle,
  X,
  XCircle,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../context/AppContext';
import { useFeedback } from '../hooks/useFeedback';
import {
  FEEDBACK_MODULES,
  FEEDBACK_PRIORITIES,
  FEEDBACK_ROADMAP_STAGES,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  MAX_FEEDBACK_ATTACHMENTS,
  MAX_FEEDBACK_ATTACHMENT_BYTES,
  FeedbackAdminUpdateInput,
  FeedbackAttachment,
  FeedbackChecklistItem,
  FeedbackItem,
  FeedbackModule,
  FeedbackPriority,
  FeedbackRoadmapStage,
  FeedbackStatus,
  FeedbackType,
  feedbackService,
} from '../lib/feedbackService';
import { feedbackNotificationService } from '../lib/feedbackNotificationService';
import { Role, User } from '../types';

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: 'Báo lỗi',
  ui: 'Giao diện',
  feature: 'Tính năng',
  workflow: 'Quy trình',
  performance: 'Hiệu năng',
  permission: 'Phân quyền',
  data: 'Dữ liệu',
  other: 'Khác',
};

const MODULE_LABELS: Record<FeedbackModule, string> = {
  material: 'Vật tư',
  boq: 'BOQ',
  warehouse: 'Kho',
  project: 'Dự án',
  dashboard: 'Dashboard',
  acceptance: 'Nghiệm thu',
  cost_library: 'Thư viện giá',
  auth: 'Tài khoản',
  mobile: 'Mobile',
  other: 'Khác',
};

const PRIORITY_LABELS: Record<FeedbackPriority, string> = {
  low: 'Thấp',
  medium: 'Vừa',
  high: 'Cao',
  urgent: 'Khẩn',
};

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'Mới',
  received: 'Đã nhận',
  need_clarification: 'Cần làm rõ',
  planned: 'Đã lên kế hoạch',
  in_progress: 'Đang xử lý',
  testing: 'Đang test',
  done: 'Hoàn tất',
  rejected: 'Từ chối',
};

const ROADMAP_STAGE_LABELS: Record<FeedbackRoadmapStage, string> = {
  planned: 'Đã lên kế hoạch',
  in_progress: 'Đang làm',
  testing: 'Đang test',
  done: 'Hoàn tất',
};

const STATUS_STYLES: Record<FeedbackStatus, string> = {
  new: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20',
  received: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20',
  need_clarification: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20',
  planned: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/20',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20',
  testing: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-300 dark:border-cyan-500/20',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20',
};

const PRIORITY_STYLES: Record<FeedbackPriority, string> = {
  low: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  medium: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20',
  high: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/20',
  urgent: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20',
};

type FeedbackTab = 'list' | 'board' | 'dashboard' | 'roadmap';

const FEEDBACK_TABS: Array<{ id: FeedbackTab; label: string; icon: React.ElementType }> = [
  { id: 'list', label: 'Danh sách', icon: ClipboardList },
  { id: 'board', label: 'Board', icon: Columns3 },
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'roadmap', label: 'Roadmap', icon: Milestone },
];

const BOARD_STATUSES: FeedbackStatus[] = ['new', 'received', 'need_clarification', 'planned', 'in_progress', 'testing', 'done', 'rejected'];
const ROADMAP_COLORS = ['#2563eb', '#06b6d4', '#10b981', '#f97316', '#ef4444'];

const typeIcon = (type: FeedbackType) => {
  if (type === 'bug') return <Bug size={14} />;
  if (type === 'feature') return <Sparkles size={14} />;
  return <ClipboardList size={14} />;
};

const compactDate = (value?: string | null) => {
  if (!value) return '';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
};

const fullDate = (value?: string | null) => {
  if (!value) return '';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
};

const dateInputValue = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const formatBytes = (bytes?: number | null) => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const canManageFeedback = (user: User) => (
  user.role === Role.ADMIN
  || (user.adminModules || []).includes('FEEDBACK')
  || Boolean(user.adminSubModules?.FEEDBACK)
);

const notifySafely = (operation: Promise<unknown>) => {
  operation.catch(error => {
    console.warn('Feedback notification failed:', error);
  });
};

const captureDeviceInfo = () => ({
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  language: navigator.language,
  viewport: `${window.innerWidth}x${window.innerHeight}`,
  touchPoints: navigator.maxTouchPoints || 0,
});

const getCurrentRoute = () => {
  const hashPath = window.location.hash.replace(/^#/, '');
  return hashPath || `${window.location.pathname}${window.location.search}`;
};

const getAppVersion = () => (
  import.meta.env.VITE_APP_VERSION
  || import.meta.env.VITE_VERSION
  || import.meta.env.VITE_COMMIT_SHA
  || 'local'
);

const Badge: React.FC<{ children: React.ReactNode; className: string }> = ({ children, className }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-black ${className}`}>
    {children}
  </span>
);

const EmptyState: React.FC<{ title: string; message: string }> = ({ title, message }) => (
  <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/60 p-8 text-center dark:border-slate-700 dark:bg-slate-900/40">
    <MessageSquare className="mb-3 text-slate-300 dark:text-slate-600" size={36} />
    <h3 className="text-sm font-black text-slate-800 dark:text-white">{title}</h3>
    <p className="mt-1 max-w-sm text-xs font-medium text-slate-500 dark:text-slate-400">{message}</p>
  </div>
);

const FeedbackHub: React.FC = () => {
  const { user, users } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const isManager = canManageFeedback(user);
  const {
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
  } = useFeedback(user.id);
  const [showCreate, setShowCreate] = useState(false);
  const [activeTab, setActiveTab] = useState<FeedbackTab>('list');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedId = detail?.item.id || '';

  const userNameById = useMemo(() => new Map(users.map((entry: User) => [entry.id, entry.name])), [users]);
  const submitterOptions = useMemo(() => {
    const ids = new Set(filteredItems.map(item => item.createdBy));
    return users.filter((entry: User) => ids.has(entry.id));
  }, [filteredItems, users]);

  const openItems = filteredItems.filter(item => !['done', 'rejected'].includes(item.status)).length;
  const doneItems = filteredItems.filter(item => item.status === 'done').length;

  useEffect(() => {
    const feedbackId = searchParams.get('feedbackId');
    if (feedbackId && feedbackId !== selectedId) {
      void loadDetail(feedbackId);
    }
  }, [loadDetail, searchParams, selectedId]);

  const openFeedback = async (id: string) => {
    setSearchParams({ feedbackId: id });
    await loadDetail(id);
  };

  const closeDetail = () => {
    setSearchParams({});
    setDetail(null);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(itemId => itemId !== id) : [...prev, id]);
  };

  const clearSelection = () => setSelectedIds([]);

  const handleCreateFeedback = async (
    input: Parameters<ReturnType<typeof useFeedback>['createItem']>[0],
    files: File[],
  ) => {
    const created = await createItem(input);
    for (const file of files) {
      await uploadAttachment({
        feedbackId: created.id,
        uploadedBy: user.id,
        file,
      });
    }
    notifySafely(feedbackNotificationService.notifyCreated({ item: created, users, actorId: user.id }));
    setShowCreate(false);
    setSearchParams({ feedbackId: created.id });
    void loadDetail(created.id).catch(error => {
      console.warn('Feedback detail refresh after create failed:', error);
    });
  };

  const handleCreateComment = async (
    input: Parameters<ReturnType<typeof useFeedback>['createComment']>[0],
    files: File[],
  ) => {
    const currentDetail = detail;
    const comment = await createComment(input);
    for (const file of files) {
      await uploadAttachment({
        feedbackId: input.feedbackId,
        commentId: comment.id,
        uploadedBy: user.id,
        file,
      });
    }
    if (currentDetail?.item) {
      notifySafely(feedbackNotificationService.notifyComment({
        item: currentDetail.item,
        comments: [...currentDetail.comments, comment],
        watchers: currentDetail.watchers,
        users,
        actorId: user.id,
        isInternal: input.isInternal,
      }));
    }
  };

  const handleAdminUpdate = async (id: string, input: FeedbackAdminUpdateInput) => {
    const before = detail?.item || null;
    const after = await updateAdminFields(id, input);
    if (before) {
      notifySafely(feedbackNotificationService.notifyAdminUpdate({
        before,
        after,
        watchers: detail?.watchers || [],
        users,
        actorId: user.id,
      }));
    }
    return after;
  };

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-blue-600 dark:text-blue-300">
            <MessageSquarePlus size={16} />
            Feedback Hub
          </div>
          <h1 className="mt-1 text-2xl font-black text-slate-900 dark:text-white">Trung tâm góp ý & cải tiến</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={loadItems}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            Tải lại
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
          >
            <MessageSquarePlus size={15} />
            Gửi góp ý mới
          </button>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {FEEDBACK_TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-black transition ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Tổng góp ý</p>
          <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{filteredItems.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Đang mở</p>
          <p className="mt-1 text-2xl font-black text-blue-600 dark:text-blue-300">{openItems}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Hoàn tất</p>
          <p className="mt-1 text-2xl font-black text-emerald-600 dark:text-emerald-300">{doneItems}</p>
        </div>
      </section>

      {isManager && selectedIds.length > 0 && (
        <FeedbackBulkBar
          selectedCount={selectedIds.length}
          users={users}
          onClear={clearSelection}
          onApply={async input => {
            await bulkUpdateAdminFields(selectedIds, input);
            clearSelection();
          }}
        />
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="grid gap-2 lg:grid-cols-[minmax(220px,1.4fr)_repeat(5,minmax(120px,1fr))]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={filters.search || ''}
              onChange={event => setFilters(prev => ({ ...prev, search: event.target.value }))}
              placeholder="Tìm theo tiêu đề, mô tả"
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm font-semibold outline-none transition focus:border-blue-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-blue-500"
            />
          </label>
          <FilterSelect label="Trạng thái" value={filters.status || 'all'} onChange={value => setFilters(prev => ({ ...prev, status: value as any }))}>
            <option value="all">Tất cả trạng thái</option>
            {FEEDBACK_STATUSES.map(status => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
          </FilterSelect>
          <FilterSelect label="Loại" value={filters.type || 'all'} onChange={value => setFilters(prev => ({ ...prev, type: value as any }))}>
            <option value="all">Tất cả loại</option>
            {FEEDBACK_TYPES.map(type => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
          </FilterSelect>
          <FilterSelect label="Module" value={filters.module || 'all'} onChange={value => setFilters(prev => ({ ...prev, module: value as any }))}>
            <option value="all">Tất cả module</option>
            {FEEDBACK_MODULES.map(module => <option key={module} value={module}>{MODULE_LABELS[module]}</option>)}
          </FilterSelect>
          <FilterSelect label="Ưu tiên" value={filters.priority || 'all'} onChange={value => setFilters(prev => ({ ...prev, priority: value as any }))}>
            <option value="all">Tất cả ưu tiên</option>
            {FEEDBACK_PRIORITIES.map(priority => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
          </FilterSelect>
          <FilterSelect label="Người gửi" value={filters.createdBy || 'all'} onChange={value => setFilters(prev => ({ ...prev, createdBy: value as any }))}>
            <option value="all">Tất cả người gửi</option>
            {submitterOptions.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </FilterSelect>
        </div>
      </section>

      <div className="grid min-h-[560px] gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <section className="min-w-0">
          {isLoading ? (
            <EmptyState title="Đang tải góp ý" message="Hệ thống đang lấy danh sách mới nhất." />
          ) : activeTab !== 'dashboard' && filteredItems.length === 0 ? (
            <EmptyState title="Chưa có góp ý phù hợp" message="Thử đổi bộ lọc hoặc gửi góp ý mới để bắt đầu vòng cải tiến." />
          ) : activeTab === 'board' ? (
            <FeedbackBoardView
              groups={groupedByStatus}
              users={users}
              canManage={isManager}
              selectedIds={selectedIds}
              activeId={selectedId}
              onOpen={openFeedback}
              onSelect={toggleSelected}
              onStatusChange={async (id, status) => {
                const before = filteredItems.find(item => item.id === id);
                const after = await updateAdminFields(id, { status });
                if (before) {
                  notifySafely(feedbackNotificationService.notifyAdminUpdate({
                    before,
                    after,
                    users,
                    actorId: user.id,
                  }));
                }
              }}
            />
          ) : activeTab === 'dashboard' ? (
            <FeedbackDashboardView metrics={dashboardMetrics} users={users} />
          ) : activeTab === 'roadmap' ? (
            <FeedbackRoadmapView
              items={roadmapItems}
              users={users}
              canManage={isManager}
              activeId={selectedId}
              onOpen={openFeedback}
              onUpdate={handleAdminUpdate}
            />
          ) : (
            <FeedbackListView
              items={filteredItems}
              userNameById={userNameById}
              activeId={selectedId}
              selectedIds={selectedIds}
              canManage={isManager}
              onOpen={openFeedback}
              onSelect={toggleSelected}
            />
          )}
        </section>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <FeedbackDetailPanel
            detail={detail}
            isLoading={isDetailLoading}
            users={users}
            currentUser={user}
            canManage={isManager}
            onClose={closeDetail}
            onVote={toggleVote}
            onToggleWatch={toggleWatch}
            onComment={handleCreateComment}
            onAdminUpdate={handleAdminUpdate}
            onUploadAttachment={uploadAttachment}
            onDeleteAttachment={deleteAttachment}
            onCreateChecklistItem={createChecklistItem}
            onUpdateChecklistItem={updateChecklistItem}
            onDeleteChecklistItem={deleteChecklistItem}
          />
        </aside>
      </div>

      {showCreate && (
        <CreateFeedbackModal
          currentUser={user}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreateFeedback}
        />
      )}
    </div>
  );
};

const FeedbackBulkBar: React.FC<{
  selectedCount: number;
  users: User[];
  onClear: () => void;
  onApply: (input: FeedbackAdminUpdateInput) => Promise<void>;
}> = ({ selectedCount, users, onClear, onApply }) => {
  const [status, setStatus] = useState<FeedbackStatus | ''>('');
  const [priority, setPriority] = useState<FeedbackPriority | ''>('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  const apply = async () => {
    const payload: FeedbackAdminUpdateInput = {};
    if (status) payload.status = status;
    if (priority) payload.priority = priority;
    if (assignedTo !== '') payload.assignedTo = assignedTo || null;
    if (dueAt) payload.dueAt = new Date(dueAt).toISOString();
    if (Object.keys(payload).length === 0) return;

    setIsApplying(true);
    try {
      await onApply(payload);
      setStatus('');
      setPriority('');
      setAssignedTo('');
      setDueAt('');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-blue-200 bg-blue-50 p-3 shadow-sm dark:border-blue-500/20 dark:bg-blue-500/10 lg:flex-row lg:items-end">
      <div className="text-sm font-black text-blue-800 dark:text-blue-200">{selectedCount} góp ý đã chọn</div>
      <div className="grid flex-1 gap-2 sm:grid-cols-4">
        <FormSelect label="Trạng thái" value={status} onChange={value => setStatus(value as FeedbackStatus | '')}>
          <option value="">Giữ trạng thái</option>
          {FEEDBACK_STATUSES.map(option => <option key={option} value={option}>{STATUS_LABELS[option]}</option>)}
        </FormSelect>
        <FormSelect label="Ưu tiên" value={priority} onChange={value => setPriority(value as FeedbackPriority | '')}>
          <option value="">Giữ ưu tiên</option>
          {FEEDBACK_PRIORITIES.map(option => <option key={option} value={option}>{PRIORITY_LABELS[option]}</option>)}
        </FormSelect>
        <FormSelect label="Người xử lý" value={assignedTo} onChange={setAssignedTo}>
          <option value="">Giữ/Chưa assign</option>
          {users.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </FormSelect>
        <label>
          <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">SLA</span>
          <input
            type="date"
            value={dueAt}
            onChange={event => setDueAt(event.target.value)}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button onClick={onClear} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-black text-blue-700 transition hover:bg-blue-50 dark:border-blue-500/20 dark:bg-slate-900 dark:text-blue-300">Bỏ chọn</button>
        <button onClick={apply} disabled={isApplying} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white transition hover:bg-blue-700 disabled:opacity-50">
          {isApplying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          Áp dụng
        </button>
      </div>
    </section>
  );
};

const FeedbackListView: React.FC<{
  items: FeedbackItem[];
  userNameById: Map<string, string>;
  activeId: string;
  selectedIds: string[];
  canManage: boolean;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
}> = ({ items, userNameById, activeId, selectedIds, canManage, onOpen, onSelect }) => (
  <>
    <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 lg:block">
      <table className="w-full table-fixed text-left">
        <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-black uppercase tracking-widest text-slate-400 dark:border-slate-800 dark:bg-slate-800/60">
          <tr>
            {canManage && <th className="w-[4%] px-4 py-3"></th>}
            <th className={`${canManage ? 'w-[32%]' : 'w-[36%]'} px-4 py-3`}>Góp ý</th>
            <th className="w-[14%] px-4 py-3">Module</th>
            <th className="w-[13%] px-4 py-3">Ưu tiên</th>
            <th className="w-[14%] px-4 py-3">Trạng thái</th>
            <th className="w-[13%] px-4 py-3">Người gửi</th>
            <th className="w-[10%] px-4 py-3 text-right">Tương tác</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map(item => (
            <FeedbackRow
              key={item.id}
              item={item}
              active={activeId === item.id}
              selected={selectedIds.includes(item.id)}
              canManage={canManage}
              submitterName={userNameById.get(item.createdBy) || 'Không rõ'}
              onOpen={() => onOpen(item.id)}
              onSelect={() => onSelect(item.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
    <div className="space-y-3 lg:hidden">
      {items.map(item => (
        <FeedbackCard
          key={item.id}
          item={item}
          active={activeId === item.id}
          selected={selectedIds.includes(item.id)}
          canManage={canManage}
          submitterName={userNameById.get(item.createdBy) || 'Không rõ'}
          onOpen={() => onOpen(item.id)}
          onSelect={() => onSelect(item.id)}
        />
      ))}
    </div>
  </>
);

const FilterSelect: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}> = ({ label, value, onChange, children }) => (
  <label className="relative">
    <span className="sr-only">{label}</span>
    <Filter className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
    <select
      value={value}
      onChange={event => onChange(event.target.value)}
      className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-8 text-xs font-black text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-blue-500"
    >
      {children}
    </select>
  </label>
);

const FeedbackRow: React.FC<{
  item: FeedbackItem;
  active: boolean;
  selected: boolean;
  canManage: boolean;
  submitterName: string;
  onOpen: () => void;
  onSelect: () => void;
}> = ({ item, active, selected, canManage, submitterName, onOpen, onSelect }) => (
  <tr
    onClick={onOpen}
    className={`cursor-pointer transition ${active ? 'bg-blue-50/80 dark:bg-blue-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
  >
    {canManage && (
      <td className="px-4 py-3 align-top">
        <input
          type="checkbox"
          checked={selected}
          onChange={event => {
            event.stopPropagation();
            onSelect();
          }}
          onClick={event => event.stopPropagation()}
        />
      </td>
    )}
    <td className="px-4 py-3 align-top">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {typeIcon(item.type)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-slate-900 dark:text-white">{item.title}</p>
          <p className="mt-1 line-clamp-2 text-xs font-medium text-slate-500 dark:text-slate-400">{item.description}</p>
          <div className="mt-2 flex items-center gap-2 text-[11px] font-bold text-slate-400">
            {item.visibility === 'public' ? <Eye size={13} /> : <EyeOff size={13} />}
            {TYPE_LABELS[item.type]} · {compactDate(item.createdAt)}
            {item.dueAt && <> · SLA {compactDate(item.dueAt)}</>}
          </div>
        </div>
      </div>
    </td>
    <td className="px-4 py-3 align-top text-sm font-bold text-slate-600 dark:text-slate-300">{MODULE_LABELS[item.module]}</td>
    <td className="px-4 py-3 align-top"><Badge className={PRIORITY_STYLES[item.priority]}>{PRIORITY_LABELS[item.priority]}</Badge></td>
    <td className="px-4 py-3 align-top"><Badge className={STATUS_STYLES[item.status]}>{STATUS_LABELS[item.status]}</Badge></td>
    <td className="px-4 py-3 align-top text-sm font-bold text-slate-600 dark:text-slate-300">{submitterName}</td>
    <td className="px-4 py-3 text-right align-top">
      <div className="flex justify-end gap-2 text-xs font-black text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1"><ThumbsUp size={13} />{item.voteCount}</span>
        <span className="inline-flex items-center gap-1"><MessageSquare size={13} />{item.commentCount}</span>
        <span className="inline-flex items-center gap-1"><Users size={13} />{item.watcherCount}</span>
      </div>
    </td>
  </tr>
);

const FeedbackCard: React.FC<{
  item: FeedbackItem;
  active: boolean;
  selected: boolean;
  canManage: boolean;
  submitterName: string;
  onOpen: () => void;
  onSelect: () => void;
}> = ({ item, active, selected, canManage, submitterName, onOpen, onSelect }) => (
  <button
    onClick={onOpen}
    className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition dark:bg-slate-900 ${active ? 'border-blue-400 ring-2 ring-blue-500/20' : 'border-slate-200 dark:border-slate-700'}`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {canManage && (
            <input
              type="checkbox"
              checked={selected}
              onChange={event => {
                event.stopPropagation();
                onSelect();
              }}
              onClick={event => event.stopPropagation()}
            />
          )}
          <p className="text-sm font-black text-slate-900 dark:text-white">{item.title}</p>
        </div>
        <p className="mt-1 line-clamp-2 text-xs font-medium text-slate-500 dark:text-slate-400">{item.description}</p>
      </div>
      <Badge className={STATUS_STYLES[item.status]}>{STATUS_LABELS[item.status]}</Badge>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <Badge className="border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{MODULE_LABELS[item.module]}</Badge>
      <Badge className={PRIORITY_STYLES[item.priority]}>{PRIORITY_LABELS[item.priority]}</Badge>
    </div>
    <div className="mt-3 flex items-center justify-between text-[11px] font-black text-slate-400">
      <span>{submitterName} · {compactDate(item.createdAt)}</span>
      <span className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1"><ThumbsUp size={13} />{item.voteCount}</span>
        <span className="inline-flex items-center gap-1"><MessageSquare size={13} />{item.commentCount}</span>
        <span className="inline-flex items-center gap-1"><Users size={13} />{item.watcherCount}</span>
      </span>
    </div>
  </button>
);

const FeedbackBoardView: React.FC<{
  groups: Map<FeedbackStatus, FeedbackItem[]>;
  users: User[];
  canManage: boolean;
  selectedIds: string[];
  activeId: string;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
  onStatusChange: (id: string, status: FeedbackStatus) => Promise<void>;
}> = ({ groups, users, canManage, selectedIds, activeId, onOpen, onSelect, onStatusChange }) => {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<FeedbackStatus | null>(null);
  const userNameById = useMemo(() => new Map(users.map(user => [user.id, user.name])), [users]);

  return (
    <div className="grid gap-3 xl:grid-cols-4">
      {BOARD_STATUSES.map(status => {
        const items = groups.get(status) || [];
        return (
          <section
            key={status}
            onDragOver={event => {
              if (!canManage) return;
              event.preventDefault();
              setDragOverStatus(status);
            }}
            onDragLeave={() => setDragOverStatus(null)}
            onDrop={async event => {
              event.preventDefault();
              if (!canManage || !draggedId) return;
              setDragOverStatus(null);
              await onStatusChange(draggedId, status);
              setDraggedId(null);
            }}
            className={`min-h-[220px] rounded-2xl border bg-slate-50 p-3 dark:bg-slate-900/60 ${dragOverStatus === status ? 'border-blue-400 ring-2 ring-blue-500/20' : 'border-slate-200 dark:border-slate-700'}`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <Badge className={STATUS_STYLES[status]}>{STATUS_LABELS[status]}</Badge>
              <span className="text-xs font-black text-slate-400">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map(item => (
                <div
                  key={item.id}
                  draggable={canManage}
                  onDragStart={() => setDraggedId(item.id)}
                  onDragEnd={() => {
                    setDraggedId(null);
                    setDragOverStatus(null);
                  }}
                  className={`rounded-xl border bg-white p-3 shadow-sm transition dark:bg-slate-900 ${activeId === item.id ? 'border-blue-400 ring-2 ring-blue-500/20' : 'border-slate-200 dark:border-slate-700'} ${draggedId === item.id ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {canManage && (
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        onChange={() => onSelect(item.id)}
                        className="mt-1"
                      />
                    )}
                    <button onClick={() => onOpen(item.id)} className="min-w-0 flex-1 text-left">
                      <p className="line-clamp-2 text-sm font-black text-slate-900 dark:text-white">{item.title}</p>
                      <p className="mt-1 text-[11px] font-bold text-slate-400">{MODULE_LABELS[item.module]} · {userNameById.get(item.createdBy) || 'Không rõ'}</p>
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge className={PRIORITY_STYLES[item.priority]}>{PRIORITY_LABELS[item.priority]}</Badge>
                    {item.dueAt && <Badge className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"><CalendarDays size={12} />{compactDate(item.dueAt)}</Badge>}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-black text-slate-400">
                    <span className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1"><ThumbsUp size={12} />{item.voteCount}</span>
                      <span className="inline-flex items-center gap-1"><MessageSquare size={12} />{item.commentCount}</span>
                      <span className="inline-flex items-center gap-1"><Users size={12} />{item.watcherCount}</span>
                    </span>
                    {canManage && (
                      <select
                        value={item.status}
                        onChange={event => onStatusChange(item.id, event.target.value as FeedbackStatus)}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-black text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        {FEEDBACK_STATUSES.map(option => <option key={option} value={option}>{STATUS_LABELS[option]}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};

const FeedbackDashboardView: React.FC<{
  metrics: ReturnType<typeof useFeedback>['dashboardMetrics'];
  users: User[];
}> = ({ metrics, users }) => {
  const userNameById = useMemo(() => new Map(users.map(user => [user.id, user.name])), [users]);
  const statusData = [
    { name: 'Đang mở', value: metrics.open },
    { name: 'Hoàn tất', value: metrics.done },
    { name: 'Từ chối', value: metrics.rejected },
  ];
  const moduleData = metrics.topModules.map(item => ({ name: MODULE_LABELS[item.module], value: item.count }));

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Tổng" value={metrics.total} />
        <MetricCard label="Đang mở" value={metrics.open} tone="blue" />
        <MetricCard label="Hoàn tất" value={metrics.done} tone="green" />
        <MetricCard label="Bug high/urgent" value={metrics.urgentHighBugs} tone="red" />
        <MetricCard label="Quá SLA" value={metrics.overdue} tone="amber" />
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h3 className="mb-3 text-sm font-black text-slate-900 dark:text-white">Trạng thái</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={3}>
                  {statusData.map((_, index) => <Cell key={index} fill={ROADMAP_COLORS[index % ROADMAP_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h3 className="mb-3 text-sm font-black text-slate-900 dark:text-white">Top module</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={moduleData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#2563eb" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h3 className="mb-3 text-sm font-black text-slate-900 dark:text-white">Top người góp ý</h3>
          <div className="space-y-2">
            {metrics.topContributors.map(entry => (
              <div key={entry.userId} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm font-bold dark:bg-slate-800">
                <span>{userNameById.get(entry.userId) || entry.userId}</span>
                <span className="text-blue-600 dark:text-blue-300">{entry.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h3 className="mb-3 text-sm font-black text-slate-900 dark:text-white">Thời gian xử lý TB</h3>
          <p className="text-3xl font-black text-slate-900 dark:text-white">
            {metrics.averageResolutionHours === null ? '-' : `${metrics.averageResolutionHours}h`}
          </p>
          <p className="mt-2 text-xs font-bold text-slate-400">Tính từ ngày tạo đến `completed_at`.</p>
        </div>
      </section>
    </div>
  );
};

const MetricCard: React.FC<{ label: string; value: number; tone?: 'blue' | 'green' | 'red' | 'amber' }> = ({ label, value, tone }) => {
  const toneClass = tone === 'blue' ? 'text-blue-600 dark:text-blue-300'
    : tone === 'green' ? 'text-emerald-600 dark:text-emerald-300'
      : tone === 'red' ? 'text-red-600 dark:text-red-300'
        : tone === 'amber' ? 'text-amber-600 dark:text-amber-300'
          : 'text-slate-900 dark:text-white';
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-black ${toneClass}`}>{value}</p>
    </div>
  );
};

const FeedbackRoadmapView: React.FC<{
  items: FeedbackItem[];
  users: User[];
  canManage: boolean;
  activeId: string;
  onOpen: (id: string) => void;
  onUpdate: (id: string, input: FeedbackAdminUpdateInput) => Promise<FeedbackItem>;
}> = ({ items, users, canManage, activeId, onOpen, onUpdate }) => {
  const userNameById = useMemo(() => new Map(users.map(user => [user.id, user.name])), [users]);

  return (
    <div className="grid gap-3 xl:grid-cols-4">
      {FEEDBACK_ROADMAP_STAGES.map(stage => {
        const stageItems = items.filter(item => (item.roadmapStage || item.status) === stage);
        return (
          <section key={stage} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800 dark:text-white">{ROADMAP_STAGE_LABELS[stage]}</h3>
              <span className="text-xs font-black text-slate-400">{stageItems.length}</span>
            </div>
            <div className="space-y-2">
              {stageItems.map(item => (
                <div key={item.id} className={`rounded-xl border bg-white p-3 shadow-sm dark:bg-slate-900 ${activeId === item.id ? 'border-blue-400 ring-2 ring-blue-500/20' : 'border-slate-200 dark:border-slate-700'}`}>
                  <button onClick={() => onOpen(item.id)} className="w-full text-left">
                    <p className="line-clamp-2 text-sm font-black text-slate-900 dark:text-white">{item.title}</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-400">{MODULE_LABELS[item.module]} · {userNameById.get(item.createdBy) || 'Không rõ'}</p>
                  </button>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge className={PRIORITY_STYLES[item.priority]}>{PRIORITY_LABELS[item.priority]}</Badge>
                    <span className="inline-flex items-center gap-1 text-[11px] font-black text-slate-400"><ThumbsUp size={12} />{item.voteCount}</span>
                    {item.targetRelease && <Badge className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">{item.targetRelease}</Badge>}
                  </div>
                  {canManage && (
                    <div className="mt-3 grid gap-2">
                      <select
                        value={item.roadmapStage || stage}
                        onChange={event => onUpdate(item.id, { roadmapStage: event.target.value as FeedbackRoadmapStage })}
                        className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-black text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        {FEEDBACK_ROADMAP_STAGES.map(option => <option key={option} value={option}>{ROADMAP_STAGE_LABELS[option]}</option>)}
                      </select>
                      <input
                        defaultValue={item.targetRelease || ''}
                        onBlur={event => {
                          if (event.target.value !== (item.targetRelease || '')) {
                            void onUpdate(item.id, { targetRelease: event.target.value || null });
                          }
                        }}
                        placeholder="Target release"
                        className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-600 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};

const CreateFeedbackModal: React.FC<{
  currentUser: User;
  onClose: () => void;
  onCreate: (input: Parameters<ReturnType<typeof useFeedback>['createItem']>[0], files: File[]) => Promise<void>;
}> = ({ currentUser, onClose, onCreate }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<FeedbackType>('bug');
  const [module, setModule] = useState<FeedbackModule>('other');
  const [impactLevel, setImpactLevel] = useState<FeedbackPriority>('medium');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (title.trim().length < 3 || description.trim().length < 3) {
      setError('Tiêu đề và mô tả cần ít nhất 3 ký tự.');
      return;
    }
    setIsSubmitting(true);
    try {
      await onCreate({
        title,
        description,
        type,
        module,
        impactLevel,
        visibility,
        createdBy: currentUser.id,
        relatedRoute: getCurrentRoute(),
        deviceInfo: captureDeviceInfo(),
        appVersion: getAppVersion(),
      }, files);
    } catch (err: any) {
      setError(err?.message || 'Không gửi được góp ý.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-2xl rounded-t-3xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white">Gửi góp ý mới</h2>
            <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">Mô tả rõ vấn đề hoặc đề xuất để đội xử lý phân loại nhanh hơn.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white">
            <X size={18} />
          </button>
        </div>
        {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
        <div className="space-y-3">
          <input
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder="Tiêu đề góp ý"
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none transition focus:border-blue-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <textarea
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder="Mô tả chi tiết"
            rows={5}
            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium outline-none transition focus:border-blue-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <div className="grid gap-2 sm:grid-cols-4">
            <FormSelect label="Loại" value={type} onChange={value => setType(value as FeedbackType)}>
              {FEEDBACK_TYPES.map(option => <option key={option} value={option}>{TYPE_LABELS[option]}</option>)}
            </FormSelect>
            <FormSelect label="Module" value={module} onChange={value => setModule(value as FeedbackModule)}>
              {FEEDBACK_MODULES.map(option => <option key={option} value={option}>{MODULE_LABELS[option]}</option>)}
            </FormSelect>
            <FormSelect label="Ảnh hưởng" value={impactLevel} onChange={value => setImpactLevel(value as FeedbackPriority)}>
              {FEEDBACK_PRIORITIES.map(option => <option key={option} value={option}>{PRIORITY_LABELS[option]}</option>)}
            </FormSelect>
            <FormSelect label="Hiển thị" value={visibility} onChange={value => setVisibility(value as 'public' | 'private')}>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </FormSelect>
          </div>
          <AttachmentPicker files={files} onChange={setFiles} disabled={isSubmitting} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Hủy</button>
          <button type="submit" disabled={isSubmitting} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-60">
            <Send size={15} />
            {isSubmitting ? 'Đang gửi' : 'Gửi góp ý'}
          </button>
        </div>
      </form>
    </div>
  );
};

const FormSelect: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}> = ({ label, value, onChange, children }) => (
  <label className="block">
    <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
    <select
      value={value}
      onChange={event => onChange(event.target.value)}
      className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-black text-slate-700 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
    >
      {children}
    </select>
  </label>
);

const AttachmentPicker: React.FC<{
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
}> = ({ files, onChange, disabled, compact }) => {
  const [error, setError] = useState<string | null>(null);

  const addFiles = (nextFiles: FileList | null) => {
    setError(null);
    if (!nextFiles || nextFiles.length === 0) return;
    const incoming = Array.from(nextFiles);
    if (files.length + incoming.length > MAX_FEEDBACK_ATTACHMENTS) {
      setError(`Tối đa ${MAX_FEEDBACK_ATTACHMENTS} file.`);
      return;
    }
    const oversized = incoming.find(file => file.size > MAX_FEEDBACK_ATTACHMENT_BYTES);
    if (oversized) {
      setError(`${oversized.name} vượt quá 25MB.`);
      return;
    }
    onChange([...files, ...incoming]);
  };

  return (
    <div className={compact ? 'space-y-2' : 'rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60'}>
      <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 ${disabled ? 'pointer-events-none opacity-60' : ''}`}>
        <Upload size={15} />
        Chọn file đính kèm
        <input
          type="file"
          multiple
          disabled={disabled}
          className="hidden"
          onChange={event => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </label>
      {error && <p className="text-xs font-bold text-red-600 dark:text-red-300">{error}</p>}
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((file, index) => (
            <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <span className="flex min-w-0 items-center gap-2">
                {file.type.startsWith('image/') ? <ImageIcon size={14} /> : <FileText size={14} />}
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-slate-400">{formatBytes(file.size)}</span>
              </span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}
                className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-300"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const FeedbackDetailPanel: React.FC<{
  detail: ReturnType<typeof useFeedback>['detail'];
  isLoading: boolean;
  users: User[];
  currentUser: User;
  canManage: boolean;
  onClose: () => void;
  onVote: (feedbackId: string) => Promise<boolean>;
  onToggleWatch: (feedbackId: string) => Promise<boolean>;
  onComment: (input: Parameters<ReturnType<typeof useFeedback>['createComment']>[0], files: File[]) => Promise<void>;
  onAdminUpdate: (id: string, input: FeedbackAdminUpdateInput) => Promise<FeedbackItem>;
  onUploadAttachment: ReturnType<typeof useFeedback>['uploadAttachment'];
  onDeleteAttachment: ReturnType<typeof useFeedback>['deleteAttachment'];
  onCreateChecklistItem: ReturnType<typeof useFeedback>['createChecklistItem'];
  onUpdateChecklistItem: ReturnType<typeof useFeedback>['updateChecklistItem'];
  onDeleteChecklistItem: ReturnType<typeof useFeedback>['deleteChecklistItem'];
}> = ({
  detail,
  isLoading,
  users,
  currentUser,
  canManage,
  onClose,
  onVote,
  onToggleWatch,
  onComment,
  onAdminUpdate,
  onDeleteAttachment,
  onCreateChecklistItem,
  onUpdateChecklistItem,
  onDeleteChecklistItem,
}) => {
  const [comment, setComment] = useState('');
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [isInternal, setIsInternal] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [adminState, setAdminState] = useState<FeedbackAdminUpdateInput>({});
  const [adminError, setAdminError] = useState<string | null>(null);

  useEffect(() => {
    if (!detail?.item) return;
    setAdminState({
      status: detail.item.status,
      priority: detail.item.priority,
      assignedTo: detail.item.assignedTo || '',
      rejectedReason: detail.item.rejectedReason || '',
      dueAt: dateInputValue(detail.item.dueAt),
      targetRelease: detail.item.targetRelease || '',
      roadmapStage: detail.item.roadmapStage || null,
      tags: detail.item.tags || [],
    });
  }, [detail?.item]);

  const nameOf = (id?: string | null) => users.find(entry => entry.id === id)?.name || 'Không rõ';

  if (isLoading) {
    return <EmptyState title="Đang tải chi tiết" message="Timeline và bình luận đang được cập nhật." />;
  }

  if (!detail) {
    return <EmptyState title="Chọn một góp ý" message="Chi tiết, bình luận, vote và panel xử lý sẽ hiển thị tại đây." />;
  }

  const item = detail.item;
  const canSeeTechInfo = canManage || item.createdBy === currentUser.id;
  const itemAttachments = detail.attachments.filter(attachment => !attachment.commentId);
  const commentAttachments = (commentId: string) => detail.attachments.filter(attachment => attachment.commentId === commentId);

  const submitComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!comment.trim()) return;
    setIsSending(true);
    try {
      await onComment({
        feedbackId: item.id,
        authorUserId: currentUser.id,
        body: comment,
        isInternal,
      }, commentFiles);
      setComment('');
      setCommentFiles([]);
      setIsInternal(false);
    } finally {
      setIsSending(false);
    }
  };

  const submitAdminUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    setAdminError(null);
    if (adminState.status === 'rejected' && !adminState.rejectedReason?.trim()) {
      setAdminError('Cần nhập lý do từ chối.');
      return;
    }
    try {
      await onAdminUpdate(item.id, {
        status: adminState.status,
        priority: adminState.priority,
        assignedTo: adminState.assignedTo || null,
        rejectedReason: adminState.status === 'rejected' ? adminState.rejectedReason : null,
        dueAt: adminState.dueAt ? new Date(adminState.dueAt).toISOString() : null,
        targetRelease: adminState.targetRelease || null,
        roadmapStage: adminState.roadmapStage || null,
        tags: adminState.tags || [],
      });
    } catch (err: any) {
      setAdminError(err?.message || 'Không cập nhật được góp ý.');
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-100 p-4 dark:border-slate-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap gap-2">
              <Badge className={STATUS_STYLES[item.status]}>{STATUS_LABELS[item.status]}</Badge>
              <Badge className={PRIORITY_STYLES[item.priority]}>{PRIORITY_LABELS[item.priority]}</Badge>
            </div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white">{item.title}</h2>
            <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
              {TYPE_LABELS[item.type]} · {MODULE_LABELS[item.module]} · {nameOf(item.createdBy)}
            </p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white">
            <X size={18} />
          </button>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">{item.description}</p>
        {itemAttachments.length > 0 && (
          <div className="mt-4">
            <FeedbackAttachmentList
              attachments={itemAttachments}
              currentUser={currentUser}
              canManage={canManage}
              onDelete={onDeleteAttachment}
            />
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
          <span className="inline-flex items-center gap-1"><Clock size={13} />{fullDate(item.createdAt)}</span>
          <span className="inline-flex items-center gap-1"><Tag size={13} />Ảnh hưởng: {PRIORITY_LABELS[item.impactLevel]}</span>
          <span className="inline-flex items-center gap-1">{item.visibility === 'public' ? <Eye size={13} /> : <EyeOff size={13} />}{item.visibility}</span>
          {item.dueAt && <span className="inline-flex items-center gap-1"><CalendarDays size={13} />SLA: {fullDate(item.dueAt)}</span>}
          {item.roadmapStage && <span className="inline-flex items-center gap-1"><Milestone size={13} />{ROADMAP_STAGE_LABELS[item.roadmapStage]}</span>}
        </div>
        {item.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {item.tags.map(tag => (
              <Badge key={tag} className="border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">#{tag}</Badge>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => onVote(item.id)}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition ${item.hasVoted ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}
          >
            <ThumbsUp size={15} />
            {item.voteCount} vote
          </button>
          <button
            onClick={() => onToggleWatch(item.id)}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition ${item.isWatching ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}
          >
            <Users size={15} />
            {item.watcherCount} theo dõi
          </button>
        </div>
      </div>

      {canManage && (
        <form onSubmit={submitAdminUpdate} className="border-b border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
            <Settings2 size={15} />
            Xử lý
          </div>
          {adminError && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{adminError}</div>}
          <div className="grid gap-2 sm:grid-cols-2">
            <FormSelect label="Trạng thái" value={adminState.status || item.status} onChange={value => setAdminState(prev => ({ ...prev, status: value as FeedbackStatus }))}>
              {FEEDBACK_STATUSES.map(status => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
            </FormSelect>
            <FormSelect label="Ưu tiên" value={adminState.priority || item.priority} onChange={value => setAdminState(prev => ({ ...prev, priority: value as FeedbackPriority }))}>
              {FEEDBACK_PRIORITIES.map(priority => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
            </FormSelect>
            <FormSelect label="Người xử lý" value={adminState.assignedTo || ''} onChange={value => setAdminState(prev => ({ ...prev, assignedTo: value }))}>
              <option value="">Chưa assign</option>
              {users.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </FormSelect>
            <label>
              <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Lý do từ chối</span>
              <input
                value={adminState.rejectedReason || ''}
                onChange={event => setAdminState(prev => ({ ...prev, rejectedReason: event.target.value }))}
                disabled={adminState.status !== 'rejected'}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none transition focus:border-blue-400 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">SLA</span>
              <input
                type="date"
                value={adminState.dueAt || ''}
                onChange={event => setAdminState(prev => ({ ...prev, dueAt: event.target.value }))}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none transition focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <FormSelect label="Roadmap" value={adminState.roadmapStage || ''} onChange={value => setAdminState(prev => ({ ...prev, roadmapStage: (value || null) as FeedbackRoadmapStage | null }))}>
              <option value="">Chưa đưa vào roadmap</option>
              {FEEDBACK_ROADMAP_STAGES.map(stage => <option key={stage} value={stage}>{ROADMAP_STAGE_LABELS[stage]}</option>)}
            </FormSelect>
            <label>
              <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Target release</span>
              <input
                value={adminState.targetRelease || ''}
                onChange={event => setAdminState(prev => ({ ...prev, targetRelease: event.target.value }))}
                placeholder="VD: V3.1 / Tháng 7"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none transition focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Tags</span>
              <input
                value={(adminState.tags || []).join(', ')}
                onChange={event => setAdminState(prev => ({ ...prev, tags: event.target.value.split(',').map(tag => tag.trim()).filter(Boolean) }))}
                placeholder="mobile, ux, sla"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none transition focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>
          </div>
          <button type="submit" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
            <CheckCircle2 size={15} />
            Cập nhật
          </button>
        </form>
      )}

      <div className="max-h-[620px] overflow-y-auto p-4">
        {canSeeTechInfo && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Thông tin kỹ thuật</p>
            <div className="space-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <p>Route: {item.relatedRoute || 'N/A'}</p>
              <p>Version: {item.appVersion || 'N/A'}</p>
              <p>Device: {item.deviceInfo.platform || 'N/A'} · {item.deviceInfo.viewport || 'N/A'}</p>
            </div>
          </div>
        )}

        <FeedbackChecklistPanel
          item={item}
          checklist={detail.checklist}
          canManage={canManage}
          currentUser={currentUser}
          onCreate={onCreateChecklistItem}
          onUpdate={onUpdateChecklistItem}
          onDelete={onDeleteChecklistItem}
        />

        <div className="mb-5">
          <h3 className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">Timeline</h3>
          <div className="space-y-2">
            <TimelineRow icon={<Clock size={14} />} title="Đã tạo góp ý" subtitle={`${nameOf(item.createdBy)} · ${fullDate(item.createdAt)}`} />
            {detail.statusLogs.map(log => (
              <TimelineRow
                key={log.id}
                icon={log.newStatus === 'rejected' ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                title={`${log.oldStatus ? STATUS_LABELS[log.oldStatus] : 'Mới'} → ${STATUS_LABELS[log.newStatus]}`}
                subtitle={`${nameOf(log.changedBy)} · ${fullDate(log.createdAt)}${log.reason ? ` · ${log.reason}` : ''}`}
              />
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">Bình luận</h3>
          <div className="space-y-3">
            {detail.comments.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs font-bold text-slate-400 dark:border-slate-700">Chưa có bình luận.</p>
            ) : detail.comments.map(entry => (
              <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-black text-slate-400">
                  <span className="inline-flex items-center gap-1"><UserCircle size={13} />{nameOf(entry.authorUserId)}</span>
                  <span>{compactDate(entry.createdAt)}</span>
                </div>
                {entry.isInternal && <Badge className="mb-2 border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">Nội bộ</Badge>}
                <p className="whitespace-pre-wrap text-sm font-medium leading-6 text-slate-700 dark:text-slate-300">{entry.body}</p>
                {commentAttachments(entry.id).length > 0 && (
                  <div className="mt-3">
                    <FeedbackAttachmentList
                      attachments={commentAttachments(entry.id)}
                      currentUser={currentUser}
                      canManage={canManage}
                      onDelete={onDeleteAttachment}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <form onSubmit={submitComment} className="mt-3 space-y-2">
            <textarea
              value={comment}
              onChange={event => setComment(event.target.value)}
              placeholder="Viết bình luận"
              rows={3}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium outline-none transition focus:border-blue-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <AttachmentPicker files={commentFiles} onChange={setCommentFiles} disabled={isSending} compact />
            <div className="flex items-center justify-between gap-2">
              {canManage ? (
                <label className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                  <input type="checkbox" checked={isInternal} onChange={event => setIsInternal(event.target.checked)} />
                  Nội bộ
                </label>
              ) : <span />}
              <button disabled={isSending || !comment.trim()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white transition hover:bg-blue-700 disabled:opacity-50">
                <Send size={14} />
                Gửi
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

const FeedbackAttachmentList: React.FC<{
  attachments: FeedbackAttachment[];
  currentUser: User;
  canManage: boolean;
  onDelete: (attachmentId: string) => Promise<void>;
}> = ({ attachments, currentUser, canManage, onDelete }) => {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loadingUrls, setLoadingUrls] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const missing = attachments.filter(attachment => attachment.storagePath && !urls[attachment.storagePath]);
    if (missing.length === 0) return;

    setLoadingUrls(true);
    Promise.all(missing.map(async attachment => {
      const url = await feedbackService.getAttachmentUrl(attachment.storagePath);
      return [attachment.storagePath, url] as const;
    }))
      .then(entries => {
        if (cancelled) return;
        setUrls(prev => ({ ...prev, ...Object.fromEntries(entries) }));
      })
      .catch(error => console.warn('Feedback attachment signed URL failed:', error))
      .finally(() => {
        if (!cancelled) setLoadingUrls(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attachments, urls]);

  if (attachments.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-400">
        <Paperclip size={14} />
        Đính kèm
        {loadingUrls && <Loader2 size={12} className="animate-spin" />}
      </div>
      <div className="grid gap-2">
        {attachments.map(attachment => {
          const url = urls[attachment.storagePath];
          const canDelete = canManage || attachment.uploadedBy === currentUser.id;
          return (
            <div key={attachment.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              {attachment.kind === 'image' && url ? (
                <button type="button" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')} className="block w-full bg-slate-100 text-left dark:bg-slate-800">
                  <img src={url} alt={attachment.fileName} className="max-h-56 w-full object-contain" />
                </button>
              ) : null}
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
                  className="flex min-w-0 items-center gap-2 text-left text-xs font-bold text-slate-600 transition hover:text-blue-600 dark:text-slate-300 dark:hover:text-blue-300"
                >
                  {attachment.kind === 'image' ? <ImageIcon size={15} /> : <FileText size={15} />}
                  <span className="min-w-0 truncate">{attachment.fileName}</span>
                  <span className="shrink-0 text-slate-400">{formatBytes(attachment.fileSize)}</span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={!url}
                    onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40 dark:hover:bg-blue-500/10 dark:hover:text-blue-300"
                  >
                    <Download size={14} />
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      disabled={deletingId === attachment.id}
                      onClick={async () => {
                        setDeletingId(attachment.id);
                        try {
                          await onDelete(attachment.id);
                        } finally {
                          setDeletingId(null);
                        }
                      }}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                    >
                      {deletingId === attachment.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const FeedbackChecklistPanel: React.FC<{
  item: FeedbackItem;
  checklist: FeedbackChecklistItem[];
  canManage: boolean;
  currentUser: User;
  onCreate: ReturnType<typeof useFeedback>['createChecklistItem'];
  onUpdate: ReturnType<typeof useFeedback>['updateChecklistItem'];
  onDelete: ReturnType<typeof useFeedback>['deleteChecklistItem'];
}> = ({ item, checklist, canManage, currentUser, onCreate, onUpdate, onDelete }) => {
  const [title, setTitle] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const doneCount = checklist.filter(entry => entry.isDone).length;

  if (!canManage && checklist.length === 0) return null;

  const addItem = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setIsAdding(true);
    try {
      await onCreate({
        feedbackId: item.id,
        title: nextTitle,
        createdBy: currentUser.id,
        sortOrder: checklist.length === 0 ? 0 : Math.max(...checklist.map(entry => entry.sortOrder)) + 1,
      });
      setTitle('');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
          <ClipboardList size={15} />
          Checklist
        </div>
        <span className="text-[11px] font-black text-slate-400">{doneCount}/{checklist.length}</span>
      </div>
      <div className="space-y-2">
        {checklist.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-3 text-center text-xs font-bold text-slate-400 dark:border-slate-700 dark:bg-slate-900">Chưa có checklist xử lý.</p>
        ) : checklist.map(entry => (
          <div key={entry.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              disabled={!canManage || busyId === entry.id}
              onClick={async () => {
                setBusyId(entry.id);
                try {
                  await onUpdate(entry.id, {
                    isDone: !entry.isDone,
                    actorUserId: currentUser.id,
                  });
                } finally {
                  setBusyId(null);
                }
              }}
              className="shrink-0 text-slate-400 transition hover:text-emerald-600 disabled:opacity-60 dark:hover:text-emerald-300"
            >
              {busyId === entry.id ? <Loader2 size={17} className="animate-spin" /> : entry.isDone ? <CheckSquare2 size={17} /> : <Square size={17} />}
            </button>
            <span className={`min-w-0 flex-1 text-sm font-bold ${entry.isDone ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200'}`}>{entry.title}</span>
            {canManage && (
              <button
                type="button"
                disabled={busyId === entry.id}
                onClick={async () => {
                  setBusyId(entry.id);
                  try {
                    await onDelete(entry.id);
                  } finally {
                    setBusyId(null);
                  }
                }}
                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-500/10 dark:hover:text-red-300"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <form onSubmit={addItem} className="mt-3 flex gap-2">
          <input
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder="Thêm việc cần xử lý"
            className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none transition focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
          <button
            disabled={isAdding || !title.trim()}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {isAdding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          </button>
        </form>
      )}
    </div>
  );
};

const TimelineRow: React.FC<{ icon: React.ReactNode; title: string; subtitle: string }> = ({ icon, title, subtitle }) => (
  <div className="flex gap-3">
    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">{icon}</div>
    <div className="min-w-0">
      <p className="text-sm font-black text-slate-800 dark:text-white">{title}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{subtitle}</p>
    </div>
  </div>
);

export default FeedbackHub;
