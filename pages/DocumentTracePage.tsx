import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  FileText,
  GitBranch,
  Loader2,
  QrCode,
  RefreshCcw,
} from 'lucide-react';
import type { DocumentTraceGraph, DocumentTraceNode, DocumentTraceNodeType } from '../types';
import {
  DOCUMENT_QR_PARAM,
  buildDocumentQrUrl,
  documentTraceService,
} from '../lib/documentTraceService';

const traceNodeTypes: DocumentTraceNodeType[] = [
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

const nodeLabels: Record<DocumentTraceNodeType, string> = {
  material_request: 'Yêu cầu vật tư',
  purchase_order: 'PO',
  wms_transaction: 'WMS',
  supplier_contract: 'HĐ NCC',
  supplier_direct_delivery_note: 'Phiếu giao HĐ NCC',
  supplier_delivery_statement: 'Đối soát HĐ NCC',
  supplier_payable_document: 'AP',
  supplier_payment_batch: 'Thanh toán NCC',
  project_transaction: 'Dòng tiền dự án',
  site_direct_purchase: 'Mua nóng công trường',
  site_cash_settlement_batch: 'Hoàn ứng/quỹ',
};

const relationLabels: Record<string, string> = {
  delivery_note: 'phát sinh phiếu giao',
  wms_import: 'nhập WMS',
  wms_export: 'xuất dùng',
  statement: 'đối soát',
  recognizes: 'ghi nhận AP',
  paid_by: 'thanh toán',
  cashflow: 'ghi dòng tiền',
  settled_by: 'hoàn ứng/quỹ',
};

const isTraceNodeType = (value: string | null): value is DocumentTraceNodeType =>
  Boolean(value && traceNodeTypes.includes(value as DocumentTraceNodeType));

const nodeKey = (node: Pick<DocumentTraceNode, 'type' | 'id'>) => `${node.type}:${node.id}`;

const formatMoney = (value?: number | null) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount === 0) return null;
  return `${Math.round(amount).toLocaleString('vi-VN')} đ`;
};

const statusTone = (status?: string | null) => {
  const normalized = String(status || '').toLowerCase();
  if (['posted', 'paid', 'completed', 'closed', 'exported', 'active', 'approved'].includes(normalized)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (['cancelled', 'canceled', 'reversed', 'void', 'blocked', 'rejected'].includes(normalized)) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  if (['pending', 'draft', 'submitted', 'reviewing', 'open', 'partial'].includes(normalized)) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600';
};

const sortGraphNodes = (graph: DocumentTraceGraph): DocumentTraceNode[] => {
  const nodes = graph.nodes;
  const nodesByKey = new Map(nodes.map(node => [nodeKey(node), node]));
  const originalIndex = new Map(nodes.map((node, index) => [nodeKey(node), index]));
  const inDegree = new Map(nodes.map(node => [nodeKey(node), 0]));
  const children = new Map<string, string[]>();

  graph.edges.forEach(edge => {
    if (!nodesByKey.has(edge.from) || !nodesByKey.has(edge.to)) return;
    children.set(edge.from, [...(children.get(edge.from) || []), edge.to]);
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  });

  const queue = nodes
    .filter(node => (inDegree.get(nodeKey(node)) || 0) === 0)
    .sort((a, b) => (originalIndex.get(nodeKey(a)) || 0) - (originalIndex.get(nodeKey(b)) || 0))
    .map(node => nodeKey(node));
  const sorted: DocumentTraceNode[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const key = queue.shift()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = nodesByKey.get(key);
    if (node) sorted.push(node);
    (children.get(key) || []).forEach(childKey => {
      inDegree.set(childKey, Math.max(0, (inDegree.get(childKey) || 0) - 1));
      if ((inDegree.get(childKey) || 0) === 0) queue.push(childKey);
    });
  }

  nodes.forEach(node => {
    if (!seen.has(nodeKey(node))) sorted.push(node);
  });
  return sorted;
};

const openNode = (navigate: ReturnType<typeof useNavigate>, node: DocumentTraceNode) => {
  switch (node.type) {
    case 'purchase_order':
      navigate(`/da?tab=material&materialTab=po&poId=${encodeURIComponent(node.id)}`);
      break;
    case 'site_direct_purchase':
      navigate(`/da?tab=material&materialTab=direct&siteDirectPurchaseId=${encodeURIComponent(node.id)}`);
      break;
    case 'supplier_contract':
      navigate(`/hd/supplier?supplierContractId=${encodeURIComponent(node.id)}`);
      break;
    case 'supplier_direct_delivery_note':
      navigate(`/da?tab=material&materialTab=direct&supplierDirectDeliveryNoteId=${encodeURIComponent(node.id)}`);
      break;
    case 'supplier_delivery_statement':
      navigate(`/da?tab=material&materialTab=direct&supplierDeliveryStatementId=${encodeURIComponent(node.id)}`);
      break;
    case 'supplier_payable_document':
    case 'supplier_payment_batch':
      navigate('/da?tab=finance&financeTab=payables');
      break;
    case 'site_cash_settlement_batch':
      navigate('/da?tab=finance&financeTab=payments');
      break;
    case 'project_transaction':
      navigate('/da?tab=finance&financeTab=ledger');
      break;
    case 'wms_transaction':
      navigate('/operations', { state: { tab: 'PENDING', transactionId: node.id } });
      break;
    case 'material_request':
      navigate(`/da?tab=material&materialTab=request&requestId=${encodeURIComponent(node.id)}`);
      break;
    default:
      break;
  }
};

const DocumentTracePage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [graph, setGraph] = useState<DocumentTraceGraph>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setQrUrl(null);

      try {
        const params = new URLSearchParams(location.search);
        const rawQr = params.get(DOCUMENT_QR_PARAM);
        const typeParam = params.get('type');
        const idParam = params.get('id');
        const tokenParam = params.get('token');

        const resolved = rawQr
          ? await documentTraceService.resolveDocumentQr(rawQr)
          : null;
        const seed = resolved?.seed || (
          isTraceNodeType(typeParam) && idParam
            ? { type: typeParam, id: idParam, token: tokenParam }
            : null
        );

        if (!seed) throw new Error('QR chứng từ không hợp lệ.');
        const nextGraph = await documentTraceService.getTraceGraph(seed, { depth: 6 });
        if (resolved?.node && !nextGraph.nodes.some(node => node.type === resolved.node?.type && node.id === resolved.node?.id)) {
          nextGraph.nodes.unshift(resolved.node);
        }

        if (!cancelled) {
          setGraph(nextGraph);
          const token = resolved?.node?.qrToken || seed.token;
          if (token) setQrUrl(buildDocumentQrUrl(seed.type, seed.id, token));
        }
      } catch (err: any) {
        if (!cancelled) {
          setGraph({ nodes: [], edges: [] });
          setError(err?.message || 'QR chứng từ không hợp lệ.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [location.search]);

  const sortedNodes = useMemo(() => sortGraphNodes(graph), [graph]);
  const edgeByTarget = useMemo(() => {
    const map = new Map<string, DocumentTraceGraph['edges'][number]>();
    graph.edges.forEach(edge => {
      if (!map.has(edge.to)) map.set(edge.to, edge);
    });
    return map;
  }, [graph.edges]);

  return (
    <div className="min-h-full bg-slate-50 px-4 py-6 text-slate-900 dark:bg-slate-950 dark:text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
              <GitBranch size={13} /> Trace graph
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-tight">Truy vết chuỗi chứng từ</h1>
            <p className="mt-1 max-w-2xl text-sm font-medium text-slate-500 dark:text-slate-400">
              Chuỗi hiển thị theo chiều chứng từ nguồn phát sinh trước đến chứng từ sau. WMS chỉ là dấu vết số lượng/tồn kho; công nợ và dòng tiền nằm ở AP/thanh toán.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {qrUrl && (
              <div className="hidden rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 md:block">
                <QRCodeSVG value={qrUrl} size={74} level="M" includeMargin />
              </div>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCcw size={14} /> Làm mới
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white p-10 text-sm font-bold text-slate-500 dark:border-slate-800 dark:bg-slate-900">
            <Loader2 size={18} className="mr-2 animate-spin" /> Đang tải trace graph...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
            <div className="flex items-center gap-2 font-black">
              <AlertTriangle size={18} /> {error}
            </div>
          </div>
        ) : sortedNodes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm font-bold text-slate-400 dark:border-slate-700 dark:bg-slate-900">
            Chưa có liên kết chứng từ cho QR này.
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-3">
              {sortedNodes.map((node, index) => {
                const incomingEdge = edgeByTarget.get(nodeKey(node));
                const amount = formatMoney(node.amount);
                return (
                  <div key={nodeKey(node)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    {incomingEdge && (
                      <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                        <ArrowRight size={12} /> {relationLabels[incomingEdge.relation] || incomingEdge.relation}
                      </div>
                    )}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white dark:bg-white dark:text-slate-900">{index + 1}</span>
                          <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-black uppercase text-slate-500 dark:border-slate-700 dark:text-slate-300">
                            {nodeLabels[node.type]}
                          </span>
                          {node.status && (
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${statusTone(node.status)}`}>
                              {node.status}
                            </span>
                          )}
                        </div>
                        <h2 className="mt-2 truncate text-base font-black text-slate-900 dark:text-white">{node.documentNo || node.label || node.id}</h2>
                        <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">{node.label || node.id}</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500">
                          {amount && <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{amount}</span>}
                          {node.qrToken && <span className="rounded-md bg-slate-100 px-2 py-1 font-mono dark:bg-slate-800"><QrCode size={12} className="mr-1 inline" />{node.qrToken}</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openNode(navigate, node)}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <ExternalLink size={14} /> Mở chứng từ
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <aside className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-2 text-sm font-black">
                  <FileText size={16} /> Tóm tắt
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-md bg-slate-50 p-3 dark:bg-slate-800">
                    <div className="text-lg font-black">{graph.nodes.length}</div>
                    <div className="text-[10px] font-black uppercase text-slate-400">Node</div>
                  </div>
                  <div className="rounded-md bg-slate-50 p-3 dark:bg-slate-800">
                    <div className="text-lg font-black">{graph.edges.length}</div>
                    <div className="text-[10px] font-black uppercase text-slate-400">Link</div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="text-xs font-black uppercase text-slate-400">Edges</div>
                <div className="mt-3 space-y-2">
                  {graph.edges.map(edge => (
                    <div key={`${edge.from}->${edge.to}:${edge.relation}`} className="rounded-md bg-slate-50 p-2 text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      <div className="font-mono text-slate-700 dark:text-slate-100">{edge.from}</div>
                      <div className="my-1 text-blue-700 dark:text-blue-300">→ {relationLabels[edge.relation] || edge.relation}</div>
                      <div className="font-mono text-slate-700 dark:text-slate-100">{edge.to}</div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentTracePage;
