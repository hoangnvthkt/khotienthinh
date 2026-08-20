import type {
  ProjectMaterialReconciliationRow,
  ProjectMaterialReconciliationSummary,
} from '../types';
import {
  normalizeProjectMaterialReconciliationRow,
  summarizeProjectMaterialReconciliation,
} from './projectMaterialReconciliation';
import { isSupabaseConfigured, supabase } from './supabase';

export type ProjectMaterialReconciliationReport = {
  reportDate: string;
  plannedProgressPercent: number;
  rows: ProjectMaterialReconciliationRow[];
  summary: ProjectMaterialReconciliationSummary;
};

export const projectMaterialReconciliationService = {
  async getReport(input: {
    projectId: string;
    constructionSiteId?: string | null;
    reportDate: string;
    plannedProgressPercent: number;
  }): Promise<ProjectMaterialReconciliationReport> {
    if (!isSupabaseConfigured) {
      return {
        reportDate: input.reportDate,
        plannedProgressPercent: input.plannedProgressPercent,
        rows: [],
        summary: summarizeProjectMaterialReconciliation([]),
      };
    }
    const { data, error } = await supabase.rpc('get_project_material_boq_reconciliation', {
      p_project_id: input.projectId,
      p_construction_site_id: input.constructionSiteId || null,
      p_report_date: input.reportDate,
      p_planned_progress_percent: input.plannedProgressPercent,
    });
    if (error) throw error;
    const rows = (data || []).map(normalizeProjectMaterialReconciliationRow);
    return {
      reportDate: input.reportDate,
      plannedProgressPercent: input.plannedProgressPercent,
      rows,
      summary: summarizeProjectMaterialReconciliation(rows),
    };
  },
};
