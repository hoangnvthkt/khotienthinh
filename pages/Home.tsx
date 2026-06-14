import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRightLeft,
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardList,
  FileText,
  FolderKanban,
  GitBranch,
  Inbox,
  Package,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  Warehouse,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useWorkflow } from '../context/WorkflowContext';
import { useRequest } from '../context/RequestContext';
import { AppNotification, notificationService } from '../lib/notificationService';
import { resolveNotificationPath } from '../lib/notificationRoutes';
import { canUseModule, resolveHomeCapabilities } from '../lib/homeCapabilities';
import {
  MaterialRequest,
  RequestInstance,
  RequestStatus,
  RQStatus,
  Transaction,
  TransactionStatus,
  User,
  WorkflowInstance,
  WorkflowInstanceStatus,
} from '../types';
import {
  EmptyState,
  NextActionCard,
  NextActionCardProps,
  StatusBadge,
} from '../components/erp';
import {
  canApproveMaterialRequest,
  canApproveWmsTransaction,
  canExportMaterialRequest,
  canReceiveMaterialRequest,
  canReceiveWmsTransaction,
  isWarehouseKeeper,
} from '../lib/wmsPermissions';

type HomeActionItem = NextActionCardProps & {
  id: string;
  category: 'workflow' | 'rq' | 'material' | 'transaction' | 'tracking' | 'warning';
  score: number;
};

const now = () => Date.now();

const isOverdue = (value?: string | null) => {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time < now();
};

const formatToday = () => new Date().toLocaleDateString('vi-VN', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const getUserName = (users: User[], userId?: string | null) =>
  users.find(item => item.id === userId)?.name || userId || '';

const requestStatusLabel = (status: RequestStatus | string) => {
  if (status === RequestStatus.PENDING) return 'Chờ duyệt';
  if (status === RequestStatus.APPROVED) return 'Chờ xuất';
  if (status === RequestStatus.IN_TRANSIT) return 'Đang giao';
  if (status === RequestStatus.COMPLETED) return 'Đã nhận';
  if (status === RequestStatus.REJECTED) return 'Từ chối';
  return 'Nháp';
};

const rqStatusLabel = (status: RQStatus | string) => {
  if (status === RQStatus.PENDING) return 'Chờ duyệt';
  if (status === RQStatus.IN_PROGRESS) return 'Đang xử lý';
  if (status === RQStatus.DONE) return 'Hoàn thành';
  if (status === RQStatus.REJECTED) return 'Từ chối';
  if (status === RQStatus.CANCELLED) return 'Đã huỷ';
  return 'Nháp';
};

const getWorkflowAssignees = (instance: WorkflowInstance, nodes: ReturnType<typeof useWorkflow>['nodes'], users: User[], currentUser: User) => {
  const currentNode = nodes.find(node => node.id === instance.currentNodeId);
  const stepAssignee = instance.currentNodeId ? instance.stepAssignees?.[instance.currentNodeId] : undefined;
  const assigneeIds = Array.isArray(stepAssignee)
    ? stepAssignee
    : stepAssignee
      ? [stepAssignee]
      : currentNode?.config?.assigneeUserId
        ? [currentNode.config.assigneeUserId]
        : [];

  const assignedToCurrentUser =
    assigneeIds.includes(currentUser.id) ||
    currentNode?.config?.assigneeUserId === currentUser.id ||
    currentNode?.config?.assigneeRole === currentUser.role;

  const assigneeNames = assigneeIds.map(id => getUserName(users, id)).filter(Boolean);
  return {
    currentNode,
    assignedToCurrentUser,
    label: assigneeNames.length > 1 ? `${assigneeNames[0]} + ${assigneeNames.length - 1} người` : assigneeNames[0] || undefined,
  };
};

const buildTransactionAction = (tx: Transaction, user: User, users: User[], warehouses: ReturnType<typeof useApp>['warehouses']): HomeActionItem | null => {
  const sourceName = warehouses.find(item => item.id === tx.sourceWarehouseId)?.name;
  const targetName = warehouses.find(item => item.id === tx.targetWarehouseId)?.name;
  if (tx.status === TransactionStatus.PENDING && canApproveWmsTransaction(user, tx)) {
    return {
      id: `tx-approve-${tx.id}`,
      category: 'transaction',
      score: 85,
      title: `${tx.type} - Phiếu kho chờ duyệt`,
      code: tx.id.slice(-8).toUpperCase(),
      status: tx.status,
      statusLabel: 'Chờ duyệt',
      nextAction: `Duyệt phiếu kho${sourceName || targetName ? ` (${sourceName || targetName})` : ''}.`,
      actorName: getUserName(users, tx.requesterId),
      dueAt: tx.date,
      href: '/operations',
      actionLabel: 'Xử lý phiếu',
    };
  }
  if (tx.status === TransactionStatus.APPROVED && canReceiveWmsTransaction(user, tx)) {
    return {
      id: `tx-receive-${tx.id}`,
      category: 'transaction',
      score: 80,
      title: `${tx.type} - Phiếu kho chờ xác nhận`,
      code: tx.id.slice(-8).toUpperCase(),
      status: tx.status,
      statusLabel: 'Chờ nhận',
      nextAction: `Xác nhận nhập/nhận tại ${targetName || sourceName || 'kho liên quan'}.`,
      actorName: getUserName(users, tx.requesterId),
      dueAt: tx.date,
      href: '/operations',
      actionLabel: 'Mở phiếu kho',
    };
  }
  return null;
};

const buildMaterialRequestAction = (request: MaterialRequest, user: User, users: User[], warehouses: ReturnType<typeof useApp>['warehouses']): HomeActionItem | null => {
  const sourceName = warehouses.find(item => item.id === request.sourceWarehouseId)?.name;
  const siteName = warehouses.find(item => item.id === request.siteWarehouseId)?.name;

  if (request.status === RequestStatus.PENDING && canApproveMaterialRequest(user, request)) {
    return {
      id: `mr-approve-${request.id}`,
      category: 'material',
      score: 88,
      title: 'Yêu cầu vật tư chờ thẩm định',
      code: request.code,
      status: request.status,
      statusLabel: 'Chờ duyệt',
      nextAction: `Thẩm định yêu cầu từ ${siteName || 'công trường'}.`,
      actorName: getUserName(users, request.requesterId) || request.requestedBy,
      dueAt: request.expectedDate || request.createdDate,
      href: '/requests',
      actionLabel: 'Mở yêu cầu',
    };
  }
  if (canExportMaterialRequest(user, request)) {
    return {
      id: `mr-export-${request.id}`,
      category: 'material',
      score: 84,
      title: 'Yêu cầu vật tư chờ xuất',
      code: request.code,
      status: request.status,
      statusLabel: 'Chờ xuất',
      nextAction: `Kho ${sourceName || 'nguồn'} cần xuất vật tư cho ${siteName || 'công trường'}.`,
      actorName: getUserName(users, request.requesterId) || request.requestedBy,
      dueAt: request.expectedDate || request.createdDate,
      href: '/requests',
      actionLabel: 'Xuất kho',
    };
  }
  if (canReceiveMaterialRequest(user, request)) {
    return {
      id: `mr-receive-${request.id}`,
      category: 'material',
      score: 82,
      title: 'Yêu cầu vật tư chờ nhận',
      code: request.code,
      status: request.status,
      statusLabel: 'Đang giao',
      nextAction: `Xác nhận vật tư đã nhận tại ${siteName || 'kho công trường'}.`,
      actorName: getUserName(users, request.requesterId) || request.requestedBy,
      dueAt: request.expectedDate || request.createdDate,
      href: '/requests',
      actionLabel: 'Xác nhận nhận',
    };
  }
  return null;
};

const getCurrentRqApprover = (request: RequestInstance) =>
  [...(request.approvers || [])].sort((a, b) => a.order - b.order).find(item => item.status === 'waiting') || null;

const Home: React.FC = () => {
  const navigate = useNavigate();
  const {
    user,
    users,
    items,
    warehouses,
    transactions,
    requests: materialRequests,
    projectFinances,
    hrmConstructionSites,
    loadModuleData,
  } = useApp();
  const {
    instances: workflowInstances,
    templates: workflowTemplates,
    nodes: workflowNodes,
    refreshData: refreshWorkflowData,
  } = useWorkflow();
  const {
    requests: rqRequests,
    categories: rqCategories,
    refreshData: refreshRequestData,
  } = useRequest();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const moduleCapabilities = useMemo(() => resolveHomeCapabilities(user), [user]);
  const shouldLoadWms = moduleCapabilities.material || moduleCapabilities.warehouse;
  const shouldLoadProject = moduleCapabilities.project;

  useEffect(() => {
    refreshWorkflowData().catch(error => console.warn('Home workflow refresh failed:', error));
    refreshRequestData().catch(error => console.warn('Home request refresh failed:', error));
  }, [refreshRequestData, refreshWorkflowData]);

  useEffect(() => {
    if (shouldLoadWms) loadModuleData('wms-core').catch(error => console.warn('Home WMS core load failed:', error));
  }, [loadModuleData, shouldLoadWms]);

  useEffect(() => {
    if (shouldLoadProject) loadModuleData('da').catch(error => console.warn('Home project load failed:', error));
  }, [loadModuleData, shouldLoadProject]);

  useEffect(() => {
    let alive = true;
    notificationService.list(user.id, 20)
      .then(rows => {
        if (alive) setNotifications(rows);
      })
      .catch(error => {
        console.warn('Home notifications load failed:', error);
        if (alive) setNotifications([]);
      });
    return () => { alive = false; };
  }, [user.id]);

  const workflowTodos = useMemo<HomeActionItem[]>(() => workflowInstances
    .filter(instance => instance.status === WorkflowInstanceStatus.RUNNING)
    .map(instance => {
      const { currentNode, assignedToCurrentUser, label } = getWorkflowAssignees(instance, workflowNodes, users, user);
      if (!assignedToCurrentUser) return null;
      const template = workflowTemplates.find(item => item.id === instance.templateId);
      return {
        id: `wf-${instance.id}`,
        category: 'workflow',
        score: 90,
        title: instance.title,
        code: instance.code,
        status: instance.status,
        statusLabel: 'Đang xử lý',
        nextAction: `Bạn cần xử lý bước ${currentNode?.label || 'hiện tại'}${template?.name ? ` trong ${template.name}` : ''}.`,
        actorName: label,
        dueAt: instance.updatedAt || instance.createdAt,
        href: `/wf?instanceId=${instance.id}`,
        actionLabel: 'Mở quy trình',
      } as HomeActionItem;
    })
    .filter(Boolean) as HomeActionItem[], [user, users, workflowInstances, workflowNodes, workflowTemplates]);

  const rqTodos = useMemo<HomeActionItem[]>(() => rqRequests
    .filter(request => request.status === RQStatus.PENDING)
    .map(request => {
      const currentApprover = getCurrentRqApprover(request);
      if (currentApprover?.userId !== user.id) return null;
      const category = rqCategories.find(item => item.id === request.categoryId);
      return {
        id: `rq-${request.id}`,
        category: 'rq',
        score: request.priority === 'urgent' ? 95 : request.priority === 'high' ? 89 : 78,
        title: request.title,
        code: request.code,
        status: request.status,
        statusLabel: 'Chờ duyệt',
        nextAction: `Bạn cần duyệt phiếu ${category?.name || 'yêu cầu nội bộ'}.`,
        actorName: getUserName(users, request.createdBy),
        dueAt: request.dueDate || request.createdAt,
        href: `/rq?requestId=${request.id}`,
        actionLabel: 'Duyệt phiếu',
      } as HomeActionItem;
    })
    .filter(Boolean) as HomeActionItem[], [rqCategories, rqRequests, user.id, users]);

  const wmsTodos = useMemo<HomeActionItem[]>(() => {
    if (!shouldLoadWms) return [];
    const txActions = transactions
      .map(tx => buildTransactionAction(tx, user, users, warehouses))
      .filter(Boolean) as HomeActionItem[];
    const materialActions = materialRequests
      .map(request => buildMaterialRequestAction(request, user, users, warehouses))
      .filter(Boolean) as HomeActionItem[];
    return [...txActions, ...materialActions];
  }, [materialRequests, shouldLoadWms, transactions, user, users, warehouses]);

  const actionItems = useMemo(() => {
    const merged = [...workflowTodos, ...rqTodos, ...wmsTodos];
    return merged
      .map(item => ({ ...item, score: item.score + (isOverdue(item.dueAt) ? 20 : 0) }))
      .sort((a, b) => b.score - a.score || String(b.dueAt || '').localeCompare(String(a.dueAt || '')))
      .slice(0, 8);
  }, [rqTodos, wmsTodos, workflowTodos]);

  const capabilities = useMemo(
    () => resolveHomeCapabilities(user, { hasApprovalWork: actionItems.some(item => item.category === 'workflow' || item.category === 'rq') }),
    [actionItems, user],
  );

  const trackingItems = useMemo<HomeActionItem[]>(() => {
    const wf = workflowInstances
      .filter(item => item.createdBy === user.id && item.status === WorkflowInstanceStatus.RUNNING)
      .slice(0, 4)
      .map(item => ({
        id: `track-wf-${item.id}`,
        category: 'tracking' as const,
        score: 30,
        title: item.title,
        code: item.code,
        status: item.status,
        statusLabel: 'Đang xử lý',
        nextAction: 'Quy trình của bạn đang được xử lý.',
        dueAt: item.updatedAt || item.createdAt,
        href: `/wf?instanceId=${item.id}`,
        actionLabel: 'Theo dõi',
      }));

    const rq = rqRequests
      .filter(item => item.createdBy === user.id && [RQStatus.DRAFT, RQStatus.PENDING, RQStatus.IN_PROGRESS].includes(item.status))
      .slice(0, 4)
      .map(item => ({
        id: `track-rq-${item.id}`,
        category: 'tracking' as const,
        score: 25,
        title: item.title,
        code: item.code,
        status: item.status,
        statusLabel: rqStatusLabel(item.status),
        nextAction: item.status === RQStatus.DRAFT ? 'Phiếu đang nháp, cần gửi khi đã đủ thông tin.' : 'Phiếu của bạn đang trong luồng xử lý.',
        dueAt: item.dueDate || item.updatedAt,
        href: `/rq?requestId=${item.id}`,
        actionLabel: 'Xem phiếu',
      }));

    const material = shouldLoadWms ? materialRequests
      .filter(item => item.requesterId === user.id && [RequestStatus.DRAFT, RequestStatus.PENDING, RequestStatus.REJECTED].includes(item.status))
      .slice(0, 4)
      .map(item => ({
        id: `track-mr-${item.id}`,
        category: 'tracking' as const,
        score: 20,
        title: 'Yêu cầu vật tư của tôi',
        code: item.code,
        status: item.status,
        statusLabel: requestStatusLabel(item.status),
        nextAction: item.status === RequestStatus.REJECTED ? 'Phiếu bị từ chối, cần kiểm tra lý do và tạo lại nếu cần.' : 'Theo dõi trạng thái cấp vật tư.',
        dueAt: item.expectedDate || item.createdDate,
        href: '/requests',
        actionLabel: 'Xem yêu cầu',
      })) : [];

    return [...wf, ...rq, ...material].slice(0, 6);
  }, [materialRequests, rqRequests, shouldLoadWms, user.id, workflowInstances]);

  const lowStockItems = useMemo(() => {
    if (!shouldLoadWms) return [];
    return items
      .map(item => ({
        item,
        stock: Object.values(item.stockByWarehouse || {}).reduce((sum: number, value) => sum + Number(value || 0), 0),
      }))
      .filter(row => row.stock <= Number(row.item.minStock || 0))
      .slice(0, 5);
  }, [items, shouldLoadWms]);

  const visibleNotifications = useMemo(
    () => notifications.filter(item => !item.isRead || item.severity === 'critical').slice(0, 5),
    [notifications],
  );

  const projectSummary = useMemo(() => {
    if (!capabilities.project) return null;
    const activeSites = hrmConstructionSites.length;
    const activeFinances = projectFinances.filter(item => ['active', 'planning', 'paused'].includes(String(item.status || ''))).length;
    return { activeSites, activeFinances };
  }, [capabilities.project, hrmConstructionSites.length, projectFinances]);

  const shortcuts = useMemo(() => {
    const itemsList: Array<{ to: string; icon: React.ReactNode; title: string; description: string; show: boolean }> = [
      { to: '/requests', icon: <ClipboardList size={18} />, title: 'Yêu cầu vật tư', description: 'Tạo và theo dõi cấp vật tư', show: canUseModule(user, 'WMS') },
      { to: '/inventory', icon: <Package size={18} />, title: 'Kho vật tư', description: 'Tra tồn kho và cảnh báo', show: canUseModule(user, 'WMS') },
      { to: '/operations', icon: <Warehouse size={18} />, title: 'Phiếu kho', description: 'Nhập, xuất, chuyển kho', show: canUseModule(user, 'WMS') },
      { to: '/da', icon: <FolderKanban size={18} />, title: 'Dự án', description: 'Tiến độ, BOQ, nghiệm thu', show: canUseModule(user, 'DA') },
      { to: '/rq', icon: <Inbox size={18} />, title: 'Phiếu yêu cầu', description: 'Yêu cầu nội bộ và phê duyệt', show: canUseModule(user, 'RQ') },
      { to: '/wf', icon: <GitBranch size={18} />, title: 'Quy trình', description: 'Luồng duyệt và chứng từ', show: canUseModule(user, 'WF') },
      { to: '/my-profile', icon: <UserRound size={18} />, title: 'Hồ sơ cá nhân', description: 'Thông tin và chữ ký', show: true },
      { to: '/settings', icon: <Settings size={18} />, title: 'Cài đặt', description: 'Người dùng và hệ thống', show: capabilities.admin },
    ];
    return itemsList.filter(item => item.show).slice(0, 8);
  }, [capabilities.admin, user]);

  const roleLabels = [
    capabilities.admin && 'Quản trị',
    capabilities.warehouse && 'Kho',
    capabilities.material && 'Vật tư',
    capabilities.project && 'Dự án',
    capabilities.approver && 'Người duyệt',
  ].filter(Boolean);

  const openNotification = async (notification: AppNotification) => {
    if (!notification.isRead) {
      notificationService.markRead(notification.id).catch(error => console.warn('Mark notification read failed:', error));
    }
    const target = resolveNotificationPath(notification);
    if (!target) return;
    if (/^https?:\/\//i.test(target)) window.open(target, '_blank', 'noopener,noreferrer');
    else navigate(target);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-8">
      {/* Custom Header Section */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">HÔM NAY</div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Chào {user.name}</h1>
          <p className="mt-1 max-w-3xl text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">
            {formatToday()}. Màn hình này gom các việc cần xử lý, cảnh báo và lối tắt theo quyền của bạn.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge status="pending" label={`${actionItems.length} việc cần xử lý`} tone={actionItems.length > 0 ? 'attention' : 'success'} size="md" />
            {roleLabels.map(label => <StatusBadge key={label as string} status="info" label={label as string} tone="neutral" size="md" />)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center lg:justify-end">
          {/* Nút phụ - Xem thông báo */}
          <Link
            to="/notifications"
            className="flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-1.5 text-[10px] font-black text-teal-700 dark:text-teal-400 dark:bg-teal-950/20 dark:border-teal-800 transition-colors hover:bg-teal-100 dark:hover:bg-teal-900/40 uppercase tracking-wider"
          >
            <Bell size={13} /> Xem thông báo
          </Link>
          {/* Nút chính - AI Trợ lý */}
          <Link
            to="/ai"
            className="group flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-rose-500 to-pink-600 text-white text-xs font-black uppercase tracking-wider shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-95 transition-all"
          >
            <Sparkles size={14} className="group-hover:rotate-12 transition-transform" />
            🤖 AI Trợ lý
          </Link>
        </div>
      </div>

      {/* 4 KPI Cards Section */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Việc cần xử lý */}
        <div className="relative overflow-hidden bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-800 dark:to-slate-900/50 rounded-2xl p-5 border border-slate-100/80 dark:border-slate-700/60 shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.02] group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 dark:bg-rose-400/5 rounded-bl-full pointer-events-none transition-transform duration-300 group-hover:scale-110" />
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <ClipboardList size={11} className="text-rose-500" /> CẦN XỬ LÝ
          </div>
          <div className="text-3xl font-black text-rose-500 dark:text-rose-400 leading-none tracking-tight">
            {actionItems.length}
          </div>
          <div className="text-[10px] text-rose-600 dark:text-rose-455 font-bold mt-2 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" /> Việc chờ bạn duyệt hoặc xác nhận
          </div>
        </div>

        {/* Card 2: Hồ sơ theo dõi */}
        <div className="relative overflow-hidden bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-800 dark:to-slate-900/50 rounded-2xl p-5 border border-slate-100/80 dark:border-slate-700/60 shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.02] group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 dark:bg-blue-400/5 rounded-bl-full pointer-events-none transition-transform duration-300 group-hover:scale-110" />
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <FileText size={11} className="text-blue-500" /> THEO DÕI CỦA TÔI
          </div>
          <div className="text-3xl font-black text-blue-600 dark:text-blue-400 leading-none tracking-tight">
            {trackingItems.length}
          </div>
          <div className="text-[10px] text-muted-foreground font-medium mt-2">
            Phiếu yêu cầu & quy trình đã tạo
          </div>
        </div>

        {/* Card 3: Cảnh báo rủi ro */}
        <div className="relative overflow-hidden bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-800 dark:to-slate-900/50 rounded-2xl p-5 border border-slate-100/80 dark:border-slate-700/60 shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.02] group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 dark:bg-amber-400/5 rounded-bl-full pointer-events-none transition-transform duration-300 group-hover:scale-110" />
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <AlertTriangle size={11} className="text-amber-500" /> CẢNH BÁO RỦI RO
          </div>
          <div className="text-3xl font-black text-amber-500 dark:text-amber-400 leading-none tracking-tight">
            {visibleNotifications.length + lowStockItems.length}
          </div>
          <div className="text-[10px] text-muted-foreground font-medium mt-2">
            Thông báo khẩn & tồn kho thấp
          </div>
        </div>

        {/* Card 4: Dự án theo dõi */}
        <div className="relative overflow-hidden bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-800 dark:to-slate-900/50 rounded-2xl p-5 border border-slate-100/80 dark:border-slate-700/60 shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.02] group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-teal-500/5 dark:bg-teal-400/5 rounded-bl-full pointer-events-none transition-transform duration-300 group-hover:scale-110" />
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <FolderKanban size={11} className="text-teal-500" /> DỰ ÁN THEO DÕI
          </div>
          <div className="text-3xl font-black text-teal-600 dark:text-teal-400 leading-none tracking-tight">
            {projectSummary ? projectSummary.activeSites : 0}
          </div>
          <div className="text-[10px] text-muted-foreground font-medium mt-2">
            Hồ sơ & công trường đang mở
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-slate-900 dark:text-white">Cần tôi xử lý</h2>
            <p className="text-xs font-bold text-slate-400">Ưu tiên việc quá hạn, khẩn cấp và hồ sơ đang chờ bạn.</p>
          </div>
          <StatusBadge status={actionItems.length > 0 ? 'pending' : 'completed'} label={actionItems.length > 0 ? `${actionItems.length} việc` : 'Không có việc'} tone={actionItems.length > 0 ? 'attention' : 'success'} />
        </div>

        {actionItems.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={20} />}
            title="Không có việc cần xử lý"
            message="Các hồ sơ chờ bạn duyệt hoặc xác nhận sẽ xuất hiện ở đây."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {actionItems.map(item => <NextActionCard key={item.id} {...item} />)}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white">Theo dõi của tôi</h2>
                <p className="text-xs font-bold text-slate-400">Những hồ sơ bạn tạo đang còn mở.</p>
              </div>
              <Link to="/rq" className="inline-flex items-center gap-1 text-xs font-black text-slate-600 hover:text-slate-900 dark:text-slate-300">
                Xem yêu cầu <FileText size={13} />
              </Link>
            </div>
            {trackingItems.length === 0 ? (
              <EmptyState
                icon={<FileText size={20} />}
                title="Chưa có hồ sơ đang mở"
                message="Các phiếu nháp, chờ duyệt hoặc đang xử lý do bạn tạo sẽ được gom ở đây."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {trackingItems.map(item => <NextActionCard key={item.id} {...item} />)}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">Lối tắt nghiệp vụ</h2>
              <p className="text-xs font-bold text-slate-400">Chỉ hiện những khu vực phù hợp với quyền hiện tại.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {shortcuts.map(item => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="rounded-2xl border border-slate-100/80 bg-gradient-to-br from-white to-slate-50/50 p-4 shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.02] hover:-translate-y-0.5 dark:border-slate-750 dark:from-slate-800 dark:to-slate-900/50 group"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-100 bg-slate-50/50 text-slate-600 dark:border-slate-750 dark:bg-slate-900 dark:text-slate-350 transition-transform duration-300 group-hover:scale-110">
                      {item.icon}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-black text-slate-900 dark:text-white">{item.title}</h3>
                      <p className="mt-1 text-xs font-medium leading-5 text-slate-450 dark:text-slate-400">{item.description}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">Cảnh báo</h2>
              <p className="text-xs font-bold text-slate-400">Thông tin cần chú ý để giảm sai sót vận hành.</p>
            </div>
            <div className="space-y-3">
              {visibleNotifications.length === 0 && lowStockItems.length === 0 ? (
                <EmptyState
                  icon={<ShieldCheck size={20} />}
                  title="Chưa có cảnh báo quan trọng"
                  message="Thông báo khẩn và cảnh báo tồn kho sẽ xuất hiện ở đây."
                />
              ) : (
                <>
                  {visibleNotifications.map(notification => (
                    <button
                      key={notification.id}
                      onClick={() => openNotification(notification)}
                      className="block w-full rounded-2xl border border-slate-100/80 bg-gradient-to-br from-white to-slate-50/50 p-4 text-left shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.01] hover:-translate-y-0.5 dark:border-slate-750 dark:from-slate-800 dark:to-slate-900/50 group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 text-red-500 transition-transform duration-300 group-hover:scale-110"><Bell size={16} /></div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="truncate text-sm font-black text-slate-900 dark:text-white">{notification.title}</h3>
                            <StatusBadge status={notification.severity} label={notification.severity === 'critical' ? 'Khẩn cấp' : 'Mới'} tone={notification.severity === 'critical' ? 'danger' : 'info'} />
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">{notification.message}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                  {lowStockItems.map(({ item, stock }) => (
                    <Link
                      key={item.id}
                      to="/inventory"
                      className="block rounded-2xl border border-amber-100/80 bg-gradient-to-br from-amber-50/50 to-amber-50 p-4 shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.01] hover:-translate-y-0.5 dark:border-amber-955/20 dark:from-amber-955/10 dark:to-amber-955/20 group"
                    >
                      <div className="flex items-start gap-3">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500 transition-transform duration-300 group-hover:scale-110" />
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-black text-amber-900 dark:text-amber-200">{item.name}</h3>
                          <p className="mt-1 text-xs font-bold text-amber-700 dark:text-amber-350">
                            Tồn {stock.toLocaleString('vi-VN')} {item.unit} / tối thiểu {Number(item.minStock || 0).toLocaleString('vi-VN')}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </>
              )}
            </div>
          </section>

          {projectSummary && (
            <section className="rounded-2xl border border-slate-100/80 bg-gradient-to-br from-white to-slate-50/50 p-5 shadow-sm transition-all duration-300 hover:shadow-md dark:border-slate-750 dark:from-slate-800 dark:to-slate-900/50 group">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-100 bg-slate-50/50 text-slate-655 dark:border-slate-750 dark:bg-slate-900 dark:text-slate-350 transition-transform duration-300 group-hover:scale-110">
                  <BriefcaseBusiness size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-black text-slate-900 dark:text-white">Dự án đang theo dõi</h2>
                  <p className="mt-1 text-xs font-medium leading-5 text-slate-455 dark:text-slate-400">
                    {projectSummary.activeFinances || projectSummary.activeSites} hồ sơ/dự án có dữ liệu đang mở.
                  </p>
                  <Link to="/da" className="mt-3 inline-flex items-center gap-1 text-xs font-black text-slate-900 dark:text-white hover:translate-x-0.5 transition-transform">
                    Mở dự án <FolderKanban size={13} />
                  </Link>
                </div>
              </div>
            </section>
          )}

          {isWarehouseKeeper(user) && (
            <section className="rounded-2xl border border-slate-100/80 bg-gradient-to-br from-white to-slate-50/50 p-5 shadow-sm transition-all duration-300 hover:shadow-md dark:border-slate-755 dark:from-slate-800 dark:to-slate-900/50 group">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-100 bg-slate-50/50 text-slate-655 dark:border-slate-755 dark:bg-slate-900 dark:text-slate-355 transition-transform duration-300 group-hover:scale-110">
                  <ArrowRightLeft size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-black text-slate-900 dark:text-white">Kho của bạn</h2>
                  <p className="mt-1 text-xs font-medium leading-5 text-slate-455 dark:text-slate-400">
                    Ưu tiên xử lý phiếu chờ duyệt, chờ xuất và chờ nhận để tồn kho luôn đáng tin.
                  </p>
                  <Link to="/operations" className="mt-3 inline-flex items-center gap-1 text-xs font-black text-slate-900 dark:text-white hover:translate-x-0.5 transition-transform">
                    Mở phiếu kho <Warehouse size={13} />
                  </Link>
                </div>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
};

export default Home;
