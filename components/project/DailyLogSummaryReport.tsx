import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CloudRain,
  Download,
  Eye,
  FileText,
  Filter,
  MapPin,
  Printer,
  Truck,
  Users,
  Wrench,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DailyLog, DailyLogStatus } from '../../types';
import {
  DailyLogPeriodSummary,
  DailyLogSummaryMode,
  DailyLogSummaryStatusScope,
  dailyLogSummaryService,
} from '../../lib/dailyLogSummaryService';

interface DailyLogSummaryReportProps {
  dailyLogs: DailyLog[];
  projectId?: string;
  constructionSiteId?: string;
}

const STATUS_OPTIONS: { value: DailyLogSummaryStatusScope; label: string }[] = [
  { value: 'verified', label: 'Đã duyệt' },
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'draft', label: 'Nháp' },
  { value: 'submitted', label: 'Chờ duyệt' },
  { value: 'rejected', label: 'Từ chối/trả lại' },
];

const MODE_OPTIONS: { value: DailyLogSummaryMode; label: string }[] = [
  { value: 'day', label: 'Ngày' },
  { value: 'week', label: 'Tuần' },
  { value: 'month', label: 'Tháng' },
];

const STATUS_LABELS: Record<DailyLogStatus, string> = {
  draft: 'Nháp',
  submitted: 'Chờ duyệt',
  verified: 'Đã duyệt',
  rejected: 'Từ chối/trả lại',
};

const DELAY_LABELS: Record<string, string> = {
  weather: 'Thời tiết',
  material: 'Vật tư',
  labor: 'Nhân công',
  drawing: 'Bản vẽ',
  other: 'Khác',
};

const CHART_COLORS = ['#0f766e', '#2563eb', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#16a34a', '#f97316'];
const WEATHER_COLORS: Record<string, string> = {
  sunny: '#f59e0b',
  cloudy: '#94a3b8',
  rainy: '#2563eb',
  storm: '#7c3aed',
};

const toDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const parseDateKey = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
};

const formatNumber = (value: number, maximumFractionDigits = 0) =>
  Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits });

const escapeHtml = (value?: string | number | null) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const getDefaultRange = (logs: DailyLog[]) => {
  const dates = logs.map(log => log.date).filter(Boolean).sort();
  const fallbackTo = toDateKey(new Date());
  const toDate = dates[dates.length - 1] || fallbackTo;
  return {
    fromDate: toDateKey(addDays(parseDateKey(toDate), -30)),
    toDate,
  };
};

const buildLogLink = (logId: string, projectId?: string, constructionSiteId?: string) => {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (constructionSiteId) params.set('siteId', constructionSiteId);
  params.set('tab', 'dailylog');
  params.set('dailyLogId', logId);
  return `/da?${params.toString()}`;
};

const SummaryKpiCard = ({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  tone: string;
}) => (
  <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}>{icon}</div>
      <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</span>
    </div>
    <div className="text-2xl font-black text-slate-800 dark:text-white">{value}</div>
    {sub && <div className="mt-1 text-[11px] font-bold text-slate-400">{sub}</div>}
  </div>
);

const EmptyChart = ({ text }: { text: string }) => (
  <div className="flex h-[220px] items-center justify-center text-xs font-bold text-slate-300">{text}</div>
);

const getPeriodStatusText = (period: DailyLogPeriodSummary) => {
  const parts: string[] = [];
  if (period.dataQuality.verifiedCount) parts.push(`${period.dataQuality.verifiedCount} đã duyệt`);
  if (period.dataQuality.submittedCount) parts.push(`${period.dataQuality.submittedCount} chờ duyệt`);
  if (period.dataQuality.draftCount) parts.push(`${period.dataQuality.draftCount} nháp`);
  if (period.dataQuality.rejectedCount) parts.push(`${period.dataQuality.rejectedCount} từ chối`);
  return parts.join(' · ') || 'Thiếu nhật ký đã duyệt';
};

const buildPdfHtml = (
  periods: DailyLogPeriodSummary[],
  selectedPeriod: DailyLogPeriodSummary | undefined,
  overview: ReturnType<typeof dailyLogSummaryService.summarize>['overview'],
  fromDate: string,
  toDate: string,
  mode: DailyLogSummaryMode,
) => {
  const modeLabel = MODE_OPTIONS.find(item => item.value === mode)?.label || mode;
  const rows = periods.map(period => `
    <tr>
      <td>${escapeHtml(period.label)}</td>
      <td class="num">${period.dataQuality.verifiedCount}/${period.dataQuality.logCount}</td>
      <td class="num">${escapeHtml(period.workers.total)}</td>
      <td class="num">${escapeHtml(period.workers.averagePerActiveDay)}</td>
      <td class="num">${escapeHtml(period.machines.reduce((sum, item) => sum + item.value, 0))}</td>
      <td class="num">${escapeHtml(period.rainyDays)}</td>
      <td class="num">${escapeHtml(period.delays.totalDays)}</td>
      <td>${escapeHtml(period.issues.slice(0, 2).map(item => item.text).join('; ') || '-')}</td>
    </tr>
  `).join('');

  const issueRows = (selectedPeriod?.issues || []).concat(selectedPeriod?.delays.entries || []).slice(0, 12).map(item => `
    <tr>
      <td>${escapeHtml(item.date)}</td>
      <td>${escapeHtml(item.createdBy)}</td>
      <td>${escapeHtml(item.text)}</td>
    </tr>
  `).join('');

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Bao_cao_nhat_ky_cong_truong</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; color: #0f172a; margin: 24px; }
        h1 { font-size: 22px; margin: 0 0 4px; }
        h2 { font-size: 15px; margin: 22px 0 10px; }
        .muted { color: #64748b; font-size: 12px; }
        .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 18px; }
        .kpi { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; }
        .label { color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 700; }
        .value { font-size: 18px; font-weight: 800; margin-top: 5px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
        th, td { border: 1px solid #e2e8f0; padding: 7px; text-align: left; vertical-align: top; }
        th { background: #f8fafc; color: #475569; text-transform: uppercase; font-size: 9px; }
        .num { text-align: right; }
        @media print { body { margin: 14mm; } .no-print { display: none; } }
      </style>
    </head>
    <body>
      <h1>Báo cáo tổng hợp nhật ký công trường</h1>
      <div class="muted">Kỳ báo cáo: ${escapeHtml(fromDate)} - ${escapeHtml(toDate)} · Chế độ: ${escapeHtml(modeLabel)} · Số liệu chính theo nhật ký đã duyệt</div>
      <div class="grid">
        <div class="kpi"><div class="label">Nhật ký đã duyệt</div><div class="value">${overview.officialLogCount}</div></div>
        <div class="kpi"><div class="label">Ngày thiếu nhật ký</div><div class="value">${overview.missingDays}</div></div>
        <div class="kpi"><div class="label">Nhân sự TB/ngày</div><div class="value">${overview.avgWorkers}</div></div>
        <div class="kpi"><div class="label">Ca máy</div><div class="value">${formatNumber(overview.totalMachineShifts, 2)}</div></div>
        <div class="kpi"><div class="label">Ngày mưa/bão</div><div class="value">${overview.rainyDays}</div></div>
        <div class="kpi"><div class="label">Ngày chậm</div><div class="value">${overview.delayDays}</div></div>
        <div class="kpi"><div class="label">Vấn đề/sự cố</div><div class="value">${overview.issueCount}</div></div>
        <div class="kpi"><div class="label">Ảnh/GPS</div><div class="value">${overview.photoCompliance}% / ${overview.gpsCompliance}%</div></div>
      </div>
      <h2>Bảng tổng hợp theo kỳ</h2>
      <table>
        <thead>
          <tr>
            <th>Kỳ</th><th>Đã duyệt/Tổng</th><th>Nhân sự</th><th>TB/ngày</th><th>Ca máy</th><th>Mưa/bão</th><th>Ngày chậm</th><th>Vấn đề chính</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="8">Không có dữ liệu.</td></tr>'}</tbody>
      </table>
      <h2>Vấn đề / sự cố / đề nghị nổi bật${selectedPeriod ? ` - ${escapeHtml(selectedPeriod.label)}` : ''}</h2>
      <table>
        <thead><tr><th>Ngày</th><th>Người ghi</th><th>Nội dung</th></tr></thead>
        <tbody>${issueRows || '<tr><td colspan="3">Không có vấn đề nổi bật.</td></tr>'}</tbody>
      </table>
      <script>setTimeout(function(){ window.print(); }, 250);</script>
    </body>
  </html>`;
};

const DailyLogSummaryReport: React.FC<DailyLogSummaryReportProps> = ({ dailyLogs, projectId, constructionSiteId }) => {
  const defaultRange = useMemo(() => getDefaultRange(dailyLogs), [dailyLogs]);
  const [rangeTouched, setRangeTouched] = useState(false);
  const [fromDate, setFromDate] = useState(defaultRange.fromDate);
  const [toDate, setToDate] = useState(defaultRange.toDate);
  const [mode, setMode] = useState<DailyLogSummaryMode>('week');
  const [statusScope, setStatusScope] = useState<DailyLogSummaryStatusScope>('verified');
  const [creatorId, setCreatorId] = useState('');
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string | null>(null);

  useEffect(() => {
    if (rangeTouched) return;
    setFromDate(defaultRange.fromDate);
    setToDate(defaultRange.toDate);
  }, [defaultRange.fromDate, defaultRange.toDate, rangeTouched]);

  const summary = useMemo(() => dailyLogSummaryService.summarize(dailyLogs, {
    fromDate,
    toDate,
    mode,
    statusScope,
    creatorId: creatorId || undefined,
  }), [creatorId, dailyLogs, fromDate, mode, statusScope, toDate]);

  useEffect(() => {
    if (summary.periods.length === 0) {
      setSelectedPeriodKey(null);
      return;
    }
    if (selectedPeriodKey && summary.periods.some(period => period.periodKey === selectedPeriodKey)) return;
    const lastWithLogs = [...summary.periods].reverse().find(period => period.dataQuality.logCount > 0);
    setSelectedPeriodKey((lastWithLogs || summary.periods[summary.periods.length - 1]).periodKey);
  }, [selectedPeriodKey, summary.periods]);

  const selectedPeriod = summary.periods.find(period => period.periodKey === selectedPeriodKey);
  const visiblePeriods = summary.periods;
  const weatherChart = summary.charts.weather.filter(item => item.value > 0);
  const selectedIssues = selectedPeriod ? [...selectedPeriod.issues, ...selectedPeriod.delays.entries] : [];

  const handleExportPdf = () => {
    const html = buildPdfHtml(visiblePeriods, selectedPeriod, summary.overview, fromDate, toDate, mode);
    const printWindow = window.open('', '_blank', 'width=1080,height=760');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-teal-600">
              <FileText size={13} /> Báo cáo nhật ký công trường
            </div>
            <h3 className="mt-1 text-xl font-black text-slate-800 dark:text-white">Tổng hợp hoạt động ngày / tuần / tháng</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">
              KPI chính tính theo nhật ký đã duyệt; dữ liệu chưa duyệt được giữ riêng để cảnh báo chất lượng báo cáo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              {MODE_OPTIONS.map(item => (
                <button
                  key={item.value}
                  onClick={() => setMode(item.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black transition-colors ${
                    mode === item.value ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              onClick={handleExportPdf}
              className="flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 transition-colors hover:bg-blue-100"
            >
              <Download size={14} /> Xuất PDF
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Từ ngày</span>
            <input
              type="date"
              value={fromDate}
              onChange={e => { setRangeTouched(true); setFromDate(e.target.value); }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-teal-500"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Đến ngày</span>
            <input
              type="date"
              value={toDate}
              onChange={e => { setRangeTouched(true); setToDate(e.target.value); }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-teal-500"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Trạng thái</span>
            <select
              value={statusScope}
              onChange={e => setStatusScope(e.target.value as DailyLogSummaryStatusScope)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-teal-500"
            >
              {STATUS_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Người tạo</span>
            <select
              value={creatorId}
              onChange={e => setCreatorId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-teal-500"
            >
              <option value="">Tất cả</option>
              {summary.creators.map(creator => <option key={creator.id} value={creator.id}>{creator.name}</option>)}
            </select>
          </label>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
              <Filter size={11} /> Nguồn dữ liệu
            </div>
            <div className="text-xs font-bold text-slate-700">
              {summary.filteredLogs.length} / {summary.allLogsInRange.length} nhật ký trong kỳ
            </div>
          </div>
        </div>
      </div>

      {dailyLogs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">
          Chưa có nhật ký công trường để tổng hợp.
        </div>
      ) : (
        <>
          {(summary.overview.unverifiedLogCount > 0 || summary.overview.missingDays > 0) && (
            <div className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold text-amber-800 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="shrink-0" />
                <span>
                  Có {summary.overview.unverifiedLogCount} nhật ký chưa được duyệt và {summary.overview.missingDays} ngày chưa có nhật ký đã duyệt trong kỳ.
                </span>
              </div>
              <span className="text-[11px] uppercase tracking-wider">KPI chính vẫn đang tính theo nhật ký đã duyệt</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
            <SummaryKpiCard label="Đã duyệt" value={summary.overview.officialLogCount} sub={`${summary.overview.unverifiedLogCount} chưa chốt`} icon={<CheckCircle2 size={16} />} tone="bg-emerald-50 text-emerald-600" />
            <SummaryKpiCard label="Ngày thiếu" value={summary.overview.missingDays} sub={`${summary.overview.activeDays} ngày có dữ liệu`} icon={<CalendarDays size={16} />} tone="bg-amber-50 text-amber-600" />
            <SummaryKpiCard label="Nhân sự TB" value={summary.overview.avgWorkers} sub={`Đỉnh: ${summary.overview.peakWorkers}`} icon={<Users size={16} />} tone="bg-blue-50 text-blue-600" />
            <SummaryKpiCard label="Tổng nhân sự" value={summary.overview.totalWorkers} sub="Lũy kế theo ngày" icon={<Users size={16} />} tone="bg-cyan-50 text-cyan-600" />
            <SummaryKpiCard label="Ca máy" value={formatNumber(summary.overview.totalMachineShifts, 2)} sub="Tổng ca trong kỳ" icon={<Wrench size={16} />} tone="bg-violet-50 text-violet-600" />
            <SummaryKpiCard label="Mưa/bão" value={summary.overview.rainyDays} sub="Ngày ảnh hưởng" icon={<CloudRain size={16} />} tone="bg-sky-50 text-sky-600" />
            <SummaryKpiCard label="Ngày chậm" value={summary.overview.delayDays} sub="Từ nhật ký" icon={<AlertTriangle size={16} />} tone="bg-red-50 text-red-600" />
            <SummaryKpiCard label="Ảnh/GPS" value={`${summary.overview.photoCompliance}%`} sub={`GPS ${summary.overview.gpsCompliance}%`} icon={<MapPin size={16} />} tone="bg-slate-100 text-slate-600" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
              <div className="mb-3 text-xs font-black text-slate-700">Xu hướng nhân sự</div>
              {summary.charts.workerTrend.some(item => item.workers > 0) ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={summary.charts.workerTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 9, fill: '#64748b' }} />
                    <Tooltip contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                    <Line type="monotone" dataKey="workers" name="Nhân sự TB" stroke="#0f766e" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="Chưa có số liệu nhân sự đã duyệt" />}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
              <div className="mb-3 text-xs font-black text-slate-700">Phân bổ thời tiết</div>
              {weatherChart.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={weatherChart} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={3} label={({ name, value }) => `${name}: ${value}`} isAnimationActive={false}>
                      {weatherChart.map(entry => <Cell key={entry.key} fill={WEATHER_COLORS[entry.key] || '#64748b'} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="Chưa có dữ liệu thời tiết đã duyệt" />}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
              <div className="mb-3 text-xs font-black text-slate-700">Nhân công theo tổ/loại</div>
              {summary.charts.labor.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={summary.charts.labor} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 9, fill: '#64748b' }} />
                    <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 9, fill: '#475569' }} />
                    <Tooltip contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                    <Bar dataKey="value" name="Người" radius={[0, 6, 6, 0]} fill="#2563eb" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="Chưa có chi tiết nhân công" />}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
              <div className="mb-3 text-xs font-black text-slate-700">Máy móc theo ca</div>
              {summary.charts.machines.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={summary.charts.machines} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 9, fill: '#64748b' }} />
                    <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 9, fill: '#475569' }} />
                    <Tooltip contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                    <Bar dataKey="value" name="Ca" radius={[0, 6, 6, 0]} fill="#7c3aed" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="Chưa có chi tiết máy móc" />}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-800 xl:col-span-2">
              <div className="mb-3 text-xs font-black text-slate-700">Nguyên nhân chậm tiến độ</div>
              {summary.charts.delays.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={summary.charts.delays}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tickFormatter={value => DELAY_LABELS[value] || value} tick={{ fontSize: 9, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 9, fill: '#64748b' }} />
                    <Tooltip formatter={(value: number) => `${value} ngày`} labelFormatter={value => DELAY_LABELS[String(value)] || value} contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                    <Bar dataKey="value" name="Ngày chậm" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                      {summary.charts.delays.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="Không có dữ liệu chậm tiến độ" />}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
            <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <h4 className="text-xs font-black text-slate-700">Bảng tổng hợp theo kỳ</h4>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{visiblePeriods.length} dòng</span>
              </div>
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-[10px] font-black uppercase text-slate-400">
                    <tr>
                      <th className="px-4 py-3 text-left">Kỳ</th>
                      <th className="px-4 py-3 text-right">Nhật ký</th>
                      <th className="px-4 py-3 text-right">Nhân sự</th>
                      <th className="px-4 py-3 text-right">Ca máy</th>
                      <th className="px-4 py-3 text-right">Mưa/bão</th>
                      <th className="px-4 py-3 text-right">Chậm</th>
                      <th className="px-4 py-3 text-left">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {visiblePeriods.map(period => {
                      const isSelected = period.periodKey === selectedPeriodKey;
                      return (
                        <tr
                          key={period.periodKey}
                          onClick={() => setSelectedPeriodKey(period.periodKey)}
                          className={`cursor-pointer transition-colors ${isSelected ? 'bg-teal-50/80' : 'hover:bg-slate-50'}`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-black text-slate-700">{period.label}</div>
                            <div className="mt-0.5 text-[10px] font-bold text-slate-400">{period.startDate} - {period.endDate}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-black text-slate-700">{period.dataQuality.verifiedCount}/{period.dataQuality.logCount}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="font-black text-blue-700">{period.workers.total}</div>
                            <div className="text-[10px] text-slate-400">TB {period.workers.averagePerActiveDay}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-violet-700">{formatNumber(period.machines.reduce((sum, item) => sum + item.value, 0), 2)}</td>
                          <td className="px-4 py-3 text-right font-bold text-sky-700">{period.rainyDays}</td>
                          <td className="px-4 py-3 text-right font-bold text-red-600">{period.delays.totalDays}</td>
                          <td className="px-4 py-3 text-slate-500">{getPeriodStatusText(period)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-black text-slate-800">Chi tiết kỳ</h4>
                  <p className="text-xs font-bold text-slate-400">{selectedPeriod?.label || 'Chưa chọn kỳ'}</p>
                </div>
                {selectedPeriod && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
                    {selectedPeriod.dataQuality.logCount} nhật ký
                  </span>
                )}
              </div>

              {!selectedPeriod ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs font-bold text-slate-400">Chọn một kỳ để xem chi tiết.</div>
              ) : (
                <div className="space-y-5">
                  <div>
                    <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Nhật ký nguồn</div>
                    <div className="space-y-2">
                      {selectedPeriod.logs.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-700">Kỳ này chưa có nhật ký phù hợp bộ lọc.</div>
                      ) : selectedPeriod.logs.map(log => {
                        const status = (log.status || (log.verified ? 'verified' : 'draft')) as DailyLogStatus;
                        return (
                          <a
                            key={log.id}
                            href={buildLogLink(log.id, projectId, constructionSiteId)}
                            className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:border-teal-200 hover:bg-teal-50"
                          >
                            <span>
                              <span className="text-slate-800">{log.date}</span>
                              <span className="mx-1 text-slate-300">·</span>
                              {log.createdBy || 'Không rõ'}
                              <span className="mx-1 text-slate-300">·</span>
                              {STATUS_LABELS[status]}
                            </span>
                            <Eye size={13} className="shrink-0 text-teal-600" />
                          </a>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Nội dung ghi nhận</div>
                    <div className="space-y-2">
                      {selectedPeriod.descriptions.slice(0, 5).map(item => (
                        <div key={`${item.logId}-${item.type}-${item.text.slice(0, 12)}`} className="rounded-xl bg-slate-50 p-3 text-xs font-medium text-slate-600">
                          <div className="mb-1 font-black text-slate-700">{item.date} · {item.createdBy}</div>
                          {item.text}
                        </div>
                      ))}
                      {selectedPeriod.descriptions.length === 0 && <div className="text-xs font-bold text-slate-400">Chưa có nội dung ghi nhận.</div>}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Vấn đề / sự cố / đề nghị</div>
                    <div className="space-y-2">
                      {selectedIssues.slice(0, 8).map(item => (
                        <div key={`${item.logId}-${item.type}-${item.text.slice(0, 12)}`} className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs font-medium text-red-700">
                          <div className="mb-1 font-black">{item.date} · {item.createdBy}</div>
                          {item.text}
                        </div>
                      ))}
                      {selectedIssues.length === 0 && <div className="text-xs font-bold text-emerald-600">Không có vấn đề nổi bật trong kỳ này.</div>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="mb-2 flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400"><Users size={11} /> Top nhân công</div>
                      {selectedPeriod.labor.slice(0, 5).map(item => (
                        <div key={item.key} className="flex justify-between gap-3 py-1 text-xs font-bold text-slate-600">
                          <span className="truncate">{item.label}</span>
                          <span>{formatNumber(item.value, 2)} {item.unit}</span>
                        </div>
                      ))}
                      {selectedPeriod.labor.length === 0 && <div className="text-xs font-bold text-slate-400">Không có chi tiết.</div>}
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="mb-2 flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400"><Truck size={11} /> Top máy móc</div>
                      {selectedPeriod.machines.slice(0, 5).map(item => (
                        <div key={item.key} className="flex justify-between gap-3 py-1 text-xs font-bold text-slate-600">
                          <span className="truncate">{item.label}</span>
                          <span>{formatNumber(item.value, 2)} {item.unit}</span>
                        </div>
                      ))}
                      {selectedPeriod.machines.length === 0 && <div className="text-xs font-bold text-slate-400">Không có chi tiết.</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default DailyLogSummaryReport;
