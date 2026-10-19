// Trợ lý · thẻ biểu đồ dùng chung (chủ SP 19/10/2026): số do công cụ cổng AI lấy từ máy chủ, thẻ chỉ vẽ.
// Ô số tổng trước (đọc trong vài giây), rồi từng khung một trục; "Bảng" để xem số đúng từng tháng. Số chưa biết hiện "—", không ghi 0.
// Màu: theo biến --vcc-chart-* (đã kiểm mù màu sáng / tối bằng bộ kiểm dataviz), chữ luôn màu chữ, không màu chuỗi.
import React, { useState } from 'react';
import { ArrowUpRight, BarChart3, Table2, TriangleAlert } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { lineAxis, panelRows, seriesMissing, type ChartPanel, type ChartSpec } from '../../lib/assistantChart';

const SERIES_COLOR = ['var(--vcc-chart-1)', 'var(--vcc-chart-2)'];
const LINE_COLOR = 'var(--vcc-chart-line)';
const fmt = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('vi-VN'));

const Swatch: React.FC<{ color: string; line?: boolean }> = ({ color, line }) => (
  <span className="vcc-chart-swatch" data-line={line || undefined} style={{ background: color }} aria-hidden="true" />
);

const Tip: React.FC<{ active?: boolean; label?: string; payload?: Array<{ name?: string; value?: number | null; color?: string }>; unit: string }> = ({ active, label, payload, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="vcc-chart-tip">
      <b>{label}</b>
      {payload.map(p => <span key={p.name}><Swatch color={p.color || LINE_COLOR} /> {p.name}: <em>{fmt(p.value)}</em> {unit}</span>)}
    </div>
  );
};

const Panel: React.FC<{ spec: ChartSpec; panel: ChartPanel }> = ({ spec, panel }) => {
  const data = spec.labels.map((label, i) => Object.fromEntries([['label', label], ...panel.series.map((s, k) => [`s${k}`, s.values[i]])]));
  const axis = { tick: { fontSize: 11, fill: 'var(--vcc-muted)' }, axisLine: false, tickLine: false } as const;
  const multi = panel.series.length > 1;
  return (
    <figure className="vcc-chart-panel">
      <figcaption>
        <span>{panel.title}</span>
        {multi && (
          <span className="vcc-chart-legend">
            {panel.series.map((s, k) => (
              <span key={s.label}><Swatch color={SERIES_COLOR[k]} /> {s.label}{seriesMissing(s) && <em> · chưa có số</em>}</span>
            ))}
          </span>
        )}
      </figcaption>
      <div className="vcc-chart-plot" role="img" aria-label={`${panel.title}: ${panel.series.map(s => `${s.label} ${s.values.map(fmt).join(', ')}`).join('; ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          {panel.kind === 'line' ? (
            <LineChart data={data} margin={{ top: 12, right: 14, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="var(--vcc-border)" vertical={false} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
              <YAxis {...axis} width={44} allowDecimals={false} domain={lineAxis(panel).domain} ticks={lineAxis(panel).ticks} />
              <Tooltip content={<Tip unit={panel.unit} />} cursor={{ stroke: 'var(--vcc-muted)', strokeDasharray: '3 3' }} />
              {panel.series.map((s, k) => (
                <Line key={s.label} dataKey={`s${k}`} name={s.label} type="monotone" stroke={multi ? SERIES_COLOR[k] : LINE_COLOR} strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 2, fill: 'var(--vcc-card)' }} activeDot={{ r: 6, strokeWidth: 2, fill: 'var(--vcc-card)' }} connectNulls={false} isAnimationActive={false} />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 12, right: 14, left: -12, bottom: 0 }} barGap={2}>
              <CartesianGrid stroke="var(--vcc-border)" vertical={false} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
              <YAxis {...axis} width={44} allowDecimals={false} />
              <Tooltip content={<Tip unit={panel.unit} />} cursor={{ fill: 'var(--vcc-hover)' }} />
              {panel.series.map((s, k) => (
                <Bar key={s.label} dataKey={`s${k}`} name={s.label} fill={multi ? SERIES_COLOR[k] : LINE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  );
};

const AssistantChartCard: React.FC<{ spec: ChartSpec; onOpenRoute?: (route: string, title: string) => void }> = ({ spec, onOpenRoute }) => {
  const [table, setTable] = useState(false);
  return (
    <section className="vcc-cmd vcc-chart" aria-label={spec.title} data-testid="chart-card">
      <div className="vcc-cmd-head">
        <span className="vcc-cmd-icon" aria-hidden="true"><BarChart3 size={14} /></span>
        <p className="vcc-cmd-title">{spec.title}</p>
        <button type="button" className="vcc-btn" aria-pressed={table} onClick={() => setTable(t => !t)} title={table ? 'Xem biểu đồ' : 'Xem số từng tháng dạng bảng'}>
          {table ? <BarChart3 size={13} /> : <Table2 size={13} />} {table ? 'Biểu đồ' : 'Bảng'}
        </button>
      </div>

      {spec.stats.length > 0 && (
        <dl className="vcc-chart-stats">
          {spec.stats.map(s => (
            <div key={s.label} title={s.hint || undefined}>
              <dt>{s.label}</dt>
              <dd data-unknown={s.value == null || undefined}>{fmt(s.value)}</dd>
              {s.hint && <span>{s.hint}</span>}
            </div>
          ))}
        </dl>
      )}

      {table ? (
        spec.panels.map(panel => (
          <div key={panel.title} className="vcc-chart-table">
            <table>
              <caption>{panel.title}{panel.unit ? ` (${panel.unit})` : ''}</caption>
              <thead><tr><th scope="col">Tháng</th>{panel.series.map(s => <th key={s.label} scope="col">{s.label}</th>)}</tr></thead>
              <tbody>
                {panelRows(spec, panel).map(row => (
                  <tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((v, i) => <td key={i}>{fmt(v)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      ) : (
        spec.panels.map(panel => <Panel key={panel.title} spec={spec} panel={panel} />)
      )}

      {spec.notes.map(note => <p key={note} className="vcc-cmd-warn"><TriangleAlert size={14} aria-hidden="true" /> {note}</p>)}

      {(spec.source || spec.link) && (
        <div className="vcc-chart-foot">
          {spec.source && <span className="vcc-cmd-note">{spec.source}</span>}
          {spec.link && onOpenRoute && (
            <button type="button" className="vcc-chip" onClick={() => onOpenRoute(spec.link!.route, spec.link!.label)}><ArrowUpRight size={12} /> {spec.link.label}</button>
          )}
        </div>
      )}
    </section>
  );
};

export default AssistantChartCard;
