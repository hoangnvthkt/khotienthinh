import { supabase } from './supabase';

/* ──────────────────────────────────────────────
   Portfolio Service — cross-project aggregates
   ────────────────────────────────────────────── */

export interface ProjectSummary {
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
    supabase.from('hrm_construction_sites').select('id, name, address'),
    supabase.from('project_finances').select('"constructionSiteId", "contractValue", "actualMaterials", "actualLabor", "actualSubcontract", "actualMachinery", "actualOverhead", "revenueReceived", "progressPercent", status'),
    supabase.from('project_contracts').select('id, construction_site_id, type, value'),
    supabase.from('project_tasks').select('id, construction_site_id, progress, start_date, end_date'),
    supabase.from('acceptance_records').select('id, construction_site_id, approved_value, payable_amount, status'),
    supabase.from('material_budget_items').select('id, construction_site_id, waste_percent, waste_threshold'),
    supabase.from('project_vendors').select('id, construction_site_id'),
    supabase.from('purchase_orders').select('id, construction_site_id, total_amount'),
    supabase.from('daily_logs').select('id, construction_site_id'),
    supabase.from('payment_schedules').select('id, construction_site_id, status, amount, due_date'),
  ]);

  if (!sites || sites.length === 0) return [];

  // Pre-group by construction_site_id for O(n) lookup instead of O(n²)
  const group = (items: any[] | null, siteKey = 'construction_site_id'): Record<string, any[]> => {
    const map: Record<string, any[]> = {};
    for (const item of (items || [])) {
      (map[item[siteKey]] ||= []).push(item);
    }
    return map;
  };

  const financeMap = group(finances as any, 'constructionSiteId');
  const contractMap = group(contracts as any);
  const taskMap = group(tasks as any);
  const acceptanceMap = group(acceptances as any);
  const boqMap = group(boqItems as any);
  const vendorMap = group(vendors as any);
  const poMap = group(pos as any);
  const logMap = group(logs as any);
  const paymentMap = group(payments as any);

  const today = new Date().toISOString().split('T')[0];

  return sites.map((site: any) => {
    const siteId = site.id;
    const finance = (financeMap[siteId] || [])[0];

    const siteContracts = contractMap[siteId] || [];
    const siteTasks = taskMap[siteId] || [];
    const siteAcceptances = acceptanceMap[siteId] || [];
    const siteBoq = boqMap[siteId] || [];
    const siteVendors = vendorMap[siteId] || [];
    const sitePos = poMap[siteId] || [];
    const siteLogs = logMap[siteId] || [];
    const sitePayments = paymentMap[siteId] || [];

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

    const avgProgress = siteTasks.length > 0
      ? Math.round(siteTasks.reduce((s: number, t: any) => s + (t.progress || 0), 0) / siteTasks.length)
      : (finance?.progressPercent || 0);

    // Dates from tasks
    const taskStartDates = siteTasks.filter((t: any) => t.start_date).map((t: any) => t.start_date);
    const taskEndDates = siteTasks.filter((t: any) => t.end_date).map((t: any) => t.end_date);

    return {
      siteId,
      siteName: site.name || 'N/A',
      siteAddress: site.address,
      status: finance?.status || 'planning',
      contractValue,
      totalExpense,
      totalRevenue,
      acceptedValue,
      profit,
      profitPercent: contractValue > 0 ? (profit / contractValue) * 100 : 0,
      progressPercent: avgProgress,
      contractCount: siteContracts.length,
      taskCount: siteTasks.length,
      taskDone: siteTasks.filter((t: any) => t.progress >= 100).length,
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
      startDate: taskStartDates.length > 0 ? taskStartDates.sort()[0] : undefined,
      endDate: taskEndDates.length > 0 ? taskEndDates.sort().reverse()[0] : undefined,
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
