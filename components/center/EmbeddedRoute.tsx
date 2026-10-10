import React, { Suspense } from 'react';
import { MemoryRouter, Route, Routes, UNSAFE_LocationContext, UNSAFE_RouteContext, useLocation } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { StateBox } from '../procurement/hub/hubUi';

// Chạy một trang module ngay trong tab Center bằng router riêng trong bộ nhớ: trang đọc đúng id / bộ lọc từ
// đường dẫn như khi mở trực tiếp; bấm qua lại bên trong không rời Center và không chạm lịch sử trình duyệt
// (nút Back vẫn do Center xử lý). Router của app được "ngắt" bằng context rỗng để MemoryRouter lồng được.


/** Đi tới màn chưa nhúng được (link sang module khác) → mời mở hẳn màn đó. */
const EmbedExit: React.FC<{ onExit?: (path: string) => void }> = ({ onExit }) => {
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;
  return (
    <section className="vcc-card m-4 p-4" data-embed-exit={path}>
      <p className="m-0 font-medium">Màn này mở ở module.</p>
      {onExit && (
        <button type="button" className="vcc-btn mt-3" data-pri="true" onClick={() => onExit(path)}>
          Mở màn này <ArrowUpRight size={14} />
        </button>
      )}
    </section>
  );
};

const NO_LOCATION = null as unknown as React.ContextType<typeof UNSAFE_LocationContext>;
const NO_ROUTE: React.ContextType<typeof UNSAFE_RouteContext> = { outlet: null, matches: [], isDataRoute: false };

/** routes = các <Route> (bảng màn chung); gate bọc Routes trong router bộ nhớ (kiểm quyền, nạp dữ liệu theo màn). */
const RouteRenderer: React.FC<{ path: string; state?: unknown; routes: React.ReactNode; gate?: React.ComponentType<{ children: React.ReactNode }>; onExit?: (path: string) => void }> = ({ path, state, routes, gate: Gate = React.Fragment, onExit }) => (
  <UNSAFE_LocationContext.Provider value={NO_LOCATION}>
    <UNSAFE_RouteContext.Provider value={NO_ROUTE}>
      <MemoryRouter initialEntries={[state === undefined ? path : { pathname: path.split('?')[0], search: path.includes('?') ? `?${path.split('?').slice(1).join('?')}` : '', state }]}>
        <Suspense fallback={<StateBox kind="loading" title="Đang mở màn…" />}>
          <Gate>
            <Routes>
              {routes}
              <Route path="*" element={<EmbedExit onExit={onExit} />} />
            </Routes>
          </Gate>
        </Suspense>
      </MemoryRouter>
    </UNSAFE_RouteContext.Provider>
  </UNSAFE_LocationContext.Provider>
);

export default RouteRenderer;
