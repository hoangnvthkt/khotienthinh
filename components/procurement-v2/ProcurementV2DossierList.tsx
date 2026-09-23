import React from 'react';
import { ArrowRight, CalendarDays, FolderOpen, MapPin } from 'lucide-react';
import type { ProcurementV2DossierCard } from '../../types/procurementV2';
import { dossierSourceLabel } from '../../lib/procurement/procurementV2Presentation';

const stageLabel: Record<ProcurementV2DossierCard['stage'], string> = {
  reconcile: 'Cần đối chiếu', plan_supply: 'Cần bố trí nguồn',
  monitor_fulfillment: 'Theo dõi thực hiện', withdrawn: 'Đã rút nhu cầu',
};
const dateLabel = (date: string | null) => date
  ? new Date(`${date}T00:00:00Z`).toLocaleDateString('vi-VN', { timeZone: 'UTC' }) : 'Chưa rõ';

export const ProcurementV2DossierList: React.FC<{
  dossiers: ProcurementV2DossierCard[];
  onOpen: (dossier: ProcurementV2DossierCard) => void;
  projectNames?: Record<string, string>;
}> = ({ dossiers, onOpen, projectNames = {} }) => <div className="grid gap-3">
  {dossiers.map(dossier => <article key={dossier.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-200">{dossierSourceLabel(dossier.sourceAdapter)}</span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${dossier.stage === 'reconcile' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'}`}>{stageLabel[dossier.stage]}</span>
        </div>
        <h3 className="mt-3 truncate text-lg font-bold text-slate-900 dark:text-white">{dossier.sourceCode}</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{projectNames[dossier.projectId] || 'Dự án chưa có tên'} · {dossier.lineCount} vật tư</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1"><CalendarDays size={14} />Cần sớm nhất: {dateLabel(dossier.earliestNeededDate)}</span>
          <span className="inline-flex items-center gap-1"><MapPin size={14} />{dossier.destinationSummary || 'Điểm nhận chưa rõ'}</span>
          {dossier.assigneeName && <span>Phụ trách: {dossier.assigneeName}</span>}
        </div>
      </div>
      <button type="button" onClick={() => onOpen(dossier)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:bg-emerald-600">
        <FolderOpen size={17} />Mở hồ sơ<ArrowRight size={16} />
      </button>
    </div>
  </article>)}
</div>;
