import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  BarChart3,
  Check,
  ClipboardList,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  PackageCheck,
  Pencil,
  Printer,
  RefreshCw,
  Save,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { companyProcurementService } from '../../lib/companyProcurementService';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { partnerService } from '../../lib/partnerService';
import { projectMasterService } from '../../lib/projectMasterService';
import { poService } from '../../lib/projectService';
import { materialRequestFulfillmentService } from '../../lib/materialRequestFulfillmentService';
import { getPoLineStockUnitPrice } from '../../lib/materialUnitConversion';
import SupplierCombobox from '../../components/SupplierCombobox';
import {
  canUserMutatePurchaseOrder,
  getPurchaseOrderRemovalBlockReason,
  purchaseOrderHasStockImpact,
  summarizePurchaseOrderWork,
} from '../../lib/purchaseOrderMutationState';
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

type DeliveryEditDraft = {
  plannedDate: string;
  note: string;
  lines: Record<string, {
    issuedQty: string;
    deliveryUnitPrice: string;
  }>;
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

const toDateInputValue = (value?: string | null) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isRejectedDeliveryGroup = (detail: CompanyProcurementDeliveryGroupDetail) =>
  detail.group.status === 'cancelled'
  || (detail.batches.length > 0 && detail.batches.every(batch =>
    ['returned', 'cancelled'].includes(batch.status)
    && batch.lines.every(line => Number(line.receivedQty || 0) <= 0)
  ));

const isEditableDeliveryGroup = (detail: CompanyProcurementDeliveryGroupDetail) =>
  ['draft', 'issued'].includes(detail.group.status)
  && detail.batches.every(batch =>
    ['draft', 'issued'].includes(batch.status)
    && batch.lines.every(line => Number(line.receivedQty || 0) <= 0)
  );

const isRemovableDeliveryGroup = (detail: CompanyProcurementDeliveryGroupDetail) =>
  detail.batches.length === 0 || isRejectedDeliveryGroup(detail);

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
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<TabKey>('demand');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingDeliveryGroupId, setDeletingDeliveryGroupId] = useState<string | null>(null);
  const [savingDeliveryGroupId, setSavingDeliveryGroupId] = useState<string | null>(null);
  const [editingDeliveryGroupId, setEditingDeliveryGroupId] = useState<string | null>(null);
  const [expandedDeliveryGroupIds, setExpandedDeliveryGroupIds] = useState<string[]>([]);
  const [deliveryEditDraft, setDeliveryEditDraft] = useState<DeliveryEditDraft | null>(null);
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
  const deliveryGroupsByPoId = useMemo(() => deliveryGroups.reduce<Record<string, CompanyProcurementDeliveryGroupDetail[]>>((acc, detail) => {
    const poId = detail.group.purchaseOrderId;
    acc[poId] = [...(acc[poId] || []), detail];
    return acc;
  }, {}), [deliveryGroups]);

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

  const handleRemovePo = async (po: PurchaseOrder) => {
    const details = deliveryGroupsByPoId[po.id] || [];
    const fulfillmentBatches = details.flatMap(detail => detail.batches);
    const blockReason = getPurchaseOrderRemovalBlockReason(po, user, fulfillmentBatches);
    if (blockReason) {
      toast.warning('Chưa thể xoá/lưu trữ PO', blockReason);
      return;
    }

    const hasStockImpact = purchaseOrderHasStockImpact(po);
    const ok = await confirm({
      targetName: po.poNumber,
      title: hasStockImpact ? 'Lưu trữ PO công ty' : 'Xoá PO công ty',
      confirmText: hasStockImpact ? 'Lưu trữ' : 'Xoá PO',
      warningText: hasStockImpact
        ? 'PO đã phát sinh nhập kho/hoàn kho nên chỉ được lưu trữ sau khi đối soát đủ.'
        : 'PO chưa phát sinh nhập kho và không còn giao dịch chờ xử lý nên có thể xoá.',
      intent: hasStockImpact ? 'warning' : 'danger',
      countdownSeconds: hasStockImpact ? 1 : 2,
    });
    if (!ok) return;

    setSaving(true);
    try {
      const result = await poService.remove(po.id);
      toast.success(result.action === 'deleted' ? 'Đã xoá PO' : 'Đã lưu trữ PO');
      await refresh();
    } catch (err: any) {
      logApiError('companyProcurement.removePo', err);
      toast.error('Không xoá/lưu trữ được PO', getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleDeliveryGroupView = (groupId: string) => {
    setExpandedDeliveryGroupIds(prev => prev.includes(groupId)
      ? prev.filter(id => id !== groupId)
      : [...prev, groupId]);
  };

  const startEditingDeliveryGroup = (detail: CompanyProcurementDeliveryGroupDetail) => {
    const po = detail.purchaseOrder;
    if (!po || !canUserMutatePurchaseOrder(po, user)) {
      toast.warning('Không có quyền sửa đợt giao', 'Chỉ Admin hoặc người tạo PO được sửa đợt giao này.');
      return;
    }
    if (!isEditableDeliveryGroup(detail)) {
      toast.warning('Chưa thể sửa đợt giao', 'Chỉ sửa được khi đợt chưa nhập kho, chưa bị từ chối và phiếu kho chưa được xử lý.');
      return;
    }

    const lines = detail.batches.flatMap(batch => batch.lines);
    setDeliveryEditDraft({
      plannedDate: toDateInputValue(detail.group.plannedDate),
      note: detail.group.note || '',
      lines: Object.fromEntries(lines.map(line => [line.id, {
        issuedQty: String(Number(line.issuedQty || 0)),
        deliveryUnitPrice: String(Number(line.deliveryUnitPrice || 0)),
      }])),
    });
    setEditingDeliveryGroupId(detail.group.id);
    setExpandedDeliveryGroupIds(prev => prev.includes(detail.group.id) ? prev : [...prev, detail.group.id]);
  };

  const cancelEditingDeliveryGroup = () => {
    setEditingDeliveryGroupId(null);
    setDeliveryEditDraft(null);
  };

  const updateDeliveryEditLine = (
    lineId: string,
    patch: Partial<DeliveryEditDraft['lines'][string]>,
  ) => {
    setDeliveryEditDraft(prev => prev ? {
      ...prev,
      lines: {
        ...prev.lines,
        [lineId]: {
          ...(prev.lines[lineId] || { issuedQty: '0', deliveryUnitPrice: '0' }),
          ...patch,
        },
      },
    } : prev);
  };

  const handleSaveDeliveryGroup = async (detail: CompanyProcurementDeliveryGroupDetail) => {
    if (!deliveryEditDraft || editingDeliveryGroupId !== detail.group.id || savingDeliveryGroupId) return;
    if (!deliveryEditDraft.plannedDate) {
      toast.warning('Thiếu ngày giao', 'Vui lòng chọn ngày giao dự kiến.');
      return;
    }

    const lines = detail.batches.flatMap(batch => batch.lines).map(line => ({
      id: line.id,
      issuedQty: Number(deliveryEditDraft.lines[line.id]?.issuedQty || 0),
      deliveryUnitPrice: Number(deliveryEditDraft.lines[line.id]?.deliveryUnitPrice || 0),
    }));
    if (lines.some(line => !Number.isFinite(line.issuedQty) || line.issuedQty <= 0)) {
      toast.warning('Số lượng chưa hợp lệ', 'Số lượng của mỗi dòng phải lớn hơn 0.');
      return;
    }
    if (lines.some(line => !Number.isFinite(line.deliveryUnitPrice) || line.deliveryUnitPrice < 0)) {
      toast.warning('Đơn giá chưa hợp lệ', 'Đơn giá của mỗi dòng không được âm.');
      return;
    }

    setSavingDeliveryGroupId(detail.group.id);
    try {
      await companyProcurementService.updateDeliveryGroup({
        deliveryGroupId: detail.group.id,
        plannedDate: deliveryEditDraft.plannedDate,
        note: deliveryEditDraft.note,
        lines,
      });
      toast.success('Đã lưu đợt giao', `${detail.group.deliveryNo} đã được cập nhật.`);
      cancelEditingDeliveryGroup();
      await refresh();
    } catch (err: any) {
      logApiError('companyProcurement.updateDeliveryGroup', err);
      toast.error('Không lưu được đợt giao', getApiErrorMessage(err));
    } finally {
      setSavingDeliveryGroupId(null);
    }
  };

  const handleRemoveDeliveryGroup = async (detail: CompanyProcurementDeliveryGroupDetail) => {
    const po = detail.purchaseOrder;
    if (!po) {
      toast.warning('Thiếu dữ liệu PO', 'Không xác định được PO của đợt giao này.');
      return;
    }
    if (!canUserMutatePurchaseOrder(po, user)) {
      toast.warning('Không có quyền xoá đợt giao', 'Chỉ Admin hoặc người tạo PO được xoá đợt giao này.');
      return;
    }
    if (!isRemovableDeliveryGroup(detail)) {
      toast.warning('Chưa thể xoá đợt giao', 'Đợt giao còn phiếu kho chờ xử lý. Hãy để thủ kho huỷ/từ chối phiếu trước khi xoá đợt.');
      return;
    }
    const ok = await confirm({
      targetName: detail.group.deliveryNo,
      title: 'Xoá đợt giao bị từ chối',
      confirmText: 'Xoá đợt giao',
      warningText: 'Chỉ xoá được khi đợt giao chưa nhập kho, không có ledger kho và các phiếu SL/CL liên quan đã bị từ chối/huỷ.',
      intent: 'danger',
      countdownSeconds: 2,
    });
    if (!ok) return;

    setDeletingDeliveryGroupId(detail.group.id);
    try {
      await materialRequestFulfillmentService.removeFailedPoDeliveryGroup(detail.group.id);
      toast.success('Đã xoá đợt giao bị từ chối');
      await refresh();
    } catch (err: any) {
      logApiError('companyProcurement.removeDeliveryGroup', err);
      toast.error('Không xoá được đợt giao', getApiErrorMessage(err));
    } finally {
      setDeletingDeliveryGroupId(null);
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
                                  <SupplierCombobox
                                    value={draft?.vendorId || ''}
                                    suppliers={partners}
                                    onChange={partner => {
                                      updateDraftLine(row.key, { vendorId: partner?.id || '', vendorName: partner?.name || '' });
                                    }}
                                    placeholder="Gõ tìm NCC..."
                                    inputClassName="rounded-md py-1.5 text-xs"
                                  />
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
                      {companyPos.map(po => {
                        const details = deliveryGroupsByPoId[po.id] || [];
                        const fulfillmentBatches = details.flatMap(detail => detail.batches);
                        const workSummary = summarizePurchaseOrderWork(po, fulfillmentBatches);
                        const removalBlockReason = getPurchaseOrderRemovalBlockReason(po, user, fulfillmentBatches);
                        const hasStockImpact = purchaseOrderHasStockImpact(po);
                        const canMutate = canUserMutatePurchaseOrder(po, user);
                        const removeTitle = removalBlockReason || (hasStockImpact ? 'Lưu trữ PO' : 'Xoá PO');
                        return (
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
                              <div className="flex flex-wrap gap-1.5">
                                <span className="rounded bg-blue-50 px-2 py-1 text-xs font-black text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">{poStatusLabel[po.status] || po.status}</span>
                                {workSummary.isRejectedBeforeReceipt && (
                                  <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-xs font-black text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
                                    <Ban size={12} /> Từ chối
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => openDeliveryModal(po)}
                                  disabled={workSummary.hasPendingWork}
                                  title={workSummary.hasPendingWork ? 'PO đang có đợt giao chờ xử lý.' : 'Tạo đợt giao'}
                                  className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                                >
                                  <Truck size={14} />
                                  Tạo đợt giao
                                </button>
                                {canMutate && (
                                  <button
                                    type="button"
                                    onClick={() => !removalBlockReason && handleRemovePo(po)}
                                    disabled={saving || !!removalBlockReason}
                                    title={removeTitle}
                                    className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"
                                  >
                                    <Trash2 size={14} />
                                    {hasStockImpact ? 'Lưu trữ' : 'Xoá'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'delivery' && (
              <div className="grid gap-3">
                {deliveryGroups.map(detail => {
                  const po = detail.purchaseOrder;
                  const detailLines = detail.batches.flatMap(batch => batch.lines.map(line => ({ batch, line })));
                  const isEditingGroup = editingDeliveryGroupId === detail.group.id && !!deliveryEditDraft;
                  const isExpandedGroup = isEditingGroup || expandedDeliveryGroupIds.includes(detail.group.id);
                  const total = detailLines.reduce((sum, { line }) => {
                    const editLine = isEditingGroup ? deliveryEditDraft.lines[line.id] : null;
                    const issuedQty = Number(editLine?.issuedQty ?? line.issuedQty ?? 0);
                    const unitPrice = Number(editLine?.deliveryUnitPrice ?? line.deliveryUnitPrice ?? 0);
                    return sum + issuedQty * unitPrice;
                  }, 0);
                  const isRejectedGroup = isRejectedDeliveryGroup(detail);
                  const canMutateGroup = !!po && canUserMutatePurchaseOrder(po, user);
                  const canEditGroup = canMutateGroup && isEditableDeliveryGroup(detail);
                  const isDeletingGroup = deletingDeliveryGroupId === detail.group.id;
                  const isSavingGroup = savingDeliveryGroupId === detail.group.id;
                  return (
                    <div key={detail.group.id} className="rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="text-left">
                          <div className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-indigo-600" />
                            <span className="font-mono text-lg font-black text-indigo-700 dark:text-indigo-300">{detail.group.deliveryNo}</span>
                            {isRejectedGroup && (
                              <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-xs font-black text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
                                <Ban size={12} /> Từ chối
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">{po?.poNumber || detail.group.purchaseOrderId} • {po?.vendorName || po?.vendorId || '—'} • {formatDate(detail.group.plannedDate)}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="rounded-md bg-slate-100 px-3 py-2 text-right dark:bg-slate-800">
                            <div className="text-xs font-bold uppercase text-slate-500">Thành tiền đợt</div>
                            <div className="font-black text-slate-900 dark:text-slate-100">{formatMoney(total)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleDeliveryGroupView(detail.group.id)}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                          >
                            {isExpandedGroup ? <EyeOff size={16} /> : <Eye size={16} />}
                            {isExpandedGroup ? 'Thu gọn' : 'Xem'}
                          </button>
                          {isEditingGroup ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleSaveDeliveryGroup(detail)}
                                disabled={isSavingGroup}
                                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60"
                              >
                                {isSavingGroup ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                Lưu
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditingDeliveryGroup}
                                disabled={isSavingGroup}
                                className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                              >
                                <X size={16} />
                                Huỷ
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditingDeliveryGroup(detail)}
                              disabled={!canEditGroup}
                              title={!canMutateGroup
                                ? 'Chỉ Admin hoặc người tạo PO được sửa.'
                                : !canEditGroup
                                  ? 'Đợt đã được xử lý, nhập kho hoặc từ chối nên không thể sửa.'
                                  : 'Sửa đợt giao'}
                              className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-black text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
                            >
                              <Pencil size={16} />
                              Sửa
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => printDeliveryGroup(detail)}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                          >
                            <Printer size={16} />
                            In đợt
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveDeliveryGroup(detail)}
                            disabled={!canMutateGroup || isDeletingGroup || isSavingGroup}
                            title={!canMutateGroup
                              ? 'Chỉ Admin hoặc người tạo PO được xoá.'
                              : isRemovableDeliveryGroup(detail)
                                ? 'Xoá đợt giao'
                                : 'Cần huỷ/từ chối phiếu kho trước khi xoá đợt.'}
                            className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-black text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                          >
                            {isDeletingGroup ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            Xoá
                          </button>
                        </div>
                      </div>
                      {isExpandedGroup && (
                        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                          {isEditingGroup ? (
                            <div className="mb-3 grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                              <label className="grid gap-1 text-xs font-black uppercase text-slate-500">
                                Ngày giao dự kiến
                                <input
                                  type="date"
                                  value={deliveryEditDraft.plannedDate}
                                  onChange={event => setDeliveryEditDraft(prev => prev ? { ...prev, plannedDate: event.target.value } : prev)}
                                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                />
                              </label>
                              <label className="grid gap-1 text-xs font-black uppercase text-slate-500">
                                Ghi chú
                                <input
                                  type="text"
                                  value={deliveryEditDraft.note}
                                  onChange={event => setDeliveryEditDraft(prev => prev ? { ...prev, note: event.target.value } : prev)}
                                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold normal-case text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                  placeholder="Ghi chú cho đợt giao"
                                />
                              </label>
                            </div>
                          ) : detail.group.note ? (
                            <div className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                              {detail.group.note}
                            </div>
                          ) : null}
                          <div className="grid gap-2">
                            {detailLines.map(({ batch, line }) => {
                              const editLine = isEditingGroup ? deliveryEditDraft.lines[line.id] : null;
                              const issuedQty = Number(editLine?.issuedQty ?? line.issuedQty ?? 0);
                              const unitPrice = Number(editLine?.deliveryUnitPrice ?? line.deliveryUnitPrice ?? 0);
                              return (
                                <div key={line.id} className="grid grid-cols-1 gap-3 rounded-md border border-slate-100 px-3 py-3 text-sm dark:border-slate-800 md:grid-cols-[minmax(0,1fr)_160px_160px_160px] md:items-end">
                                  <div>
                                    <div className="font-black text-slate-800 dark:text-slate-100">{itemById.get(line.itemId)?.name || line.itemId}</div>
                                    <div className="mt-1 text-xs font-semibold text-slate-500">{batch.batchNo} • {getWarehouseName(batch.targetWarehouseId)}</div>
                                  </div>
                                  {isEditingGroup ? (
                                    <>
                                      <label className="grid gap-1 text-xs font-black uppercase text-slate-500">
                                        Số lượng
                                        <div className="flex h-10 items-center overflow-hidden rounded-md border border-slate-200 bg-white focus-within:border-indigo-500 dark:border-slate-700 dark:bg-slate-950">
                                          <input
                                            type="number"
                                            min="0.001"
                                            step="0.001"
                                            value={editLine?.issuedQty || ''}
                                            onChange={event => updateDeliveryEditLine(line.id, { issuedQty: event.target.value })}
                                            className="min-w-0 flex-1 bg-transparent px-3 text-right text-sm font-bold text-slate-800 outline-none dark:text-slate-100"
                                          />
                                          <span className="pr-3 text-xs font-bold normal-case text-slate-500">{line.deliveryUnit || line.unit}</span>
                                        </div>
                                      </label>
                                      <label className="grid gap-1 text-xs font-black uppercase text-slate-500">
                                        Đơn giá
                                        <input
                                          type="number"
                                          min="0"
                                          step="1"
                                          value={editLine?.deliveryUnitPrice || ''}
                                          onChange={event => updateDeliveryEditLine(line.id, { deliveryUnitPrice: event.target.value })}
                                          className="h-10 rounded-md border border-slate-200 bg-white px-3 text-right text-sm font-bold text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                        />
                                      </label>
                                    </>
                                  ) : (
                                    <>
                                      <div>
                                        <div className="text-xs font-black uppercase text-slate-400">Số lượng</div>
                                        <div className="mt-1 font-bold">{formatQty(issuedQty)} {line.deliveryUnit || line.unit}</div>
                                      </div>
                                      <div>
                                        <div className="text-xs font-black uppercase text-slate-400">Đơn giá</div>
                                        <div className="mt-1 font-bold">{formatMoney(unitPrice)}</div>
                                      </div>
                                    </>
                                  )}
                                  <div className="md:text-right">
                                    <div className="text-xs font-black uppercase text-slate-400">Thành tiền</div>
                                    <div className="mt-1 font-black">{formatMoney(issuedQty * unitPrice)}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
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
