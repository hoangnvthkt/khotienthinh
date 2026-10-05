import React from 'react';
import { AlertTriangle, Check, Clock, Inbox } from 'lucide-react';

export interface WorkflowKpiValues {
    waitingForMe: number;
    needsAttention: number;
    running: number;
    completed: number;
    runningTemplates: number;
}

const Tile: React.FC<{ label: string; value: number; hint: string; tone: string; icon: React.ReactNode; onClick?: () => void }> = ({ label, value, hint, tone, icon, onClick }) => {
    const className = 'flex min-w-[10.5rem] shrink-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left dark:border-slate-800 dark:bg-slate-900 md:min-w-0 md:px-4 md:py-3';
    const content = (
        <>
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
            <span className="min-w-0">
                <span className="block text-xl font-bold leading-none tabular-nums text-slate-900 dark:text-white md:text-2xl">{value}</span>
                <span className="mt-1 block truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
                <span className="block truncate text-[11px] text-slate-400">{hint}</span>
            </span>
        </>
    );
    // Only tiles that lead somewhere are buttons; the rest are plain figures.
    return onClick
        ? <button type="button" onClick={onClick} className={`${className} transition hover:border-mint-300`}>{content}</button>
        : <div className={className}>{content}</div>;
};

/** Four numbers that answer "what needs me, what is stuck, how busy are we". Scrolls sideways on phones. */
const WorkflowKpiStrip: React.FC<{ values: WorkflowKpiValues; onWaitingClick: () => void }> = ({ values, onWaitingClick }) => (
    <div className="no-scrollbar flex gap-2 overflow-x-auto md:grid md:grid-cols-2 md:gap-3 xl:grid-cols-4">
        <Tile label="Chờ tôi duyệt" value={values.waitingForMe} hint="Cần bạn xử lý ngay" tone="bg-amber-50 text-amber-600" icon={<Inbox size={18} />} onClick={onWaitingClick} />
        <Tile label="Cần chú ý" value={values.needsAttention} hint="Quá hạn hoặc đứng yên > 3 ngày" tone="bg-rose-50 text-rose-500" icon={<AlertTriangle size={18} />} />
        <Tile label="Đang xử lý" value={values.running} hint={`${values.runningTemplates} quy trình`} tone="bg-sky-50 text-sky-600" icon={<Clock size={18} />} />
        <Tile label="Hoàn thành" value={values.completed} hint="Trong danh sách gần đây" tone="bg-mint-50 text-mint-600" icon={<Check size={18} />} />
    </div>
);

export default WorkflowKpiStrip;
