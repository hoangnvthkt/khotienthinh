// Kiểm cơ chế "trang module chạy ngay trong tab Center" (EmbeddedRoute) bên trong HashRouter thật như App:
// trang đọc đúng đường dẫn nhúng, đổi bộ lọc / đi trang khác không làm đổi URL của app hay lịch sử trình duyệt.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import RouteRenderer from '../../components/center/EmbeddedRoute';

const FakeLeave: React.FC = () => {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  return (
    <div data-testid="fake-leave">
      <p>Đường dẫn nhúng: <span data-testid="embedded-path">{location.pathname}{location.search}</span></p>
      <p>Đơn đang mở: <span data-testid="embedded-request">{params.get('request')}</span></p>
      <button type="button" onClick={() => setParams({ request: 'np-42' })}>Chọn đơn khác</button>
      <button type="button" onClick={() => navigate('/work/tasks/VW-1')}>Sang việc</button>
      <button type="button" onClick={() => navigate('/hrm/payroll')}>Sang bảng lương</button>
    </div>
  );
};
const FakeTask: React.FC = () => <p data-testid="fake-task">Việc {useParams().taskCode}</p>;

const CenterProbe: React.FC = () => {
  const outer = useLocation();
  const [exit, setExit] = React.useState<string | null>(null);
  return (
    <div>
      <p>App: <span data-testid="outer-path">{outer.pathname}</span> · <span data-testid="exit">{exit || '-'}</span></p>
      <RouteRenderer
        path="/hrm/leave?request=np-41"
        routes={<><Route path="/hrm/leave" element={<FakeLeave />} /><Route path="/work/tasks/:taskCode" element={<FakeTask />} /></>}
        onExit={setExit}
      />
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <Routes>
      <Route path="/center" element={<CenterProbe />} />
      <Route path="*" element={<p>Ngoài Center</p>} />
    </Routes>
  </HashRouter>,
);
