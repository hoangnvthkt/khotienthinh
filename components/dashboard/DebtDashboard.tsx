import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceLine, ResponsiveContainer, Sankey, Tooltip, XAxis, YAxis } from 'recharts';
import {
  CATEGORY_LABEL, ROUTES, axisMoney, costByCategory, drillByProject, drillMonth, money, monthLabel, monthTotals, recordCount, shortMoney, sumFinance, type DrillDown,
} from '../../lib/dashboard/dashboardModel';
import type { DashDocQuery, DashProject, DashProjectFinance, DashboardDataset } from '../../lib/dashboard/dashboardTypes';
import { Card, DataTable, DebtEmpty, Hero, Legend, NoData, type DashColors } from './dashUi';

// Bảng 4 — Báo cáo thu / chi, công nợ. Dòng thu: giá trị HĐ → chưa thực hiện / doanh thu nghiệm thu → đã thu, CĐT còn nợ,
// giữ lại, khấu trừ tạm ứng. Dòng chi: nhóm chi phí → chi phí thực tế → đã trả / còn phải trả. Bấm mọi khối để xem theo dự án.

type Props = { dataset: DashboardDataset; projects: DashProject[]; colors: DashColors; onDrill: (drill: DrillDown) => void; onOpen: (route: string) => void };

/** Sơ đồ dòng thu theo doanh thu chưa VAT: máy chủ tách từng đợt nghiệm thu thành đã thu / còn nợ / giữ lại / khấu trừ tạm ứng. */
const paidOfRevenue = (f: DashProjectFinance) => f.ar.flow.paid;
/** Sơ đồ dòng chi: phần chi phí không còn nợ = chi phí ghi nhận − còn phải trả (công nợ gồm VAT, không vượt chi phí). */
const costSettled = (f: DashProjectFinance) => Math.max(0, f.cost - f.ap.outstanding);
/** Chứng từ của từng con số (bấm dự án trong ngăn → chứng từ; chỉ số ghép có nhiều loại). */
const DEBT_DOCS: Record<string, DashDocQuery[]> = {
  'Giá trị hợp đồng theo dự án': [{ label: 'Hợp đồng & phát sinh', metric: 'contract' }],
  'Giá trị hợp đồng chưa nghiệm thu': [{ label: 'Hợp đồng & phát sinh', metric: 'contract' }, { label: 'Đợt nghiệm thu', metric: 'accepted' }],
  'Doanh thu nghiệm thu theo dự án': [{ label: 'Đợt nghiệm thu', metric: 'accepted' }],
  'Doanh thu CĐT đã thanh toán': [{ label: 'Tiền đã thu (gồm VAT)', metric: 'received' }],
  'Doanh thu CĐT còn nợ (chưa VAT)': [{ label: 'Đợt còn nợ (gồm VAT)', metric: 'ar_outstanding' }],
  'Doanh thu CĐT giữ lại (chưa VAT)': [{ label: 'Giữ lại theo hợp đồng (gồm VAT)', metric: 'ar_retention' }],
  'Doanh thu đã khấu trừ tạm ứng (chưa VAT)': [{ label: 'Tạm ứng đã khấu trừ (gồm VAT)', metric: 'ar_recovered' }],
  'Chi phí thực tế theo dự án': [{ label: 'Chi phí', metric: 'cost' }],
  'Chi phí không còn nợ theo dự án': [{ label: 'Chi phí', metric: 'cost' }, { label: 'Còn phải trả', metric: 'ap_outstanding' }],
  'Còn phải trả theo dự án': [{ label: 'Chứng từ còn nợ', metric: 'ap_outstanding' }],
  'Chi phí theo dự án': [{ label: 'Chi phí', metric: 'cost' }],
  'Lợi nhuận theo dự án': [{ label: 'Doanh thu', metric: 'accepted' }, { label: 'Chi phí', metric: 'cost' }],
  'Tiền CĐT đã trả theo dự án': [{ label: 'Tiền đã thu', metric: 'received' }],
  'Đề nghị thanh toán đã gửi CĐT': [{ label: 'Đề nghị thanh toán', metric: 'ar_requested' }],
  'Giá trị CĐT giữ lại': [{ label: 'Giữ lại theo hợp đồng', metric: 'ar_retention' }],
  'Tạm ứng CĐT chưa khấu trừ': [{ label: 'Tạm ứng còn lại', metric: 'ar_advance' }],
  'Tạm ứng CĐT đã khấu trừ': [{ label: 'Tạm ứng đã khấu trừ', metric: 'ar_recovered' }],
  'CĐT còn nợ theo dự án': [{ label: 'Đợt còn nợ', metric: 'ar_outstanding' }],
  'Phải thu quá hạn theo dự án': [{ label: 'Đợt quá hạn', metric: 'ar_overdue' }],
  'Phải thu trong hạn theo dự án': [{ label: 'Đợt còn nợ (gồm quá hạn)', metric: 'ar_outstanding' }],
  'Phải trả quá hạn theo dự án': [{ label: 'Chứng từ quá hạn', metric: 'ap_overdue' }],
  'Phải trả trong hạn theo dự án': [{ label: 'Chứng từ còn nợ (gồm quá hạn)', metric: 'ap_outstanding' }],
  'Chi thầu phụ theo dự án': [{ label: 'Công nợ thầu phụ', metric: 'sub_total' }, { label: 'Đã trả thầu phụ', metric: 'sub_paid' }],
  'Chi nhà cung cấp theo dự án': [{ label: 'Công nợ NCC', metric: 'sup_total' }, { label: 'Đã trả NCC', metric: 'sup_paid' }],
};

/** "Chi phí vật liệu" → "Vật liệu" (tiêu đề thẻ đã nói là chi phí). */
const groupName = (category: keyof typeof CATEGORY_LABEL) => { const name = CATEGORY_LABEL[category].replace('Chi phí ', ''); return name.charAt(0).toUpperCase() + name.slice(1); };

/** side: vị trí nhãn — cột đầu ghi bên phải, cột cuối bên trái, cột giữa ở trên nút (không đè nhãn hai bên). */
interface FlowNode { name: string; color: string; side: 'right' | 'left' | 'top' | 'bottom'; drill?: () => void }

const SankeyCard: React.FC<{ nodes: FlowNode[]; links: Array<{ source: number; target: number; value: number }>; colors: DashColors; height?: number }> = ({ nodes, links, colors, height = 270 }) => {
  // Khung hẹp (điện thoại): nhãn hai dòng tên / giá trị để không đè lên cột nút giữa.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = wrapRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 480));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const usable = links.filter(link => link.value > 0.5);
  if (!usable.length) return <p className="vdb-muted m-0 py-10 text-center">Chưa có số liệu.</p>;
  // Nút không còn liên kết nào thì vẫn giữ chỉ số (Sankey cần chỉ số liên tục) — nút trống không vẽ.
  const NodeShape = (props: { x: number; y: number; width: number; height: number; index: number; payload: { value: number } }) => {
    const node = nodes[props.index];
    if (!node || props.payload.value <= 0.5) return <g />;
    const top = node.side === 'top' || node.side === 'bottom';
    const x = top ? props.x + props.width / 2 : node.side === 'left' ? props.x - 6 : props.x + props.width + 6;
    const y = node.side === 'top' ? props.y - 8 : node.side === 'bottom' ? props.y + props.height + 14 : props.y + props.height / 2;
    const value = shortMoney(props.payload.value);
    return (
      <g style={{ cursor: node.drill ? 'pointer' : 'default' }} onClick={node.drill}>
        <rect x={props.x} y={props.y} width={props.width} height={Math.max(2, props.height)} fill={node.color} rx={2} />
        <text x={x} y={y} textAnchor={top ? 'middle' : node.side === 'left' ? 'end' : 'start'} dominantBaseline={top ? 'auto' : 'middle'}
          fontSize={11.5} fill={colors.text} paintOrder="stroke" stroke={colors.surface} strokeWidth={3} strokeLinejoin="round">
          {narrow ? (
            <>
              <tspan x={x} dy={node.side === 'top' ? '-1.2em' : top ? 0 : '-0.6em'}>{node.name}</tspan>
              <tspan x={x} dy="1.2em" fontWeight={700}>{value}</tspan>
            </>
          ) : <>{node.name} · <tspan fontWeight={700}>{value}</tspan></>}
        </text>
      </g>
    );
  };
  return (
    <div className="vdb-chart" style={{ height: narrow ? height + 60 : height }} ref={wrapRef}>
      <ResponsiveContainer>
        <Sankey data={{ nodes: nodes.map(node => ({ name: node.name })), links: usable }} nodeWidth={10} nodePadding={narrow ? 28 : 16}
          margin={{ top: narrow ? 36 : 22, right: 8, bottom: narrow ? 24 : 8, left: 8 }}
          node={NodeShape as never} link={{ stroke: colors.chi, strokeOpacity: 0.18 }} iterations={32}>
          <Tooltip formatter={(value: number) => `${money(value)} VNĐ`} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
};

const Gauge: React.FC<{ title: string; total: number | null; paid: number | null; colors: DashColors; onClick: () => void }> = ({ title, total, paid, colors, onClick }) => {
  const data = total != null && paid != null ? [{ v: paid }, { v: Math.max(0, total - paid) }] : [{ v: 1 }];
  return (
    <button type="button" className="vdb-gauge text-left" onClick={onClick} disabled={total == null} title="Bấm để xem theo dự án">
      <div>
        <div style={{ height: 70 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data} dataKey="v" startAngle={180} endAngle={0} cy="100%" innerRadius="125%" outerRadius="175%" stroke="none" isAnimationActive={false}>
                {data.map((_, index) => <Cell key={index} fill={index === 0 && total != null ? colors.category.machinery : colors.remaining} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="vdb-gauge-v" style={{ marginTop: 2 }}>{shortMoney(total)}</div>
      </div>
      <div className="text-xs">
        <div className="font-semibold mb-1">{title}</div>
        <div className="flex items-center gap-1.5"><i style={{ width: 8, height: 8, borderRadius: 4, background: colors.category.machinery, display: 'inline-block' }} />Đã trả</div>
        <div className="vdb-num mb-1 pl-3.5">{shortMoney(paid)}</div>
        <div className="flex items-center gap-1.5"><i style={{ width: 8, height: 8, borderRadius: 4, background: colors.remaining, display: 'inline-block' }} />Còn nợ</div>
        <div className="vdb-num pl-3.5">{total != null && paid != null ? shortMoney(total - paid) : '—'}</div>
      </div>
    </button>
  );
};

const Aging: React.FC<{ title: string; total: number | null; overdue: number | null; colors: DashColors; onOverdue: () => void; onInTerm: () => void }> = ({ title, total, overdue, colors, onOverdue, onInTerm }) => {
  const inTerm = total != null && overdue != null ? Math.max(0, total - overdue) : null;
  return (
    <div className="vdb-aging">
      <div className="vdb-aging-h"><span>{title}</span><span className="vdb-num">{shortMoney(total)}</span></div>
      <div className="vdb-aging-s"><span>{shortMoney(overdue)}</span><span>{shortMoney(inTerm)}</span></div>
      <div className="vdb-aging-bar">
        <button type="button" style={{ flex: overdue ?? 0, background: colors.danger }} onClick={onOverdue} aria-label={`${title} quá hạn ${shortMoney(overdue)}`} title="Quá hạn — bấm để xem" />
        <button type="button" style={{ flex: inTerm ?? 0, background: '#f6b5b0' }} onClick={onInTerm} aria-label={`${title} trong hạn ${shortMoney(inTerm)}`} title="Trong hạn — bấm để xem" />
      </div>
    </div>
  );
};

const DebtDashboard: React.FC<Props> = ({ dataset, projects, colors, onDrill, onOpen }) => {
  // Tháng: chỉ cộng dự án được xem tiền.
  const ids = useMemo(() => new Set(projects.filter(project => project.finance).map(project => project.id)), [projects]);
  const months = useMemo(() => monthTotals(dataset, ids), [dataset, ids]);
  const s = (pick: (f: DashProjectFinance) => number | null) => sumFinance(projects, pick);
  const contract = s(f => f.contractValue);
  const revenue = s(f => f.accepted);
  const cost = s(f => f.cost);
  const profit = revenue != null && cost != null ? revenue - cost : null;
  // Chưa nhập chứng từ nào → "Chưa có dữ liệu" ("—"), không vẽ 0.
  const noAr = recordCount(projects, 'arRounds') === 0;
  const noAp = recordCount(projects, 'apDocs') === 0;
  const noCash = recordCount(projects, 'receipts') === 0 && recordCount(projects, 'payments') === 0;
  const sAr = (pick: (f: DashProjectFinance) => number | null) => (noAr ? null : s(pick));
  const sAp = (pick: (f: DashProjectFinance) => number | null) => (noAp ? null : s(pick));
  const ar = { requested: sAr(f => f.ar.requested), retention: sAr(f => f.ar.retention), advance: sAr(f => f.ar.advance), outstanding: sAr(f => f.ar.outstanding),
    overdue: sAr(f => f.ar.overdue), recovered: sAr(f => f.ar.advanceRecovered), received: sAr(f => f.received),
    flow: { paid: s(paidOfRevenue), outstanding: s(f => f.ar.flow.outstanding), retention: s(f => f.ar.flow.retention), recovered: s(f => f.ar.flow.recovered) } };
  const ap = { outstanding: sAp(f => f.ap.outstanding), overdue: sAp(f => f.ap.overdue), sub: sAp(f => f.ap.subcontract.total), subPaid: sAp(f => f.ap.subcontract.paid),
    sup: sAp(f => f.ap.supplier.total), supPaid: sAp(f => f.ap.supplier.paid), paid: sAp(f => f.ap.paid), settled: sAp(costSettled) };
  const receivables = { label: 'Mở Phải thu', route: ROUTES.receivables };
  const payables = { label: 'Mở Phải trả', route: ROUTES.payables };
  const reports = { label: 'Mở Báo cáo tài chính', route: ROUTES.reports };
  const byP = (title: string, pick: (f: DashProjectFinance) => number | null, through: DrillDown['through'], subtitle?: string) =>
    () => onDrill(drillByProject(title, projects, pick, { through, subtitle, docs: DEBT_DOCS[title] }));

  // Dòng thu
  const inNodes: FlowNode[] = [
    { name: 'Tổng giá trị dự án', side: 'right', color: colors.chi, drill: byP('Giá trị hợp đồng theo dự án', f => f.contractValue, reports) },
    { name: 'Chưa thực hiện', side: 'left', color: colors.remaining, drill: byP('Giá trị hợp đồng chưa nghiệm thu', f => Math.max(0, (f.contractValue ?? 0) - f.accepted), reports) },
    { name: 'Tổng doanh thu', side: 'bottom', color: colors.thu, drill: byP('Doanh thu nghiệm thu theo dự án', f => f.accepted, receivables) },
    { name: 'Đã thanh toán', side: 'left', color: colors.thu, drill: byP('Doanh thu CĐT đã thanh toán', paidOfRevenue, receivables) },
    { name: 'Nợ phải thu', side: 'left', color: colors.danger, drill: byP('Doanh thu CĐT còn nợ (chưa VAT)', f => f.ar.flow.outstanding, receivables) },
    { name: 'Doanh thu giữ lại', side: 'left', color: colors.category.subcontract, drill: byP('Doanh thu CĐT giữ lại (chưa VAT)', f => f.ar.flow.retention, receivables) },
    { name: 'Khấu trừ tạm ứng', side: 'left', color: colors.category.machinery, drill: byP('Doanh thu đã khấu trừ tạm ứng (chưa VAT)', f => f.ar.flow.recovered, receivables) },
  ];
  const inLinks = [
    { source: 0, target: 1, value: Math.max(0, (contract ?? 0) - (revenue ?? 0)) },
    { source: 0, target: 2, value: revenue ?? 0 },
    { source: 2, target: 3, value: ar.flow.paid ?? 0 },
    { source: 2, target: 4, value: ar.flow.outstanding ?? 0 },
    { source: 2, target: 5, value: ar.flow.retention ?? 0 },
    { source: 2, target: 6, value: ar.flow.recovered ?? 0 },
  ];
  // Dòng chi
  const cats = costByCategory(projects);
  const outNodes: FlowNode[] = [
    ...cats.map(item => ({ name: groupName(item.category), side: 'right' as const, color: colors.category[item.category],
      drill: () => onDrill(drillByProject(CATEGORY_LABEL[item.category], projects, f => f.costByCategory[item.category] ?? null,
        { through: { label: 'Mở Chi phí & ngân sách', route: ROUTES.cost }, docs: [{ label: CATEGORY_LABEL[item.category], metric: 'cost', category: item.category }] })) })),
    { name: 'Chi phí thực tế', side: 'top', color: colors.chi, drill: byP('Chi phí thực tế theo dự án', f => f.cost, { label: 'Mở Chi phí & ngân sách', route: ROUTES.cost }) },
    { name: 'Đã trả', side: 'left', color: colors.thu, drill: byP('Chi phí không còn nợ theo dự án', costSettled, payables, 'Chi phí ghi nhận − còn phải trả') },
    { name: 'Còn phải trả', side: 'left', color: colors.danger, drill: byP('Còn phải trả theo dự án', f => f.ap.outstanding, payables) },
  ];
  const mid = cats.length;
  const outLinks = [
    ...cats.map((item, index) => ({ source: index, target: mid, value: item.value })),
    { source: mid, target: mid + 1, value: ap.settled ?? 0 },
    { source: mid, target: mid + 2, value: Math.min(ap.outstanding ?? 0, cost ?? 0) },
  ];
  // Dòng tiền dự án: thu dương, chi âm; đường lũy kế ròng (thu − chi) cùng thang với cột. Lũy kế thu / chi riêng ở bảng số liệu.
  let cumIn = 0;
  let cumOut = 0;
  const flow = months.map(row => {
    cumIn += row.cashIn; cumOut += row.cashOut;
    return { month: row.month, thu: row.cashIn, chi: -row.cashOut, lkThu: cumIn, lkChi: -cumOut, rong: cumIn - cumOut };
  });

  return (
    <div className="vdb-grid">
      <div className="vdb-col-3">
        <Hero columns={1} metrics={[
          { label: 'Giá trị hợp đồng (chưa VAT)', value: shortMoney(contract), onClick: byP('Giá trị hợp đồng theo dự án', f => f.contractValue, reports) },
        ]}>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="vdb-hero-m" onClick={byP('Doanh thu nghiệm thu theo dự án', f => f.accepted, reports)}>
              <div className="vdb-hero-l">Doanh thu</div><div className="vdb-hero-v" data-size="sm">{shortMoney(revenue)}</div></button>
            <button type="button" className="vdb-hero-m" onClick={byP('Chi phí theo dự án', f => f.cost, { label: 'Mở Chi phí & ngân sách', route: ROUTES.cost })}>
              <div className="vdb-hero-l">Chi phí</div><div className="vdb-hero-v" data-size="sm">{shortMoney(cost)}</div></button>
          </div>
          <button type="button" className="vdb-hero-m" onClick={byP('Lợi nhuận theo dự án', f => f.accepted - f.cost, reports, 'Doanh thu nghiệm thu − chi phí')}>
            <div className="vdb-hero-l">Lợi nhuận</div><div className="vdb-hero-v" data-size="sm" data-tone={profit != null && profit < 0 ? 'bad' : 'good'}>{shortMoney(profit)}</div></button>
        </Hero>
      </div>

      <section className="vdb-debt vdb-col-3" data-tone="green" aria-label="Cơ cấu dòng thu">
        <p className="vdb-group-l m-0">Cơ cấu dòng thu <span className="vdb-muted text-xs font-normal">· gồm VAT</span></p>
        {noAr ? <DebtEmpty>Chưa nhập đợt phải thu CĐT (Tài chính → Phải thu).</DebtEmpty>
          : <button type="button" className="vdb-debt-total vdb-link block w-full" onClick={byP('Tiền CĐT đã trả theo dự án', f => f.received, receivables)}>{shortMoney(ar.received)}</button>}
        <button type="button" className="vdb-debt-row" onClick={byP('Đề nghị thanh toán đã gửi CĐT', f => f.ar.requested, receivables)}><span>1. Đề nghị thanh toán</span><b className="vdb-num">{shortMoney(ar.requested)}</b></button>
        <button type="button" className="vdb-debt-row" onClick={byP('Giá trị CĐT giữ lại', f => f.ar.retention, receivables)}><span>2. Giá trị giữ lại</span><b className="vdb-num">{shortMoney(ar.retention)}</b></button>
        <button type="button" className="vdb-debt-row" onClick={byP('Tạm ứng CĐT chưa khấu trừ', f => f.ar.advance, receivables)}><span>3. Tạm ứng còn lại</span><b className="vdb-num">{shortMoney(ar.advance)}</b></button>
        <button type="button" className="vdb-debt-row" onClick={byP('Tạm ứng CĐT đã khấu trừ', f => f.ar.advanceRecovered, receivables)}><span>4. Tạm ứng đã khấu trừ</span><b className="vdb-num">{shortMoney(ar.recovered)}</b></button>
        <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2 text-center" style={{ borderColor: 'var(--db-line)' }}>
          <button type="button" className="vdb-link" onClick={byP('Tiền CĐT đã trả theo dự án', f => f.received, receivables)}>
            <b className="vdb-num block">{shortMoney(ar.received)}</b><span className="text-xs">Thu thực tế</span></button>
          <button type="button" className="vdb-link" style={{ color: colors.danger }} onClick={byP('CĐT còn nợ theo dự án', f => f.ar.outstanding, receivables)}>
            <b className="vdb-num block">{shortMoney(ar.outstanding)}</b><span className="text-xs">CĐT còn nợ</span></button>
        </div>
      </section>

      <Card className="vdb-col-6" title="Dòng thu" subtitle="Chưa VAT · giá trị hợp đồng → doanh thu → tiền về" through={receivables}>
        <SankeyCard nodes={inNodes} links={inLinks} colors={colors} />
        {noAr && <p className="vdb-nodata">Chưa nhập đợt phải thu CĐT — chưa tách doanh thu thành đã thu / còn nợ.</p>}
      </Card>

      <section className="vdb-card vdb-col-3" aria-label="Nợ phải thu, phải trả">
        <Aging title="Nợ phải thu" total={ar.outstanding} overdue={ar.overdue} colors={colors}
          onOverdue={byP('Phải thu quá hạn theo dự án', f => f.ar.overdue, receivables)} onInTerm={byP('Phải thu trong hạn theo dự án', f => Math.max(0, f.ar.outstanding - f.ar.overdue), receivables)} />
        <Aging title="Nợ phải trả" total={ap.outstanding} overdue={ap.overdue} colors={colors}
          onOverdue={byP('Phải trả quá hạn theo dự án', f => f.ap.overdue, payables)} onInTerm={byP('Phải trả trong hạn theo dự án', f => Math.max(0, f.ap.outstanding - f.ap.overdue), payables)} />
        <Legend items={[{ label: 'Quá hạn', color: colors.danger }, { label: 'Trong hạn', color: '#f6b5b0' }]} />
      </section>

      <section className="vdb-debt vdb-col-3" data-tone="rose" aria-label="Cơ cấu dòng chi">
        <p className="vdb-group-l m-0">Cơ cấu dòng chi</p>
        <button type="button" className="vdb-debt-total vdb-link block w-full" onClick={byP('Chi phí thực tế theo dự án', f => f.cost, { label: 'Mở Chi phí & ngân sách', route: ROUTES.cost })}>{shortMoney(cost)}</button>
        <Gauge title="Chi thầu phụ" total={ap.sub} paid={ap.subPaid} colors={colors} onClick={byP('Chi thầu phụ theo dự án', f => f.ap.subcontract.total, { label: 'Mở Thầu phụ', route: ROUTES.subcontracts })} />
        <Gauge title="Chi nhà cung cấp" total={ap.sup} paid={ap.supPaid} colors={colors} onClick={byP('Chi nhà cung cấp theo dự án', f => f.ap.supplier.total, payables)} />
      </section>

      <Card className="vdb-col-6" title="Dòng chi" subtitle="Nhóm chi phí → chi phí thực tế → đã trả / còn phải trả (gồm VAT)" through={payables}>
        <SankeyCard nodes={outNodes} links={outLinks} colors={colors} />
        {noAp && <p className="vdb-nodata">Chưa có chứng từ công nợ NCC, thầu phụ — chưa tách đã trả / còn phải trả.</p>}
      </Card>

      <Card className="vdb-col-7 vdb-wide" title="Bảng số liệu" subtitle="Theo dự án" through={reports}>
        <DataTable onRow={onOpen} drill={{
          columns: [{ key: 'p', label: 'Dự án' }, { key: 'v', label: 'Giá trị hợp đồng', kind: 'money' }, { key: 'r', label: 'Đề nghị thanh toán', kind: 'money' },
            { key: 'c', label: 'Tổng chi phí thực tế', kind: 'money' }, { key: 'd', label: 'Đã trả NCC, thầu phụ', kind: 'money' }],
          rows: projects.filter(project => project.finance).map(project => ({
            id: project.id, route: ROUTES.projectFinance(project.id),
            cells: { p: project.name, v: project.finance!.contractValue, r: project.finance!.ar.requested, c: project.finance!.cost, d: project.finance!.ap.paid },
          })),
          total: { v: contract, r: ar.requested, c: cost, d: ap.paid },
        }} />
      </Card>

      <Card className="vdb-col-5 vdb-wide" title="Dòng tiền dự án" subtitle="12 tháng gần nhất · thu dương, chi âm" through={{ label: 'Mở Thu chi & quỹ', route: ROUTES.cash }}
        table={<DataTable firstIsEntity={false} drill={{ columns: [{ key: 'm', label: 'Tháng' }, { key: 'i', label: 'Giá trị thu', kind: 'money' }, { key: 'o', label: 'Giá trị chi', kind: 'money' },
          { key: 'li', label: 'Lũy kế thu', kind: 'money' }, { key: 'lo', label: 'Lũy kế chi', kind: 'money' }],
          rows: flow.map(row => ({ id: row.month, cells: { m: monthLabel(row.month), i: row.thu, o: -row.chi, li: row.lkThu, lo: -row.lkChi } })) }} />}>
        <Legend items={[{ label: 'Giá trị thu', color: colors.thu }, { label: 'Giá trị chi', color: colors.chi }, { label: 'Lũy kế ròng (thu − chi)', color: colors.category.machinery, line: true }]} />
        {noCash ? <NoData>Chưa có tiền thu, tiền chi ghi qua Tài chính trong 12 tháng (Phải thu, Phải trả).</NoData> : (
        <div className="vdb-chart" style={{ height: 250 }}>
          <ResponsiveContainer>
            <ComposedChart data={flow} margin={{ top: 10, right: 12, left: 4, bottom: 0 }} stackOffset="sign"
              onClick={(state: { activeLabel?: string } | null) => { if (state?.activeLabel) onDrill(drillMonth(dataset, projects, state.activeLabel, [{ key: 'cashIn', label: 'Giá trị thu' }, { key: 'cashOut', label: 'Giá trị chi' }], { label: 'Mở Thu chi & quỹ', route: ROUTES.cash })); }}>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fill: colors.axis }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={axisMoney} tick={{ fontSize: 11, fill: colors.axis }} axisLine={false} tickLine={false} width={56} />
              <ReferenceLine y={0} stroke={colors.axis} strokeOpacity={0.4} />
              <Tooltip formatter={(value: number, name: string) => [`${name === 'Lũy kế ròng' && value < 0 ? '−' : ''}${money(Math.abs(value))} đ`, name]} labelFormatter={monthLabel} cursor={{ fill: colors.grid }} />
              <Bar dataKey="thu" name="Giá trị thu" fill={colors.thu} stackId="f" maxBarSize={18} radius={[4, 4, 0, 0]} />
              <Bar dataKey="chi" name="Giá trị chi" fill={colors.chi} stackId="f" maxBarSize={18} radius={[0, 0, 4, 4]} />
              <Line type="monotone" dataKey="rong" name="Lũy kế ròng" stroke={colors.category.machinery} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: colors.surface }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        )}
        {!noCash && recordCount(projects, 'payments') === 0 && <p className="vdb-nodata">Chưa có đợt chi NCC, thầu phụ ghi qua Tài chính — phần chi đang trống.</p>}
        {!noCash && recordCount(projects, 'receipts') === 0 && <p className="vdb-nodata">Chưa có tiền chủ đầu tư trả ghi qua Tài chính — phần thu đang trống.</p>}
      </Card>
    </div>
  );
};

export default DebtDashboard;
