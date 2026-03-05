
import React, { useMemo, useState, useEffect } from 'react';
import {
  X, Package, MapPin, Tag, DollarSign, Ruler, ShieldAlert,
  PlusCircle, Send, Edit3, Save, RotateCcw, Trash2, Truck,
  History, ArrowRight, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Flame, Printer
} from 'lucide-react';
import { InventoryItem, Role, Transaction, TransactionType, TransactionStatus } from '../types';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import DeleteInventoryModal from './DeleteInventoryModal';
import { QRCodeCanvas } from 'qrcode.react';

interface InventoryDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem | null;
}

const InventoryDetailModal: React.FC<InventoryDetailModalProps> = ({ isOpen, onClose, item }) => {
  const {
    warehouses, user, addTransaction, logActivity, updateItem,
    removeItem, categories, units, suppliers, transactions, users
  } = useApp();
  const toast = useToast();

  // State cho Đề xuất nhập kho trực tiếp
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [reqQty, setReqQty] = useState<number>(0);
  const [reqWarehouseId, setReqWarehouseId] = useState('');
  const [reqNote, setReqNote] = useState('');

  // State cho Chế độ sửa Admin
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<InventoryItem>>({});

  // State cho Modal xoá
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (item && isOpen) {
      setShowRequestForm(false);
      setIsEditing(false);
      setReqQty(0);
      setReqWarehouseId(user.assignedWarehouseId || warehouses[0]?.id || '');
      setEditData({ ...item });
      setShowDeleteConfirm(false);
    }
  }, [item, isOpen, warehouses, user]);

  const handleSendRequest = () => {
    if (!item || reqQty <= 0 || !reqWarehouseId) {
      toast.error('Thiếu thông tin', 'Vui lòng nhập số lượng hợp lệ và chọn kho.');
      return;
    }

    const newTx: Transaction = {
      id: `tx-direct-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type: TransactionType.IMPORT,
      date: new Date().toISOString(),
      items: [{ itemId: item.id, quantity: reqQty, price: item.priceIn }],
      targetWarehouseId: reqWarehouseId,
      supplierId: item.supplierId,
      requesterId: user.id,
      status: TransactionStatus.PENDING,
      note: `Đề xuất nhập kho trực tiếp: ${reqNote || 'Không có ghi chú'}`
    };

    addTransaction(newTx);
    logActivity('REQUEST', 'Đề xuất nhập kho', `Gửi đề xuất nhập ${reqQty} ${item.unit} "${item.name}" chờ Admin duyệt.`, 'INFO');
    toast.success('Đã gửi đề xuất', `${reqQty} ${item.unit} "${item.name}" đang chờ Admin phê duyệt.`);
    setShowRequestForm(false);
  };

  const handleAdminSave = () => {
    if (!item) return;
    updateItem(editData as InventoryItem);
    logActivity('SYSTEM', 'Sửa dữ liệu gốc', `Admin đã thay đổi thông tin vật tư "${item.name}" (${item.sku})`, 'WARNING');
    setIsEditing(false);
    toast.success('Cập nhật thành công', `Thông tin vật tư "${item.name}" đã được cập nhật.`);
  };

  const handleAdminDelete = () => {
    if (item) {
      removeItem(item.id);
      setShowDeleteConfirm(false);
      onClose();
    }
  };

  const displayWarehouses = useMemo(() => {
    if (!item) return [];
    if (user.role === Role.ADMIN || !user.assignedWarehouseId) return warehouses;
    return warehouses.filter(wh => wh.id === user.assignedWarehouseId);
  }, [warehouses, user, item]);

  // Logic lọc lịch sử giao dịch cho vật tư này
  const itemHistory = useMemo(() => {
    if (!item) return [];
    return transactions
      .filter(tx =>
        tx.status === TransactionStatus.COMPLETED &&
        tx.items.some(ti => ti.itemId === item.id)
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, item]);

  const supplierName = useMemo(() => {
    if (!item?.supplierId) return 'Không xác định';
    return suppliers.find(s => s.id === item.supplierId)?.name || 'N/A';
  }, [item, suppliers]);

  if (!isOpen || !item) return null;

  const isAdmin = user.role === Role.ADMIN;
  const isAccountant = user.role === Role.ACCOUNTANT;

  const getTxTypeBadge = (type: TransactionType) => {
    switch (type) {
      case TransactionType.IMPORT:
        return { label: 'Nhập kho', icon: <ArrowDownLeft size={12} />, color: 'bg-emerald-50 text-emerald-600 border-emerald-100' };
      case TransactionType.EXPORT:
        return { label: 'Xuất kho', icon: <ArrowUpRight size={12} />, color: 'bg-orange-50 text-orange-600 border-orange-100' };
      case TransactionType.TRANSFER:
        return { label: 'Chuyển kho', icon: <ArrowLeftRight size={12} />, color: 'bg-blue-50 text-blue-600 border-blue-100' };
      case TransactionType.LIQUIDATION:
        return { label: 'Xuất hủy', icon: <Flame size={12} />, color: 'bg-red-50 text-red-600 border-red-100' };
      default:
        return { label: 'Khác', icon: <History size={12} />, color: 'bg-slate-50 text-slate-600 border-slate-100' };
    }
  };

  return (
    <>
      <DeleteInventoryModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        targetItem={item}
        onConfirm={handleAdminDelete}
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
        <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] relative text-slate-800">

          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50 sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 text-accent">
                <Package size={24} />
              </div>
              <div>
                {isEditing ? (
                  <input
                    className="font-bold text-lg text-slate-800 border-b-2 border-accent outline-none bg-transparent"
                    value={editData.name}
                    onChange={e => setEditData({ ...editData, name: e.target.value })}
                  />
                ) : (
                  <h3 className="font-bold text-lg text-slate-800">{item.name}</h3>
                )}
                {isEditing ? (
                  <input
                    className="text-sm text-slate-500 font-mono border-b border-slate-300 outline-none bg-transparent mt-1"
                    value={editData.sku}
                    onChange={e => setEditData({ ...editData, sku: e.target.value })}
                  />
                ) : (
                  <p className="text-sm text-slate-500 font-mono">{item.sku}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              {!isEditing && (
                <div className="hidden sm:flex items-center gap-2">
                  <div className="p-1 bg-white border border-slate-200 rounded-lg shadow-sm">
                    <QRCodeCanvas value={item.sku} size={48} level="H" includeMargin={false} />
                  </div>
                  <button
                    onClick={() => {
                      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
                      const win = window.open('', '_blank');
                      if (win) {
                        win.document.write(`<html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;font-family:monospace">
                        <p style="margin-bottom:8px;font-weight:bold;font-size:14px">${item.name}</p>
                        <img src="${(document.querySelector('canvas') as HTMLCanvasElement)?.toDataURL()}" style="width:150px;height:150px" />
                        <p style="margin-top:8px;font-size:12px">${item.sku}</p>
                      </body></html>`);
                        win.print();
                      }
                    }}
                    className="p-1.5 text-slate-400 hover:text-accent hover:bg-blue-50 rounded-lg transition-all" title="In QR Code"
                  >
                    <Printer size={16} />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                {isAdmin && !isEditing && (
                  <>
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                      title="Xoá vĩnh viễn"
                    >
                      <Trash2 size={20} />
                    </button>
                    <button
                      onClick={() => setIsEditing(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 text-orange-600 rounded-lg text-xs font-bold border border-orange-100 hover:bg-orange-600 hover:text-white transition-all"
                    >
                      <Edit3 size={14} /> SỬA GỐC
                    </button>
                  </>
                )}
                <button onClick={onClose} className="text-slate-400 hover:text-slate-600 ml-2"><X size={24} /></button>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto space-y-8 scrollbar-hide">
            {/* Admin Editing Controls */}
            {isEditing && (
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3 text-orange-700">
                  <ShieldAlert size={20} />
                  <span className="text-sm font-bold">Chế độ chỉnh sửa dữ liệu gốc</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold flex items-center gap-1"
                  >
                    <RotateCcw size={14} /> HỦY
                  </button>
                  <button
                    onClick={handleAdminSave}
                    className="px-3 py-1.5 bg-orange-600 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-md shadow-orange-500/20"
                  >
                    <Save size={14} /> LƯU THAY ĐỔI
                  </button>
                </div>
              </div>
            )}

            {/* Quick Request Entry Section */}
            {!isEditing && !isAccountant && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                {!showRequestForm ? (
                  <button
                    onClick={() => setShowRequestForm(true)}
                    className="w-full py-2 bg-blue-600 text-white rounded-lg font-bold flex items-center justify-center hover:bg-blue-700 transition shadow-md shadow-blue-500/20"
                  >
                    <PlusCircle size={18} className="mr-2" /> Nhập thêm vật tư này vào kho
                  </button>
                ) : (
                  <div className="space-y-4 animate-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-blue-800 text-sm">Tạo nhanh đề xuất nhập kho</h4>
                      <button onClick={() => setShowRequestForm(false)} className="text-blue-400 hover:text-blue-600"><X size={16} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-blue-400 uppercase">Số lượng cần nhập</label>
                        <input
                          type="number" value={reqQty}
                          onChange={e => setReqQty(Number(e.target.value))}
                          className="w-full p-2 border border-blue-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 font-bold text-blue-700"
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-blue-400 uppercase">Kho nhận hàng</label>
                        <select
                          value={reqWarehouseId} onChange={e => setReqWarehouseId(e.target.value)}
                          className="w-full p-2 border border-blue-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        >
                          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-blue-400 uppercase">Lý do / Ghi chú</label>
                      <input
                        type="text" value={reqNote} onChange={e => setReqNote(e.target.value)}
                        className="w-full p-2 border border-blue-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="VD: Cần gấp cho hạng mục đổ sàn..."
                      />
                    </div>
                    <button
                      onClick={handleSendRequest}
                      className="w-full py-2 bg-accent text-white rounded-lg font-bold flex items-center justify-center hover:bg-blue-700"
                    >
                      <Send size={16} className="mr-2" /> Gửi đề xuất phê duyệt
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Info Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-slate-400 mb-1 text-[10px] uppercase font-bold tracking-tight">Danh mục</div>
                {isEditing ? (
                  <select
                    className="w-full bg-white border border-slate-200 text-sm font-medium p-1 rounded outline-none"
                    value={editData.category}
                    onChange={e => setEditData({ ...editData, category: e.target.value })}
                  >
                    {categories.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
                  </select>
                ) : (
                  <div className="font-medium text-slate-800 text-sm">{item.category}</div>
                )}
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-slate-400 mb-1 text-[10px] uppercase font-bold tracking-tight">Đơn vị</div>
                {isEditing ? (
                  <select
                    className="w-full bg-white border border-slate-200 text-sm font-medium p-1 rounded outline-none"
                    value={editData.unit}
                    onChange={e => setEditData({ ...editData, unit: e.target.value })}
                  >
                    {units.map(unit => <option key={unit.id} value={unit.name}>{unit.name}</option>)}
                  </select>
                ) : (
                  <div className="font-medium text-slate-800 text-sm">{item.unit}</div>
                )}
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-slate-400 mb-1 text-[10px] uppercase font-bold tracking-tight">Giá nhập</div>
                {isEditing ? (
                  <input
                    type="number"
                    className="w-full bg-white border border-slate-200 text-sm font-bold p-1 rounded outline-none"
                    value={editData.priceIn}
                    onChange={e => setEditData({ ...editData, priceIn: Number(e.target.value) })}
                  />
                ) : (
                  <div className="font-bold text-slate-800 text-sm">{item.priceIn.toLocaleString()} ₫</div>
                )}
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-slate-400 mb-1 text-[10px] uppercase font-bold tracking-tight">Tồn tối thiểu</div>
                {isEditing ? (
                  <input
                    type="number"
                    className="w-full bg-white border border-slate-200 text-sm font-bold p-1 rounded outline-none text-red-600"
                    value={editData.minStock}
                    onChange={e => setEditData({ ...editData, minStock: Number(e.target.value) })}
                  />
                ) : (
                  <div className="font-bold text-red-600 text-sm">{item.minStock.toLocaleString()}</div>
                )}
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-slate-400 mb-1 text-[10px] uppercase font-bold tracking-tight">Vị trí</div>
                {isEditing ? (
                  <input
                    type="text"
                    className="w-full bg-white border border-slate-200 text-sm font-medium p-1 rounded outline-none"
                    value={editData.location || ''}
                    onChange={e => setEditData({ ...editData, location: e.target.value })}
                    placeholder="VD: Kệ A-1"
                  />
                ) : (
                  <div className="font-medium text-slate-800 text-sm truncate" title={item.location || 'Chưa xác định'}>
                    {item.location || 'Chưa có'}
                  </div>
                )}
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 col-span-2 lg:col-span-1">
                <div className="text-slate-400 mb-1 text-[10px] uppercase font-bold tracking-tight">Nhà cung cấp</div>
                {isEditing ? (
                  <select
                    className="w-full bg-white border border-slate-200 text-sm font-medium p-1 rounded outline-none"
                    value={editData.supplierId || ''}
                    onChange={e => setEditData({ ...editData, supplierId: e.target.value })}
                  >
                    <option value="">Không xác định</option>
                    {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                  </select>
                ) : (
                  <div className="font-medium text-blue-600 text-sm truncate" title={supplierName}>
                    {supplierName}
                  </div>
                )}
              </div>
            </div>

            {/* Warehouse Distribution */}
            <section>
              <h4 className="font-bold text-slate-800 mb-3 flex items-center text-sm">
                <MapPin size={16} className="mr-2 text-slate-500" /> Phân bổ tồn kho tại các địa điểm
              </h4>
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="p-3">Kho lưu trữ</th>
                      <th className="p-3 w-36 text-right">Số lượng tồn</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayWarehouses.map(wh => {
                      const qty = item.stockByWarehouse[wh.id] || 0;
                      return (
                        <tr key={wh.id} className={qty > 0 ? "bg-white" : "bg-slate-50/50"}>
                          <td className="p-3">
                            <div className="font-bold text-slate-700">{wh.name}</div>
                            <div className="text-[10px] text-slate-400">{wh.address}</div>
                          </td>
                          <td className="p-3 text-right">
                            <span className={`font-bold ${qty > 0 ? 'text-slate-800' : 'text-slate-300'}`}>{qty.toLocaleString()}</span>
                            <span className="text-xs text-slate-400 ml-1">{item.unit}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Admin & Accountant: Transaction History Section */}
            {(isAdmin || isAccountant) && (
              <section className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-slate-800 flex items-center text-sm">
                    <History size={16} className="mr-2 text-slate-500" /> Thẻ kho - Lịch sử biến động
                  </h4>
                  <span className="text-[10px] font-black text-slate-400 uppercase bg-slate-100 px-2 py-0.5 rounded-full">
                    {itemHistory.length} giao dịch
                  </span>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] md:text-xs">
                      <thead className="bg-slate-50 text-slate-400 font-bold border-b border-slate-200 uppercase tracking-widest text-[9px]">
                        <tr>
                          <th className="p-3">Thời gian</th>
                          <th className="p-3">Loại hình</th>
                          <th className="p-3">Kho liên quan</th>
                          <th className="p-3 text-right">Số lượng</th>
                          <th className="p-3">Người thực hiện</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {itemHistory.length > 0 ? (
                          itemHistory.map(tx => {
                            const badge = getTxTypeBadge(tx.type);
                            const txItem = tx.items.find(ti => ti.itemId === item.id);
                            const requester = users.find(u => u.id === tx.requesterId);
                            const sourceWh = warehouses.find(w => w.id === tx.sourceWarehouseId);
                            const targetWh = warehouses.find(w => w.id === tx.targetWarehouseId);

                            return (
                              <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="p-3 text-slate-500 font-medium">
                                  {new Date(tx.date).toLocaleDateString('vi-VN')}
                                  <div className="text-[9px] opacity-60 uppercase">{new Date(tx.date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</div>
                                </td>
                                <td className="p-3">
                                  <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold ${badge.color}`}>
                                    {badge.icon} {badge.label}
                                  </div>
                                </td>
                                <td className="p-3 max-w-[150px]">
                                  <div className="flex items-center gap-1 truncate">
                                    {tx.type === TransactionType.IMPORT && <span className="text-slate-800 font-bold">→ {targetWh?.name}</span>}
                                    {tx.type === TransactionType.EXPORT && <span className="text-slate-800 font-bold">{sourceWh?.name} →</span>}
                                    {tx.type === TransactionType.LIQUIDATION && <span className="text-red-600 font-bold">🗑 {sourceWh?.name}</span>}
                                    {tx.type === TransactionType.TRANSFER && (
                                      <div className="flex items-center gap-1 truncate">
                                        <span className="text-slate-500">{sourceWh?.name}</span>
                                        <ArrowRight size={10} className="text-slate-300" />
                                        <span className="text-blue-600 font-bold">{targetWh?.name}</span>
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className={`p-3 text-right font-black ${tx.type === TransactionType.IMPORT ? 'text-emerald-600' :
                                  tx.type === TransactionType.LIQUIDATION ? 'text-red-600' : 'text-orange-600'
                                  }`}>
                                  {tx.type === TransactionType.IMPORT ? '+' : '-'}{txItem?.quantity.toLocaleString()}
                                </td>
                                <td className="p-3 text-slate-500 truncate italic">
                                  {requester?.name || 'Hệ thống'}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={5} className="p-8 text-center text-slate-400 font-medium italic">
                              Chưa có lịch sử giao dịch thành công cho vật tư này.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end items-center sticky bottom-0 z-10">
            <button onClick={onClose} className="px-8 py-2 bg-slate-800 text-white rounded-lg font-bold text-sm hover:bg-slate-700 transition-colors shadow-md">
              Đóng
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default InventoryDetailModal;
