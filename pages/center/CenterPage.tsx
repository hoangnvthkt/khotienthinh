import React, { useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import NotificationCenter from '../../components/NotificationCenter';
import CenterShell from '../../components/center/CenterShell';
import { useRouteTitle } from '../../components/center/useRouteTitle';
import CenterEntrance from '../../components/center/CenterIntro';
import { StateBox } from '../../components/procurement/hub/hubUi';
import { canAccessRoute } from '../../lib/routeAccess';
import { CENTER_ROUTE } from '../../lib/center/centerPermissions';
import { useCenterAccess } from '../../lib/center/centerService';
import { fetchDashboard, fetchDashboardAccess, fetchMaterialMoves, fetchMetricDocs } from '../../lib/dashboard/dashboardService';
import { fetchFlow, fetchFlowAccess, fetchFlowItems, remindFlow, type FlowItemsFilter, type FlowQuery } from '../../lib/center/centerFlowService';
import { site3dHooks } from '../../lib/site3d/site3dService';
import { defaultAssistantHooks } from '../../components/center/AssistantView';
import { createMrFormActions } from '../../lib/assistantMrForm';
import type { LayoutOutletContext } from '../../lib/routeChrome';
import '../../components/center/center.css';

// Trạng thái chặn (đang kiểm / lỗi / chưa được bật). Trên điện thoại Layout không có header ở /center,
// nên luôn có đường ra: menu ứng dụng và trang Hôm nay.
const Gate: React.FC<{ onOpenMenu?: () => void; onHome?: () => void; children: React.ReactNode }> = ({ onOpenMenu, onHome, children }) => (
  <div className="vcc">
    <div className="vcc-scroll">
      <div className="mx-auto max-w-xl px-4 py-10">
        {children}
        {(onHome || onOpenMenu) && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {onHome && <button type="button" className="vcc-btn" onClick={onHome}>Về trang Hôm nay</button>}
            {onOpenMenu && <button type="button" className="vcc-btn vcc-mobile-only" onClick={onOpenMenu}><Menu size={15} /> Mở menu</button>}
          </div>
        )}
      </div>
    </div>
  </div>
);

// Dòng chảy công việc: hàm cố định (CenterShell tải lại khi hàm đổi); máy chủ tự cắt theo quyền người gọi.
const loadFlow = (query: FlowQuery) => fetchFlow(query);
const loadFlowAccess = () => fetchFlowAccess();
const loadFlowItems = (filter: FlowItemsFilter, limit?: number, offset?: number) => fetchFlowItems(filter, limit, offset);
const remindFlowHolders = (filter: FlowItemsFilter, note?: string | null) => remindFlow(filter, note);

const CenterPage: React.FC = () => {
  const { user, employees, appSettings, addRequest } = useApp();
  // Trợ lý: form đề xuất vật tư ngay trong chat lưu bằng đúng hàm lưu của app (như form Đề xuất). addRequest đổi mỗi lần app vẽ lại
  // → giữ qua ref để hooks của Trợ lý ổn định (không tải lại hội thoại / trạng thái AI).
  const addRequestRef = useRef(addRequest);
  addRequestRef.current = addRequest;
  const assistantHooks = useMemo(() => ({
    ...defaultAssistantHooks,
    mrForm: user?.id ? createMrFormActions({ userId: user.id, addRequest: request => addRequestRef.current(request) }) : undefined,
  }), [user?.id]);
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  // /center?board=materials&project=<id>: mở thẳng Bảng điều khiển ở bảng + dự án đó (link từ Dự án → Vật tư).
  const initialDashboard = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const board = params.get('board');
    if (board !== 'portfolio' && board !== 'cashflow' && board !== 'materials' && board !== 'debt') return null;
    return { board, projectId: params.get('project'), nonce: Date.now() } as const;
  }, [location.search]);
  // /center?view=flow | site3d: mở thẳng tab Dòng chảy công việc / Công trường 3D.
  const initialTab = useMemo(() => {
    const view = new URLSearchParams(location.search).get('view');
    return view === 'flow' || view === 'site3d' ? view : null;
  }, [location.search]);
  const outlet = useOutletContext<LayoutOutletContext | undefined>();
  // Vừa bật giao diện Trung tâm điều hành → lời chào; chạy xong xoá cờ để tải lại trang không chạy lại.
  const playIntro = (location.state as { vccIntro?: boolean } | null)?.vccIntro === true;
  const { state, retry } = useCenterAccess(user?.id, canAccessRoute(user, CENTER_ROUTE));
  // Bảng điều khiển: hàm cố định theo người dùng (CenterShell tải lại khi hàm đổi).
  const userId = user?.id;
  const loadDashboard = useCallback((options?: { force?: boolean }) => fetchDashboard(userId as string, options?.force), [userId]);
  const loadDashboardAccess = useCallback(() => fetchDashboardAccess(userId as string), [userId]);
  const titleForRoute = useRouteTitle();
  const { logout } = useAuth();
  const onLogout = useCallback(() => {
    logout().catch(error => console.warn('Logout failed:', error)).finally(() => navigate('/login'));
  }, [logout, navigate]);
  const goHome = () => navigate('/');

  if (state.status === 'loading') {
    return <Gate><StateBox kind="loading" title="Đang mở Trung tâm điều hành…" /></Gate>;
  }
  if (state.status === 'error') {
    return <Gate onOpenMenu={outlet?.openSidebar} onHome={goHome}><StateBox kind="error" message={state.message} onRetry={retry} /></Gate>;
  }
  if (state.status === 'off') {
    return (
      <Gate onOpenMenu={outlet?.openSidebar} onHome={goHome}>
        {state.reason === 'not_in_rollout'
          ? <StateBox kind="denied" title="Trung tâm điều hành đang thí điểm" message="Chưa bật cho tài khoản của bạn. Khi được bật, công tắc “Trung tâm điều hành” sẽ hiện ở thanh bên trái." />
          : <StateBox kind="denied" title="Bạn chưa có quyền vào Trung tâm điều hành" message="Nhờ quản trị cấp quyền “Truy cập Trung tâm điều hành”." />}
      </Gate>
    );
  }

  const employee = employees.find(row => row.userId === user.id);
  const person = {
    fullName: employee?.fullName || user.name,
    gender: employee?.gender,
    title: employee?.title || user.position,
    avatar: user.avatar,
  };
  return (
    <CenterEntrance play={playIntro} person={person} onDone={() => navigate(location.pathname + location.search, { replace: true, state: null })}>
      <CenterShell
        person={person}
        company={{ name: appSettings.name, logo: appSettings.logo }}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onOpenMenu={outlet?.openSidebar}
        mobileNotifications={<NotificationCenter userId={user.id} mode="mobile" />}
        canOpenRoute={route => canAccessRoute(user, route)}
        onNavigate={(route, options) => navigate(route, options)}
        loadDashboard={loadDashboard}
        loadDashboardAccess={loadDashboardAccess}
        loadMaterialMoves={fetchMaterialMoves}
        loadMetricDocs={fetchMetricDocs}
        titleForRoute={titleForRoute}
        onLogout={onLogout}
        userId={user.id}
        initialDashboard={initialDashboard}
        loadFlow={loadFlow}
        loadFlowAccess={loadFlowAccess}
        loadFlowItems={loadFlowItems}
        remindFlow={remindFlowHolders}
        initialTab={initialTab}
        site3d={site3dHooks}
        assistant={assistantHooks}
      />
    </CenterEntrance>
  );
};

export default CenterPage;
