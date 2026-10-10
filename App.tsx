
import React, { Suspense, useEffect, useRef } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';
import Login from './pages/Login';
import { AppProvider, useApp } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { ThemeProvider } from './context/ThemeContext';
import { WorkflowProvider, useWorkflow } from './context/WorkflowContext';
import { ChatProvider, useChat } from './context/ChatContext';
import { CelebrationProvider } from './components/Celebration';
import ErrorBoundary from './components/ErrorBoundary';
import ReleaseNotesModal from './components/ReleaseNotesModal';
import { isChatEnabled, isChatV2Enabled, isRequestApprovalPhase1Enabled } from './lib/featureFlags';
import { hasAnySettingsManagementFeature } from './lib/settingsPermissions';
import { useLatestReleaseNotice } from './hooks/useLatestReleaseNotice';
import { canAccessRoute, getAuthorizedRouteFallback } from './lib/routeAccess';
import {
  AuthProvider,
  AuthenticatedBoundary,
  AuthRecoveryScreen,
  useAuth,
} from './context/AuthContext';
import { selectApplicationShell } from './context/authState';
import { UserSessionTelemetryHost } from './hooks/useUserSessionTelemetry';
import { DailyLoginXpHost } from './hooks/useDailyLoginXp';
import { shouldWarmWorkflowData } from './lib/workflowWarmup';
import { getWorkflowWarmupModules } from './lib/appDataWarmupPolicy';
import { appPageRoutes } from './routes/appPages';

// Route and denied-route fallback both follow the current authorization snapshot.
const SubModuleGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useApp();
  const location = useLocation();

  const pathname = location.pathname;
  if (canAccessRoute(user, pathname)) return <>{children}</>;

  return <Navigate to={getAuthorizedRouteFallback(user, pathname)} replace />;
};

const AppRoutes: React.FC = () => {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/" element={<SubModuleGuard><Layout /></SubModuleGuard>}>
          {appPageRoutes()}
        </Route>
      </Routes>
    </Suspense>
  );
};

const AppDataWarmup: React.FC = () => {
  const { pathname } = useLocation();
  const {
    loadModuleData,
    setActiveRealtimeModules,
    user,
    users,
    employees,
    orgUnits,
    moduleLoadedAt,
    realtimeStatus,
  } = useApp();
  const { refreshData: refreshWorkflowData } = useWorkflow();
  const { loadChatData } = useChat();
  const lastFocusRefreshAtRef = useRef(0);
  const previousRealtimeStatusRef = useRef(realtimeStatus);

  useEffect(() => {
    if (
      pathname === '/login'
      || pathname === '/'
      || pathname === '/my-profile'
      || pathname === '/my-payroll'
      || pathname === '/hrm/checkin'
    ) {
      setActiveRealtimeModules([]);
      return;
    }

    const wmsRoutes = ['/dashboard', '/inventory', '/operations', '/requests', '/material-code-requests', '/reports', '/audit', '/misa-export'];
    if (wmsRoutes.some(route => pathname === route || pathname.startsWith(`${route}/`))) {
      setActiveRealtimeModules(['wms']);
      loadModuleData('wms').catch(err => console.warn('WMS lazy load failed:', err));
      return;
    }

    if (pathname.startsWith('/hrm') || pathname === '/my-profile' || pathname.startsWith('/employee-dashboard') || pathname.startsWith('/org-map')) {
      setActiveRealtimeModules(['hrm']);
      loadModuleData('hrm').catch(err => console.warn('HRM lazy load failed:', err));
      return;
    }

    if (pathname.startsWith('/da')) {
      setActiveRealtimeModules(['wms-core', 'admin', 'hrm']);
      Promise.all([
        loadModuleData('da'),
        loadModuleData('admin'),
        loadModuleData('hrm'),
      ]).catch(err => console.warn('Project lazy load failed:', err));
      return;
    }

    if (pathname.startsWith('/procurement')) {
      setActiveRealtimeModules(['wms-core', 'admin', 'hrm']);
      Promise.all([
        loadModuleData('wms-core'),
        loadModuleData('admin'),
        loadModuleData('hrm'),
      ]).catch(err => console.warn('Procurement lazy load failed:', err));
      return;
    }

    if (pathname.startsWith('/rq')) {
      const forceAdmin = users.length <= 1;
      setActiveRealtimeModules(['admin']);
      loadModuleData('admin', forceAdmin).catch(err => console.warn('Request people lazy load failed:', err));
      return;
    }

    if (pathname.startsWith('/wf')) {
      const forcePeople = users.length <= 1 || employees.length === 0 || orgUnits.length === 0;
      const workflowModules = getWorkflowWarmupModules(pathname);
      setActiveRealtimeModules(workflowModules);
      Promise.all(workflowModules.map(module => loadModuleData(module, forcePeople)))
        .catch(err => console.warn('Workflow people lazy load failed:', err));
      return;
    }

    if (pathname.startsWith('/ts')) {
      loadModuleData('ts').catch(err => console.warn('Asset lazy load failed:', err));
      return;
    }

    if (pathname.startsWith('/settings') || pathname.startsWith('/users')) {
      if (hasAnySettingsManagementFeature(user)) {
        setActiveRealtimeModules(['admin']);
        loadModuleData('admin').catch(err => console.warn('Admin lazy load failed:', err));
      } else {
        setActiveRealtimeModules([]);
      }
      return;
    }

    setActiveRealtimeModules([]);
  }, [employees.length, loadModuleData, orgUnits.length, pathname, setActiveRealtimeModules, user.role, users.length]);

  useEffect(() => {
    if (!shouldWarmWorkflowData(pathname)) return;
    refreshWorkflowData().catch(err => console.warn('Workflow warmup failed:', err));
  }, [pathname, refreshWorkflowData]);

  useEffect(() => {
    if (!pathname.startsWith('/wf')) return;
    const refreshWorkflowScreen = () => {
      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < 60_000) return;
      lastFocusRefreshAtRef.current = now;
      Promise.all([
        loadModuleData('workflow-people', true),
        refreshWorkflowData(),
      ]).catch(err => console.warn('Workflow focus refresh failed:', err));
    };
    const handleFocus = () => refreshWorkflowScreen();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshWorkflowScreen();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadModuleData, pathname, refreshWorkflowData]);

  useEffect(() => {
    if (!pathname.startsWith('/wf')) {
      previousRealtimeStatusRef.current = realtimeStatus;
      return;
    }
    const previous = previousRealtimeStatusRef.current;
    previousRealtimeStatusRef.current = realtimeStatus;
    if (realtimeStatus !== 'connected' || previous === 'connected') return;
    const peopleFresh = moduleLoadedAt['workflow-people'] && Date.now() - moduleLoadedAt['workflow-people'] < 60_000;
    Promise.all([
      loadModuleData('workflow-people', !peopleFresh),
      refreshWorkflowData(),
    ]).catch(err => console.warn('Workflow realtime recovery refresh failed:', err));
  }, [loadModuleData, moduleLoadedAt['workflow-people'], pathname, realtimeStatus, refreshWorkflowData]);

  useEffect(() => {
    if (isChatEnabled && !isChatV2Enabled && pathname === '/chat') {
      loadChatData().catch(err => console.warn('Chat warmup failed:', err));
    }
  }, [pathname, loadChatData]);

  return null;
};

const ReleaseNoticeHost: React.FC = () => {
  const location = useLocation();
  const { user } = useApp();
  const noticeUser = location.pathname === '/login' ? null : user;
  const {
    release,
    isOpen,
    isMarkingRead,
    acknowledgeRelease,
  } = useLatestReleaseNotice(noticeUser);

  return (
    <ReleaseNotesModal
      isOpen={isOpen}
      release={release}
      isSubmitting={isMarkingRead}
      onAcknowledge={acknowledgeRelease}
    />
  );
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

const PublicLoginRoute: React.FC = () => {
  const { status, error, retry, logout } = useAuth();
  if (status === 'authenticated') return <Navigate to="/" replace />;
  if (status === 'anonymous') return <Login />;
  if (status === 'error') {
    return <AuthRecoveryScreen error={error} retry={retry} logout={logout} />;
  }
  return <LoadingSpinner />;
};

export const AuthenticatedApplication: React.FC = () => (
  <AuthenticatedBoundary>
    <UserSessionTelemetryHost />
    <DailyLoginXpHost />
    <ConfirmProvider>
      <AppProvider>
        <WorkflowProvider>
          <ChatProvider>
            <CelebrationProvider>
              <RouteErrorBoundary>
                <AppDataWarmup />
                <ReleaseNoticeHost />
                <AppRoutes />
              </RouteErrorBoundary>
            </CelebrationProvider>
          </ChatProvider>
        </WorkflowProvider>
      </AppProvider>
    </ConfirmProvider>
  </AuthenticatedBoundary>
);

const ApplicationRouter: React.FC = () => {
  const { pathname } = useLocation();
  const shell = selectApplicationShell(pathname);
  return shell === 'public_login' ? <PublicLoginRoute /> : <AuthenticatedApplication />;
};

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <Router>
              <ApplicationRouter />
            </Router>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
};

export default App;
