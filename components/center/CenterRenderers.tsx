import React, { useEffect, useMemo } from 'react';
import RouteRenderer from './EmbeddedRoute';
import { useApp, type AppModule } from '../../context/AppContext';
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

// Màn thật của module mở ngay trong tab (không qua bước "Mở ở màn …"), chạy bằng EmbeddedRoute.
// Quyền: trang gọi cùng RPC như màn module nên máy chủ vẫn chặn đúng.
const LeaveManagement = React.lazy(() => import('../../pages/hrm/LeaveManagement'));
const Attendance = React.lazy(() => import('../../pages/hrm/Attendance'));
const TimesheetClose = React.lazy(() => import('../../pages/hrm/TimesheetClose'));
const Employees = React.lazy(() => import('../../pages/hrm/Employees'));
const ProjectDashboard = React.lazy(() => import('../../pages/ProjectDashboard'));
const RequestWorkflow = React.lazy(() => import('../../pages/RequestWorkflow'));
const Operations = React.lazy(() => import('../../pages/Operations'));
const Audit = React.lazy(() => import('../../pages/Audit'));
const FinanceHub = React.lazy(() => import('../../pages/finance/FinanceHub'));
const OfficePage = React.lazy(() => import('../../pages/office/OfficePage'));
const WorkPage = React.lazy(() => import('../../pages/work/WorkPage'));
const VehicleBookingLayout = React.lazy(() => import('../../pages/booking/VehicleBookingLayout'));

/** Trang nhúng được + dữ liệu module App nạp sẵn theo đường dẫn (giống App.tsx khi mở màn đó). */
const EMBED_ROUTES: { path: string; Page: React.ComponentType; data: AppModule[] }[] = [
  { path: '/hrm/leave', Page: LeaveManagement, data: ['hrm'] },
  { path: '/hrm/attendance', Page: Attendance, data: ['hrm'] },
  { path: '/hrm/timesheet', Page: TimesheetClose, data: ['hrm'] },
  { path: '/hrm/employees', Page: Employees, data: ['hrm'] },
  { path: '/da', Page: ProjectDashboard, data: ['da', 'admin', 'hrm'] },
  { path: '/requests', Page: RequestWorkflow, data: ['wms'] },
  { path: '/operations', Page: Operations, data: ['wms'] },
  { path: '/audit', Page: Audit, data: ['wms'] },
  { path: '/finance', Page: FinanceHub, data: [] },
  { path: '/finance/:section', Page: FinanceHub, data: [] },
  { path: '/office/*', Page: OfficePage, data: [] },
  { path: '/work/tasks/:taskCode', Page: WorkPage, data: [] },
  { path: '/booking/vehicle/*', Page: VehicleBookingLayout, data: [] },
];

const EmbeddedPage: React.FC<{ Page: React.ComponentType; data: AppModule[] }> = ({ Page, data }) => {
  const { loadModuleData } = useApp();
  const key = data.join(',');
  useEffect(() => {
    key.split(',').filter(Boolean).forEach(module => {
      loadModuleData(module as AppModule).catch(error => console.warn('Center embed data failed:', error));
    });
  }, [key, loadModuleData]);
  return <Page />;
};

const EMBED_ELEMENTS = EMBED_ROUTES.map(({ path, Page, data }) => ({ path, element: <EmbeddedPage Page={Page} data={data} /> }));

export const RendererHost: React.FC<{ renderer: RendererId; props: Record<string, string>; onExit?: (path: string) => void }> = ({ renderer, props, onExit }) => {
  switch (renderer) {
    case 'route': return <RouteRenderer path={props.path} routes={EMBED_ELEMENTS} onExit={onExit} />;
    case 'request': return <RequestRenderer requestId={props.requestId} />;
    case 'procurement': return <ProcurementRenderer initialOrderId={props.initialOrderId} initialHotPurchaseId={props.initialHotPurchaseId} initialMode={props.initialMode} />;
    case 'finance': return <FinanceRenderer initialSection={props.initialSection} initialRequestId={props.initialRequestId} />;
    case 'site_assignment': return <SiteAssignmentRenderer initialSelectedId={props.initialSelectedId} />;
    default: return null;
  }
};

export default RendererHost;
