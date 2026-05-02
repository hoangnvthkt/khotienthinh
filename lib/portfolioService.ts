import { supabase } from './supabase';
import type { ProjectTask } from '../types';
import { calculateProjectProgress } from './projectScheduleRules';

/* ──────────────────────────────────────────────
   Portfolio Service — cross-project aggregates
   ────────────────────────────────────────────── */

export interface ProjectSummary {
  projectId: string;
  siteId: string;
  siteName: string;
  siteAddress?: string;
  status: string;
  contractValue: number;
  totalExpense: number;
  totalRevenue: number;
  acceptedValue: number;
  profit: number;
  profitPercent: number;
  progressPercent: number;
  contractCount: number;
  taskCount: number;
  taskDone: number;
  acceptanceCount: number;
  boqItemCount: number;
  wasteOverCount: number;
  vendorCount: number;
  poCount: number;
  poValue: number;
  logCount: number;
  overduePayments: number;
  startDate?: string;
  endDate?: string;
}

export interface PortfolioKPIs {
  totalProjects: number;
  activeProjects: number;
  totalContractValue: number;
  totalExpense: number;
  totalRevenue: number;
  totalAcceptedValue: number;
  totalProfit: number;
  avgProgress: number;
  totalWasteOver: number;
  totalOverduePayments: number;
}

async function fetchProjectSummaries(): Promise<ProjectSummary[]> {
  // Fetch only needed columns — avoid N+1
  const [
    { data: projects },
    { data: sites },
    { data: finances },
    { data: contracts },
    { data: tasks },
    { data: acceptances },
    { data: boqItems },
    { data: vendors },
    { data: pos },
    { data: logs },
    { data: payments },
  ] = await Promise.all([
    supabase.from('projects').select('id, code, name, status, construction_site_id, start_date, end_date'),
    supabase.from('hrm_construction_sites').select('id, name, address'),
    supabase.from('project_finances').select('project_id, "constructionSiteId", "contractValue", "actualMaterials", "actualLabor", "actualSubcontract", "actualMachinery", "actualOverhead", "revenueReceived", "progressPercent", status'),
    supabase.from('project_contracts').select('id, project_id, construction_site_id, type, value'),
    supabase.from('project_tasks').select('id, project_id, construction_site_id, parent_id, name, start_date, end_date, duration, progress, gate_status, is_milestone, resource_count, estimated_cost_per_day, sort_order'),
    supabase.from('acceptance_records').select('id, project_id, construction_site_id, approved_value, payable_amount, status'),
    supabase.from('material_budget_items').select('id, project_id, construction_site_id, waste_percent, waste_threshold'),
    supabase.from('project_vendors').select('id, project_id, construction_site_id'),
    supabase.from('purchase_orders').select('id, project_id, construction_site_id, total_amount'),
    supabase.from('daily_logs').select('id, project_id, construction_site_id'),
    supabase.from('payment_schedules').select('id, project_id, construction_site_id, status, amount, due_date'),
  ]);

  const projectRows = (projects && projects.length > 0)
    ? projects
    : (sites || []).map((site: any) => ({
      id: site.id,
      name: site.name,
      status: 'planning',
      construction_site_id: site.id,
    }));

  if (projectRows.length === 0) return [];

  const siteMap = new Map((sites || []).map((site: any) => [site.id, site]));
  const scoped = (items: any[] | null, projectId: string, siteId?: string | null, siteKey = 'construction_site_id') =>
    (items || []).filter((item: any) => item.project_id === projectId || (siteId && item[siteKey] === siteId));
  const scopedFinances = (items: any[] | null, projectId: string, siteId?: string | null) =>
    (items || []).filter((item: any) => item.project_id === projectId || (siteId && item.constructionSiteId === siteId));

  const today = new Date().toISOString().split('T')[0];

  return projectRows.map((project: any) => {
    const projectId = project.id;
    const siteId = project.construction_site_id || null;
    const site = siteId ? siteMap.get(siteId) : null;
    const finance = scopedFinances(finances as any, projectId, siteId)[0];

    const siteContracts = scoped(contracts as any, projectId, siteId);
    const siteTasks = scoped(tasks as any, projectId, siteId);
    const siteAcceptances = scoped(acceptances as any, projectId, siteId);
    const siteBoq = scoped(boqItems as any, projectId, siteId);
    const siteVendors = scoped(vendors as any, projectId, siteId);
    const sitePos = scoped(pos as any, projectId, siteId);
    const siteLogs = scoped(logs as any, projectId, siteId);
    const sitePayments = scoped(payments as any, projectId, siteId);

    const contractValue = finance?.contractValue || siteContracts.filter((c: any) => c.type === 'main').reduce((s: number, c: any) => s + (c.value || 0), 0);
    const totalExpense = finance
      ? (finance.actualMaterials || 0) + (finance.actualLabor || 0) + (finance.actualSubcontract || 0) + (finance.actualMachinery || 0) + (finance.actualOverhead || 0)
      : 0;
    const totalRevenue = finance?.revenueReceived || 0;

    // ✅ Fixed: include accepted (approved) value for accurate profit calculation
    const acceptedValue = siteAcceptances
      .filter((a: any) => a.status === 'approved')
      .reduce((s: number, a: any) => s + (a.approved_value || a.payable_amount || 0), 0);

    // Profit = max(revenue, acceptedValue) - totalExpense
    const effectiveRevenue = Math.max(totalRevenue, acceptedValue);
    const profit = effectiveRevenue - totalExpense;

    const mappedTasks: ProjectTask[] = siteTasks.map((t: any) => ({
      id: t.id,
      constructionSiteId: t.construction_site_id,
      parentId: t.parent_id || undefined,
      name: t.name || '',
      startDate: t.start_date || today,
      endDate: t.end_date || today,
      duration: t.duration || 0,
      progress: t.progress || 0,
      gateStatus: t.gate_status || 'none',
      isMilestone: !!t.is_milestone,
      resourceCount: t.resource_count || 1,
      estimatedCostPerDay: t.estimated_cost_per_day || 0,
      order: t.sort_order || 0,
    }));
    const progressSummary = calculateProjectProgress(mappedTasks);
    const avgProgress = progressSummary.leafTaskCount > 0
      ? progressSummary.progressPercent
      : (finance?.progressPercent || 0);

    // Dates from tasks
    const taskStartDates = siteTasks.filter((t: any) => t.start_date).map((t: any) => t.start_date);
    const taskEndDates = siteTasks.filter((t: any) => t.end_date).map((t: any) => t.end_date);

    return {
      projectId,
      siteId: siteId || projectId,
      siteName: project.name || site?.name || 'N/A',
      siteAddress: site?.address,
      status: finance?.status || project.status || 'planning',
      contractValue,
      totalExpense,
      totalRevenue,
      acceptedValue,
      profit,
      profitPercent: contractValue > 0 ? (profit / contractValue) * 100 : 0,
      progressPercent: avgProgress,
      contractCount: siteContracts.length,
      taskCount: siteTasks.length,
      taskDone: progressSummary.completedLeafCount,
      acceptanceCount: siteAcceptances.length,
      boqItemCount: siteBoq.length,
      wasteOverCount: siteBoq.filter((b: any) => (b.waste_percent || 0) > (b.waste_threshold || 999)).length,
      vendorCount: siteVendors.length,
      poCount: sitePos.length,
      poValue: sitePos.reduce((s: number, p: any) => s + (p.total_amount || 0), 0),
      logCount: siteLogs.length,
      overduePayments: sitePayments.filter((p: any) => {
        const isUnpaid = p.status === 'pending' || p.status === 'overdue' || p.status === 'partial';
        return isUnpaid && p.due_date && p.due_date < today;
      }).length,
      startDate: project.start_date || (taskStartDates.length > 0 ? taskStartDates.sort()[0] : undefined),
      endDate: project.end_date || (taskEndDates.length > 0 ? taskEndDates.sort().reverse()[0] : undefined),
    };
  });
}

function computeKPIs(summaries: ProjectSummary[]): PortfolioKPIs {
  return {
    totalProjects: summaries.length,
    activeProjects: summaries.filter(s => s.status === 'active').length,
    totalContractValue: summaries.reduce((s, p) => s + p.contractValue, 0),
    totalExpense: summaries.reduce((s, p) => s + p.totalExpense, 0),
    totalRevenue: summaries.reduce((s, p) => s + p.totalRevenue, 0),
    totalAcceptedValue: summaries.reduce((s, p) => s + p.acceptedValue, 0),
    totalProfit: summaries.reduce((s, p) => s + p.profit, 0),
    avgProgress: summaries.length > 0 ? Math.round(summaries.reduce((s, p) => s + p.progressPercent, 0) / summaries.length) : 0,
    totalWasteOver: summaries.reduce((s, p) => s + p.wasteOverCount, 0),
    totalOverduePayments: summaries.reduce((s, p) => s + p.overduePayments, 0),
  };
}

export const portfolioService = {
  getSummaries: fetchProjectSummaries,
  getKPIs: (summaries: ProjectSummary[]) => computeKPIs(summaries),
};
