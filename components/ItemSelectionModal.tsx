
import React, { useState } from 'react';
import { X, Search, QrCode, Plus, Filter, PackageOpen } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { InventoryItem } from '../types';

interface ItemSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: InventoryItem) => void;
  onOpenScanner: () => void;
  filterWarehouseId?: string; // ID kho để lọc vật tư (cho xuất/chuyển/hủy)
  allowAllItems?: boolean;    // true = hiển thị tất cả vật tư (cho nhập kho)
}

const ItemSelectionModal: React.FC<ItemSelectionModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  onOpenScanner,
  filterWarehouseId,
  allowAllItems = false
}) => {
  const { items, warehouses } = useApp();
  const [searchTerm, setSearchTerm] = useState('');

  if (!isOpen) return null;

  const targetWarehouse = warehouses.find(w => w.id === filterWarehouseId);

  // Logic lọc vật tư
  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchTerm.toLowerCase());

    // allowAllItems = true (nhập kho): hiển thị tất cả vật tư trong hệ thống
    if (allowAllItems) return matchesSearch;

    // Nếu có filterWarehouseId, lọc item có tồn kho > 0 tại kho đó
    if (filterWarehouseId) {
      const stockInWarehouse = item.stockByWarehouse[filterWarehouseId] || 0;
      return matchesSearch && stockInWarehouse > 0;
    }

    return matchesSearch;
  });

  // Helper hiển thị tồn kho
  const getDisplayStock = (item: InventoryItem) => {
    if (filterWarehouseId) {
      return item.stockByWarehouse[filterWarehouseId] || 0;
    }
    return Object.values(item.stockByWarehouse).reduce((a, b) => a + b, 0);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
          <div>
            <h3 className="font-bold text-lg text-slate-800">Chọn vật tư</h3>
            {allowAllItems ? (
              <p className="text-xs text-emerald-600 font-bold flex items-center mt-1 uppercase tracking-tighter">
                <Search size={12} className="mr-1" />
                Tìm theo mã SKU hoặc tên — tất cả vật tư hệ thống
              </p>
            ) : targetWarehouse ? (
              <p className="text-xs text-blue-600 font-bold flex items-center mt-1 uppercase tracking-tighter">
                <Filter size={12} className="mr-1" />
                Vật tư có tồn tại: {targetWarehouse.name}
              </p>
            ) : null}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 flex gap-3 bg-white">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="text"
              placeholder={allowAllItems ? "Tìm tên hoặc mã SKU..." : "Tìm trong kho..."}
              autoFocus
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-accent outline-none font-medium"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            onClick={() => { onClose(); onOpenScanner(); }}
            className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 font-bold flex items-center whitespace-nowrap text-sm"
          >
            <QrCode size={18} className="mr-2" /> Quét QR
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-0 scrollbar-hide">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 font-black tracking-widest sticky top-0 z-10 border-b border-slate-100">
              <tr>
                <th className="p-4">Mã SKU</th>
                <th className="p-4">Tên vật tư</th>
                <th className="p-4 text-right">{allowAllItems ? 'Tổng tồn' : 'Số lượng tồn'}</th>
                <th className="p-4 text-center">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.map(item => {
                const stock = getDisplayStock(item);
                return (
                  <tr key={item.id} className="hover:bg-blue-50/30 transition-colors group">
                    <td className="p-4 font-mono text-slate-500 text-xs font-bold">{item.sku}</td>
                    <td className="p-4">
                      <div className="font-bold text-slate-800 text-sm">{item.name}</div>
                      <div className="text-[10px] text-slate-400 uppercase font-bold">{item.category}</div>
                    </td>
                    <td className="p-4 text-right">
                      <span className={`font-black ${stock === 0 ? 'text-slate-300' : 'text-slate-700'}`}>{stock.toLocaleString()}</span>
                      <span className="text-[10px] text-slate-400 font-bold ml-1 uppercase">{item.unit}</span>
                    </td>
                    <td className="p-4 text-center">
                      <button
                        onClick={() => { onSelect(item); }}
                        className="px-4 py-1.5 bg-accent text-white rounded-lg hover:bg-blue-700 transition-all text-xs font-bold flex items-center justify-center mx-auto shadow-sm shadow-blue-500/20"
                      >
                        <Plus size={14} className="mr-1" /> Chọn
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-20 text-center">
                    <div className="flex flex-col items-center opacity-20">
                      <PackageOpen size={64} />
                      <p className="mt-4 font-black uppercase tracking-widest text-sm">
                        {filterWarehouseId && !allowAllItems
                          ? "Không có vật tư khả dụng tại kho này"
                          : "Không tìm thấy vật tư phù hợp"}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ItemSelectionModal;
