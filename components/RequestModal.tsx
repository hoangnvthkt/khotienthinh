
import React, { useState, useEffect } from 'react';
import { X, Send, CheckCircle, Trash2, Info, Truck, PackageCheck, AlertCircle, XCircle, Plus, User } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { MaterialRequest, RequestStatus, Role, InventoryItem } from '../types';
import ItemSelectionModal from './ItemSelectionModal';
import ScannerModal from './ScannerModal';

interface RequestModalProps {
    isOpen: boolean;
    onClose: () => void;
    request?: MaterialRequest;
}

const RequestModal: React.FC<RequestModalProps> = ({ isOpen, onClose, request }) => {
    const { items, warehouses, user, users, addRequest, updateRequestStatus } = useApp();
    const [step, setStep] = useState<'CREATE' | 'APPROVE' | 'VIEW'>('CREATE');
    const [showApprovalPanel, setShowApprovalPanel] = useState(false);

    // Form State
    const [siteWarehouseId, setSiteWarehouseId] = useState('');
    const [sourceWarehouseId, setSourceWarehouseId] = useState('');
    const [note, setNote] = useState('');
    const [reqItems, setReqItems] = useState<{ itemId: string, qty: number }[]>([]);
    const [approvedItems, setApprovedItems] = useState<{ itemId: string, qty: number }[]>([]);

    const [isItemSelectOpen, setItemSelectOpen] = useState(false);
    const [isScannerOpen, setScannerOpen] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setShowApprovalPanel(false);
            if (request) {
                if (request.status === RequestStatus.PENDING && user.role === Role.ADMIN) {
                    setStep('APPROVE');
                } else {
                    setStep('VIEW');
                }

                setSiteWarehouseId(request.siteWarehouseId);
                setSourceWarehouseId(request.sourceWarehouseId || '');
                setNote(request.note || '');
                setReqItems(request.items.map(i => ({ itemId: i.itemId, qty: i.requestQty })));
                setApprovedItems(request.items.map(i => ({ itemId: i.itemId, qty: i.approvedQty })));
            } else {
                setStep('CREATE');
                setSiteWarehouseId(user.assignedWarehouseId || '');
                setSourceWarehouseId('');
                setNote('');
                setReqItems([]);
                setApprovedItems([]);
            }
        }
    }, [isOpen, request, user, items]);

    const handleAddItem = () => {
        if (items.length === 0) return;
        if (!sourceWarehouseId) {
            alert("Vui lòng chọn Kho cung cấp trước khi chọn vật tư");
            return;
        }
        setItemSelectOpen(true);
    };

    const handleSelectFromModal = (item: InventoryItem) => {
        if (reqItems.some(i => i.itemId === item.id)) {
            alert("Vật tư này đã có trong danh sách đề xuất");
            return;
        }
        setReqItems([...reqItems, { itemId: item.id, qty: 1 }]);
        setItemSelectOpen(false);
    };

    const handleUpdateItem = (index: number, field: 'itemId' | 'qty', value: any) => {
        const newItems = [...reqItems];
        newItems[index] = { ...newItems[index], [field]: value };
        setReqItems(newItems);
    };

    const handleUpdateApprovedItem = (itemId: string, qty: number) => {
        const item = items.find(i => i.id === itemId);
        const sourceStock = item?.stockByWarehouse[sourceWarehouseId] || 0;

        // Ràng buộc 1: Không vượt quá tồn kho
        if (qty > sourceStock) {
            alert(`Kho nguồn chỉ còn ${sourceStock} ${item?.unit}. Không thể duyệt vượt tồn kho.`);
            qty = sourceStock;
        }

        setApprovedItems(prev => {
            const existing = prev.find(i => i.itemId === itemId);
            if (existing) {
                return prev.map(i => i.itemId === itemId ? { ...i, qty } : i);
            }
            return [...prev, { itemId, qty }];
        });
    };

    const handleSubmitCreate = () => {
        if (!siteWarehouseId || !sourceWarehouseId || reqItems.length === 0) {
            alert("Vui lòng chọn đầy đủ kho nhận, kho nguồn và ít nhất 1 vật tư");
            return;
        }

        const newRequest: MaterialRequest = {
            id: `mr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            code: `MR-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000)}`,
            siteWarehouseId,
            sourceWarehouseId: sourceWarehouseId,
            requesterId: user.id,
            status: RequestStatus.PENDING,
            createdDate: new Date().toISOString(),
            expectedDate: new Date(Date.now() + 86400000 * 3).toISOString(),
            note,
            items: reqItems.map(i => ({ itemId: i.itemId, requestQty: Number(i.qty), approvedQty: 0 })),
            logs: [{ action: 'CREATED', userId: user.id, timestamp: new Date().toISOString() }]
        };

        addRequest(newRequest);
        onClose();
    };

    const handleAction = (status: RequestStatus) => {
        if (!request) return;

        // Ràng buộc 2: Kiểm tra duyệt vượt số lượng yêu cầu khi Phê duyệt
        if (status === RequestStatus.APPROVED) {
            const itemsWithExcess = approvedItems.filter(ai => {
                const originalReq = request.items.find(ri => ri.itemId === ai.itemId);
                return originalReq && ai.qty > originalReq.requestQty;
            });

            if (itemsWithExcess.length > 0) {
                const confirmMsg = `Có ${itemsWithExcess.length} vật tư được duyệt vượt mức yêu cầu ban đầu. Bạn có chắc chắn muốn tiếp tục phê duyệt?`;
                if (!window.confirm(confirmMsg)) return;
            }
        }

        updateRequestStatus(request.id, status, note, approvedItems, sourceWarehouseId);
        onClose();
    };

    if (!isOpen) return null;

    const isEditable = step === 'CREATE';
    const isApproving = step === 'APPROVE';
    const isViewing = step === 'VIEW';

    const canExport = request?.status === RequestStatus.APPROVED && (user.role === Role.ADMIN || user.assignedWarehouseId === request.sourceWarehouseId);
    const canReceive = request?.status === RequestStatus.IN_TRANSIT && (user.role === Role.ADMIN || user.assignedWarehouseId === request.siteWarehouseId);

    const sourceWh = warehouses.find(w => w.id === sourceWarehouseId);
    const targetWh = warehouses.find(w => w.id === siteWarehouseId);
    const requester = users.find(u => u.id === (request?.requesterId || user.id));

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col max-h-[95vh] overflow-hidden relative">

                {/* Decision Overlay */}
                {showApprovalPanel && (
                    <div className="absolute inset-0 z-[60] bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center p-8 animate-in fade-in zoom-in duration-200">
                        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-6">
                            <AlertCircle size={32} />
                        </div>
                        <h3 className="text-2xl font-bold text-slate-800 mb-2">Xác nhận xử lý phiếu</h3>
                        <p className="text-slate-500 mb-10 text-center max-w-md">Vui lòng chọn Phê duyệt để chuyển sang bước xuất kho, hoặc Từ chối để hủy yêu cầu này.</p>

                        <div className="flex gap-4 w-full max-w-md">
                            <button
                                onClick={() => handleAction(RequestStatus.REJECTED)}
                                className="flex-1 py-4 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all flex items-center justify-center shadow-lg shadow-red-500/20"
                            >
                                <XCircle size={20} className="mr-2" /> TỪ CHỐI
                            </button>
                            <button
                                onClick={() => handleAction(RequestStatus.APPROVED)}
                                className="flex-1 py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center shadow-lg shadow-emerald-500/20"
                            >
                                <CheckCircle size={20} className="mr-2" /> PHÊ DUYỆT
                            </button>
                        </div>
                        <button
                            onClick={() => setShowApprovalPanel(false)}
                            className="mt-8 text-slate-400 font-bold hover:text-slate-600"
                        >
                            Quay lại xem thông tin
                        </button>
                    </div>
                )}

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
                    <div>
                        <h3 className="font-bold text-lg text-slate-800">
                            {isEditable ? 'Tạo đề xuất vật tư' : `Phiếu đề xuất: ${request?.code}`}
                        </h3>
                        <p className="text-xs text-slate-500">
                            {isEditable ? 'Gửi nhu cầu về bộ phận điều phối' : `Trạng thái: ${request?.status}`}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Status Bar */}
                {!isEditable && (
                    <div className={`px-6 py-2 text-white text-[10px] font-bold flex justify-between items-center ${request?.status === RequestStatus.PENDING ? 'bg-amber-600' :
                        request?.status === RequestStatus.APPROVED ? 'bg-blue-600' :
                            request?.status === RequestStatus.IN_TRANSIT ? 'bg-indigo-600' :
                                request?.status === RequestStatus.COMPLETED ? 'bg-emerald-600' :
                                    request?.status === RequestStatus.REJECTED ? 'bg-red-600' : 'bg-slate-600'
                        }`}>
                        <div className="flex items-center uppercase tracking-widest">
                            <Info size={14} className="mr-2" />
                            {request?.status === RequestStatus.PENDING ? 'Đang chờ thẩm định' :
                                request?.status === RequestStatus.APPROVED ? 'Đã duyệt - Chờ xuất hàng' :
                                    request?.status === RequestStatus.IN_TRANSIT ? 'Đang trên đường vận chuyển' :
                                        request?.status === RequestStatus.COMPLETED ? 'Đã nhập kho công trường thành công' :
                                            request?.status === RequestStatus.REJECTED ? 'Đề xuất này đã bị từ chối' : 'Đề xuất đã đóng'}
                        </div>
                        <div className="font-mono">{new Date(request?.createdDate || '').toLocaleDateString('vi-VN')}</div>
                    </div>
                )}

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 bg-slate-50/30">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
                            <label className="text-[10px] uppercase font-black text-slate-400">Người yêu cầu</label>
                            <div className="flex items-center gap-2 text-slate-800 font-bold">
                                <User size={18} className="text-slate-400" />
                                <span className="text-sm">{requester?.name || 'N/A'}</span>
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
                            <label className="text-[10px] uppercase font-black text-slate-400">Kho nhận hàng</label>
                            <div className="flex items-center gap-2 text-slate-800 font-bold">
                                <Truck size={18} className="text-slate-400" />
                                {isEditable ? (
                                    <select
                                        value={siteWarehouseId}
                                        onChange={(e) => setSiteWarehouseId(e.target.value)}
                                        className="w-full bg-transparent outline-none text-sm"
                                    >
                                        <option value="">-- Chọn kho nhận --</option>
                                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                    </select>
                                ) : (
                                    <span className="text-sm">{targetWh?.name}</span>
                                )}
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm space-y-2">
                            <label className="text-[10px] uppercase font-black text-blue-400">Kho cung cấp</label>
                            <div className="flex items-center gap-2 text-blue-700 font-bold">
                                <PackageCheck size={18} className="text-blue-400" />
                                {isEditable ? (
                                    <select
                                        value={sourceWarehouseId}
                                        onChange={(e) => setSourceWarehouseId(e.target.value)}
                                        className="w-full bg-transparent outline-none text-sm"
                                    >
                                        <option value="">-- Chọn kho nguồn --</option>
                                        {warehouses.filter(w => w.id !== siteWarehouseId).map(w => (
                                            <option key={w.id} value={w.id}>{w.name}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <span className="text-sm">{sourceWh?.name}</span>
                                )}
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
                            <label className="text-[10px] uppercase font-black text-slate-400">Ghi chú phiếu</label>
                            <input
                                type="text"
                                disabled={!isEditable && !isApproving}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                className="w-full bg-transparent outline-none text-sm text-slate-700"
                                placeholder="Lý do hoặc chỉ dẫn..."
                            />
                        </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-100 text-slate-500 font-bold border-b border-slate-200">
                                <tr>
                                    <th className="p-4">Vật tư đề xuất</th>
                                    <th className="p-4 w-24 text-center">ĐVT</th>
                                    <th className="p-4 w-32 text-right">Số lượng Y/C</th>
                                    {!isEditable && (
                                        <>
                                            <th className="p-4 w-32 text-right text-blue-600 bg-blue-50/30">Tồn kho</th>
                                            <th className="p-4 w-32 text-right text-emerald-600 bg-emerald-50/30">Duyệt xuất</th>
                                        </>
                                    )}
                                    {isEditable && <th className="p-4 w-12"></th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {(isEditable ? reqItems : (request?.items || [])).map((row, idx) => {
                                    const itemId = row.itemId;
                                    const requestQty = isEditable ? row.qty : row.requestQty;
                                    const itemInfo = items.find(i => i.id === itemId);
                                    const sourceStock = itemInfo?.stockByWarehouse[sourceWarehouseId] || 0;
                                    const isExcess = !isEditable && (approvedItems.find(ai => ai.itemId === itemId)?.qty || 0) > requestQty;

                                    return (
                                        <tr key={idx} className={`transition-colors ${isExcess ? 'bg-orange-50/50' : 'hover:bg-slate-50/50'}`}>
                                            <td className="p-4">
                                                <div>
                                                    <div className="font-bold text-slate-800">{itemInfo?.name}</div>
                                                    <div className="text-[10px] font-mono text-slate-400">{itemInfo?.sku}</div>
                                                </div>
                                            </td>
                                            <td className="p-4 text-center text-slate-500 font-medium">{itemInfo?.unit || '-'}</td>
                                            <td className="p-4 text-right">
                                                {isEditable ? (
                                                    <input
                                                        type="number" min="1"
                                                        value={requestQty}
                                                        onChange={(e) => handleUpdateItem(idx, 'qty', e.target.value)}
                                                        className="w-20 text-right p-1 border border-slate-200 rounded font-bold"
                                                    />
                                                ) : (
                                                    <span className="font-bold text-slate-600">{requestQty}</span>
                                                )}
                                            </td>
                                            {!isEditable && (
                                                <>
                                                    <td className="p-4 text-right font-bold text-blue-600">
                                                        {sourceStock.toLocaleString()}
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        {isApproving ? (
                                                            <div className="flex flex-col items-end">
                                                                <input
                                                                    type="number" min="0" max={sourceStock}
                                                                    value={approvedItems.find(i => i.itemId === itemId)?.qty || 0}
                                                                    onChange={(e) => handleUpdateApprovedItem(itemId, Number(e.target.value))}
                                                                    className={`w-20 text-right p-1 border rounded font-bold bg-white focus:ring-2 outline-none transition-colors ${isExcess ? 'border-orange-400 text-orange-700 focus:ring-orange-500' : 'border-emerald-200 text-emerald-700 focus:ring-emerald-500'}`}
                                                                />
                                                                {isExcess && <span className="text-[9px] text-orange-600 font-bold mt-1 uppercase">Duyệt vượt mức</span>}
                                                            </div>
                                                        ) : (
                                                            <span className={`font-bold ${isExcess ? 'text-orange-600 underline' : 'text-emerald-700'}`}>
                                                                {row.approvedQty || 0}
                                                            </span>
                                                        )}
                                                    </td>
                                                </>
                                            )}
                                            {isEditable && (
                                                <td className="p-4 text-center">
                                                    <button onClick={() => setReqItems(reqItems.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600">
                                                        <Trash2 size={16} />
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {isEditable && (
                            <button onClick={handleAddItem} className="w-full py-4 text-accent font-bold hover:bg-slate-50 transition-colors border-t border-dashed border-slate-200 flex items-center justify-center">
                                <Plus size={16} className="mr-2" /> Thêm vật tư vào đề xuất
                            </button>
                        )}
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center relative">
                    <div className="text-slate-400 text-[10px] uppercase font-black tracking-widest">
                        Security: {request?.id.slice(-6) || 'NEW-REQ'}
                    </div>

                    <div className="flex gap-3 items-center">
                        <button onClick={onClose} className="px-5 py-2 rounded-lg border border-slate-300 text-slate-600 font-bold hover:bg-white transition-colors">
                            Đóng
                        </button>

                        {isEditable && (
                            <button onClick={handleSubmitCreate} className="px-6 py-2 rounded-lg bg-accent text-white font-bold hover:bg-blue-700 flex items-center shadow-lg shadow-blue-500/20">
                                <Send size={18} className="mr-2" /> Gửi đề xuất
                            </button>
                        )}

                        {isApproving && (
                            <button
                                onClick={() => setShowApprovalPanel(true)}
                                className="px-6 py-2 rounded-lg bg-accent text-white font-bold hover:bg-blue-700 flex items-center shadow-lg shadow-blue-500/20 transition-all"
                            >
                                <AlertCircle size={18} className="mr-2" />
                                XỬ LÝ ĐỀ XUẤT
                            </button>
                        )}

                        {canExport && (
                            <button onClick={() => handleAction(RequestStatus.IN_TRANSIT)} className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 flex items-center shadow-lg shadow-indigo-500/20">
                                <Truck size={18} className="mr-2" /> Xác nhận xuất kho
                            </button>
                        )}

                        {canReceive && (
                            <button onClick={() => handleAction(RequestStatus.COMPLETED)} className="px-6 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 flex items-center shadow-lg shadow-emerald-500/20">
                                <CheckCircle size={18} className="mr-2" /> Xác nhận nhận hàng
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Modals for selection */}
            <ItemSelectionModal
                isOpen={isItemSelectOpen}
                onClose={() => setItemSelectOpen(false)}
                onSelect={handleSelectFromModal}
                onOpenScanner={() => setScannerOpen(true)}
                filterWarehouseId={sourceWarehouseId}
            />

            <ScannerModal
                isOpen={isScannerOpen}
                onClose={() => setScannerOpen(false)}
                onScan={(sku) => {
                    const item = items.find(i => i.sku === sku);
                    if (item) handleSelectFromModal(item);
                    setScannerOpen(false);
                }}
            />
        </div>
    );
};

export default RequestModal;
