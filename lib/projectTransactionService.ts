import { ProjectCostCategory, ProjectTransaction, ProjectTxType } from '../types';
import {
  normalizeProjectTransactionRow,
  projectTransactionToDb,
} from './projectTransactionMapping';
import { supabase } from './supabase';

const TABLE = 'project_transactions';

const normalize = (row: any): ProjectTransaction => normalizeProjectTransactionRow(row);
const txPayload = (tx: ProjectTransaction) => projectTransactionToDb(tx);

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
