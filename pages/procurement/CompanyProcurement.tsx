import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Check,
  ClipboardList,
  FileText,
  Loader2,
  PackageCheck,
  Printer,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { companyProcurementService } from '../../lib/companyProcurementService';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { partnerService } from '../../lib/partnerService';
import { projectMasterService } from '../../lib/projectMasterService';
import { poService } from '../../lib/projectService';
import { materialRequestFulfillmentService } from '../../lib/materialRequestFulfillmentService';
import { getPoLineStockUnitPrice } from '../../lib/materialUnitConversion';
import {
  BusinessPartner,
  CompanyProcurementCreateLine,
  CompanyProcurementDeliveryGroupDetail,
  CompanyProcurementDemandLine,
  Project,
  PurchaseOrder,
  PurchaseOrderRequestLineLink,
  RequestStatus,
} from '../../types';

type TabKey = 'demand' | 'po' | 'delivery' | 'reconcile';

type DraftLine = {
  vendorId: string;
  vendorName: string;
  orderStockQty: string;
  stockUnitPrice: string;
};

type DeliveryDraftLine = {
  link: PurchaseOrderRequestLineLink;
  itemName: string;
  requestCode: string;
  warehouseName: string;
  remainingQty: number;
  issueQty: string;
  unitPrice: string;
  unit?: string | null;
};

const formatQty = (value: number) =>
  Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });

const formatMoney = (value: number) =>
  Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' đ';

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
};

const poStatusLabel: Record<string, string> = {
  draft: 'Nháp',
  sent: 'Đã gửi',
  confirmed: 'Đã duyệt',
  in_transit: 'Đang giao',
  partial: 'Nhận một phần',
  delivered: 'Đã nhận đủ',
  closed: 'Đã đóng',
  returned: 'Hoàn NCC',
  cancelled: 'Đã huỷ',
};

const buildDemandSearch = (row: CompanyProcurementDemandLine, projectName: string, warehouseName: string) =>
  [
    row.request.code,
    row.itemName,
    row.sku,
    projectName,
    warehouseName,
    row.requestLine.note,
    row.requestLine.overBudgetReason,
  ].filter(Boolean).join(' ').toLowerCase();

const sumPoReceivedStockQty = (po: PurchaseOrder) =>
  (po.items || []).reduce((sum, item) => sum + Number(item.receivedQty || 0), 0);

const buildDeliveryPrintHtml = (detail: CompanyProcurementDeliveryGroupDetail, getWarehouseName: (id?: string | null) => string) => {
  const po = detail.purchaseOrder;
  const poItemByLineId = new Map((po?.items || []).map(item => [item.lineId || item.itemId, item]));
  const lines = detail.batches.flatMap(batch => batch.lines.map(line => {
    const poItem = poItemByLineId.get(line.poLineId || '');
    return {
      batch,
      line,
      itemName: poItem?.name || line.itemId,
      amount: Number(line.issuedQty || 0) * Number(line.deliveryUnitPrice || 0),
    };
  }));
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${detail.group.deliveryNo}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #172033; margin: 24px; }
    .top { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #172033; padding-bottom: 14px; }
    h1 { margin: 0; font-size: 22px; letter-spacing: 0; }
    .muted { color: #64748b; font-size: 12px; }
    .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 18px 0; }
    .box { border: 1px solid #cbd5e1; padding: 10px; min-height: 58px; }
    .label { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 700; }
    .value { margin-top: 4px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px; font-size: 12px; vertical-align: top; }
    th { background: #f1f5f9; text-align: left; text-transform: uppercase; color: #475569; font-size: 10px; }
    td.num, th.num { text-align: right; }
    tfoot td { font-weight: 700; background: #f8fafc; }
    .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 42px; text-align: center; font-weight: 700; }
    .sign-box { height: 90px; padding-top: 8px; border-top: 1px solid #cbd5e1; }
    @media print { body { margin: 12mm; } }
  </style>
</head>
<body>
  <div class="top">
    <div>
      <h1>ĐỀ NGHỊ DUYỆT ĐƠN HÀNG THEO ĐỢT</h1>
      <div class="muted">${detail.group.deliveryNo}</div>
    </div>
    <div>
      <div class="label">PO</div>
      <div class="value">${po?.poNumber || detail.group.purchaseOrderId}</div>
    </div>
  </div>
  <div class="meta">
    <div class="box"><div class="label">Nhà cung cấp</div><div class="value">${po?.vendorName || po?.vendorId || '—'}</div></div>
    <div class="box"><div class="label">Ngày giao dự kiến</div><div class="value">${formatDate(detail.group.plannedDate)}</div></div>
    <div class="box"><div class="label">Trạng thái</div><div class="value">${detail.group.status}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>MR / Kho nhận</th>
        <th>Vật tư</th>
        <th class="num">SL đợt này</th>
        <th>ĐVT</th>
        <th class="num">Đơn giá</th>
        <th class="num">Thành tiền</th>
      </tr>
    </thead>
    <tbody>
      ${lines.map(({ batch, line, itemName, amount }) => `
        <tr>
          <td>${batch.batchNo}<br/><span class="muted">${getWarehouseName(batch.targetWarehouseId)}</span></td>
          <td>${itemName}<br/><span class="muted">${line.itemId}</span></td>
          <td class="num">${formatQty(Number(line.issuedQty || 0))}</td>
          <td>${line.deliveryUnit || line.unit || ''}</td>
          <td class="num">${formatMoney(Number(line.deliveryUnitPrice || 0))}</td>
          <td class="num">${formatMoney(amount)}</td>
        </tr>
      `).join('')}
    </tbody>
    <tfoot>
      <tr><td colspan="5" class="num">Tổng cộng</td><td class="num">${formatMoney(total)}</td></tr>
    </tfoot>
  </table>
  <div class="signatures">
    <div class="sign-box">Người lập</div>
    <div class="sign-box">Phòng vật tư</div>
    <div class="sign-box">Ban giám đốc</div>
  </div>
</body>
</html>`;
};

const CompanyProcurement: React.FC = () => {
  const { items, warehouses, constructionSites, user, updateRequestStatus } = useApp();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>('demand');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [demandRows, setDemandRows] = useState<CompanyProcurementDemandLine[]>([]);
  const [companyPos, setCompanyPos] = useState<PurchaseOrder[]>([]);
  const [deliveryGroups, setDeliveryGroups] = useState<CompanyProcurementDeliveryGroupDetail[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [partners, setPartners] = useState<BusinessPartner[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [draftByKey, setDraftByKey] = useState<Record<string, DraftLine>>({});
  const [query, setQuery] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [selectedPoForDelivery, setSelectedPoForDelivery] = useState<PurchaseOrder | null>(null);
  const [deliveryDraftLines, setDeliveryDraftLines] = useState<DeliveryDraftLine[]>([]);
  const [deliveryLoading, setDeliveryLoading] = useState(false);

  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects]);
  const warehouseById = useMemo(() => new Map(warehouses.map(warehouse => [warehouse.id, warehouse])), [warehouses]);
  const siteById = useMemo(() => new Map(constructionSites.map(site => [site.id, site])), [constructionSites]);
  const partnerById = useMemo(() => new Map(partners.map(partner => [partner.id, partner])), [partners]);

  const getProjectName = useCallback((id?: string | null) => projectById.get(id || '')?.name || '—', [projectById]);
  const getWarehouseName = useCallback((id?: string | null) => warehouseById.get(id || '')?.name || '—', [warehouseById]);
  const getSiteName = useCallback((id?: string | null) => siteById.get(id || '')?.name || '—', [siteById]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [demand, pos, groups, projectRows, partnerRows] = await Promise.all([
        companyProcurementService.listOpenDemand(),
        companyProcurementService.listCompanyPurchaseOrders(),
        companyProcurementService.listCompanyDeliveryGroups(),
        projectMasterService.list(),
        partnerService.list({ classification: 'supplier' }),
      ]);
      setDemandRows(demand);
      setCompanyPos(pos);
      setDeliveryGroups(groups);
      setProjects(projectRows);
      setPartners(partnerRows);
      setSelectedKeys(prev => prev.filter(key => demand.some(row => row.key === key)));
    } catch (err: any) {
      logApiError('companyProcurement.refresh', err);
      toast.error('Không tải được dữ liệu mua hàng', getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filteredDemandRows = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return demandRows.filter(row => {
      if (warehouseFilter && row.targetWarehouseId !== warehouseFilter) return false;
      if (!lower) return true;
      return buildDemandSearch(row, getProjectName(row.projectId), getWarehouseName(row.targetWarehouseId)).includes(lower);
    });
  }, [demandRows, getProjectName, getWarehouseName, query, warehouseFilter]);

  const selectedRows = useMemo(() =>
    selectedKeys.map(key => demandRows.find(row => row.key === key)).filter((row): row is CompanyProcurementDemandLine => !!row),
    [demandRows, selectedKeys]);

  const selectedSummary = useMemo(() => selectedRows.reduce((acc, row) => ({
    qty: acc.qty + row.remainingQty,
    value: acc.value + Number(draftByKey[row.key]?.orderStockQty || row.remainingQty) * Number(draftByKey[row.key]?.stockUnitPrice || itemById.get(row.itemId)?.priceIn || 0),
  }), { qty: 0, value: 0 }), [draftByKey, itemById, selectedRows]);

  const toggleRow = (row: CompanyProcurementDemandLine) => {
    const selected = selectedKeys.includes(row.key);
    if (selected) {
      setSelectedKeys(prev => prev.filter(key => key !== row.key));
      return;
    }
    const inventory = itemById.get(row.itemId);
    const partner = row.supplierId ? partnerById.get(row.supplierId) : undefined;
    setSelectedKeys(prev => [...prev, row.key]);
    setDraftByKey(prev => ({
      ...prev,
      [row.key]: prev[row.key] || {
        vendorId: row.supplierId || '',
        vendorName: partner?.name || '',
        orderStockQty: String(row.remainingQty || row.openNeedQty || row.requestedQty || 0),
        stockUnitPrice: String(inventory?.priceIn || 0),
      },
    }));
  };

  const updateDraftLine = (key: string, patch: Partial<DraftLine>) => {
    setDraftByKey(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] || { vendorId: '', vendorName: '', orderStockQty: '0', stockUnitPrice: '0' }),
        ...patch,
      },
    }));
  };

  const handleCreatePo = async () => {
    if (saving || selectedRows.length === 0) return;
    const lines: CompanyProcurementCreateLine[] = selectedRows.map(row => {
      const draft = draftByKey[row.key];
      const partner = draft?.vendorId ? partnerById.get(draft.vendorId) : undefined;
      return {
        demandKey: row.key,
        vendorId: draft?.vendorId || '',
        vendorName: partner?.name || draft?.vendorName || null,
        orderStockQty: Number(draft?.orderStockQty || 0),
        stockUnitPrice: Number(draft?.stockUnitPrice || 0),
        neededDate: row.neededDate || null,
        note: `Gom mua từ ${row.request.code}`,
      };
    });

    const invalid = lines.find(line => !line.vendorId || line.orderStockQty <= 0);
    if (invalid) {
      toast.warning('Thiếu thông tin tạo PO', 'Mỗi dòng đã chọn cần có NCC và SL đặt lớn hơn 0.');
      return;
    }

    setSaving(true);
    try {
      const result = await companyProcurementService.createConsolidatedPurchaseOrders({
        lines,
        note: `Gom ${selectedRows.length} dòng nhu cầu cấp công ty`,
        actorUserId: user.id,
      });
      toast.success('Đã tạo PO gộp', `${result.purchaseOrders.length} PO thuộc nhóm ${result.procurementGroupNo}.`);
      setSelectedKeys([]);
      setDraftByKey({});
      await refresh();
      setActiveTab('po');
    } catch (err: any) {
      logApiError('companyProcurement.createPo', err);
      toast.error('Không tạo được PO gộp', getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const openDeliveryModal = async (po: PurchaseOrder) => {
    setSelectedPoForDelivery(po);
    setDeliveryLoading(true);
    try {
      const links = await companyProcurementService.listPoLinks(po.id);
      const requestIds = Array.from(new Set(links.map(link => link.materialRequestId)));
      const batchesByRequest = await materialRequestFulfillmentService.listByRequests(requestIds);
      const issuedByLinkKey = new Map<string, number>();
      Object.values(batchesByRequest).flat().forEach(batch => {
        if (['cancelled', 'returned'].includes(batch.status)) return;
        batch.lines
          .filter(line => line.poId === po.id)
          .forEach(line => {
            const key = `${line.materialRequestId}:${line.requestLineId}:${line.poLineId}`;
            issuedByLinkKey.set(key, (issuedByLinkKey.get(key) || 0) + Number(line.issuedQty || 0));
          });
      });
      const poItemByLineId = new Map((po.items || []).map(item => [item.lineId || item.itemId, item]));
      setDeliveryDraftLines(links.map(link => {
        const poItem = poItemByLineId.get(link.purchaseOrderLineId);
        const key = `${link.materialRequestId}:${link.requestLineId}:${link.purchaseOrderLineId}`;
        const remainingQty = Math.max(0, Number(link.orderedQty || 0) - Number(issuedByLinkKey.get(key) || 0));
        const inventory = itemById.get(link.itemId);
        const unitPrice = poItem ? getPoLineStockUnitPrice(poItem, inventory) : Number(inventory?.priceIn || 0);
        return {
          link,
          itemName: poItem?.name || inventory?.name || link.itemId,
          requestCode: link.materialRequestCode || link.materialRequestId,
          warehouseName: getWarehouseName(link.targetWarehouseId),
          remainingQty,
          issueQty: String(remainingQty),
          unitPrice: String(unitPrice),
          unit: link.unit || inventory?.unit || poItem?.stockUnitSnapshot || poItem?.unit,
        };
      }).filter(line => line.remainingQty > 0));
    } catch (err: any) {
      logApiError('companyProcurement.openDeliveryModal', err);
      toast.error('Không tải được dòng giao hàng', getApiErrorMessage(err));
      setSelectedPoForDelivery(null);
    } finally {
      setDeliveryLoading(false);
    }
  };

  const updateDeliveryDraftLine = (index: number, patch: Partial<DeliveryDraftLine>) => {
    setDeliveryDraftLines(prev => prev.map((line, idx) => idx === index ? { ...line, ...patch } : line));
  };

  const handleCreateDelivery = async () => {
    if (!selectedPoForDelivery || saving) return;
    const overrides = deliveryDraftLines
      .map(line => ({
        purchaseOrderLineId: line.link.purchaseOrderLineId,
        materialRequestId: line.link.materialRequestId,
        requestLineId: line.link.requestLineId,
        issuedQty: Number(line.issueQty || 0),
        deliveryUnitPrice: Number(line.unitPrice || 0),
      }))
      .filter(line => line.issuedQty > 0);
    if (overrides.length === 0) {
      toast.warning('Chưa có SL đợt giao', 'Nhập ít nhất một dòng có SL đợt này lớn hơn 0.');
      return;
    }

    setSaving(true);
    try {
      const affectedRequestIds = await materialRequestFulfillmentService.ensurePoDeliveryBatches({
        po: selectedPoForDelivery,
        actorUserId: user.id,
        lineOverrides: overrides,
      });
      await poService.updateStatus(selectedPoForDelivery.id, { status: 'in_transit' });
      await Promise.all(Array.from(new Set(affectedRequestIds)).map(requestId =>
        updateRequestStatus(
          requestId,
          RequestStatus.IN_TRANSIT,
          `Tạo đợt giao từ ${selectedPoForDelivery.poNumber}`,
          undefined,
          undefined,
          undefined,
          'FULFILLMENT_ISSUED',
        ),
      ));
      toast.success('Đã tạo đợt giao', `${selectedPoForDelivery.poNumber} đã phát sinh đợt giao mới.`);
      setSelectedPoForDelivery(null);
      setDeliveryDraftLines([]);
      await refresh();
      setActiveTab('delivery');
    } catch (err: any) {
      logApiError('companyProcurement.createDelivery', err);
      toast.error('Không tạo được đợt giao', getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const printDeliveryGroup = async (detail: CompanyProcurementDeliveryGroupDetail) => {
    try {
      const fullDetail = detail.batches.length > 0 ? detail : await companyProcurementService.getDeliveryGroupDetail(detail.group.id);
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);
      const doc = iframe.contentWindow?.document;
      if (!doc) throw new Error('Không tạo được khung in.');
      doc.open();
      doc.write(buildDeliveryPrintHtml(fullDetail, getWarehouseName));
      doc.close();
      iframe.onload = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => iframe.remove(), 1500);
      };
    } catch (err: any) {
      logApiError('companyProcurement.printDelivery', err);
      toast.error('Không in được đợt giao', getApiErrorMessage(err));
    }
  };

  const tabs: Array<{ key: TabKey; label: string; icon: React.ElementType; count?: number }> = [
    { key: 'demand', label: 'Nhu cầu chờ mua', icon: ClipboardList, count: demandRows.length },
    { key: 'po', label: 'PO công ty', icon: ShoppingCart, count: companyPos.length },
    { key: 'delivery', label: 'Lịch giao hàng', icon: Truck, count: deliveryGroups.length },
    { key: 'reconcile', label: 'Đối chiếu', icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="px-5 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-6 w-6 text-emerald-600" />
                <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100">Mua hàng</h1>
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Gom nhu cầu từ nhiều dự án, tạo PO công ty và theo dõi từng đợt giao.</p>
            </div>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <RefreshCw size={16} />
              Làm mới
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-black transition ${active
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                >
                  <Icon size={16} />
                  {tab.label}
                  {typeof tab.count === 'number' && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{tab.count}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-5 py-5">
        {loading ? (
          <div className="flex h-72 items-center justify-center rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
          </div>
        ) : (
          <>
            {activeTab === 'demand' && (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 xl:flex-row xl:items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      value={query}
                      onChange={event => setQuery(event.target.value)}
                      placeholder="Tìm MR, vật tư, dự án, kho"
                      className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm font-semibold outline-none focus:border-emerald-300 dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <select value={warehouseFilter} onChange={event => setWarehouseFilter(event.target.value)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold dark:border-slate-700 dark:bg-slate-950">
                    <option value="">Tất cả kho</option>
                    {warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={handleCreatePo}
                    disabled={saving || selectedRows.length === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <ShoppingCart size={16} />}
                    Tạo PO gộp
                  </button>
                </div>

                {selectedRows.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                    Đã chọn {selectedRows.length} dòng, tổng SL còn cần {formatQty(selectedSummary.qty)}, giá trị tạm tính {formatMoney(selectedSummary.value)}.
                  </div>
                )}

                <div className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <div className="overflow-x-auto">
                    <table className="min-w-[1550px] w-full text-left text-sm table-fixed">
                      <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        <tr>
                          <th className="w-10 px-2 py-3"></th>
                          <th className="w-64 px-2 py-3">Nhu cầu</th>
                          <th className="w-60 px-2 py-3">Nguồn</th>
                          <th className="w-24 px-2 py-3 text-right">BOQ</th>
                          <th className="w-28 px-2 py-3 text-right">Đề xuất</th>
                          <th className="w-24 px-2 py-3 text-right">PO mở</th>
                          <th className="w-24 px-2 py-3 text-right">Thực nhận</th>
                          <th className="w-24 px-2 py-3 text-right">Còn cần</th>


                          <th className="w-32 px-2 py-3 text-right">SL đặt</th>
                          <th className="w-36 px-2 py-3 text-right">Đơn giá</th>
                          <th className="w-40 px-2 py-3 text-right">Thành tiền</th>
                          <th className="w-60 px-2 py-3">NCC</th>

                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredDemandRows.map(row => {
                          const selected = selectedKeys.includes(row.key);
                          const draft = draftByKey[row.key];
                          const price = selected
                            ? Number(draft?.stockUnitPrice || 0)
                            : Number(itemById.get(row.itemId)?.priceIn || 0);
                          const qty = selected
                            ? Number(draft?.orderStockQty || 0)
                            : Number(row.remainingQty || 0);
                          const lineAmount = qty * price;

                          return (
                            <tr key={row.key} className={selected ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : ''}>
                              <td className="w-10 px-2 py-3">
                                <button
                                  type="button"
                                  onClick={() => toggleRow(row)}
                                  className={`flex h-6 w-6 items-center justify-center rounded border ${selected ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-transparent dark:border-slate-700 dark:bg-slate-950'}`}
                                >
                                  <Check size={14} />
                                </button>
                              </td>
                              <td className="w-64 px-2 py-3">
                                <div className="font-black text-slate-900 dark:text-slate-100 break-words">{row.itemName}</div>
                                <div className="mt-1 font-mono text-xs font-bold text-indigo-600">{row.request.code}</div>
                                {row.requestLine.overBudgetReason && (
                                  <div className="mt-1 max-w-[240px] rounded bg-orange-50 px-2 py-1 text-xs font-bold text-orange-700 dark:bg-orange-950/30 dark:text-orange-300 break-words">
                                    {row.requestLine.overBudgetReason}
                                  </div>
                                )}
                              </td>
                              <td className="w-60 px-2 py-3">
                                <div className="font-bold text-slate-700 dark:text-slate-200 break-words">{getProjectName(row.projectId)}</div>
                                {/* <div className="text-xs font-semibold text-slate-500 break-words">
                                  {getSiteName(row.constructionSiteId)} • {getWarehouseName(row.targetWarehouseId)}
                                </div> */}
                              </td>
                              <td className="w-24 px-2 py-3 text-right font-bold">{row.boqQty == null ? '—' : formatQty(Number(row.boqQty))}</td>
                              <td className="w-28 px-2 py-3 text-right font-bold">{formatQty(row.requestedQty)} {row.unit}</td>
                              <td className="w-24 px-2 py-3 text-right font-bold text-blue-700">{formatQty(row.orderedQty)}</td>
                              <td className="w-24 px-2 py-3 text-right font-bold text-emerald-700">{formatQty(row.actualReceivedQty)}</td>
                              <td className="w-24 px-2 py-3 text-right font-black text-amber-700">{formatQty(row.remainingQty)}</td>

                              <td className="w-32 px-2 py-3 text-right">
                                {selected ? (
                                  <input
                                    value={draft?.orderStockQty || ''}
                                    onChange={event => updateDraftLine(row.key, { orderStockQty: event.target.value })}
                                    className="w-full max-w-[110px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-right text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                                  />
                                ) : formatQty(row.remainingQty)}
                              </td>
                              <td className="w-36 px-2 py-3 text-right">
                                {selected ? (
                                  <input
                                    value={draft?.stockUnitPrice || ''}
                                    onChange={event => updateDraftLine(row.key, { stockUnitPrice: event.target.value })}
                                    className="w-full max-w-[120px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-right text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                                  />
                                ) : formatMoney(itemById.get(row.itemId)?.priceIn || 0)}
                              </td>
                              <td className="w-40 px-2 py-3 text-right font-black text-slate-900 dark:text-slate-100">
                                {formatMoney(lineAmount)}
                              </td>
                              <td className="w-60 px-2 py-3">
                                {selected ? (
                                  <select
                                    value={draft?.vendorId || ''}
                                    onChange={event => {
                                      const partner = partnerById.get(event.target.value);
                                      updateDraftLine(row.key, { vendorId: event.target.value, vendorName: partner?.name || '' });
                                    }}
                                    className="w-full max-w-[220px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                                  >
                                    <option value="">Chọn NCC</option>
                                    {partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
                                  </select>
                                ) : (
                                  <span className="text-xs font-bold text-slate-500 break-words">{row.supplierId ? partnerById.get(row.supplierId)?.name || row.supplierId : '—'}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'po' && (
              <div className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="min-w-[1100px] w-full text-left text-sm">
                    <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3">PO</th>
                        <th className="px-4 py-3">NCC / Nhóm mua</th>
                        <th className="px-4 py-3 text-right">Dòng</th>
                        <th className="px-4 py-3 text-right">Đã nhận</th>
                        <th className="px-4 py-3 text-right">Giá trị</th>
                        <th className="px-4 py-3">Trạng thái</th>
                        <th className="px-4 py-3 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {companyPos.map(po => (
                        <tr key={po.id}>
                          <td className="px-4 py-4">
                            <div className="font-mono text-base font-black text-slate-900 dark:text-slate-100">{po.poNumber}</div>
                            <div className="text-xs font-semibold text-slate-500">{formatDate(po.orderDate)}</div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="font-bold text-slate-800 dark:text-slate-100">{po.vendorName || po.vendorId}</div>
                            <div className="font-mono text-xs font-bold text-purple-600">{po.procurementGroupNo || '—'}</div>
                          </td>
                          <td className="px-4 py-4 text-right font-bold">{po.items.length}</td>
                          <td className="px-4 py-4 text-right font-bold text-emerald-700">{formatQty(sumPoReceivedStockQty(po))}</td>
                          <td className="px-4 py-4 text-right font-black">{formatMoney(po.totalAmount)}</td>
                          <td className="px-4 py-4">
                            <span className="rounded bg-blue-50 px-2 py-1 text-xs font-black text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">{poStatusLabel[po.status] || po.status}</span>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <button
                              type="button"
                              onClick={() => openDeliveryModal(po)}
                              className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                            >
                              <Truck size={14} />
                              Tạo đợt giao
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'delivery' && (
              <div className="grid gap-3">
                {deliveryGroups.map(detail => {
                  const po = detail.purchaseOrder;
                  const total = detail.batches.flatMap(batch => batch.lines).reduce((sum, line) => sum + Number(line.issuedQty || 0) * Number(line.deliveryUnitPrice || 0), 0);
                  return (
                    <div key={detail.group.id} className="rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <button type="button" onClick={() => printDeliveryGroup(detail)} className="text-left">
                          <div className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-indigo-600" />
                            <span className="font-mono text-lg font-black text-indigo-700 dark:text-indigo-300">{detail.group.deliveryNo}</span>
                          </div>
                          <div className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">{po?.poNumber || detail.group.purchaseOrderId} • {po?.vendorName || po?.vendorId || '—'} • {formatDate(detail.group.plannedDate)}</div>
                        </button>
                        <div className="flex items-center gap-2">
                          <div className="rounded-md bg-slate-100 px-3 py-2 text-right dark:bg-slate-800">
                            <div className="text-xs font-bold uppercase text-slate-500">Thành tiền đợt</div>
                            <div className="font-black text-slate-900 dark:text-slate-100">{formatMoney(total)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => printDeliveryGroup(detail)}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                          >
                            <Printer size={16} />
                            In đợt
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2">
                        {detail.batches.flatMap(batch => batch.lines.map(line => (
                          <div key={line.id} className="grid grid-cols-1 gap-2 rounded-md border border-slate-100 px-3 py-2 text-sm dark:border-slate-800 md:grid-cols-[1fr_140px_140px_160px]">
                            <div>
                              <div className="font-bold text-slate-800 dark:text-slate-100">{batch.batchNo}</div>
                              <div className="text-xs font-semibold text-slate-500">{getWarehouseName(batch.targetWarehouseId)}</div>
                            </div>
                            <div className="font-bold">{formatQty(Number(line.issuedQty || 0))} {line.deliveryUnit || line.unit}</div>
                            <div className="font-bold">{formatMoney(Number(line.deliveryUnitPrice || 0))}</div>
                            <div className="text-right font-black">{formatMoney(Number(line.issuedQty || 0) * Number(line.deliveryUnitPrice || 0))}</div>
                          </div>
                        )))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'reconcile' && (
              <div className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="min-w-[1000px] w-full text-left text-sm">
                    <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Dự án / MR</th>
                        <th className="px-4 py-3">Vật tư</th>
                        <th className="px-4 py-3 text-right">BOQ</th>
                        <th className="px-4 py-3 text-right">Đề xuất</th>
                        <th className="px-4 py-3 text-right">PO mở</th>
                        <th className="px-4 py-3 text-right">Thực nhận</th>
                        <th className="px-4 py-3 text-right">Chênh lệch nhận/BOQ</th>
                        <th className="px-4 py-3 text-right">Còn cần</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {demandRows.map(row => {
                        const boq = Number(row.boqQty || 0);
                        const variance = row.actualReceivedQty - boq;
                        return (
                          <tr key={row.key}>
                            <td className="px-4 py-3">
                              <div className="font-bold">{getProjectName(row.projectId)}</div>
                              <div className="font-mono text-xs font-bold text-indigo-600">{row.request.code}</div>
                            </td>
                            <td className="px-4 py-3 font-bold">{row.itemName}</td>
                            <td className="px-4 py-3 text-right">{row.boqQty == null ? '—' : formatQty(boq)}</td>
                            <td className="px-4 py-3 text-right">{formatQty(row.requestedQty)}</td>
                            <td className="px-4 py-3 text-right text-blue-700">{formatQty(row.orderedQty)}</td>
                            <td className="px-4 py-3 text-right text-emerald-700">{formatQty(row.actualReceivedQty)}</td>
                            <td className={`px-4 py-3 text-right font-black ${variance > 0 ? 'text-orange-700' : variance < 0 ? 'text-emerald-700' : 'text-slate-700'}`}>{row.boqQty == null ? '—' : formatQty(variance)}</td>
                            <td className="px-4 py-3 text-right font-black text-amber-700">{formatQty(row.remainingQty)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {selectedPoForDelivery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-md bg-white shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <PackageCheck className="h-5 w-5 text-emerald-600" />
                  <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">Tạo đợt giao {selectedPoForDelivery.poNumber}</h2>
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-500">{selectedPoForDelivery.vendorName || selectedPoForDelivery.vendorId}</p>
              </div>
              <button type="button" onClick={() => setSelectedPoForDelivery(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              {deliveryLoading ? (
                <div className="flex h-56 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-emerald-600" /></div>
              ) : (
                <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                  <table className="min-w-[980px] w-full text-left text-sm">
                    <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-3">MR / Kho nhận</th>
                        <th className="px-3 py-3">Vật tư</th>
                        <th className="px-3 py-3 text-right">Còn lại tham khảo</th>
                        <th className="px-3 py-3 text-right">SL đợt này</th>
                        <th className="px-3 py-3 text-right">Giá đợt</th>
                        <th className="px-3 py-3 text-right">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {deliveryDraftLines.map((line, index) => (
                        <tr key={`${line.link.id || line.link.requestLineId}-${index}`}>
                          <td className="px-3 py-3">
                            <div className="font-mono text-xs font-black text-indigo-600">{line.requestCode}</div>
                            <div className="text-xs font-semibold text-slate-500">{line.warehouseName}</div>
                          </td>
                          <td className="px-3 py-3 font-bold">{line.itemName}</td>
                          <td className="px-3 py-3 text-right font-bold">{formatQty(line.remainingQty)} {line.unit}</td>
                          <td className="px-3 py-3 text-right">
                            <input
                              value={line.issueQty}
                              onChange={event => updateDeliveryDraftLine(index, { issueQty: event.target.value })}
                              className="w-28 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-right font-bold dark:border-slate-700 dark:bg-slate-950"
                            />
                          </td>
                          <td className="px-3 py-3 text-right">
                            <input
                              value={line.unitPrice}
                              onChange={event => updateDeliveryDraftLine(index, { unitPrice: event.target.value })}
                              className="w-32 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-right font-bold dark:border-slate-700 dark:bg-slate-950"
                            />
                          </td>
                          <td className="px-3 py-3 text-right font-black">{formatMoney(Number(line.issueQty || 0) * Number(line.unitPrice || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
              <button type="button" onClick={() => setSelectedPoForDelivery(null)} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Đóng</button>
              <button
                type="button"
                onClick={handleCreateDelivery}
                disabled={saving || deliveryLoading}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700 disabled:bg-slate-300"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />}
                Tạo đợt giao
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompanyProcurement;
