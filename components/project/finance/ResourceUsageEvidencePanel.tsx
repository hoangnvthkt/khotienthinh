import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, ChevronDown, ChevronRight, Clock3, HardHat, History, RefreshCcw, Users } from 'lucide-react';
import type { ResourceEvidenceType, VerifiedResourceUsageEvidence } from '../../../types';
import { buildResourceEvidenceProviderKey, groupResourceEvidence } from '../../../lib/resourceUsageEvidenceRules';
import { projectResourceEvidenceService, type ResourceEvidencePage } from '../../../lib/projectResourceEvidenceService';
import { ResourceUsageEvidenceDrawer, dailyLogEvidenceHref } from './ResourceUsageEvidenceDrawer';

const formatNumber = (value: number | null | undefined) => value == null
  ? 'Chưa xác định' : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const providerName = (row: VerifiedResourceUsageEvidence) => row.provider.entryMode === 'catalog'
  ? row.provider.providerNameSnapshot || row.provider.providerCodeSnapshot || 'Nhà cung cấp không tên'
  : row.provider.manualProviderName || 'Nguồn nhập tay không tên';
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

interface ResourceUsageEvidencePanelProps {
  projectId: string;
  constructionSiteId?: string | null;
  initialData?: ResourceEvidencePage;
}

export const ResourceUsageEvidencePanel: React.FC<ResourceUsageEvidencePanelProps> = ({ projectId, constructionSiteId, initialData }) => {
  const [fromDate, setFromDate] = useState(daysAgo(30));
  const [toDate, setToDate] = useState(today());
  const [providerKey, setProviderKey] = useState('');
  const [taskId, setTaskId] = useState('');
  const [resourceType, setResourceType] = useState<'' | ResourceEvidenceType>('');
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [page, setPage] = useState<ResourceEvidencePage | null>(initialData || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<VerifiedResourceUsageEvidence | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async (cursor?: string | null) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await projectResourceEvidenceService.getEvidence({
        projectId, constructionSiteId, fromDate, toDate,
        providerKey: providerKey || null, taskId: taskId || null,
        resourceType: resourceType || null, includeSuperseded,
        cursor: cursor || null, limit: 200,
      });
      if (requestId !== requestRef.current) return;
      setPage(previous => cursor && previous ? {
        ...response,
        rows: [...previous.rows, ...response.rows],
        groups: groupResourceEvidence([...previous.rows, ...response.rows]),
      } : response);
    } catch (failure) {
      if (requestId !== requestRef.current) return;
      setError(failure instanceof Error ? failure.message : 'Không tải được bằng chứng nguồn lực. Hãy thử tải lại.');
      if (!cursor) setPage(null);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [projectId, constructionSiteId, fromDate, toDate, providerKey, taskId, resourceType, includeSuperseded]);

  React.useEffect(() => {
    if (initialData) return;
    setPage(null);
    setSelectedRow(null);
    void load();
    return () => { requestRef.current += 1; };
  }, [projectId, constructionSiteId]); // Scope change reloads; filters use explicit action.

  const providers = useMemo(() => Array.from(new Map((page?.rows || []).map(row => [
    buildResourceEvidenceProviderKey(row.provider),
    providerName(row),
  ])).entries()), [page?.rows]);
  const tasks = useMemo(() => Array.from(new Map((page?.rows || []).map(row => [row.taskId, `${row.wbsCode || '—'} · ${row.taskName}`])).entries()), [page?.rows]);
  const groupedRows = useMemo(() => {
    const groups = new Map<string, VerifiedResourceUsageEvidence[]>();
    for (const row of page?.rows || []) {
      const key = buildResourceEvidenceProviderKey(row.provider);
      groups.set(key, [...(groups.get(key) || []), row]);
    }
    return [...groups.entries()];
  }, [page?.rows]);

  const metrics = [
    { label: 'Nguồn cung cấp', value: formatNumber(page?.totals.providerCount), icon: Users, suffix: 'nguồn' },
    { label: 'Nhân lực', value: formatNumber(page?.totals.peopleCount), icon: HardHat, suffix: 'người' },
    { label: 'Giờ công', value: formatNumber(page?.totals.totalLaborHours), icon: Clock3, suffix: 'giờ công' },
    { label: 'Giờ máy', value: formatNumber(page?.totals.totalMachineHours), icon: Clock3, suffix: 'giờ máy' },
  ];

  return <section className="space-y-5" aria-label="Bằng chứng nguồn lực">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Nguồn lực đã xác nhận</p>
        <h3 className="mt-1 text-xl font-bold text-zinc-950 dark:text-white">Bằng chứng nhân công &amp; máy</h3>
        <p className="mt-1 text-sm text-zinc-500">Tra cứu theo nguồn cung cấp, ngày, khu vực và WBS; mở Nhật ký để kiểm tra nguồn gốc.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading}
        className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:border-teal-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
        <RefreshCcw size={15} className={loading ? 'animate-spin' : ''} /> Tải lại
      </button>
    </div>

    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {metrics.map(metric => <div key={metric.label} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500"><metric.icon size={15} className="text-teal-700" /> {metric.label}</div>
        <p aria-label={`${metric.value} ${metric.suffix}`} className="mt-3 text-2xl font-bold text-zinc-950 dark:text-white">{metric.value} <span className="text-sm font-medium text-zinc-500">{metric.suffix}</span></p>
      </div>)}
    </div>

    <div className="grid gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-2 xl:grid-cols-6">
      <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Từ ngày<input aria-label="Từ ngày" type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} className="mt-1 w-full rounded-lg border border-zinc-200 bg-transparent p-2 text-sm dark:border-zinc-700" /></label>
      <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Đến ngày<input aria-label="Đến ngày" type="date" value={toDate} onChange={event => setToDate(event.target.value)} className="mt-1 w-full rounded-lg border border-zinc-200 bg-transparent p-2 text-sm dark:border-zinc-700" /></label>
      <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Nguồn cung cấp<select aria-label="Nguồn cung cấp" value={providerKey} onChange={event => setProviderKey(event.target.value)} className="mt-1 w-full rounded-lg border border-zinc-200 bg-transparent p-2 text-sm dark:border-zinc-700"><option value="">Tất cả</option>{providers.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">WBS<select aria-label="WBS" value={taskId} onChange={event => setTaskId(event.target.value)} className="mt-1 w-full rounded-lg border border-zinc-200 bg-transparent p-2 text-sm dark:border-zinc-700"><option value="">Tất cả</option>{tasks.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Loại nguồn lực<select aria-label="Loại nguồn lực" value={resourceType} onChange={event => setResourceType(event.target.value as '' | ResourceEvidenceType)} className="mt-1 w-full rounded-lg border border-zinc-200 bg-transparent p-2 text-sm dark:border-zinc-700"><option value="">Cả hai</option><option value="labor">Nhân công</option><option value="machine">Máy</option></select></label>
      <div className="flex flex-col justify-end gap-2"><label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300"><input type="checkbox" checked={includeSuperseded} onChange={event => setIncludeSuperseded(event.target.checked)} /> <History size={13} /> Xem bản đã thay thế</label><button type="button" onClick={() => void load()} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-bold text-white hover:bg-teal-800">Áp dụng lọc</button></div>
    </div>

    {loading && !page && <div role="status" className="animate-pulse rounded-2xl border border-zinc-200 bg-zinc-50 p-8 text-sm text-zinc-500">Đang tải bằng chứng nguồn lực…</div>}
    {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertCircle size={17} className="shrink-0" />{error}</div>}
    {!!page?.unknownLegacyCount && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Có {page.unknownLegacyCount} dòng dữ liệu cũ chưa đủ semantics, không cộng vào tổng. <a href={`/da?tab=dailylog&projectId=${encodeURIComponent(projectId)}&siteId=${encodeURIComponent(constructionSiteId || '')}`} className="font-bold underline">Xem Nhật ký cũ</a>.</div>}
    {page && page.rows.length === 0 && !error && <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900"><p className="font-semibold text-zinc-800 dark:text-zinc-100">Chưa có bằng chứng đã xác nhận trong phạm vi này</p><p className="mt-1 text-sm text-zinc-500">Thử mở rộng khoảng ngày hoặc bỏ bớt bộ lọc.</p></div>}

    {page && page.rows.length > 0 && <div className="space-y-3">
      {groupedRows.map(([key, rows]) => {
        const isOpen = expandedProvider === key || (expandedProvider === null && groupedRows.length === 1);
        const current = rows.filter(row => row.revisionState === 'current');
        const hoursLabor = current.reduce((sum, row) => sum + (row.totalLaborHours || 0), 0);
        const hoursMachine = current.reduce((sum, row) => sum + (row.totalMachineHours || 0), 0);
        return <div key={key} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <button type="button" aria-expanded={isOpen} onClick={() => setExpandedProvider(isOpen ? '' : key)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
            <div className="flex min-w-0 items-center gap-3">{isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}<div className="min-w-0"><p className="truncate font-bold text-zinc-950 dark:text-white">{providerName(rows[0])}</p><span className="text-xs text-zinc-500">{rows[0].provider.entryMode === 'catalog' ? 'Danh mục' : 'Nhập tay'} · {rows.length} dòng</span></div></div>
            <div className="hidden text-right text-xs font-semibold text-zinc-600 dark:text-zinc-300 sm:block">{formatNumber(hoursLabor)} giờ công · {formatNumber(hoursMachine)} giờ máy</div>
          </button>
          {isOpen && <div className="border-t border-zinc-100 dark:border-zinc-800">
            <div className="hidden overflow-x-auto md:block"><table className="min-w-[760px] w-full text-sm"><thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-800/40"><tr><th className="px-4 py-3">Ngày</th><th className="px-4 py-3">Khu vực</th><th className="px-4 py-3">WBS</th><th className="px-4 py-3">Số lượng</th><th className="px-4 py-3">Thời gian</th><th className="px-4 py-3">Nguồn</th></tr></thead><tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{rows.map(row => <tr key={row.resourceLineId} className="hover:bg-teal-50/40 dark:hover:bg-teal-950/20"><td className="px-4 py-3 whitespace-nowrap">{row.logDate}</td><td className="px-4 py-3">{row.workAreaName || row.workAreaCode}</td><td className="px-4 py-3"><button type="button" onClick={() => setSelectedRow(row)} className="font-semibold text-teal-800 hover:underline dark:text-teal-300">{row.wbsCode || '—'} · {row.taskName}</button>{row.revisionState === 'superseded' && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">Đã thay thế</span>}</td><td className="px-4 py-3">{row.resourceType === 'labor' ? `${formatNumber(row.peopleCount)} người` : `${formatNumber(row.machineCount)} máy`}</td><td className="px-4 py-3">{row.resourceType === 'labor' ? `${formatNumber(row.totalLaborHours)} giờ công` : `${formatNumber(row.totalMachineHours)} giờ máy`}</td><td className="px-4 py-3"><a href={dailyLogEvidenceHref(row)} className="inline-flex items-center gap-1 font-semibold text-teal-800 hover:underline dark:text-teal-300">Mở Nhật ký <ArrowUpRight size={13} /></a></td></tr>)}</tbody></table></div>
            <div className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-800">{rows.map(row => <div key={row.resourceLineId} className="space-y-2 p-4 text-sm"><div className="flex justify-between gap-2"><span className="font-semibold">{row.logDate}</span><span className="text-zinc-500">{row.workAreaName || row.workAreaCode}</span></div><button type="button" onClick={() => setSelectedRow(row)} className="text-left font-semibold text-teal-800 dark:text-teal-300">{row.wbsCode || '—'} · {row.taskName}</button><p>{row.resourceType === 'labor' ? `${formatNumber(row.peopleCount)} người · ${formatNumber(row.totalLaborHours)} giờ công` : `${formatNumber(row.machineCount)} máy · ${formatNumber(row.totalMachineHours)} giờ máy`}{row.revisionState === 'superseded' && ' · Đã thay thế'}</p><a href={dailyLogEvidenceHref(row)} className="inline-flex items-center gap-1 text-sm font-semibold text-teal-800 dark:text-teal-300">Mở Nhật ký <ArrowUpRight size={13} /></a></div>)}</div>
          </div>}
        </div>;
      })}
      {page.nextCursor && <button type="button" disabled={loading} onClick={() => void load(page.nextCursor)} className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-teal-800 hover:border-teal-500 dark:border-zinc-800 dark:bg-zinc-900">{loading ? 'Đang tải…' : 'Xem thêm bằng chứng'}</button>}
    </div>}
    {selectedRow && <ResourceUsageEvidenceDrawer row={selectedRow} onClose={() => setSelectedRow(null)} />}
  </section>;
};
