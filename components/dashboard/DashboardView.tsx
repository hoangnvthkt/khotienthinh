import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { StateBox } from '../procurement/hub/hubUi';
import { DASHBOARD_META, gapsFor, type DrillDown } from '../../lib/dashboard/dashboardModel';
import type { DashboardDataset, DashboardId } from '../../lib/dashboard/dashboardTypes';
import { DashOpenContext, DrillDrawer, dashColors } from './dashUi';
import PortfolioDashboard from './PortfolioDashboard';
import CashflowDashboard from './CashflowDashboard';
import MaterialsDashboard from './MaterialsDashboard';
import DebtDashboard from './DebtDashboard';
import type { LoadMaterialMoves } from './StockTable';
import './dashboard.css';

// Bảng điều khiển trong Trung tâm điều hành. Bảng hiện theo quyền (máy chủ trả danh sách được xem); chọn bảng + dự án ở đầu.
// Bấm xuống (drill-down): ngăn bên phải với các dòng tạo nên con số. Bấm sang (drill-through): mở màn gốc thành tab của Center.

export type DashboardState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DashboardDataset };

const VIEW_KEY = 'vdb_view';
const readView = (): DashboardId | null => { try { return localStorage.getItem(VIEW_KEY) as DashboardId | null; } catch { return null; } };
const writeView = (id: DashboardId) => { try { localStorage.setItem(VIEW_KEY, id); } catch { /* chỉ là tiện ích */ } };

/** "08:25" nếu tổng hợp hôm nay, không thì "16:40 08/10". */
const stampText = (generatedAt: string, today: string): string | null => {
  const at = new Date(generatedAt);
  if (Number.isNaN(at.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return day === today ? time : `${time} ${pad(at.getDate())}/${pad(at.getMonth() + 1)}`;
};

const DashboardView: React.FC<{
  state: DashboardState;
  isDark: boolean;
  /** Đang lấy số mới (vẫn hiện số cũ). */
  refreshing?: boolean;
  /** Lần cập nhật gần nhất lỗi trong khi đang có số cũ. */
  refreshNote?: string | null;
  /** Lấy số mới (lỗi tải lần đầu: thử lại). */
  onRetry: () => void;
  /** Giao dịch kho của một vật tư (bảng tồn / nhập / xuất). */
  loadMoves?: LoadMaterialMoves;
  /** Mở màn gốc (Center mở thành tab nếu chạy được trong tab, không thì chuyển hẳn). */
  onOpen: (route: string) => void;
  /** Chỉ một bảng, gắn trên "Hôm nay" như một khối (không tiêu đề lớn, không thanh chọn bảng). */
  only?: DashboardId;
  /** Chuyển sang bảng này (bấm "Mở" trên khối ở Hôm nay); nonce đổi = yêu cầu mới. */
  focus?: { board: DashboardId; nonce: number } | null;
}> = ({ state, isDark, refreshing = false, refreshNote = null, onRetry, loadMoves, onOpen, only, focus }) => {
  const data = state.status === 'ready' ? state.data : null;
  const access = data?.access || [];
  const [view, setView] = useState<DashboardId | null>(readView);
  const [projectId, setProjectId] = useState('all');
  const [drill, setDrill] = useState<DrillDown | null>(null);
  const current: DashboardId | null = only ? (access.includes(only) ? only : null) : view && access.includes(view) ? view : access[0] || null;
  const colors = dashColors(isDark);
  const projects = useMemo(() => (data ? data.projects.filter(project => projectId === 'all' || project.id === projectId) : []), [data, projectId]);
  useEffect(() => { if (projectId !== 'all' && data && !data.projects.some(project => project.id === projectId)) setProjectId('all'); }, [data, projectId]);
  const choose = (id: DashboardId) => { setView(id); writeView(id); };
  useEffect(() => { if (focus) { setView(focus.board); writeView(focus.board); } }, [focus]);
  const open = useCallback((route: string) => { setDrill(null); onOpen(route); }, [onOpen]);
  // Ngăn đọc khi bấm: đang mở (đang tải) thì thay; người dùng đã đóng thì không mở lại khi dữ liệu về.
  const drillAsync = useCallback((next: DrillDown | null) => setDrill(current => (current === null && next?.status !== 'loading' ? null : next)), []);

  if (state.status === 'loading') return <div className="vdb"><StateBox kind="loading" title="Đang tổng hợp số liệu…" /></div>;
  if (state.status === 'error') return <div className="vdb"><StateBox kind="error" title="Chưa tải được bảng điều khiển" message={state.message} onRetry={onRetry} /></div>;
  if (!current || !data) {
    return <div className="vdb"><StateBox kind="denied" title="Chưa có bảng điều khiển cho bạn" message="Bảng hiện theo công việc: dự án, tài chính, vật tư. Nhờ Admin cấp quyền module tương ứng." /></div>;
  }
  const meta = DASHBOARD_META[current];
  const stamp = stampText(data.generatedAt, data.today);
  const gaps = gapsFor(current, projects);
  const props = { dataset: data, projects, colors, onDrill: setDrill, onOpen: open };
  const selectedProject = projectId === 'all' ? null : projectId;

  return (
    <DashOpenContext.Provider value={open}>
    <div className="vdb" data-block={only ? true : undefined}>
      <div className="vdb-head" data-block={only ? true : undefined}>
        {!only && (
          <div className="min-w-0">
            <h2 className="vdb-title">{meta.title}</h2>
            <p className="vdb-sub">{meta.hint}</p>
          </div>
        )}
        <div className="vdb-filters">
          <select className="vdb-select" aria-label="Chọn dự án" value={projectId} onChange={event => setProjectId(event.target.value)}>
            <option value="all">Tất cả dự án ({data.projects.length})</option>
            {data.projects.map(project => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
          </select>
          <button type="button" className="vdb-btn" onClick={onRetry} disabled={refreshing} aria-busy={refreshing}
            title="Lấy số liệu mới nhất. Bảng không tự cập nhật để không làm chậm hệ thống.">
            <RefreshCw size={13} /> {refreshing ? 'Đang cập nhật…' : 'Cập nhật'}
          </button>
        </div>
      </div>
      {!only && access.length > 1 && (
        <div className="vdb-switch mb-3" role="tablist" aria-label="Chọn bảng điều khiển">
          {access.map(id => (
            <button key={id} type="button" role="tab" aria-selected={id === current} onClick={() => choose(id)} title={DASHBOARD_META[id].hint}>{DASHBOARD_META[id].short}</button>
          ))}
        </div>
      )}
      <div className="vdb-stamp mb-3">
        {stamp && <span>Số liệu lúc {stamp} · bấm Cập nhật để lấy số mới · bấm vào con số, cột, lát biểu đồ để xem chi tiết</span>}
        {gaps.rows.length > 0 && (
          <button type="button" className="vdb-gap-btn" onClick={() => setDrill(gaps)} title="Xem dự án còn thiếu dữ liệu và mở màn cần bổ sung">
            <AlertTriangle size={13} /> {gaps.rows.length} dự án thiếu dữ liệu
          </button>
        )}
      </div>
      {refreshNote && <p className="vdb-note" role="status">Chưa cập nhật được: {refreshNote} Đang hiện số lúc {stamp}.</p>}
      {current === 'portfolio' && <PortfolioDashboard {...props} />}
      {current === 'cashflow' && <CashflowDashboard {...props} />}
      {current === 'materials' && <MaterialsDashboard {...props} projectId={selectedProject} loadMoves={loadMoves} onDrillAsync={drillAsync} />}
      {current === 'debt' && <DebtDashboard {...props} />}
      {drill && <DrillDrawer drill={drill} onClose={() => setDrill(null)} onOpen={open} />}
    </div>
    </DashOpenContext.Provider>
  );
};

export default DashboardView;
