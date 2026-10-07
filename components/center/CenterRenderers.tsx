import React, { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
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

const ProcurementRenderer: React.FC<{ initialOrderId?: string; initialHotPurchaseId?: string }> = ({ initialOrderId, initialHotPurchaseId }) => {
  const { user } = useApp();
  // Hub Mua hàng đọc tên vật tư / kho từ AppContext; màn /procurement được Layout nạp sẵn, ở Center tự nạp.
  useModuleData('wms-core');
  useModuleData('admin');
  return <ProcurementHubView currentUserId={user.id} initialOrderId={initialOrderId || null} initialHotPurchaseId={initialHotPurchaseId || null} />;
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

export const RendererHost: React.FC<{ renderer: RendererId; props: Record<string, string> }> = ({ renderer, props }) => {
  switch (renderer) {
    case 'request': return <RequestRenderer requestId={props.requestId} />;
    case 'procurement': return <ProcurementRenderer initialOrderId={props.initialOrderId} initialHotPurchaseId={props.initialHotPurchaseId} />;
    case 'finance': return <FinanceRenderer initialSection={props.initialSection} initialRequestId={props.initialRequestId} />;
    case 'site_assignment': return <SiteAssignmentRenderer initialSelectedId={props.initialSelectedId} />;
    default: return null;
  }
};

export default RendererHost;
