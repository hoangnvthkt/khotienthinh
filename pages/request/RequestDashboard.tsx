import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, FileText, Loader2, RefreshCw, RotateCcw, Send, TriangleAlert, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { RequestStatusBadge, RequestTable } from '../../components/request/RequestTable';
import { useRequestList } from '../../hooks/useRequestList';
import { requestRuntimeService, type RequestSummary } from '../../lib/requestRuntimeService';
import { buildRequestRoute } from '../../lib/requestRoutes';

type SummaryCardProps = {
  label: string;
  value: number;
  description: string;
  Icon: typeof FileText;
  tone: string;
};

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, description, Icon, tone }) => (
  <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-slate-900 dark:text-white">{value}</p></div><span className={`rounded-lg p-2 ${tone}`}><Icon size={18} /></span></div>
    <p className="mt-3 text-xs text-slate-500">{description}</p>
  </article>
);

const RequestDashboard: React.FC = () => {
  const navigate = useNavigate();
  const list = useRequestList({ view: 'ALL' });
  const [summary, setSummary] = useState<RequestSummary | null>(null);
  const [summaryError, setSummaryError] = useState<Error | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const refresh = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const value = await requestRuntimeService.getSummary();
      setSummary(value);
    } catch (cause) {
      setSummaryError(cause instanceof Error ? cause : new Error('Không thể tải số liệu đề xuất.'));
    } finally {
      setSummaryLoading(false);
    }
    await list.refresh();
  }, [list.refresh]);

  useEffect(() => { void requestRuntimeService.getSummary().then(setSummary).catch(cause => setSummaryError(cause instanceof Error ? cause : new Error('Không thể tải số liệu đề xuất.'))).finally(() => setSummaryLoading(false)); }, []);

  const select = (requestId: string) => navigate(buildRequestRoute(requestId));
  const cards: SummaryCardProps[] = [
    { label: 'Tổng đề xuất', value: summary?.all ?? 0, description: 'Các hồ sơ bạn có quyền xem.', Icon: FileText, tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
    { label: 'Chờ bạn duyệt', value: summary?.assignedToMe ?? 0, description: 'Đang ở bước phê duyệt của bạn.', Icon: Clock3, tone: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
    { label: 'Đã trả lại', value: summary?.returned ?? 0, description: 'Cần người tạo bổ sung hoặc gửi lại.', Icon: RotateCcw, tone: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300' },
    { label: 'Quá hạn', value: summary?.overdue ?? 0, description: 'Hồ sơ vượt SLA đang được theo dõi.', Icon: TriangleAlert, tone: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' },
    { label: 'Đã chấp thuận', value: summary?.approved ?? 0, description: 'Đề xuất hoàn tất phê duyệt.', Icon: CheckCircle2, tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
    { label: 'Đã từ chối', value: summary?.rejected ?? 0, description: 'Đề xuất kết thúc vì bị từ chối.', Icon: XCircle, tone: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' },
  ];

  return <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
    <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-bold text-slate-900 dark:text-white">Tổng quan đề xuất</h1><p className="mt-1 text-sm text-slate-500">Số liệu được tính trực tiếp từ Workflow Engine của Module Yêu cầu.</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => void refresh()} disabled={summaryLoading || list.loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"><RefreshCw size={15} className={summaryLoading || list.loading ? 'animate-spin' : ''} />Làm mới</button><button type="button" onClick={() => navigate('/rq')} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><Send size={15} />Mở danh sách</button></div>
    </header>

    {summaryError && <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200"><AlertCircle size={16} />{summaryError.message}</div>}
    <section aria-label="Chỉ số đề xuất" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map(card => <SummaryCard key={card.label} {...card} />)}</section>

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800"><div><h2 className="font-semibold text-slate-900 dark:text-white">Đề xuất cập nhật gần đây</h2><p className="mt-0.5 text-xs text-slate-500">Mở một dòng để xem chi tiết hoặc thực hiện phê duyệt.</p></div><button type="button" onClick={() => navigate('/rq')} className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400">Xem tất cả <ArrowRight size={15} /></button></div>
      {list.loading ? <div className="flex min-h-56 items-center justify-center"><Loader2 className="animate-spin text-emerald-600" /></div>
        : list.error ? <div className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center"><AlertCircle className="text-rose-500" /><p className="text-sm text-slate-600 dark:text-slate-300">{list.error.message}</p><button type="button" onClick={() => void list.refresh()} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Thử lại</button></div>
          : <><RequestTable items={list.items.slice(0, 12)} onSelect={select} /><div className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">{list.items.slice(0, 12).map(item => <button key={item.id} type="button" onClick={() => select(item.id)} className="block w-full px-4 py-3 text-left"><p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.code} · {item.templateName}</p><div className="mt-2"><RequestStatusBadge status={item.status} /></div></button>)}</div>{list.items.length === 0 && <p className="p-10 text-center text-sm text-slate-500">Chưa có đề xuất nào để hiển thị.</p>}</>}
    </section>
  </div>;
};

export default RequestDashboard;
