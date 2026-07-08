import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  SupplierDeliveryStatement,
  SupplierDirectDeliveryLine,
  SupplierDirectDeliveryNote,
} from '../../types';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
  },
}));

import {
  calculateSupplierDirectDeliveryLineTotals,
  calculateSupplierDeliveryStatementTotals,
  supplierDeliveryStatementService,
  supplierDirectDeliveryService,
} from '../supplierDeliveryStatementService';

const query = (response: { data?: any; error?: any } = { data: [], error: null }) => {
  const api: any = {
    select: vi.fn(() => api),
    order: vi.fn(() => api),
    eq: vi.fn(() => api),
    in: vi.fn(() => api),
    maybeSingle: vi.fn(() => Promise.resolve(response)),
    single: vi.fn(() => Promise.resolve(response)),
    upsert: vi.fn(() => api),
    insert: vi.fn(() => Promise.resolve(response)),
    update: vi.fn(() => api),
    delete: vi.fn(() => api),
    then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject),
  };
  return api;
};

const deliveryLine = (patch: Partial<SupplierDirectDeliveryLine> = {}): SupplierDirectDeliveryLine => ({
  id: 'line-1',
  deliveryNoteId: 'note-1',
  supplierContractId: 'contract-1',
  supplierContractLineId: 'contract-line-1',
  lineNo: 1,
  itemId: null,
  skuSnapshot: null,
  itemNameSnapshot: 'Bê tông M250',
  unitSnapshot: 'm3',
  quantity: 12.5,
  unitPrice: 900_000,
  vatRate: 10,
  lineAmount: 11_250_000,
  vatAmount: 1_125_000,
  totalAmount: 12_375_000,
  acceptedQuantity: 0,
  acceptedAmount: 0,
  status: 'pending',
  issueReason: null,
  workBoqItemId: null,
  materialBudgetItemId: null,
  note: null,
  createdAt: '2026-07-08T00:00:00.000Z',
  ...patch,
});

const deliveryNote = (patch: Partial<SupplierDirectDeliveryNote> = {}): SupplierDirectDeliveryNote => ({
  id: 'note-1',
  code: 'GN-HDNCC-001',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  supplierContractId: 'contract-1',
  supplierContractCode: 'HD-NCC-001',
  supplierId: 'supplier-a',
  supplierNameSnapshot: 'NCC A',
  deliveryTicketNo: 'BBG-001',
  deliveryDate: '2026-07-08',
  status: 'draft',
  grossAmount: 11_250_000,
  vatAmount: 1_125_000,
  totalAmount: 12_375_000,
  attachments: [],
  qrToken: 'qr-note-1',
  createdBy: 'user-1',
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z',
  note: null,
  lines: [],
  ...patch,
});

const statement = (patch: Partial<SupplierDeliveryStatement> = {}): SupplierDeliveryStatement => ({
  id: 'statement-1',
  code: 'DCHD-202607-001',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  supplierContractId: 'contract-1',
  supplierContractCode: 'HD-NCC-001',
  supplierId: 'supplier-a',
  supplierNameSnapshot: 'NCC A',
  periodMonth: '2026-07-01',
  statementDate: '2026-07-31',
  status: 'draft',
  grossAmount: 11_250_000,
  vatAmount: 1_125_000,
  totalAmount: 12_375_000,
  payableDocumentId: null,
  qrToken: 'qr-statement-1',
  attachments: [],
  metadata: {},
  createdBy: 'user-1',
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
  note: null,
  ...patch,
});

describe('supplier delivery statement helpers', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
    supabaseMocks.rpc.mockReset();
  });

  it('calculates decimal direct delivery line totals with VAT', () => {
    const totals = calculateSupplierDirectDeliveryLineTotals({
      quantity: 12.5,
      unitPrice: 900_000,
      vatRate: 10,
    });

    expect(totals.lineAmount).toBe(11_250_000);
    expect(totals.vatAmount).toBe(1_125_000);
    expect(totals.totalAmount).toBe(12_375_000);
  });

  it('uses accepted adjusted amounts only when building statement totals', () => {
    const totals = calculateSupplierDeliveryStatementTotals([
      deliveryLine({ id: 'accepted', status: 'accepted', acceptedQuantity: 12.5, acceptedAmount: 12_375_000 }),
      deliveryLine({ id: 'adjusted', status: 'adjusted', acceptedQuantity: 8, acceptedAmount: 7_920_000 }),
      deliveryLine({ id: 'rejected', status: 'rejected', acceptedQuantity: 0, acceptedAmount: 0 }),
      deliveryLine({ id: 'pending', status: 'pending', acceptedQuantity: 0, acceptedAmount: 0 }),
    ]);

    expect(totals.grossAmount).toBe(18_450_000);
    expect(totals.vatAmount).toBe(1_845_000);
    expect(totals.totalAmount).toBe(20_295_000);
  });

  it('loads delivery note detail and maps snake case rows', async () => {
    supabaseMocks.from
      .mockReturnValueOnce(query({
        data: {
          id: 'note-1',
          code: 'GN-HDNCC-001',
          project_id: 'project-1',
          construction_site_id: 'site-1',
          supplier_contract_id: 'contract-1',
          supplier_contract_code: 'HD-NCC-001',
          supplier_id: 'supplier-a',
          supplier_name_snapshot: 'NCC A',
          delivery_ticket_no: 'BBG-001',
          delivery_date: '2026-07-08',
          status: 'draft',
          gross_amount: 11250000,
          vat_amount: 1125000,
          total_amount: 12375000,
          attachments: [],
          qr_token: 'qr-note-1',
          created_by: 'user-1',
          created_at: '2026-07-08T00:00:00.000Z',
          updated_at: '2026-07-08T00:00:00.000Z',
          note: null,
        },
        error: null,
      }))
      .mockReturnValueOnce(query({
        data: [{
          id: 'line-1',
          delivery_note_id: 'note-1',
          supplier_contract_id: 'contract-1',
          supplier_contract_line_id: 'contract-line-1',
          line_no: 1,
          item_name_snapshot: 'Bê tông M250',
          unit_snapshot: 'm3',
          quantity: 12.5,
          unit_price: 900000,
          vat_rate: 10,
          line_amount: 11250000,
          vat_amount: 1125000,
          total_amount: 12375000,
          accepted_quantity: 0,
          accepted_amount: 0,
          status: 'pending',
          issue_reason: null,
          created_at: '2026-07-08T00:00:00.000Z',
        }],
        error: null,
      }));

    const detail = await supplierDirectDeliveryService.getDetail('note-1');

    expect(supabaseMocks.from).toHaveBeenNthCalledWith(1, 'supplier_direct_delivery_notes');
    expect(supabaseMocks.from).toHaveBeenNthCalledWith(2, 'supplier_direct_delivery_lines');
    expect(detail.note.supplierContractId).toBe('contract-1');
    expect(detail.lines[0].quantity).toBe(12.5);
    expect(detail.lines[0].issueReason).toBeNull();
  });

  it('posts a delivery statement through the AP sync RPC and keeps contract metadata', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: {
        id: 'statement-1',
        code: 'DCHD-202607-001',
        supplier_contract_id: 'contract-1',
        supplier_contract_code: 'HD-NCC-001',
        payable_document_id: 'ap-1',
        status: 'posted',
        total_amount: 12375000,
        created_at: '2026-07-31T00:00:00.000Z',
      },
      error: null,
    });

    const posted = await supplierDeliveryStatementService.post('statement-1', 'user-1');

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('post_supplier_delivery_statement', {
      p_statement_id: 'statement-1',
      p_actor_id: 'user-1',
    });
    expect(posted.supplierContractId).toBe('contract-1');
    expect(posted.payableDocumentId).toBe('ap-1');
    expect(posted.status).toBe('posted');
  });

  it('syncs AP from a delivery statement source', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: {
        id: 'ap-1',
        code: 'AP-DCHD-202607-001',
        source_type: 'supplier_delivery_statement',
        source_id: 'statement-1',
        supplier_id: 'supplier-a',
        supplier_name_snapshot: 'NCC A',
        document_no: 'DCHD-202607-001',
        document_date: '2026-07-31',
        currency: 'VND',
        committed_amount: 12375000,
        recognized_amount: 12375000,
        paid_amount: 0,
        credit_amount: 0,
        outstanding_amount: 12375000,
        status: 'open',
        metadata: {
          supplierContractId: 'contract-1',
          supplierContractCode: 'HD-NCC-001',
        },
        created_at: '2026-07-31T00:00:00.000Z',
      },
      error: null,
    });

    const document = await supplierDeliveryStatementService.syncPayable('statement-1');

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('sync_supplier_payable_from_delivery_statement', {
      p_statement_id: 'statement-1',
    });
    expect(document.sourceType).toBe('supplier_delivery_statement');
    expect(document.metadata?.supplierContractId).toBe('contract-1');
  });

  it('creates draft statements from accepted delivery lines without requiring issue reason', async () => {
    const statementQuery = query({ data: statement(), error: null });
    const lineQuery = query({ data: [], error: null });
    supabaseMocks.from
      .mockReturnValueOnce(statementQuery)
      .mockReturnValueOnce(lineQuery);

    const saved = await supplierDeliveryStatementService.upsert(statement({ issueReason: undefined } as any), [
      deliveryLine({ status: 'accepted', acceptedQuantity: 12.5, acceptedAmount: 12_375_000, issueReason: null }),
    ]);

    expect(statementQuery.upsert).toHaveBeenCalledWith(expect.objectContaining({
      supplier_contract_id: 'contract-1',
      total_amount: 12375000,
    }), { onConflict: 'id' });
    expect(lineQuery.upsert).toHaveBeenCalled();
    expect(saved.id).toBe('statement-1');
  });
});
