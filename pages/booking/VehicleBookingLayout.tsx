import React from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import {
  BarChart3,
  Calendar,
  Car,
  ClipboardCheck,
  History,
  Inbox,
  LayoutDashboard,
  MessageSquareWarning,
  Repeat,
  Settings,
  UserRoundCog,
  Wrench,
} from 'lucide-react';
import VehicleBookingCreatePage from './VehicleBookingCreatePage';
import MyVehicleBookingsPage from './MyVehicleBookingsPage';
import ManagerApprovalPage from './ManagerApprovalPage';
import DispatcherWorkbenchPage from './DispatcherWorkbenchPage';
import DriverTodayTripsPage from './DriverTodayTripsPage';
import VehicleHandoverPage from './VehicleHandoverPage';
import FleetManagementPage from './FleetManagementPage';
import VehicleBookingAnalyticsPage from './VehicleBookingAnalyticsPage';
import VehicleBookingIssuesPage from './VehicleBookingIssuesPage';
import VehicleBookingAuditTrailPage from './VehicleBookingAuditTrailPage';
import { useApp } from '../../context/AppContext';
import {
  canAccessVehicleApprovalQueue,
  canViewSensitiveVehicleIssues,
  canViewVehicleAudit,
  canViewVehicleReports,
  hasActiveVehicleBookingGrant,
} from '../../lib/vehicleBookingPermissions';

const VehicleBookingLayout: React.FC = () => {
  const { user, users } = useApp();
  const canApprove = canAccessVehicleApprovalQueue(user, users);
  const canDispatch = hasActiveVehicleBookingGrant(user, ['booking.vehicle.dispatch']);
  const canHandover = hasActiveVehicleBookingGrant(user, ['booking.vehicle.handover', 'booking.vehicle.dispatch']);
  const canManageFleet = hasActiveVehicleBookingGrant(user, ['booking.vehicle.manage_fleet']);
  const canManageDrivers = hasActiveVehicleBookingGrant(user, ['booking.vehicle.manage_authorizations']);
  const canManageSettings = hasActiveVehicleBookingGrant(user, ['booking.vehicle.admin']);
  const canViewReports = canViewVehicleReports(user);
  const canViewIssues = canViewSensitiveVehicleIssues(user);
  const canViewAudit = canViewVehicleAudit(user);

  const navTabs = [
    { path: '/booking/vehicle', label: 'Tạo đơn đặt xe', icon: Car, exact: true },
    { path: '/booking/vehicle/my', label: 'Yêu cầu của tôi', icon: Inbox },
    ...(canApprove ? [{ path: '/booking/vehicle/approvals', label: 'Chờ phê duyệt', icon: ClipboardCheck }] : []),
    ...(canDispatch ? [{ path: '/booking/vehicle/dispatch', label: 'Bảng điều phối', icon: LayoutDashboard }] : []),
    { path: '/booking/vehicle/trips', label: 'Chuyến của tôi', icon: Calendar },
    ...(canHandover ? [{ path: '/booking/vehicle/handover', label: 'Bàn giao xe tự lái', icon: Repeat }] : []),
    ...(canManageFleet ? [{ path: '/booking/vehicle/fleet', label: 'Quản lý xe', icon: Wrench }] : []),
    ...(canManageDrivers ? [{ path: '/booking/vehicle/drivers', label: 'Quản lý tài xế', icon: UserRoundCog }] : []),
    ...(canViewReports ? [{ path: '/booking/vehicle/reports', label: 'Dashboard & Báo cáo KPI', icon: BarChart3 }] : []),
    ...(canViewIssues ? [{ path: '/booking/vehicle/issues', label: 'Phản ánh', icon: MessageSquareWarning }] : []),
    ...(canViewAudit ? [{ path: '/booking/vehicle/audit', label: 'Lịch sử vận hành', icon: History }] : []),
    ...(canManageSettings ? [{ path: '/booking/vehicle/settings', label: 'Cấu hình', icon: Settings }] : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 pb-12">
      {/* Module Header & Top Navigation Bar */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl">
                <Car className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
                  Đặt Xe Công Ty
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Booking tài nguyên xe nội bộ & xe ngoại viện | Vioo ERP
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                ● CSDL Sẵn sàng
              </span>
            </div>
          </div>

          {/* Sub-module Navigation Tabs */}
          <div className="flex overflow-x-auto no-scrollbar space-x-1 border-t border-slate-100 dark:border-slate-700/50 py-1">
            {navTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  end={tab.exact}
                  className={({ isActive: isSelfActive }) => `
                    flex items-center space-x-2 px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-all duration-150
                    ${isSelfActive
                      ? 'bg-amber-500 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </NavLink>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Page Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        <Routes>
          <Route index element={<VehicleBookingCreatePage />} />
          <Route path="my" element={<MyVehicleBookingsPage />} />
          <Route path="approvals" element={canApprove ? <ManagerApprovalPage /> : <Navigate to="/booking/vehicle/my" replace />} />
          <Route path="dispatch" element={canDispatch ? <DispatcherWorkbenchPage /> : <Navigate to="/booking/vehicle/my" replace />} />
          <Route path="trips" element={<DriverTodayTripsPage />} />
          <Route path="handover" element={canHandover ? <VehicleHandoverPage /> : <Navigate to="/booking/vehicle/my" replace />} />
          <Route path="fleet" element={canManageFleet ? <FleetManagementPage section="VEHICLES" /> : <Navigate to="/booking/vehicle/my" replace />} />
          <Route path="drivers" element={canManageDrivers ? <FleetManagementPage section="DRIVERS" /> : <Navigate to="/booking/vehicle/my" replace />} />
          <Route path="settings" element={canManageSettings ? <FleetManagementPage section="SETTINGS" /> : <Navigate to="/booking/vehicle/my" replace />} />
          <Route path="reports" element={canViewReports ? <VehicleBookingAnalyticsPage /> : <Navigate to="/booking/vehicle/my" replace />} />
          <Route path="issues" element={canViewIssues ? <VehicleBookingIssuesPage /> : <Navigate to="/booking/vehicle/my" replace />} />
          <Route path="audit" element={canViewAudit ? <VehicleBookingAuditTrailPage /> : <Navigate to="/booking/vehicle/my" replace />} />
          <Route path="*" element={<Navigate to="/booking/vehicle" replace />} />
        </Routes>
      </div>
    </div>
  );
};

export default VehicleBookingLayout;
