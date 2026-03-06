
import React, { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { Search, Filter, Plus, QrCode, Upload, FileSpreadsheet, Trash2, MoreHorizontal, ShieldAlert, AlertTriangle } from 'lucide-react';
import ScannerModal from '../components/ScannerModal';
import AddInventoryModal from '../components/AddInventoryModal';
import InventoryDetailModal from '../components/InventoryDetailModal';
import DeleteInventoryModal from '../components/DeleteInventoryModal';
import * as XLSX from 'xlsx';
import { InventoryItem, Role, Transaction, TransactionType, TransactionStatus } from '../types';

const Inventory: React.FC = () => {
  const location = useLocation();
  const { items, warehouses, addItems, addItem, removeItem, addTransaction, user, transactions, categories, units } = useApp();
  const toast = useToast();
  const [searchTerm, setSearchTerm] = useState('');

  const isKeeper = user.role === Role.KEEPER;
  const isAdmin = user.role === Role.ADMIN;

  // Khởi tạo filter kho
  const [filterWarehouse, setFilterWarehouse] = useState('all');
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);

  useEffect(() => {
    if (isKeeper && user.assignedWarehouseId) {
      setFilterWarehouse(user.assignedWarehouseId);
    }

    // Handle filter from dashboard
    if (location.state?.filter === 'low') {
      setShowLowStockOnly(true);
    }
  }, [isKeeper, user, location.state]);

  const [isScannerOpen, setScannerOpen] = useState(false);
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);

  // Logic lọc vật tư theo yêu cầu bảo mật mới
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchTerm.toLowerCase());

      let matchesFilter = true;

      // Nếu là thủ kho:
      // Thấy tất cả vật tư thuộc kho mình (có entry trong stockByWarehouse, kể cả tồn = 0)
      // Điều này đảm bảo thủ kho thấy được hết danh mục vật tư kho mình quản lý
      if (isKeeper && user.assignedWarehouseId) {
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
  }, [items, searchTerm, isKeeper, user, filterWarehouse, showLowStockOnly]);

  const getDisplayStock = (item: InventoryItem): number => {
    if (filterWarehouse === 'all') {
      return Object.values(item.stockByWarehouse).reduce((a, b) => (a as number) + (b as number), 0);
    }
    return item.stockByWarehouse[filterWarehouse] || 0;
  };

  const handleScanResult = (sku: string) => {
    setSearchTerm(sku);
  };

  const handleAddItem = (item: InventoryItem) => {
    addItem(item);
  };

  const handleDeleteConfirm = () => {
    if (itemToDelete) {
      removeItem(itemToDelete.id);
      setItemToDelete(null);
    }
  };

  const handleDownloadTemplate = () => {
    const headers = [['Mã SKU', 'Tên vật tư', 'Danh mục', 'Đơn vị tính', 'Giá nhập', 'Giá xuất', 'Tồn tối thiểu', 'Kho nhận hàng', 'Số lượng nhập']];
    const ws = XLSX.utils.aoa_to_sheet(headers);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "KhoViet_Template.xlsx");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
      const rows = data.slice(1) as any[];

      const newItemsToCreate: InventoryItem[] = [];
      const stockRequestsByWh: Record<string, { itemId: string, quantity: number, price: number }[]> = {};
      const errors: string[] = [];

      rows.forEach((row, index) => {
        const rowNum = index + 2; // +1 for 0-index, +1 for header row
        const sku = (row[0] || '').toString().trim();
        const name = (row[1] || '').toString().trim();
        const categoryName = (row[2] || '').toString().trim();
        const unitName = (row[3] || '').toString().trim();
        const whName = (row[7] || '').toString().trim();
        const initialQty = Number(row[8]) || 0;

        if (!sku) return;

        // 1. Kiểm tra tồn tại của Danh mục
        const categoryExists = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
        if (!categoryExists) {
          errors.push(`Dòng ${rowNum}: Danh mục "${categoryName}" không tồn tại trong hệ thống.`);
          return;
        }

        // 2. Kiểm tra tồn tại của Đơn vị tính
        const unitExists = units.find(u => u.name.toLowerCase() === unitName.toLowerCase());
        if (!unitExists) {
          errors.push(`Dòng ${rowNum}: Đơn vị tính "${unitName}" không tồn tại trong hệ thống.`);
          return;
        }

        // 3. Kiểm tra tồn tại của Kho
        let warehouseId = '';
        if (whName) {
          const warehouse = warehouses.find(w => w.name.toLowerCase() === whName.toLowerCase());
          if (!warehouse) {
            errors.push(`Dòng ${rowNum}: Kho "${whName}" không tồn tại trong hệ thống.`);
            return;
          }
          warehouseId = warehouse.id;
        } else if (initialQty > 0) {
          errors.push(`Dòng ${rowNum}: Có số lượng nhập (${initialQty}) nhưng chưa chỉ định tên kho.`);
          return;
        }

        // Nếu qua được các bước trên thì mới xử lý tiếp
        // Kiểm tra trong danh mục chính
        const existingItem = items.find(i => i.sku === sku);

        // Kiểm tra trong các phiếu đang chờ duyệt (để tránh tạo trùng SKU nếu import nhiều lần)
        const pendingItemInTxs = transactions
          .filter(t => t.status === TransactionStatus.PENDING && t.pendingItems)
          .flatMap(t => t.pendingItems || [])
          .find(pi => pi.sku === sku);

        let itemId: string;

        if (existingItem) {
          itemId = existingItem.id;
        } else if (pendingItemInTxs) {
          itemId = pendingItemInTxs.id;
        } else {
          // Kiểm tra xem đã có trong danh sách chuẩn bị tạo của chính file này chưa
          const alreadyInNew = newItemsToCreate.find(ni => ni.sku === sku);
          if (alreadyInNew) {
            itemId = alreadyInNew.id;
          } else {
            itemId = `it-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            const newItem: InventoryItem = {
              id: itemId,
              sku: sku,
              name: row[1] || '',
              category: row[2] || '',
              unit: row[3] || '',
              priceIn: Number(row[4]) || 0,
              priceOut: Number(row[5]) || 0,
              minStock: Number(row[6]) || 0,
              stockByWarehouse: {}
            };
            newItemsToCreate.push(newItem);
          }
        }

        if (warehouseId && initialQty > 0) {
          if (!stockRequestsByWh[warehouseId]) stockRequestsByWh[warehouseId] = [];
          stockRequestsByWh[warehouseId].push({ itemId, quantity: initialQty, price: Number(row[4]) || 0 });
        }
      });

      if (errors.length > 0) {
        toast.error(
          `Có ${errors.length} lỗi dữ liệu`,
          errors.slice(0, 3).join(' | ') + (errors.length > 3 ? ` (+${errors.length - 3} lỗi khác)` : '')
        );
        if (newItemsToCreate.length === 0 && Object.keys(stockRequestsByWh).length === 0) return;
      }

      // Không gọi addItems ngay lập tức nữa

      // Tạo các phiếu nhập kho cho từng kho
      Object.entries(stockRequestsByWh).forEach(([whId, itemsInWh]) => {
        // Lọc ra những metadata của các item mới có trong phiếu này
        const pendingItemsForThisTx = newItemsToCreate.filter(ni =>
          itemsInWh.some(ti => ti.itemId === ni.id)
        );

        // Mọi tài khoản (kể cả Admin) khi nhập Excel đều phải qua bước duyệt phiếu
        const status = TransactionStatus.PENDING;

        const tx: Transaction = {
          id: `tx-bulk-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          type: TransactionType.IMPORT,
          date: new Date().toISOString(),
          items: itemsInWh,
          targetWarehouseId: whId,
          requesterId: user.id,
          status: status,
          note: `Nhập kho hàng loạt từ file Excel (${itemsInWh.length} mặt hàng)`,
          pendingItems: pendingItemsForThisTx
        };
        addTransaction(tx);
      });

      toast.success('Import thành công', `Đã gửi ${Object.keys(stockRequestsByWh).length} yêu cầu nhập kho chờ Admin phê duyệt.`);
    };
    reader.readAsBinaryString(file);
  };

  return (
    <div className="space-y-6">
      <ScannerModal isOpen={isScannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScanResult} />
      <AddInventoryModal isOpen={isAddModalOpen} onClose={() => setAddModalOpen(false)} onAdd={handleAddItem} />
      <InventoryDetailModal isOpen={!!selectedItem} onClose={() => setSelectedItem(null)} item={selectedItem} />
      <DeleteInventoryModal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} targetItem={itemToDelete} onConfirm={handleDeleteConfirm} />

      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-5">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Kho & Vật tư</h1>
          {isKeeper && (
            <div className="flex items-center gap-2 mt-1 text-accent font-black uppercase text-[10px] tracking-widest bg-blue-50 px-2 py-1 rounded-lg border border-blue-100">
              <ShieldAlert size={12} />
              Kho quản lý: {warehouses.find(w => w.id === user.assignedWarehouseId)?.name}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 w-full xl:w-auto">
          {isAdmin && (
            <div className="flex gap-2 w-full sm:w-auto">
              <button onClick={handleDownloadTemplate} className="flex-1 sm:flex-none flex items-center justify-center px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition text-[10px] font-black uppercase tracking-widest">
                <FileSpreadsheet className="w-4 h-4 mr-2 text-green-600" /> Mẫu
              </button>
              <label className="flex-1 sm:flex-none cursor-pointer flex items-center justify-center px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition text-[10px] font-black uppercase tracking-widest">
                <Upload className="w-4 h-4 mr-2 text-slate-500" /> Import
                <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
          )}
          <div className="flex gap-2 w-full sm:w-auto">
            <button onClick={() => setScannerOpen(true)} className="flex-1 sm:flex-none flex items-center justify-center px-6 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition text-[10px] font-black uppercase tracking-widest">
              <QrCode className="w-4 h-4 mr-2" /> Quét QR
            </button>

            {(isAdmin || user.role === Role.KEEPER) && (
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
              disabled={isKeeper} // Khóa nếu là thủ kho
              className="w-full pl-9 pr-8 py-3 text-sm border border-slate-200 rounded-xl appearance-none bg-slate-50/50 outline-none focus:ring-2 focus:ring-accent disabled:opacity-70 font-black uppercase tracking-tighter"
              value={filterWarehouse} onChange={(e) => setFilterWarehouse(e.target.value)}
            >
              {!isKeeper && <option value="all">Tất cả kho hệ thống</option>}
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
              {filteredItems.map(item => {
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
                        {isAdmin && (
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
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-slate-100">
          {filteredItems.map(item => {
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
