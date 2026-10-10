import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { StateBox } from '../procurement/hub/hubUi';
import { DASHBOARD_META, gapsFor, type DrillDown } from '../../lib/dashboard/dashboardModel';
import type { DashDocList, DashDocQuery, DashboardDataset, DashboardId } from '../../lib/dashboard/dashboardTypes';
import { DashDocsContext, DashOpenContext, DocsDrawer, DrillDrawer, dashColors, type DocsView } from './dashUi';
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

// Bảng đang xem lưu riêng từng tài khoản trên máy này.
const VIEW_KEY = 'vdb_view';
const viewKey = (owner?: string) => (owner ? `${VIEW_KEY}:${owner}` : VIEW_KEY);
const readView = (owner?: string): DashboardId | null => { try { return (localStorage.getItem(viewKey(owner)) ?? localStorage.getItem(VIEW_KEY)) as DashboardId | null; } catch { return null; } };
const writeView = (id: DashboardId, owner?: string) => { try { localStorage.setItem(viewKey(owner), id); } catch { /* chỉ là tiện ích */ } };

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
  /** Chứng từ tạo nên một con số tiền. */
  loadDocs?: (query: DashDocQuery, projectId: string | null) => Promise<DashDocList>;
  /** Mở màn gốc (Center mở thành tab nếu chạy được trong tab, không thì chuyển hẳn). */
  onOpen: (route: string) => void;
  /** Chỉ một bảng, gắn trên "Hôm nay" như một khối (không tiêu đề lớn, không thanh chọn bảng). */
  only?: DashboardId;
  /** Chuyển sang bảng này (bấm "Mở" trên khối ở Hôm nay); nonce đổi = yêu cầu mới. */
  focus?: { board: DashboardId; nonce: number } | null;
  /** Người dùng: bảng đang xem lưu riêng từng tài khoản. */
  storageOwner?: string;
}> = ({ state, isDark, refreshing = false, refreshNote = null, onRetry, loadMoves, loadDocs, onOpen, only, focus, storageOwner }) => {
  const data = state.status === 'ready' ? state.data : null;
  const access = data?.access || [];
  const [view, setView] = useState<DashboardId | null>(() => readView(storageOwner));
  const [projectId, setProjectId] = useState('all');
  const [drill, setDrill] = useState<DrillDown | null>(null);
  const current: DashboardId | null = only ? (access.includes(only) ? only : null) : view && access.includes(view) ? view : access[0] || null;
  const colors = dashColors(isDark);
  const projects = useMemo(() => (data ? data.projects.filter(project => projectId === 'all' || project.id === projectId) : []), [data, projectId]);
  useEffect(() => { if (projectId !== 'all' && data && !data.projects.some(project => project.id === projectId)) setProjectId('all'); }, [data, projectId]);
  const choose = (id: DashboardId) => { setView(id); writeView(id, storageOwner); };
  useEffect(() => { if (focus) { setView(focus.board); writeView(focus.board, storageOwner); } }, [focus, storageOwner]);
  const [docsView, setDocsView] = useState<DocsView | null>(null);
  // Ngăn đang mở trước khi xem chứng từ (nút ← quay lại).
  const [docsBack, setDocsBack] = useState<DrillDown | null>(null);
  const open = useCallback((route: string) => { setDrill(null); setDocsView(null); onOpen(route); }, [onOpen]);
  const loadInto = useCallback((view: DocsView) => {
    if (!loadDocs) return;
    setDocsView(view);
    loadDocs(view.docs[view.index], view.projectId)
      .then(list => setDocsView(current => (current && current.docs === view.docs && current.index === view.index && current.projectId === view.projectId
        ? { ...current, state: { status: 'ready', list } } : current)))
      .catch(error => setDocsView(current => (current && current.docs === view.docs && current.index === view.index
        ? { ...current, state: { status: 'error', message: error instanceof Error ? error.message : 'Chưa tải được chứng từ.' } } : current)));
  }, [loadDocs]);
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
  // Bấm dự án trong ngăn (hoặc nút "Chứng từ") → chứng từ; projectId null = mọi dự án đang lọc.
  const openDocs = (docs: DashDocQuery[], pid: string | null, index: number, title?: string) => {
    if (!loadDocs) return;
    const scope = pid ?? (projectId === 'all' ? null : projectId);
    const project = scope ? data.projects.find(item => item.id === scope) : null;
    setDocsBack(drill);
    setDrill(null);
    loadInto({ title: title || drill?.title || docs[index].label, docs, index, projectId: scope,
      projectLabel: project ? `${project.code} · ${project.name}` : null, state: { status: 'loading' } });
  };
  const selectedProject = projectId === 'all' ? null : projectId;

  return (
    <DashOpenContext.Provider value={open}>
    <DashDocsContext.Provider value={loadDocs ? (docs, projectId, title) => openDocs(docs, projectId, 0, title) : null}>
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
      {drill && <DrillDrawer drill={drill} onClose={() => setDrill(null)} onOpen={open} onDocs={loadDocs ? (docs, pid, index) => openDocs(docs, pid, index) : undefined} />}
      {docsView && (
        <DocsDrawer view={docsView} multiProject={data.projects.length > 1} onOpen={open} onClose={() => { setDocsView(null); setDocsBack(null); }}
          onBack={docsBack ? () => { setDocsView(null); setDrill(docsBack); setDocsBack(null); } : undefined}
          onSwitch={index => loadInto({ ...docsView, index, state: { status: 'loading' } })} />
      )}
    </div>
    </DashDocsContext.Provider>
    </DashOpenContext.Provider>
  );
};

export default DashboardView;
