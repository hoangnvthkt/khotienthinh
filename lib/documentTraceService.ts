import type {
  DocumentQrPayload,
  DocumentTraceGraph,
  DocumentTraceNode,
  DocumentTraceNodeType,
  SupplierPayableDocument,
  SupplierPaymentAllocation,
  SupplierPaymentBatch,
} from '../types';

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

export const parseDocumentQrPayload = (value: string | DocumentQrPayload): DocumentQrPayload => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (parsed?.v !== 1 || !parsed.type || !parsed.id || !parsed.token) {
    throw new Error('QR chứng từ không hợp lệ.');
  }
  return parsed as DocumentQrPayload;
};

const nodeKey = (type: DocumentTraceNodeType, id: string) => `${type}:${id}`;

const addNode = (nodes: Map<string, DocumentTraceNode>, node: DocumentTraceNode) => {
  nodes.set(nodeKey(node.type, node.id), node);
};

export const buildPaymentBatchTraceGraph = (input: {
  batch: SupplierPaymentBatch;
  documents: SupplierPayableDocument[];
  allocations: SupplierPaymentAllocation[];
}): DocumentTraceGraph => {
  const nodes = new Map<string, DocumentTraceNode>();
  const edges: DocumentTraceGraph['edges'] = [];
  addNode(nodes, {
    id: input.batch.id,
    type: 'supplier_payment_batch',
    label: input.batch.supplierNameSnapshot,
    documentNo: input.batch.code,
    status: input.batch.status,
    amount: input.batch.amount,
    qrToken: input.batch.qrToken || null,
  });

  const documentsById = new Map(input.documents.map(document => [document.id, document]));
  input.allocations.forEach(allocation => {
    const document = documentsById.get(allocation.payableDocumentId);
    if (!document) return;
    addNode(nodes, {
      id: document.id,
      type: 'supplier_payable_document',
      label: document.supplierNameSnapshot,
      documentNo: document.documentNo,
      status: document.status,
      amount: document.recognizedAmount,
      qrToken: document.qrToken || null,
    });
    edges.push({
      from: nodeKey('supplier_payment_batch', input.batch.id),
      to: nodeKey('supplier_payable_document', document.id),
      relation: 'pays',
      amount: allocation.allocatedAmount,
    });

    if (document.sourceType === 'purchase_order') {
      addNode(nodes, {
        id: document.sourceId,
        type: 'purchase_order',
        label: document.documentNo,
        documentNo: document.documentNo,
        status: null,
        amount: document.committedAmount,
      });
      edges.push({
        from: nodeKey('supplier_payable_document', document.id),
        to: nodeKey('purchase_order', document.sourceId),
        relation: 'recognizes',
        amount: document.recognizedAmount,
      });
    }
  });

  return {
    nodes: Array.from(nodes.values()),
    edges,
  };
};

export const documentTraceService = {
  buildDocumentQrPayload,
  parseDocumentQrPayload,
  buildPaymentBatchTraceGraph,
};
