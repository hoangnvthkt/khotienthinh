import React from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import NotificationCenter from '../../components/NotificationCenter';
import CenterShell from '../../components/center/CenterShell';
import { StateBox } from '../../components/procurement/hub/hubUi';
import { canAccessRoute } from '../../lib/routeAccess';
import { CENTER_ROUTE } from '../../lib/center/centerPermissions';
import { useCenterAccess } from '../../lib/center/centerService';
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

const CenterPage: React.FC = () => {
  const { user, employees, appSettings } = useApp();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const outlet = useOutletContext<LayoutOutletContext | undefined>();
  const { state, retry } = useCenterAccess(user?.id, canAccessRoute(user, CENTER_ROUTE));
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
          ? <StateBox kind="denied" title="Trung tâm điều hành đang thí điểm" message="Chưa bật cho tài khoản của bạn. Khi được bật, mục này sẽ hiện ở thanh bên trái." />
          : <StateBox kind="denied" title="Bạn chưa có quyền vào Trung tâm điều hành" message="Nhờ quản trị cấp quyền “Truy cập Trung tâm điều hành”." />}
      </Gate>
    );
  }

  const employee = employees.find(row => row.userId === user.id);
  return (
    <CenterShell
      person={{
        fullName: employee?.fullName || user.name,
        gender: employee?.gender,
        title: employee?.title || user.position,
        avatar: user.avatar,
      }}
      company={{ name: appSettings.name, logo: appSettings.logo }}
      isDark={isDark}
      onToggleTheme={toggleTheme}
      onOpenMenu={outlet?.openSidebar}
      mobileNotifications={<NotificationCenter userId={user.id} mode="mobile" />}
      canOpenRoute={route => canAccessRoute(user, route)}
      onNavigate={route => navigate(route)}
    />
  );
};

export default CenterPage;
