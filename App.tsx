
import React, { Suspense } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';
import Login from './pages/Login';
import { AppProvider, useApp } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { WorkflowProvider } from './context/WorkflowContext';
import { ChatProvider } from './context/ChatContext';
import { RequestProvider } from './context/RequestContext';
import ErrorBoundary from './components/ErrorBoundary';
import { Role } from './types';

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

// Knowledge Base
const KnowledgeBase = React.lazy(() => import('./pages/KnowledgeBase'));

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

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = !!localStorage.getItem('vioo_user');
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

// Route path → module key mapping
const ROUTE_TO_MODULE: Record<string, string> = {
  '/dashboard': 'WMS', '/requests': 'WMS', '/inventory': 'WMS', '/operations': 'WMS',
  '/audit': 'WMS', '/reports': 'WMS', '/misa-export': 'WMS',
  '/hrm/dashboard': 'HRM', '/hrm/checkin': 'HRM', '/hrm/employees': 'HRM',
  '/hrm/attendance': 'HRM', '/hrm/shifts': 'HRM', '/hrm/leave': 'HRM',
  '/hrm/payroll': 'HRM', '/hrm/contracts': 'HRM', '/hrm/documents': 'HRM', '/hrm/reports': 'HRM',
  '/wf/dashboard': 'WF', '/wf': 'WF', '/wf/templates': 'WF',
  '/da': 'DA', '/da/portfolio': 'DA',
  '/ts/dashboard': 'TS', '/ts/catalog': 'TS', '/ts/assignment': 'TS',
  '/ts/maintenance': 'TS', '/ts/audit': 'TS', '/ts/reports': 'TS',
  '/rq/dashboard': 'RQ', '/rq': 'RQ', '/rq/categories': 'RQ',
  '/expense': 'EX',
  '/ep': 'EP',
};

// Guard that checks sub-module permissions
const SubModuleGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useApp();
  const location = useLocation();
  
  // Admin always has access
  if (user.role === Role.ADMIN) return <>{children}</>;
  
  const pathname = location.pathname.replace(/^\/#/, ''); // Clean hash prefix if any
  const moduleKey = ROUTE_TO_MODULE[pathname];
  
  // If route doesn't map to a module, allow access (e.g., /settings, /chat)
  if (!moduleKey) return <>{children}</>;
  
  // Check sub-module restriction
  const allowedSubs = user.allowedSubModules?.[moduleKey];
  if (allowedSubs && allowedSubs.length > 0 && !allowedSubs.includes(pathname)) {
    // Redirect to the first allowed sub-module in this module, or home
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
          <Route index element={<LandingPage />} />
          <Route path="my-profile" element={<MyProfile />} />
          <Route path="employee-dashboard" element={<EmployeeDashboard />} />
          <Route path="dashboard" element={<EmployeeDashboard />} />
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
          <Route path="da" element={<ProjectDashboard />} />
          <Route path="da/portfolio" element={<PortfolioDashboard />} />
          <Route path="chat" element={<Chat />} />
          <Route path="storage" element={<DataStorage />} />
          <Route path="ai" element={<AiAssistant />} />
          <Route path="knowledge-base" element={<KnowledgeBase />} />
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
          <AppProvider>
            <WorkflowProvider>
              <RequestProvider>
                <ChatProvider>
                  <Router>
                    <AppRoutes />
                  </Router>
                </ChatProvider>
              </RequestProvider>
            </WorkflowProvider>
          </AppProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
};

export default App;
