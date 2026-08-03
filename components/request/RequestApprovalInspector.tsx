import React from 'react';
import { CheckCircle2, Circle, Clock3, PanelRightClose, PanelRightOpen, RotateCcw, ShieldCheck, UserCheck, XCircle } from 'lucide-react';
import type { RequestDetail } from '../../lib/requestRuntimeService';

const blockIcon = (status: RequestDetail['approvalBlocks'][number]['status']) => {
  if (status === 'COMPLETED') return <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />;
  if (status === 'RETURNED') return <RotateCcw size={18} className="text-orange-500 shrink-0" />;
  if (status === 'CANCELLED') return <XCircle size={18} className="text-slate-400 shrink-0" />;
  if (status === 'ACTIVE') return <Clock3 size={18} className="text-amber-500 animate-pulse shrink-0" />;
  return <Circle size={18} className="text-slate-300 dark:text-slate-700 shrink-0" />;
};

export const RequestApprovalInspector: React.FC<{
  detail: RequestDetail;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}> = ({ detail, isCollapsed = false, onToggleCollapse }) => {
  if (isCollapsed) {
    return (
      <aside className="hidden xl:flex w-12 shrink-0 flex-col items-center border-l border-slate-200 bg-slate-50/70 py-4 dark:border-slate-800 dark:bg-slate-950/70">
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
            title="Mở rộng quy trình & lịch sử"
          >
            <PanelRightOpen size={18} />
          </button>
        )}
        <div className="mt-6 flex flex-col items-center gap-3">
          <ShieldCheck size={18} className="text-emerald-600" />
          <span className="writing-vertical text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Luồng duyệt ({detail.approvalBlocks.length})
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-full xl:w-80 shrink-0 flex flex-col space-y-4 border-l border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/70 transition-all duration-200 overflow-y-auto">
      <div className="flex items-center justify-between pb-1 border-b border-slate-200/60 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <UserCheck size={16} className="text-emerald-600" />
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-400">
            Luồng xét duyệt
          </h2>
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
            title="Thu gọn bảng duyệt"
          >
            <PanelRightClose size={16} />
          </button>
        )}
      </div>

      {/* Approval Blocks Card */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
        <div className="space-y-4">
          {detail.approvalBlocks.map((block, idx) => (
            <div key={block.key} className="relative">
              {idx < detail.approvalBlocks.length - 1 && (
                <div className="absolute left-[8px] top-6 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-800" />
              )}
              
              <div className="flex items-start gap-2.5">
                {blockIcon(block.status)}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-xs font-bold text-slate-800 dark:text-white truncate">
                      {block.name}
                    </p>
                    {block.slaHours ? (
                      <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                        {block.slaHours}h SLA
                      </span>
                    ) : null}
                  </div>
                  
                  <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                    {block.status === 'NOT_ACTIVE' && 'Chưa kích hoạt'}
                    {block.status === 'ACTIVE' && <span className="text-amber-600 dark:text-amber-400 font-bold">Đang chờ duyệt</span>}
                    {block.status === 'COMPLETED' && <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Đã duyệt</span>}
                    {block.status === 'RETURNED' && <span className="text-orange-600 dark:text-orange-400 font-semibold">Đã trả lại</span>}
                    {block.status === 'CANCELLED' && 'Đã hủy'}
                  </p>

                  <div className="mt-2 space-y-1.5 pl-1">
                    {block.assignments.map(assignment => (
                      <div
                        key={assignment.id}
                        className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800"
                      >
                        <div className="flex items-center justify-between gap-1 font-semibold text-slate-700 dark:text-slate-200">
                          <span className="truncate">{assignment.approver.name}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            assignment.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
                            assignment.status === 'REJECTED' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' :
                            assignment.status === 'RETURNED' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' :
                            'bg-slate-200/60 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                          }`}>
                            {assignment.status}
                          </span>
                        </div>
                        {assignment.comment && (
                          <p className="mt-1.5 italic text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 p-1.5 rounded border border-slate-200/60 dark:border-slate-700/60">
                            “{assignment.comment}”
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Activity Timeline Card */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
          Lịch sử hoạt động
        </h3>
        
        <ol className="relative space-y-4 border-l border-slate-200 pl-4 dark:border-slate-800 text-xs">
          {detail.timeline.map(event => (
            <li key={event.id} className="relative">
              <span className="absolute -left-[21px] top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 shadow-sm dark:border-slate-900" />
              
              <div className="flex items-center justify-between gap-1">
                <p className="font-bold text-slate-800 dark:text-white">
                  {event.eventType}
                </p>
                <span className="text-[10px] text-slate-400 font-medium shrink-0">
                  {new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(event.createdAt))}
                </span>
              </div>
              
              <p className="text-[11px] text-slate-500 mt-0.5">
                {event.actor?.name ?? 'Hệ thống'}
              </p>
              
              {event.comment && (
                <p className="mt-1 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600 dark:bg-slate-800/80 dark:text-slate-300 border border-slate-100 dark:border-slate-800">
                  {event.comment}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
};

