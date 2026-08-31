import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  User as UserIcon,
  Briefcase,
  Calendar,
  MapPin,
  Clock,
  Award,
  Hash,
  ChevronRight,
  Shield,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  FileText,
  GitBranch,
  Inbox,
  CalendarOff,
  MessageCircle,
  Bot,
  ClipboardList,
  ArrowRight,
  Zap,
  Sparkles,
  CalendarCheck,
  Timer,
  CircleDot,
  XCircle,
  CheckCheck,
  Package,
  Warehouse,
  FolderKanban,
  Settings,
  BarChart3,
  ShoppingCart,
  Landmark,
  Calculator,
  Car,
  HardDrive,
  BookOpen,
  FileSignature,
  IdCard,
  AppWindow,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useWorkflow } from '../context/WorkflowContext';
import { useRequestList } from '../hooks/useRequestList';
import { AppNotification, notificationService } from '../lib/notificationService';
import { resolveNotificationPath } from '../lib/notificationRoutes';
import { buildRequestRoute } from '../lib/requestRoutes';
import { canUseModule, resolveHomeCapabilities } from '../lib/homeCapabilities';
import { isRequestModuleWorkflowTemplate } from '../lib/workflowVisibility';
import { canViewModule } from '../lib/permissions/permissionService';
import { canAccessRoute } from '../lib/routeAccess';
import {
  MaterialRequest,
  RequestStatus,
  Transaction,
  TransactionStatus,
  User,
  WorkflowInstance,
  WorkflowInstanceStatus,
} from '../types';
import { AnimatedNumber, LastUpdated } from '../components/LiveDashboardWidgets';
import DailyMissions from '../components/DailyMissions';
import { getTimeGreeting } from '../lib/funMessages';
import { isChatEnabled } from '../lib/featureFlags';
import {
  canApproveMaterialRequest,
  canApproveWmsTransaction,
  canExportMaterialRequest,
  canReceiveMaterialRequest,
  canReceiveWmsTransaction,
} from '../lib/wmsPermissions';

type HomeActionItem = {
  id: string;
  category: 'workflow' | 'rq' | 'material' | 'transaction' | 'tracking';
  score: number;
  title: string;
  code?: string;
  status: string;
  statusLabel?: string;
  nextAction?: string;
  actorName?: string;
  dueAt?: string;
  href: string;
  actionLabel?: string;
};

const nowTimestamp = () => Date.now();

const isOverdue = (value?: string | null) => {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time < nowTimestamp();
};

const getUserName = (users: User[], userId?: string | null) =>
  users.find(item => item.id === userId)?.name || userId || '';

const buildMaterialRequestHref = (request: MaterialRequest) => {
  const isProjectRequest = request.requestOrigin === 'project' || !!request.projectId || !!request.constructionSiteId;
  if (!isProjectRequest) return '/requests';

  const params = new URLSearchParams({
    tab: 'material',
    materialTab: 'request',
    requestId: request.id,
  });
  if (request.projectId) params.set('projectId', request.projectId);
  if (request.constructionSiteId) params.set('siteId', request.constructionSiteId);
  return `/da?${params.toString()}`;
};

const requestStatusLabel = (status: RequestStatus | string) => {
  if (status === RequestStatus.PENDING) return 'Chờ duyệt';
  if (status === RequestStatus.APPROVED) return 'Chờ xuất';
  if (status === RequestStatus.IN_TRANSIT) return 'Đang giao';
  if (status === RequestStatus.COMPLETED) return 'Đã nhận';
  if (status === RequestStatus.REJECTED) return 'Từ chối';
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
      title: request.title || 'Đề xuất vật tư',
      code: request.code,
      status: request.status,
      statusLabel: 'Chờ duyệt',
      nextAction: `Thẩm định yêu cầu từ ${siteName || 'công trường'}.`,
      actorName: getUserName(users, request.requesterId) || request.requestedBy,
      dueAt: request.expectedDate || request.createdDate,
      href: buildMaterialRequestHref(request),
      actionLabel: 'Mở yêu cầu',
    };
  }
  if (canExportMaterialRequest(user, request)) {
    return {
      id: `mr-export-${request.id}`,
      category: 'material',
      score: 84,
      title: request.title || 'Đề xuất vật tư',
      code: request.code,
      status: request.status,
      statusLabel: 'Chờ xuất',
      nextAction: `Kho ${sourceName || 'nguồn'} cần xuất vật tư cho ${siteName || 'công trường'}.`,
      actorName: getUserName(users, request.requesterId) || request.requestedBy,
      dueAt: request.expectedDate || request.createdDate,
      href: buildMaterialRequestHref(request),
      actionLabel: 'Xuất kho',
    };
  }
  if (canReceiveMaterialRequest(user, request)) {
    return {
      id: `mr-receive-${request.id}`,
      category: 'material',
      score: 82,
      title: request.title || 'Đề xuất vật tư',
      code: request.code,
      status: request.status,
      statusLabel: 'Đang giao',
      nextAction: `Xác nhận vật tư đã nhận tại ${siteName || 'kho công trường'}.`,
      actorName: getUserName(users, request.requesterId) || request.requestedBy,
      dueAt: request.expectedDate || request.createdDate,
      href: buildMaterialRequestHref(request),
      actionLabel: 'Xác nhận nhận',
    };
  }
  return null;
};

// ═══════════════════════════════════════════════════════
//  ALL SYSTEM APP DEFINITIONS (DYNAMIC CATALOG)
// ═══════════════════════════════════════════════════════

const SYSTEM_APPS = [
  // ── 1. CÁC TIỆN ÍCH CÁ NHÂN & TỰ PHỤC VỤ (ESS) ──
  {
    key: 'CHECKIN',
    to: '/hrm/checkin',
    label: 'Check-in',
    description: 'Chấm công GPS & Wifi',
    icon: MapPin,
    gradient: 'from-emerald-500 to-green-600',
    shadow: 'shadow-emerald-500/25',
    checkAccess: (u: User) => canAccessRoute(u, '/hrm/checkin'),
  },
  {
    key: 'LEAVE',
    to: '/hrm/leave',
    label: 'Nghỉ phép',
    description: 'Đơn xin nghỉ phép',
    icon: CalendarOff,
    gradient: 'from-violet-500 to-purple-600',
    shadow: 'shadow-violet-500/25',
    checkAccess: (u: User) => canAccessRoute(u, '/hrm/leave'),
  },
  {
    key: 'ATTENDANCE',
    to: '/hrm/attendance',
    label: 'Chấm công',
    description: 'Bảng công tháng',
    icon: CalendarCheck,
    gradient: 'from-teal-500 to-cyan-600',
    shadow: 'shadow-teal-500/25',
    checkAccess: (u: User) => canAccessRoute(u, '/hrm/attendance'),
  },
  {
    key: 'RQ',
    to: '/rq',
    label: 'Phiếu yêu cầu',
    description: 'Tạo & duyệt phiếu',
    icon: Inbox,
    gradient: 'from-cyan-500 to-sky-600',
    shadow: 'shadow-cyan-500/25',
    moduleKey: 'RQ',
  },
  {
    key: 'WF',
    to: '/wf',
    label: 'Quy trình',
    description: 'Luồng duyệt công việc',
    icon: GitBranch,
    gradient: 'from-blue-500 to-indigo-600',
    shadow: 'shadow-blue-500/25',
    moduleKey: 'WF',
  },
  {
    key: 'VEHICLE_BOOKING',
    to: '/booking/vehicle',
    label: 'Đặt xe',
    description: 'Điều xe công tác',
    icon: Car,
    gradient: 'from-sky-500 to-blue-600',
    shadow: 'shadow-sky-500/25',
    moduleKey: 'VEHICLE_BOOKING',
  },
  // ── 2. CÁC MODULE VẬN HÀNH & QUẢN TRỊ ──
  {
    key: 'WMS',
    to: '/inventory',
    label: 'Vật tư & Kho',
    description: 'Tồn kho & Phiếu kho',
    icon: Package,
    gradient: 'from-amber-500 to-orange-600',
    shadow: 'shadow-amber-500/25',
    moduleKey: 'WMS',
  },
  {
    key: 'DA',
    to: '/da',
    label: 'Dự án',
    description: 'Tiến độ, BOQ, Nhật trình',
    icon: BarChart3,
    gradient: 'from-indigo-500 to-blue-600',
    shadow: 'shadow-indigo-500/25',
    moduleKey: 'DA',
  },
  {
    key: 'PROCUREMENT',
    to: '/procurement',
    label: 'Mua hàng PO',
    description: 'Đơn mua & Đợt giao',
    icon: ShoppingCart,
    gradient: 'from-emerald-600 to-teal-700',
    shadow: 'shadow-emerald-600/25',
    moduleKey: 'PROCUREMENT',
  },
  {
    key: 'HRM',
    to: '/hrm/dashboard',
    label: 'Nhân sự',
    description: 'Dashboard & Danh bạ',
    icon: Briefcase,
    gradient: 'from-purple-500 to-pink-600',
    shadow: 'shadow-purple-500/25',
    moduleKey: 'HRM',
  },
  {
    key: 'TS',
    to: '/ts/dashboard',
    label: 'Tài sản',
    description: 'Quản lý trang thiết bị',
    icon: Landmark,
    gradient: 'from-rose-500 to-pink-600',
    shadow: 'shadow-rose-500/25',
    moduleKey: 'TS',
  },
  {
    key: 'EX',
    to: '/expense',
    label: 'Chi phí',
    description: 'Ngân sách & Quỹ',
    icon: Calculator,
    gradient: 'from-teal-600 to-emerald-700',
    shadow: 'shadow-teal-600/25',
    moduleKey: 'EX',
  },
  {
    key: 'HD',
    to: '/hd/partners',
    label: 'Hợp đồng',
    description: 'Đối tác & Hợp đồng',
    icon: FileSignature,
    gradient: 'from-blue-600 to-cyan-700',
    shadow: 'shadow-blue-600/25',
    moduleKey: 'HD',
  },
  {
    key: 'EP',
    to: '/ep',
    label: 'Hồ sơ NV',
    description: 'Thông tin nhân viên',
    icon: IdCard,
    gradient: 'from-fuchsia-500 to-purple-600',
    shadow: 'shadow-fuchsia-500/25',
    moduleKey: 'EP',
  },
  {
    key: 'STORAGE',
    to: '/storage',
    label: 'Kho dữ liệu',
    description: 'Lưu trữ tệp & tài liệu',
    icon: HardDrive,
    gradient: 'from-slate-600 to-slate-800',
    shadow: 'shadow-slate-600/25',
    moduleKey: 'STORAGE',
  },
  {
    key: 'KB',
    to: '/knowledge-base',
    label: 'Kho kiến thức',
    description: 'Tài liệu hướng dẫn',
    icon: BookOpen,
    gradient: 'from-amber-600 to-yellow-600',
    shadow: 'shadow-amber-600/25',
    moduleKey: 'KB',
  },
  {
    key: 'AI',
    to: '/ai',
    label: 'Trợ lý AI',
    description: 'Hỏi đáp thông minh',
    icon: Bot,
    gradient: 'from-fuchsia-500 to-rose-600',
    shadow: 'shadow-fuchsia-500/25',
    moduleKey: 'AI',
  },
  {
    key: 'TENDER_AI',
    to: '/tender-ai/boq',
    label: 'Tender AI',
    description: 'Bóc tách BOQ AI',
    icon: Bot,
    gradient: 'from-indigo-600 to-purple-700',
    shadow: 'shadow-indigo-600/25',
    moduleKey: 'TENDER_AI',
  },
  // ── 3. TRÒ CHUYỆN, HỒ SƠ & HỆ THỐNG ──
  {
    key: 'CHAT',
    to: '/chat',
    label: 'Tin nhắn',
    description: 'Trò chuyện nội bộ',
    icon: MessageCircle,
    gradient: 'from-pink-500 to-rose-600',
    shadow: 'shadow-pink-500/25',
    checkAccess: (u: User) => isChatEnabled && canAccessRoute(u, '/chat'),
  },
  {
    key: 'PROFILE',
    to: '/my-profile',
    label: 'Hồ sơ của tôi',
    description: 'Chữ ký & Tài khoản',
    icon: UserIcon,
    gradient: 'from-slate-700 to-slate-900',
    shadow: 'shadow-slate-700/25',
    checkAccess: () => true,
  },
  {
    key: 'SETTINGS',
    to: '/settings',
    label: 'Cài đặt',
    description: 'Cấu hình hệ thống',
    icon: Settings,
    gradient: 'from-zinc-600 to-slate-800',
    shadow: 'shadow-zinc-600/25',
    checkAccess: (u: User) => canAccessRoute(u, '/settings'),
  },
];

// ═══════════════════════════════════════════════════════
//  HOME ("HÔM NAY") — Unified Modern Personal Hub
// ═══════════════════════════════════════════════════════

const Home: React.FC = () => {
  const navigate = useNavigate();
  const {
    user,
    users = [],
    employees = [],
    hrmPositions = [],
    hrmOffices = [],
    orgUnits = [],
    attendanceRecords = [],
    leaveRequests = [],
    leaveBalances = [],
    assets = [],
    warehouses = [],
    transactions = [],
    requests: materialRequests = [],
    projectFinances = [],
    hrmConstructionSites = [],
    loadModuleData,
    lastRealtimeEvent,
  } = useApp();

  const {
    instances: workflowInstances = [],
    templates: workflowTemplates = [],
    nodes: workflowNodes = [],
    refreshData: refreshWorkflowData,
  } = useWorkflow();

  const assignedRequestList = useRequestList({ view: 'ASSIGNED_TO_ME' });
  const createdRequestList = useRequestList({ view: 'CREATED_BY_ME' });
  const watchingRequestList = useRequestList({ view: 'WATCHING' });

  const moduleCapabilities = useMemo(() => resolveHomeCapabilities(user), [user]);
  const shouldLoadWms = moduleCapabilities.material || moduleCapabilities.warehouse || moduleCapabilities.project;
  const shouldLoadProject = moduleCapabilities.project;

  // Eagerly load relevant modules on mount
  useEffect(() => {
    loadModuleData('hrm').catch(error => console.warn('Home HRM load failed:', error));
    loadModuleData('ts').catch(error => console.warn('Home TS load failed:', error));
    loadModuleData('admin').catch(error => console.warn('Home admin load failed:', error));
    refreshWorkflowData().catch(error => console.warn('Home workflow refresh failed:', error));
  }, [loadModuleData, refreshWorkflowData]);

  useEffect(() => {
    if (shouldLoadWms) loadModuleData('wms-core').catch(error => console.warn('Home WMS core load failed:', error));
  }, [loadModuleData, shouldLoadWms]);

  useEffect(() => {
    if (shouldLoadProject) loadModuleData('da').catch(error => console.warn('Home project load failed:', error));
  }, [loadModuleData, shouldLoadProject]);

  // ─── Filter all accessible apps for the user ───
  const accessibleApps = useMemo(() => {
    return SYSTEM_APPS.filter(app => {
      if (app.checkAccess) return app.checkAccess(user);
      if (app.moduleKey) {
        return canViewModule(user, app.moduleKey as any) && canAccessRoute(user, app.to);
      }
      return canAccessRoute(user, app.to);
    });
  }, [user]);

  // ─── Derived Employee Data ───
  const employee = useMemo(() => employees.find(e => e.userId === user.id), [employees, user.id]);
  const position = hrmPositions.find(p => p.id === employee?.positionId);
  const office = hrmOffices.find(o => o.id === employee?.officeId);
  const department = orgUnits.find(u => u.id === employee?.departmentId);
  const constructionSite = hrmConstructionSites.find(cs => cs.id === employee?.constructionSiteId);

  // Thâm niên
  const seniority = useMemo(() => {
    if (!employee?.startDate) return null;
    const start = new Date(employee.startDate);
    const now = new Date();
    const diff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 30) return `${diff} ngày`;
    if (diff < 365) return `${Math.floor(diff / 30)} tháng`;
    const years = Math.floor(diff / 365);
    const months = Math.floor((diff % 365) / 30);
    return months > 0 ? `${years} năm ${months} tháng` : `${years} năm`;
  }, [employee?.startDate]);

  // ─── Attendance Stats (this month) ───
  const nowDate = new Date();
  const thisMonth = nowDate.getMonth();
  const thisYear = nowDate.getFullYear();

  const monthlyAttendance = useMemo(() => {
    if (!employee) return { present: 0, absent: 0, late: 0, total: 0 };
    const myRecords = attendanceRecords.filter(r => {
      const d = new Date(r.date);
      return r.employeeId === employee.id && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    const present = myRecords.filter(r => r.status === 'present' || r.status === 'late').length;
    const late = myRecords.filter(r => r.status === 'late').length;
    const absent = myRecords.filter(r => r.status === 'absent').length;
    return { present, absent, late, total: myRecords.length };
  }, [attendanceRecords, employee, thisMonth, thisYear]);

  // Today's check-in
  const todayStr = nowDate.toISOString().split('T')[0];
  const todayAttendance = useMemo(() => {
    if (!employee) return null;
    return attendanceRecords.find(r => r.employeeId === employee.id && r.date === todayStr);
  }, [attendanceRecords, employee, todayStr]);

  // ─── Leave Balance ───
  const myLeaveBalance = useMemo(() => {
    if (!employee) return null;
    return leaveBalances.find(b => b.employeeId === employee.id && b.year === thisYear);
  }, [leaveBalances, employee, thisYear]);

  const remainingLeave = myLeaveBalance
    ? Math.max(0, (myLeaveBalance.accruedDays || 0) - (myLeaveBalance.usedPaidDays || 0))
    : 0;

  // ─── My Leave Requests ───
  const myLeaveRequests = useMemo(() => {
    if (!employee) return [];
    return leaveRequests.filter(lr => lr.employeeId === employee.id);
  }, [leaveRequests, employee]);

  const pendingLeaveRequests = myLeaveRequests.filter(lr => lr.status === 'pending');

  // ─── Action Items: Workflow Tasks ───
  const workflowTodos = useMemo<HomeActionItem[]>(() => workflowInstances
    .filter(instance => instance.status === WorkflowInstanceStatus.RUNNING)
    .map(instance => {
      const subjectType = String(instance.formData?.subjectType || instance.formData?.subject_type || '').toLowerCase();
      const subjectId = String(instance.formData?.subjectId || instance.formData?.subject_id || '');
      const isMaterialRequestWorkflow = subjectType === 'material_request'
        || materialRequests.some(request =>
          request.workflowInstanceId === instance.id
          || request.id === subjectId
        );
      if (isMaterialRequestWorkflow) return null;
      const { currentNode, assignedToCurrentUser, label } = getWorkflowAssignees(instance, workflowNodes, users, user);
      if (!assignedToCurrentUser) return null;
      const template = workflowTemplates.find(item => item.id === instance.templateId);
      if (isRequestModuleWorkflowTemplate(template)) return null;
      return {
        id: `wf-${instance.id}`,
        category: 'workflow',
        score: 90,
        title: instance.title,
        code: instance.code,
        status: instance.status,
        statusLabel: 'Đang xử lý',
        nextAction: `Xử lý bước ${currentNode?.label || 'hiện tại'}${template?.name ? ` • ${template.name}` : ''}`,
        actorName: label,
        dueAt: instance.updatedAt || instance.createdAt,
        href: `/wf?instanceId=${instance.id}`,
        actionLabel: 'Mở quy trình',
      } as HomeActionItem;
    })
    .filter(Boolean) as HomeActionItem[], [materialRequests, user, users, workflowInstances, workflowNodes, workflowTemplates]);

  // ─── Action Items: Request Approvals ───
  const rqTodos = useMemo<HomeActionItem[]>(() => assignedRequestList.items
    .map(request => ({
      id: `rq-${request.id}`,
      category: 'rq' as const,
      score: 78,
      title: request.title,
      code: request.code,
      status: request.status,
      statusLabel: 'Chờ duyệt',
      nextAction: `Duyệt phiếu ${request.templateName || 'yêu cầu nội bộ'}`,
      actorName: request.creator.name,
      dueAt: request.dueAt || request.createdAt,
      href: buildRequestRoute(request.id),
      actionLabel: 'Duyệt phiếu',
    }))
  , [assignedRequestList.items]);

  // ─── Action Items: WMS / Material Requests ───
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
      .sort((a, b) => b.score - a.score || String(b.dueAt || '').localeCompare(String(a.dueAt || '')));
  }, [rqTodos, wmsTodos, workflowTodos]);

  // ─── My Created & Watched Workflows ───
  const myWorkflowInstances = useMemo(() => {
    return workflowInstances
      .filter(inst => {
        if (inst.createdBy === user.id) return true;
        if (inst.watchers?.includes(user.id)) return true;
        const tmpl = workflowTemplates.find(t => t.id === inst.templateId);
        if (tmpl?.defaultWatchers?.includes(user.id)) return true;
        return false;
      })
      .map(inst => ({
        ...inst,
        isWatching: inst.createdBy !== user.id,
      }))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  }, [workflowInstances, workflowTemplates, user.id]);

  // ─── My Created & Watched Requests ───
  const myRequests = useMemo(() => {
    const created = createdRequestList.items.map(item => ({ ...item, isWatching: false }));
    const watching = watchingRequestList.items.map(item => ({ ...item, isWatching: true }));
    const seen = new Set<string>();
    const merged: Array<typeof created[0]> = [];
    for (const item of [...created, ...watching]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
    return merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [createdRequestList.items, watchingRequestList.items]);

  // ─── My Created Material Requests ───
  const myMaterialRequests = useMemo(() => {
    return materialRequests
      .filter(item => item.requesterId === user.id)
      .map(item => ({
        ...item,
        href: buildMaterialRequestHref(item),
      }));
  }, [materialRequests, user.id]);

  const trackingItems = useMemo<HomeActionItem[]>(() => {
    return shouldLoadWms ? materialRequests
      .filter(item => item.requesterId === user.id)
      .slice(0, 4)
      .map(item => ({
        id: `track-mr-${item.id}`,
        category: 'tracking' as const,
        score: 20,
        title: item.title || 'Đề xuất vật tư của tôi',
        code: item.code,
        status: item.status,
        statusLabel: requestStatusLabel(item.status),
        dueAt: item.expectedDate || item.createdDate,
        href: buildMaterialRequestHref(item),
        actionLabel: 'Xem yêu cầu',
      })) : [];
  }, [materialRequests, shouldLoadWms, user.id]);

  // ─── Assets assigned to me ───
  const myAssets = useMemo(() => {
    return assets.filter(a => a.assignedToUserId === user.id);
  }, [assets, user.id]);

  // ─── Total Combined Todos ───
  const totalTodos = actionItems.length;

  // Helpers
  const fmtDate = (d?: string) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const fmtRelative = (d?: string) => {
    if (!d) return '';
    const diff = nowDate.getTime() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${Math.max(1, mins)} phút trước`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} giờ trước`;
    const days = Math.floor(hours / 24);
    return `${days} ngày trước`;
  };

  // ─── Quick Stats Config ───
  const stats = [
    {
      label: 'Ngày công',
      value: monthlyAttendance.present,
      sub: `T${thisMonth + 1}/${thisYear}`,
      icon: <CalendarCheck size={18} />,
      gradient: 'from-teal-500 to-cyan-600',
      shadow: 'shadow-teal-500/30',
      onClick: () => navigate('/hrm/attendance'),
    },
    {
      label: 'Phép còn lại',
      value: remainingLeave,
      sub: `${myLeaveBalance?.usedPaidDays || 0} đã dùng`,
      icon: <CalendarOff size={18} />,
      gradient: 'from-violet-500 to-purple-600',
      shadow: 'shadow-violet-500/30',
      onClick: () => navigate('/hrm/leave'),
    },
    {
      label: 'Cần xử lý',
      value: totalTodos,
      sub: totalTodos > 0 ? 'hồ sơ chờ bạn' : 'đã xong hết',
      icon: <ClipboardList size={18} />,
      gradient: 'from-rose-500 to-pink-600',
      shadow: 'shadow-rose-500/30',
      onClick: () => {
        const el = document.getElementById('todo-section');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else navigate('/wf');
      },
    },
    {
      label: 'Theo dõi',
      value: myWorkflowInstances.length + myRequests.length,
      sub: 'hồ sơ tạo & theo dõi',
      icon: <FileText size={18} />,
      gradient: 'from-blue-500 to-indigo-600',
      shadow: 'shadow-blue-500/30',
      onClick: () => {
        const el = document.getElementById('tracking-section');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else navigate('/rq');
      },
    },
  ];

  const statusConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    RUNNING: { icon: <Timer size={12} />, color: 'text-blue-500 bg-blue-500/10', label: 'Đang chạy' },
    COMPLETED: { icon: <CheckCheck size={12} />, color: 'text-emerald-500 bg-emerald-500/10', label: 'Hoàn thành' },
    REJECTED: { icon: <XCircle size={12} />, color: 'text-red-500 bg-red-500/10', label: 'Từ chối' },
    CANCELLED: { icon: <XCircle size={12} />, color: 'text-slate-500 bg-slate-500/10', label: 'Đã hủy' },
    PENDING: { icon: <CircleDot size={12} />, color: 'text-amber-500 bg-amber-500/10', label: 'Chờ duyệt' },
    APPROVED: { icon: <CheckCircle2 size={12} />, color: 'text-emerald-500 bg-emerald-500/10', label: 'Đã duyệt' },
    IN_PROGRESS: { icon: <Timer size={12} />, color: 'text-blue-500 bg-blue-500/10', label: 'Đang xử lý' },
    DONE: { icon: <CheckCheck size={12} />, color: 'text-emerald-500 bg-emerald-500/10', label: 'Hoàn thành' },
    DRAFT: { icon: <FileText size={12} />, color: 'text-slate-400 bg-slate-400/10', label: 'Nháp' },
    RETURNED: { icon: <Timer size={12} />, color: 'text-orange-500 bg-orange-500/10', label: 'Đã trả lại' },
  };

  // ═══════════════════════════════════════════════════════
  //  SECTION COMPONENT: Glass Card Wrapper
  // ═══════════════════════════════════════════════════════
  const SectionCard: React.FC<{
    id?: string;
    title: string;
    icon: React.ReactNode;
    count?: number;
    children: React.ReactNode;
    action?: { label: string; onClick: () => void };
  }> = ({ id, title, icon, count, children, action }) => (
    <div id={id} className="rounded-2xl overflow-hidden bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/60 shadow-lg dark:shadow-slate-900/40 backdrop-blur-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700/50">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500 dark:text-indigo-400">{icon}</span>
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">{title}</h3>
          {count !== undefined && count > 0 && (
            <span className="text-[9px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center animate-pulse">{count}</span>
          )}
        </div>
        {action && (
          <button onClick={action.onClick} className="flex items-center gap-1 text-[10px] font-bold text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors">
            {action.label} <ArrowRight size={11} />
          </button>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-4 pb-8">
      {/* ═══════════ 1. HERO BANNER ═══════════ */}
      <div
        className="relative rounded-3xl overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 40%, #24243e 100%)',
          boxShadow: '0 20px 60px -12px rgba(48,43,99,0.5)',
        }}
      >
        {/* Animated mesh bg */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-0 -left-4 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-[80px] animate-pulse" style={{ animationDuration: '4s' }} />
          <div className="absolute top-0 right-0 w-72 h-72 bg-cyan-500 rounded-full mix-blend-multiply filter blur-[80px] animate-pulse" style={{ animationDuration: '6s', animationDelay: '2s' }} />
          <div className="absolute -bottom-8 left-20 w-72 h-72 bg-pink-500 rounded-full mix-blend-multiply filter blur-[80px] animate-pulse" style={{ animationDuration: '5s', animationDelay: '1s' }} />
        </div>

        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
          }}
        />

        <div className="relative px-5 sm:px-8 py-6 sm:py-8">
          <div className="flex items-center gap-4 sm:gap-6">
            {/* Avatar */}
            <div className="relative group shrink-0">
              <div className="absolute -inset-1 bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 rounded-2xl blur opacity-60 group-hover:opacity-80 transition-opacity duration-500" />
              <div
                className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center text-2xl sm:text-3xl font-black text-white overflow-hidden ring-2 ring-white/20 cursor-pointer"
                onClick={() => navigate('/my-profile')}
              >
                {user.avatar
                  ? <img src={user.avatar} className="w-full h-full object-cover" alt="" />
                  : (employee?.fullName || user.name || '?').charAt(0).toUpperCase()
                }
              </div>
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-400 rounded-full border-2 border-[#302b63] shadow-lg shadow-emerald-400/50" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h1
                className="text-xl sm:text-2xl font-black text-white tracking-tight drop-shadow-lg truncate cursor-pointer hover:text-indigo-200 transition-colors"
                onClick={() => navigate('/my-profile')}
              >
                {employee?.fullName || user.name}
              </h1>
              {/* Time-based greeting */}
              <p className="text-[11px] text-purple-200/80 font-medium mt-0.5 italic">
                {getTimeGreeting()}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {employee?.employeeCode && (
                  <span className="text-[9px] font-bold text-cyan-300 bg-cyan-400/10 px-2 py-0.5 rounded-md flex items-center gap-1 border border-cyan-400/20">
                    <Hash size={9} /> {employee.employeeCode}
                  </span>
                )}
                {position && (
                  <span className="text-[9px] font-bold text-amber-300 bg-amber-400/10 px-2 py-0.5 rounded-md flex items-center gap-1 border border-amber-400/20">
                    <Award size={9} /> {position.name}
                  </span>
                )}
                {department && (
                  <span className="text-[9px] font-bold text-emerald-300 bg-emerald-400/10 px-2 py-0.5 rounded-md border border-emerald-400/20">
                    {department.name}
                  </span>
                )}
                {constructionSite && (
                  <span className="text-[9px] font-bold text-orange-300 bg-orange-400/10 px-2 py-0.5 rounded-md flex items-center gap-1 border border-orange-400/20">
                    <MapPin size={9} /> {constructionSite.name}
                  </span>
                )}
              </div>
              {seniority && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400">
                  <TrendingUp size={11} className="text-purple-400" />
                  <span className="font-bold">Thâm niên: <span className="text-white">{seniority}</span></span>
                </div>
              )}
              <LastUpdated timestamp={lastRealtimeEvent} className="!text-slate-400" />
            </div>

            {/* Todo badge */}
            {totalTodos > 0 && (
              <div
                onClick={() => {
                  const el = document.getElementById('todo-section');
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="hidden sm:flex flex-col items-center px-4 py-3 rounded-2xl bg-white/[0.06] backdrop-blur-md border border-white/10 shrink-0 cursor-pointer hover:bg-white/[0.1] transition-colors"
              >
                <Zap size={14} className="text-amber-400 mb-1" />
                <div className="text-2xl font-black text-white">{totalTodos}</div>
                <div className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400">Việc cần làm</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════ 2. TRUY CẬP NHANH (LÊN ĐẦU TIÊN — TẤT CẢ APP KHẢ DỤNG) ═══════════ */}
      <div className="rounded-2xl overflow-hidden bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/60 shadow-lg dark:shadow-slate-900/40 backdrop-blur-xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3.5">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
              <Sparkles size={14} />
            </span>
            <span>Truy cập nhanh</span>
            <span className="text-[10px] font-bold text-slate-400 normal-case tracking-normal">
              ({accessibleApps.length} ứng dụng khả dụng)
            </span>
          </h3>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8 xl:grid-cols-10 gap-2.5 sm:gap-3">
          {accessibleApps.map(app => {
            const Icon = app.icon;
            return (
              <button
                key={app.key}
                onClick={() => navigate(app.to)}
                title={app.description || app.label}
                className="flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:shadow-md hover:scale-[1.06] active:scale-[0.95] group cursor-pointer"
              >
                <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${app.gradient} flex items-center justify-center text-white shadow-md ${app.shadow} group-hover:scale-110 group-hover:shadow-lg transition-all duration-300`}>
                  <Icon size={20} />
                </div>
                <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 text-center leading-tight line-clamp-2">
                  {app.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══════════ 3. QUICK STATS ═══════════ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((stat, i) => (
          <button
            key={i}
            onClick={stat.onClick}
            className="relative group rounded-2xl p-4 text-left transition-all duration-300 hover:scale-[1.03] hover:shadow-xl active:scale-[0.98] bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/60 shadow-md backdrop-blur-xl overflow-hidden cursor-pointer"
          >
            <div className={`absolute top-0 right-0 w-16 h-16 rounded-bl-[2rem] bg-gradient-to-br ${stat.gradient} opacity-10 group-hover:opacity-20 transition-opacity`} />
            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center text-white shadow-lg ${stat.shadow} mb-2 group-hover:scale-110 transition-transform`}>
              {stat.icon}
            </div>
            <div className="text-2xl font-black text-slate-800 dark:text-white"><AnimatedNumber value={stat.value} /></div>
            <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{stat.label}</div>
            <div className="text-[9px] text-slate-400/70 mt-0.5">{stat.sub}</div>
            <ChevronRight size={14} className="absolute top-4 right-3 text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400 transition-colors" />
          </button>
        ))}
      </div>

      {/* ═══════════ 4. TODO: WORKFLOW TASKS ═══════════ */}
      {workflowTodos.length > 0 && (
        <SectionCard
          id="todo-section"
          title="Quy trình chờ duyệt"
          icon={<GitBranch size={14} />}
          count={workflowTodos.length}
          action={{ label: 'Xem tất cả', onClick: () => navigate('/wf') }}
        >
          <div className="space-y-2">
            {workflowTodos.slice(0, 5).map(item => (
              <button
                key={item.id}
                onClick={() => navigate(item.href)}
                className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-violet-50 dark:hover:bg-violet-500/10 hover:shadow-md group text-left border border-transparent hover:border-violet-200 dark:hover:border-violet-500/20 cursor-pointer"
              >
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shrink-0 shadow-md shadow-violet-500/20 group-hover:scale-110 transition-transform">
                  <GitBranch size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-800 dark:text-white truncate">{item.title}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {item.code && (
                      <span className="text-[9px] font-mono font-bold text-violet-500 bg-violet-500/10 px-1.5 py-0.5 rounded">{item.code}</span>
                    )}
                    {item.nextAction && <span className="text-[9px] text-amber-600 font-bold">• {item.nextAction}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[9px] text-slate-400">{fmtRelative(item.dueAt)}</div>
                  <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 mt-1 ml-auto group-hover:text-violet-500 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ═══════════ 5. TODO: REQUEST APPROVALS ═══════════ */}
      {rqTodos.length > 0 && (
        <SectionCard
          title="Yêu cầu cần duyệt"
          icon={<Inbox size={14} />}
          count={rqTodos.length}
          action={{ label: 'Xem tất cả', onClick: () => navigate('/rq') }}
        >
          <div className="space-y-2">
            {rqTodos.slice(0, 5).map(item => (
              <button
                key={item.id}
                onClick={() => navigate(item.href)}
                className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 hover:shadow-md group text-left border border-transparent hover:border-cyan-200 dark:hover:border-cyan-500/20 cursor-pointer"
              >
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white shrink-0 shadow-md shadow-cyan-500/20 group-hover:scale-110 transition-transform">
                  <Inbox size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-800 dark:text-white truncate">{item.title}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {item.code && (
                      <span className="text-[9px] font-mono font-bold text-cyan-500 bg-cyan-500/10 px-1.5 py-0.5 rounded">{item.code}</span>
                    )}
                    {item.actorName && <span className="text-[9px] text-slate-400">Từ: {item.actorName}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[9px] text-slate-400">{fmtRelative(item.dueAt)}</div>
                  <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 mt-1 ml-auto group-hover:text-cyan-500 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ═══════════ 6. TODO: WMS / KHO & CẤP VẬT TƯ ═══════════ */}
      {wmsTodos.length > 0 && (
        <SectionCard
          title="Phiếu kho & Cấp vật tư chờ xử lý"
          icon={<Warehouse size={14} />}
          count={wmsTodos.length}
          action={{ label: 'Mở phiếu kho', onClick: () => navigate('/operations') }}
        >
          <div className="space-y-2">
            {wmsTodos.slice(0, 5).map(item => (
              <button
                key={item.id}
                onClick={() => navigate(item.href)}
                className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:shadow-md group text-left border border-transparent hover:border-emerald-200 dark:hover:border-emerald-500/20 cursor-pointer"
              >
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shrink-0 shadow-md shadow-emerald-500/20 group-hover:scale-110 transition-transform">
                  <Package size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-800 dark:text-white truncate">{item.title}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {item.code && (
                      <span className="text-[9px] font-mono font-bold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded">{item.code}</span>
                    )}
                    {item.nextAction && <span className="text-[9px] text-slate-500">{item.nextAction}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[9px] text-slate-400">{fmtRelative(item.dueAt)}</div>
                  <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 mt-1 ml-auto group-hover:text-emerald-500 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ═══════════ 7. MY WORKFLOWS ═══════════ */}
      {myWorkflowInstances.length > 0 && (
        <SectionCard
          id="tracking-section"
          title="Quy trình của tôi & Theo dõi"
          icon={<ClipboardList size={14} />}
          count={myWorkflowInstances.length}
          action={{ label: 'Xem tất cả', onClick: () => navigate('/wf') }}
        >
          <div className="space-y-2">
            {myWorkflowInstances.slice(0, 5).map(inst => {
              const tmpl = workflowTemplates.find(t => t.id === inst.templateId);
              const st = statusConfig[inst.status] || statusConfig.RUNNING;
              const creatorName = getUserName(users, inst.createdBy);
              return (
                <button
                  key={inst.id}
                  onClick={() => navigate('/wf')}
                  className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 group text-left cursor-pointer"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${st.color} shrink-0`}>
                    {st.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{inst.title}</span>
                      {inst.isWatching ? (
                        <span className="text-[8px] font-black uppercase text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded shrink-0 border border-indigo-200 dark:border-indigo-800">
                          Đang theo dõi
                        </span>
                      ) : (
                        <span className="text-[8px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded shrink-0">
                          Của tôi
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[9px] font-mono text-slate-400">{inst.code}</span>
                      {tmpl && <span className="text-[9px] text-slate-400">• {tmpl.name}</span>}
                      {inst.isWatching && creatorName && (
                        <span className="text-[9px] text-slate-400">• Tạo bởi: {creatorName}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${st.color}`}>{st.label}</span>
                    <span className="text-[9px] text-slate-400 mt-1">{fmtDate(inst.createdAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* ═══════════ 8. MY REQUESTS ═══════════ */}
      {myRequests.length > 0 && (
        <SectionCard
          title="Yêu cầu của tôi & Theo dõi"
          icon={<FileText size={14} />}
          count={myRequests.length}
          action={{ label: 'Xem tất cả', onClick: () => navigate('/rq') }}
        >
          <div className="space-y-2">
            {myRequests.slice(0, 5).map(req => {
              const st = statusConfig[req.status] || statusConfig.PENDING;
              return (
                <button
                  key={req.id}
                  onClick={() => navigate(buildRequestRoute(req.id))}
                  className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 group text-left cursor-pointer"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${st.color} shrink-0`}>
                    {st.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{req.title}</span>
                      {req.isWatching ? (
                        <span className="text-[8px] font-black uppercase text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/60 px-1.5 py-0.5 rounded shrink-0 border border-cyan-200 dark:border-cyan-800">
                          Đang theo dõi
                        </span>
                      ) : (
                        <span className="text-[8px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded shrink-0">
                          Của tôi
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[9px] font-mono text-slate-400">{req.code}</span>
                      <span className="text-[9px] text-slate-400">• {req.templateName}</span>
                      {req.isWatching && req.creator?.name && (
                        <span className="text-[9px] text-slate-400">• Người tạo: {req.creator.name}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${st.color}`}>{st.label}</span>
                    <span className="text-[9px] text-slate-400 mt-1">{fmtDate(req.createdAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* ═══════════ 9. MY MATERIAL REQUESTS ═══════════ */}
      {myMaterialRequests.length > 0 && (
        <SectionCard
          title="Đề xuất vật tư của tôi"
          icon={<Package size={14} />}
          action={{ label: 'Xem yêu cầu vật tư', onClick: () => navigate('/requests') }}
        >
          <div className="space-y-2">
            {myMaterialRequests.slice(0, 4).map(item => (
              <button
                key={item.id}
                onClick={() => navigate(buildMaterialRequestHref(item))}
                className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 group text-left cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-teal-500/10 text-teal-600 shrink-0">
                  <Package size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{item.title || 'Đề xuất vật tư'}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[9px] font-mono text-slate-400">{item.code}</span>
                    <span className="text-[9px] text-slate-400">• Ngày cần: {fmtDate(item.expectedDate || item.createdDate)}</span>
                  </div>
                </div>
                <div className="text-right shrink-0 flex flex-col items-end">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                    {requestStatusLabel(item.status)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ═══════════ 10. ATTENDANCE & SUMMARY ═══════════ */}
      <SectionCard
        title="Chấm công tháng này"
        icon={<Calendar size={14} />}
        action={{ label: 'Chi tiết', onClick: () => navigate('/hrm/attendance') }}
      >
        <div className="space-y-4">
          {/* Today status */}
          <button
            onClick={() => navigate('/hrm/checkin')}
            className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:shadow-md group border border-slate-100 dark:border-slate-700/50 hover:border-emerald-200 dark:hover:border-emerald-500/20 bg-gradient-to-r from-white to-slate-50 dark:from-slate-800 dark:to-slate-800/50 cursor-pointer"
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md ${todayAttendance
              ? 'bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-emerald-500/30'
              : 'bg-gradient-to-br from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-700 text-white shadow-slate-500/20'
            }`}>
              {todayAttendance ? <CheckCircle2 size={18} /> : <MapPin size={18} />}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-bold text-slate-800 dark:text-white">
                {todayAttendance ? 'Đã chấm công hôm nay' : 'Chưa chấm công hôm nay'}
              </div>
              {todayAttendance && (
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Vào: {todayAttendance.checkIn || '—'} {todayAttendance.checkOut ? `• Ra: ${todayAttendance.checkOut}` : ''}
                </div>
              )}
              {!todayAttendance && (
                <div className="text-[10px] text-emerald-500 font-bold mt-0.5">Nhấn để chấm công →</div>
              )}
            </div>
            <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 group-hover:text-emerald-500 transition-colors" />
          </button>

          {/* Monthly summary bars */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Có mặt', value: monthlyAttendance.present, color: 'bg-emerald-500', textColor: 'text-emerald-600 dark:text-emerald-400' },
              { label: 'Đi trễ', value: monthlyAttendance.late, color: 'bg-amber-500', textColor: 'text-amber-600 dark:text-amber-400' },
              { label: 'Vắng', value: monthlyAttendance.absent, color: 'bg-red-500', textColor: 'text-red-600 dark:text-red-400' },
            ].map((item, i) => (
              <button
                key={i}
                onClick={() => navigate('/hrm/attendance')}
                className="text-center p-3 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-100 dark:border-slate-700/50 hover:shadow-md transition-all hover:scale-[1.03] active:scale-[0.98] cursor-pointer"
              >
                <div className={`text-xl font-black ${item.textColor}`}>{item.value}</div>
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">{item.label}</div>
                <div className="w-full h-1 rounded-full bg-slate-200 dark:bg-slate-600 mt-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${item.color} transition-all duration-700`}
                    style={{ width: monthlyAttendance.total > 0 ? `${(item.value / monthlyAttendance.total) * 100}%` : '0%' }}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* ═══════════ 11. LEAVE REQUESTS ═══════════ */}
      {myLeaveRequests.length > 0 && (
        <SectionCard
          title="Đơn nghỉ phép"
          icon={<CalendarOff size={14} />}
          count={pendingLeaveRequests.length}
          action={{ label: 'Quản lý phép', onClick: () => navigate('/hrm/leave') }}
        >
          <div className="space-y-2">
            {myLeaveRequests.slice(0, 4).map(lr => {
              const leaveStatusMap: Record<string, { color: string; label: string }> = {
                pending: { color: 'text-amber-500 bg-amber-500/10', label: 'Chờ duyệt' },
                approved: { color: 'text-emerald-500 bg-emerald-500/10', label: 'Đã duyệt' },
                rejected: { color: 'text-red-500 bg-red-500/10', label: 'Từ chối' },
              };
              const st = leaveStatusMap[lr.status] || leaveStatusMap.pending;
              return (
                <button
                  key={lr.id}
                  onClick={() => navigate('/hrm/leave')}
                  className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 group text-left cursor-pointer"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${st.color} shrink-0`}>
                    <CalendarOff size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{lr.type || 'Nghỉ phép'}</div>
                    <div className="text-[10px] text-slate-400">{fmtDate(lr.startDate)} → {fmtDate(lr.endDate)} • {lr.totalDays} ngày</div>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${st.color} shrink-0`}>{st.label}</span>
                </button>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* ═══════════ 12. MY ASSETS ═══════════ */}
      {myAssets.length > 0 && (
        <SectionCard
          title="Tài sản được cấp"
          icon={<Shield size={14} />}
          action={{ label: 'Xem tất cả', onClick: () => navigate('/ts/catalog') }}
        >
          <div className="space-y-2">
            {myAssets.slice(0, 4).map(asset => (
              <button
                key={asset.id}
                onClick={() => navigate(`/ts/asset/${asset.id}`)}
                className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-rose-50 dark:hover:bg-rose-500/10 group text-left border border-transparent hover:border-rose-200 dark:hover:border-rose-500/20 cursor-pointer"
              >
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center text-white shrink-0 shadow-md shadow-rose-500/20 group-hover:scale-110 transition-transform">
                  <Shield size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{asset.name}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[9px] font-mono text-slate-400">{asset.code}</span>
                    {asset.brand && <span className="text-[9px] text-slate-400">• {asset.brand} {asset.model || ''}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{asset.originalValue?.toLocaleString('vi-VN')}đ</div>
                  <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 mt-0.5 ml-auto group-hover:text-rose-500 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ═══════════ 13. NHIỆM VỤ HÔM NAY (XUỐNG CUỐI CÙNG) ═══════════ */}
      <DailyMissions />

      {/* ═══════════ CELEBRATION EMPTY STATE ═══════════ */}
      {totalTodos === 0 && myWorkflowInstances.length === 0 && myRequests.length === 0 && (
        <div className="text-center py-10 px-6 rounded-2xl bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/60 shadow-lg">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/30">
            <CheckCircle2 size={28} />
          </div>
          <h4 className="text-lg font-black text-slate-800 dark:text-white">Không có việc cần làm 🎉</h4>
          <p className="text-sm text-slate-400 mt-1">Bạn đã hoàn thành tất cả công việc. Tuyệt vời!</p>
        </div>
      )}
    </div>
  );
};

export default Home;
