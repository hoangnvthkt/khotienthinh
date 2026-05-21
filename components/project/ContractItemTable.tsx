import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Trash2, Save, X, ChevronRight, ChevronDown, Upload,
  Package, Edit2, GripVertical, FileSpreadsheet, AlertTriangle, CheckCircle2, Loader2, Download, RefreshCcw,
} from 'lucide-react';
import { ContractItem, ContractItemType } from '../../types';
import { contractItemService } from '../../lib/contractItemService';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import ContractItemDetailModal from './ContractItemDetailModal';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import ExcelImportReviewModal from '../ExcelImportReviewModal';
import { ExcelImportMode, ExcelImportPreview, applyImportChanges, buildImportPreview, parseExcelRows } from '../../lib/excelImport';
import { loadXlsx } from '../../lib/loadXlsx';

interface ContractItemTableProps {
  contractId: string;
  contractType: ContractItemType;
  projectId?: string | null;
  constructionSiteId?: string | null;
  readOnly?: boolean;
  readOnlyReason?: string;
}

const fmt = (n: number) => n.toLocaleString('vi-VN');
const fmtMoney = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' tỷ';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' tr';
  return fmt(n) + ' đ';
};

const EMPTY_ITEM: Partial<ContractItem> = {
  code: '', name: '', unit: 'm2', quantity: 0, unitPrice: 0, totalPrice: 0, order: 0,
};

const parseImportNumber = (value: unknown): number => {
  const normalized = String(value ?? '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const ContractItemTable: React.FC<ContractItemTableProps> = ({
  contractId, contractType, projectId, constructionSiteId, readOnly, readOnlyReason,
}) => {
  const toast = useToast();
  const confirm = useConfirm();
  const { loading: saving, run } = useAsyncAction({
    errorTitle: 'Không thể cập nhật BOQ',
    fallbackError: 'Không thể lưu hạng mục BOQ lên Supabase.',
    logScope: 'contractItems.mutation',
  });
  const [items, setItems] = useState<ContractItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<ContractItem>>({});
  const [showAddRow, setShowAddRow] = useState(false);
  const [newItem, setNewItem] = useState<Partial<ContractItem>>({ ...EMPTY_ITEM });
  const [detailItem, setDetailItem] = useState<ContractItem | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState<ExcelImportMode>('create');
  const [importPreview, setImportPreview] = useState<ExcelImportPreview<ContractItem> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importModeRef = useRef<ExcelImportMode>('create');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await contractItemService.listByContract(contractId, contractType);
      setItems(data);
      // Auto-expand all groups
      const groups = new Set(data.filter(i => data.some(c => c.parentId === i.id)).map(i => i.id));
      setExpandedGroups(groups);
    } catch (error) {
      logApiError('contractItems.load', error);
      toast.error('Lỗi tải BOQ', getApiErrorMessage(error, 'Không thể tải danh sách BOQ.'));
    }
    finally { setLoading(false); }
  }, [contractId, contractType]);

  useEffect(() => { load(); }, [load]);

  // Build tree structure
  const rootItems = items.filter(i => !i.parentId);
  const getChildren = (parentId: string) => items.filter(i => i.parentId === parentId);
  const isGroup = (id: string) => items.some(i => i.parentId === id);

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Summary
  const totalValue = items.filter(i => !isGroup(i.id)).reduce((s, i) => s + (i.revisedTotalPrice ?? i.totalPrice ?? 0), 0);
  const completedValue = items.filter(i => !isGroup(i.id)).reduce((s, i) => s + ((i.completedQuantity || 0) * i.unitPrice), 0);
  const completedPercent = totalValue > 0 ? (completedValue / totalValue) * 100 : 0;

  // CRUD handlers
  const handleAdd = async () => {
    if (!newItem.code || !newItem.name) { toast.warning('Thiếu thông tin', 'Nhập mã và tên hạng mục'); return; }
    await run(async () => {
      await contractItemService.create({
        ...newItem as any,
        contractId,
        contractType,
        projectId: projectId || constructionSiteId || null,
        constructionSiteId,
        quantity: newItem.quantity || 0,
        unitPrice: newItem.unitPrice || 0,
        totalPrice: (newItem.quantity || 0) * (newItem.unitPrice || 0),
        order: items.length,
      });
      setShowAddRow(false);
      setNewItem({ ...EMPTY_ITEM });
      await load();
    }, { successTitle: 'Thêm hạng mục thành công', errorTitle: 'Không thể thêm hạng mục BOQ' });
  };

  const handleStartEdit = (item: ContractItem) => {
    setEditingId(item.id);
    setEditData({ code: item.code, name: item.name, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    await run(async () => {
      await contractItemService.update(editingId, editData);
      setEditingId(null);
      await load();
    }, { successTitle: 'Cập nhật hạng mục thành công', errorTitle: 'Không thể cập nhật hạng mục BOQ' });
  };

  const handleDelete = async (item: ContractItem) => {
    const ok = await confirm({ targetName: `${item.code} — ${item.name}`, title: 'Xoá hạng mục BOQ' });
    if (!ok) return;
    await run(async () => {
      await contractItemService.remove(item.id);
      await load();
    }, { successTitle: 'Xoá hạng mục thành công', errorTitle: 'Không thể xoá hạng mục BOQ' });
  };

  const handleDownloadTemplate = async () => {
    try {
      const XLSX = await loadXlsx();
      const createHeaders = [
        'Mã số *', 'Tên hạng mục *', 'Hạng mục cha', 'ĐVT *', 'Khối lượng *', 'Đơn giá *',
        'Mô tả', 'Chủng loại', 'Thương hiệu', 'Xuất xứ', 'Thông số kỹ thuật',
        'Chiều dài', 'Chiều rộng', 'Chiều cao', 'Đơn giá vật liệu', 'Đơn giá nhân công',
        'Đơn giá MTC', 'Mã công tác', 'Ghi chú',
      ];
      const createRows = [
        ['HM-001', 'Đào đất móng', '', 'm3', 100, 150000, 'Đào đất móng công trình', '', '', '', '', '', '', '', '', '', '', '', ''],
        ['HM-002', 'Bê tông lót đá 4x6', '', 'm3', 25, 1200000, '', 'Bê tông', '', 'Việt Nam', '', '', '', '', 800000, 250000, 150000, '', ''],
        ['HM-003', 'Cốt thép móng', 'HM-002', 'kg', 2500, 18000, '', 'Thép', 'Hòa Phát', 'Việt Nam', '', '', '', '', 16000, 1500, 500, '', ''],
      ];
      const updateHeaders = ['Mã số *', 'Tên hạng mục', 'ĐVT', 'Khối lượng', 'Đơn giá', 'Ghi chú'];
      const updateRows = [
        ['HM-001', '', '', 120, '', 'Cập nhật riêng khối lượng, các cột trống giữ nguyên'],
      ];
      const guideRows = [
        ['Nội dung', 'Hướng dẫn'],
        ['Nhập mới', 'Dùng sheet Nhap_moi. Mã số đã tồn tại trong hợp đồng sẽ bị báo lỗi.'],
        ['Cập nhật', 'Dùng sheet Cap_nhat hoặc file chỉ gồm Mã số và các cột muốn sửa. Mã số phải tồn tại trong BOQ hiện tại.'],
        ['Ô trống', 'Trong chế độ Cập nhật, ô trống nghĩa là không đổi dữ liệu.'],
        ['Xóa giá trị', 'Dùng token __CLEAR__ cho các cột cho phép xoá như Ghi chú, Mô tả.'],
        ['Hạng mục cha', 'Nhập mã hạng mục cha đã tồn tại trong BOQ. V1 chưa tự liên kết cha được tạo trong cùng file.'],
        ['Số tiền', 'Nhập số thuần, không nhập kèm ký hiệu tiền tệ.'],
      ];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([createHeaders, ...createRows]);
      ws['!cols'] = [
        { wch: 16 },
        { wch: 36 },
        { wch: 18 },
        { wch: 12 },
        { wch: 16 },
        { wch: 18 },
        { wch: 32 },
        { wch: 18 },
        { wch: 18 },
        { wch: 18 },
        { wch: 28 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 18 },
        { wch: 18 },
        { wch: 18 },
        { wch: 16 },
        { wch: 28 },
      ];
      const updateWs = XLSX.utils.aoa_to_sheet([updateHeaders, ...updateRows]);
      updateWs['!cols'] = [{ wch: 16 }, { wch: 36 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 40 }];
      const guide = XLSX.utils.aoa_to_sheet(guideRows);
      guide['!cols'] = [{ wch: 18 }, { wch: 90 }];
      XLSX.utils.book_append_sheet(wb, ws, 'Nhap_moi');
      XLSX.utils.book_append_sheet(wb, updateWs, 'Cap_nhat');
      XLSX.utils.book_append_sheet(wb, guide, 'Huong_dan');
      const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Mau_import_BOQ.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Đã tải file mẫu BOQ');
    } catch (error) {
      logApiError('contractItems.template', error);
      toast.error('Không thể tạo file mẫu', getApiErrorMessage(error, 'Không thể tạo file Excel mẫu BOQ.'));
    }
  };

  const buildBoqImportPreview = (mode: ExcelImportMode, sourceRows: Record<string, unknown>[]) => {
    const parentByCode = new Map(items.map(item => [item.code.trim().toLowerCase(), item]));
    return buildImportPreview<ContractItem>({
      mode,
      keyLabel: 'Mã số',
      keyAliases: ['Mã số *', 'Mã số', 'Mã BOQ *', 'Mã BOQ', 'Mã'],
      existingRecords: items,
      getRecordKey: record => record.code,
      createBaseRecord: (code, _row, rowNumber) => ({
        id: '',
        contractId,
        contractType,
        projectId: projectId || constructionSiteId || null,
        constructionSiteId,
        code,
        name: '',
        unit: 'm2',
        quantity: 0,
        unitPrice: 0,
        totalPrice: 0,
        revisedQuantity: 0,
        revisedUnitPrice: 0,
        revisedTotalPrice: 0,
        order: items.length + rowNumber,
      }),
      validateKey: code => {
        if (code.length > 50) return 'Mã số không được vượt quá 50 ký tự.';
        return undefined;
      },
      fields: [
        {
          key: 'name',
          label: 'Tên hạng mục',
          aliases: ['Tên hạng mục *', 'Tên hạng mục', 'Hạng mục', 'Tên BOQ'],
          requiredOnCreate: true,
        },
        {
          key: 'parentId',
          label: 'Hạng mục cha',
          aliases: ['Hạng mục cha', 'Mã hạng mục cha', 'Mã cha'],
          clearable: true,
          normalize: value => {
            const parentCode = String(value || '').trim().toLowerCase();
            return parentByCode.get(parentCode)?.id;
          },
          validate: (value, row) => {
            const raw = String(row['Hạng mục cha'] || row['Mã hạng mục cha'] || row['Mã cha'] || '').trim();
            if (!raw) return undefined;
            if (raw.toLowerCase() === String(row['Mã số *'] || row['Mã số'] || row['Mã BOQ'] || row['Mã'] || '').trim().toLowerCase()) {
              return 'Hạng mục cha không được trùng với chính hạng mục.';
            }
            if (!value) return `Không tìm thấy hạng mục cha "${raw}" trong BOQ hiện tại.`;
            return undefined;
          },
        },
        {
          key: 'unit',
          label: 'ĐVT',
          aliases: ['ĐVT *', 'ĐVT', 'Đơn vị', 'Đơn vị tính'],
          requiredOnCreate: true,
        },
        {
          key: 'quantity',
          label: 'Khối lượng',
          aliases: ['Khối lượng *', 'Khối lượng', 'KL'],
          requiredOnCreate: true,
          normalize: parseImportNumber,
          validate: value => Number.isFinite(Number(value)) && Number(value) >= 0 ? undefined : 'Khối lượng phải là số không âm.',
          format: value => Number(value || 0).toLocaleString('vi-VN'),
        },
        {
          key: 'unitPrice',
          label: 'Đơn giá',
          aliases: ['Đơn giá *', 'Đơn giá', 'Giá'],
          requiredOnCreate: true,
          normalize: parseImportNumber,
          validate: value => Number.isFinite(Number(value)) && Number(value) >= 0 ? undefined : 'Đơn giá phải là số không âm.',
          format: value => Number(value || 0).toLocaleString('vi-VN'),
        },
        { key: 'description', label: 'Mô tả', aliases: ['Mô tả'], clearable: true },
        { key: 'category', label: 'Chủng loại', aliases: ['Chủng loại'], clearable: true },
        { key: 'brand', label: 'Thương hiệu', aliases: ['Thương hiệu'], clearable: true },
        { key: 'origin', label: 'Xuất xứ', aliases: ['Xuất xứ'], clearable: true },
        { key: 'technicalSpec', label: 'Thông số kỹ thuật', aliases: ['Thông số kỹ thuật'], clearable: true },
        { key: 'length', label: 'Chiều dài', aliases: ['Chiều dài', 'Dài'], clearable: true, normalize: parseImportNumber },
        { key: 'width', label: 'Chiều rộng', aliases: ['Chiều rộng', 'Rộng'], clearable: true, normalize: parseImportNumber },
        { key: 'height', label: 'Chiều cao', aliases: ['Chiều cao', 'Cao'], clearable: true, normalize: parseImportNumber },
        { key: 'materialUnitPrice', label: 'Đơn giá vật liệu', aliases: ['Đơn giá vật liệu'], clearable: true, normalize: parseImportNumber },
        { key: 'laborUnitPrice', label: 'Đơn giá nhân công', aliases: ['Đơn giá nhân công'], clearable: true, normalize: parseImportNumber },
        { key: 'machineUnitPrice', label: 'Đơn giá MTC', aliases: ['Đơn giá MTC', 'Đơn giá máy thi công'], clearable: true, normalize: parseImportNumber },
        { key: 'workCode', label: 'Mã công tác', aliases: ['Mã công tác'], clearable: true },
        { key: 'note', label: 'Ghi chú', aliases: ['Ghi chú', 'Ghi chu'], clearable: true },
      ],
    }, sourceRows);
  };

  const openImport = (mode: ExcelImportMode) => {
    importModeRef.current = mode;
    setImportMode(mode);
    setShowImport(true);
    fileInputRef.current?.click();
  };

  // Excel Import
  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const rows = await parseExcelRows(file, importModeRef.current === 'create' ? 'Nhap_moi' : 'Cap_nhat');
      if (rows.length === 0) { toast.warning('File rỗng', 'File Excel không có dữ liệu'); return; }
      setImportPreview(buildBoqImportPreview(importModeRef.current, rows));
    } catch (error) {
      logApiError('contractItems.import', error);
      toast.error('Lỗi đọc file BOQ', getApiErrorMessage(error, 'Không thể đọc file Excel BOQ.'));
    } finally {
      setImporting(false);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      const records = applyImportChanges(importPreview);
      if (records.length === 0) {
        toast.warning('Không có thay đổi', 'File không có dòng hợp lệ cần ghi dữ liệu.');
        return;
      }
      if (importPreview.mode === 'create') {
        const createItems = records.map(record => {
          const { id, createdAt, ...rest } = record;
          const quantity = Number(rest.quantity || 0);
          const unitPrice = Number(rest.unitPrice || 0);
          return {
            ...rest,
            quantity,
            unitPrice,
            totalPrice: quantity * unitPrice,
            revisedQuantity: quantity,
            revisedUnitPrice: unitPrice,
            revisedTotalPrice: quantity * unitPrice,
          };
        });
        await contractItemService.batchCreate(createItems);
        toast.success('Import BOQ thành công', `${records.length} hạng mục đã được thêm.`);
      } else {
        const changedRows = importPreview.rows.filter(row => row.status === 'update' && row.existingRecord && row.nextRecord);
        for (const row of changedRows) {
          const patch = row.changes.reduce<Partial<ContractItem>>((acc, change) => {
            acc[change.fieldKey as keyof ContractItem] = change.newValue as never;
            return acc;
          }, {});
          await contractItemService.update(row.existingRecord!.id, patch);
        }
        toast.success('Cập nhật BOQ thành công', `${changedRows.length} hạng mục đã được cập nhật.`);
      }
      setImportPreview(null);
      setShowImport(false);
      await load();
    } catch (error) {
      logApiError('contractItems.import.apply', error);
      toast.error('Không thể ghi dữ liệu BOQ', getApiErrorMessage(error, 'Không thể ghi dữ liệu import BOQ lên Supabase.'));
    } finally {
      setImporting(false);
    }
  };

  // Render a single BOQ row
  const renderRow = (item: ContractItem, depth: number = 0) => {
    const isEditing = editingId === item.id;
    const isGrp = isGroup(item.id);
    const expanded = expandedGroups.has(item.id);
    const children = getChildren(item.id);
    const itemLocked = Boolean(item.isLocked);
    const pct = item.quantity > 0 && item.completedQuantity
      ? Math.min((item.completedQuantity / item.quantity) * 100, 100) : 0;

    return (
      <React.Fragment key={item.id}>
        <tr className={`group hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 transition-colors ${isGrp ? 'bg-slate-50/50 dark:bg-slate-700/30 font-bold' : ''}`}>
          {/* STT / Expand */}
          <td className="px-2 py-2 text-center w-10">
            {isGrp ? (
              <button onClick={() => toggleGroup(item.id)} className="text-slate-400 hover:text-indigo-500">
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="text-[10px] text-slate-300">{item.order + 1}</span>
            )}
          </td>
          {/* Mã */}
          <td className="px-2 py-2 text-xs" style={{ paddingLeft: `${depth * 20 + 8}px` }}>
            {isEditing ? (
              <input value={editData.code || ''} onChange={e => setEditData({ ...editData, code: e.target.value })}
                className="w-16 px-1.5 py-1 rounded border border-indigo-300 text-xs font-bold outline-none focus:ring-1 focus:ring-indigo-400" />
            ) : (
              <span className="font-bold text-indigo-600 dark:text-indigo-400">{item.code}</span>
            )}
          </td>
          {/* Tên hạng mục */}
          <td className="px-2 py-2 text-xs min-w-[200px]">
            {isEditing ? (
              <input value={editData.name || ''} onChange={e => setEditData({ ...editData, name: e.target.value })}
                className="w-full px-1.5 py-1 rounded border border-indigo-300 text-xs outline-none focus:ring-1 focus:ring-indigo-400" />
            ) : (
              <span className="text-slate-700 dark:text-slate-200">{item.name}</span>
            )}
          </td>
          {/* ĐVT */}
          <td className="px-2 py-2 text-xs text-center">
            {isEditing ? (
              <input value={editData.unit || ''} onChange={e => setEditData({ ...editData, unit: e.target.value })}
                className="w-12 px-1 py-1 rounded border border-indigo-300 text-xs text-center outline-none" />
            ) : (
              <span className="text-slate-500">{item.unit}</span>
            )}
          </td>
          {/* Khối lượng */}
          <td className="px-2 py-2 text-xs text-right">
            {isEditing ? (
              <input type="number" value={editData.quantity || 0}
                onChange={e => setEditData({ ...editData, quantity: Number(e.target.value) })}
                className="w-20 px-1 py-1 rounded border border-indigo-300 text-xs text-right outline-none" />
            ) : (
              <span className="text-slate-700 dark:text-slate-200 font-medium">
                {isGrp ? '' : (item.revisedQuantity !== undefined && item.revisedQuantity !== item.quantity ? `${fmt(item.quantity)} → ${fmt(item.revisedQuantity)}` : fmt(item.quantity))}
              </span>
            )}
          </td>
          {/* Đơn giá */}
          <td className="px-2 py-2 text-xs text-right">
            {isEditing ? (
              <input type="number" value={editData.unitPrice || 0}
                onChange={e => setEditData({ ...editData, unitPrice: Number(e.target.value) })}
                className="w-24 px-1 py-1 rounded border border-indigo-300 text-xs text-right outline-none" />
            ) : (
              <span className="text-slate-700 dark:text-slate-200">
                {isGrp ? '' : (item.revisedUnitPrice !== undefined && item.revisedUnitPrice !== item.unitPrice ? `${fmt(item.unitPrice)} → ${fmt(item.revisedUnitPrice)}` : fmt(item.unitPrice))}
              </span>
            )}
          </td>
          {/* Thành tiền */}
          <td className="px-2 py-2 text-xs text-right font-bold">
            <span className={isGrp ? 'text-slate-800 dark:text-white' : 'text-emerald-600'}>
              {isGrp
                ? fmtMoney(children.reduce((s, c) => s + (c.revisedTotalPrice ?? c.totalPrice ?? 0), 0))
                : fmtMoney(item.revisedTotalPrice ?? (item.totalPrice || 0))
              }
            </span>
          </td>
          {/* % Hoàn thành */}
          <td className="px-2 py-2 text-xs text-center w-[90px]">
            {!isGrp && (
              <div className="flex items-center gap-1">
                <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-600 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct > 50 ? 'bg-blue-500' : 'bg-amber-400'}`}
                    style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <span className="text-[9px] font-bold text-slate-400 w-8">{pct.toFixed(0)}%</span>
              </div>
            )}
          </td>
          {/* Actions */}
          <td className="px-2 py-2 text-center w-16">
            {!readOnly && (
              isEditing ? (
                <div className="flex gap-0.5 justify-center">
                  <button disabled={saving} onClick={handleSaveEdit} className="w-6 h-6 rounded flex items-center justify-center text-emerald-500 hover:bg-emerald-50 disabled:opacity-50">
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  </button>
                  <button onClick={() => setEditingId(null)} className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:bg-slate-100">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div className="flex gap-0.5 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  {!itemLocked && <button disabled={saving} onClick={() => { setDetailItem(item); setShowDetailModal(true); }} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-blue-500 hover:bg-blue-50 disabled:opacity-50">
                    <Edit2 size={11} />
                  </button>}
                  {!itemLocked && <button disabled={saving} onClick={() => handleDelete(item)} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-50">
                    <Trash2 size={11} />
                  </button>}
                </div>
              )
            )}
          </td>
        </tr>
        {/* Children */}
        {isGrp && expanded && children.map(child => renderRow(child, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="space-y-3 mt-3">
      {readOnly && readOnlyReason && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-black">BOQ gốc đang ở chế độ chỉ xem</div>
            <div className="mt-0.5 font-medium">{readOnlyReason}</div>
          </div>
        </div>
      )}
      {/* Header KPI */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <div className="text-[10px]">
            <span className="text-slate-400 font-bold uppercase">GT Hợp đồng</span>
            <span className="ml-2 text-sm font-black text-slate-800 dark:text-white">{fmtMoney(totalValue)}</span>
          </div>
          <div className="text-[10px]">
            <span className="text-slate-400 font-bold uppercase">Hoàn thành</span>
            <span className="ml-2 text-sm font-black text-emerald-600">{fmtMoney(completedValue)}</span>
            <span className="ml-1 text-[9px] font-bold text-slate-400">({completedPercent.toFixed(1)}%)</span>
          </div>
          <div className="text-[10px]">
            <span className="text-slate-400 font-bold uppercase">Hạng mục</span>
            <span className="ml-2 text-sm font-black text-indigo-600">{items.length}</span>
          </div>
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <button disabled={saving || importing} onClick={handleDownloadTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-all disabled:opacity-50">
              <Download size={12} /> Tải mẫu
            </button>
            <button disabled={saving || importing} onClick={() => openImport('create')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-all disabled:opacity-50">
              {importing && importMode === 'create' ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />} Nhập mới
            </button>
            <button disabled={saving || importing} onClick={() => openImport('update')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-all disabled:opacity-50">
              {importing && importMode === 'update' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />} Cập nhật
            </button>
            <button disabled={saving || importing} onClick={() => { setDetailItem(null); setShowDetailModal(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-violet-600 bg-violet-50 border border-violet-200 hover:bg-violet-100 transition-all disabled:opacity-50">
              <Plus size={12} /> Thêm chi tiết
            </button>
            <button disabled={saving || importing} onClick={() => { setShowAddRow(true); setNewItem({ ...EMPTY_ITEM, order: items.length }); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 transition-all disabled:opacity-50">
              <Plus size={12} /> Thêm nhanh
            </button>
          </div>
        )}
      </div>

      {/* BOQ Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-600">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-slate-700 dark:to-slate-700">
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase text-center w-10">#</th>
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase">Mã</th>
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase">Tên hạng mục</th>
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase text-center">ĐVT</th>
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase text-right">KL</th>
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase text-right">Đơn giá</th>
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase text-right">Thành tiền</th>
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase text-center">Hoàn thành</th>
              <th className="px-2 py-2.5 w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
            {loading ? (
              <tr><td colSpan={9} className="text-center py-8 text-sm text-slate-400">Đang tải...</td></tr>
            ) : items.length === 0 && !showAddRow ? (
              <tr>
                <td colSpan={9} className="text-center py-10">
                  <Package size={32} className="mx-auto mb-2 text-slate-200" />
                  <p className="text-xs font-bold text-slate-400">Chưa có hạng mục BOQ</p>
                  <p className="text-[10px] text-slate-300 mt-1">Thêm thủ công hoặc Import từ Excel</p>
                </td>
              </tr>
            ) : (
              <>
                {rootItems.map(item => renderRow(item, 0))}
                {/* Add new row */}
                {showAddRow && (
                  <tr className="bg-indigo-50/50 dark:bg-indigo-900/20">
                    <td className="px-2 py-2 text-center"><Plus size={12} className="text-indigo-400 mx-auto" /></td>
                    <td className="px-2 py-2">
                      <input value={newItem.code || ''} onChange={e => setNewItem({ ...newItem, code: e.target.value })}
                        placeholder="HM-01" autoFocus
                        className="w-16 px-1.5 py-1 rounded border border-indigo-300 text-xs font-bold outline-none focus:ring-1 focus:ring-indigo-400 bg-white dark:bg-slate-700" />
                    </td>
                    <td className="px-2 py-2">
                      <input value={newItem.name || ''} onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                        placeholder="Tên hạng mục"
                        className="w-full px-1.5 py-1 rounded border border-indigo-300 text-xs outline-none focus:ring-1 focus:ring-indigo-400 bg-white dark:bg-slate-700" />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input value={newItem.unit || 'm2'} onChange={e => setNewItem({ ...newItem, unit: e.target.value })}
                        className="w-12 px-1 py-1 rounded border border-indigo-300 text-xs text-center outline-none bg-white dark:bg-slate-700" />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input type="number" value={newItem.quantity || 0}
                        onChange={e => setNewItem({ ...newItem, quantity: Number(e.target.value) })}
                        className="w-20 px-1 py-1 rounded border border-indigo-300 text-xs text-right outline-none bg-white dark:bg-slate-700" />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input type="number" value={newItem.unitPrice || 0}
                        onChange={e => setNewItem({ ...newItem, unitPrice: Number(e.target.value) })}
                        className="w-24 px-1 py-1 rounded border border-indigo-300 text-xs text-right outline-none bg-white dark:bg-slate-700" />
                    </td>
                    <td className="px-2 py-2 text-right text-xs font-bold text-emerald-600">
                      {fmtMoney((newItem.quantity || 0) * (newItem.unitPrice || 0))}
                    </td>
                    <td className="px-2 py-2"></td>
                    <td className="px-2 py-2 text-center">
                      <div className="flex gap-0.5 justify-center">
                        <button disabled={saving} onClick={handleAdd} className="w-6 h-6 rounded flex items-center justify-center text-emerald-500 hover:bg-emerald-50 disabled:opacity-50">
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                        </button>
                        <button onClick={() => setShowAddRow(false)} className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:bg-slate-100">
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
          {/* Footer total */}
          {items.length > 0 && (
            <tfoot>
              <tr className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-slate-700 dark:to-slate-700 border-t-2 border-indigo-200 dark:border-indigo-800">
                <td colSpan={6} className="px-3 py-2.5 text-xs font-black text-slate-700 dark:text-white text-right uppercase">
                  Tổng cộng
                </td>
                <td className="px-2 py-2.5 text-sm font-black text-indigo-700 dark:text-indigo-300 text-right">
                  {fmtMoney(totalValue)}
                </td>
                <td className="px-2 py-2.5 text-[10px] font-bold text-emerald-600 text-center">
                  {completedPercent.toFixed(1)}%
                </td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Hidden file input for Excel import */}
      <input ref={fileInputRef} type="file" className="hidden" accept=".xlsx,.xls,.csv"
        onChange={handleImportExcel} />

      {/* Import hint */}
      {showImport && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
          <FileSpreadsheet size={14} className="text-emerald-500 shrink-0" />
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
            Chế độ <strong>{importMode === 'create' ? 'Nhập mới' : 'Cập nhật'}</strong> sẽ mở preview trước khi ghi dữ liệu. Với cập nhật, chỉ cần cột <strong>Mã số</strong> và các cột muốn sửa; ô trống được hiểu là không thay đổi.
          </p>
        </div>
      )}
      {importPreview && (
        <ExcelImportReviewModal
          title={importPreview.mode === 'create' ? 'Preview nhập mới BOQ' : 'Preview cập nhật BOQ'}
          preview={importPreview}
          loading={importing}
          onClose={() => setImportPreview(null)}
          onConfirm={handleConfirmImport}
        />
      )}
      <ContractItemDetailModal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        onSaved={load}
        contractId={contractId}
        contractType={contractType}
        projectId={projectId}
        constructionSiteId={constructionSiteId}
        parentOptions={items}
        item={detailItem}
      />
    </div>
  );
};

export default ContractItemTable;
