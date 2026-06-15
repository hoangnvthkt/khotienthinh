
import React, { Suspense, useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation, matchPath } from 'react-router-dom';
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';
import Login from './pages/Login';
import { AppProvider, useApp } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { ThemeProvider } from './context/ThemeContext';
import { WorkflowProvider, useWorkflow } from './context/WorkflowContext';
import { ChatProvider, useChat } from './context/ChatContext';
import { RequestProvider, useRequest } from './context/RequestContext';
import { CelebrationProvider } from './components/Celebration';
import ErrorBoundary from './components/ErrorBoundary';
import { Role } from './types';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { ROUTE_TO_MODULE } from './constants/routes';
import { getProjectAllowedSubModuleRedirect, hasProjectTabPermissionRoute } from './lib/projectTabPermissions';
import { createPerformanceTrace } from './lib/performanceTrace';
import { isChatEnabled } from './lib/featureFlags';

// Lazy load all page components for code splitting
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Home = React.lazy(() => import('./pages/Home'));
const Notifications = React.lazy(() => import('./pages/Notifications'));
const Inventory = React.lazy(() => import('./pages/Inventory'));
const Operations = React.lazy(() => import('./pages/Operations'));
const Settings = React.lazy(() => import('./pages/Settings'));
const RequestWorkflow = React.lazy(() => import('./pages/RequestWorkflow'));
const MaterialCodeRequests = React.lazy(() => import('./pages/MaterialCodeRequests'));
const Audit = React.lazy(() => import('./pages/Audit'));
const Reports = React.lazy(() => import('./pages/Reports'));
const MisaExport = React.lazy(() => import('./pages/MisaExport'));
const ProjectDashboard = React.lazy(() => import('./pages/ProjectDashboard'));
const PortfolioDashboard = React.lazy(() => import('./pages/PortfolioDashboard'));
const MyProfile = React.lazy(() => import('./pages/MyProfile'));
const EmployeeDashboard = React.lazy(() => import('./pages/EmployeeDashboard'));
const NotFound = React.lazy(() => import('./pages/NotFound'));

// HRM pages
const Employees = React.lazy(() => import('./pages/hrm/Employees'));
const Attendance = React.lazy(() => import('./pages/hrm/Attendance'));
const LeaveManagement = React.lazy(() => import('./pages/hrm/LeaveManagement'));
const Payroll = React.lazy(() => import('./pages/hrm/Payroll'));
const LaborContractPage = React.lazy(() => import('./pages/hrm/LaborContract'));
const CheckIn = React.lazy(() => import('./pages/hrm/CheckIn'));
const HrmReports = React.lazy(() => import('./pages/hrm/HrmReports'));
const HrmDashboard = React.lazy(() => import('./pages/hrm/HrmDashboard'));
const HrmDocuments = React.lazy(() => import('./pages/hrm/HrmDocuments'));
const ShiftManagement = React.lazy(() => import('./pages/hrm/ShiftManagement'));
const EmployeeRanking = React.lazy(() => import('./pages/hrm/EmployeeRanking'));

// Expense pages
const BudgetDashboard = React.lazy(() => import('./pages/expense/BudgetDashboard'));

// Workflow pages
const WorkflowInstances = React.lazy(() => import('./pages/wf/WorkflowInstances'));
const WorkflowTemplates = React.lazy(() => import('./pages/wf/WorkflowTemplates'));
const WorkflowBuilder = React.lazy(() => import('./pages/wf/WorkflowBuilder'));
const WorkflowDashboard = React.lazy(() => import('./pages/wf/WorkflowDashboard'));

// Chat
const Chat = React.lazy(() => import('./pages/Chat'));

// Data Storage
const DataStorage = React.lazy(() => import('./pages/DataStorage'));

// AI Assistant
const AiAssistant = React.lazy(() => import('./pages/AiAssistant'));
const ExecutiveAI = React.lazy(() => import('./pages/ExecutiveAI'));
const AiReports = React.lazy(() => import('./pages/AiReports'));

// Knowledge Base
const KnowledgeBase = React.lazy(() => import('./pages/KnowledgeBase'));

// Audit Trail
const AuditTrail = React.lazy(() => import('./pages/AuditTrail'));

// Predictive Analytics
const PredictiveAnalytics = React.lazy(() => import('./pages/PredictiveAnalytics'));

// Custom Dashboard
const CustomDashboard = React.lazy(() => import('./pages/CustomDashboard'));
const Leaderboard = React.lazy(() => import('./pages/Leaderboard'));
const FeedbackHub = React.lazy(() => import('./pages/FeedbackHub'));

// Request pages
const RequestCategories = React.lazy(() => import('./pages/request/RequestCategories'));
const RequestList = React.lazy(() => import('./pages/request/RequestList'));
const RequestDashboard = React.lazy(() => import('./pages/request/RequestDashboard'));

// Asset management pages
const AssetCatalog = React.lazy(() => import('./pages/ts/AssetCatalog'));
const AssetAssignment = React.lazy(() => import('./pages/ts/AssetAssignment'));
const AssetDashboard = React.lazy(() => import('./pages/ts/AssetDashboard'));
const AssetAudit = React.lazy(() => import('./pages/ts/AssetAudit'));
const AssetReports = React.lazy(() => import('./pages/ts/AssetReports'));
const AssetMaintenancePage = React.lazy(() => import('./pages/ts/AssetMaintenance'));
const AssetProfile = React.lazy(() => import('./pages/ts/AssetProfile'));

// Employee Profile pages
const EmployeeDirectory = React.lazy(() => import('./pages/ep/EmployeeDirectory'));
const EmployeeProfilePage = React.lazy(() => import('./pages/ep/EmployeeProfile'));

// 3D Org Map
const OrgMap3D = React.lazy(() => import('./pages/orgmap/OrgMap3D'));

// Contract management pages
const ContractLayout = React.lazy(() => import('./pages/hd/ContractLayout'));
const ContractOverview = React.lazy(() => import('./pages/hd/ContractOverview'));
const BusinessPartners = React.lazy(() => import('./pages/hd/BusinessPartners'));
const ContractTypes = React.lazy(() => import('./pages/hd/ContractTypes'));
const ContractCatalogs = React.lazy(() => import('./pages/hd/ContractCatalogs'));
const CostLibrary = React.lazy(() => import('./pages/hd/CostLibrary'));
const SupplierContracts = React.lazy(() => import('./pages/hd/SupplierContracts'));
const CustomerContracts = React.lazy(() => import('./pages/hd/CustomerContracts'));
const SubcontractorContracts = React.lazy(() => import('./pages/hd/SubcontractorContracts'));
const ContractWorkspacePage = React.lazy(() => import('./pages/hd/ContractWorkspacePage'));
const TenderAiLayout = React.lazy(() => import('./pages/tender-ai/TenderAiLayout'));
const TenderBoqAnalyzer = React.lazy(() => import('./pages/tender-ai/TenderBoqAnalyzer'));

// ── T1: ProtectedRoute — verify Supabase session thực sự ─────────────────────
// Khi Supabase được cấu hình: check session JWT từ Supabase Auth.
// Fallback mock mode (isSupabaseConfigured = false): dùng localStorage.
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authState, setAuthState] = useState<'loading' | 'ok' | 'no'>(
    // Khởi tạo ngay từ localStorage để tránh flash redirect khi đã login
    !!localStorage.getItem('vioo_user') ? 'ok' : (isSupabaseConfigured ? 'loading' : 'no')
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return; // Mock mode — đã xử lý ở initialState
    const hasCachedUser = () => Boolean(localStorage.getItem('vioo_user'));
    const isExplicitLogout = () => {
      const logoutAt = Number(localStorage.getItem('vioo_explicit_logout_at') || 0);
      return logoutAt > 0 && Date.now() - logoutAt < 15000;
    };

    // Kiểm tra session hiện tại ngay khi mount
    const trace = createPerformanceTrace('protected-route-session-check', {
      path: window.location.hash || window.location.pathname,
      hasSavedUser: !!localStorage.getItem('vioo_user'),
    });
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        const useCachedUser = !session && hasCachedUser();
        trace.finish({ hasSession: !!session, useCachedUser });
        setAuthState(session || hasCachedUser() ? 'ok' : 'no');
      })
      .catch(error => {
        console.warn('Supabase session check failed, keeping cached user if present:', error);
        const useCachedUser = hasCachedUser();
        trace.finish({ hasSession: false, useCachedUser, error: error?.message || 'getSession failed' });
        setAuthState(hasCachedUser() ? 'ok' : 'no');
      });

    // Lắng nghe thay đổi: logout từ tab khác, token hết hạn
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setAuthState('ok');
        return;
      }
      if (event === 'SIGNED_OUT' && isExplicitLogout()) {
        setAuthState('no');
        return;
      }
      setAuthState(hasCachedUser() ? 'ok' : 'no');
    });

    return () => subscription.unsubscribe();
  }, []);

  if (authState === 'loading') return <LoadingSpinner />;
  if (authState === 'no') return <Navigate to="/login" replace />;
  return <>{children}</>;
};

// ── T2: SubModuleGuard — check phân quyền sub-module ─────────────────────────
// Dùng ROUTE_TO_MODULE từ constants/routes.ts (T3).
// Chỉ block user EMPLOYEE có allowedSubModules bị giới hạn.
const SubModuleGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useApp();
  const location = useLocation();

  // Admin luôn có quyền truy cập
  if (user.role === Role.ADMIN) return <>{children}</>;

  // Với HashRouter, location.pathname là path thực (không có #)
  // VD: /hrm/dashboard — không cần clean gì thêm
  const pathname = location.pathname;
  const moduleKey = ROUTE_TO_MODULE[pathname] ||
    Object.entries(ROUTE_TO_MODULE).find(([routePattern]) =>
      routePattern.includes(':') && matchPath({ path: routePattern, end: true }, pathname)
    )?.[1];

  // Route không nằm trong map → không guard (settings, chat, profile...)
  if (!moduleKey) return <>{children}</>;

  // User không được phép dùng module này nói chung
  const allowedModules = user.allowedModules;
  if (allowedModules !== undefined && !allowedModules.includes(moduleKey)) {
    return <Navigate to="/" replace />;
  }

  // User bị giới hạn sub-route trong module
  const hasSubModuleRestriction = Object.prototype.hasOwnProperty.call(user.allowedSubModules || {}, moduleKey);
  const allowedSubs = user.allowedSubModules?.[moduleKey] || [];
  if (hasSubModuleRestriction && allowedSubs.length === 0) {
    return <Navigate to="/" replace />;
  }
  if (hasSubModuleRestriction && !allowedSubs.includes(pathname)) {
    const canOpenProjectShell =
      moduleKey === 'DA' &&
      pathname === '/da' &&
      hasProjectTabPermissionRoute(allowedSubs);
    if (!canOpenProjectShell) {
      const redirectTo = moduleKey === 'DA'
        ? getProjectAllowedSubModuleRedirect(allowedSubs)
        : allowedSubs[0] || '/';
      return <Navigate to={redirectTo} replace />;
    }
  }

  return <>{children}</>;
};

// Landing page wrapper kept for compatibility with older references.
const LandingPage: React.FC = () => {
  return <Home />;
};

const AppRoutes: React.FC = () => {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><SubModuleGuard><Layout /></SubModuleGuard></ProtectedRoute>}>
          <Route index element={<Home />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="my-profile" element={<MyProfile />} />
          <Route path="employee-dashboard" element={<EmployeeDashboard />} />
          <Route path="custom-dashboard" element={<CustomDashboard />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="requests" element={<RequestWorkflow />} />
          <Route path="material-code-requests" element={<MaterialCodeRequests />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="operations" element={<Operations />} />
          <Route path="audit" element={<Audit />} />
          <Route path="reports" element={<Reports />} />
          <Route path="wf" element={<WorkflowInstances />} />
          <Route path="wf/dashboard" element={<WorkflowDashboard />} />
          <Route path="wf/templates" element={<WorkflowTemplates />} />
          <Route path="wf/builder/:id" element={<WorkflowBuilder />} />
          <Route path="users" element={<Navigate to="/settings" replace />} />
          <Route path="settings" element={<Settings />} />
          <Route path="misa-export" element={<MisaExport />} />
          <Route path="hrm/employees" element={<Employees />} />
          <Route path="hrm/dashboard" element={<HrmDashboard />} />
          <Route path="expense" element={<BudgetDashboard />} />
          <Route path="hrm/attendance" element={<Attendance />} />
          <Route path="hrm/shifts" element={<ShiftManagement />} />
          <Route path="hrm/leave" element={<LeaveManagement />} />
          <Route path="hrm/payroll" element={<Payroll />} />
          <Route path="hrm/contracts" element={<LaborContractPage />} />
          <Route path="hrm/checkin" element={<CheckIn />} />
          <Route path="hrm/reports" element={<HrmReports />} />
          <Route path="hrm/documents" element={<HrmDocuments />} />
          <Route path="hrm/ranking" element={<EmployeeRanking />} />
          <Route path="da" element={<ProjectDashboard />} />
          <Route path="da/portfolio" element={<PortfolioDashboard />} />
          <Route path="chat" element={isChatEnabled ? <Chat /> : <Navigate to="/" replace />} />
          <Route path="storage" element={<DataStorage />} />
          <Route path="ai" element={<AiAssistant />} />
          <Route path="ai/executive" element={<ExecutiveAI />} />
          <Route path="ai/reports" element={<AiReports />} />
          <Route path="knowledge-base" element={<KnowledgeBase />} />
          <Route path="audit-trail" element={<AuditTrail />} />
          <Route path="analytics" element={<PredictiveAnalytics />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="feedback" element={<FeedbackHub />} />
          <Route path="rq" element={<RequestList />} />
          <Route path="rq/dashboard" element={<RequestDashboard />} />
          <Route path="rq/categories" element={<RequestCategories />} />
          <Route path="ts/dashboard" element={<AssetDashboard />} />
          <Route path="ts/catalog" element={<AssetCatalog />} />
          <Route path="ts/assignment" element={<AssetAssignment />} />
          <Route path="ts/audit" element={<AssetAudit />} />
          <Route path="ts/reports" element={<AssetReports />} />
          <Route path="ts/maintenance" element={<AssetMaintenancePage />} />
          <Route path="ts/asset/:id" element={<AssetProfile />} />
          <Route path="ep" element={<EmployeeDirectory />} />
          <Route path="ep/:employeeId" element={<EmployeeProfilePage />} />
          <Route path="org-map" element={<OrgMap3D />} />
          <Route path="hd" element={<ContractLayout />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<ContractOverview />} />
            <Route path="partners" element={<BusinessPartners />} />
            <Route path="contract-types" element={<ContractTypes />} />
            <Route path="catalogs" element={<ContractCatalogs />} />
            <Route path="cost-library" element={<CostLibrary />} />
            <Route path="supplier" element={<SupplierContracts />} />
            <Route path="customer" element={<CustomerContracts />} />
            <Route path="customer/:id" element={<ContractWorkspacePage contractType="customer" />} />
            <Route path="subcontractor" element={<SubcontractorContracts />} />
            <Route path="subcontractor/:id" element={<ContractWorkspacePage contractType="subcontractor" />} />
          </Route>
          <Route path="tender-ai" element={<TenderAiLayout />}>
            <Route index element={<Navigate to="boq" replace />} />
            <Route path="boq" element={<TenderBoqAnalyzer />} />
            <Route path="cost-library" element={<CostLibrary />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
};

const AppDataWarmup: React.FC = () => {
  const { pathname } = useLocation();
  const { loadModuleData, setActiveRealtimeModules } = useApp();
  const { refreshData: refreshWorkflowData } = useWorkflow();
  const { refreshData: refreshRequestData } = useRequest();
  const { loadChatData } = useChat();

  useEffect(() => {
    if (pathname === '/login' || pathname === '/' || pathname === '/my-profile') {
      setActiveRealtimeModules([]);
      return;
    }

    const wmsRoutes = ['/dashboard', '/inventory', '/operations', '/requests', '/material-code-requests', '/reports', '/audit', '/misa-export'];
    if (wmsRoutes.some(route => pathname === route || pathname.startsWith(`${route}/`))) {
      setActiveRealtimeModules(['wms']);
      loadModuleData('wms').catch(err => console.warn('WMS lazy load failed:', err));
      return;
    }

    if (pathname.startsWith('/hrm') || pathname.startsWith('/employee-dashboard') || pathname.startsWith('/org-map')) {
      setActiveRealtimeModules(['hrm']);
      loadModuleData('hrm').catch(err => console.warn('HRM lazy load failed:', err));
      return;
    }

    if (pathname.startsWith('/da')) {
      setActiveRealtimeModules(['wms-core']);
      loadModuleData('da').catch(err => console.warn('Project lazy load failed:', err));
      return;
    }

    if (pathname.startsWith('/ts')) {
      loadModuleData('ts').catch(err => console.warn('Asset lazy load failed:', err));
      return;
    }

    if (pathname.startsWith('/expense')) {
      loadModuleData('ex').catch(err => console.warn('Expense lazy load failed:', err));
      return;
    }

    if (pathname.startsWith('/settings') || pathname.startsWith('/users')) {
      setActiveRealtimeModules(['admin']);
      loadModuleData('admin').catch(err => console.warn('Admin lazy load failed:', err));
      return;
    }

    setActiveRealtimeModules([]);
  }, [pathname, loadModuleData, setActiveRealtimeModules]);

  useEffect(() => {
    const needsWorkflowData = pathname.startsWith('/wf') || pathname === '/employee-dashboard' || pathname === '/custom-dashboard';
    if (!needsWorkflowData) return;
    refreshWorkflowData().catch(err => console.warn('Workflow warmup failed:', err));
  }, [pathname, refreshWorkflowData]);

  useEffect(() => {
    const needsRequestData = pathname.startsWith('/rq') || pathname === '/employee-dashboard' || pathname === '/custom-dashboard';
    if (!needsRequestData) return;
    refreshRequestData().catch(err => console.warn('Request warmup failed:', err));
  }, [pathname, refreshRequestData]);

  useEffect(() => {
    if (isChatEnabled && pathname === '/chat') {
      loadChatData().catch(err => console.warn('Chat warmup failed:', err));
    }
  }, [pathname, loadChatData]);

  return null;
};

const RouteErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const resetKey = `${location.pathname}${location.search}${location.hash}`;

  return <ErrorBoundary resetKey={resetKey}>{children}</ErrorBoundary>;
};

const normalizeDirectHashRoute = () => {
  if (typeof window === 'undefined') return;
  const { pathname, search, hash } = window.location;
  if (hash || pathname === '/' || pathname === '') return;
  window.history.replaceState(null, '', `/#${pathname}${search}`);
};

normalizeDirectHashRoute();

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AppProvider>
              <WorkflowProvider>
                <RequestProvider>
                  <ChatProvider>
                    <CelebrationProvider>
                      <Router>
                        <RouteErrorBoundary>
                          <AppDataWarmup />
                          <AppRoutes />
                        </RouteErrorBoundary>
                      </Router>
                    </CelebrationProvider>
                  </ChatProvider>
                </RequestProvider>
              </WorkflowProvider>
            </AppProvider>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
};

export default App;
