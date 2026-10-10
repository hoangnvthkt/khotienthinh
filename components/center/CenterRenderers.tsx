import React, { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import RouteRenderer from './EmbeddedRoute';
import { appPageRoutes } from '../../routes/appPages';
import { embedDataModules } from '../../lib/center/embedData';
import { canAccessRoute } from '../../lib/routeAccess';
import { StateBox } from '../procurement/hub/hubUi';
import { useApp, type AppModule } from '../../context/AppContext';
import { useWorkflow } from '../../context/WorkflowContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useRequestDetail } from '../../hooks/useRequestDetail';
import { RequestDetailPanel } from '../request/RequestDetailPanel';
import { ProcurementHubView } from '../procurement/hub/ProcurementHubView';
import { FinanceHubView } from '../finance/FinanceHubView';
import SiteAssignmentView, { type AssignmentPerson } from '../hrm/assignment/SiteAssignmentView';
import type { RendererId } from '../../lib/center/centerRegistry';

// View thật của module nhúng vào tab Center (đã tách props-driven; cùng RPC, cùng quyền với màn module).
// File này tải lười: chỉ khi người dùng mở hồ sơ đầu tiên.

const RequestRenderer: React.FC<{ requestId: string }> = ({ requestId }) => {
  const detail = useRequestDetail(requestId);
  return (
    <RequestDetailPanel
      detail={detail.detail}
      loading={detail.loading}
      forbiddenOrMissing={detail.forbiddenOrMissing}
      error={detail.error}
      refresh={detail.refresh}
    />
  );
};

const ProcurementRenderer: React.FC<{ initialOrderId?: string; initialHotPurchaseId?: string; initialMode?: string }> = ({ initialOrderId, initialHotPurchaseId, initialMode }) => {
  const { user } = useApp();
  // Hub Mua hàng đọc tên vật tư / kho từ AppContext; màn /procurement được Layout nạp sẵn, ở Center tự nạp.
  useModuleData('wms-core');
  useModuleData('admin');
  return <ProcurementHubView currentUserId={user.id} initialOrderId={initialOrderId || null} initialHotPurchaseId={initialHotPurchaseId || null} initialMode={initialMode || null} />;
};

const FinanceRenderer: React.FC<{ initialSection?: string; initialRequestId?: string }> = ({ initialSection, initialRequestId }) => {
  const { user } = useApp();
  return <FinanceHubView currentUserId={user.id} initialSection={initialSection || null} initialRequestId={initialRequestId || null} />;
};

const SiteAssignmentRenderer: React.FC<{ initialSelectedId?: string }> = ({ initialSelectedId }) => {
  const { employees } = useApp();
  useModuleData('hrm');
  const people = useMemo<AssignmentPerson[]>(() => employees
    .filter(employee => employee.status === 'Đang làm việc')
    .map(employee => ({ id: employee.id, fullName: employee.fullName, employeeCode: employee.employeeCode, title: employee.title }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi')), [employees]);
  return <SiteAssignmentView people={people} initialSelectedId={initialSelectedId || null} />;
};

// Mọi màn của app mở ngay trong tab (chủ SP 10/10): cùng bảng route với router chính (routes/appPages.tsx), chạy bằng
// EmbeddedRoute. Tab tự nạp dữ liệu dùng chung theo màn (embedDataModules) và kiểm quyền vào màn như router chính;
// dữ liệu nghiệp vụ vẫn qua cùng RPC nên máy chủ vẫn chặn đúng.
const EmbedGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loadModuleData } = useApp();
  const { refreshData: refreshWorkflowData } = useWorkflow();
  const { pathname } = useLocation();
  const { modules, workflow } = embedDataModules(pathname);
  const key = modules.join(',');
  useEffect(() => {
    key.split(',').filter(Boolean).forEach(module => {
      loadModuleData(module as AppModule).catch(error => console.warn('Center embed data failed:', error));
    });
  }, [key, loadModuleData]);
  useEffect(() => {
    if (workflow) refreshWorkflowData().catch(error => console.warn('Center embed workflow data failed:', error));
  }, [workflow, refreshWorkflowData]);
  if (!canAccessRoute(user, pathname)) {
    return <div className="p-4"><StateBox kind="denied" title="Bạn chưa có quyền vào màn này" message="Nhờ quản trị cấp quyền module tương ứng." /></div>;
  }
  return <>{children}</>;
};

const EMBED_ROUTES = appPageRoutes(true);
const parseState = (raw: string | undefined): unknown => { if (!raw) return undefined; try { return JSON.parse(raw); } catch { return undefined; } };

export const RendererHost: React.FC<{ renderer: RendererId; props: Record<string, string>; onExit?: (path: string) => void }> = ({ renderer, props, onExit }) => {
  switch (renderer) {
    case 'route': return <RouteRenderer path={props.path} state={parseState(props.state)} routes={EMBED_ROUTES} gate={EmbedGate} onExit={onExit} />;
    case 'request': return <RequestRenderer requestId={props.requestId} />;
    case 'procurement': return <ProcurementRenderer initialOrderId={props.initialOrderId} initialHotPurchaseId={props.initialHotPurchaseId} initialMode={props.initialMode} />;
    case 'finance': return <FinanceRenderer initialSection={props.initialSection} initialRequestId={props.initialRequestId} />;
    case 'site_assignment': return <SiteAssignmentRenderer initialSelectedId={props.initialSelectedId} />;
    default: return null;
  }
};

export default RendererHost;
