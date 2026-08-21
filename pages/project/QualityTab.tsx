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
  Filter,
} from 'lucide-react';
import { qualityChecklistService } from '../../lib/qualityChecklistService';
import { projectStaffService } from '../../lib/projectStaffService';
import { projectPermissionRoomService } from '../../lib/projectPermissionRoomService';
import {
  getQualityChecklistCapabilities,
  getQualityRoomCapabilities,
} from '../../lib/qualityRoomCapabilities';
import { loadQualityGanttCatalog } from '../../lib/projectGanttCatalogAdapters';
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
} from '../../types';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import ProjectRoomSubmissionDialog from '../../components/project/ProjectRoomSubmissionDialog';
import MediaViewer, { MediaItem } from '../../components/project/MediaViewer';
import { EmptyState, StatusBadge as ErpStatusBadge } from '../../components/erp';

interface QualityTabProps {
  constructionSiteId?: string;
  projectId: string;
}

type StatusCounts = Record<QualityChecklistStatus, number>;

type QualitySubTab = 'actions' | 'all' | 'wbs_tree';

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
    chipClass: 'border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-400',
    dotClass: 'bg-zinc-400',
  },
  submitted: {
    label: 'Chờ duyệt',
    chipClass: 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/50 dark:bg-teal-950/40 dark:text-teal-300',
    dotClass: 'bg-teal-600',
  },
  approved: {
    label: 'Đã duyệt',
    chipClass: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300',
    dotClass: 'bg-emerald-600',
  },
  returned: {
    label: 'Trả lại',
    chipClass: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300',
    dotClass: 'bg-red-500',
  },
  cancelled: {
    label: 'Đã huỷ',
    chipClass: 'border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-500',
    dotClass: 'bg-zinc-300',
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

const ProgressBar: React.FC<{ value?: number }> = ({ value }) => {
  const width = clampPercent(value);
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800">
      <div
        className={`h-full rounded-full transition-all duration-300 ${width >= 100 ? 'bg-emerald-600' : width > 0 ? 'bg-teal-600' : 'bg-slate-300 dark:bg-zinc-700'}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
};

const FileIcon: React.FC<{ type?: string }> = ({ type }) => {
  if (type?.startsWith('image/')) return <ImageIcon size={14} />;
  return <FileText size={14} />;
};

const QualityTab: React.FC<QualityTabProps> = ({ constructionSiteId, projectId }) => {
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
  const [permissionLoading, setPermissionLoading] = useState(true);
  const [qualityRoomActions, setQualityRoomActions] = useState<Set<string>>(new Set());

  // SubTab Navigation State
  const [subTab, setSubTab] = useState<QualitySubTab>('all');
  const [actionQueueFilter, setActionQueueFilter] = useState<'all_queue' | 'submitted' | 'returned' | 'draft'>('all_queue');

  // Filter & Search State
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<QualityChecklistStatus | ''>('');
  const [selectedWbsFilter, setSelectedWbsFilter] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 15;

  // WBS Tree navigation State
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [showOrphans, setShowOrphans] = useState(false);

  // Form State
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

  const qualityCapabilities = useMemo(
    () => getQualityRoomCapabilities(qualityRoomActions),
    [qualityRoomActions],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRows, checklistRows, staffRows] = await Promise.all([
        loadQualityGanttCatalog({
          projectId,
          constructionSiteId: siteId || null,
        }).then(catalog => catalog.tasks),
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

  const loadQualityRoomAccess = useCallback(async () => {
    setPermissionLoading(true);
    try {
      const actions = await projectPermissionRoomService.listMyActions(projectId, siteId || null);
      const qualityActions = new Set(actions
        .filter(action => action.roomCode === 'quality')
        .map(action => action.actionCode));
      setQualityRoomActions(qualityActions);
      if (qualityActions.has('view')) {
        await loadData();
      } else {
        setTasks([]);
        setChecklists([]);
        setProjectStaff([]);
        setLoading(false);
      }
    } catch (error: any) {
      console.error('Failed to load Quality Room permissions:', error);
      setQualityRoomActions(new Set());
      setLoading(false);
      toast.error('Không tải được quyền Room Chất lượng', error?.message);
    } finally {
      setPermissionLoading(false);
    }
  }, [loadData, projectId, siteId, toast]);

  useEffect(() => {
    loadQualityRoomAccess();
  }, [loadQualityRoomAccess]);

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
      getParentPath(task),
    ], query);
  }, [getParentPath]);

  const checklistMatchesFilters = useCallback((item: QualityChecklist) => {
    if (statusFilter && item.status !== statusFilter) return false;
    if (selectedWbsFilter) {
      if (selectedWbsFilter === '__orphan__' && item.taskId && taskMap.has(item.taskId)) return false;
      if (selectedWbsFilter !== '__orphan__' && item.taskId !== selectedWbsFilter) return false;
    }
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
  }, [search, selectedWbsFilter, statusFilter, taskMap]);

  const filterChecklistRows = useCallback((items: QualityChecklist[]) => (
    items.filter(checklistMatchesFilters)
  ), [checklistMatchesFilters]);

  const globalCounts = useMemo(() => countByStatus(checklists), [checklists]);

  // Action Queue Items: Checklists requiring action
  const queueItems = useMemo(() => {
    return checklists.filter(item => {
      const caps = getQualityChecklistCapabilities(qualityCapabilities, item.status);
      const isPendingApprove = item.status === 'submitted' && caps.canApprove;
      const isReturnedMyDraft = item.status === 'returned' && (caps.canSubmit || item.createdBy === user?.id || item.createdBy === user?.name);
      const isMyDraft = item.status === 'draft' && (item.createdBy === user?.id || item.createdBy === user?.name || caps.canSubmit);
      return isPendingApprove || isReturnedMyDraft || isMyDraft;
    });
  }, [checklists, qualityCapabilities, user]);

  const filteredQueueItems = useMemo(() => {
    if (actionQueueFilter === 'all_queue') return queueItems;
    return queueItems.filter(item => item.status === actionQueueFilter);
  }, [actionQueueFilter, queueItems]);

  const queueCounts = useMemo(() => countByStatus(queueItems), [queueItems]);

  const allFilteredChecklists = useMemo(() => {
    return filterChecklistRows(checklists);
  }, [checklists, filterChecklistRows]);

  const totalPages = Math.max(1, Math.ceil(allFilteredChecklists.length / ITEMS_PER_PAGE));
  const paginatedChecklists = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return allFilteredChecklists.slice(start, start + ITEMS_PER_PAGE);
  }, [allFilteredChecklists, currentPage]);

  const canEditChecklist = useCallback((checklist: QualityChecklist) => {
    return getQualityChecklistCapabilities(qualityCapabilities, checklist.status).canEdit;
  }, [qualityCapabilities]);

  const canSubmitChecklist = useCallback((checklist: QualityChecklist) => {
    return getQualityChecklistCapabilities(qualityCapabilities, checklist.status).canSubmit;
  }, [qualityCapabilities]);

  const canDeleteChecklist = useCallback((checklist: QualityChecklist) => {
    return getQualityChecklistCapabilities(qualityCapabilities, checklist.status).canDelete;
  }, [qualityCapabilities]);

  const canApproveChecklist = useCallback((checklist: QualityChecklist) => {
    return getQualityChecklistCapabilities(qualityCapabilities, checklist.status).canApprove;
  }, [qualityCapabilities]);

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

  const openCreate = (task?: ProjectTask | null) => {
    if (!qualityCapabilities.canEdit) return;
    const targetSiteId = siteId || task?.constructionSiteId || '';
    if (!targetSiteId && !siteId) {
      toast.error('Thiếu công trường', 'Cần chọn công trường trước khi tạo hồ sơ nghiệm thu.');
      return;
    }
    setFormTask(task || null);
    setEditingChecklist(null);
    setReadonlyForm(false);
    setForm({
      title: task ? taskLabel(task) : '',
      workDescription: task?.name || '',
      workLocation: '',
      workDate: todayIso(),
      workSupervisor: user?.name || '',
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
      const path = `quality/${projectId}/${folderSiteId}/${recordId}/${Date.now()}-${crypto.randomUUID()}-${safeStorageFileName(file.name)}`;
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
    if (!qualityCapabilities.canSubmit) return;
    const draft = buildFormSubmissionDraft();
    if (draft) setSubmittingFormDraft(draft);
  };

  const handleSaveDraft = async () => {
    const draft = buildFormSubmissionDraft();
    if (!draft || !qualityCapabilities.canEdit) return;
    setSaving(true);
    try {
      if (draft.editingChecklist) {
        await qualityChecklistService.update(draft.editingChecklist.id, draft.values);
      } else {
        if (!draft.formTask) throw new Error('Chưa chọn hạng mục tiến độ.');
        await qualityChecklistService.createForTask({
          projectId,
          constructionSiteId: draft.constructionSiteId,
          taskId: draft.formTask.id,
          ...draft.values,
          createdBy: user?.id || user?.name,
          submissionTarget: null,
        });
      }
      toast.success('Đã lưu nháp hồ sơ nghiệm thu');
      closeForm();
      await loadData();
    } catch (error: any) {
      toast.error('Không lưu được hồ sơ', error?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmFormSubmit = async (target: ProjectSubmissionTarget) => {
    if (!submittingFormDraft || !qualityCapabilities.canSubmit) return;
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
    if (!submittingChecklist || !canSubmitChecklist(submittingChecklist)) return;
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
      await qualityChecklistService.setStatus(checklist.id, status, user?.id, reason);
      toast.success(status === 'approved' ? 'Đã phê duyệt hồ sơ' : 'Đã cập nhật trạng thái hồ sơ');
      await loadData();
    } catch (error: any) {
      toast.error('Không cập nhật được trạng thái', error?.message);
    }
  };

  const handleDelete = async (checklist: QualityChecklist) => {
    if (!canDeleteChecklist(checklist)) return;
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

  if (permissionLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={22} className="animate-spin text-teal-600" />
        <span className="ml-3 text-sm font-bold text-slate-500">Đang tải quyền Room Chất lượng...</span>
      </div>
    );
  }

  if (!qualityCapabilities.canView) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 px-6 py-10 text-center dark:border-red-900/50 dark:bg-red-950/30">
        <AlertCircle size={28} className="mx-auto text-red-600" />
        <h2 className="mt-3 text-base font-bold text-red-800 dark:text-red-200">Bạn không có quyền xem Room Chất lượng</h2>
        <p className="mt-1 text-sm text-red-700 dark:text-red-300">Quyền truy cập được quản lý theo dự án và công trường hiện tại.</p>
        <button
          type="button"
          onClick={loadQualityRoomAccess}
          className="mt-5 inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950"
        >
          <RotateCcw size={15} /> Tải lại quyền
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={22} className="animate-spin text-teal-600" />
        <span className="ml-3 text-sm font-bold text-slate-500">Đang tải module chất lượng...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* HEADER TỔNG THỂ */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/50 dark:text-teal-400 border border-teal-100 dark:border-teal-900/40">
              <ShieldCheck size={24} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-black text-slate-800 dark:text-white truncate">
                  Quản lý Chất lượng & Nghiệm thu
                </h2>
                <span className="rounded-md bg-teal-50 dark:bg-teal-950/40 px-2 py-0.5 text-[10px] font-black uppercase text-teal-700 dark:text-teal-300 border border-teal-200/60 dark:border-teal-900/40">
                  {checklists.length} hồ sơ
                </span>
              </div>
              <p className="text-xs font-semibold text-slate-400 truncate">
                {projectName || 'Dự án'} • Giám sát, lập biên bản, lưu ảnh hiện trường và phê duyệt nghiệm thu
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {qualityCapabilities.canEdit && (
              <button
                onClick={() => openCreate(currentTask || tasks[0] || null)}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 px-4 py-2.5 text-xs font-black text-white shadow-md shadow-teal-600/20 transition active:scale-95 whitespace-nowrap"
              >
                <Plus size={15} /> Tạo hồ sơ nghiệm thu
              </button>
            )}
          </div>
        </div>

        {/* Dải chỉ số KPI */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 pt-3 border-t border-slate-100 dark:border-slate-800/80">
          <button
            onClick={() => { setSubTab('all'); setStatusFilter(''); setSelectedWbsFilter(''); }}
            className={`p-2.5 rounded-xl border text-left transition ${!statusFilter && subTab === 'all' ? 'border-teal-500 bg-teal-50/40 dark:bg-teal-950/30 ring-1 ring-teal-500' : 'border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60 bg-slate-50/50 dark:bg-slate-900/50'}`}
          >
            <div className="text-[10px] font-bold text-slate-400 uppercase">Tổng hồ sơ</div>
            <div className="text-base font-black text-slate-800 dark:text-white">{checklists.length}</div>
          </button>
          <button
            onClick={() => { setSubTab('actions'); setActionQueueFilter('submitted'); }}
            className={`p-2.5 rounded-xl border text-left transition ${actionQueueFilter === 'submitted' && subTab === 'actions' ? 'border-teal-500 bg-teal-50/40 dark:bg-teal-950/30 ring-1 ring-teal-500' : 'border-teal-100/70 hover:bg-teal-50/30 dark:border-teal-900/40 bg-teal-50/20 dark:bg-teal-950/20'}`}
          >
            <div className="text-[10px] font-bold text-teal-600 dark:text-teal-400 uppercase">Chờ duyệt</div>
            <div className="text-base font-black text-teal-700 dark:text-teal-300">{globalCounts.submitted}</div>
          </button>
          <button
            onClick={() => { setSubTab('all'); setStatusFilter('approved'); }}
            className={`p-2.5 rounded-xl border text-left transition ${statusFilter === 'approved' && subTab === 'all' ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/30 ring-1 ring-emerald-500' : 'border-emerald-100/70 hover:bg-emerald-50/30 dark:border-emerald-900/40 bg-emerald-50/20 dark:bg-emerald-950/20'}`}
          >
            <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Đã duyệt</div>
            <div className="text-base font-black text-emerald-700 dark:text-emerald-300">{globalCounts.approved}</div>
          </button>
          <button
            onClick={() => { setSubTab('actions'); setActionQueueFilter('returned'); }}
            className={`p-2.5 rounded-xl border text-left transition ${actionQueueFilter === 'returned' && subTab === 'actions' ? 'border-rose-500 bg-rose-50/40 dark:bg-rose-950/30 ring-1 ring-rose-500' : 'border-rose-100/70 hover:bg-rose-50/30 dark:border-rose-900/40 bg-rose-50/20 dark:bg-rose-950/20'}`}
          >
            <div className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase">Trả lại / Cần sửa</div>
            <div className="text-base font-black text-rose-700 dark:text-rose-300">{globalCounts.returned}</div>
          </button>
        </div>
      </div>

      {/* SEGMENTED SUB-TABS */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-6 px-2 text-xs font-black">
        <button
          onClick={() => setSubTab('actions')}
          className={`pb-3 relative flex items-center gap-2 transition-colors ${subTab === 'actions' ? 'text-teal-700 dark:text-teal-400 font-black' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'}`}
        >
          <ShieldCheck size={16} />
          <span>Cần tôi xử lý</span>
          {queueItems.length > 0 && (
            <span className="rounded-full bg-amber-500 text-white text-[10px] px-1.5 py-0.2 font-mono">
              {queueItems.length}
            </span>
          )}
          {subTab === 'actions' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />}
        </button>

        <button
          onClick={() => setSubTab('all')}
          className={`pb-3 relative flex items-center gap-2 transition-colors ${subTab === 'all' ? 'text-teal-700 dark:text-teal-400 font-black' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'}`}
        >
          <FileText size={16} />
          <span>Tất cả hồ sơ nghiệm thu</span>
          <span className="rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] px-1.5 py-0.2 font-mono">
            {checklists.length}
          </span>
          {subTab === 'all' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />}
        </button>

        <button
          onClick={() => setSubTab('wbs_tree')}
          className={`pb-3 relative flex items-center gap-2 transition-colors ${subTab === 'wbs_tree' ? 'text-teal-700 dark:text-teal-400 font-black' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'}`}
        >
          <Folder size={16} />
          <span>Theo Cây Hạng mục WBS</span>
          {subTab === 'wbs_tree' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />}
        </button>
      </div>

      {/* 1. SUB-TAB: CẦN TÔI XỬ LÝ (ACTION QUEUE) */}
      {subTab === 'actions' && (
        <div className="space-y-4">
          {/* Action Queue Filter Pills */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setActionQueueFilter('all_queue')}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${actionQueueFilter === 'all_queue' ? 'bg-teal-600 text-white shadow-xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}
              >
                Tất cả cần làm ({queueItems.length})
              </button>
              <button
                onClick={() => setActionQueueFilter('submitted')}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${actionQueueFilter === 'submitted' ? 'bg-teal-600 text-white shadow-xs' : 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 hover:bg-teal-100/50'}`}
              >
                Chờ thẩm định ({queueCounts.submitted})
              </button>
              <button
                onClick={() => setActionQueueFilter('returned')}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${actionQueueFilter === 'returned' ? 'bg-rose-600 text-white shadow-xs' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100/50'}`}
              >
                Bị trả lại cần sửa ({queueCounts.returned})
              </button>
              <button
                onClick={() => setActionQueueFilter('draft')}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${actionQueueFilter === 'draft' ? 'bg-slate-700 text-white shadow-xs' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200'}`}
              >
                Bản nháp ({queueCounts.draft})
              </button>
            </div>
          </div>

          {filteredQueueItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/20 dark:border-emerald-900/40 dark:bg-emerald-950/10 p-10 text-center">
              <CheckCircle2 size={36} className="mx-auto text-emerald-500" />
              <h4 className="mt-3 text-sm font-black text-emerald-800 dark:text-emerald-300">
                Tuyệt vời! Không có hồ sơ nào đang chờ bạn xử lý
              </h4>
              <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                Toàn bộ hồ sơ nghiệm thu đã được xem xét hoặc chuyển bước thành công.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredQueueItems.map(item => {
                const linkedTask = item.taskId ? taskMap.get(item.taskId) : null;
                const photoCount = (item.sitePhotos || []).length;
                const fileCount = (item.attachments || []).length;
                const firstPhoto = (item.sitePhotos || [])[0];
                const canEdit = canEditChecklist(item);
                const canSubmit = canSubmitChecklist(item);
                const canDelete = canDeleteChecklist(item);
                const canApprove = canApproveChecklist(item);

                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs hover:border-teal-400 dark:border-slate-800 dark:bg-slate-900 transition flex flex-col justify-between space-y-3"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[10px] font-black text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                            {item.code}
                          </span>
                          {linkedTask && (
                            <span className="truncate text-[10px] font-bold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 px-2 py-0.5 rounded-md border border-teal-200/60 dark:border-teal-900/40">
                              {taskLabel(linkedTask)}
                            </span>
                          )}
                        </div>
                        <ErpStatusBadge status={item.status || 'draft'} label={STATUS_CONFIG[item.status || 'draft']?.label} tone={getQualityStatusTone(item.status || 'draft')} />
                      </div>

                      <div className="flex gap-3 items-start">
                        {firstPhoto ? (
                          <img
                            src={firstPhoto.url}
                            alt={firstPhoto.caption || item.title}
                            onClick={() => openChecklist(item, true)}
                            className="h-16 w-20 shrink-0 rounded-xl object-cover ring-1 ring-slate-200 cursor-pointer hover:opacity-90 transition"
                          />
                        ) : (
                          <div
                            onClick={() => openChecklist(item, true)}
                            className="flex h-16 w-20 shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-slate-300 cursor-pointer"
                          >
                            <ImageIcon size={20} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <h4
                            onClick={() => openChecklist(item, true)}
                            className="font-black text-sm text-slate-800 dark:text-white line-clamp-2 cursor-pointer hover:text-teal-600 transition"
                          >
                            {item.title}
                          </h4>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-400">
                            {item.workLocation && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin size={11} className="text-slate-400" /> {item.workLocation}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1">
                              <Calendar size={11} className="text-slate-400" /> {formatDate(item.workDate || item.createdAt)}
                            </span>
                            {item.workSupervisor && (
                              <span className="inline-flex items-center gap-1">
                                <User size={11} className="text-slate-400" /> {item.workSupervisor}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {item.note && (
                        <div className="rounded-xl bg-amber-50/60 dark:bg-amber-950/20 p-2 text-[11px] font-semibold text-amber-800 dark:text-amber-300 border border-amber-200/50">
                          <strong>Ghi chú / Chỉ dẫn:</strong> {item.note}
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400">
                        <span className="inline-flex items-center gap-1 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                          <ImageIcon size={11} /> {photoCount} ảnh
                        </span>
                        <span className="inline-flex items-center gap-1 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                          <Paperclip size={11} /> {fileCount} file
                        </span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-1.5 flex-wrap">
                      <button
                        onClick={() => openChecklist(item, true)}
                        className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition"
                      >
                        Chi tiết
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => openChecklist(item)}
                          className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition"
                        >
                          Sửa
                        </button>
                      )}
                      {canSubmit && (
                        <button
                          onClick={() => setSubmittingChecklist(item)}
                          className="rounded-xl bg-teal-600 hover:bg-teal-700 px-3.5 py-1.5 text-xs font-black text-white shadow-xs transition"
                        >
                          Gửi duyệt
                        </button>
                      )}
                      {canApprove && (
                        <>
                          <button
                            onClick={() => handleStatusChange(item, 'returned')}
                            className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300 px-3 py-1.5 text-xs font-black hover:bg-rose-100 transition"
                          >
                            Trả lại
                          </button>
                          <button
                            onClick={() => handleStatusChange(item, 'approved')}
                            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3.5 py-1.5 text-xs font-black text-white shadow-xs transition"
                          >
                            Phê duyệt
                          </button>
                        </>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(item)}
                          className="rounded-xl p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                          title="Xóa hồ sơ"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 2. SUB-TAB: TẤT CẢ HỒ SƠ NGHIỆM THU (COMPACT FLAT TABLE) */}
      {subTab === 'all' && (
        <div className="space-y-3">
          {/* Tool bar */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                  placeholder="Tìm theo mã hồ sơ, tên công việc, vị trí, người giám sát, WBS..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-xs font-bold text-slate-800 outline-none placeholder:font-semibold placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>

              {/* Dropdown WBS Filter */}
              <select
                value={selectedWbsFilter}
                onChange={e => { setSelectedWbsFilter(e.target.value); setCurrentPage(1); }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                <option value="">-- Tất cả hạng mục WBS --</option>
                {tasks.map(t => (
                  <option key={t.id} value={t.id}>{taskLabel(t)}</option>
                ))}
                {orphanChecklists.length > 0 && <option value="__orphan__">Chưa gắn hạng mục ({orphanChecklists.length})</option>}
              </select>
            </div>

            {/* Quick Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] font-black uppercase text-slate-400 mr-1 flex items-center gap-1">
                <Filter size={11} /> Trạng thái:
              </span>
              <button
                onClick={() => { setStatusFilter(''); setCurrentPage(1); }}
                className={`rounded-xl px-2.5 py-1 text-xs font-bold transition ${!statusFilter ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200'}`}
              >
                Tất cả ({checklists.length})
              </button>
              <button
                onClick={() => { setStatusFilter('submitted'); setCurrentPage(1); }}
                className={`rounded-xl px-2.5 py-1 text-xs font-bold transition ${statusFilter === 'submitted' ? 'bg-teal-600 text-white' : 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300 hover:bg-teal-100/50'}`}
              >
                Chờ duyệt ({globalCounts.submitted})
              </button>
              <button
                onClick={() => { setStatusFilter('approved'); setCurrentPage(1); }}
                className={`rounded-xl px-2.5 py-1 text-xs font-bold transition ${statusFilter === 'approved' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 hover:bg-emerald-100/50'}`}
              >
                Đã duyệt ({globalCounts.approved})
              </button>
              <button
                onClick={() => { setStatusFilter('returned'); setCurrentPage(1); }}
                className={`rounded-xl px-2.5 py-1 text-xs font-bold transition ${statusFilter === 'returned' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 hover:bg-rose-100/50'}`}
              >
                Trả lại ({globalCounts.returned})
              </button>
              <button
                onClick={() => { setStatusFilter('draft'); setCurrentPage(1); }}
                className={`rounded-xl px-2.5 py-1 text-xs font-bold transition ${statusFilter === 'draft' ? 'bg-slate-700 text-white' : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 hover:bg-zinc-200'}`}
              >
                Nháp ({globalCounts.draft})
              </button>
            </div>
          </div>

          {/* Table */}
          {allFilteredChecklists.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck size={20} />}
              title="Không tìm thấy hồ sơ nghiệm thu phù hợp"
              message="Thử thay đổi từ khóa tìm kiếm hoặc bỏ chọn các bộ lọc trạng thái."
            />
          ) : (
            <div className="bg-card border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[760px]">
                  <thead className="bg-slate-100/90 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 font-black border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="py-3 px-4 w-28">Mã hồ sơ</th>
                      <th className="py-3 px-3">Hồ sơ nghiệm thu & Vị trí</th>
                      <th className="py-3 px-3 w-56">Hạng mục WBS</th>
                      <th className="py-3 px-3 w-28 text-center">Đính kèm</th>
                      <th className="py-3 px-3 w-28">Ngày</th>
                      <th className="py-3 px-3 w-28 text-center">Trạng thái</th>
                      <th className="py-3 px-4 w-28 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {paginatedChecklists.map(item => {
                      const linkedTask = item.taskId ? taskMap.get(item.taskId) : null;
                      const photoCount = (item.sitePhotos || []).length;
                      const fileCount = (item.attachments || []).length;
                      const canEdit = canEditChecklist(item);
                      const canSubmit = canSubmitChecklist(item);
                      const canDelete = canDeleteChecklist(item);
                      const canApprove = canApproveChecklist(item);

                      return (
                        <tr key={item.id} className="hover:bg-teal-50/20 dark:hover:bg-slate-800/40 transition">
                          <td className="py-3 px-4 align-top">
                            <span className="font-mono text-[11px] font-black text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                              {item.code}
                            </span>
                          </td>
                          <td className="py-3 px-3 align-top">
                            <button
                              onClick={() => openChecklist(item, true)}
                              className="font-black text-xs text-slate-800 dark:text-white hover:text-teal-600 transition text-left line-clamp-1"
                              title={item.title}
                            >
                              {item.title}
                            </button>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] font-semibold text-slate-400">
                              {item.workLocation && (
                                <span className="inline-flex items-center gap-1">
                                  <MapPin size={10} /> {item.workLocation}
                                </span>
                              )}
                              {item.workSupervisor && (
                                <span className="inline-flex items-center gap-1">
                                  <User size={10} /> {item.workSupervisor}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3 align-top">
                            {linkedTask ? (
                              <span className="block truncate font-bold text-slate-700 dark:text-slate-300" title={taskLabel(linkedTask)}>
                                {taskLabel(linkedTask)}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-red-500 bg-red-50 dark:bg-red-950/40 px-1.5 py-0.5 rounded">
                                Chưa gắn WBS
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 align-top text-center">
                            <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold text-slate-500">
                              {photoCount > 0 && (
                                <span className="inline-flex items-center gap-1 rounded bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 px-1.5 py-0.5 border border-teal-200/50">
                                  <ImageIcon size={10} /> {photoCount}
                                </span>
                              )}
                              {fileCount > 0 && (
                                <span className="inline-flex items-center gap-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.5">
                                  <Paperclip size={10} /> {fileCount}
                                </span>
                              )}
                              {photoCount === 0 && fileCount === 0 && <span className="text-slate-300">—</span>}
                            </div>
                          </td>
                          <td className="py-3 px-3 align-top font-bold text-slate-600 dark:text-slate-400 text-xs">
                            {formatDate(item.workDate || item.createdAt)}
                          </td>
                          <td className="py-3 px-3 align-top text-center">
                            <ErpStatusBadge status={item.status || 'draft'} label={STATUS_CONFIG[item.status || 'draft']?.label} tone={getQualityStatusTone(item.status || 'draft')} />
                          </td>
                          <td className="py-3 px-4 align-top text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => openChecklist(item, true)}
                                className="p-1 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/30 transition"
                                title="Xem chi tiết"
                              >
                                <Eye size={14} />
                              </button>
                              {canEdit && (
                                <button
                                  onClick={() => openChecklist(item)}
                                  className="p-1 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/30 transition"
                                  title="Chỉnh sửa"
                                >
                                  <Edit2 size={14} />
                                </button>
                              )}
                              {canSubmit && (
                                <button
                                  onClick={() => setSubmittingChecklist(item)}
                                  className="p-1 rounded-lg text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/30 transition"
                                  title="Gửi duyệt"
                                >
                                  <Send size={14} />
                                </button>
                              )}
                              {canApprove && (
                                <>
                                  <button
                                    onClick={() => handleStatusChange(item, 'returned')}
                                    className="p-1 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
                                    title="Trả lại"
                                  >
                                    <RotateCcw size={14} />
                                  </button>
                                  <button
                                    onClick={() => handleStatusChange(item, 'approved')}
                                    className="p-1 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition"
                                    title="Phê duyệt"
                                  >
                                    <CheckCircle2 size={14} />
                                  </button>
                                </>
                              )}
                              {canDelete && (
                                <button
                                  onClick={() => handleDelete(item)}
                                  className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                                  title="Xóa hồ sơ"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination footer */}
              <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between text-xs text-slate-500">
                <span>Hiển thị {paginatedChecklists.length} / {allFilteredChecklists.length} hồ sơ</span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white disabled:opacity-40 font-bold hover:bg-slate-50"
                    >
                      Trước
                    </button>
                    <span className="px-2 font-mono font-bold">{currentPage} / {totalPages}</span>
                    <button
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white disabled:opacity-40 font-bold hover:bg-slate-50"
                    >
                      Sau
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. SUB-TAB: THEO CÂY HẠNG MỤC WBS (STRUCTURAL FOLDER BROWSER) */}
      {subTab === 'wbs_tree' && (
        <div className="space-y-4">
          {/* Breadcrumbs & Navigation Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400 overflow-x-auto whitespace-nowrap">
              {(currentTask || showOrphans) && (
                <button
                  onClick={currentTask?.parentId ? () => openTask(currentTask.parentId!) : openRoot}
                  className="mr-2 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition"
                >
                  <ArrowLeft size={13} /> Lên cấp trên
                </button>
              )}
              <button onClick={openRoot} className="rounded-lg px-2 py-1 hover:bg-slate-100 hover:text-teal-700 transition">
                {projectName || 'Dự án (Gốc)'}
              </button>
              {breadcrumbTasks.map(task => (
                <React.Fragment key={task.id}>
                  <ChevronRight size={13} className="text-slate-400 shrink-0" />
                  <button
                    onClick={() => openTask(task.id)}
                    className={`max-w-[180px] truncate rounded-lg px-2 py-1 hover:bg-slate-100 hover:text-teal-700 transition ${task.id === currentTaskId ? 'font-black text-teal-700 bg-teal-50 dark:bg-teal-950/40' : ''}`}
                    title={taskLabel(task)}
                  >
                    {task.wbsCode ? `${task.wbsCode} ${task.name}` : task.name}
                  </button>
                </React.Fragment>
              ))}
              {showOrphans && (
                <>
                  <ChevronRight size={13} className="text-slate-400" />
                  <span className="font-bold text-red-600 bg-red-50 px-2 py-1 rounded-md">Chưa gắn WBS</span>
                </>
              )}
            </div>

            {orphanChecklists.length > 0 && !showOrphans && (
              <button
                onClick={openOrphans}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 transition shrink-0"
              >
                <AlertCircle size={14} /> Chưa gắn ({orphanChecklists.length})
              </button>
            )}
          </div>

          {/* Selected Task Details Header Card */}
          {currentTask && !showOrphans && (
            <div className="rounded-2xl border border-teal-200/80 bg-teal-50/20 p-4 shadow-xs dark:border-teal-900/40 dark:bg-teal-950/10 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    {currentTask.wbsCode && (
                      <span className="rounded-md bg-teal-100 dark:bg-teal-900/40 px-2 py-0.5 font-mono text-[10px] font-black text-teal-800 dark:text-teal-300">
                        WBS {currentTask.wbsCode}
                      </span>
                    )}
                    <span className="text-[10px] font-bold uppercase text-slate-400">
                      {currentChildren.length} thư mục con
                    </span>
                  </div>
                  <h3 className="mt-1 text-base font-black text-slate-800 dark:text-white">{currentTask.name}</h3>
                  <div className="mt-1 flex items-center gap-3 text-[11px] font-semibold text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Calendar size={12} /> {formatDate(currentTask.startDate)} - {formatDate(currentTask.endDate)}
                    </span>
                    <span>•</span>
                    <span>Tiến độ: <strong>{Math.round(Number(currentTask.progress || 0))}%</strong></span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {qualityCapabilities.canEdit && (
                    <button
                      onClick={() => openCreate(currentTask)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 px-3.5 py-2 text-xs font-black text-white shadow-xs transition"
                    >
                      <Plus size={14} /> Tạo hồ sơ tại đây
                    </button>
                  )}
                </div>
              </div>
              <ProgressBar value={currentTask.progress} />
            </div>
          )}

          {/* Child Folders Grid */}
          {!showOrphans && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-black text-slate-700 dark:text-slate-300 px-1">
                <span>{currentTask ? 'Hạng mục con trực thuộc' : 'Danh mục công tác WBS'}</span>
                <span className="text-slate-400 text-[10px] font-bold uppercase">{currentChildren.length} hạng mục</span>
              </div>

              {currentChildren.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
                  <FolderOpen size={28} className="mx-auto text-slate-300" />
                  <p className="mt-2 text-xs font-bold text-slate-400">Không có hạng mục con nào</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {currentChildren.map(task => {
                    const taskAggChecklists = getAggregateChecklists(task.id);
                    const taskCounts = countByStatus(taskAggChecklists);
                    const childCount = (childrenByParent.get(task.id) || []).length;

                    return (
                      <button
                        key={task.id}
                        onClick={() => openTask(task.id)}
                        className="rounded-2xl border border-slate-200/90 bg-white p-4 text-left shadow-xs hover:border-teal-500 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 transition flex flex-col justify-between space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400 border border-teal-100">
                              {childCount > 0 ? <FolderOpen size={18} /> : <Folder size={18} />}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                {task.wbsCode && (
                                  <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">
                                    {task.wbsCode}
                                  </span>
                                )}
                                {childCount > 0 && (
                                  <span className="text-[10px] font-semibold text-slate-400">
                                    {childCount} con
                                  </span>
                                )}
                              </div>
                              <h4 className="font-black text-xs text-slate-800 dark:text-white truncate mt-1" title={task.name}>
                                {task.name}
                              </h4>
                            </div>
                          </div>
                          <ChevronRight size={15} className="text-slate-300 shrink-0 mt-1" />
                        </div>

                        <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
                            <span>Tiến độ: {Math.round(Number(task.progress || 0))}%</span>
                            <div className="flex items-center gap-1">
                              <span className="text-slate-600 dark:text-slate-300">{taskAggChecklists.length} hồ sơ</span>
                              {taskCounts.submitted > 0 && (
                                <span className="text-teal-600 bg-teal-50 px-1 rounded font-black">
                                  {taskCounts.submitted} chờ
                                </span>
                              )}
                            </div>
                          </div>
                          <ProgressBar value={task.progress} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Direct Checklists of Current Task */}
          {(currentTask || showOrphans) && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs font-black text-slate-700 dark:text-slate-300 px-1">
                <span>{showOrphans ? 'Hồ sơ chưa gắn hạng mục WBS' : `Hồ sơ nghiệm thu tại "${currentTask?.name}"`}</span>
                <span className="text-slate-400 text-[10px] font-bold uppercase">
                  {(showOrphans ? orphanChecklists : (checklistsByTaskId.get(currentTask!.id) || [])).length} hồ sơ
                </span>
              </div>

              {(showOrphans ? orphanChecklists : (checklistsByTaskId.get(currentTask!.id) || [])).length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs font-bold text-slate-400">
                  Chưa có hồ sơ nghiệm thu nào tại hạng mục này.
                </div>
              ) : (
                <div className="bg-card border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[700px]">
                      <thead className="bg-slate-100/90 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 font-black border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="py-2.5 px-4 w-28">Mã</th>
                          <th className="py-2.5 px-3">Tên hồ sơ nghiệm thu</th>
                          <th className="py-2.5 px-3 w-28 text-center">Đính kèm</th>
                          <th className="py-2.5 px-3 w-28">Ngày</th>
                          <th className="py-2.5 px-3 w-28 text-center">Trạng thái</th>
                          <th className="py-2.5 px-4 w-28 text-right">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                        {(showOrphans ? orphanChecklists : (checklistsByTaskId.get(currentTask!.id) || [])).map(item => {
                          const photoCount = (item.sitePhotos || []).length;
                          const fileCount = (item.attachments || []).length;
                          const canEdit = canEditChecklist(item);
                          const canSubmit = canSubmitChecklist(item);
                          const canDelete = canDeleteChecklist(item);
                          const canApprove = canApproveChecklist(item);

                          return (
                            <tr key={item.id} className="hover:bg-teal-50/20 transition">
                              <td className="py-2.5 px-4 font-mono text-[11px] font-black text-slate-600">
                                {item.code}
                              </td>
                              <td className="py-2.5 px-3">
                                <button
                                  onClick={() => openChecklist(item, true)}
                                  className="font-black text-xs text-slate-800 hover:text-teal-600 transition text-left"
                                >
                                  {item.title}
                                </button>
                                {item.workLocation && (
                                  <div className="text-[10px] text-slate-400 font-semibold">{item.workLocation}</div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-center text-[10px] font-bold text-slate-500">
                                {photoCount} ảnh • {fileCount} file
                              </td>
                              <td className="py-2.5 px-3 font-bold text-slate-600 text-xs">
                                {formatDate(item.workDate || item.createdAt)}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <ErpStatusBadge status={item.status || 'draft'} label={STATUS_CONFIG[item.status || 'draft']?.label} tone={getQualityStatusTone(item.status || 'draft')} />
                              </td>
                              <td className="py-2.5 px-4 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={() => openChecklist(item, true)} className="p-1 text-slate-400 hover:text-teal-600" title="Xem">
                                    <Eye size={14} />
                                  </button>
                                  {canEdit && (
                                    <button onClick={() => openChecklist(item)} className="p-1 text-slate-400 hover:text-teal-600" title="Sửa">
                                      <Edit2 size={14} />
                                    </button>
                                  )}
                                  {canSubmit && (
                                    <button onClick={() => setSubmittingChecklist(item)} className="p-1 text-teal-600 hover:bg-teal-50" title="Gửi duyệt">
                                      <Send size={14} />
                                    </button>
                                  )}
                                  {canApprove && (
                                    <button onClick={() => handleStatusChange(item, 'approved')} className="p-1 text-emerald-600 hover:bg-emerald-50" title="Duyệt">
                                      <CheckCircle2 size={14} />
                                    </button>
                                  )}
                                  {canDelete && (
                                    <button onClick={() => handleDelete(item)} className="p-1 text-slate-400 hover:text-red-600" title="Xóa">
                                      <Trash2 size={14} />
                                    </button>
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
              )}
            </div>
          )}
        </div>
      )}

      {/* MODAL TẠO & SỬA HỒ SƠ NGHIỆM THU (FORM DIALOG) */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs px-3 py-6 animate-in fade-in duration-150">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
            {/* Header Form */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-4 bg-slate-50/50 dark:bg-slate-900">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400">
                  {readonlyForm ? 'Chi tiết hồ sơ nghiệm thu' : editingChecklist ? 'Cập nhật hồ sơ nghiệm thu' : 'Tạo hồ sơ nghiệm thu mới'}
                </div>
                <h3 className="mt-0.5 truncate text-base sm:text-lg font-black text-slate-800 dark:text-white">
                  {form.title || (formTask ? taskLabel(formTask) : 'Hồ sơ nghiệm thu chất lượng')}
                </h3>
              </div>
              <button onClick={closeForm} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition">
                <X size={18} />
              </button>
            </div>

            {/* Body Form */}
            <div className="overflow-y-auto p-5 space-y-4">
              <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                {/* Cột Trái: Thông tin nghiệm thu */}
                <div className="space-y-3.5">
                  <div className="space-y-1">
                    <label className="text-[11px] font-black uppercase text-slate-500 tracking-wide">
                      Tên hồ sơ nghiệm thu <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={form.title || ''}
                      onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))}
                      readOnly={readonlyForm}
                      placeholder="Ví dụ: Nghiệm thu cốt thép dầm sàn tầng 3..."
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-800 dark:text-white outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 read-only:bg-slate-50 dark:read-only:bg-slate-800"
                    />
                  </div>

                  {!editingChecklist && (
                    <div className="space-y-1">
                      <label className="text-[11px] font-black uppercase text-slate-500 tracking-wide">
                        Hạng mục WBS liên kết <span className="text-red-500">*</span>
                      </label>
                      {readonlyForm ? (
                        <input
                          value={taskLabel(formTask)}
                          readOnly
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold"
                        />
                      ) : (
                        <select
                          value={formTask?.id || ''}
                          onChange={e => {
                            const task = taskMap.get(e.target.value) || null;
                            setFormTask(task);
                            if (task && !form.title) setForm(prev => ({ ...prev, title: taskLabel(task), workDescription: task.name }));
                          }}
                          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-teal-500"
                        >
                          <option value="">-- Chọn hạng mục WBS --</option>
                          {tasks.map(t => (
                            <option key={t.id} value={t.id}>{taskLabel(t)}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400">Vị trí thi công</label>
                      <input
                        value={form.workLocation || ''}
                        onChange={event => setForm(prev => ({ ...prev, workLocation: event.target.value }))}
                        readOnly={readonlyForm}
                        placeholder="Trục 1-3, tầng 2..."
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-bold outline-none focus:border-teal-500 read-only:bg-slate-50"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400">Ngày nghiệm thu</label>
                      <input
                        type="date"
                        value={form.workDate || ''}
                        onChange={event => setForm(prev => ({ ...prev, workDate: event.target.value }))}
                        readOnly={readonlyForm}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-bold outline-none focus:border-teal-500 read-only:bg-slate-50"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400">Người giám sát</label>
                      {readonlyForm ? (
                        <input
                          value={form.workSupervisor || ''}
                          readOnly
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold outline-none"
                        />
                      ) : projectStaff.length > 0 ? (
                        <select
                          value={form.workSupervisor || ''}
                          onChange={event => setForm(prev => ({ ...prev, workSupervisor: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold outline-none focus:border-teal-500"
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
                          placeholder="Tên giám sát..."
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold outline-none focus:border-teal-500"
                        />
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400">Mô tả công việc & Yêu cầu kỹ thuật</label>
                    <textarea
                      rows={3}
                      value={form.workDescription || ''}
                      onChange={event => setForm(prev => ({ ...prev, workDescription: event.target.value }))}
                      readOnly={readonlyForm}
                      placeholder="Mô tả các công việc đã thực hiện, tiêu chuẩn áp dụng..."
                      className="w-full resize-none rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none focus:border-teal-500 read-only:bg-slate-50"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400">Ghi chú bổ sung</label>
                    <textarea
                      rows={2}
                      value={form.note || ''}
                      onChange={event => setForm(prev => ({ ...prev, note: event.target.value }))}
                      readOnly={readonlyForm}
                      placeholder="Ghi chú thêm nếu có..."
                      className="w-full resize-none rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none focus:border-teal-500 read-only:bg-slate-50"
                    />
                  </div>
                </div>

                {/* Cột Phải: Ảnh nghiệm thu & File đính kèm */}
                <div className="space-y-4">
                  {/* Ảnh nghiệm thu */}
                  <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 space-y-3 bg-slate-50/40 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-black text-slate-800 dark:text-white flex items-center gap-1.5">
                          <ImageIcon size={14} className="text-teal-600" /> Ảnh hiện trường nghiệm thu
                        </h4>
                        <p className="text-[10px] font-semibold text-slate-400">{(form.sitePhotos || []).length} ảnh đã chụp</p>
                      </div>
                      {!readonlyForm && (
                        <>
                          <input id="quality-photo-upload" type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />
                          <label
                            htmlFor="quality-photo-upload"
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-xs transition"
                          >
                            {uploadingPhotos ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                            Thêm ảnh
                          </label>
                        </>
                      )}
                    </div>

                    {(form.sitePhotos || []).length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center">
                        <ImageIcon size={22} className="mx-auto text-slate-300" />
                        <p className="mt-1 text-xs font-bold text-slate-400">Chưa có ảnh nghiệm thu</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {(form.sitePhotos || []).map((photo, index) => (
                          <div
                            key={`${photo.url}-${index}`}
                            onClick={() => openImageLightbox(photo.url)}
                            className="group relative cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-slate-100 transition hover:border-teal-500 shadow-xs"
                          >
                            <img
                              src={photo.url}
                              alt={photo.caption || `Ảnh ${index + 1}`}
                              className="h-24 w-full object-cover transition duration-200 group-hover:scale-105"
                            />
                            <div className="absolute inset-x-0 bottom-0 bg-slate-950/60 px-1.5 py-0.5 text-[9px] font-bold text-white truncate">
                              {photo.caption || `Ảnh ${index + 1}`}
                            </div>
                            {!readonlyForm && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removePhoto(index);
                                }}
                                className="absolute right-1 top-1 rounded-md bg-white/90 p-1 text-red-500 opacity-0 shadow-xs transition group-hover:opacity-100 z-10"
                                title="Xoá ảnh"
                              >
                                <X size={11} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* File đính kèm */}
                  <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 space-y-3 bg-slate-50/40 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-black text-slate-800 dark:text-white flex items-center gap-1.5">
                          <Paperclip size={14} className="text-teal-600" /> Tài liệu & Biên bản đính kèm
                        </h4>
                        <p className="text-[10px] font-semibold text-slate-400">{(form.attachments || []).length} file</p>
                      </div>
                      {!readonlyForm && (
                        <>
                          <input id="quality-file-upload" type="file" multiple onChange={handleAttachmentUpload} className="hidden" />
                          <label
                            htmlFor="quality-file-upload"
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-xs transition"
                          >
                            {uploadingFiles ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                            Thêm file
                          </label>
                        </>
                      )}
                    </div>

                    {(form.attachments || []).length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center">
                        <Paperclip size={22} className="mx-auto text-slate-300" />
                        <p className="mt-1 text-xs font-bold text-slate-400">Chưa có tài liệu đính kèm</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {(form.attachments || []).map((attachment, index) => (
                          <div key={attachment.id || `${attachment.url}-${index}`} className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white dark:bg-slate-800 px-3 py-2 shadow-xs">
                            <span className="text-slate-400"><FileIcon type={attachment.fileType} /></span>
                            <button
                              type="button"
                              onClick={() => handleAttachmentClick(attachment)}
                              className="min-w-0 flex-1 text-left truncate text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-teal-600"
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
                              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
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
                                className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
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

            {/* Footer Form */}
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900 px-5 py-3.5">
              <div className="text-[10px] font-bold text-slate-400">
                {editingChecklist ? `${editingChecklist.code} · ${STATUS_CONFIG[editingChecklist.status]?.label || editingChecklist.status}` : 'Lưu nháp hoặc gửi duyệt đến Room Chất lượng'}
              </div>
              <div className="flex gap-2">
                <button onClick={closeForm} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 shadow-xs transition">
                  Đóng
                </button>
                {!readonlyForm && (
                  <>
                    <button
                      onClick={handleSaveDraft}
                      disabled={saving || uploadingPhotos || uploadingFiles}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 text-xs font-black shadow-xs transition disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                      Lưu nháp
                    </button>
                    {qualityCapabilities.canSubmit && (
                      <button
                        onClick={handlePrepareFormSubmit}
                        disabled={saving || uploadingPhotos || uploadingFiles}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white px-5 py-2 text-xs font-black shadow-md shadow-teal-600/20 transition disabled:opacity-50"
                      >
                        {saving ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        Gửi duyệt
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DIALOGS */}
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
