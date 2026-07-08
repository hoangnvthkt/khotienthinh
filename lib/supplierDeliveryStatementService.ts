import type {
  SupplierContractLine,
  SupplierDeliveryStatement,
  SupplierDeliveryStatementLine,
  SupplierDirectDeliveryLine,
  SupplierDirectDeliveryLineStatus,
  SupplierDirectDeliveryNote,
  SupplierDirectDeliveryNoteStatus,
  SupplierPayableDocument,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { supabase } from './supabase';

const CONTRACT_LINE_TABLE = 'supplier_contract_lines';
const DELIVERY_NOTE_TABLE = 'supplier_direct_delivery_notes';
const DELIVERY_LINE_TABLE = 'supplier_direct_delivery_lines';
const STATEMENT_TABLE = 'supplier_delivery_statements';
const STATEMENT_LINE_TABLE = 'supplier_delivery_statement_lines';

const numeric = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
};

const quantity = (value: unknown) => Math.round(numeric(value) * 1_000_000) / 1_000_000;
const money = (value: unknown) => Math.round(numeric(value) * 100) / 100;

const compact = <T extends Record<string, any>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

export const calculateSupplierDirectDeliveryLineTotals = (input: {
  quantity: number;
  unitPrice: number;
  vatRate?: number | null;
}) => {
  const lineAmount = money(numeric(input.quantity) * numeric(input.unitPrice));
  const vatAmount = money(lineAmount * numeric(input.vatRate) / 100);
  return {
    lineAmount,
    vatAmount,
    totalAmount: money(lineAmount + vatAmount),
  };
};

export const calculateSupplierDeliveryStatementTotals = (lines: SupplierDirectDeliveryLine[]) => {
  const acceptedLines = lines.filter(line => line.status === 'accepted' || line.status === 'adjusted');
  return acceptedLines.reduce((totals, line) => {
    const acceptedTotal = money(line.acceptedAmount || line.totalAmount || line.lineAmount + line.vatAmount);
    const vatRate = numeric(line.vatRate);
    const grossAmount = vatRate > 0 ? money(acceptedTotal / (1 + vatRate / 100)) : acceptedTotal;
    const vatAmount = money(acceptedTotal - grossAmount);
    return {
      grossAmount: money(totals.grossAmount + grossAmount),
      vatAmount: money(totals.vatAmount + vatAmount),
      totalAmount: money(totals.totalAmount + acceptedTotal),
    };
  }, { grossAmount: 0, vatAmount: 0, totalAmount: 0 });
};

const normalizeContractLine = (row: any): SupplierContractLine => ({
  ...(fromDb(row) as SupplierContractLine),
  unitPrice: money(row.unit_price),
  vatRate: numeric(row.vat_rate),
  quantityLimit: row.quantity_limit == null ? null : quantity(row.quantity_limit),
  amountLimit: row.amount_limit == null ? null : money(row.amount_limit),
});

const normalizeDeliveryNote = (row: any): SupplierDirectDeliveryNote => ({
  ...(fromDb(row) as SupplierDirectDeliveryNote),
  grossAmount: money(row.gross_amount),
  vatAmount: money(row.vat_amount),
  totalAmount: money(row.total_amount),
  attachments: row.attachments || [],
});

const normalizeDeliveryLine = (row: any): SupplierDirectDeliveryLine => ({
  ...(fromDb(row) as SupplierDirectDeliveryLine),
  quantity: quantity(row.quantity),
  unitPrice: money(row.unit_price),
  vatRate: numeric(row.vat_rate),
  lineAmount: money(row.line_amount),
  vatAmount: money(row.vat_amount),
  totalAmount: money(row.total_amount),
  acceptedQuantity: quantity(row.accepted_quantity),
  acceptedAmount: money(row.accepted_amount),
  issueReason: row.issue_reason || null,
});

const normalizeStatement = (row: any): SupplierDeliveryStatement => ({
  ...(fromDb(row) as SupplierDeliveryStatement),
  grossAmount: money(row.gross_amount),
  vatAmount: money(row.vat_amount),
  totalAmount: money(row.total_amount),
  attachments: row.attachments || [],
  metadata: row.metadata || {},
});

const normalizeStatementLine = (row: any): SupplierDeliveryStatementLine => ({
  ...(fromDb(row) as SupplierDeliveryStatementLine),
  acceptedQuantity: quantity(row.accepted_quantity),
  acceptedAmount: money(row.accepted_amount),
  vatAmount: money(row.vat_amount),
  totalAmount: money(row.total_amount),
});

const normalizePayableDocument = (row: any): SupplierPayableDocument => {
  const mapped = fromDb(row) as SupplierPayableDocument;
  const paidAmount = money((mapped as any).paidAmount ?? (mapped as any).allocatedPaidAmount ?? 0);
  const creditAmount = money(mapped.creditAmount || 0);
  const recognizedAmount = money(mapped.recognizedAmount || 0);
  return {
    ...mapped,
    currency: mapped.currency || 'VND',
    paidAmount,
    creditAmount,
    outstandingAmount: money((mapped as any).outstandingAmount ?? Math.max(0, recognizedAmount - paidAmount - creditAmount)),
    metadata: mapped.metadata || {},
  };
};

const deliveryLinePayload = (line: SupplierDirectDeliveryLine) => {
  const totals = calculateSupplierDirectDeliveryLineTotals(line);
  return toDb(compact({
    ...line,
    ...totals,
    acceptedQuantity: line.acceptedQuantity ?? 0,
    acceptedAmount: line.acceptedAmount ?? 0,
  }));
};

const statementPayload = (statement: SupplierDeliveryStatement, lines: SupplierDirectDeliveryLine[] = []) => {
  const totals = lines.length > 0
    ? calculateSupplierDeliveryStatementTotals(lines)
    : {
      grossAmount: statement.grossAmount,
      vatAmount: statement.vatAmount,
      totalAmount: statement.totalAmount,
    };
  return toDb(compact({
    ...statement,
    ...totals,
  }));
};

export const supplierContractLineService = {
  async listByContract(supplierContractId: string): Promise<SupplierContractLine[]> {
    const { data, error } = await supabase
      .from(CONTRACT_LINE_TABLE)
      .select('*')
      .eq('supplier_contract_id', supplierContractId)
      .order('line_no', { ascending: true });
    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
    return (data || []).map(normalizeContractLine);
  },

  async upsert(lines: SupplierContractLine[]): Promise<SupplierContractLine[]> {
    if (lines.length === 0) return [];
    const { data, error } = await supabase
      .from(CONTRACT_LINE_TABLE)
      .upsert(lines.map(line => toDb(compact(line))), { onConflict: 'id' })
      .select('*');
    if (error) throw error;
    return (data || []).map(normalizeContractLine);
  },
};

export const supplierDirectDeliveryService = {
  async list(input: {
    projectId?: string | null;
    constructionSiteId?: string | null;
    supplierContractId?: string | null;
    supplierId?: string | null;
    status?: string | null;
  } = {}): Promise<SupplierDirectDeliveryNote[]> {
    let query = supabase.from(DELIVERY_NOTE_TABLE).select('*').order('delivery_date', { ascending: false });
    if (input.projectId) query = query.eq('project_id', input.projectId);
    if (input.constructionSiteId) query = query.eq('construction_site_id', input.constructionSiteId);
    if (input.supplierContractId) query = query.eq('supplier_contract_id', input.supplierContractId);
    if (input.supplierId) query = query.eq('supplier_id', input.supplierId);
    if (input.status) query = query.eq('status', input.status);
    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
    return (data || []).map(normalizeDeliveryNote);
  },

  async getDetail(id: string): Promise<{ note: SupplierDirectDeliveryNote; lines: SupplierDirectDeliveryLine[] }> {
    const { data: noteRow, error: noteError } = await supabase
      .from(DELIVERY_NOTE_TABLE)
      .select('*')
      .eq('id', id)
      .single();
    if (noteError) throw noteError;

    const { data: lineRows, error: lineError } = await supabase
      .from(DELIVERY_LINE_TABLE)
      .select('*')
      .eq('delivery_note_id', id)
      .order('line_no', { ascending: true });
    if (lineError) {
      if (lineError.code === '42P01') return { note: normalizeDeliveryNote(noteRow), lines: [] };
      throw lineError;
    }
    const lines = (lineRows || []).map(normalizeDeliveryLine);
    return {
      note: {
        ...normalizeDeliveryNote(noteRow),
        lines,
      },
      lines,
    };
  },

  async upsert(note: SupplierDirectDeliveryNote, lines: SupplierDirectDeliveryLine[] = []): Promise<SupplierDirectDeliveryNote> {
    const totals = lines.length > 0
      ? lines.reduce((sum, line) => {
        const lineTotals = calculateSupplierDirectDeliveryLineTotals(line);
        return {
          grossAmount: money(sum.grossAmount + lineTotals.lineAmount),
          vatAmount: money(sum.vatAmount + lineTotals.vatAmount),
          totalAmount: money(sum.totalAmount + lineTotals.totalAmount),
        };
      }, { grossAmount: 0, vatAmount: 0, totalAmount: 0 })
      : {
        grossAmount: note.grossAmount,
        vatAmount: note.vatAmount,
        totalAmount: note.totalAmount,
      };

    const { data, error } = await supabase
      .from(DELIVERY_NOTE_TABLE)
      .upsert(toDb(compact({ ...note, ...totals })), { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;

    if (lines.length > 0) {
      const { error: lineError } = await supabase
        .from(DELIVERY_LINE_TABLE)
        .upsert(lines.map(line => deliveryLinePayload({
          ...line,
          deliveryNoteId: line.deliveryNoteId || note.id,
          supplierContractId: line.supplierContractId || note.supplierContractId,
        })), { onConflict: 'id' });
      if (lineError) throw lineError;
    }

    return normalizeDeliveryNote(data);
  },

  async setStatus(id: string, status: SupplierDirectDeliveryNoteStatus): Promise<SupplierDirectDeliveryNote> {
    const { data, error } = await supabase
      .from(DELIVERY_NOTE_TABLE)
      .update(toDb({ status }))
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return normalizeDeliveryNote(data);
  },

  async reviewLines(
    id: string,
    reviews: Array<{
      lineId: string;
      status: SupplierDirectDeliveryLineStatus;
      acceptedQuantity?: number;
      acceptedAmount?: number;
      reviewNote?: string | null;
      rejectionReason?: string | null;
    }>,
  ): Promise<{ note: SupplierDirectDeliveryNote; lines: SupplierDirectDeliveryLine[] }> {
    for (const review of reviews) {
      const { error } = await supabase
        .from(DELIVERY_LINE_TABLE)
        .update(toDb({
          status: review.status,
          acceptedQuantity: review.status === 'rejected' ? 0 : quantity(review.acceptedQuantity),
          acceptedAmount: review.status === 'rejected' ? 0 : money(review.acceptedAmount),
          rejectionReason: review.status === 'rejected' ? review.rejectionReason || review.reviewNote || 'Không được duyệt' : null,
          note: review.reviewNote || null,
        }))
        .eq('id', review.lineId)
        .eq('delivery_note_id', id);
      if (error) throw error;
    }
    return this.getDetail(id);
  },
};

export const supplierDeliveryStatementService = {
  async list(input: {
    projectId?: string | null;
    constructionSiteId?: string | null;
    supplierContractId?: string | null;
    supplierId?: string | null;
    status?: string | null;
    periodMonth?: string | null;
  } = {}): Promise<SupplierDeliveryStatement[]> {
    let query = supabase.from(STATEMENT_TABLE).select('*').order('statement_date', { ascending: false });
    if (input.projectId) query = query.eq('project_id', input.projectId);
    if (input.constructionSiteId) query = query.eq('construction_site_id', input.constructionSiteId);
    if (input.supplierContractId) query = query.eq('supplier_contract_id', input.supplierContractId);
    if (input.supplierId) query = query.eq('supplier_id', input.supplierId);
    if (input.status) query = query.eq('status', input.status);
    if (input.periodMonth) query = query.eq('period_month', input.periodMonth);
    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
    return (data || []).map(normalizeStatement);
  },

  async listStatementLines(statementId: string): Promise<SupplierDeliveryStatementLine[]> {
    const { data, error } = await supabase
      .from(STATEMENT_LINE_TABLE)
      .select('*')
      .eq('statement_id', statementId)
      .order('created_at', { ascending: true });
    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
    return (data || []).map(normalizeStatementLine);
  },

  async getDetail(id: string): Promise<{
    statement: SupplierDeliveryStatement;
    lines: SupplierDeliveryStatementLine[];
  }> {
    const { data, error } = await supabase
      .from(STATEMENT_TABLE)
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return {
      statement: normalizeStatement(data),
      lines: await this.listStatementLines(id),
    };
  },

  async upsert(statement: SupplierDeliveryStatement, deliveryLines: SupplierDirectDeliveryLine[] = []): Promise<SupplierDeliveryStatement> {
    const acceptedLines = deliveryLines.filter(line => line.status === 'accepted' || line.status === 'adjusted');
    const { data, error } = await supabase
      .from(STATEMENT_TABLE)
      .upsert(statementPayload(statement, acceptedLines), { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;

    if (acceptedLines.length > 0) {
      const { error: lineError } = await supabase
        .from(STATEMENT_LINE_TABLE)
        .upsert(acceptedLines.map(line => {
          const totalAmount = money(line.acceptedAmount || line.totalAmount);
          const grossAmount = line.vatRate > 0 ? money(totalAmount / (1 + numeric(line.vatRate) / 100)) : totalAmount;
          const vatAmount = money(totalAmount - grossAmount);
          return toDb(compact({
            statementId: statement.id,
            deliveryNoteId: line.deliveryNoteId,
            deliveryLineId: line.id,
            supplierContractId: line.supplierContractId || statement.supplierContractId,
            itemNameSnapshot: line.itemNameSnapshot,
            unitSnapshot: line.unitSnapshot || null,
            acceptedQuantity: line.acceptedQuantity || line.quantity,
            acceptedAmount: grossAmount,
            vatAmount,
            totalAmount,
            note: line.note || null,
          }));
        }), { onConflict: 'statement_id,delivery_line_id' });
      if (lineError) throw lineError;
    }

    return normalizeStatement(data);
  },

  async post(statementId: string, actorId?: string | null): Promise<SupplierDeliveryStatement> {
    const { data, error } = await supabase.rpc('post_supplier_delivery_statement', {
      p_statement_id: statementId,
      p_actor_id: actorId || null,
    });
    if (error) throw error;
    return normalizeStatement(Array.isArray(data) ? data[0] : data);
  },

  async reverse(statementId: string, actorId?: string | null): Promise<SupplierDeliveryStatement> {
    const { data, error } = await supabase.rpc('reverse_supplier_delivery_statement', {
      p_statement_id: statementId,
      p_actor_id: actorId || null,
    });
    if (error) throw error;
    return normalizeStatement(Array.isArray(data) ? data[0] : data);
  },

  async syncPayable(statementId: string): Promise<SupplierPayableDocument> {
    const { data, error } = await supabase.rpc('sync_supplier_payable_from_delivery_statement', {
      p_statement_id: statementId,
    });
    if (error) throw error;
    return normalizePayableDocument(Array.isArray(data) ? data[0] : data);
  },
};
