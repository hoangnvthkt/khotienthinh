import React from 'react';
import { CheckCircle2, Circle, Clock3, RotateCcw, XCircle } from 'lucide-react';
import type { RequestDetail } from '../../lib/requestRuntimeService';

const blockIcon = (status: RequestDetail['approvalBlocks'][number]['status']) => {
  if (status === 'COMPLETED') return <CheckCircle2 size={17} className="text-emerald-600" />;
  if (status === 'RETURNED') return <RotateCcw size={17} className="text-orange-500" />;
  if (status === 'CANCELLED') return <XCircle size={17} className="text-slate-400" />;
  if (status === 'ACTIVE') return <Clock3 size={17} className="text-amber-500" />;
  return <Circle size={17} className="text-slate-300" />;
};

export const RequestApprovalInspector: React.FC<{ detail: RequestDetail }> = ({ detail }) => (
  <aside className="w-full shrink-0 space-y-4 border-l border-slate-200 bg-slate-50 p-4 xl:w-80 dark:border-slate-800 dark:bg-slate-950">
    <section className="rounded-xl bg-white p-4 shadow-sm dark:bg-slate-900"><h2 className="text-xs font-bold uppercase tracking-wide text-emerald-700">Người xét duyệt</h2><div className="mt-4 space-y-4">{detail.approvalBlocks.map(block => <div key={block.key}><div className="flex gap-2">{blockIcon(block.status)}<div className="min-w-0"><p className="text-sm font-semibold text-slate-800 dark:text-white">{block.name}</p><p className="text-xs text-slate-500">{block.status === 'NOT_ACTIVE' ? 'Chưa kích hoạt' : block.status === 'ACTIVE' ? 'Đang chờ duyệt' : block.status === 'COMPLETED' ? 'Đã hoàn tất' : block.status === 'RETURNED' ? 'Đã trả lại' : 'Đã đóng'}{block.slaHours ? ` · SLA ${block.slaHours}h` : ''}</p></div></div><div className="ml-6 mt-2 space-y-2">{block.assignments.map(assignment => <div key={assignment.id} className="text-xs"><p className="font-medium text-slate-700 dark:text-slate-200">{assignment.approver.name} <span className="font-normal text-slate-400">· {assignment.status}</span></p>{assignment.comment && <p className="mt-0.5 text-slate-500">“{assignment.comment}”</p>}</div>)}</div></div>)}</div></section><section className="rounded-xl bg-white p-4 shadow-sm dark:bg-slate-900"><h2 className="text-xs font-bold uppercase tracking-wide text-emerald-700">Lịch sử hoạt động</h2><ol className="mt-4 space-y-3 border-l border-slate-200 pl-4 dark:border-slate-700">{detail.timeline.map(event => <li key={event.id} className="relative text-xs"><span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-emerald-500" /><p className="font-medium text-slate-700 dark:text-slate-200">{event.eventType}</p><p className="text-slate-500">{event.actor?.name ?? 'Hệ thống'} · {new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.createdAt))}</p>{event.comment && <p className="mt-1 text-slate-500">{event.comment}</p>}</li>)}</ol></section></aside>
);
