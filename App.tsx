
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
import Employees from './pages/hrm/Employees';
import WorkflowInstances from './pages/wf/WorkflowInstances';
import WorkflowTemplates from './pages/wf/WorkflowTemplates';
import WorkflowBuilder from './pages/wf/WorkflowBuilder';
import Chat from './pages/Chat';
import AssetCatalog from './pages/ts/AssetCatalog';
import AssetAssignment from './pages/ts/AssetAssignment';
import CashBook from './pages/kt/CashBook';
import CashVouchers from './pages/kt/CashVouchers';
import { AppProvider } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { WorkflowProvider } from './context/WorkflowContext';
import { ChatProvider } from './context/ChatContext';
import { FinanceProvider } from './context/FinanceContext';
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
        <Route index element={<Dashboard />} />
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
        <Route path="chat" element={<Chat />} />
        <Route path="ts/catalog" element={<AssetCatalog />} />
        <Route path="ts/assignment" element={<AssetAssignment />} />
        <Route path="kt" element={<CashBook />} />
        <Route path="kt/vouchers" element={<CashVouchers />} />
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
              <ChatProvider>
                <FinanceProvider>
                  <Router>
                    <AppRoutes />
                  </Router>
                </FinanceProvider>
              </ChatProvider>
            </WorkflowProvider>
          </AppProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
};

export default App;
