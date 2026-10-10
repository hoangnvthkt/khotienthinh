import React from 'react';
import { Navigate, Route, useLocation, useParams } from 'react-router-dom';
import { isChatEnabled, isChatV2Enabled, isRequestApprovalPhase1Enabled } from '../lib/featureFlags';
import { buildWorkflowRoute } from '../lib/workflowRoutes';

// Danh sách màn của app — dùng chung cho router chính (App.tsx, trong Layout) và tab Trung tâm điều hành
// (components/center/CenterRenderers.tsx): mọi màn mở được ngay trong một tab của Trung tâm (chủ SP 10/10).
// embedded = trong tab Trung tâm: bỏ trang chủ, chính Trung tâm và trang 404 (tab tự báo "màn này mở ở module").

// Lazy load all page components for code splitting
const Dashboard = React.lazy(() => import('../pages/Dashboard'));
const Home = React.lazy(() => import('../pages/Home'));
const Notifications = React.lazy(() => import('../pages/Notifications'));
const Inventory = React.lazy(() => import('../pages/Inventory'));
const Operations = React.lazy(() => import('../pages/Operations'));
const Settings = React.lazy(() => import('../pages/Settings'));
const RequestWorkflow = React.lazy(() => import('../pages/RequestWorkflow'));
const MaterialCodeRequests = React.lazy(() => import('../pages/MaterialCodeRequests'));
const WmsOwners = React.lazy(() => import('../pages/WmsOwners'));
const Audit = React.lazy(() => import('../pages/Audit'));
const Reports = React.lazy(() => import('../pages/Reports'));
const DocumentTracePage = React.lazy(() => import('../pages/DocumentTracePage'));
const MisaExport = React.lazy(() => import('../pages/MisaExport'));
const ProjectDashboard = React.lazy(() => import('../pages/ProjectDashboard'));
const PortfolioDashboard = React.lazy(() => import('../pages/PortfolioDashboard'));
const ProcurementWorkbench = React.lazy(() => import('../pages/procurement/ProcurementWorkbench'));
const ProcurementHub = React.lazy(() => import('../pages/procurement/ProcurementHub'));
const FinanceHub = React.lazy(() => import('../pages/finance/FinanceHub'));
const SiteFund = React.lazy(() => import('../pages/finance/SiteFund'));
const MyProfile = React.lazy(() => import('../pages/MyProfile'));
const EmployeeDashboard = React.lazy(() => import('../pages/EmployeeDashboard'));
const NotFound = React.lazy(() => import('../pages/NotFound'));
const SafetyCardLookup = React.lazy(() => import('../pages/SafetyCardLookup'));

// HRM pages
const Employees = React.lazy(() => import('../pages/hrm/Employees'));
const Attendance = React.lazy(() => import('../pages/hrm/Attendance'));
const LeaveManagement = React.lazy(() => import('../pages/hrm/LeaveManagement'));
const TimesheetClose = React.lazy(() => import('../pages/hrm/TimesheetClose'));
const SiteAssignments = React.lazy(() => import('../pages/hrm/SiteAssignments'));
const Payroll = React.lazy(() => import('../pages/hrm/Payroll'));
const MyPayroll = React.lazy(() => import('../pages/hrm/MyPayroll'));
const LaborContractPage = React.lazy(() => import('../pages/hrm/LaborContract'));
const CheckIn = React.lazy(() => import('../pages/hrm/CheckIn'));
const HrmReports = React.lazy(() => import('../pages/hrm/HrmReports'));
const HrmDashboard = React.lazy(() => import('../pages/hrm/HrmDashboard'));
const HrmDocuments = React.lazy(() => import('../pages/hrm/HrmDocuments'));
const ShiftManagement = React.lazy(() => import('../pages/hrm/ShiftManagement'));
const EmployeeRanking = React.lazy(() => import('../pages/hrm/EmployeeRanking'));

// Expense pages

// Workflow pages
const WorkflowInstances = React.lazy(() => import('../pages/wf/WorkflowInstances'));
const WorkflowInstanceDetail = React.lazy(() => import('../pages/wf/WorkflowInstanceDetail'));
const WorkflowTemplates = React.lazy(() => import('../pages/wf/WorkflowTemplates'));
const WorkflowBuilder = React.lazy(() => import('../pages/wf/WorkflowBuilder'));
const WorkflowDashboard = React.lazy(() => import('../pages/wf/WorkflowDashboard'));

// Chat
const Chat = React.lazy(() => import('../pages/Chat'));
const ChatV2 = React.lazy(() => import('../pages/ChatV2'));

// Data Storage
const DataStorage = React.lazy(() => import('../pages/DataStorage'));

// AI Assistant
const AiAssistant = React.lazy(() => import('../pages/AiAssistant'));
const ExecutiveAI = React.lazy(() => import('../pages/ExecutiveAI'));
const AiReports = React.lazy(() => import('../pages/AiReports'));

// Knowledge Base
const KnowledgeBase = React.lazy(() => import('../pages/KnowledgeBase'));

// Audit Trail
const AuditTrail = React.lazy(() => import('../pages/AuditTrail'));
const AdminActivityDashboard = React.lazy(() => import('../pages/AdminActivityDashboard'));

// Predictive Analytics
const PredictiveAnalytics = React.lazy(() => import('../pages/PredictiveAnalytics'));

// Custom Dashboard
const CustomDashboard = React.lazy(() => import('../pages/CustomDashboard'));
const Leaderboard = React.lazy(() => import('../pages/Leaderboard'));
const FeedbackHub = React.lazy(() => import('../pages/FeedbackHub'));
const VehicleBookingLayout = React.lazy(() => import('../pages/booking/VehicleBookingLayout'));

// Request pages
const RequestList = React.lazy(() => import('../pages/request/RequestList'));
const RequestDashboard = React.lazy(() => import('../pages/request/RequestDashboard'));
const RequestTemplates = React.lazy(() => import('../pages/request/RequestTemplates'));
const RequestTemplateEditor = React.lazy(() => import('../pages/request/RequestTemplateEditor'));

// Asset management pages
const AssetCatalog = React.lazy(() => import('../pages/ts/AssetCatalog'));
const AssetAssignment = React.lazy(() => import('../pages/ts/AssetAssignment'));
const AssetDashboard = React.lazy(() => import('../pages/ts/AssetDashboard'));
const AssetAudit = React.lazy(() => import('../pages/ts/AssetAudit'));
const AssetReports = React.lazy(() => import('../pages/ts/AssetReports'));
const AssetMaintenancePage = React.lazy(() => import('../pages/ts/AssetMaintenance'));
const AssetProfile = React.lazy(() => import('../pages/ts/AssetProfile'));

// Employee Profile pages
const EmployeeDirectory = React.lazy(() => import('../pages/ep/EmployeeDirectory'));
const EmployeeProfilePage = React.lazy(() => import('../pages/ep/HrmPersonnelProfile'));

// 3D Org Map
const OrgMap3D = React.lazy(() => import('../pages/orgmap/OrgMap3D'));

// Contract management pages
const ContractLayout = React.lazy(() => import('../pages/hd/ContractLayout'));
const ContractOverview = React.lazy(() => import('../pages/hd/ContractOverview'));
const BusinessPartners = React.lazy(() => import('../pages/hd/BusinessPartners'));
const ContractTypes = React.lazy(() => import('../pages/hd/ContractTypes'));
const ContractCatalogs = React.lazy(() => import('../pages/hd/ContractCatalogs'));
const CostLibrary = React.lazy(() => import('../pages/hd/CostLibrary'));
const SupplierContracts = React.lazy(() => import('../pages/hd/SupplierContracts'));
const CustomerContracts = React.lazy(() => import('../pages/hd/CustomerContracts'));
const SubcontractorContracts = React.lazy(() => import('../pages/hd/SubcontractorContracts'));
const ContractWorkspacePage = React.lazy(() => import('../pages/hd/ContractWorkspacePage'));
const TenderAiLayout = React.lazy(() => import('../pages/tender-ai/TenderAiLayout'));
const TenderBoqAnalyzer = React.lazy(() => import('../pages/tender-ai/TenderBoqAnalyzer'));

const RequestListRoute: React.FC = () => {
  const location = useLocation();
  const requestId = new URLSearchParams(location.search).get('requestId');
  return requestId ? <Navigate to={`/rq/${encodeURIComponent(requestId)}`} replace /> : <RequestList />;
};

const RequestApprovalPhase1Guard: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  isRequestApprovalPhase1Enabled ? <>{children}</> : <Navigate to="/" replace />;

const WorkflowLegacyInstanceRedirect: React.FC = () => {
  const { id } = useParams();
  return id ? <Navigate to={buildWorkflowRoute(id)} replace /> : <Navigate to="/wf" replace />;
};

const OfficePage = React.lazy(() => import('../pages/office/OfficePage'));
const CenterPage = React.lazy(() => import('../pages/center/CenterPage'));
const WorkPage = React.lazy(() => import('../pages/work/WorkPage'));
const WorkHome = React.lazy(() => import('../pages/work/WorkHome'));
const WorkSpacePage = React.lazy(() => import('../pages/work/WorkSpacePage'));
const WorkSpaceCreate = React.lazy(() => import('../pages/work/WorkSpaceCreate'));
const WorkSettings = React.lazy(() => import('../pages/work/WorkSettings'));


export const appPageRoutes = (embedded = false) => (
  <>
    {!embedded && <Route index element={<Home />} />}
    {!embedded && <Route path="center" element={<CenterPage />} />}
    <Route path="office/*" element={<OfficePage />} />
    <Route path="work" element={<WorkHome />} />
    <Route path="work/my" element={<WorkPage />} />
    <Route path="work/spaces/new" element={<WorkSpaceCreate />} />
    <Route path="work/spaces/:workspaceId" element={<WorkSpacePage />} />
    <Route path="work/spaces/:workspaceId/members" element={<WorkSpacePage />} />
    <Route path="work/spaces/:workspaceId/settings" element={<WorkSpacePage />} />
    <Route path="work/settings" element={<WorkSettings />} />
    <Route path="work/tasks/:taskCode" element={<WorkPage />} />
    <Route path="notifications" element={<Notifications />} />
    <Route path="my-profile" element={<MyProfile />} />
    <Route path="my-payroll" element={<MyPayroll />} />
    <Route path="employee-dashboard" element={<EmployeeDashboard />} />
    <Route path="custom-dashboard" element={<CustomDashboard />} />
    <Route path="dashboard" element={<Dashboard />} />
    <Route path="requests" element={<RequestWorkflow />} />
    <Route path="material-code-requests" element={<MaterialCodeRequests />} />
    <Route path="wms/owners" element={<WmsOwners />} />
    <Route path="inventory" element={<Inventory />} />
    <Route path="operations" element={<Operations />} />
    <Route path="audit" element={<Audit />} />
    <Route path="reports" element={<Reports />} />
    <Route path="trace" element={<DocumentTracePage />} />
    <Route path="wf" element={<WorkflowInstances />} />
    <Route path="wf/dashboard" element={<WorkflowDashboard />} />
    <Route path="wf/templates" element={<WorkflowTemplates />} />
    <Route path="wf/builder/:id" element={<WorkflowBuilder />} />
    <Route path="wf/:instanceId" element={<WorkflowInstanceDetail />} />
    <Route path="wf/instances/:id" element={<WorkflowLegacyInstanceRedirect />} />
    <Route path="users" element={<Navigate to="/settings" replace />} />
    <Route path="settings" element={<Settings />} />
    <Route path="settings/permission-health" element={<Settings />} />
    <Route path="settings/role-templates" element={<Settings />} />
    <Route path="settings/hrm-shared-catalog" element={<Settings />} />
    <Route path="misa-export" element={<MisaExport />} />
    <Route path="hrm" element={<Navigate to="/my-profile" replace />} />
    <Route path="hrm/employees" element={<Employees />} />
    <Route path="hrm/dashboard" element={<HrmDashboard />} />
    {/* Module Chi phí cũ đã gộp vào Tài chính → Chi phí & ngân sách (doc 14 câu 6). */}
    <Route path="expense" element={<Navigate to="/finance/cost" replace />} />
    <Route path="hrm/attendance" element={<Attendance />} />
    <Route path="hrm/shifts" element={<ShiftManagement />} />
    <Route path="hrm/leave" element={<LeaveManagement />} />
    <Route path="hrm/timesheet" element={<TimesheetClose />} />
    <Route path="hrm/assignments" element={<SiteAssignments />} />
    <Route path="hrm/payroll" element={<Payroll />} />
    <Route path="hrm/contracts" element={<LaborContractPage />} />
    <Route path="hrm/checkin" element={<CheckIn />} />
    <Route path="hrm/reports" element={<HrmReports />} />
    <Route path="hrm/documents" element={<HrmDocuments />} />
    <Route path="hrm/ranking" element={<EmployeeRanking />} />
    <Route path="da" element={<ProjectDashboard />} />
    <Route path="safety-card/:qrToken" element={<SafetyCardLookup />} />
    <Route path="da/portfolio" element={<PortfolioDashboard />} />
    <Route path="procurement" element={<ProcurementHub />} />
    <Route path="finance" element={<FinanceHub />} />
    <Route path="finance/:section" element={<FinanceHub />} />
    <Route path="site-fund" element={<SiteFund />} />
    <Route path="procurement/legacy" element={<ProcurementWorkbench />} />
    <Route path="chat" element={isChatEnabled ? (isChatV2Enabled ? <ChatV2 /> : <Chat />) : <Navigate to="/" replace />} />
    <Route path="storage" element={<DataStorage />} />
    <Route path="ai" element={<AiAssistant />} />
    <Route path="ai/executive" element={<ExecutiveAI />} />
    <Route path="ai/reports" element={<AiReports />} />
    <Route path="knowledge-base" element={<KnowledgeBase />} />
    <Route path="audit-trail" element={<AuditTrail />} />
    <Route path="admin/activity" element={<AdminActivityDashboard />} />
    <Route path="analytics" element={<PredictiveAnalytics />} />
    <Route path="leaderboard" element={<Leaderboard />} />
    <Route path="feedback" element={<FeedbackHub />} />
    <Route path="rq" element={<RequestApprovalPhase1Guard><RequestListRoute /></RequestApprovalPhase1Guard>} />
    <Route path="rq/:requestId" element={<RequestApprovalPhase1Guard><RequestList /></RequestApprovalPhase1Guard>} />
    <Route path="rq/dashboard" element={<RequestApprovalPhase1Guard><RequestDashboard /></RequestApprovalPhase1Guard>} />
    <Route path="rq/templates" element={<RequestApprovalPhase1Guard><RequestTemplates /></RequestApprovalPhase1Guard>} />
    <Route path="rq/templates/new" element={<RequestApprovalPhase1Guard><RequestTemplateEditor /></RequestApprovalPhase1Guard>} />
    <Route path="rq/templates/:templateId" element={<RequestApprovalPhase1Guard><RequestTemplateEditor /></RequestApprovalPhase1Guard>} />
    <Route path="rq/categories" element={<RequestApprovalPhase1Guard><Navigate to="/rq/templates" replace /></RequestApprovalPhase1Guard>} />
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
    <Route path="booking/vehicle/*" element={<VehicleBookingLayout />} />
    {!embedded && <Route path="*" element={<NotFound />} />}
  </>
);
