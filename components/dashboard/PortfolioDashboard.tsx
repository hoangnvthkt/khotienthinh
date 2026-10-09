import React, { useMemo, useState } from 'react';
import { Coins, PiggyBank, Wallet } from 'lucide-react';
import {
  HEALTH_LABEL, ROUTES, daysBetween, drillByProject, pct, projectHealth, ringMoney, shortMoney, sumFinance, viDate,
  type DrillDown, type ProjectHealth,
} from '../../lib/dashboard/dashboardModel';
import type { DashProject, DashboardDataset } from '../../lib/dashboard/dashboardTypes';
import type { DashColors } from './dashUi';
import SiteMap from './SiteMap';

// Bảng 1 — Quản lý tiến độ đa dự án: mỗi công trình một thẻ (ngày, thời gian, tình trạng, giá trị HĐ, tiến độ kế hoạch /
// thực tế, ngân sách – thu – chi, bản đồ). Dự án có vấn đề lên trước. Mọi con số bấm được.

const PROJECT_STATUS: Record<string, string> = { planning: 'Chuẩn bị', active: 'Đang thực hiện', paused: 'Tạm dừng', completed: 'Hoàn thành' };
const HEALTH_TONE: Record<ProjectHealth, 'rose' | 'amber' | 'green' | 'blue' | 'gray'> = {
  overdue: 'rose', late: 'rose', risk: 'amber', on_track: 'green', done: 'blue', unknown: 'gray',
};
const HEALTH_ORDER: ProjectHealth[] = ['overdue', 'late', 'risk', 'on_track', 'unknown', 'done'];

const Ring: React.FC<{ value: number | null; progress: number | null; color: string; track: string; onClick?: () => void }> = ({ value, progress, color, track, onClick }) => {
  const r = 36;
  const length = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, progress ?? 0)) / 100 * length;
  return (
    <button type="button" className="vdb-ring" onClick={onClick} disabled={!onClick} title="Giá trị hợp đồng · vòng = tiến độ thực tế">
      <svg viewBox="0 0 84 84" aria-hidden="true">
        <circle cx="42" cy="42" r={r} fill="none" stroke={track} strokeWidth="7" />
        {progress != null && progress > 0 && (
          <circle cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={`${filled} ${length}`} transform="rotate(-90 42 42)" />
        )}
      </svg>
      <b>{ringMoney(value)}<small>VNĐ</small></b>
    </button>
  );
};

const ProgressBar: React.FC<{ label: string; value: number | null; color: string }> = ({ label, value, color }) => (
  <div>
    <div className="l">{label}</div>
    <div className="vdb-bar">
      <span className="track"><span className="fill" style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%`, background: color }} /></span>
      <span className="vdb-num" style={{ minWidth: 34, textAlign: 'right' }}>{pct(value)}</span>
    </div>
  </div>
);

const SumItem: React.FC<{ icon: React.ComponentType<{ size?: number }>; label: string; value: number | null; onClick?: () => void }> = ({ icon: Icon, label, value, onClick }) => (
  <button type="button" className="vdb-sum-i" onClick={onClick} disabled={!onClick || value == null} title={value == null ? 'Bạn chưa được xem tài chính các dự án này' : 'Bấm để xem theo dự án'}>
    <span className="vdb-sum-ic"><Icon size={16} /></span>
    <span className="min-w-0"><span className="vdb-sum-l block">{label}</span><span className="vdb-sum-v block">{value == null ? '—' : shortMoney(value)}</span></span>
  </button>
);

const stamp = (iso: string | null) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `Tổng hợp lúc ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} ngày ${viDate(iso)}`;
};

const ProjectCard: React.FC<{ project: DashProject; today: string; colors: DashColors; onOpen: (route: string) => void }> = ({ project, today, colors, onOpen }) => {
  const health = projectHealth(project, today);
  const finance = project.finance;
  const days = project.start && project.end ? daysBetween(project.start, project.end) + 1 : null;
  const late = health === 'late' || health === 'overdue';
  return (
    <article className="vdb-card vdb-proj" aria-label={project.name}>
      <div className="vdb-proj-main">
        <button type="button" className="vdb-link" onClick={() => onOpen(ROUTES.project(project.id))}><h3 className="vdb-proj-name">{project.name}</h3></button>
        <div className="vdb-proj-meta">
          <span><span className="vdb-dot" />{PROJECT_STATUS[project.status] || project.status}</span>
          <span>Mã dự án: {project.code}</span>
          {project.createdAt && <span>Ngày tạo: {viDate(project.createdAt)}</span>}
          {project.director && <span>Giám đốc: {project.director}</span>}
        </div>
        <div className="vdb-proj-body">
          <div className="vdb-proj-dates">
            <span><span className="l">Bắt đầu</span><span className="vdb-pill">{viDate(project.start)}</span></span>
            <span><span className="l">Kết thúc</span><span className="vdb-pill" data-tone="rose">{viDate(project.end)}</span></span>
            <span><span className="l">Thời gian</span><span className="vdb-pill" data-tone="gray">{days != null ? `${days} ngày` : '—'}</span></span>
            <span><span className="l">Tình trạng</span>
              <button type="button" className="vdb-pill" data-tone={HEALTH_TONE[health]} onClick={() => onOpen(ROUTES.project(project.id, 'gantt'))}
                title={health === 'late' ? `Thực tế kém kế hoạch từ 10 điểm % — bấm để mở Tiến độ` : 'Bấm để mở Tiến độ'}>
                {HEALTH_LABEL[health]}
              </button>
            </span>
          </div>
          <Ring value={finance?.contractValue ?? null} progress={project.actualProgress} color={late ? colors.warn : colors.chi} track={colors.remaining}
            onClick={finance ? () => onOpen(ROUTES.projectFinance(project.id)) : undefined} />
          <button type="button" className="vdb-bars text-left" onClick={() => onOpen(ROUTES.project(project.id, 'gantt'))} title="Bấm để mở Tiến độ (Gantt)">
            <ProgressBar label="Tiến độ kế hoạch" value={project.plannedProgress} color={colors.chi} />
            <ProgressBar label="Tiến độ thực tế" value={project.actualProgress} color={late ? colors.warn : colors.thu} />
          </button>
        </div>
        {stamp(project.updatedAt) && <div className="vdb-proj-stamp">{stamp(project.updatedAt)}</div>}
      </div>
      <SiteMap lat={project.site?.lat ?? null} lng={project.site?.lng ?? null} label={project.site?.name || project.name} />
      <div className="vdb-proj-money" style={{ gridColumn: '1 / -1' }}>
        <SumItem icon={Coins} label="Ngân sách" value={finance ? finance.budget : null} onClick={() => onOpen(ROUTES.projectFinance(project.id))} />
        <SumItem icon={PiggyBank} label="Thu" value={finance ? finance.received : null} onClick={() => onOpen(ROUTES.receivables)} />
        <SumItem icon={Wallet} label="Chi" value={finance ? finance.cost : null} onClick={() => onOpen(ROUTES.cost)} />
      </div>
    </article>
  );
};

const PortfolioDashboard: React.FC<{
  dataset: DashboardDataset;
  projects: DashProject[];
  colors: DashColors;
  onDrill: (drill: DrillDown) => void;
  onOpen: (route: string) => void;
}> = ({ dataset, projects, colors, onDrill, onOpen }) => {
  const [health, setHealth] = useState<ProjectHealth | 'all'>('all');
  const rows = useMemo(() => projects
    .map(project => ({ project, health: projectHealth(project, dataset.today) }))
    .sort((a, b) => HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health) || a.project.code.localeCompare(b.project.code)), [projects, dataset.today]);
  const counts = useMemo(() => rows.reduce<Record<string, number>>((map, row) => ({ ...map, [row.health]: (map[row.health] || 0) + 1 }), {}), [rows]);
  const shown = health === 'all' ? rows : rows.filter(row => row.health === health);
  const through = { label: 'Mở Đa dự án', route: ROUTES.portfolio };

  return (
    <div className="vdb-grid">
      <section className="vdb-card vdb-col-12" aria-label="Tổng ngân sách, thu, chi">
        <div className="vdb-sum">
          <SumItem icon={Coins} label="Ngân sách" value={sumFinance(projects, finance => finance.budget)}
            onClick={() => onDrill(drillByProject('Ngân sách chi phí theo dự án', projects, finance => finance.budget, { through }))} />
          <SumItem icon={PiggyBank} label="Thu" value={sumFinance(projects, finance => finance.received)}
            onClick={() => onDrill(drillByProject('Tiền chủ đầu tư đã trả theo dự án', projects, finance => finance.received, { through: { label: 'Mở Phải thu', route: ROUTES.receivables } }))} />
          <SumItem icon={Wallet} label="Chi" value={sumFinance(projects, finance => finance.cost)}
            onClick={() => onDrill(drillByProject('Chi phí đã ghi nhận theo dự án', projects, finance => finance.cost, { through: { label: 'Mở Chi phí & ngân sách', route: ROUTES.cost } }))} />
        </div>
      </section>
      <div className="vdb-col-12 vdb-chips" role="group" aria-label="Lọc theo tình trạng">
        <button type="button" className="vdb-chip" aria-pressed={health === 'all'} onClick={() => setHealth('all')}>Tất cả <b>{rows.length}</b></button>
        {HEALTH_ORDER.filter(key => counts[key]).map(key => (
          <button key={key} type="button" className="vdb-chip" aria-pressed={health === key} onClick={() => setHealth(key)}>{HEALTH_LABEL[key]} <b>{counts[key]}</b></button>
        ))}
      </div>
      {shown.length === 0 && <p className="vdb-col-12 vdb-muted m-0">Không có dự án ở tình trạng này.</p>}
      {shown.map(({ project }) => (
        <div key={project.id} className="vdb-col-12">
          <ProjectCard project={project} today={dataset.today} colors={colors} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
};

export default PortfolioDashboard;
