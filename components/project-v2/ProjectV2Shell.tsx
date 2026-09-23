import React from 'react';
import type { ProjectV2PlanType } from '../../types/projectV2';

const steps: { type: ProjectV2PlanType; title: string; caption: string }[] = [
  { type: 'month', title: 'Kế hoạch tháng', caption: 'Từ hợp đồng và BOQ' },
  { type: 'construction', title: 'Thi công', caption: 'Từ tháng đã duyệt' },
  { type: 'material', title: 'Vật tư', caption: 'Từ công việc và định mức' },
];

interface Props {
  projectName: string;
  projectCode?: string;
  clientName?: string | null;
  siteName: string | null;
  planType: ProjectV2PlanType;
  primaryAction: React.ReactNode;
  children: React.ReactNode;
}

export function ProjectV2Shell({ projectName, projectCode, clientName, siteName, planType, primaryAction, children }: Props) {
  return <main className="mx-auto w-full max-w-7xl min-w-0 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">Dự án V2 · Không gian kế hoạch</p>
        <h1 className="mt-1 break-words text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-3xl">{projectName}</h1>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
          {projectCode && <span>{projectCode}</span>}
          {clientName && <span>Khách hàng: {clientName}</span>}
          {siteName && <span>Công trường: {siteName}</span>}
        </p>
      </div>
      <div className="shrink-0">{primaryAction}</div>
    </header>
    <nav aria-label="Luồng kế hoạch" className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:gap-2">
      {steps.map((step, index) => <div key={step.type} aria-current={step.type === planType ? 'step' : undefined}
        className={`min-w-0 rounded-xl px-2 py-3 sm:px-4 ${step.type === planType ? 'bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100' : 'text-slate-600 dark:text-slate-300'}`}>
        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold sm:h-6 sm:w-6 sm:text-xs ${step.type === planType ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{index + 1}</span>
          <span className="text-xs font-semibold sm:text-sm">{step.title}</span>
        </div>
        <p className="ml-8 mt-1 hidden text-xs opacity-75 sm:block">{step.caption}</p>
      </div>)}
    </nav>
    {children}
  </main>;
}
