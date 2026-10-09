import React, { useMemo } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ROUTES, axisMoney, drillMonth, money, monthLabel, monthTotals, shortMoney, type DrillDown } from '../../lib/dashboard/dashboardModel';
import type { DashProject, DashboardDataset } from '../../lib/dashboard/dashboardTypes';
import { Card, ChartTip, DataTable, Hero, Legend, type DashColors } from './dashUi';

// Bảng 3 — Báo cáo nhập / xuất vật tư: ngân sách vật tư (BOQ), đã mua, còn lại, xu hướng nhập – xuất kho 12 tháng,
// ngân sách theo dự án, 10 vật tư ngân sách lớn nhất, nhu cầu mua – cấp vật tư đang chờ.

type Props = { dataset: DashboardDataset; projects: DashProject[]; colors: DashColors; onDrill: (drill: DrillDown) => void; onOpen: (route: string) => void };

const sumMaterials = (projects: DashProject[], pick: (m: NonNullable<DashProject['materials']>) => number | null): number | null => {
  const visible = projects.filter(project => project.materials);
  if (!visible.length) return null;
  return visible.reduce((sum, project) => sum + (pick(project.materials!) ?? 0), 0);
};

const byProject = (title: string, projects: DashProject[], pick: (m: NonNullable<DashProject['materials']>) => number | null, through: DrillDown['through']): DrillDown => {
  const rows = projects.filter(project => project.materials).map(project => ({ project, value: pick(project.materials!) }))
    .filter(row => row.value != null && Math.abs(row.value) > 0.5).sort((a, b) => (b.value as number) - (a.value as number));
  return {
    title,
    columns: [{ key: 'project', label: 'Dự án' }, { key: 'value', label: 'Giá trị', kind: 'money' }],
    rows: rows.map(({ project, value }) => ({ id: project.id, route: ROUTES.project(project.id, 'material', { materialTab: 'boq' }), cells: { project: `${project.code} · ${project.name}`, value } })),
    total: { value: rows.reduce((sum, row) => sum + (row.value as number), 0) },
    through,
  };
};

const Spark: React.FC<{ data: number[]; color: string }> = ({ data, color }) => (
  <div className="vdb-spark" aria-hidden="true">
    <ResponsiveContainer>
      <AreaChart data={data.map((value, index) => ({ index, value }))} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.12} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);

const MaterialsDashboard: React.FC<Props> = ({ dataset, projects, colors, onDrill, onOpen }) => {
  const ids = useMemo(() => new Set(projects.map(project => project.id)), [projects]);
  const months = useMemo(() => monthTotals(dataset, ids), [dataset, ids]);
  const budget = sumMaterials(projects, m => m.budget);
  const purchased = sumMaterials(projects, m => m.purchased);
  // Dòng sổ kho chưa có giá trị được máy chủ ước tính theo đơn giá — ghi rõ để không nhầm là số chứng từ.
  const estimated = sumMaterials(projects, m => m.estimated) ?? 0;
  const remaining = budget != null && purchased != null ? budget - purchased : null;
  const totalIn = months.reduce((sum, row) => sum + row.matIn, 0);
  const totalOut = months.reduce((sum, row) => sum + row.matOut, 0);
  const procurement = { label: 'Mở Mua hàng', route: ROUTES.procurement };
  const inventory = { label: 'Mở Tồn kho', route: ROUTES.inventory };
  // Còn lại theo thời gian: ngân sách − lũy kế nhập (gần đúng cho đường xu hướng nhỏ).
  let cumulative = 0;
  const remainingTrend = months.map(row => { cumulative += row.matIn; return Math.max(0, (budget ?? 0) - (purchased ?? 0) + (totalIn - cumulative)); });
  const pie = projects.filter(project => (project.materials?.budget ?? 0) > 0.5)
    .map(project => ({ id: project.id, name: project.name, code: project.code, value: project.materials!.budget as number }))
    .sort((a, b) => b.value - a.value);
  const pieShown = pie.slice(0, 5);
  const pieOther = pie.slice(5).reduce((sum, item) => sum + item.value, 0);
  const pieData = pieOther > 0 ? [...pieShown, { id: 'other', name: 'Dự án khác', code: 'Khác', value: pieOther }] : pieShown;
  const top = dataset.materialItems.filter(item => ids.has(item.projectId)).sort((a, b) => b.budget - a.budget).slice(0, 10);
  const topMax = Math.max(1, ...top.map(item => item.budget));
  const needs = dataset.needs.filter(need => ids.has(need.projectId))
    .sort((a, b) => (a.neededDate || '9999').localeCompare(b.neededDate || '9999'));
  const projectName = new Map(projects.map(project => [project.id, project]));

  return (
    <div className="vdb-grid">
      <div className="vdb-col-3">
        <Hero columns={1} metrics={[{ label: 'Ngân sách vật tư', value: shortMoney(budget), onClick: () => onDrill(byProject('Ngân sách vật tư (BOQ) theo dự án', projects, m => m.budget, procurement)) }]}
          note={budget != null ? `${money(budget)} VNĐ` : 'Chưa có dự toán vật tư'} />
      </div>
      <div className="vdb-col-3 grid gap-3">
        <button type="button" className="vdb-tile" data-tone="violet" onClick={() => onDrill(byProject('Vật tư đã mua theo dự án', projects, m => m.purchased, procurement))}>
          <span className="min-w-0 flex-1">
            <span className="vdb-tile-l block">Đã mua</span>
            <span className="vdb-tile-v block">{shortMoney(purchased)}</span>
            <Spark data={months.map(row => row.matIn)} color={colors.category.machinery} />
          </span>
        </button>
        <button type="button" className="vdb-tile" data-tone="green" onClick={() => onDrill(byProject('Ngân sách vật tư còn lại theo dự án', projects, m => (m.budget ?? 0) - m.purchased, procurement))}>
          <span className="min-w-0 flex-1">
            <span className="vdb-tile-l block">Còn lại</span>
            <span className="vdb-tile-v block">{shortMoney(remaining)}</span>
            <Spark data={remainingTrend} color={colors.thu} />
          </span>
        </button>
      </div>
      <Card className="vdb-col-6 vdb-wide" title="Xu hướng Nhập - Xuất" through={inventory}
        subtitle={`12 tháng gần nhất · giá trị nhập / xuất kho${estimated > 0.5 ? ` · gồm ${shortMoney(estimated)} ước tính theo đơn giá dự toán` : ''}`}
        table={<DataTable firstIsEntity={false} drill={{ columns: [{ key: 'm', label: 'Tháng' }, { key: 'i', label: 'Nhập', kind: 'money' }, { key: 'o', label: 'Xuất', kind: 'money' }],
          rows: months.map(row => ({ id: row.month, cells: { m: monthLabel(row.month), i: row.matIn, o: row.matOut } })) }} />}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <Legend items={[{ label: 'Nhập', color: colors.chi }, { label: 'Xuất', color: colors.thu }]} />
          <span className="text-xs">Nhập <b className="vdb-num">{shortMoney(totalIn)}</b> · Xuất <b className="vdb-num">{shortMoney(totalOut)}</b></span>
        </div>
        <div className="vdb-chart" style={{ height: 210 }}>
          <ResponsiveContainer>
            <BarChart data={months} margin={{ top: 10, right: 12, left: 4, bottom: 0 }} barGap={2}
              onClick={(state: { activeLabel?: string } | null) => { if (state?.activeLabel) onDrill(drillMonth(dataset, projects, state.activeLabel, [{ key: 'matIn', label: 'Nhập' }, { key: 'matOut', label: 'Xuất' }], inventory)); }}>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fill: colors.axis }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={axisMoney} tick={{ fontSize: 11, fill: colors.axis }} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTip labelFormat={monthLabel} />} cursor={{ fill: colors.grid }} />
              <Bar dataKey="matIn" name="Nhập" fill={colors.chi} radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="matOut" name="Xuất" fill={colors.thu} radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="vdb-col-6" title="Ngân sách vật tư" subtitle={`Theo dự án · Tổng: ${shortMoney(budget)}`} through={procurement}
        table={<DataTable onRow={onOpen} drill={{ columns: [{ key: 'p', label: 'Dự án' }, { key: 'v', label: 'Ngân sách vật tư', kind: 'money' }],
          rows: pie.map(item => ({ id: item.id, route: ROUTES.project(item.id, 'material', { materialTab: 'boq' }), cells: { p: item.name, v: item.value } })) }} />}>
        <div className="vdb-chart" style={{ height: 270 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" outerRadius="66%" stroke={colors.surface} strokeWidth={2} isAnimationActive={false}
                label={({ code, value }: { code: string; value: number }) => `${code}: ${shortMoney(value)}`} labelLine={{ stroke: colors.axis }} style={{ fontSize: 11 }}
                onClick={(slice: { id?: string; payload?: { id: string } }) => { const id = slice.id || slice.payload?.id; if (id && id !== 'other') onOpen(ROUTES.project(id, 'material', { materialTab: 'boq' })); }}>
                {pieData.map((item, index) => <Cell key={item.id} fill={item.id === 'other' ? colors.category.other : colors.series[index % colors.series.length]} />)}
              </Pie>
              <Tooltip formatter={(value: number, name: string) => [`${money(value)} VNĐ`, name]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <Legend items={pieData.map((item, index) => ({ label: item.name, color: item.id === 'other' ? colors.category.other : colors.series[index % colors.series.length], value: shortMoney(item.value) }))} />
      </Card>

      <Card className="vdb-col-6" title="Top 10 vật tư có ngân sách cao nhất" through={procurement}>
        <div className="vdb-top">
          {top.length === 0 && <p className="vdb-muted m-0">Chưa có dự toán vật tư.</p>}
          {top.map((item, index) => (
            <button key={item.id} type="button" className="vdb-top-row" onClick={() => onOpen(ROUTES.project(item.projectId, 'material', { materialTab: 'boq' }))}
              title={`Đã mua ${money(item.purchased)} · còn lại ${money(item.budget - item.purchased)} VNĐ — bấm để mở BOQ vật tư`}>
              <span className="t">{index + 1} | {item.name} | <b>{shortMoney(item.budget)}</b> <span className="vdb-muted">· {projectName.get(item.projectId)?.code}</span></span>
              <span className="track" style={{ width: `${Math.max(6, (item.budget / topMax) * 100)}%` }}>
                <span style={{ flex: item.purchased, background: colors.chi }} />
                <span style={{ flex: Math.max(0, item.budget - item.purchased), background: colors.remaining }} />
              </span>
            </button>
          ))}
          <Legend items={[{ label: 'Đã mua', color: colors.chi }, { label: 'Còn lại', color: colors.remaining }]} />
        </div>
      </Card>

      <Card className="vdb-col-12" title="Nhu cầu mua - cấp vật tư" subtitle="Đề xuất vật tư đang chờ, ngày cần sớm nhất lên trước" through={procurement}>
        <DataTable onRow={onOpen} drill={{
          columns: [{ key: 't', label: 'Tên đề xuất' }, { key: 'k', label: 'Loại đề xuất' }, { key: 'm', label: 'Tên vật liệu' }, { key: 'u', label: 'Đơn vị' },
            { key: 'q', label: 'Khối lượng', kind: 'number' }, { key: 'd', label: 'Ngày cần vật liệu', kind: 'date' }],
          rows: needs.map(need => ({ id: need.id, route: ROUTES.materialRequest(need.projectId, need.requestId),
            cells: { t: `${need.title}`, k: need.kind === 'buy' ? 'Mua vật tư' : 'Cấp vật tư', m: need.material, u: need.unit, q: need.qty, d: need.neededDate } })),
        }} />
        {needs.length > 0 && <p className="m-0 mt-2 text-xs vdb-muted">{needs.length} dòng · bấm một dòng để mở đề xuất</p>}
      </Card>
    </div>
  );
};

export default MaterialsDashboard;
