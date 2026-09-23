import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import type { ProjectV2PlanSummary } from '../../lib/projectV2/readService';
import { getProjectV2StatusLabel } from '../../lib/projectV2/presentation';

interface Props { plans: readonly ProjectV2PlanSummary[]; ownerNames: Record<string, string> }
const dateLabel = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
const ownerLabel = (plan: ProjectV2PlanSummary, names: Record<string, string>) =>
  plan.ownerUserId ? names[plan.ownerUserId] ?? plan.ownerUserId : names[plan.creatorUserId] ?? 'Chưa phân công';

export function ProjectV2PlanList({ plans, ownerNames }: Props) {
  if (!plans.length) return <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
    <p className="font-semibold text-slate-800 dark:text-slate-100">Chưa có kế hoạch phù hợp</p>
    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Đổi bộ lọc hoặc tạo kế hoạch đầu tiên cho dự án.</p>
  </div>;
  return <>
    <div className="space-y-3 sm:hidden">
      {plans.map(plan => <Link key={plan.id} to={`/project-v2/plans/${plan.id}`}
        className="block min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="text-xs font-medium text-slate-500">{plan.code} · Bản {plan.revision}</p>
            <h3 className="mt-1 break-words font-semibold text-slate-950 dark:text-white">{plan.title}</h3></div>
          <ArrowUpRight size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-300">
          <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold dark:bg-slate-800">{getProjectV2StatusLabel(plan.status)}</span>
          <span>{ownerLabel(plan, ownerNames)}</span>
          <span>{dateLabel(plan.periodStart)} – {dateLabel(plan.periodEnd)}</span>
        </div>
      </Link>)}
    </div>
    <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:block">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300"><tr>
          <th className="w-[38%] px-4 py-3">Kế hoạch</th><th className="w-[18%] px-4 py-3">Trạng thái</th>
          <th className="w-[20%] px-4 py-3">Phụ trách</th><th className="w-[24%] px-4 py-3">Kỳ kế hoạch</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {plans.map(plan => <tr key={plan.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td className="px-4 py-4"><Link to={`/project-v2/plans/${plan.id}`} className="group font-semibold text-slate-900 hover:text-teal-700 dark:text-white dark:hover:text-teal-300">
              <span className="block truncate">{plan.title}</span><span className="mt-0.5 block text-xs font-normal text-slate-500">{plan.code} · Bản {plan.revision}</span>
            </Link></td>
            <td className="px-4 py-4 text-slate-700 dark:text-slate-200">{getProjectV2StatusLabel(plan.status)}</td>
            <td className="truncate px-4 py-4 text-slate-700 dark:text-slate-200">{ownerLabel(plan, ownerNames)}</td>
            <td className="px-4 py-4 text-slate-600 dark:text-slate-300">{dateLabel(plan.periodStart)} – {dateLabel(plan.periodEnd)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </>;
}
