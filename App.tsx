
import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Operations from './pages/Operations';
import Settings from './pages/Settings';
import RequestWorkflow from './pages/RequestWorkflow';
import Audit from './pages/Audit';
import Reports from './pages/Reports';
import MisaExport from './pages/MisaExport';
import Login from './pages/Login';
import ProjectDashboard from './pages/ProjectDashboard';
import PortfolioDashboard from './pages/PortfolioDashboard';
import MyProfile from './pages/MyProfile';
import Employees from './pages/hrm/Employees';
import WorkflowInstances from './pages/wf/WorkflowInstances';
import WorkflowTemplates from './pages/wf/WorkflowTemplates';
import WorkflowBuilder from './pages/wf/WorkflowBuilder';
import Chat from './pages/Chat';
import RequestCategories from './pages/request/RequestCategories';
import RequestList from './pages/request/RequestList';
import AssetCatalog from './pages/ts/AssetCatalog';
import AssetAssignment from './pages/ts/AssetAssignment';
import AssetDashboard from './pages/ts/AssetDashboard';
import AssetAudit from './pages/ts/AssetAudit';
import AssetReports from './pages/ts/AssetReports';
import AssetMaintenancePage from './pages/ts/AssetMaintenance';
import AssetProfile from './pages/ts/AssetProfile';
import { AppProvider } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { WorkflowProvider } from './context/WorkflowContext';
import { ChatProvider } from './context/ChatContext';
import { RequestProvider } from './context/RequestContext';
import ErrorBoundary from './components/ErrorBoundary';
import NotFound from './pages/NotFound';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = !!localStorage.getItem('khoviet_user');
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<MyProfile />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="requests" element={<RequestWorkflow />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="operations" element={<Operations />} />
        <Route path="audit" element={<Audit />} />
        <Route path="reports" element={<Reports />} />
        <Route path="wf" element={<WorkflowInstances />} />
        <Route path="wf/templates" element={<WorkflowTemplates />} />
        <Route path="wf/builder/:id" element={<WorkflowBuilder />} />
        <Route path="users" element={<Navigate to="/settings" replace />} />
        <Route path="settings" element={<Settings />} />
        <Route path="misa-export" element={<MisaExport />} />
        <Route path="hrm/employees" element={<Employees />} />
        <Route path="da" element={<ProjectDashboard />} />
        <Route path="da/portfolio" element={<PortfolioDashboard />} />
        <Route path="chat" element={<Chat />} />
        <Route path="rq" element={<RequestList />} />
        <Route path="rq/categories" element={<RequestCategories />} />
        <Route path="ts/dashboard" element={<AssetDashboard />} />
        <Route path="ts/catalog" element={<AssetCatalog />} />
        <Route path="ts/assignment" element={<AssetAssignment />} />
        <Route path="ts/audit" element={<AssetAudit />} />
        <Route path="ts/reports" element={<AssetReports />} />
        <Route path="ts/maintenance" element={<AssetMaintenancePage />} />
        <Route path="ts/asset/:id" element={<AssetProfile />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
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
