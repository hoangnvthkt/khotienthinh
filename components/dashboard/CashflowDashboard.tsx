import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Building2, ClipboardCheck, FilePlus2, Flame, HardHat } from 'lucide-react';
import {
  CATEGORY_LABEL, CATEGORY_ORDER, HEALTH_LABEL, ROUTES, axisMoney, costByCategory, drillByProject, drillMonth, monthLabel, monthTotals, projectHealth,
  recordCount, shortMoney, sumFinance, type DrillDown,
} from '../../lib/dashboard/dashboardModel';
import type { CostCategory, DashProject, DashProjectFinance, DashboardDataset } from '../../lib/dashboard/dashboardTypes';
import { Card, ChartTip, DataTable, DebtEmpty, Hero, Legend, NoData, Tile, type DashColors } from './dashUi';

// Bảng 2 — Tổng quan dòng tiền, chi phí dự án (12 tháng gần nhất). Bấm số → bảng theo dự án; bấm tháng → tháng đó theo dự án;
// bấm lát bánh / cột → nhóm chi phí đó theo dự án; "…" → xem bảng số liệu hoặc mở màn Tài chính gốc.

type Props = { dataset: DashboardDataset; projects: DashProject[]; colors: DashColors; onDrill: (drill: DrillDown) => void; onOpen: (route: string) => void };

const healthDrill = (title: string, projects: DashProject[], today: string, keep: (health: ReturnType<typeof projectHealth>) => boolean): DrillDown => {
  const rows = projects.map(project => ({ project, health: projectHealth(project, today) })).filter(row => keep(row.health));
  return {
    title,
    columns: [{ key: 'project', label: 'Dự án' }, { key: 'health', label: 'Tình trạng' }, { key: 'planned', label: 'Kế hoạch', kind: 'pct' }, { key: 'actual', label: 'Thực tế', kind: 'pct' }],
    rows: rows.map(({ project, health }) => ({
      id: project.id, route: ROUTES.project(project.id, 'gantt'),
      cells: { project: `${project.code} · ${project.name}`, health: HEALTH_LABEL[health], planned: project.plannedProgress, actual: project.actualProgress },
    })),
    through: { label: 'Mở Đa dự án', route: ROUTES.portfolio },
  };
};

const CashflowDashboard: React.FC<Props> = ({ dataset, projects, colors, onDrill, onOpen }) => {
  // Tháng: chỉ cộng dự án được xem tiền.
  const ids = useMemo(() => new Set(projects.filter(project => project.finance).map(project => project.id)), [projects]);
  const months = useMemo(() => monthTotals(dataset, ids), [dataset, ids]);
  const categories = useMemo(() => costByCategory(projects), [projects]);
  const [debtView, setDebtView] = useState<'ar' | 'ap'>('ar');
  const today = dataset.today;
  const revenue = sumFinance(projects, finance => finance.accepted);
  const cost = sumFinance(projects, finance => finance.cost);
  const profit = revenue != null && cost != null ? revenue - cost : null;
  const healths = projects.map(project => projectHealth(project, today));
  const reports = { label: 'Mở Báo cáo tài chính', route: ROUTES.reports };
  const monthTip = (key: 'revenue' | 'cashIn') => (data: { activeLabel?: string } | null) => {
    const month = data?.activeLabel;
    if (!month) return;
    onDrill(key === 'revenue'
      ? drillMonth(dataset, projects, month, [{ key: 'revenue', label: 'Doanh thu' }, { key: 'cost', label: 'Chi phí' }], reports)
      : drillMonth(dataset, projects, month, [{ key: 'cashIn', label: 'Giá trị thu' }, { key: 'cashOut', label: 'Giá trị chi' }], { label: 'Mở Thu chi & quỹ', route: ROUTES.cash }));
  };
  const categoryDrill = (category: CostCategory) => onDrill(drillByProject(CATEGORY_LABEL[category], projects, finance => finance.costByCategory[category] ?? null,
    { subtitle: 'Chi phí thực tế theo dự án', through: { label: 'Mở Chi phí & ngân sách', route: ROUTES.cost } }));

  // Chưa nhập chứng từ nào → "Chưa có dữ liệu", không vẽ 0.
  const noAr = recordCount(projects, 'arRounds') === 0;
  const noAp = recordCount(projects, 'apDocs') === 0;
  const noIn = recordCount(projects, 'receipts') === 0;
  const noOut = recordCount(projects, 'payments') === 0;
  const pick = (empty: boolean, pickOne: (f: DashProjectFinance) => number | null) => (empty ? null : sumFinance(projects, pickOne));
  const ar = {
    requested: pick(noAr, f => f.ar.requested), retention: pick(noAr, f => f.ar.retention), advance: pick(noAr, f => f.ar.advance),
    outstanding: pick(noAr, f => f.ar.outstanding),
  };
  const ap = {
    requested: pick(noAp, f => f.ap.requested), retention: pick(noAp, f => f.ap.retention), advance: pick(noAp, f => f.ap.advance),
    outstanding: pick(noAp, f => f.ap.outstanding),
  };
  const debtRows = projects.filter(project => project.finance)
    .map(project => ({ project, debt: debtView === 'ar' ? project.finance!.ar.outstanding : project.finance!.ap.outstanding }))
    .filter(row => row.debt > 0.5).sort((a, b) => b.debt - a.debt).slice(0, 8);
  const stacked = projects.filter(project => project.finance && project.finance.cost > 0.5)
    .sort((a, b) => b.finance!.cost - a.finance!.cost).slice(0, 8)
    .map(project => ({ id: project.id, name: project.code, full: project.name, ...project.finance!.costByCategory }));
  const usedCategories = CATEGORY_ORDER.filter(category => stacked.some(row => (row as Record<string, unknown>)[category]));

  return (
    <div className="vdb-grid">
      <div className="vdb-col-5">
        <p className="vdb-group-l">Tổng quan</p>
        <Hero metrics={[
          { label: 'Giá trị hợp đồng', value: shortMoney(sumFinance(projects, f => f.contractValue)), onClick: () => onDrill(drillByProject('Giá trị hợp đồng theo dự án', projects, f => f.contractValue, { through: reports })) },
          { label: 'Doanh thu', value: shortMoney(revenue), size: 'sm', onClick: () => onDrill(drillByProject('Doanh thu (nghiệm thu, chưa VAT) theo dự án', projects, f => f.accepted, { through: reports })) },
          { label: 'Lợi nhuận', value: shortMoney(profit), tone: profit != null && profit < 0 ? 'bad' : 'good', title: 'Doanh thu nghiệm thu − chi phí đã ghi nhận',
            onClick: () => onDrill(drillByProject('Lợi nhuận theo dự án', projects, f => f.accepted - f.cost, { subtitle: 'Doanh thu nghiệm thu − chi phí đã ghi nhận', through: reports })) },
          { label: 'Chi phí', value: shortMoney(cost), size: 'sm', onClick: () => onDrill(drillByProject('Chi phí theo dự án', projects, f => f.cost, { through: { label: 'Mở Chi phí & ngân sách', route: ROUTES.cost } })) },
        ]} />
      </div>
      <div className="vdb-col-7">
        <p className="vdb-group-l">Tình trạng thi công</p>
        <div className="vdb-tiles">
          <Tile icon={Building2} tone="blue" label="Tổng số dự án" value={`${projects.length} dự án`}
            onClick={() => onDrill(healthDrill('Các dự án', projects, today, () => true))} />
          <Tile icon={Flame} tone="rose" label="Rủi ro" value={`${healths.filter(h => h === 'risk').length} dự án`}
            onClick={() => onDrill(healthDrill('Dự án rủi ro (chi phí vượt ngân sách / sản lượng)', projects, today, h => h === 'risk'))} />
          <Tile icon={AlertTriangle} tone="amber" label="Chậm tiến độ" value={`${healths.filter(h => h === 'late' || h === 'overdue').length} dự án`}
            onClick={() => onDrill(healthDrill('Dự án chậm / quá hạn', projects, today, h => h === 'late' || h === 'overdue'))} />
        </div>
        <p className="vdb-group-l mt-3">Kết quả thực hiện</p>
        <div className="vdb-tiles">
          <Tile icon={FilePlus2} tone="violet" label="Phát sinh" value={shortMoney(sumFinance(projects, f => f.variation))}
            onClick={() => onDrill(drillByProject('Phát sinh (phụ lục hợp đồng) theo dự án', projects, f => f.variation, { through: reports }))} />
          <Tile icon={HardHat} tone="green" label="Sản lượng thực hiện" value={shortMoney(sumFinance(projects, f => f.output))}
            onClick={() => onDrill(drillByProject('Sản lượng thực hiện theo dự án', projects, f => f.output, { subtitle: 'Giá trị hợp đồng × tiến độ thực tế', through: reports }))} />
          <Tile icon={ClipboardCheck} tone="teal" label="Sản lượng nghiệm thu" value={shortMoney(revenue)}
            onClick={() => onDrill(drillByProject('Sản lượng nghiệm thu theo dự án', projects, f => f.accepted, { through: { label: 'Mở Phải thu', route: ROUTES.receivables } }))} />
        </div>
      </div>

      <Card className="vdb-col-6" title="Doanh thu - Chi phí" subtitle="12 tháng gần nhất" through={reports}
        table={<DataTable firstIsEntity={false} drill={{ columns: [{ key: 'm', label: 'Tháng' }, { key: 'r', label: 'Doanh thu', kind: 'money' }, { key: 'c', label: 'Chi phí', kind: 'money' }],
          rows: months.map(row => ({ id: row.month, cells: { m: monthLabel(row.month), r: row.revenue, c: row.cost } })) }} />}>
        <Legend items={[{ label: 'Doanh thu', color: colors.thu, line: true }, { label: 'Chi phí', color: colors.chi, line: true }]} />
        <div className="vdb-chart">
          <ResponsiveContainer>
            <LineChart data={months} margin={{ top: 10, right: 12, left: 4, bottom: 0 }} onClick={monthTip('revenue')}>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fill: colors.axis }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={axisMoney} tick={{ fontSize: 11, fill: colors.axis }} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTip labelFormat={monthLabel} />} />
              <Line type="monotone" dataKey="revenue" name="Doanh thu" stroke={colors.thu} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: colors.surface }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="cost" name="Chi phí" stroke={colors.chi} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: colors.surface }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="vdb-col-6" title="Dòng tiền" subtitle="12 tháng gần nhất" through={{ label: 'Mở Thu chi & quỹ', route: ROUTES.cash }}
        table={<DataTable firstIsEntity={false} drill={{ columns: [{ key: 'm', label: 'Tháng' }, { key: 'i', label: 'Giá trị thu', kind: 'money' }, { key: 'o', label: 'Giá trị chi', kind: 'money' }],
          rows: months.map(row => ({ id: row.month, cells: { m: monthLabel(row.month), i: row.cashIn, o: row.cashOut } })) }} />}>
        <Legend items={[{ label: 'Giá trị thu', color: colors.thu }, { label: 'Giá trị chi', color: colors.chi }]} />
        {noIn && noOut ? <NoData>Chưa có tiền thu, tiền chi ghi qua Tài chính trong 12 tháng (Phải thu, Phải trả).</NoData> : (
        <div className="vdb-chart">
          <ResponsiveContainer>
            <BarChart data={months} margin={{ top: 10, right: 12, left: 4, bottom: 0 }} barGap={2} onClick={monthTip('cashIn')}>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fill: colors.axis }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={axisMoney} tick={{ fontSize: 11, fill: colors.axis }} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTip labelFormat={monthLabel} />} cursor={{ fill: colors.grid }} />
              <Bar dataKey="cashIn" name="Giá trị thu" fill={colors.thu} radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="cashOut" name="Giá trị chi" fill={colors.chi} radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        )}
        {noIn !== noOut && (
          <p className="vdb-nodata">{noOut ? 'Chưa có đợt chi NCC, thầu phụ ghi qua Tài chính — cột "Giá trị chi" đang trống.'
            : 'Chưa có tiền chủ đầu tư trả ghi qua Tài chính — cột "Giá trị thu" đang trống.'}</p>
        )}
      </Card>

      <section className="vdb-debt vdb-col-3" data-tone="green" aria-label="Công nợ chủ đầu tư">
        <p className="vdb-group-l m-0">Công nợ CĐT <span className="vdb-muted text-xs font-normal">· gồm VAT</span></p>
        {noAr ? <DebtEmpty>Chưa nhập đợt phải thu CĐT (Tài chính → Phải thu).</DebtEmpty> : (
        <button type="button" className="vdb-debt-total vdb-link block w-full" onClick={() => onDrill(drillByProject('Chủ đầu tư còn nợ theo dự án', projects, f => f.ar.outstanding, { through: { label: 'Mở Phải thu', route: ROUTES.receivables } }))}>
          {shortMoney(ar.outstanding)}
        </button>
        )}
        <button type="button" className="vdb-debt-row" onClick={() => onDrill(drillByProject('Đề nghị thanh toán đã gửi CĐT', projects, f => f.ar.requested, { through: { label: 'Mở Phải thu', route: ROUTES.receivables } }))}>
          <span>1. Đề nghị thanh toán</span><b className="vdb-num">{shortMoney(ar.requested)}</b></button>
        <button type="button" className="vdb-debt-row" onClick={() => onDrill(drillByProject('Giá trị CĐT giữ lại (bảo hành)', projects, f => f.ar.retention, { through: { label: 'Mở Phải thu', route: ROUTES.receivables } }))}>
          <span>2. Giá trị giữ lại</span><b className="vdb-num">{shortMoney(ar.retention)}</b></button>
        <button type="button" className="vdb-debt-row" onClick={() => onDrill(drillByProject('Tạm ứng CĐT còn phải khấu trừ', projects, f => f.ar.advance, { through: { label: 'Mở Phải thu', route: ROUTES.receivables } }))}>
          <span>3. Tạm ứng</span><b className="vdb-num">{shortMoney(ar.advance)}</b></button>
      </section>
      <section className="vdb-debt vdb-col-3" data-tone="rose" aria-label="Công nợ nhà thầu và nhà cung cấp">
        <p className="vdb-group-l m-0">Công nợ Nhà thầu và NCC <span className="vdb-muted text-xs font-normal">· gồm VAT</span></p>
        {noAp ? <DebtEmpty>Chưa có chứng từ công nợ NCC, thầu phụ (Tài chính → Phải trả).</DebtEmpty> : (
        <button type="button" className="vdb-debt-total vdb-link block w-full" onClick={() => onDrill(drillByProject('Còn phải trả nhà thầu, NCC theo dự án', projects, f => f.ap.outstanding, { through: { label: 'Mở Phải trả', route: ROUTES.payables } }))}>
          {shortMoney(ap.outstanding)}
        </button>
        )}
        <button type="button" className="vdb-debt-row" onClick={() => onDrill(drillByProject('Đề nghị thanh toán của nhà thầu, NCC', projects, f => f.ap.requested, { through: { label: 'Mở Phải trả', route: ROUTES.payables } }))}>
          <span>1. Đề nghị thanh toán</span><b className="vdb-num">{shortMoney(ap.requested)}</b></button>
        <button type="button" className="vdb-debt-row" onClick={() => onDrill(drillByProject('Giá trị giữ lại thầu phụ', projects, f => f.ap.retention, { through: { label: 'Mở Thầu phụ', route: ROUTES.subcontracts } }))}>
          <span>2. Giá trị giữ lại</span><b className="vdb-num">{shortMoney(ap.retention)}</b></button>
        <button type="button" className="vdb-debt-row" onClick={() => onDrill(drillByProject('Tạm ứng nhà thầu, NCC chưa khấu trừ', projects, f => f.ap.advance, { through: { label: 'Mở Phải trả', route: ROUTES.payables } }))}>
          <span>3. Tạm ứng</span><b className="vdb-num">{shortMoney(ap.advance)}</b></button>
      </section>
      <Card className="vdb-col-6 vdb-wide" title="Danh sách dự án có công nợ lớn"
        aside={(
          <div className="vdb-switch ml-auto" role="tablist" aria-label="Loại công nợ">
            <button type="button" role="tab" aria-selected={debtView === 'ar'} onClick={() => setDebtView('ar')}>Chưa thu</button>
            <button type="button" role="tab" aria-selected={debtView === 'ap'} onClick={() => setDebtView('ap')}>Chưa trả</button>
          </div>
        )}>
        {(debtView === 'ar' ? noAr : noAp) ? <NoData>{debtView === 'ar' ? 'Chưa nhập đợt phải thu CĐT.' : 'Chưa có chứng từ công nợ NCC, thầu phụ.'}</NoData> : (
        <DataTable onRow={onOpen} drill={{
          columns: [{ key: 'p', label: 'Dự án' }, { key: 'v', label: 'Giá trị hợp đồng', kind: 'money' }, { key: 'r', label: 'Đề nghị thanh toán', kind: 'money' },
            { key: 'k', label: 'Giá trị giữ lại', kind: 'money' }, { key: 'd', label: debtView === 'ar' ? 'CĐT còn nợ' : 'Còn phải trả', kind: 'money' }],
          rows: debtRows.map(({ project, debt }) => ({
            id: project.id, route: debtView === 'ar' ? ROUTES.projectFinance(project.id) : ROUTES.payables,
            cells: { p: project.name, v: project.finance!.contractValue, r: debtView === 'ar' ? project.finance!.ar.requested : project.finance!.ap.requested,
              k: debtView === 'ar' ? project.finance!.ar.retention : project.finance!.ap.retention, d: debt },
          })),
        }} />
        )}
      </Card>

      <Card className="vdb-col-6" title="Chi phí thực tế" subtitle={`Tổng: ${shortMoney(cost)}`} through={{ label: 'Mở Chi phí & ngân sách', route: ROUTES.cost }}
        table={<DataTable firstIsEntity={false} drill={{ columns: [{ key: 'c', label: 'Nhóm chi phí' }, { key: 'v', label: 'Giá trị', kind: 'money' }],
          rows: categories.map(item => ({ id: item.category, cells: { c: CATEGORY_LABEL[item.category], v: item.value } })) }} />}>
        <div className="vdb-chart" style={{ height: 260 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={categories} dataKey="value" nameKey="category" innerRadius={0} outerRadius="66%" stroke={colors.surface} strokeWidth={2} isAnimationActive={false}
                label={({ category, value }: { category: CostCategory; value: number }) => `${CATEGORY_LABEL[category]}: ${shortMoney(value)}`}
                labelLine={{ stroke: colors.axis }} style={{ fontSize: 11 }}
                onClick={(slice: { category?: CostCategory; payload?: { category: CostCategory } }) => categoryDrill((slice.category || slice.payload?.category) as CostCategory)}>
                {categories.map(item => <Cell key={item.category} fill={colors.category[item.category]} />)}
              </Pie>
              <Tooltip formatter={(value: number, _name, item: { payload?: { category: CostCategory } }) => [`${shortMoney(value)}`, CATEGORY_LABEL[item.payload?.category as CostCategory]]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <Legend items={categories.map(item => ({ label: CATEGORY_LABEL[item.category].replace('Chi phí ', ''), color: colors.category[item.category], value: shortMoney(item.value) }))} />
      </Card>

      <Card className="vdb-col-6" title="Phân bổ chi phí theo dự án" subtitle="Lũy kế · 8 dự án chi nhiều nhất" through={{ label: 'Mở Chi phí & ngân sách', route: ROUTES.cost }}
        table={<DataTable firstIsEntity drill={{ columns: [{ key: 'p', label: 'Dự án' }, ...usedCategories.map(category => ({ key: category, label: CATEGORY_LABEL[category], kind: 'money' as const }))],
          rows: stacked.map(row => ({ id: row.id, route: ROUTES.projectFinance(row.id), cells: { p: row.full, ...Object.fromEntries(usedCategories.map(category => [category, (row as Record<string, unknown>)[category] as number ?? null])) } })) }} onRow={onOpen} />}>
        <Legend items={usedCategories.map(category => ({ label: CATEGORY_LABEL[category].replace('Chi phí ', ''), color: colors.category[category] }))} />
        <div className="vdb-chart" style={{ height: 250 }}>
          <ResponsiveContainer>
            <BarChart data={stacked} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}
              onClick={(state: { activePayload?: Array<{ payload: { id: string } }> } | null) => { const id = state?.activePayload?.[0]?.payload.id; if (id) onOpen(ROUTES.projectFinance(id)); }}>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: colors.axis }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={axisMoney} tick={{ fontSize: 11, fill: colors.axis }} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTip hint="Bấm để mở Tài chính dự án" />} cursor={{ fill: colors.grid }} />
              {usedCategories.map((category, index) => (
                <Bar key={category} dataKey={category} name={CATEGORY_LABEL[category]} stackId="c" fill={colors.category[category]} stroke={colors.surface} strokeWidth={1}
                  radius={index === usedCategories.length - 1 ? [4, 4, 0, 0] : undefined} maxBarSize={36} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
};

export default CashflowDashboard;
