
import React, { Suspense, useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation, matchPath } from 'react-router-dom';
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';
import Login from './pages/Login';
import { AppProvider, useApp } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { ThemeProvider } from './context/ThemeContext';
import { WorkflowProvider } from './context/WorkflowContext';
import { ChatProvider } from './context/ChatContext';
import { RequestProvider } from './context/RequestContext';
import { CelebrationProvider } from './components/Celebration';
import ErrorBoundary from './components/ErrorBoundary';
import { Role } from './types';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { ROUTE_TO_MODULE } from './constants/routes';

// Lazy load all page components for code splitting
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Inventory = React.lazy(() => import('./pages/Inventory'));
const Operations = React.lazy(() => import('./pages/Operations'));
const Settings = React.lazy(() => import('./pages/Settings'));
const RequestWorkflow = React.lazy(() => import('./pages/RequestWorkflow'));
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
const SupplierContracts = React.lazy(() => import('./pages/hd/SupplierContracts'));
const CustomerContracts = React.lazy(() => import('./pages/hd/CustomerContracts'));
const SubcontractorContracts = React.lazy(() => import('./pages/hd/SubcontractorContracts'));

// ── T1: ProtectedRoute — verify Supabase session thực sự ─────────────────────
// Khi Supabase được cấu hình: check session JWT từ Supabase Auth.
// Fallback mock mode (isSupabaseConfigured = false): dùng localStorage.
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authState, setAuthState] = useState<'loading' | 'ok' | 'no'>(
    // Khởi tạo ngay từ localStorage để tránh flash redirect khi đã login
    isSupabaseConfigured ? 'loading' : (!!localStorage.getItem('vioo_user') ? 'ok' : 'no')
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return; // Mock mode — đã xử lý ở initialState

    // Kiểm tra session hiện tại ngay khi mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthState(session ? 'ok' : 'no');
    });

    // Lắng nghe thay đổi: logout từ tab khác, token hết hạn
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthState(session ? 'ok' : 'no');
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
  if (allowedModules && allowedModules.length > 0 && !allowedModules.includes(moduleKey)) {
    return <Navigate to="/" replace />;
  }

  // User bị giới hạn sub-route trong module
  const allowedSubs = user.allowedSubModules?.[moduleKey];
  if (allowedSubs && allowedSubs.length > 0 && !allowedSubs.includes(pathname)) {
    return <Navigate to={allowedSubs[0] || '/'} replace />;
  }

  return <>{children}</>;
};

// Landing page: Always show EmployeeDashboard after login
const LandingPage: React.FC = () => {
  return <EmployeeDashboard />;
};

const AppRoutes: React.FC = () => {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><SubModuleGuard><Layout /></SubModuleGuard></ProtectedRoute>}>
          <Route index element={<MyProfile />} />
          <Route path="my-profile" element={<MyProfile />} />
          <Route path="employee-dashboard" element={<EmployeeDashboard />} />
          <Route path="custom-dashboard" element={<CustomDashboard />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="requests" element={<RequestWorkflow />} />
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
          <Route path="chat" element={<Chat />} />
          <Route path="storage" element={<DataStorage />} />
          <Route path="ai" element={<AiAssistant />} />
          <Route path="ai/executive" element={<ExecutiveAI />} />
          <Route path="ai/reports" element={<AiReports />} />
          <Route path="knowledge-base" element={<KnowledgeBase />} />
          <Route path="audit-trail" element={<AuditTrail />} />
          <Route path="analytics" element={<PredictiveAnalytics />} />
          <Route path="leaderboard" element={<Leaderboard />} />
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
            <Route index element={<Navigate to="supplier" replace />} />
            <Route path="supplier" element={<SupplierContracts />} />
            <Route path="customer" element={<CustomerContracts />} />
            <Route path="subcontractor" element={<SubcontractorContracts />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
};

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
                        <AppRoutes />
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
