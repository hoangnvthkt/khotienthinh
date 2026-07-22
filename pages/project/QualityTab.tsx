import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Edit2,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  User,
  X,
  Download,
} from 'lucide-react';
import { qualityChecklistService } from '../../lib/qualityChecklistService';
import { canReviewQualityChecklist } from '../../lib/qualityChecklistWorkflow';
import { projectStaffService } from '../../lib/projectStaffService';
import { taskService } from '../../lib/projectService';
import { supabase } from '../../lib/supabase';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import {
  Attachment,
  ProjectStaff,
  ProjectSubmissionTarget,
  ProjectTask,
  QualityChecklist,
  QualityChecklistStatus,
  QualitySitePhoto,
  Role,
} from '../../types';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import ProjectRoomSubmissionDialog from '../../components/project/ProjectRoomSubmissionDialog';
import MediaViewer, { MediaItem } from '../../components/project/MediaViewer';
import { EmptyState, MobileCardList, StatusBadge as ErpStatusBadge } from '../../components/erp';

interface QualityTabProps {
  constructionSiteId?: string;
  projectId: string;
  canManageTab?: boolean;
}

type StatusCounts = Record<QualityChecklistStatus, number>;

const ROOT_KEY = '__root__';

type QualityFormSubmissionDraft = {
  editingChecklist: QualityChecklist | null;
  formTask: ProjectTask | null;
  constructionSiteId: string;
  values: {
    title: string;
    workDescription: string;
    workLocation: string;
    workDate: string;
    workSupervisor: string;
    sitePhotos: QualitySitePhoto[];
    attachments: Attachment[];
    note: string;
  };
};

const STATUS_CONFIG: Record<QualityChecklistStatus, {
  label: string;
  chipClass: string;
  dotClass: string;
}> = {
  draft: {
    label: 'Nháp',
    chipClass: 'border-slate-200 bg-slate-50 text-slate-600',
    dotClass: 'bg-slate-400',
  },
  submitted: {
    label: 'Chờ duyệt',
    chipClass: 'border-amber-200 bg-amber-50 text-amber-700',
    dotClass: 'bg-amber-500',
  },
  approved: {
    label: 'Đã duyệt',
    chipClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dotClass: 'bg-emerald-500',
  },
  returned: {
    label: 'Trả lại',
    chipClass: 'border-red-200 bg-red-50 text-red-700',
    dotClass: 'bg-red-500',
  },
  cancelled: {
    label: 'Đã huỷ',
    chipClass: 'border-slate-200 bg-slate-100 text-slate-400',
    dotClass: 'bg-slate-300',
  },
};

const emptyCounts = (): StatusCounts => ({
  draft: 0,
  submitted: 0,
  approved: 0,
  returned: 0,
  cancelled: 0,
});

const todayIso = () => new Date().toISOString().slice(0, 10);

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
};

const clampPercent = (value?: number) => {
  if (!Number.isFinite(value || 0)) return 0;
  return Math.max(0, Math.min(100, Number(value || 0)));
};

const safeStorageFileName = (name: string): string => {
  const safe = name.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'quality-file';
};

const taskLabel = (task?: ProjectTask | null) =>
  task ? `${task.wbsCode ? `${task.wbsCode} - ` : ''}${task.name}` : '-';

const countByStatus = (items: QualityChecklist[]): StatusCounts => {
  const counts = emptyCounts();
  items.forEach(item => {
    counts[item.status || 'draft'] += 1;
  });
  return counts;
};

const getQualityStatusTone = (status?: QualityChecklistStatus) => {
  if (status === 'approved') return 'success';
  if (status === 'submitted') return 'warning';
  if (status === 'returned') return 'danger';
  if (status === 'cancelled') return 'neutral';
  return 'neutral';
};

const MiniStat: React.FC<{
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone?: 'slate' | 'amber' | 'emerald' | 'red' | 'sky';
  active?: boolean;
  onClick?: () => void;
}> = ({ label, value, icon, tone = 'slate', active = false, onClick }) => {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    red: 'border-red-200 bg-red-50 text-red-700',
    sky: 'border-sky-200 bg-sky-50 text-sky-700',
  };
  const className = `w-full rounded-lg border p-3 ${tones[tone]} ${active ? 'ring-2 ring-amber-300 ring-offset-1' : ''} ${onClick ? 'cursor-pointer text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-300' : ''}`;
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase text-slate-400">{label}</span>
        <span className="text-slate-400">{icon}</span>
      </div>
      <div className="mt-1 text-xl font-black">{value}</div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className} aria-pressed={active}>
        {content}
      </button>
    );
  }
  return (
    <div className={className}>
      {content}
    </div>
  );
};

const ProgressBar: React.FC<{ value?: number }> = ({ value }) => {
  const width = clampPercent(value);
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full ${width >= 100 ? 'bg-emerald-500' : width > 0 ? 'bg-amber-500' : 'bg-slate-300'}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
};

const FolderCard: React.FC<{
  task: ProjectTask;
  childCount: number;
  checklists: QualityChecklist[];
  parentPath?: string;
  onOpen: () => void;
}> = ({ task, childCount, checklists, parentPath, onOpen }) => {
  const counts = countByStatus(checklists);
  return (
    <button
      onClick={onOpen}
      className="group rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-amber-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber-100 bg-amber-50 text-amber-600">
            {childCount > 0 ? <FolderOpen size={20} /> : <Folder size={20} />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {task.wbsCode && (
                <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-black text-slate-500">
                  {task.wbsCode}
                </span>
              )}
              <span className="text-[10px] font-black uppercase text-slate-400">
                {childCount} thư mục con
              </span>
            </div>
            <h4 className="mt-1 truncate text-sm font-black text-slate-800 group-hover:text-amber-700" title={task.name}>
              {task.name}
            </h4>
            {parentPath && (
              <p className="mt-1 truncate text-[10px] font-bold text-slate-400" title={parentPath}>
                {parentPath}
              </p>
            )}
          </div>
        </div>
        <ChevronRight size={16} className="mt-1 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-amber-500" />
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-[10px] font-black text-slate-500">
          <span>Tiến độ</span>
          <span>{Math.round(Number(task.progress || 0))}%</span>
        </div>
        <ProgressBar value={task.progress} />
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
          <div className="text-sm font-black text-slate-700">{checklists.length}</div>
          <div className="text-[8px] font-black uppercase text-slate-400">Hồ sơ</div>
        </div>
        <div className="rounded border border-amber-100 bg-amber-50 px-2 py-1.5">
          <div className="text-sm font-black text-amber-700">{counts.submitted}</div>
          <div className="text-[8px] font-black uppercase text-amber-600">Chờ</div>
        </div>
        <div className="rounded border border-emerald-100 bg-emerald-50 px-2 py-1.5">
          <div className="text-sm font-black text-emerald-700">{counts.approved}</div>
          <div className="text-[8px] font-black uppercase text-emerald-600">Duyệt</div>
        </div>
        <div className="rounded border border-red-100 bg-red-50 px-2 py-1.5">
          <div className="text-sm font-black text-red-700">{counts.returned}</div>
          <div className="text-[8px] font-black uppercase text-red-600">Trả</div>
        </div>
      </div>
    </button>
  );
};

const FileIcon: React.FC<{ type?: string }> = ({ type }) => {
  if (type?.startsWith('image/')) return <ImageIcon size={14} />;
  return <FileText size={14} />;
};

const QualityTab: React.FC<QualityTabProps> = ({ constructionSiteId, projectId, canManageTab = true }) => {
  const { user } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const reasonConfirm = useReasonConfirm();
  const siteId = constructionSiteId || '';

  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [checklists, setChecklists] = useState<QualityChecklist[]>([]);
  const [projectStaff, setProjectStaff] = useState<ProjectStaff[]>([]);
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<QualityChecklistStatus | ''>('');
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [showOrphans, setShowOrphans] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [formTask, setFormTask] = useState<ProjectTask | null>(null);
  const [editingChecklist, setEditingChecklist] = useState<QualityChecklist | null>(null);
  const [readonlyForm, setReadonlyForm] = useState(false);
  const [form, setForm] = useState<Partial<QualityChecklist>>({});
  const [saving, setSaving] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  const [submittingChecklist, setSubmittingChecklist] = useState<QualityChecklist | null>(null);
  const [submittingFormDraft, setSubmittingFormDraft] = useState<QualityFormSubmissionDraft | null>(null);

  // States and Callbacks for MediaViewer
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerItems, setViewerItems] = useState<MediaItem[]>([]);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);

  const openImageLightbox = useCallback((clickedUrl: string) => {
    const photos = (form.sitePhotos || []).map(p => ({
      url: p.url,
      name: p.caption || 'Ảnh nghiệm thu',
      type: 'image' as const
    }));

    const imgAttachments = (form.attachments || [])
      .filter(a => {
        const isImgType = a.fileType?.startsWith('image/');
        const isImgExt = /\.(png|jpe?g|gif|webp|svg)$/i.test(a.url);
        return isImgType || isImgExt;
      })
      .map(a => ({
        url: a.url,
        name: a.name || a.fileName || 'Ảnh đính kèm',
        type: 'image' as const
      }));

    const allImages = [...photos, ...imgAttachments];
    const index = allImages.findIndex(img => img.url === clickedUrl);

    setViewerItems(allImages);
    setViewerInitialIndex(index >= 0 ? index : 0);
    setViewerOpen(true);
  }, [form.sitePhotos, form.attachments]);

  const handleAttachmentClick = useCallback((attachment: Attachment) => {
    const isImg = attachment.fileType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(attachment.url);
    if (isImg) {
      openImageLightbox(attachment.url);
    } else {
      const isPdf = attachment.fileType === 'pdf' || attachment.fileType?.includes('pdf') || /\.pdf$/i.test(attachment.url);
      setViewerItems([{
        url: attachment.url,
        name: attachment.name || attachment.fileName || 'Tài liệu',
        type: isPdf ? 'pdf' : 'other'
      }]);
      setViewerInitialIndex(0);
      setViewerOpen(true);
    }
  }, [openImageLightbox]);

  const handleDownloadDirect = useCallback(async (url: string, name: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      window.open(url, '_blank');
    }
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const loadProjectName = async () => {
      try {
        const { data } = await supabase
          .from('projects')
          .select('name')
          .eq('id', projectId)
          .maybeSingle();
        if (alive && data?.name) setProjectName(data.name);
      } catch (error) {
        console.error('Failed to load project name:', error);
      }
    };
    loadProjectName();
    return () => { alive = false; };
  }, [projectId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRows, checklistRows, staffRows] = await Promise.all([
        taskService.list(projectId, siteId || undefined),
        qualityChecklistService.list(projectId, siteId || undefined),
        projectStaffService.listByProject(projectId, siteId || undefined),
      ]);
      setTasks(taskRows);
      setChecklists(checklistRows);
      setProjectStaff(staffRows);
    } catch (error: any) {
      console.error('Failed to load quality module data:', error);
      toast.error('Không tải được dữ liệu chất lượng', error?.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, siteId, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const taskMap = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, ProjectTask[]>();
    tasks.forEach(task => {
      const key = task.parentId || ROOT_KEY;
      map.set(key, [...(map.get(key) || []), task]);
    });
    map.forEach(items => items.sort((a, b) => (a.order || 0) - (b.order || 0) || (a.wbsCode || '').localeCompare(b.wbsCode || '')));
    return map;
  }, [tasks]);

  const taskScopeIdsById = useMemo(() => {
    const cache = new Map<string, Set<string>>();
    const collect = (taskId: string, trail = new Set<string>()): Set<string> => {
      if (cache.has(taskId)) return cache.get(taskId)!;
      if (trail.has(taskId)) return new Set([taskId]);
      const nextTrail = new Set(trail).add(taskId);
      const ids = new Set<string>([taskId]);
      (childrenByParent.get(taskId) || []).forEach(child => {
        collect(child.id, nextTrail).forEach(id => ids.add(id));
      });
      cache.set(taskId, ids);
      return ids;
    };
    tasks.forEach(task => collect(task.id));
    return cache;
  }, [childrenByParent, tasks]);

  const checklistsByTaskId = useMemo(() => {
    const map = new Map<string, QualityChecklist[]>();
    checklists.forEach(item => {
      if (!item.taskId) return;
      map.set(item.taskId, [...(map.get(item.taskId) || []), item]);
    });
    return map;
  }, [checklists]);

  const orphanChecklists = useMemo(
    () => checklists.filter(item => !item.taskId || !taskMap.has(item.taskId)),
    [checklists, taskMap],
  );

  const currentTask = currentTaskId ? taskMap.get(currentTaskId) || null : null;

  useEffect(() => {
    if (currentTaskId && !taskMap.has(currentTaskId)) {
      setCurrentTaskId(null);
      setShowOrphans(false);
    }
  }, [currentTaskId, taskMap]);

  const breadcrumbTasks = useMemo(() => {
    if (!currentTask) return [];
    const path: ProjectTask[] = [];
    const seen = new Set<string>();
    let cursor: ProjectTask | undefined = currentTask;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      path.unshift(cursor);
      cursor = cursor.parentId ? taskMap.get(cursor.parentId) : undefined;
    }
    return path;
  }, [currentTask, taskMap]);

  const getParentPath = useCallback((task: ProjectTask) => {
    const names: string[] = [];
    const seen = new Set<string>();
    let cursor = task.parentId ? taskMap.get(task.parentId) : undefined;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      names.unshift(cursor.wbsCode ? `${cursor.wbsCode} ${cursor.name}` : cursor.name);
      cursor = cursor.parentId ? taskMap.get(cursor.parentId) : undefined;
    }
    return names.join(' / ');
  }, [taskMap]);

  const getAggregateChecklists = useCallback((taskId: string) => {
    const ids = taskScopeIdsById.get(taskId) || new Set([taskId]);
    return checklists.filter(item => item.taskId && ids.has(item.taskId));
  }, [checklists, taskScopeIdsById]);

  const currentChildren = useMemo(() => (
    childrenByParent.get(currentTaskId || ROOT_KEY) || []
  ), [childrenByParent, currentTaskId]);

  const taskMatchesSearch = useCallback((task: ProjectTask, query: string) => {
    if (!query) return true;
    return matchesSearchQueryMultiple([
      task.wbsCode,
      task.name,
      task.assignee,
      task.notes,
      getParentPath(task),
    ], query);
  }, [getParentPath]);

  const checklistMatchesFilters = useCallback((item: QualityChecklist) => {
    if (statusFilter && item.status !== statusFilter) return false;
    const query = search.trim();
    if (!query) return true;
    const task = item.taskId ? taskMap.get(item.taskId) : null;
    return matchesSearchQueryMultiple([
      item.code,
      item.title,
      item.workLocation,
      item.workSupervisor,
      item.note,
      task?.wbsCode,
      task?.name,
    ], query);
  }, [search, statusFilter, taskMap]);

  const filterChecklistRows = useCallback((items: QualityChecklist[]) => (
    items.filter(checklistMatchesFilters)
  ), [checklistMatchesFilters]);

  const getVisibleTaskChecklists = useCallback((task: ProjectTask) => {
    const aggregateRows = getAggregateChecklists(task.id);
    if (!statusFilter) return aggregateRows;

    const query = search.trim();
    const taskMatchedBySearch = taskMatchesSearch(task, query);
    return aggregateRows.filter(item => {
      if (item.status !== statusFilter) return false;
      if (!query || taskMatchedBySearch) return true;
      return checklistMatchesFilters(item);
    });
  }, [checklistMatchesFilters, getAggregateChecklists, search, statusFilter, taskMatchesSearch]);

  const visibleTasks = useMemo(() => {
    const query = search.trim();
    const source = query ? tasks : currentChildren;
    return source
      .filter(task => {
        if (statusFilter) return getVisibleTaskChecklists(task).length > 0;
        return taskMatchesSearch(task, query);
      })
      .sort((a, b) => (a.wbsCode || '').localeCompare(b.wbsCode || '') || (a.order || 0) - (b.order || 0));
  }, [currentChildren, getVisibleTaskChecklists, search, statusFilter, taskMatchesSearch, tasks]);

  const directTaskChecklists = useMemo(
    () => currentTaskId ? (checklistsByTaskId.get(currentTaskId) || []) : [],
    [checklistsByTaskId, currentTaskId],
  );

  const tableRows = useMemo(() => {
    if (showOrphans) return filterChecklistRows(orphanChecklists);
    if (currentTaskId) return filterChecklistRows(directTaskChecklists);
    return [];
  }, [currentTaskId, directTaskChecklists, filterChecklistRows, orphanChecklists, showOrphans]);

  const filteredOrphanChecklists = useMemo(
    () => filterChecklistRows(orphanChecklists),
    [filterChecklistRows, orphanChecklists],
  );

  const globalCounts = useMemo(() => countByStatus(checklists), [checklists]);
  const currentCounts = useMemo(() => countByStatus(directTaskChecklists), [directTaskChecklists]);

  const canEditChecklist = useCallback((checklist: QualityChecklist) => {
    if (!canManageTab) return false;
    if (checklist.status !== 'draft' && checklist.status !== 'returned') return false;
    if (user?.role === Role.ADMIN) return true;
    if (!checklist.createdBy) return true;
    return checklist.createdBy === user?.id || checklist.createdBy === user?.name;
  }, [canManageTab, user?.id, user?.name, user?.role]);

  const canApproveChecklist = useCallback((checklist: QualityChecklist) => {
    if (!canManageTab) return false;
    return canReviewQualityChecklist(checklist, user, projectStaff);
  }, [canManageTab, projectStaff, user]);

  const openTask = (taskId: string) => {
    setCurrentTaskId(taskId);
    setShowOrphans(false);
    setSearch('');
  };

  const openRoot = () => {
    setCurrentTaskId(null);
    setShowOrphans(false);
    setSearch('');
  };

  const openOrphans = () => {
    setCurrentTaskId(null);
    setShowOrphans(true);
    setSearch('');
  };

  const openAllQualityItems = () => {
    setStatusFilter('');
    setCurrentTaskId(null);
    setShowOrphans(false);
    setSearch('');
  };

  const openStatusSummary = (status: QualityChecklistStatus) => {
    setStatusFilter(status);
    setCurrentTaskId(null);
    setShowOrphans(false);
    setSearch('');
  };

  const openUnassignedSummary = () => {
    setStatusFilter('');
    openOrphans();
  };

  const openCreate = (task: ProjectTask) => {
    if (!canManageTab) return;
    const targetSiteId = siteId || task.constructionSiteId || '';
    if (!targetSiteId) {
      toast.error('Thiếu công trường', 'Cần chọn công trường trước khi tạo hồ sơ nghiệm thu.');
      return;
    }
    setFormTask(task);
    setEditingChecklist(null);
    setReadonlyForm(false);
    setForm({
      title: taskLabel(task),
      workDescription: task.notes || task.name,
      workLocation: '',
      workDate: todayIso(),
      workSupervisor: task.assignee || '',
      sitePhotos: [],
      attachments: [],
      note: '',
    });
    setShowForm(true);
  };

  const openChecklist = (checklist: QualityChecklist, readonly = false) => {
    const linkedTask = checklist.taskId ? taskMap.get(checklist.taskId) || null : null;
    setFormTask(linkedTask);
    setEditingChecklist(checklist);
    setReadonlyForm(readonly || !canEditChecklist(checklist));
    setForm({
      ...checklist,
      sitePhotos: checklist.sitePhotos || [],
      attachments: checklist.attachments || [],
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormTask(null);
    setEditingChecklist(null);
    setReadonlyForm(false);
    setForm({});
    setSubmittingFormDraft(null);
  };

  const uploadFiles = async (files: File[], kind: 'photo' | 'attachment') => {
    const folderSiteId = siteId || formTask?.constructionSiteId || 'project';
    const recordId = editingChecklist?.id || `draft-${Date.now()}`;
    const now = new Date().toISOString();
    const uploaded: Array<QualitySitePhoto | Attachment> = [];

    for (const file of files) {
      const path = `quality/${folderSiteId}/${recordId}/${Date.now()}-${crypto.randomUUID()}-${safeStorageFileName(file.name)}`;
      const { error } = await supabase.storage
        .from('project-attachments')
        .upload(path, file, { cacheControl: '3600', upsert: false });
      if (error) throw error;

      const { data } = supabase.storage.from('project-attachments').getPublicUrl(path);
      if (kind === 'photo') {
        uploaded.push({
          url: data.publicUrl,
          caption: file.name,
          category: 'during',
          takenAt: now,
        } as QualitySitePhoto);
      } else {
        uploaded.push({
          id: crypto.randomUUID(),
          name: file.name,
          fileName: file.name,
          url: data.publicUrl,
          fileType: file.type || file.name.split('.').pop(),
          fileSize: file.size,
          category: 'quality_acceptance',
          uploadedAt: now,
          uploadedBy: user?.id || user?.name,
        } as Attachment);
      }
    }

    return uploaded;
  };

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter(file => file.type.startsWith('image/'));
    event.target.value = '';
    if (files.length === 0) return;
    setUploadingPhotos(true);
    try {
      const photos = await uploadFiles(files, 'photo') as QualitySitePhoto[];
      setForm(prev => ({ ...prev, sitePhotos: [...(prev.sitePhotos || []), ...photos] }));
      toast.success('Đã tải ảnh nghiệm thu', `${photos.length} ảnh đã sẵn sàng.`);
    } catch (error: any) {
      toast.error('Không tải được ảnh', error?.message);
    } finally {
      setUploadingPhotos(false);
    }
  };

  const handleAttachmentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;
    setUploadingFiles(true);
    try {
      const attachments = await uploadFiles(files, 'attachment') as Attachment[];
      setForm(prev => ({ ...prev, attachments: [...(prev.attachments || []), ...attachments] }));
      toast.success('Đã tải file đính kèm', `${attachments.length} file đã sẵn sàng.`);
    } catch (error: any) {
      toast.error('Không tải được file', error?.message);
    } finally {
      setUploadingFiles(false);
    }
  };

  const removePhoto = (index: number) => {
    setForm(prev => ({
      ...prev,
      sitePhotos: (prev.sitePhotos || []).filter((_, photoIndex) => photoIndex !== index),
    }));
  };

  const removeAttachment = (index: number) => {
    setForm(prev => ({
      ...prev,
      attachments: (prev.attachments || []).filter((_, attachmentIndex) => attachmentIndex !== index),
    }));
  };

  const buildFormSubmissionDraft = (): QualityFormSubmissionDraft | null => {
    if (readonlyForm) return null;
    const title = String(form.title || '').trim();
    if (!title) {
      toast.error('Thiếu tên hồ sơ', 'Vui lòng nhập tên hồ sơ nghiệm thu.');
      return null;
    }

    if (!editingChecklist && !formTask) {
      toast.error('Chưa chọn hạng mục tiến độ.');
      return null;
    }

    const targetSiteId = siteId || formTask?.constructionSiteId || editingChecklist?.constructionSiteId || '';
    if (!targetSiteId) {
      toast.error('Thiếu công trường', 'Cần chọn công trường trước khi gửi duyệt hồ sơ.');
      return null;
    }

    return {
      editingChecklist,
      formTask,
      constructionSiteId: targetSiteId,
      values: {
        title,
        workDescription: form.workDescription || '',
        workLocation: form.workLocation || '',
        workDate: form.workDate || todayIso(),
        workSupervisor: form.workSupervisor || '',
        sitePhotos: form.sitePhotos || [],
        attachments: form.attachments || [],
        note: form.note || '',
      },
    };
  };

  const handlePrepareFormSubmit = () => {
    const draft = buildFormSubmissionDraft();
    if (draft) setSubmittingFormDraft(draft);
  };

  const handleConfirmFormSubmit = async (target: ProjectSubmissionTarget) => {
    if (!submittingFormDraft) return;
    setSaving(true);
    try {
      if (submittingFormDraft.editingChecklist) {
        await qualityChecklistService.update(submittingFormDraft.editingChecklist.id, submittingFormDraft.values);
        await qualityChecklistService.setStatus(
          submittingFormDraft.editingChecklist.id,
          'submitted',
          user?.id,
          target.note,
          target,
        );
      } else {
        if (!submittingFormDraft.formTask) throw new Error('Chưa chọn hạng mục tiến độ.');
        await qualityChecklistService.createForTask({
          projectId,
          constructionSiteId: submittingFormDraft.constructionSiteId,
          taskId: submittingFormDraft.formTask.id,
          ...submittingFormDraft.values,
          createdBy: user?.id || user?.name,
          submissionTarget: target,
        });
      }
      toast.success('Đã gửi duyệt hồ sơ nghiệm thu');
      setSubmittingFormDraft(null);
      closeForm();
      await loadData();
    } catch (error: any) {
      toast.error('Không gửi được hồ sơ', error?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmSubmit = async (target: ProjectSubmissionTarget) => {
    if (!submittingChecklist) return;
    try {
      await qualityChecklistService.setStatus(
        submittingChecklist.id,
        'submitted',
        user?.id,
        target.note,
        target,
      );
      toast.success('Đã gửi duyệt hồ sơ nghiệm thu');
      setSubmittingChecklist(null);
      await loadData();
    } catch (error: any) {
      toast.error('Không gửi được hồ sơ', error?.message);
    }
  };

  const handleStatusChange = async (checklist: QualityChecklist, status: QualityChecklistStatus) => {
    let reason = '';
    if (status === 'returned' || status === 'cancelled') {
      const result = await reasonConfirm({
        title: status === 'returned' ? 'Trả lại hồ sơ nghiệm thu' : 'Huỷ hồ sơ nghiệm thu',
        targetName: checklist.title,
        warningText: status === 'returned'
          ? 'Người lập hồ sơ sẽ cần bổ sung thông tin trước khi gửi duyệt lại.'
          : 'Hồ sơ sẽ chuyển sang trạng thái đã huỷ.',
        reasonPlaceholder: status === 'returned' ? 'Nhập lý do trả lại...' : 'Nhập lý do huỷ...',
        actionLabel: status === 'returned' ? 'Trả lại' : 'Huỷ hồ sơ',
        intent: 'danger',
        countdownSeconds: 1,
      });
      if (!result?.trim()) return;
      reason = result.trim();
    } else if (status === 'approved') {
      const ok = await confirm({
        title: 'Phê duyệt hồ sơ nghiệm thu',
        targetName: checklist.title,
        warningText: 'Hồ sơ sẽ được đánh dấu đã duyệt trong module Chất lượng.',
        actionLabel: 'Phê duyệt',
        intent: 'success',
        countdownSeconds: 1,
      });
      if (!ok) return;
    }

    try {
      if ((status === 'approved' || status === 'returned') && user?.role !== Role.ADMIN) {
        await projectStaffService.requireProjectPermission({
          userId: user?.id,
          projectId,
          constructionSiteId: siteId || checklist.constructionSiteId,
          code: 'approve',
          actionLabel: status === 'approved' ? 'phê duyệt hồ sơ chất lượng' : 'trả lại hồ sơ chất lượng',
        });
      }
      await qualityChecklistService.setStatus(checklist.id, status, user?.id, reason);
      toast.success(status === 'approved' ? 'Đã phê duyệt hồ sơ' : 'Đã cập nhật trạng thái hồ sơ');
      await loadData();
    } catch (error: any) {
      toast.error('Không cập nhật được trạng thái', error?.message);
    }
  };

  const handleDelete = async (checklist: QualityChecklist) => {
    const ok = await confirm({
      title: 'Xoá hồ sơ nghiệm thu',
      targetName: checklist.title,
      warningText: 'Chỉ nên xoá hồ sơ nháp hoặc hồ sơ nhập sai. Thao tác này không thể hoàn tác.',
      actionLabel: 'Xoá hồ sơ',
      intent: 'danger',
      countdownSeconds: 1,
    });
    if (!ok) return;
    try {
      await qualityChecklistService.remove(checklist.id);
      toast.success('Đã xoá hồ sơ nghiệm thu');
      await loadData();
    } catch (error: any) {
      toast.error('Không xoá được hồ sơ', error?.message);
    }
  };

  const renderChecklistTable = (rows: QualityChecklist[], options?: { showTaskColumn?: boolean }) => {
    if (rows.length === 0) {
      return (
        <EmptyState
          icon={<ClipboardCheck size={18} />}
          title="Chưa có hồ sơ nghiệm thu"
          message="Tạo hồ sơ nghiệm thu cho hạng mục đang chọn để lưu ảnh, file và gửi duyệt."
        />
      );
    }

    return (
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <MobileCardList
          items={rows}
          getKey={item => item.id}
          renderItem={item => {
            const linkedTask = item.taskId ? taskMap.get(item.taskId) : null;
            const firstPhoto = (item.sitePhotos || [])[0];
            const photoCount = (item.sitePhotos || []).length;
            const attachmentCount = (item.attachments || []).length;
            const canEdit = canEditChecklist(item);
            const canApprove = canApproveChecklist(item);
            return (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  {firstPhoto ? (
                    <img src={firstPhoto.url} alt={firstPhoto.caption || item.title} className="h-16 w-20 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
                  ) : (
                    <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-300">
                      <ImageIcon size={20} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] font-black text-slate-400">{item.code}</span>
                      <ErpStatusBadge status={item.status || 'draft'} label={STATUS_CONFIG[item.status || 'draft']?.label} tone={getQualityStatusTone(item.status || 'draft')} />
                    </div>
                    <button onClick={() => openChecklist(item, true)} className="mt-1 line-clamp-2 text-left text-sm font-black text-slate-800">
                      {item.title}
                    </button>
                    {options?.showTaskColumn && (
                      <p className="mt-1 line-clamp-1 text-[10px] font-bold text-slate-400">{taskLabel(linkedTask)}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[10px] font-bold text-slate-500">
                  <div className="rounded bg-slate-50 p-2"><span className="block text-slate-400">Ảnh</span>{photoCount}</div>
                  <div className="rounded bg-slate-50 p-2"><span className="block text-slate-400">File</span>{attachmentCount}</div>
                  <div className="rounded bg-slate-50 p-2"><span className="block text-slate-400">Ngày</span>{formatDate(item.workDate || item.createdAt)}</div>
                </div>

                <div className="flex flex-wrap justify-end gap-1">
                  <button onClick={() => openChecklist(item, true)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-black text-slate-600">Xem</button>
                  {canEdit && <button onClick={() => openChecklist(item)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-black text-slate-600">Sửa</button>}
                  {canEdit && <button onClick={() => setSubmittingChecklist(item)} className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-[10px] font-black text-white">Gửi duyệt</button>}
                  {canApprove && <button onClick={() => handleStatusChange(item, 'returned')} className="rounded-lg border border-red-200 px-2.5 py-1.5 text-[10px] font-black text-red-600">Trả lại</button>}
                  {canApprove && <button onClick={() => handleStatusChange(item, 'approved')} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-black text-white">Duyệt</button>}
                </div>
              </div>
            );
          }}
        />
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2.5">Mã</th>
                <th className="px-3 py-2.5">Hồ sơ nghiệm thu</th>
                {options?.showTaskColumn && <th className="px-3 py-2.5">Hạng mục</th>}
                <th className="px-3 py-2.5">Ảnh</th>
                <th className="px-3 py-2.5">File</th>
                <th className="px-3 py-2.5">Ngày</th>
                <th className="px-3 py-2.5">Trạng thái</th>
                <th className="px-3 py-2.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(item => {
                const linkedTask = item.taskId ? taskMap.get(item.taskId) : null;
                const firstPhoto = (item.sitePhotos || [])[0];
                const photoCount = (item.sitePhotos || []).length;
                const attachmentCount = (item.attachments || []).length;
                const canEdit = canEditChecklist(item);
                const canApprove = canApproveChecklist(item);
                return (
                  <tr key={item.id} className="hover:bg-amber-50/20">
                    <td className="px-3 py-3 align-top">
                      <span className="font-mono text-[11px] font-black text-slate-500">{item.code}</span>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <button
                        onClick={() => openChecklist(item, true)}
                        className="block max-w-[280px] truncate text-left font-black text-slate-800 hover:text-amber-700"
                        title={item.title}
                      >
                        {item.title}
                      </button>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold text-slate-400">
                        {item.workLocation && <span className="inline-flex items-center gap-1"><MapPin size={10} />{item.workLocation}</span>}
                        {item.workSupervisor && <span className="inline-flex items-center gap-1"><User size={10} />{item.workSupervisor}</span>}
                      </div>
                    </td>
                    {options?.showTaskColumn && (
                      <td className="px-3 py-3 align-top">
                        <span className="block max-w-[220px] truncate font-bold text-slate-600" title={taskLabel(linkedTask)}>
                          {taskLabel(linkedTask)}
                        </span>
                      </td>
                    )}
                    <td className="px-3 py-3 align-top">
                      {firstPhoto ? (
                        <div className="flex items-center gap-2">
                          <img src={firstPhoto.url} alt={firstPhoto.caption || item.title} className="h-10 w-14 rounded object-cover ring-1 ring-slate-200" />
                          <span className="text-[10px] font-black text-slate-500">{photoCount}</span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded border border-slate-100 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-400">
                          <ImageIcon size={12} /> 0
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <span className="inline-flex items-center gap-1 rounded border border-slate-100 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-500">
                        <Paperclip size={12} /> {attachmentCount}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-top font-bold text-slate-500">{formatDate(item.workDate || item.createdAt)}</td>
                    <td className="px-3 py-3 align-top">
                      <ErpStatusBadge status={item.status || 'draft'} label={STATUS_CONFIG[item.status || 'draft']?.label} tone={getQualityStatusTone(item.status || 'draft')} />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openChecklist(item, true)}
                          title="Xem hồ sơ"
                          className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <Eye size={14} />
                        </button>
                        {canEdit && (
                          <>
                            <button
                              onClick={() => openChecklist(item)}
                              title="Sửa hồ sơ"
                              className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => setSubmittingChecklist(item)}
                              title="Gửi duyệt"
                              className="rounded p-2 text-amber-600 hover:bg-amber-50"
                            >
                              <Send size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(item)}
                              title="Xoá hồ sơ"
                              className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                        {canApprove && (
                          <>
                            <button
                              onClick={() => handleStatusChange(item, 'returned')}
                              title="Trả lại"
                              className="rounded p-2 text-red-600 hover:bg-red-50"
                            >
                              <RotateCcw size={14} />
                            </button>
                            <button
                              onClick={() => handleStatusChange(item, 'approved')}
                              title="Phê duyệt"
                              className="rounded p-2 text-emerald-600 hover:bg-emerald-50"
                            >
                              <CheckCircle2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={22} className="animate-spin text-amber-500" />
        <span className="ml-3 text-sm font-bold text-slate-500">Đang tải module chất lượng...</span>
      </div>
    );
  }

  const orphanCounts = countByStatus(filteredOrphanChecklists);
  const pageTitle = showOrphans
    ? 'Chưa gắn hạng mục'
    : currentTask
      ? currentTask.name
      : 'Thư mục hạng mục tiến độ';
  const searchMode = !!search.trim();

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase text-amber-600">
              <ShieldCheck size={14} />
              Module Chất lượng
            </div>
            <h2 className="mt-1 truncate text-xl font-black text-slate-900">{pageTitle}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs font-bold text-slate-500">
              <button onClick={openRoot} className="rounded px-1.5 py-1 hover:bg-slate-100 hover:text-amber-700">
                {projectName || 'Dự án'}
              </button>
              {breadcrumbTasks.map(task => (
                <React.Fragment key={task.id}>
                  <ChevronRight size={13} className="text-slate-300" />
                  <button
                    onClick={() => openTask(task.id)}
                    className={`max-w-[220px] truncate rounded px-1.5 py-1 hover:bg-slate-100 hover:text-amber-700 ${task.id === currentTaskId ? 'text-slate-800' : ''}`}
                    title={taskLabel(task)}
                  >
                    {task.wbsCode || task.name}
                  </button>
                </React.Fragment>
              ))}
              {showOrphans && (
                <>
                  <ChevronRight size={13} className="text-slate-300" />
                  <span className="rounded px-1.5 py-1 text-slate-800">Chưa gắn hạng mục</span>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[520px]">
            <MiniStat
              label="Tổng hồ sơ"
              value={checklists.length}
              icon={<ClipboardCheck size={15} />}
              active={!statusFilter && !showOrphans && !currentTaskId}
              onClick={openAllQualityItems}
            />
            <MiniStat
              label="Chờ duyệt"
              value={globalCounts.submitted}
              icon={<Clock size={15} />}
              tone="amber"
              active={statusFilter === 'submitted' && !showOrphans}
              onClick={() => openStatusSummary('submitted')}
            />
            <MiniStat
              label="Đã duyệt"
              value={globalCounts.approved}
              icon={<CheckCircle2 size={15} />}
              tone="emerald"
              active={statusFilter === 'approved' && !showOrphans}
              onClick={() => openStatusSummary('approved')}
            />
            <MiniStat
              label="Chưa gắn"
              value={orphanChecklists.length}
              icon={<AlertCircle size={15} />}
              tone={orphanChecklists.length ? 'red' : 'slate'}
              active={showOrphans}
              onClick={openUnassignedSummary}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {(currentTask || showOrphans) && (
            <button
              onClick={currentTask?.parentId ? () => openTask(currentTask.parentId!) : openRoot}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
            >
              <ArrowLeft size={14} /> Quay lại
            </button>
          )}
          <div className="relative min-w-0 flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Tìm WBS, hạng mục, hồ sơ..."
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-xs font-bold outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={event => setStatusFilter(event.target.value as QualityChecklistStatus | '')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 outline-none focus:border-amber-300"
          >
            <option value="">Tất cả trạng thái</option>
            {Object.entries(STATUS_CONFIG).map(([status, config]) => (
              <option key={status} value={status}>{config.label}</option>
            ))}
          </select>
          {orphanChecklists.length > 0 && !showOrphans && (
            <button
              onClick={openOrphans}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100"
            >
              <AlertCircle size={14} /> Chưa gắn
            </button>
          )}
        </div>
      </div>

      {currentTask && !showOrphans && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {currentTask.wbsCode && (
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] font-black text-slate-600">
                    WBS {currentTask.wbsCode}
                  </span>
                )}
                <span className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-500">
                  {currentChildren.length} thư mục con
                </span>
              </div>
              <h3 className="mt-2 text-lg font-black text-slate-900">{currentTask.name}</h3>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-slate-500">
                <span className="inline-flex items-center gap-1"><Calendar size={12} />{formatDate(currentTask.startDate)} - {formatDate(currentTask.endDate)}</span>
                {currentTask.assignee && <span className="inline-flex items-center gap-1"><User size={12} />{currentTask.assignee}</span>}
              </div>
              <div className="mt-3 max-w-md">
                <div className="mb-1 flex items-center justify-between text-[10px] font-black text-slate-500">
                  <span>Tiến độ hạng mục</span>
                  <span>{Math.round(Number(currentTask.progress || 0))}%</span>
                </div>
                <ProgressBar value={currentTask.progress} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <MiniStat label="Tại hạng mục" value={directTaskChecklists.length} icon={<ClipboardCheck size={15} />} tone="sky" />
              <MiniStat label="Chờ duyệt" value={currentCounts.submitted} icon={<Clock size={15} />} tone="amber" />
              <MiniStat label="Đã duyệt" value={currentCounts.approved} icon={<CheckCircle2 size={15} />} tone="emerald" />
              {canManageTab && (
                <button
                  onClick={() => openCreate(currentTask)}
                  className="inline-flex min-h-[72px] items-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-xs font-black text-white shadow-sm hover:bg-amber-600"
                >
                  <Plus size={16} /> Tạo hồ sơ nghiệm thu
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {!showOrphans && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-black text-slate-800">
              {searchMode ? 'Kết quả hạng mục' : currentTask ? 'Thư mục con' : 'Thư mục hạng mục'}
            </h3>
            <span className="text-[10px] font-black uppercase text-slate-400">{visibleTasks.length} hạng mục</span>
          </div>

          {visibleTasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
              <Folder size={30} className="mx-auto text-slate-300" />
              <p className="mt-2 text-sm font-black text-slate-500">Không có hạng mục phù hợp</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleTasks.map(task => (
                <FolderCard
                  key={task.id}
                  task={task}
                  childCount={(childrenByParent.get(task.id) || []).length}
                  checklists={statusFilter ? getVisibleTaskChecklists(task) : getAggregateChecklists(task.id)}
                  parentPath={searchMode ? getParentPath(task) : undefined}
                  onOpen={() => openTask(task.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {(currentTask || showOrphans) && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-black text-slate-800">
              {showOrphans ? 'Hồ sơ chưa gắn hạng mục' : 'Hồ sơ nghiệm thu của hạng mục'}
            </h3>
            <span className="text-[10px] font-black uppercase text-slate-400">{tableRows.length} hồ sơ</span>
          </div>
          {renderChecklistTable(tableRows, { showTaskColumn: showOrphans })}
        </section>
      )}

      {!currentTask && !showOrphans && filteredOrphanChecklists.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-black text-slate-800">Chưa gắn hạng mục</h3>
            <button onClick={openOrphans} className="text-xs font-black text-red-600 hover:text-red-700">
              Xem {filteredOrphanChecklists.length} hồ sơ
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <MiniStat label="Tổng" value={filteredOrphanChecklists.length} icon={<AlertCircle size={15} />} tone="red" />
            <MiniStat label="Nháp" value={orphanCounts.draft} icon={<Clock size={15} />} />
            <MiniStat label="Chờ duyệt" value={orphanCounts.submitted} icon={<Send size={15} />} tone="amber" />
            <MiniStat label="Đã duyệt" value={orphanCounts.approved} icon={<CheckCircle2 size={15} />} tone="emerald" />
            <MiniStat label="Trả lại" value={orphanCounts.returned} icon={<RotateCcw size={15} />} tone="red" />
          </div>
        </section>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-6">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase text-amber-600">
                  {readonlyForm ? 'Xem hồ sơ nghiệm thu' : editingChecklist ? 'Cập nhật hồ sơ nghiệm thu' : 'Tạo hồ sơ nghiệm thu'}
                </div>
                <h3 className="mt-1 truncate text-base font-black text-slate-900">
                  {form.title || taskLabel(formTask)}
                </h3>
                {formTask && (
                  <p className="mt-0.5 truncate text-xs font-bold text-slate-500">{taskLabel(formTask)}</p>
                )}
              </div>
              <button onClick={closeForm} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Tên hồ sơ *</label>
                    <input
                      value={form.title || ''}
                      onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))}
                      readOnly={readonlyForm}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100 read-only:bg-slate-50"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Mô tả công việc</label>
                    <textarea
                      rows={3}
                      value={form.workDescription || ''}
                      onChange={event => setForm(prev => ({ ...prev, workDescription: event.target.value }))}
                      readOnly={readonlyForm}
                      className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100 read-only:bg-slate-50"
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Vị trí</label>
                      <input
                        value={form.workLocation || ''}
                        onChange={event => setForm(prev => ({ ...prev, workLocation: event.target.value }))}
                        readOnly={readonlyForm}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold outline-none focus:border-amber-300 read-only:bg-slate-50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Ngày nghiệm thu</label>
                      <input
                        type="date"
                        value={form.workDate || ''}
                        onChange={event => setForm(prev => ({ ...prev, workDate: event.target.value }))}
                        readOnly={readonlyForm}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold outline-none focus:border-amber-300 read-only:bg-slate-50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Giám sát</label>
                      {readonlyForm ? (
                        <input
                          value={form.workSupervisor || ''}
                          readOnly
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold outline-none"
                        />
                      ) : projectStaff.length > 0 ? (
                        <select
                          value={form.workSupervisor || ''}
                          onChange={event => setForm(prev => ({ ...prev, workSupervisor: event.target.value }))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold outline-none focus:border-amber-300"
                        >
                          <option value="">- Chọn giám sát -</option>
                          {projectStaff.map(staff => (
                            <option key={staff.id} value={staff.userName || staff.userId || ''}>
                              {staff.userName || staff.userId}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={form.workSupervisor || ''}
                          onChange={event => setForm(prev => ({ ...prev, workSupervisor: event.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold outline-none focus:border-amber-300"
                        />
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Ghi chú</label>
                    <textarea
                      rows={3}
                      value={form.note || ''}
                      onChange={event => setForm(prev => ({ ...prev, note: event.target.value }))}
                      readOnly={readonlyForm}
                      className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100 read-only:bg-slate-50"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-black text-slate-800">Ảnh nghiệm thu</h4>
                        <p className="text-[10px] font-bold text-slate-400">{(form.sitePhotos || []).length} ảnh</p>
                      </div>
                      {!readonlyForm && (
                        <>
                          <input id="quality-photo-upload" type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />
                          <label
                            htmlFor="quality-photo-upload"
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
                          >
                            {uploadingPhotos ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                            Ảnh
                          </label>
                        </>
                      )}
                    </div>
                    {(form.sitePhotos || []).length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center">
                        <ImageIcon size={24} className="mx-auto text-slate-300" />
                        <p className="mt-2 text-xs font-bold text-slate-400">Chưa có ảnh</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {(form.sitePhotos || []).map((photo, index) => (
                          <div
                            key={`${photo.url}-${index}`}
                            onClick={() => openImageLightbox(photo.url)}
                            className="group relative cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-slate-50 transition hover:border-amber-400"
                          >
                            <img
                              src={photo.url}
                              alt={photo.caption || `Ảnh ${index + 1}`}
                              className="h-28 w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                            <div className="absolute inset-x-0 bottom-0 bg-slate-950/55 px-2 py-1 text-[10px] font-bold text-white">
                              <span className="block truncate">{photo.caption || `Ảnh ${index + 1}`}</span>
                            </div>
                            {!readonlyForm && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removePhoto(index);
                                }}
                                className="absolute right-1 top-1 rounded bg-white/90 p-1 text-red-500 opacity-0 shadow-sm transition group-hover:opacity-100 z-10"
                                title="Xoá ảnh"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-black text-slate-800">File đính kèm</h4>
                        <p className="text-[10px] font-bold text-slate-400">{(form.attachments || []).length} file</p>
                      </div>
                      {!readonlyForm && (
                        <>
                          <input id="quality-file-upload" type="file" multiple onChange={handleAttachmentUpload} className="hidden" />
                          <label
                            htmlFor="quality-file-upload"
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
                          >
                            {uploadingFiles ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                            File
                          </label>
                        </>
                      )}
                    </div>
                    {(form.attachments || []).length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center">
                        <Paperclip size={24} className="mx-auto text-slate-300" />
                        <p className="mt-2 text-xs font-bold text-slate-400">Chưa có file</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(form.attachments || []).map((attachment, index) => (
                          <div key={attachment.id || `${attachment.url}-${index}`} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                            <span className="text-slate-400"><FileIcon type={attachment.fileType} /></span>
                            <button
                              type="button"
                              onClick={() => handleAttachmentClick(attachment)}
                              className="min-w-0 flex-1 text-left truncate text-xs font-black text-slate-700 hover:text-amber-700"
                            >
                              {attachment.name || attachment.fileName || `File ${index + 1}`}
                            </button>
                            {attachment.fileSize !== undefined && (
                              <span className="text-[10px] font-bold text-slate-400 shrink-0">{Math.ceil(attachment.fileSize / 1024)} KB</span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadDirect(attachment.url, attachment.name || attachment.fileName || 'File');
                              }}
                              className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
                              title="Tải xuống"
                            >
                              <Download size={13} />
                            </button>
                            {!readonlyForm && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeAttachment(index);
                                }}
                                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                title="Xoá file"
                              >
                                <X size={13} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-5 py-4">
              <div className="text-[10px] font-bold text-slate-400">
                {editingChecklist ? `${editingChecklist.code} · ${STATUS_CONFIG[editingChecklist.status]?.label || editingChecklist.status}` : 'Gửi duyệt hồ sơ mới'}
              </div>
              <div className="flex gap-2">
                <button onClick={closeForm} className="rounded-lg px-4 py-2 text-xs font-black text-slate-500 hover:bg-white">
                  Đóng
                </button>
                {!readonlyForm && (
                  <button
                    onClick={handlePrepareFormSubmit}
                    disabled={saving || uploadingPhotos || uploadingFiles}
                    className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-black text-white hover:bg-amber-600 disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Gửi duyệt
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {submittingFormDraft && (
        <ProjectRoomSubmissionDialog
          title="Gửi duyệt hồ sơ nghiệm thu"
          actionLabel="Gửi duyệt"
          documentLabel="HỒ SƠ CHẤT LƯỢNG"
          documentName={submittingFormDraft.values.title}
          documentSubtitle={submittingFormDraft.editingChecklist
            ? `${submittingFormDraft.editingChecklist.code} · ${taskLabel(submittingFormDraft.formTask)}`
            : taskLabel(submittingFormDraft.formTask)}
          details={[
            { label: 'Ảnh nghiệm thu', value: `${submittingFormDraft.values.sitePhotos.length} ảnh` },
            { label: 'File đính kèm', value: `${submittingFormDraft.values.attachments.length} file` },
          ]}
          projectId={projectId}
          constructionSiteId={submittingFormDraft.constructionSiteId}
          recipientRoomCode="quality"
          recipientAction="approve"
          recipientHint="Chọn người thuộc Room Chất lượng có quyền duyệt hồ sơ."
          onCancel={() => setSubmittingFormDraft(null)}
          onConfirm={handleConfirmFormSubmit}
        />
      )}

      {submittingChecklist && (
        <ProjectRoomSubmissionDialog
          title="Gửi duyệt hồ sơ nghiệm thu"
          actionLabel="Gửi duyệt"
          documentLabel="HỒ SƠ CHẤT LƯỢNG"
          documentName={submittingChecklist.title}
          documentSubtitle={`${submittingChecklist.code} · ${taskLabel(submittingChecklist.taskId ? taskMap.get(submittingChecklist.taskId) : null)}`}
          details={[
            { label: 'Ảnh nghiệm thu', value: `${(submittingChecklist.sitePhotos || []).length} ảnh` },
            { label: 'File đính kèm', value: `${(submittingChecklist.attachments || []).length} file` },
          ]}
          projectId={projectId}
          constructionSiteId={siteId || null}
          recipientRoomCode="quality"
          recipientAction="approve"
          recipientHint="Chọn người thuộc Room Chất lượng có quyền duyệt hồ sơ."
          onCancel={() => setSubmittingChecklist(null)}
          onConfirm={handleConfirmSubmit}
        />
      )}

      <MediaViewer
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
        items={viewerItems}
        initialIndex={viewerInitialIndex}
      />
    </div>
  );
};

export default QualityTab;
