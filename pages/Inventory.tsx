
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { Search, Filter, Plus, QrCode, Upload, FileSpreadsheet, Trash2, MoreHorizontal, ShieldAlert, AlertTriangle, Loader2, Download, RefreshCcw } from 'lucide-react';
import ScannerModal from '../components/ScannerModal';
import AddInventoryModal from '../components/AddInventoryModal';
import InventoryDetailModal from '../components/InventoryDetailModal';
import DeleteInventoryModal from '../components/DeleteInventoryModal';
import ReceivePurchaseOrderModal from '../components/ReceivePurchaseOrderModal';
import ReceiveFulfillmentBatchModal from '../components/ReceiveFulfillmentBatchModal';
import ExcelImportReviewModal from '../components/ExcelImportReviewModal';
import Pagination from '../components/Pagination';
import { usePagination } from '../hooks/usePagination';
import { loadXlsx } from '../lib/loadXlsx';
import { InventoryItem, Transaction, TransactionType, TransactionStatus, PurchaseOrder, MaterialRequest, MaterialRequestFulfillmentBatch } from '../types';
import { usePermission } from '../hooks/usePermission';
import { useModuleData } from '../hooks/useModuleData';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { poService } from '../lib/projectService';
import { extractPoToken, PO_QR_PARAM } from '../lib/poQr';
import { extractFulfillmentBatchToken, FULFILLMENT_BATCH_QR_PARAM } from '../lib/fulfillmentBatchQr';
import { materialRequestFulfillmentService } from '../lib/materialRequestFulfillmentService';
import {
  ExcelImportMode,
  ExcelImportPreview,
  applyImportChanges,
  buildImportPreview,
  getExcelCell,
  parseExcelRows,
} from '../lib/excelImport';

type InventoryExcelRecord = InventoryItem & {
  initialWarehouseId?: string;
  initialStock?: number;
};

const normalizeText = (value: unknown) => String(value || '').trim().toLowerCase();

const parseExcelNumber = (value: unknown): number => {
  const raw = String(value ?? '').trim().replace(/\s/g, '');
  if (!raw) return 0;
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  const normalized = lastComma > lastDot
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/,/g, '');
  return Number(normalized);
};

const formatNumber = (value: unknown) => Number(value || 0).toLocaleString('vi-VN');

const validateNonNegativeNumber = (
  value: unknown,
  label: string,
  options: { integer?: boolean; max?: number } = {},
): string | undefined => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return `${label} phải là số không âm.`;
  if (options.integer && !Number.isInteger(number)) return `${label} phải là số nguyên.`;
  if (options.max !== undefined && number > options.max) return `${label} không được vượt quá ${options.max}.`;
  return undefined;
};

const warehouseAliases = ['Kho nhận hàng', 'Kho', 'Tên kho'];

const Inventory: React.FC = () => {
  const location = useLocation();
  const { items, warehouses, requests, addItem, updateItem, removeItem, addTransaction, user, categories, units } = useApp();
  useModuleData('wms');
  const toast = useToast();
  const [searchTerm, setSearchTerm] = useState('');

  const hasAssignedWh = !!user.assignedWarehouseId;
  const { canManage } = usePermission();
  const canCRUD = canManage('/inventory');

  // Khởi tạo filter kho
  const [filterWarehouse, setFilterWarehouse] = useState('all');
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);

  useEffect(() => {
    if (hasAssignedWh && user.assignedWarehouseId) {
      setFilterWarehouse(user.assignedWarehouseId);
    }

    // Handle filter from dashboard
    if (location.state?.filter === 'low') {
      setShowLowStockOnly(true);
    }
  }, [hasAssignedWh, user, location.state]);

  const [isScannerOpen, setScannerOpen] = useState(false);
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState<ExcelImportMode>('create');
  const [importPreview, setImportPreview] = useState<ExcelImportPreview<InventoryExcelRecord> | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);
  const [receivingPo, setReceivingPo] = useState<PurchaseOrder | null>(null);
  const [receivingFulfillmentBatch, setReceivingFulfillmentBatch] = useState<MaterialRequestFulfillmentBatch | null>(null);
  const [receivingFulfillmentRequest, setReceivingFulfillmentRequest] = useState<MaterialRequest | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importModeRef = useRef<ExcelImportMode>('create');
  const lastLoadedQrTokenRef = useRef<string | null>(null);

  // Logic lọc vật tư theo yêu cầu bảo mật mới
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchTerm.toLowerCase());

      let matchesFilter = true;

      // Nếu là thủ kho:
      // Thấy tất cả vật tư thuộc kho mình (có entry trong stockByWarehouse, kể cả tồn = 0)
      // Điều này đảm bảo thủ kho thấy được hết danh mục vật tư kho mình quản lý
      if (hasAssignedWh && user.assignedWarehouseId) {
        matchesFilter = user.assignedWarehouseId in item.stockByWarehouse;
      } else if (filterWarehouse !== 'all') {
        // Nếu là Admin nhưng đang chọn lọc 1 kho cụ thể
        matchesFilter = filterWarehouse in item.stockByWarehouse;
      }

      // Lọc cảnh báo tồn
      if (showLowStockOnly) {
        const stock = filterWarehouse === 'all'
          ? Object.values(item.stockByWarehouse).reduce((a, b) => (a as number) + (b as number), 0)
          : (item.stockByWarehouse[filterWarehouse] || 0);
        matchesFilter = matchesFilter && stock <= item.minStock;
      }

      return matchesSearch && matchesFilter;
    });
  }, [items, searchTerm, hasAssignedWh, user, filterWarehouse, showLowStockOnly]);

  const { paginatedItems, currentPage, totalPages, totalItems, pageSize, setPage, setPageSize, startIndex, endIndex } = usePagination<InventoryItem>(filteredItems, 20);

  const getDisplayStock = (item: InventoryItem): number => {
    if (filterWarehouse === 'all') {
      return Object.values(item.stockByWarehouse).reduce((a, b) => (a as number) + (b as number), 0);
    }
    return item.stockByWarehouse[filterWarehouse] || 0;
  };

  const loadDocumentFromQr = async (raw: string) => {
    const fulfillmentToken = extractFulfillmentBatchToken(raw);
    const poToken = extractPoToken(raw);
    if (!fulfillmentToken && !poToken) {
      toast.error('QR không hợp lệ', 'Mã QR không phải phiếu NCC hoặc phiếu xuất kho nội bộ hợp lệ.');
      return;
    }

    setLoadingQr(true);
    try {
      if (fulfillmentToken) {
        const batch = await materialRequestFulfillmentService.getByQrToken(fulfillmentToken);
        if (!batch) {
          toast.error('Không tìm thấy phiếu xuất', 'Mã QR không phải phiếu xuất kho nội bộ hợp lệ.');
          return;
        }
        const request = requests.find(item => item.id === batch.materialRequestId);
        if (!request) {
          toast.error('Không tìm thấy đề xuất', 'Phiếu xuất tồn tại nhưng chưa tải được phiếu đề xuất liên quan.');
          return;
        }
        setReceivingFulfillmentRequest(request);
        setReceivingFulfillmentBatch(batch);
        return;
      }

      if (poToken) {
        const po = await poService.getByQrToken(poToken);
        if (!po) {
          toast.error('Không tìm thấy PO', 'Mã QR không phải phiếu nhập NCC hợp lệ.');
          return;
        }
        if (['cancelled', 'returned', 'closed', 'delivered'].includes(po.status)) {
          toast.warning('PO không còn chờ nhận', 'Không thể nhận thêm từ PO đã huỷ, hoàn hàng, đóng hoặc giao đủ.');
          return;
        }
        if (!['in_transit', 'partial'].includes(po.status)) {
          toast.warning('PO chưa ở trạng thái Đang giao', 'Vui lòng chuyển PO sang Đang giao để hệ thống tạo phiếu chờ Duyệt SL/CL trước khi quét QR.');
          return;
        }
        setReceivingPo(po);
      }
    } catch (err: any) {
      logApiError('inventory.loadDocumentQr', err);
      toast.error('Không thể tải phiếu QR', getApiErrorMessage(err, 'Không thể tải phiếu từ Supabase.'));
    } finally {
      setLoadingQr(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get(FULFILLMENT_BATCH_QR_PARAM) || params.get(PO_QR_PARAM);
    const loadKey = `${token || ''}:${requests.length}`;
    if (!token || lastLoadedQrTokenRef.current === loadKey) return;
    lastLoadedQrTokenRef.current = loadKey;
    void loadDocumentFromQr(token);
  }, [location.search, requests]);

  const handleAddItem = async (item: InventoryItem) => {
    await addItem(item);
  };

  const handleDeleteConfirm = async () => {
    if (itemToDelete) {
      setDeletingItem(true);
      try {
        await removeItem(itemToDelete.id);
        toast.success('Đã xoá vật tư', itemToDelete.name);
        setItemToDelete(null);
      } catch (err: any) {
        logApiError('inventory.deleteItem', err);
        toast.error('Không thể xoá vật tư', getApiErrorMessage(err, 'Không thể xoá vật tư trên Supabase.'));
      } finally {
        setDeletingItem(false);
      }
    }
  };

  const downloadWorkbook = (XLSX: any, workbook: any, fileName: string) => {
    const wbOut = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadTemplate = async () => {
    try {
      const XLSX = await loadXlsx();
      const sampleCategory = categories[0]?.name || 'Vật liệu xây dựng';
      const sampleUnit = units[0]?.name || 'Cái';
      const samplePurchaseUnit = units.find(unit => unit.name !== sampleUnit)?.name || '';
      const sampleWarehouse = warehouses.find(warehouse => warehouse.id === user.assignedWarehouseId) || warehouses[0];
      const workbook = XLSX.utils.book_new();

      const createSheet = XLSX.utils.json_to_sheet([{
        'Mã SKU *': 'STEEL-001',
        'Tên vật tư *': 'Thép cuộn phi 6',
        'Danh mục *': sampleCategory,
        'ĐVT Chính *': sampleUnit,
        'Đơn vị phụ (Đơn vị mua hàng)': samplePurchaseUnit,
        'Giá nhập': 15000,
        'Giá xuất': 16500,
        'Tồn tối thiểu': 10,
        'Lead time mặc định': 7,
        'Vị trí': 'Kệ A-01',
        'Kho nhận hàng': sampleWarehouse?.name || '',
        'Số lượng ban đầu': 100,
      }]);
      createSheet['!cols'] = [
        { wch: 18 }, { wch: 32 }, { wch: 24 }, { wch: 18 }, { wch: 30 }, { wch: 16 },
        { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 24 }, { wch: 28 }, { wch: 20 },
      ];
      XLSX.utils.book_append_sheet(workbook, createSheet, 'Nhap_moi');

      const updateSheet = XLSX.utils.json_to_sheet([{
        'Mã SKU *': items[0]?.sku || 'STEEL-001',
        'Tên vật tư': '',
        'Danh mục': '',
        'ĐVT Chính': '',
        'Đơn vị phụ (Đơn vị mua hàng)': '',
        'Giá nhập': '',
        'Giá xuất': '',
        'Tồn tối thiểu': '',
        'Lead time mặc định': 15,
        'Vị trí': '',
      }]);
      updateSheet['!cols'] = [
        { wch: 18 }, { wch: 32 }, { wch: 24 }, { wch: 18 }, { wch: 30 },
        { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 24 },
      ];
      XLSX.utils.book_append_sheet(workbook, updateSheet, 'Cap_nhat');

      const guideSheet = XLSX.utils.aoa_to_sheet([
        ['Chức năng', 'Cách dùng'],
        ['Nhập mới', 'Dùng sheet Nhap_moi. Mã SKU đã tồn tại hoặc bị trùng trong file sẽ được báo lỗi trước khi ghi.'],
        ['Cập nhật', 'Dùng sheet Cap_nhat. Mã SKU phải tồn tại; ô trống nghĩa là giữ nguyên giá trị hiện tại.'],
        ['Đối chiếu', 'Sau khi chọn file, hệ thống hiển thị từng lỗi và từng thay đổi cũ → mới để người dùng kiểm tra.'],
        ['Xoá giá trị', 'Dùng __CLEAR__ cho Đơn vị phụ hoặc Vị trí khi cập nhật.'],
        ['Tồn ban đầu', 'Kho nhận hàng là bắt buộc nếu Số lượng ban đầu > 0. Tồn ban đầu sẽ tạo phiếu nhập kho chờ duyệt.'],
        ['Danh mục / Đơn vị / Kho', 'Phải nhập đúng giá trị có trong các sheet danh mục hợp lệ.'],
      ]);
      guideSheet['!cols'] = [{ wch: 24 }, { wch: 110 }];
      XLSX.utils.book_append_sheet(workbook, guideSheet, 'Huong_dan');

      const categorySheet = XLSX.utils.json_to_sheet(categories.map(category => ({ 'Danh mục hợp lệ': category.name })));
      categorySheet['!cols'] = [{ wch: 30 }];
      XLSX.utils.book_append_sheet(workbook, categorySheet, 'Danh_muc');

      const unitSheet = XLSX.utils.json_to_sheet(units.map(unit => ({ 'Đơn vị hợp lệ': unit.name })));
      unitSheet['!cols'] = [{ wch: 24 }];
      XLSX.utils.book_append_sheet(workbook, unitSheet, 'Don_vi');

      const warehouseSheet = XLSX.utils.json_to_sheet(warehouses.map(warehouse => ({
        'Kho hợp lệ': warehouse.name,
        'Loại kho': warehouse.type,
      })));
      warehouseSheet['!cols'] = [{ wch: 32 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(workbook, warehouseSheet, 'Kho');

      downloadWorkbook(XLSX, workbook, 'Mau_Nhap_Cap_nhat_Vat_tu.xlsx');
      toast.success('Đã tạo file mẫu', 'File gồm sheet nhập mới, cập nhật và danh mục đối chiếu.');
    } catch (error) {
      logApiError('inventory.downloadTemplate', error);
      toast.error('Không thể tạo file mẫu', getApiErrorMessage(error, 'Không thể xuất file Excel mẫu.'));
    }
  };

  const handleExportExcel = async () => {
    if (filteredItems.length === 0) {
      toast.warning('Không có dữ liệu xuất', 'Danh sách vật tư đang hiển thị không có dữ liệu.');
      return;
    }

    try {
      const XLSX = await loadXlsx();
      const rows = [...filteredItems]
        .sort((a, b) => a.sku.localeCompare(b.sku, 'vi'))
        .map(item => ({
          'Mã SKU': item.sku,
          'Tên vật tư': item.name,
          'Danh mục': item.category,
          'ĐVT Chính': item.unit,
          'Đơn vị phụ': item.purchaseUnit || '',
          'Giá nhập': item.priceIn || 0,
          'Giá xuất': item.priceOut || 0,
          'Tồn tối thiểu': item.minStock || 0,
          'Lead time mặc định': item.defaultLeadTimeDays ?? 7,
          'Vị trí': item.location || '',
          'Tồn tổng': Object.values(item.stockByWarehouse || {}).reduce((sum, quantity) => sum + Number(quantity || 0), 0),
          ...Object.fromEntries(warehouses.map(warehouse => [
            `Tồn - ${warehouse.name}`,
            Number(item.stockByWarehouse?.[warehouse.id] || 0),
          ])),
        }));
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet['!cols'] = [
        { wch: 18 }, { wch: 32 }, { wch: 24 }, { wch: 18 }, { wch: 20 },
        { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 24 }, { wch: 18 },
        ...warehouses.map(() => ({ wch: 24 })),
      ];
      if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'Danh_sach_vat_tu');
      downloadWorkbook(XLSX, workbook, `Danh_sach_vat_tu_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Đã xuất Excel', `Đã xuất ${rows.length} vật tư đang hiển thị.`);
    } catch (error) {
      logApiError('inventory.exportExcel', error);
      toast.error('Không thể xuất Excel', getApiErrorMessage(error, 'Không thể xuất danh sách vật tư.'));
    }
  };

  const findCategoryName = (value: string) =>
    categories.find(category => normalizeText(category.name) === normalizeText(value))?.name || '';

  const findUnitName = (value: string) =>
    units.find(unit => normalizeText(unit.name) === normalizeText(value))?.name || '';

  const findWarehouseId = (value: string) =>
    warehouses.find(warehouse => normalizeText(warehouse.name) === normalizeText(value))?.id || '';

  const buildInventoryImportPreview = (mode: ExcelImportMode, rows: Record<string, unknown>[]) =>
    buildImportPreview<InventoryExcelRecord>({
      mode,
      keyLabel: 'Mã SKU',
      keyAliases: ['Mã SKU *', 'Mã SKU', 'SKU'],
      existingRecords: items,
      getRecordKey: item => item.sku,
      createBaseRecord: (sku, _row, rowNumber) => ({
        id: `it-${Date.now()}-${rowNumber}-${Math.random().toString(36).substring(2, 7)}`,
        sku,
        name: '',
        category: '',
        unit: '',
        priceIn: 0,
        priceOut: 0,
        minStock: 0,
        defaultLeadTimeDays: 7,
        stockByWarehouse: {},
        initialStock: 0,
      }),
      fields: [
        { key: 'name', label: 'Tên vật tư', aliases: ['Tên vật tư *', 'Tên vật tư', 'Tên'], requiredOnCreate: true },
        {
          key: 'category',
          label: 'Danh mục',
          aliases: ['Danh mục *', 'Danh mục'],
          requiredOnCreate: true,
          normalize: value => findCategoryName(value),
          validate: (value, row) => {
            const raw = getExcelCell(row, ['Danh mục *', 'Danh mục']);
            return raw && !value ? `Danh mục "${raw}" không tồn tại.` : undefined;
          },
        },
        {
          key: 'unit',
          label: 'ĐVT Chính',
          aliases: ['ĐVT Chính *', 'ĐVT Chính', 'Đơn vị chính', 'Đơn vị tính'],
          requiredOnCreate: true,
          normalize: value => findUnitName(value),
          validate: (value, row) => {
            const raw = getExcelCell(row, ['ĐVT Chính *', 'ĐVT Chính', 'Đơn vị chính', 'Đơn vị tính']);
            return raw && !value ? `ĐVT Chính "${raw}" không tồn tại.` : undefined;
          },
        },
        {
          key: 'purchaseUnit',
          label: 'Đơn vị phụ',
          aliases: ['Đơn vị phụ (Đơn vị mua hàng)', 'Đơn vị phụ', 'Đơn vị mua hàng'],
          clearable: true,
          normalize: value => findUnitName(value),
          validate: (value, row) => {
            const raw = getExcelCell(row, ['Đơn vị phụ (Đơn vị mua hàng)', 'Đơn vị phụ', 'Đơn vị mua hàng']);
            return raw && value !== undefined && !value ? `Đơn vị phụ "${raw}" không tồn tại.` : undefined;
          },
        },
        {
          key: 'priceIn',
          label: 'Giá nhập',
          aliases: ['Giá nhập', 'Giá mua'],
          normalize: parseExcelNumber,
          validate: value => validateNonNegativeNumber(value, 'Giá nhập'),
          format: formatNumber,
        },
        {
          key: 'priceOut',
          label: 'Giá xuất',
          aliases: ['Giá xuất', 'Giá bán'],
          normalize: parseExcelNumber,
          validate: value => validateNonNegativeNumber(value, 'Giá xuất'),
          format: formatNumber,
        },
        {
          key: 'minStock',
          label: 'Tồn tối thiểu',
          aliases: ['Tồn tối thiểu', 'Mức tồn tối thiểu'],
          normalize: parseExcelNumber,
          validate: value => validateNonNegativeNumber(value, 'Tồn tối thiểu', { integer: true }),
          format: formatNumber,
        },
        {
          key: 'defaultLeadTimeDays',
          label: 'Lead time mặc định',
          aliases: ['Lead time mặc định', 'Lead time', 'Số ngày lead time'],
          normalize: parseExcelNumber,
          validate: value => validateNonNegativeNumber(value, 'Lead time mặc định', { integer: true, max: 365 }),
          format: formatNumber,
        },
        {
          key: 'location',
          label: 'Vị trí',
          aliases: ['Vị trí', 'Vị trí trong kho'],
          clearable: true,
        },
        ...(mode === 'create' ? [
          {
            key: 'initialWarehouseId' as const,
            label: 'Kho nhận hàng',
            aliases: warehouseAliases,
            normalize: findWarehouseId,
            validate: (value: unknown, row: Record<string, unknown>) => {
              const raw = getExcelCell(row, warehouseAliases);
              if (raw && !value) return `Kho "${raw}" không tồn tại.`;
              if (value && user.assignedWarehouseId && value !== user.assignedWarehouseId) {
                const assignedName = warehouses.find(warehouse => warehouse.id === user.assignedWarehouseId)?.name || user.assignedWarehouseId;
                return `Bạn chỉ được nhập vào kho được phân công: "${assignedName}".`;
              }
              return undefined;
            },
            format: (value: unknown) => warehouses.find(warehouse => warehouse.id === value)?.name || '-',
          },
          {
            key: 'initialStock' as const,
            label: 'Số lượng ban đầu',
            aliases: ['Số lượng ban đầu', 'Số lượng nhập', 'Tồn ban đầu'],
            normalize: parseExcelNumber,
            validate: (value: unknown, row: Record<string, unknown>) => {
              const numberError = validateNonNegativeNumber(value, 'Số lượng ban đầu');
              if (numberError) return numberError;
              if (Number(value) > 0 && !getExcelCell(row, warehouseAliases)) {
                return 'Thiếu Kho nhận hàng khi Số lượng ban đầu > 0.';
              }
              return undefined;
            },
            format: formatNumber,
          },
        ] : []),
      ],
    }, rows);

  const openInventoryImport = (mode: ExcelImportMode) => {
    importModeRef.current = mode;
    setImportMode(mode);
    importInputRef.current?.click();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    try {
      const rows = await parseExcelRows(file, importModeRef.current === 'create' ? 'Nhap_moi' : 'Cap_nhat');
      if (rows.length === 0) {
        toast.warning('File Excel trống', 'Không có dòng vật tư nào để đối chiếu.');
        return;
      }
      const preview = buildInventoryImportPreview(importModeRef.current, rows);
      if (preview.totalRows === 0) {
        toast.warning('File Excel trống', 'Không có dòng vật tư hợp lệ để đối chiếu.');
        return;
      }
      setImportPreview(preview);
    } catch (error) {
      logApiError('inventory.import.read', error);
      toast.error('Không thể đọc file Excel', getApiErrorMessage(error, 'File Excel không hợp lệ. Vui lòng dùng file mẫu.'));
    } finally {
      setImporting(false);
    }
  };

  const handleConfirmInventoryImport = async ({ validOnly }: { validOnly: boolean }) => {
    if (!importPreview) return;
    const records = applyImportChanges(importPreview);
    if (records.length === 0) {
      toast.warning('Không có dữ liệu cần ghi', 'File không có dòng thêm mới hoặc cập nhật hợp lệ.');
      return;
    }

    setImporting(true);
    try {
      let created = 0;
      let updated = 0;
      const stockRequestsByWarehouse: Record<string, { itemId: string; quantity: number; price: number }[]> = {};

      for (const record of records) {
        const { initialWarehouseId, initialStock, ...itemData } = record;
        const normalizedItem: InventoryItem = {
          ...itemData,
          purchaseUnit: itemData.purchaseUnit && itemData.purchaseUnit !== itemData.unit ? itemData.purchaseUnit : undefined,
          defaultLeadTimeDays: Math.max(0, Math.min(365, Number(itemData.defaultLeadTimeDays ?? 7))),
          location: itemData.location || undefined,
          stockByWarehouse: itemData.stockByWarehouse || {},
        };

        if (importPreview.mode === 'create') {
          await addItem(normalizedItem);
          created += 1;
          if (initialWarehouseId && Number(initialStock || 0) > 0) {
            if (!stockRequestsByWarehouse[initialWarehouseId]) stockRequestsByWarehouse[initialWarehouseId] = [];
            stockRequestsByWarehouse[initialWarehouseId].push({
              itemId: normalizedItem.id,
              quantity: Number(initialStock),
              price: normalizedItem.priceIn || 0,
            });
          }
        } else {
          await updateItem(normalizedItem);
          updated += 1;
        }
      }

      for (const [warehouseId, transactionItems] of Object.entries(stockRequestsByWarehouse)) {
        const transaction: Transaction = {
          id: `tx-bulk-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          type: TransactionType.IMPORT,
          date: new Date().toISOString(),
          items: transactionItems,
          targetWarehouseId: warehouseId,
          requesterId: user.id,
          status: TransactionStatus.PENDING,
          note: `Nhập tồn ban đầu từ Excel (${transactionItems.length} vật tư)`,
        };
        await addTransaction(transaction);
      }

      setImportPreview(null);
      toast.success(
        importPreview.mode === 'create' ? 'Đã nhập mới vật tư' : 'Đã cập nhật vật tư',
        `Thêm mới ${created}, cập nhật ${updated}, tạo ${Object.keys(stockRequestsByWarehouse).length} phiếu nhập chờ duyệt${validOnly ? ' từ các dòng hợp lệ' : ''}.`,
      );
    } catch (error) {
      logApiError('inventory.import.apply', error);
      toast.error('Không thể ghi dữ liệu Excel', getApiErrorMessage(error, 'Không thể lưu vật tư hoặc phiếu nhập kho lên Supabase.'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <ScannerModal
        isOpen={isScannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={loadDocumentFromQr}
        title="Quét QR phiếu nhập kho"
        description="Quét mã QR trên phiếu NCC hoặc phiếu xuất kho nội bộ để xác nhận thực nhận."
        manualPlaceholder="Nhập token PO hoặc phiếu xuất..."
      />
      {importPreview && (
        <ExcelImportReviewModal
          title={importPreview.mode === 'create' ? 'Đối chiếu nhập mới vật tư' : 'Đối chiếu cập nhật vật tư'}
          preview={importPreview}
          loading={importing}
          onClose={() => setImportPreview(null)}
          onConfirm={handleConfirmInventoryImport}
        />
      )}
      <input
        ref={importInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleFileUpload}
        disabled={importing}
      />
      <AddInventoryModal isOpen={isAddModalOpen} onClose={() => setAddModalOpen(false)} onAdd={handleAddItem} />
      <InventoryDetailModal isOpen={!!selectedItem} onClose={() => setSelectedItem(null)} item={selectedItem} />
      <DeleteInventoryModal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} targetItem={itemToDelete} onConfirm={handleDeleteConfirm} isDeleting={deletingItem} />
      <ReceivePurchaseOrderModal
        isOpen={!!receivingPo}
        po={receivingPo}
        onClose={() => setReceivingPo(null)}
        onReceived={(po) => setReceivingPo(po)}
      />
      <ReceiveFulfillmentBatchModal
        isOpen={!!receivingFulfillmentBatch}
        request={receivingFulfillmentRequest}
        batch={receivingFulfillmentBatch}
        onClose={() => {
          setReceivingFulfillmentBatch(null);
          setReceivingFulfillmentRequest(null);
        }}
        onReceived={() => {
          setReceivingFulfillmentBatch(null);
          setReceivingFulfillmentRequest(null);
        }}
      />

      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-5">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Kho & Vật tư</h1>
          {hasAssignedWh && (
            <div className="flex items-center gap-2 mt-1 text-accent font-black uppercase text-[10px] tracking-widest bg-blue-50 px-2 py-1 rounded-lg border border-blue-100">
              <ShieldAlert size={12} />
              Kho quản lý: {warehouses.find(w => w.id === user.assignedWarehouseId)?.name}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 w-full xl:w-auto">
          {canCRUD && (
            <div className="flex flex-wrap gap-2 w-full xl:w-auto">
              <button
                onClick={handleDownloadTemplate}
                disabled={importing}
                className="flex-1 sm:flex-none flex items-center justify-center px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition text-[10px] font-black uppercase tracking-widest disabled:opacity-60"
              >
                <FileSpreadsheet className="w-4 h-4 mr-2 text-green-600" /> Tải mẫu
              </button>
              <button
                onClick={handleExportExcel}
                disabled={importing}
                className="flex-1 sm:flex-none flex items-center justify-center px-4 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl hover:bg-emerald-100 transition text-[10px] font-black uppercase tracking-widest disabled:opacity-60"
              >
                <Download className="w-4 h-4 mr-2" /> Xuất Excel
              </button>
              <button
                onClick={() => openInventoryImport('create')}
                disabled={importing}
                className="flex-1 sm:flex-none flex items-center justify-center px-4 py-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-xl hover:bg-blue-100 transition text-[10px] font-black uppercase tracking-widest disabled:opacity-60 disabled:cursor-wait"
              >
                {importing && importMode === 'create'
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <Upload className="w-4 h-4 mr-2" />}
                Nhập mới
              </button>
              <button
                onClick={() => openInventoryImport('update')}
                disabled={importing}
                className="flex-1 sm:flex-none flex items-center justify-center px-4 py-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl hover:bg-amber-100 transition text-[10px] font-black uppercase tracking-widest disabled:opacity-60 disabled:cursor-wait"
              >
                {importing && importMode === 'update'
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <RefreshCcw className="w-4 h-4 mr-2" />}
                Cập nhật
              </button>
            </div>
          )}
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={() => setScannerOpen(true)}
              disabled={loadingQr}
              className="flex-1 sm:flex-none flex items-center justify-center px-6 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition text-[10px] font-black uppercase tracking-widest disabled:opacity-60 disabled:cursor-wait"
            >
              {loadingQr ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <QrCode className="w-4 h-4 mr-2" />}
              {loadingQr ? 'Đang tải phiếu...' : 'Quét QR phiếu'}
            </button>

            {(canCRUD || hasAssignedWh) && (
              <button onClick={() => setAddModalOpen(true)} className="flex-1 sm:flex-none flex items-center justify-center px-6 py-2 bg-accent text-white rounded-xl hover:bg-blue-700 transition text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/20">
                <Plus className="w-4 h-4 mr-2" /> Thêm mới
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input
            type="text" placeholder="Tìm theo tên, mã SKU..."
            className="w-full pl-10 pr-4 py-3 text-sm border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-accent font-medium bg-slate-50/50"
            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="w-full md:w-64 relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <select
              disabled={hasAssignedWh} // Khóa nếu có kho phân công
              className="w-full pl-9 pr-8 py-3 text-sm border border-slate-200 rounded-xl appearance-none bg-slate-50/50 outline-none focus:ring-2 focus:ring-accent disabled:opacity-70 font-black uppercase tracking-tighter"
              value={filterWarehouse} onChange={(e) => setFilterWarehouse(e.target.value)}
            >
              {!hasAssignedWh && <option value="all">Tất cả kho hệ thống</option>}
              {warehouses.map(wh => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
            </select>
          </div>
          <button
            onClick={() => setShowLowStockOnly(!showLowStockOnly)}
            className={`flex items-center justify-center px-4 py-3 rounded-xl border transition-all text-[10px] font-black uppercase tracking-widest ${showLowStockOnly ? 'bg-red-50 border-red-200 text-red-600' : 'bg-white border-slate-200 text-slate-400'}`}
          >
            <AlertTriangle className={`w-4 h-4 mr-2 ${showLowStockOnly ? 'text-red-600' : 'text-slate-400'}`} />
            Cảnh báo tồn
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto scrollbar-hide">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-500 text-[10px] uppercase font-black tracking-widest">
                <th className="p-4">Mã SKU</th>
                <th className="p-4">Tên vật tư</th>
                <th className="p-4">Danh mục</th>
                <th className="p-4 text-right">Tồn tại kho</th>
                <th className="p-4 text-center">Trạng thái</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {paginatedItems.map(item => {
                const stock = getDisplayStock(item);
                const isLow = stock <= item.minStock;
                return (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="p-4 font-mono text-slate-400 font-bold text-xs">{item.sku}</td>
                    <td className="p-4 font-black text-slate-800 cursor-pointer hover:text-accent" onClick={() => setSelectedItem(item)}>
                      <div className="truncate max-w-[200px]">{item.name}</div>
                    </td>
                    <td className="p-4 text-slate-500 font-medium">{item.category}</td>
                    <td className="p-4 text-right">
                      <span className={`font-black ${isLow ? 'text-red-600' : 'text-slate-800'}`}>{stock.toLocaleString()}</span>
                      <span className="text-[10px] text-slate-400 ml-1 uppercase font-bold">{item.unit}</span>
                    </td>
                    <td className="p-4 text-center">
                      {isLow ? (
                        <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded-[4px] text-[8px] font-black uppercase border border-red-100">Sắp hết</span>
                      ) : (
                        <span className="bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-[4px] text-[8px] font-black uppercase border border-emerald-100">An toàn</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canCRUD && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setItemToDelete(item); }}
                            className="p-2 text-slate-300 hover:text-red-600 transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        <button onClick={() => setSelectedItem(item)} className="text-slate-300 hover:text-accent p-2">
                          <MoreHorizontal size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination currentPage={currentPage} totalPages={totalPages} totalItems={totalItems} startIndex={startIndex} endIndex={endIndex} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-slate-100">
          {paginatedItems.map(item => {
            const stock = getDisplayStock(item);
            const isLow = stock <= item.minStock;
            return (
              <div key={item.id} className="p-4 space-y-3 active:bg-slate-50 transition-colors" onClick={() => setSelectedItem(item)}>
                <div className="flex justify-between items-start">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-mono text-slate-400 font-bold uppercase mb-0.5">{item.sku}</div>
                    <h4 className="font-black text-slate-800 text-sm truncate pr-4">{item.name}</h4>
                  </div>
                  {isLow ? (
                    <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded-[4px] text-[8px] font-black uppercase border border-red-100 shrink-0">Sắp hết</span>
                  ) : (
                    <span className="bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-[4px] text-[8px] font-black uppercase border border-emerald-100 shrink-0">An toàn</span>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500 font-medium">{item.category}</span>
                  <div className="text-right">
                    <span className={`font-black text-sm ${isLow ? 'text-red-600' : 'text-slate-800'}`}>{stock.toLocaleString()}</span>
                    <span className="text-[10px] text-slate-400 ml-1 uppercase font-bold">{item.unit}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filteredItems.length === 0 && (
          <div className="p-20 text-center text-slate-300 font-black uppercase tracking-widest italic text-sm">Không có dữ liệu vật tư phù hợp.</div>
        )}
      </div>
    </div>
  );
};

export default Inventory;
