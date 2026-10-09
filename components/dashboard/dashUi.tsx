import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, MoreHorizontal, Table2, X } from 'lucide-react';
import { NO_DATA, money, pct, viDate, type DrillColumn, type DrillDown } from '../../lib/dashboard/dashboardModel';
import type { CostCategory } from '../../lib/dashboard/dashboardTypes';

// Đồ dùng chung của Bảng điều khiển. Màu dữ liệu: bảng màu phân loại đã kiểm mù màu (dataviz validator, 09/10):
// xanh dương · xanh ngọc · tím · vàng · hồng (+ xám cho "Khác"); cam / đỏ để dành cho cảnh báo (quy chuẩn Vioo).

export interface DashColors {
  thu: string; chi: string; budget: string; remaining: string; grid: string; axis: string; text: string; surface: string;
  category: Record<CostCategory, string>;
  series: string[];
  warn: string; danger: string; good: string;
}

const LIGHT: DashColors = {
  thu: '#1baf7a', chi: '#2a78d6', budget: '#2a78d6', remaining: '#d4d8de', grid: 'rgba(15,23,42,.08)', axis: '#737373', text: '#1a1a1a', surface: '#ffffff',
  category: { materials: '#2a78d6', labor: '#1baf7a', machinery: '#4a3aa7', subcontract: '#eda100', overhead: '#e87ba4', other: '#9ca3af' },
  series: ['#2a78d6', '#1baf7a', '#4a3aa7', '#eda100', '#e87ba4', '#008300'],
  warn: '#d97706', danger: '#dc2626', good: '#19774f',
};
const DARK: DashColors = {
  thu: '#199e70', chi: '#3987e5', budget: '#3987e5', remaining: '#3a3f46', grid: 'rgba(255,255,255,.08)', axis: '#9a9a9a', text: '#ededed', surface: '#222222',
  category: { materials: '#3987e5', labor: '#199e70', machinery: '#9085e9', subcontract: '#c98500', overhead: '#d55181', other: '#6b7280' },
  series: ['#3987e5', '#199e70', '#9085e9', '#c98500', '#d55181', '#008300'],
  warn: '#e9a23b', danger: '#f08c8c', good: '#8fd6b0',
};
export const dashColors = (isDark: boolean): DashColors => (isDark ? DARK : LIGHT);

/** Mở màn gốc (drill-through) — Bảng điều khiển cung cấp, thẻ dùng cho mục "Mở …" trong menu. */
export const DashOpenContext = createContext<(route: string) => void>(() => undefined);

/** Thẻ biểu đồ: tiêu đề, phụ đề, menu "…" (xem bảng số liệu · mở màn gốc). */
export const Card: React.FC<{
  title: string;
  subtitle?: string;
  className?: string;
  table?: React.ReactNode;
  through?: { label: string; route: string };
  aside?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, className = '', table, through, aside, children }) => {
  const open = useContext(DashOpenContext);
  const [menu, setMenu] = useState(false);
  const [asTable, setAsTable] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  return (
    <section className={`vdb-card ${className}`} aria-label={title} ref={ref}>
      <header className="vdb-card-head">
        <div className="min-w-0">
          <h3 className="vdb-card-title">{title}</h3>
          {subtitle && <p className="vdb-card-sub">{subtitle}</p>}
        </div>
        {aside}
        {(table || through) && (
          <button type="button" className="vdb-menu" aria-label={`Tùy chọn ${title}`} aria-expanded={menu} onClick={() => setMenu(value => !value)}>
            <MoreHorizontal size={16} />
          </button>
        )}
        {menu && (
          <div className="vdb-pop" role="menu">
            {table && (
              <button type="button" role="menuitem" onClick={() => { setAsTable(value => !value); setMenu(false); }}>
                <Table2 size={13} className="mr-1.5 inline" />{asTable ? 'Xem biểu đồ' : 'Xem bảng số liệu'}
              </button>
            )}
            {through && (
              <button type="button" role="menuitem" onClick={() => { setMenu(false); open(through.route); }}>
                <ArrowUpRight size={13} className="mr-1.5 inline" />{through.label}
              </button>
            )}
          </div>
        )}
      </header>
      {asTable && table ? table : children}
    </section>
  );
};

/** Khối navy số liệu chính; mỗi số bấm được. */
export interface HeroMetric { label: string; value: string; size?: 'sm'; tone?: 'good' | 'bad'; onClick?: () => void; title?: string }
export const Hero: React.FC<{ metrics: HeroMetric[]; columns?: 1 | 2; note?: string; className?: string; children?: React.ReactNode }> = ({ metrics, columns = 2, note, className = '', children }) => (
  <section className={`vdb-hero ${columns === 1 ? 'vdb-hero-1' : ''} ${className}`}>
    {metrics.map(metric => (
      <button key={metric.label} type="button" className="vdb-hero-m" onClick={metric.onClick} disabled={!metric.onClick} title={metric.title || (metric.onClick ? 'Bấm để xem chi tiết' : undefined)}>
        <div className="vdb-hero-l">{metric.label}</div>
        <div className="vdb-hero-v" data-size={metric.size} data-tone={metric.tone}>{metric.value}</div>
      </button>
    ))}
    {note && <div className="vdb-hero-note" style={{ gridColumn: '1 / -1' }}>{note}</div>}
    {children}
  </section>
);

export type TileTone = 'blue' | 'rose' | 'amber' | 'green' | 'teal' | 'violet';
export const Tile: React.FC<{ icon: React.ComponentType<{ size?: number }>; label: string; value: string; tone: TileTone; onClick?: () => void; hint?: string }> =
  ({ icon: Icon, label, value, tone, onClick, hint }) => (
    <button type="button" className="vdb-tile" data-tone={tone} onClick={onClick} disabled={!onClick} title={hint || (onClick ? 'Bấm để xem chi tiết' : undefined)}>
      <span className="vdb-tile-i"><Icon size={16} /></span>
      <span className="min-w-0">
        <span className="vdb-tile-l block">{label}</span>
        <span className="vdb-tile-v block">{value}</span>
      </span>
    </button>
  );

/** Chưa có chứng từ nào: nói rõ, không vẽ số 0. */
export const NoData: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="vdb-empty" role="note"><b>{NO_DATA}</b><span>{children}</span></div>
);
/** Như NoData, đặt ở chỗ con số tổng của thẻ công nợ. */
export const DebtEmpty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="vdb-debt-empty" role="note"><b>{NO_DATA}</b><span>{children}</span></div>
);

/** `value` chỉ hiện khi khung hẹp (nhãn ngoài biểu đồ tròn bị ẩn để khỏi tràn). */
export const Legend: React.FC<{ items: Array<{ label: string; color: string; line?: boolean; value?: string }> }> = ({ items }) => (
  <div className="vdb-legend">
    {items.map(item => (
      <span key={item.label}><i style={{ background: item.color }} data-line={item.line || undefined} />{item.label}
        {item.value && <b className="vdb-legend-v">{item.value}</b>}
      </span>
    ))}
  </div>
);

/** Tooltip biểu đồ (recharts content). */
export const ChartTip: React.FC<{ active?: boolean; label?: string; payload?: Array<{ name?: string; value?: number; color?: string; payload?: Record<string, unknown> }>; labelFormat?: (label: string) => string; hint?: string }> =
  ({ active, label, payload, labelFormat, hint = 'Bấm để xem theo dự án' }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="vdb-tip">
        <b>{labelFormat && label != null ? labelFormat(String(label)) : label}</b>
        {payload.map(item => (
          <div key={item.name}><span><i style={{ background: item.color }} />{item.name}</span><span className="vdb-num">{money(item.value)} đ</span></div>
        ))}
        <small>{hint}</small>
      </div>
    );
  };

const cell = (column: DrillColumn, value: string | number | null | undefined): string => {
  if (value == null || value === '') return '—';
  if (column.kind === 'money') return money(Number(value));
  if (column.kind === 'pct') return pct(Number(value));
  if (column.kind === 'date') return viDate(String(value));
  if (column.kind === 'number') return new Intl.NumberFormat('vi-VN').format(Number(value));
  return String(value);
};

/** Bảng số liệu dùng chung: xem bảng của biểu đồ, bảng trong ngăn bấm xuống. */
export const DataTable: React.FC<{ drill: Pick<DrillDown, 'columns' | 'rows' | 'total'>; onRow?: (route: string) => void; firstIsEntity?: boolean }> = ({ drill, onRow, firstIsEntity = true }) => (
  <div className="vdb-table-wrap">
    <table className="vdb-table">
      <thead>
        <tr>{drill.columns.map(column => <th key={column.key} data-num={column.kind && column.kind !== 'text' ? true : undefined}>{column.label}</th>)}</tr>
      </thead>
      <tbody>
        {drill.rows.length === 0 && <tr><td colSpan={drill.columns.length} className="vdb-muted">Không có số liệu.</td></tr>}
        {drill.rows.map(row => (
          <tr key={row.id} data-click={row.route && onRow ? true : undefined} onClick={row.route && onRow ? () => onRow(row.route as string) : undefined}
            tabIndex={row.route && onRow ? 0 : undefined} onKeyDown={row.route && onRow ? event => { if (event.key === 'Enter') onRow(row.route as string); } : undefined}>
            {drill.columns.map((column, index) => (
              <td key={column.key} data-num={column.kind && column.kind !== 'text' ? true : undefined}>
                <span className={index === 0 && firstIsEntity ? 'vdb-ent' : undefined}>{cell(column, row.cells[column.key])}</span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {drill.total && drill.rows.length > 1 && (
        <tfoot>
          <tr>{drill.columns.map((column, index) => (
            <td key={column.key} data-num={column.kind && column.kind !== 'text' ? true : undefined}>
              {index === 0 ? 'Tổng' : drill.total?.[column.key] != null ? cell(column, drill.total[column.key]) : ''}
            </td>
          ))}</tr>
        </tfoot>
      )}
    </table>
  </div>
);

/** Ngăn bấm xuống: các dòng tạo nên con số; bấm dòng = mở hồ sơ; nút chân = mở màn gốc. */
export const DrillDrawer: React.FC<{ drill: DrillDown; onClose: () => void; onOpen: (route: string) => void }> = ({ drill, onClose, onOpen }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="vdb-drawer" role="dialog" aria-modal="true" aria-label={drill.title}>
      <button type="button" className="vdb-drawer-bg" aria-label="Đóng" onClick={onClose} />
      <aside className="vdb-drawer-panel">
        <header className="vdb-drawer-head">
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-base font-bold">{drill.title}</h3>
            {drill.subtitle && <p className="m-0 mt-0.5 text-xs vdb-muted">{drill.subtitle}</p>}
          </div>
          <button type="button" className="vdb-menu" onClick={onClose} aria-label="Đóng"><X size={16} /></button>
        </header>
        <div className="vdb-drawer-body">
          <DataTable drill={drill} onRow={onOpen} />
          {drill.rows.some(row => row.route) && !drill.subtitle?.includes('Bấm một dòng') && <p className="m-0 mt-2 px-2 text-xs vdb-muted">Bấm một dòng để mở hồ sơ.</p>}
        </div>
        {drill.through && (
          <footer className="vdb-drawer-foot">
            <button type="button" className="vdb-pri" onClick={() => onOpen(drill.through!.route)}>{drill.through.label} <ArrowUpRight size={14} /></button>
          </footer>
        )}
      </aside>
    </div>
  );
};
