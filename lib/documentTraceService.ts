import type {
  DocumentQrPayload,
  DocumentTraceGraph,
  DocumentTraceNode,
  DocumentTraceNodeType,
  DocumentTraceResolveResult,
  DocumentTraceSeed,
  ProjectDocumentLink,
  SupplierPayableDocument,
  SupplierPaymentAllocation,
  SupplierPaymentBatch,
} from '../types';
import { fromDb } from './dbMapping';
import { supabase } from './supabase';

export const DOCUMENT_QR_PARAM = 'docQr';

const TRACE_NODE_TYPES: DocumentTraceNodeType[] = [
  'material_request',
  'purchase_order',
  'wms_transaction',
  'supplier_contract',
  'supplier_direct_delivery_note',
  'supplier_delivery_statement',
  'supplier_payable_document',
  'supplier_payment_batch',
  'project_transaction',
  'site_direct_purchase',
  'site_cash_settlement_batch',
];

const isTraceNodeType = (value: string): value is DocumentTraceNodeType =>
  TRACE_NODE_TYPES.includes(value as DocumentTraceNodeType);

const money = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
};

export const buildDocumentQrPayload = (
  type: DocumentTraceNodeType,
  id: string,
  token: string,
): DocumentQrPayload => ({
  v: 1,
  type,
  id,
  token,
});

export const buildDocumentQrUrl = (
  type: DocumentTraceNodeType,
  id: string,
  token: string,
): string => {
  const payload = JSON.stringify(buildDocumentQrPayload(type, id, token));
  if (typeof window === 'undefined') return `/#/trace?${DOCUMENT_QR_PARAM}=${encodeURIComponent(payload)}`;
  const basePath = `${window.location.origin}${window.location.pathname}`;
  return `${basePath}#/trace?${DOCUMENT_QR_PARAM}=${encodeURIComponent(payload)}`;
};

export const buildDocumentTracePath = (
  type: DocumentTraceNodeType,
  id: string,
  token?: string | null,
): string => {
  if (token) {
    const payload = JSON.stringify(buildDocumentQrPayload(type, id, token));
    return `/trace?${DOCUMENT_QR_PARAM}=${encodeURIComponent(payload)}`;
  }
  const query = new URLSearchParams({ type, id });
  return `/trace?${query.toString()}`;
};

export const buildDocumentTraceUrl = (
  type: DocumentTraceNodeType,
  id: string,
  token?: string | null,
): string => {
  if (token) return buildDocumentQrUrl(type, id, token);
  const path = buildDocumentTracePath(type, id);
  if (typeof window === 'undefined') return `/#${path}`;
  return `${window.location.origin}${window.location.pathname}#${path}`;
};

export const parseDocumentQrPayload = (value: string | DocumentQrPayload): DocumentQrPayload => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (parsed?.v !== 1 || !isTraceNodeType(parsed.type) || !parsed.id || !parsed.token) {
    throw new Error('QR chứng từ không hợp lệ.');
  }
  return parsed as DocumentQrPayload;
};

export const parseDocumentQr = (raw: string | DocumentQrPayload): DocumentQrPayload => {
  if (typeof raw !== 'string') return parseDocumentQrPayload(raw);
  const value = raw.trim();
  if (!value) throw new Error('QR chứng từ không hợp lệ.');

  try {
    const url = new URL(value);
    const directPayload = url.searchParams.get(DOCUMENT_QR_PARAM);
    if (directPayload) return parseDocumentQrPayload(directPayload);

    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const [, hashQuery = ''] = hash.split('?');
    const hashPayload = new URLSearchParams(hashQuery).get(DOCUMENT_QR_PARAM);
    if (hashPayload) return parseDocumentQrPayload(hashPayload);
  } catch {
    // Plain JSON/token payload fallback below.
  }

  if (value.includes(DOCUMENT_QR_PARAM)) {
    const query = value.includes('?') ? value.split('?').pop() || '' : value;
    const payload = new URLSearchParams(query).get(DOCUMENT_QR_PARAM);
    if (payload) return parseDocumentQrPayload(payload);
  }

  return parseDocumentQrPayload(value);
};

const nodeKey = (type: DocumentTraceNodeType, id: string) => `${type}:${id}`;

const addNode = (nodes: Map<string, DocumentTraceNode>, node: DocumentTraceNode) => {
  nodes.set(nodeKey(node.type, node.id), node);
};

const linkToEdge = (link: ProjectDocumentLink): DocumentTraceGraph['edges'][number] | null => {
  const sourceType = String(link.sourceType);
  const targetType = String(link.targetType);
  if (!isTraceNodeType(sourceType) || !isTraceNodeType(targetType)) return null;
  return {
    from: nodeKey(sourceType, link.sourceId),
    to: nodeKey(targetType, link.targetId),
    relation: link.relationType,
    amount: money(link.metadata?.allocatedAmount ?? link.metadata?.amount ?? null) || null,
    metadata: {
      ...(link.metadata || {}),
      linkId: link.id,
      linkStatus: link.status,
    },
  };
};

export const buildTraceGraphFromLinks = (input: {
  seed?: DocumentTraceSeed;
  nodes?: DocumentTraceNode[];
  links?: ProjectDocumentLink[];
}): DocumentTraceGraph => {
  const nodes = new Map<string, DocumentTraceNode>();
  const edgesByKey = new Map<string, DocumentTraceGraph['edges'][number]>();

  (input.nodes || []).forEach(node => addNode(nodes, node));
  if (input.seed && !nodes.has(nodeKey(input.seed.type, input.seed.id))) {
    addNode(nodes, {
      id: input.seed.id,
      type: input.seed.type,
      label: input.seed.id,
      documentNo: input.seed.id,
      qrToken: input.seed.token || null,
    });
  }

  (input.links || []).forEach(link => {
    const sourceType = String(link.sourceType);
    const targetType = String(link.targetType);
    if (isTraceNodeType(sourceType) && !nodes.has(nodeKey(sourceType, link.sourceId))) {
      addNode(nodes, {
        id: link.sourceId,
        type: sourceType,
        label: link.sourceId,
        documentNo: link.sourceId,
      });
    }
    if (isTraceNodeType(targetType) && !nodes.has(nodeKey(targetType, link.targetId))) {
      addNode(nodes, {
        id: link.targetId,
        type: targetType,
        label: link.targetId,
        documentNo: link.targetId,
      });
    }

    const edge = linkToEdge(link);
    if (!edge) return;
    const edgeKey = `${edge.from}->${edge.to}:${edge.relation}`;
    if (!edgesByKey.has(edgeKey)) edgesByKey.set(edgeKey, edge);
  });

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edgesByKey.values()),
  };
};

const sourceNodeTypeByPayableSource: Partial<Record<SupplierPayableDocument['sourceType'], DocumentTraceNodeType>> = {
  purchase_order: 'purchase_order',
  site_direct_purchase: 'site_direct_purchase',
  supplier_delivery_statement: 'supplier_delivery_statement',
};

export const buildPaymentBatchTraceGraph = (input: {
  batch: SupplierPaymentBatch;
  documents: SupplierPayableDocument[];
  allocations: SupplierPaymentAllocation[];
}): DocumentTraceGraph => {
  const nodes = new Map<string, DocumentTraceNode>();
  const edges: DocumentTraceGraph['edges'] = [];

  const documentsById = new Map(input.documents.map(document => [document.id, document]));
  input.documents.forEach(document => {
    const sourceNodeType = sourceNodeTypeByPayableSource[document.sourceType];
    if (sourceNodeType && document.sourceId) {
      addNode(nodes, {
        id: document.sourceId,
        type: sourceNodeType,
        label: document.documentNo,
        documentNo: document.documentNo,
        status: null,
        amount: document.committedAmount,
        metadata: {
          sourceType: document.sourceType,
        },
      });
    }
    addNode(nodes, {
      id: document.id,
      type: 'supplier_payable_document',
      label: document.supplierNameSnapshot,
      documentNo: document.documentNo,
      status: document.status,
      amount: document.recognizedAmount,
      qrToken: document.qrToken || null,
    });
    if (sourceNodeType && document.sourceId) {
      edges.push({
        from: nodeKey(sourceNodeType, document.sourceId),
        to: nodeKey('supplier_payable_document', document.id),
        relation: 'recognizes',
        amount: document.recognizedAmount,
      });
    }
  });

  addNode(nodes, {
    id: input.batch.id,
    type: 'supplier_payment_batch',
    label: input.batch.supplierNameSnapshot,
    documentNo: input.batch.code,
    status: input.batch.status,
    amount: input.batch.amount,
    qrToken: input.batch.qrToken || null,
  });

  input.allocations.forEach(allocation => {
    const document = documentsById.get(allocation.payableDocumentId);
    if (!document) return;
    edges.push({
      from: nodeKey('supplier_payable_document', document.id),
      to: nodeKey('supplier_payment_batch', input.batch.id),
      relation: 'paid_by',
      amount: allocation.allocatedAmount,
    });
  });

  return {
    nodes: Array.from(nodes.values()),
    edges,
  };
};

const normalizeLink = (row: any): ProjectDocumentLink => {
  const mapped = fromDb(row) as ProjectDocumentLink;
  return {
    ...mapped,
    sourceType: mapped.sourceType || row.source_type,
    sourceId: mapped.sourceId || row.source_id,
    targetType: mapped.targetType || row.target_type,
    targetId: mapped.targetId || row.target_id,
    relationType: mapped.relationType || row.relation_type || 'downstream',
    status: mapped.status || row.status || 'active',
    metadata: mapped.metadata || row.metadata || {},
  };
};

type TraceNodeConfig = {
  table: string;
  tokenColumn?: string;
  toNode: (row: any) => DocumentTraceNode;
};

const firstText = (...values: unknown[]) => values.map(value => String(value || '').trim()).find(Boolean) || '';

const traceNodeConfig: Record<DocumentTraceNodeType, TraceNodeConfig> = {
  material_request: {
    table: 'requests',
    toNode: row => ({
      id: row.id,
      type: 'material_request',
      label: firstText(row.title, row.request_name, row.description, row.id),
      documentNo: firstText(row.request_code, row.code, row.id),
      status: row.status || null,
      amount: null,
      metadata: row,
    }),
  },
  purchase_order: {
    table: 'purchase_orders',
    tokenColumn: 'qr_token',
    toNode: row => ({
      id: row.id,
      type: 'purchase_order',
      label: firstText(row.vendor_name, row.supplier_name_snapshot, row.po_number, row.id),
      documentNo: firstText(row.po_number, row.code, row.id),
      status: row.status || null,
      amount: money(row.total_amount),
      qrToken: row.qr_token || null,
      metadata: row,
    }),
  },
  wms_transaction: {
    table: 'transactions',
    toNode: row => ({
      id: row.id,
      type: 'wms_transaction',
      label: firstText(row.note, row.type, row.id),
      documentNo: row.id,
      status: row.status || null,
      amount: null,
      metadata: row,
    }),
  },
  supplier_contract: {
    table: 'supplier_contracts',
    tokenColumn: 'qr_token',
    toNode: row => ({
      id: row.id,
      type: 'supplier_contract',
      label: firstText(row.name, row.supplier_name, row.code, row.id),
      documentNo: firstText(row.code, row.id),
      status: row.status || null,
      amount: money(row.value),
      qrToken: row.qr_token || null,
      metadata: row,
    }),
  },
  supplier_direct_delivery_note: {
    table: 'supplier_direct_delivery_notes',
    tokenColumn: 'qr_token',
    toNode: row => ({
      id: row.id,
      type: 'supplier_direct_delivery_note',
      label: firstText(row.supplier_name_snapshot, row.code, row.id),
      documentNo: firstText(row.code, row.delivery_ticket_no, row.id),
      status: row.status || null,
      amount: money(row.total_amount),
      qrToken: row.qr_token || null,
      metadata: row,
    }),
  },
  supplier_delivery_statement: {
    table: 'supplier_delivery_statements',
    tokenColumn: 'qr_token',
    toNode: row => ({
      id: row.id,
      type: 'supplier_delivery_statement',
      label: firstText(row.supplier_name_snapshot, row.code, row.id),
      documentNo: firstText(row.code, row.id),
      status: row.status || null,
      amount: money(row.total_amount),
      qrToken: row.qr_token || null,
      metadata: row,
    }),
  },
  supplier_payable_document: {
    table: 'supplier_payable_documents',
    tokenColumn: 'qr_token',
    toNode: row => ({
      id: row.id,
      type: 'supplier_payable_document',
      label: firstText(row.supplier_name_snapshot, row.document_no, row.code, row.id),
      documentNo: firstText(row.document_no, row.code, row.id),
      status: row.status || null,
      amount: money(row.recognized_amount),
      qrToken: row.qr_token || null,
      metadata: row,
    }),
  },
  supplier_payment_batch: {
    table: 'supplier_payment_batches',
    tokenColumn: 'qr_token',
    toNode: row => ({
      id: row.id,
      type: 'supplier_payment_batch',
      label: firstText(row.supplier_name_snapshot, row.code, row.id),
      documentNo: firstText(row.code, row.id),
      status: row.status || null,
      amount: money(row.payment_amount ?? row.amount),
      qrToken: row.qr_token || null,
      metadata: row,
    }),
  },
  project_transaction: {
    table: 'project_transactions',
    toNode: row => ({
      id: row.id,
      type: 'project_transaction',
      label: firstText(row.description, row.counterparty_name, row.code, row.id),
      documentNo: firstText(row.code, row.id),
      status: row.status || null,
      amount: money(row.amount),
      metadata: row,
    }),
  },
  site_direct_purchase: {
    table: 'site_direct_purchases',
    tokenColumn: 'qr_token',
    toNode: row => ({
      id: row.id,
      type: 'site_direct_purchase',
      label: firstText(row.supplier_name_snapshot, row.code, row.id),
      documentNo: firstText(row.code, row.id),
      status: row.status || null,
      amount: money(row.total_amount),
      qrToken: row.qr_token || null,
      metadata: row,
    }),
  },
  site_cash_settlement_batch: {
    table: 'site_cash_settlement_batches',
    tokenColumn: 'qr_token',
    toNode: row => ({
      id: row.id,
      type: 'site_cash_settlement_batch',
      label: firstText(row.code, row.id),
      documentNo: firstText(row.code, row.id),
      status: row.status || null,
      amount: money(row.approved_site_cash_spend ?? row.accepted_spend_amount),
      qrToken: row.qr_token || null,
      metadata: row,
    }),
  },
};

const loadTraceNodes = async (seeds: DocumentTraceSeed[]): Promise<DocumentTraceNode[]> => {
  const byType = seeds.reduce<Map<DocumentTraceNodeType, Set<string>>>((map, seed) => {
    map.set(seed.type, (map.get(seed.type) || new Set()).add(seed.id));
    return map;
  }, new Map());
  const nodes: DocumentTraceNode[] = [];

  for (const [type, ids] of byType.entries()) {
    const config = traceNodeConfig[type];
    const { data, error } = await supabase
      .from(config.table)
      .select('*')
      .in('id', Array.from(ids));
    if (error) {
      if (error.code === '42P01' || error.code === '42703') continue;
      throw error;
    }
    (data || []).forEach(row => nodes.push(config.toNode(row)));
  }
  return nodes;
};

const loadLinksForSeed = async (seed: DocumentTraceSeed): Promise<ProjectDocumentLink[]> => {
  const [sourceResult, targetResult] = await Promise.all([
    supabase
      .from('project_document_links')
      .select('*')
      .eq('source_type', seed.type)
      .eq('source_id', seed.id),
    supabase
      .from('project_document_links')
      .select('*')
      .eq('target_type', seed.type)
      .eq('target_id', seed.id),
  ]);
  if (sourceResult.error && sourceResult.error.code !== '42P01') throw sourceResult.error;
  if (targetResult.error && targetResult.error.code !== '42P01') throw targetResult.error;
  return [
    ...((sourceResult.data || []) as any[]),
    ...((targetResult.data || []) as any[]),
  ].map(normalizeLink);
};

const linkSeed = (type: string, id: string): DocumentTraceSeed | null =>
  isTraceNodeType(type) ? { type, id } : null;

const loadFallbackLinks = async (seed: DocumentTraceSeed): Promise<ProjectDocumentLink[]> => {
  const links: ProjectDocumentLink[] = [];
  const push = (
    sourceType: DocumentTraceNodeType,
    sourceId: string,
    targetType: DocumentTraceNodeType,
    targetId: string,
    relationType: string,
    metadata: Record<string, any> = {},
  ) => {
    if (!sourceId || !targetId) return;
    links.push({
      id: `fallback:${sourceType}:${sourceId}:${targetType}:${targetId}:${relationType}`,
      sourceType,
      sourceId,
      targetType,
      targetId,
      relationType,
      status: 'active',
      metadata: { ...metadata, source: 'fallback' },
    });
  };

  if (seed.type === 'supplier_contract') {
    const { data: noteRows } = await supabase
      .from('supplier_direct_delivery_notes')
      .select('*')
      .eq('supplier_contract_id', seed.id);
    (noteRows || []).forEach((note: any) => {
      push('supplier_contract', seed.id, 'supplier_direct_delivery_note', note.id, 'delivery_note', {
        amount: note.total_amount,
      });
    });

    const { data: statementRows } = await supabase
      .from('supplier_delivery_statements')
      .select('*')
      .eq('supplier_contract_id', seed.id);
    (statementRows || []).forEach((statement: any) => {
      if (statement.payable_document_id) {
        push('supplier_delivery_statement', statement.id, 'supplier_payable_document', statement.payable_document_id, 'recognizes', {
          amount: statement.total_amount,
        });
      }
    });
  }

  if (seed.type === 'supplier_direct_delivery_note') {
    const { data: noteRows } = await supabase
      .from('supplier_direct_delivery_notes')
      .select('*')
      .eq('id', seed.id)
      .limit(1);
    const note = noteRows?.[0];
    if (note?.supplier_contract_id) {
      push('supplier_contract', note.supplier_contract_id, 'supplier_direct_delivery_note', seed.id, 'delivery_note', {
        amount: note.total_amount,
      });
    }

    const { data: lineRows } = await supabase
      .from('supplier_direct_delivery_lines')
      .select('*')
      .eq('delivery_note_id', seed.id);
    (lineRows || []).forEach((line: any) => {
      if (line.wms_import_transaction_id) {
        push('supplier_direct_delivery_note', seed.id, 'wms_transaction', line.wms_import_transaction_id, 'wms_import', {
          supplierDirectDeliveryLineId: line.id,
        });
      }
      if (line.wms_import_transaction_id && line.wms_export_transaction_id) {
        push('wms_transaction', line.wms_import_transaction_id, 'wms_transaction', line.wms_export_transaction_id, 'wms_export', {
          supplierDirectDeliveryLineId: line.id,
        });
      }
    });

    const { data: statementLineRows } = await supabase
      .from('supplier_delivery_statement_lines')
      .select('statement_id')
      .eq('delivery_note_id', seed.id);
    (statementLineRows || []).forEach((line: any) => {
      push('supplier_direct_delivery_note', seed.id, 'supplier_delivery_statement', line.statement_id, 'statement');
    });
  }

  if (seed.type === 'wms_transaction') {
    const { data: lineRows } = await supabase
      .from('supplier_direct_delivery_lines')
      .select('*')
      .or(`wms_import_transaction_id.eq.${seed.id},wms_export_transaction_id.eq.${seed.id}`);
    (lineRows || []).forEach((line: any) => {
      if (line.wms_import_transaction_id) {
        push('supplier_direct_delivery_note', line.delivery_note_id, 'wms_transaction', line.wms_import_transaction_id, 'wms_import', {
          supplierDirectDeliveryLineId: line.id,
        });
      }
      if (line.wms_import_transaction_id && line.wms_export_transaction_id) {
        push('wms_transaction', line.wms_import_transaction_id, 'wms_transaction', line.wms_export_transaction_id, 'wms_export', {
          supplierDirectDeliveryLineId: line.id,
        });
      }
    });
  }

  if (seed.type === 'supplier_delivery_statement') {
    const { data: statementRows } = await supabase
      .from('supplier_delivery_statements')
      .select('*')
      .eq('id', seed.id)
      .limit(1);
    const statement = statementRows?.[0];
    if (statement?.payable_document_id) {
      push('supplier_delivery_statement', seed.id, 'supplier_payable_document', statement.payable_document_id, 'recognizes', {
        amount: statement.total_amount,
      });
    }

    const { data: statementLineRows } = await supabase
      .from('supplier_delivery_statement_lines')
      .select('delivery_note_id')
      .eq('statement_id', seed.id);
    (statementLineRows || []).forEach((line: any) => {
      push('supplier_direct_delivery_note', line.delivery_note_id, 'supplier_delivery_statement', seed.id, 'statement');
    });
  }

  if (seed.type === 'purchase_order' || seed.type === 'site_direct_purchase' || seed.type === 'supplier_delivery_statement') {
    const { data: payableRows } = await supabase
      .from('supplier_payable_documents')
      .select('*')
      .eq('source_type', seed.type)
      .eq('source_id', seed.id);
    (payableRows || []).forEach((document: any) => {
      push(seed.type, seed.id, 'supplier_payable_document', document.id, 'recognizes', {
        amount: document.recognized_amount,
      });
    });
  }

  if (seed.type === 'site_direct_purchase') {
    const { data: settlementRows } = await supabase
      .from('site_cash_settlement_lines')
      .select('*')
      .eq('source_type', 'site_direct_purchase')
      .eq('source_id', seed.id);
    (settlementRows || []).forEach((line: any) => {
      push('site_direct_purchase', seed.id, 'site_cash_settlement_batch', line.settlement_batch_id, 'settled_by', {
        amount: line.approved_amount,
      });
    });
  }

  if (seed.type === 'supplier_payable_document') {
    const { data: docRows } = await supabase
      .from('supplier_payable_documents')
      .select('*')
      .eq('id', seed.id)
      .limit(1);
    const doc = docRows?.[0];
    const sourceType = doc ? sourceNodeTypeByPayableSource[doc.source_type as SupplierPayableDocument['sourceType']] : null;
    if (sourceType && doc.source_id) push(sourceType, doc.source_id, 'supplier_payable_document', seed.id, 'recognizes');

    const { data: allocationRows } = await supabase
      .from('supplier_payment_allocations')
      .select('*')
      .eq('payable_document_id', seed.id);
    (allocationRows || []).forEach((allocation: any) => {
      push('supplier_payable_document', seed.id, 'supplier_payment_batch', allocation.payment_batch_id, 'paid_by', {
        allocatedAmount: allocation.allocated_amount,
      });
    });
  }

  if (seed.type === 'supplier_payment_batch') {
    const { data: allocationRows } = await supabase
      .from('supplier_payment_allocations')
      .select('*')
      .eq('payment_batch_id', seed.id);
    (allocationRows || []).forEach((allocation: any) => {
      push('supplier_payable_document', allocation.payable_document_id, 'supplier_payment_batch', seed.id, 'paid_by', {
        allocatedAmount: allocation.allocated_amount,
      });
    });

    const { data: batchRows } = await supabase
      .from('supplier_payment_batches')
      .select('*')
      .eq('id', seed.id)
      .limit(1);
    const batch = batchRows?.[0];
    if (batch?.project_transaction_id) push('supplier_payment_batch', seed.id, 'project_transaction', batch.project_transaction_id, 'cashflow');
  }

  if (seed.type === 'site_cash_settlement_batch') {
    const { data: lineRows } = await supabase
      .from('site_cash_settlement_lines')
      .select('*')
      .eq('settlement_batch_id', seed.id);
    (lineRows || []).forEach((line: any) => {
      if (line.source_type === 'site_direct_purchase') {
        push('site_direct_purchase', line.source_id, 'site_cash_settlement_batch', seed.id, 'settled_by', {
          amount: line.approved_amount,
        });
      }
    });

    const { data: batchRows } = await supabase
      .from('site_cash_settlement_batches')
      .select('*')
      .eq('id', seed.id)
      .limit(1);
    const batch = batchRows?.[0];
    if (batch?.project_transaction_id) push('site_cash_settlement_batch', seed.id, 'project_transaction', batch.project_transaction_id, 'cashflow');
  }

  return links;
};

export const getTraceGraph = async (
  seed: DocumentTraceSeed,
  options: { depth?: number } = {},
): Promise<DocumentTraceGraph> => {
  const maxDepth = Math.max(1, Math.min(12, options.depth ?? 6));
  const seenNodes = new Set([nodeKey(seed.type, seed.id)]);
  const linksById = new Map<string, ProjectDocumentLink>();
  let frontier: DocumentTraceSeed[] = [seed];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const loadedLinks = (await Promise.all(frontier.map(async currentSeed => [
      ...(await loadLinksForSeed(currentSeed)),
      ...(await loadFallbackLinks(currentSeed)),
    ]))).flat();
    const nextFrontier: DocumentTraceSeed[] = [];
    loadedLinks.forEach(link => {
      linksById.set(link.id, link);
      [linkSeed(String(link.sourceType), link.sourceId), linkSeed(String(link.targetType), link.targetId)].forEach(next => {
        if (!next) return;
        const key = nodeKey(next.type, next.id);
        if (seenNodes.has(key)) return;
        seenNodes.add(key);
        nextFrontier.push(next);
      });
    });
    frontier = nextFrontier;
  }

  const nodeSeeds = Array.from(seenNodes).map(key => {
    const [type, ...idParts] = key.split(':');
    return { type: type as DocumentTraceNodeType, id: idParts.join(':') };
  });
  const nodes = await loadTraceNodes(nodeSeeds);
  return buildTraceGraphFromLinks({
    seed,
    nodes,
    links: Array.from(linksById.values()),
  });
};

export const resolveDocumentQr = async (raw: string | DocumentQrPayload): Promise<DocumentTraceResolveResult> => {
  const payload = parseDocumentQr(raw);
  const config = traceNodeConfig[payload.type];
  const tokenColumn = config.tokenColumn;
  if (!tokenColumn) {
    return { seed: { type: payload.type, id: payload.id, token: payload.token } };
  }

  const { data, error } = await supabase
    .from(config.table)
    .select('*')
    .eq('id', payload.id)
    .eq(tokenColumn, payload.token)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error('QR chứng từ không hợp lệ.');
  return {
    seed: { type: payload.type, id: payload.id, token: payload.token },
    node: config.toNode(row),
  };
};

export const documentTraceService = {
  buildDocumentQrPayload,
  parseDocumentQrPayload,
  buildDocumentQrUrl,
  buildDocumentTracePath,
  buildDocumentTraceUrl,
  parseDocumentQr,
  resolveDocumentQr,
  getTraceGraph,
  buildPaymentBatchTraceGraph,
  buildTraceGraphFromLinks,
};
