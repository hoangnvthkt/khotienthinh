import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock, Hourglass, RefreshCw, Timer, TrendingUp, Undo2 } from 'lucide-react';
import { StateBox } from '../procurement/hub/hubUi';
import type { DrillDown } from '../../lib/dashboard/dashboardModel';
import { DashOpenContext, DataTable, DrillDrawer, Tile, dashColors } from '../dashboard/dashUi';
import { FLOW_UNASSIGNED, type FlowDataset, type FlowQuery, type FlowRange } from '../../lib/center/centerFlowService';
import {
  drillDaily, drillKinds, drillOutcomes, drillOverdue, drillPeople, drillStuckByPerson, drillWaitingByUnit, fmtInt, hoursText, medianDoneHours,
  outcomeCount, sourceLabel, stampText, totalDaily, totalLinks, unitBars, unitName, type FlowSelection, type SankeyColors,
} from '../../lib/center/flowModel';
import FlowSankey from './FlowSankey';
import FlowPanel from './FlowPanel';
import '../dashboard/dashboard.css';
import './flow.css';

// Dòng chảy công việc — tab trong Trung tâm điều hành (docs/command-center/08, chủ SP duyệt 13/10).
// Bốn lớp: dải chỉ số → sơ đồ (Dòng chảy / Người xử lý) → ngăn Điểm nghẽn → bảng bấm xuống. Số liệu từ vcc_flow_v1,
// máy chủ đã cắt theo quyền; màn tự lấy số mới mỗi phút khi đang mở (CenterShell), không realtime từng phiếu.

export type FlowState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: FlowDataset };

const RANGES: FlowRange[] = [7, 30, 90];
type View = 'flow' | 'people';

const sankeyColors = (isDark: boolean): SankeyColors => {
  const c = dashColors(isDark);
  return isDark
    ? { unit: '#8cc5d3', gap: '#6b7280', done: '#8cc5d3', waiting: c.warn, returned: '#c4b5fd', rejected: c.danger, other: '#6b7280', stuck: c.danger }
    : { unit: '#2e6f80', gap: '#9ca3af', done: '#2e6f80', waiting: c.warn, returned: '#7c3aed', rejected: c.danger, other: '#9ca3af', stuck: c.danger };
};

const Spark: React.FC<{ values: number[]; color: string }> = ({ values, color }) => {
  const w = 84; const h = 26; const max = Math.max(1, ...values);
  if (values.length < 2) return null;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 6)] as const);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg className="vfl-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={w} cy={pts[pts.length - 1][1].toFixed(1)} r={2} fill={color} />
    </svg>
  );
};

const FlowView: React.FC<{
  state: FlowState;
  isDark: boolean;
  query: FlowQuery;
  onQueryChange: (query: FlowQuery) => void;
  /** Đang lấy số mới (vẫn hiện số cũ). */
  refreshing?: boolean;
  /** Lần cập nhật gần nhất lỗi trong khi đang có số cũ. */
  refreshNote?: string | null;
  /** Lấy số mới (lỗi tải lần đầu: thử lại). */
  onRetry: () => void;
  /** Mở màn gốc thành tab của Center. */
  onOpen: (route: string) => void;
  now: Date;
}> = ({ state, isDark, query, onQueryChange, refreshing = false, refreshNote = null, onRetry, onOpen, now }) => {
  const data = state.status === 'ready' ? state.data : null;
  const colors = useMemo(() => sankeyColors(isDark), [isDark]);
  const [selection, setSelection] = useState<FlowSelection | null>(null);
  const [view, setView] = useState<View>('flow');
  const [drill, setDrill] = useState<DrillDown | null>(null);
  // Khung hẹp (điện thoại): dải thay bằng thanh theo phòng.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = wrapRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 640));
    observer.observe(element);
    return () => observer.disconnect();
  }, [state.status]);
  // Đổi phạm vi (lọc / phòng / dự án) thì bỏ lựa chọn cũ.
  useEffect(() => { setSelection(null); }, [query.range, query.unitId, query.projectId]);
  useEffect(() => {
    if (!drill) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrill(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drill]);

  if (state.status === 'loading') return <div className="vdb vfl"><StateBox kind="loading" title="Đang tổng hợp dòng chảy công việc…" /></div>;
  if (state.status === 'error') return <div className="vdb vfl"><StateBox kind="error" title="Chưa tải được dòng chảy công việc" message={state.message} onRetry={onRetry} /></div>;
  if (!data) return null;

  const stamp = stampText(data.generatedAt, now);
  const scope = data.scope;
  const unitOptions = scope.canCompany ? data.units.filter(unit => unit.id !== FLOW_UNASSIGNED && unit.active && unit.people > 0) : data.units.filter(unit => scope.managedUnitIds.includes(unit.id));
  const projectOptions = scope.canCompany ? data.projects : data.projects.filter(project => scope.ledProjectIds.includes(project.id));
  const waiting = data.waiting;
  const links = totalLinks(data);
  const returned = outcomeCount(data, 'returned') + outcomeCount(data, 'rejected');
  const daily = totalDaily(data);
  const median = medianDoneHours(data);
  const open = (route: string) => { setDrill(null); onOpen(route); };
  const scopeLabel = scope.kind === 'unit' && query.unitId ? `Phòng: ${unitName(data, query.unitId)}`
    : scope.kind === 'unit' ? `Phạm vi: ${scope.unitIds.map(id => unitName(data, id)).slice(0, 2).join(', ')}${scope.unitIds.length > 2 ? '…' : ''}`
    : scope.kind === 'project' && query.projectId ? `Dự án: ${data.projects.find(p => p.id === query.projectId)?.code || query.projectId}`
    : scope.kind === 'project' ? 'Phạm vi: dự án của bạn' : null;

  return (
    <DashOpenContext.Provider value={open}>
    <div className="vdb vfl" ref={wrapRef}>
      <div className="vdb-head">
        <div className="min-w-0">
          <h2 className="vdb-title">Dòng chảy công việc</h2>
          <p className="vdb-sub">Việc đi từ phòng nào đến phòng nào, kết cục ra sao, hôm nay đang tắc ở đâu.</p>
        </div>
        <div className="vdb-filters">
          {scopeLabel && <span className="vfl-scope" title="Máy chủ chỉ trả số trong phạm vi bạn được xem">{scopeLabel}</span>}
          <div className="vdb-switch" role="tablist" aria-label="Khoảng thời gian">
            {RANGES.map(range => (
              <button key={range} type="button" role="tab" aria-selected={query.range === range || (!query.range && range === 90)}
                onClick={() => onQueryChange({ ...query, range })} title={`Lượt giao trong ${range} ngày gần nhất`}>{range} ngày</button>
            ))}
          </div>
          {unitOptions.length > 1 && (
            <select className="vdb-select" aria-label="Lọc theo phòng ban" value={query.unitId ?? ''}
              onChange={event => onQueryChange({ ...query, unitId: event.target.value || null, projectId: null })}>
              <option value="">{scope.canCompany ? 'Mọi phòng ban' : 'Các phòng của tôi'}</option>
              {unitOptions.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
          )}
          {projectOptions.length > 0 && (
            <select className="vdb-select" aria-label="Lọc theo dự án" value={query.projectId ?? ''}
              onChange={event => onQueryChange({ ...query, projectId: event.target.value || null, unitId: null })}>
              <option value="">{scope.canCompany ? 'Mọi dự án' : 'Dự án của tôi'}</option>
              {projectOptions.map(project => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
            </select>
          )}
          <button type="button" className="vdb-btn" onClick={onRetry} disabled={refreshing} aria-busy={refreshing} title="Lấy số liệu mới nhất ngay. Màn tự cập nhật mỗi phút khi đang mở.">
            <RefreshCw size={13} /> {refreshing ? 'Đang cập nhật…' : 'Cập nhật'}
          </button>
        </div>
      </div>
      <div className="vdb-stamp mb-3">
        {stamp && <span>Số liệu lúc {stamp} · tự cập nhật mỗi phút khi đang mở · bấm con số, phòng, dải để xem chi tiết</span>}
      </div>
      {refreshNote && <p className="vdb-note" role="status">Chưa cập nhật được: {refreshNote} Đang hiện số lúc {stamp}.</p>}

      <div className="vfl-chips" role="group" aria-label="Việc đang chờ theo nguồn">
        {waiting.bySource.map(source => (
          <button key={source.source} type="button" className="vfl-chip" onClick={() => setDrill(drillKinds(data, source.source))}
            title={`${sourceLabel(source.source)}: ${source.n} việc đang chờ${source.stuck ? `, ${source.stuck} đứng yên` : ''}${source.withPerson < source.n ? ` · ${source.n - source.withPerson} việc chờ một vai, chưa gắn người` : ''}`}>
            {sourceLabel(source.source)} <b>{fmtInt(source.n)}</b>{source.stuck > 0 && <i>{fmtInt(source.stuck)}</i>}
          </button>
        ))}
        {waiting.bySource.length === 0 && <span className="vdb-muted text-xs">Không có việc đang chờ.</span>}
      </div>

      <div className="vfl-tiles" role="group" aria-label="Chỉ số dòng chảy">
        <Tile icon={Hourglass} label="Đang chờ xử lý" value={fmtInt(waiting.total)} tone="amber" onClick={() => setDrill(drillWaitingByUnit(data))} hint={`${waiting.byUnit.length} phòng đang giữ việc`} />
        <Tile icon={AlertTriangle} label={`Đứng yên > ${data.thresholds.stuckBusinessDays} ngày`} value={fmtInt(waiting.stuck)} tone="rose" onClick={() => setDrill(drillStuckByPerson(data, now))}
          hint={`${fmtInt(waiting.dead)} việc đã chờ trên ${data.thresholds.deadDays} ngày`} />
        <Tile icon={Clock} label="Quá hạn" value={fmtInt(waiting.overdue)} tone="rose" onClick={() => setDrill(drillOverdue(data))}
          hint={`${fmtInt(waiting.overdueByDefaultSla)} việc tính theo SLA mặc định ${data.thresholds.slaDefaultHours} giờ`} />
        <Tile icon={Timer} label="Trung vị xử lý" value={hoursText(median)} tone="blue" onClick={() => setDrill(drillOutcomes(data))}
          hint={`${fmtInt(outcomeCount(data, 'done'))} lượt xử lý xong trong ${data.rangeDays} ngày`} />
        <Tile icon={Undo2} label="Trả lại / từ chối" value={fmtInt(returned)} tone="violet" onClick={() => setDrill(drillOutcomes(data))}
          hint={`${fmtInt(outcomeCount(data, 'returned'))} trả lại · ${fmtInt(outcomeCount(data, 'rejected'))} từ chối`} />
        <button type="button" className="vdb-tile" data-tone="green" onClick={() => setDrill(drillDaily(data))} title="Lượt giao theo ngày, 30 ngày gần nhất">
          <span className="vdb-tile-i"><TrendingUp size={16} /></span>
          <span className="min-w-0">
            <span className="vdb-tile-l block">Lượt giao 30 ngày</span>
            <span className="vdb-tile-v block">{fmtInt(daily)}</span>
          </span>
          <Spark values={data.daily.map(day => day.n)} color={colors.done} />
        </button>
      </div>

      <div className="vfl-body">
        <section className="vdb-card vfl-viz" aria-label="Sơ đồ dòng chảy">
          <div className="vfl-viz-head">
            <div className="vdb-switch" role="tablist" aria-label="Cách nhìn">
              <button type="button" role="tab" aria-selected={view === 'flow'} onClick={() => setView('flow')}>Dòng chảy</button>
              <button type="button" role="tab" aria-selected={view === 'people'} onClick={() => setView('people')}>Người xử lý</button>
            </div>
            {view === 'flow' && !narrow && (
              <div className="vfl-legend" aria-hidden="true">
                <span><i style={{ background: colors.done }} />Đã xử lý</span>
                <span><i style={{ background: colors.waiting }} />Đang chờ</span>
                <span><i style={{ background: colors.returned }} />Trả lại</span>
                <span><i style={{ background: colors.rejected }} />Từ chối</span>
                <span><i style={{ background: colors.other }} />Bỏ qua / hủy</span>
                <span><i style={{ background: colors.stuck }} data-bar />đứng yên hôm nay</span>
              </div>
            )}
          </div>
          {view === 'flow' && !narrow && <FlowSankey data={data} colors={colors} selection={selection} onSelect={setSelection} />}
          {view === 'flow' && narrow && (
            <div className="vfl-unitbars" role="list" aria-label="Nơi xử lý">
              {unitBars(data).map(bar => (
                <button key={bar.id} type="button" role="listitem" className="vfl-unitbar" data-selected={selection?.type === 'unit' && selection.id === bar.id || undefined}
                  onClick={() => setSelection({ type: 'unit', id: bar.id })}>
                  <span className="vfl-unitbar-name"><span className="vcc-ent">{bar.name}</span>{bar.gap && <span className="vfl-pill">lỗ hổng dữ liệu</span>}</span>
                  <span className="vfl-unitbar-n">{fmtInt(bar.received)}</span>
                  <span className="vfl-unitbar-t"><i style={{ width: `${Math.min(100, (bar.received / Math.max(1, links)) * 100 * 2)}%`, background: colors.unit }} /></span>
                  <span className="vfl-unitbar-w" data-tone={bar.stuck ? 'bad' : bar.waiting ? 'warn' : undefined}>
                    {bar.waiting ? `${fmtInt(bar.waiting)} đang chờ · ${fmtInt(bar.stuck)} đứng yên` : 'không có việc chờ'}
                  </span>
                </button>
              ))}
              {unitBars(data).length === 0 && <p className="vfl-empty">Chưa có lượt giao nào trong khoảng đã chọn.</p>}
            </div>
          )}
          {view === 'people' && (
            <>
              <DataTable drill={drillPeople(data)} />
              <div className="vfl-foot">
                <span>Trung vị = một nửa số lượt xử lý nhanh hơn con số này. % đúng hạn chỉ tính lượt có hạn.</span>
                <span>Một lượt duyệt một phút và một bước nhận hàng cả ngày đang được đếm như nhau; trọng số theo loại phiếu làm ở đợt 2.</span>
              </div>
            </>
          )}
          {view === 'flow' && (
            <div className="vfl-foot">
              <span>{narrow ? 'Bấm một phòng để xem người và kết quả.' : `Độ rộng dải = số lượt giao trong ${data.rangeDays} ngày (${fmtInt(links)} lượt). Bấm phòng, dải hoặc kết quả để xem chi tiết.`}</span>
            </div>
          )}
        </section>
        <aside className="vdb-card vfl-panel" aria-label="Điểm nghẽn">
          <FlowPanel data={data} colors={colors} selection={selection} now={now} onSelect={setSelection} onOpen={open}
            onShowPeople={() => setDrill(drillStuckByPerson(data, now))} />
        </aside>
      </div>
      {drill && <DrillDrawer drill={drill} onClose={() => setDrill(null)} onOpen={open} />}
    </div>
    </DashOpenContext.Provider>
  );
};

export default FlowView;
