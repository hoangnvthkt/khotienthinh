import React from 'react';
import { CalendarDays, HardHat, PackageCheck } from 'lucide-react';
import type { ProjectV2PlanType } from '../../types/projectV2';

const steps: { type: ProjectV2PlanType; title: string; caption: string; icon: typeof CalendarDays; color: string }[] = [
  { type: 'month', title: 'Kế hoạch tháng', caption: 'Từ hợp đồng và BOQ', icon: CalendarDays,
    color: 'from-indigo-500 to-blue-600' },
  { type: 'construction', title: 'Thi công', caption: 'Từ tháng đã duyệt', icon: HardHat,
    color: 'from-cyan-500 to-teal-600' },
  { type: 'material', title: 'Vật tư', caption: 'Từ công việc và định mức', icon: PackageCheck,
    color: 'from-emerald-500 to-teal-700' },
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
  return <main className="min-h-screen bg-[radial-gradient(circle_at_10%_0%,#effcfb_0%,#f8fbff_35%,#f8fafc_72%)] pb-10 dark:bg-slate-950">
    <div className="mx-auto w-full max-w-7xl min-w-0 space-y-5 px-4 py-6 sm:px-6 lg:px-8">
    <header className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#25183e] via-[#302957] to-[#23384f] px-5 py-6 text-white shadow-[0_18px_45px_-20px_rgba(39,37,79,0.65)] sm:px-8 sm:py-8">
      <div className="pointer-events-none absolute -left-16 -top-24 h-64 w-64 rounded-full bg-fuchsia-500/20 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-24 right-8 h-60 w-60 rounded-full bg-cyan-400/15 blur-3xl" aria-hidden="true" />
      <div className="relative flex min-w-0 flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200">Không gian kế hoạch · Dự án V2</p>
          <h1 className="mt-2 break-words text-2xl font-extrabold tracking-tight sm:text-3xl">{projectName}</h1>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium text-slate-100/90">
            {projectCode && <span className="rounded-lg border border-cyan-200/20 bg-cyan-300/10 px-2.5 py-1 text-cyan-100">{projectCode}</span>}
            {clientName && <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1">Khách hàng: {clientName}</span>}
            {siteName && <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1">Công trường: {siteName}</span>}
          </div>
        </div>
        <div className="shrink-0 [&>button]:border [&>button]:border-white/20 [&>button]:bg-white [&>button]:text-slate-900 [&>button]:shadow-lg [&>button]:hover:bg-slate-100">{primaryAction}</div>
      </div>
    </header>
    <nav aria-label="Luồng kế hoạch" className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200/80 bg-white p-2 shadow-[0_8px_24px_-16px_rgba(30,41,59,0.35)] dark:border-slate-700 dark:bg-slate-900 sm:gap-3 sm:p-3">
      {steps.map(step => {
        const Icon = step.icon;
        const active = step.type === planType;
        return <div key={step.type} aria-current={active ? 'step' : undefined}
          className={`min-w-0 rounded-xl px-2 py-2.5 sm:flex sm:items-center sm:gap-3 sm:px-4 sm:py-3 ${active ? 'bg-indigo-50/80 ring-1 ring-indigo-100 dark:bg-indigo-950/50 dark:ring-indigo-800' : 'text-slate-600 dark:text-slate-300'}`}>
          <span className={`mb-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm sm:mb-0 ${step.color}`}><Icon size={17} aria-hidden="true" /></span>
          <span className="block min-w-0"><span className={`block text-[11px] font-bold leading-tight sm:text-sm ${active ? 'text-slate-900 dark:text-white' : ''}`}>{step.title}</span>
            <span className="mt-0.5 hidden text-xs text-slate-500 dark:text-slate-400 lg:block">{step.caption}</span></span>
        </div>;
      })}
    </nav>
    {children}
    </div>
  </main>;
}
