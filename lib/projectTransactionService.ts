import { ProjectCostCategory, ProjectTransaction, ProjectTxType } from '../types';
import { fromDb } from './dbMapping';
import { supabase } from './supabase';

const TABLE = 'project_transactions';

const normalize = (row: any): ProjectTransaction => ({
  ...fromDb(row),
  projectId: row.project_id ?? row.projectId ?? null,
  projectFinanceId: row.project_finance_id ?? row.projectFinanceId ?? '',
  constructionSiteId: row.construction_site_id ?? row.constructionSiteId ?? '',
  sourceRef: row.source_ref ?? row.sourceRef ?? undefined,
  createdAt: row.created_at ?? row.createdAt,
});

const txPayload = (tx: ProjectTransaction) => ({
  id: tx.id,
  projectFinanceId: tx.projectFinanceId || '',
  constructionSiteId: tx.constructionSiteId || '',
  project_id: tx.projectId || null,
  project_finance_id: tx.projectFinanceId || null,
  construction_site_id: tx.constructionSiteId || null,
  type: tx.type,
  category: tx.category,
  amount: tx.amount,
  description: tx.description,
  date: tx.date,
  source: tx.source,
  sourceRef: tx.sourceRef || null,
  source_ref: tx.sourceRef || null,
  attachments: tx.attachments || [],
  createdBy: tx.createdBy || null,
  createdAt: tx.createdAt,
});

export const projectTransactionService = {
  async findBySourceRef(sourceRef: string): Promise<ProjectTransaction | null> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('source_ref', sourceRef)
      .maybeSingle();
    if (error) throw error;
    return data ? normalize(data) : null;
  },

  async resolveProjectFinanceId(projectId: string | null | undefined, constructionSiteId: string | null | undefined): Promise<string> {
    if (!projectId && !constructionSiteId) return '';
    let query = supabase.from('project_finances').select('*').limit(1);
    if (projectId) {
      query = query.eq('project_id', projectId);
    } else if (constructionSiteId) {
      query = query.eq('construction_site_id', constructionSiteId);
    }
    const { data, error } = await query;
    if (error) {
      console.warn('Cannot resolve project_finances for workflow transaction', error.message);
      return '';
    }
    return data?.[0]?.id || '';
  },

  async ensureWorkflowTransaction(input: {
    sourceRef: string;
    projectId?: string | null;
    constructionSiteId?: string | null;
    type: ProjectTxType;
    category: ProjectCostCategory;
    amount: number;
    description: string;
    date?: string;
    createdBy?: string;
  }): Promise<ProjectTransaction> {
    const existing = await this.findBySourceRef(input.sourceRef);
    if (existing) return existing;

    const projectFinanceId = await this.resolveProjectFinanceId(input.projectId, input.constructionSiteId);
    const tx: ProjectTransaction = {
      id: crypto.randomUUID(),
      projectId: input.projectId || null,
      projectFinanceId,
      constructionSiteId: input.constructionSiteId || '',
      type: input.type,
      category: input.category,
      amount: Number(input.amount || 0),
      description: input.description,
      date: input.date || new Date().toISOString().slice(0, 10),
      source: 'workflow',
      sourceRef: input.sourceRef,
      attachments: [],
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(txPayload(tx), { onConflict: 'source_ref' })
      .select()
      .single();
    if (error) throw error;
    return data ? normalize(data) : tx;
  },

  async reverseWorkflowTransaction(input: {
    sourceRef: string;
    reversalSourceRef?: string;
    description?: string;
    date?: string;
    createdBy?: string;
  }): Promise<ProjectTransaction | null> {
    const original = await this.findBySourceRef(input.sourceRef);
    if (!original) return null;

    const reversalSourceRef = input.reversalSourceRef || `${input.sourceRef}:reversal`;
    const existing = await this.findBySourceRef(reversalSourceRef);
    if (existing) return existing;

    const tx: ProjectTransaction = {
      ...original,
      id: crypto.randomUUID(),
      amount: -Number(original.amount || 0),
      description: input.description || `Rollback: ${original.description}`,
      date: input.date || new Date().toISOString().slice(0, 10),
      source: 'workflow',
      sourceRef: reversalSourceRef,
      attachments: [],
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(txPayload(tx), { onConflict: 'source_ref' })
      .select()
      .single();
    if (error) throw error;
    return data ? normalize(data) : tx;
  },
};
