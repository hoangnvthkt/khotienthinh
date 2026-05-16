
import React, { useState, useEffect } from 'react';
import { X, Send, CheckCircle, Trash2, Info, Truck, PackageCheck, AlertCircle, XCircle, Plus, User, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { MaterialRequest, RequestStatus, InventoryItem, MaterialRequestFulfillmentMode } from '../types';
import ItemSelectionModal from './ItemSelectionModal';
import ScannerModal from './ScannerModal';
import { useReservedStock } from '../hooks/useReservedStock';
import { canApproveMaterialRequest, canExportMaterialRequest, canReceiveMaterialRequest, isAdmin } from '../lib/wmsPermissions';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';

interface RequestModalProps {
    isOpen: boolean;
    onClose: () => void;
    request?: MaterialRequest;
    defaultSiteWarehouseId?: string; // Pre-fill when opened from Project module
}

const RequestModal: React.FC<RequestModalProps> = ({ isOpen, onClose, request, defaultSiteWarehouseId }) => {
    const { items, warehouses, user, users, addRequest, updateRequestStatus } = useApp();
    const { getStockSummary, getOnHandStock } = useReservedStock();
    const toast = useToast();
    const [step, setStep] = useState<'CREATE' | 'APPROVE' | 'VIEW'>('CREATE');
    const [showApprovalPanel, setShowApprovalPanel] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Form State
    const [siteWarehouseId, setSiteWarehouseId] = useState('');
    const [sourceWarehouseId, setSourceWarehouseId] = useState('');
    const [note, setNote] = useState('');
    const [fulfillmentMode, setFulfillmentMode] = useState<MaterialRequestFulfillmentMode>(MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK);
    const [overrideReason, setOverrideReason] = useState('');
    const [reqItems, setReqItems] = useState<{ itemId: string, qty: number }[]>([]);
    const [approvedItems, setApprovedItems] = useState<{ itemId: string, qty: number }[]>([]);

    const [isItemSelectOpen, setItemSelectOpen] = useState(false);
    const [isScannerOpen, setScannerOpen] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setShowApprovalPanel(false);
            setIsSaving(false);
            if (request) {
                if (request.status === RequestStatus.PENDING && canApproveMaterialRequest(user, request)) {
                    setStep('APPROVE');
                } else {
                    setStep('VIEW');
                }

                setSiteWarehouseId(request.siteWarehouseId);
                setSourceWarehouseId(request.sourceWarehouseId || '');
                setNote(request.note || '');
                setFulfillmentMode(request.fulfillmentMode || MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK);
                setOverrideReason(request.overrideReason || '');
                setReqItems(request.items.map(i => ({ itemId: i.itemId, qty: i.requestQty })));
                setApprovedItems(request.items.map(i => ({ itemId: i.itemId, qty: i.approvedQty })));
            } else {
                setStep('CREATE');
                setSiteWarehouseId(defaultSiteWarehouseId || user.assignedWarehouseId || '');
                setSourceWarehouseId('');
                setNote('');
                setFulfillmentMode(MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK);
                setOverrideReason('');
                setReqItems([]);
                setApprovedItems([]);
            }
        }
    }, [isOpen, request, user, items]);

    const handleAddItem = () => {
        if (items.length === 0) return;
        if (!sourceWarehouseId) {
            toast.warning('Thiếu kho cung cấp', 'Vui lòng chọn kho cung cấp trước khi chọn vật tư.');
            return;
        }
        setItemSelectOpen(true);
    };

    const handleSelectFromModal = (item: InventoryItem) => {
        if (reqItems.some(i => i.itemId === item.id)) {
            toast.warning('Vật tư đã tồn tại', 'Vật tư này đã có trong danh sách đề xuất.');
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
        const stockSummary = getStockSummary(itemId, sourceWarehouseId, { excludeRequestId: request?.id });
        const availableStock = stockSummary.available;
        const sourceStock = isAdmin(user) ? Number.MAX_SAFE_INTEGER : availableStock;

        // Ràng buộc 1: Không vượt quá tồn kho
        if (qty > sourceStock) {
            toast.warning('Vượt tồn khả dụng', `Kho nguồn chỉ còn ${sourceStock} ${item?.unit || ''}.`);
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

    const handleSubmitCreate = async () => {
        if (isSaving) return;
        if (!siteWarehouseId || !sourceWarehouseId || reqItems.length === 0) {
            toast.warning('Thiếu thông tin', 'Vui lòng chọn đầy đủ kho nhận, kho nguồn và ít nhất 1 vật tư.');
            return;
        }

        const shortages = reqItems
            .map(line => ({ ...line, summary: getStockSummary(line.itemId, sourceWarehouseId) }))
            .filter(line => Number(line.qty) > line.summary.available);
        if (shortages.length > 0) {
            const shortageText = shortages.map(line => {
                const item = items.find(i => i.id === line.itemId);
                const missing = Number(line.qty) - line.summary.available;
                return `${item?.name || line.itemId}: khả dụng ${line.summary.available}, thiếu ${missing}`;
            }).join('\n');
            if (!window.confirm(`Một số vật tư vượt tồn khả dụng và sẽ chỉ ghi nhận nhu cầu chờ duyệt:\n${shortageText}`)) return;
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
            fulfillmentMode,
            items: reqItems.map(i => ({ itemId: i.itemId, requestQty: Number(i.qty), approvedQty: 0 })),
            logs: [{ action: 'CREATED', userId: user.id, timestamp: new Date().toISOString() }]
        };

        setIsSaving(true);
        try {
            const saved = await addRequest(newRequest);
            if (!saved) {
                toast.error('Không thể gửi đề xuất', 'Không lưu được phiếu đề xuất lên hệ thống. Vui lòng thử lại.');
                return;
            }
            toast.success('Đã gửi đề xuất vật tư', 'Phiếu của bạn đang chờ xử lý.');
            onClose();
        } catch (err: any) {
            logApiError('requestModal.create', err);
            toast.error('Không thể gửi đề xuất', getApiErrorMessage(err, 'Không lưu được phiếu đề xuất lên hệ thống.'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleAction = async (status: RequestStatus) => {
        if (isSaving) return;
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

        if (status === RequestStatus.APPROVED) {
            const stockShortages = approvedItems
                .map(line => ({ ...line, summary: getStockSummary(line.itemId, sourceWarehouseId, { excludeRequestId: request.id }) }))
                .filter(line => Number(line.qty) > line.summary.available);
            if (stockShortages.length > 0) {
                if (!isAdmin(user)) {
                    toast.warning('Vượt tồn khả dụng', 'Thủ kho không thể duyệt vượt tồn khả dụng. Vui lòng giảm số lượng duyệt hoặc xử lý phiếu đang giữ chỗ trước.');
                    return;
                }
                if (!overrideReason.trim()) {
                    toast.warning('Thiếu lý do override', 'Admin duyệt vượt tồn khả dụng phải nhập lý do override.');
                    return;
                }
                const shortageText = stockShortages.map(line => {
                    const item = items.find(i => i.id === line.itemId);
                    const missing = Number(line.qty) - line.summary.available;
                    return `${item?.name || line.itemId}: khả dụng ${line.summary.available}, vượt ${missing}`;
                }).join('\n');
                if (!window.confirm(`Bạn đang duyệt vượt tồn khả dụng:\n${shortageText}\n\nTiếp tục với lý do override?`)) return;
            }
        }

        if (status === RequestStatus.IN_TRANSIT || status === RequestStatus.COMPLETED) {
            const stockShortages = approvedItems
                .map(line => ({ ...line, onHand: getOnHandStock(line.itemId, sourceWarehouseId) }))
                .filter(line => Number(line.qty) > line.onHand);
            if (stockShortages.length > 0) {
                toast.error('Không đủ tồn thực tế', 'Vui lòng kiểm tra lại tồn kho nguồn.');
                return;
            }
        }

        setIsSaving(true);
        try {
            const saved = await updateRequestStatus(request.id, status, note, approvedItems, sourceWarehouseId, overrideReason.trim() || undefined);
            if (!saved) {
                toast.error('Không thể cập nhật phiếu', 'Không cập nhật được trạng thái phiếu trên hệ thống. Vui lòng thử lại.');
                return;
            }
            toast.success('Đã cập nhật phiếu', `Trạng thái mới: ${status}.`);
            onClose();
        } catch (err: any) {
            logApiError('requestModal.updateStatus', err);
            toast.error('Không thể cập nhật phiếu', getApiErrorMessage(err, 'Không cập nhật được trạng thái phiếu trên hệ thống.'));
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    const isEditable = step === 'CREATE';
    const isApproving = step === 'APPROVE';
    const isViewing = step === 'VIEW';

    const canExport = request ? canExportMaterialRequest(user, request) : false;
    const canReceive = request ? canReceiveMaterialRequest(user, request) : false;

    const sourceWh = warehouses.find(w => w.id === sourceWarehouseId);
    const targetWh = warehouses.find(w => w.id === siteWarehouseId);
    const requester = users.find(u => u.id === (request?.requesterId || user.id));

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-full lg:max-w-5xl shadow-2xl flex flex-col max-h-[95vh] sm:max-h-[95vh] overflow-hidden relative">

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
                                disabled={isSaving}
                                onClick={() => handleAction(RequestStatus.REJECTED)}
                                className="flex-1 py-4 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center shadow-lg shadow-red-500/20"
                            >
                                {isSaving ? <Loader2 size={20} className="mr-2 animate-spin" /> : <XCircle size={20} className="mr-2" />} {isSaving ? 'ĐANG XỬ LÝ...' : 'TỪ CHỐI'}
                            </button>
                            <button
                                disabled={isSaving}
                                onClick={() => handleAction(RequestStatus.APPROVED)}
                                className="flex-1 py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center shadow-lg shadow-emerald-500/20"
                            >
                                {isSaving ? <Loader2 size={20} className="mr-2 animate-spin" /> : <CheckCircle size={20} className="mr-2" />} {isSaving ? 'ĐANG XỬ LÝ...' : 'PHÊ DUYỆT'}
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
                                        request?.status === RequestStatus.COMPLETED ? (fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION ? 'Đã cấp thẳng sử dụng' : 'Đã nhập kho công trường thành công') :
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
                        <div className="bg-white p-4 rounded-xl border border-emerald-100 shadow-sm space-y-2">
                            <label className="text-[10px] uppercase font-black text-emerald-500">Cách cấp vật tư</label>
                            {isEditable ? (
                                <select
                                    value={fulfillmentMode}
                                    onChange={(e) => setFulfillmentMode(e.target.value as MaterialRequestFulfillmentMode)}
                                    className="w-full bg-transparent outline-none text-sm font-bold text-slate-700"
                                >
                                    <option value={MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK}>Nhập kho công trường</option>
                                    <option value={MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION}>Cấp thẳng sử dụng</option>
                                </select>
                            ) : (
                                <span className="text-sm font-bold text-slate-700">
                                    {fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION ? 'Cấp thẳng sử dụng' : 'Nhập kho công trường'}
                                </span>
                            )}
                        </div>

                        {isApproving && isAdmin(user) && (
                            <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-sm space-y-2">
                                <label className="text-[10px] uppercase font-black text-amber-600">Lý do override</label>
                                <input
                                    type="text"
                                    value={overrideReason}
                                    onChange={(e) => setOverrideReason(e.target.value)}
                                    className="w-full bg-transparent outline-none text-sm text-slate-700"
                                    placeholder="Bắt buộc nếu duyệt vượt tồn khả dụng"
                                />
                            </div>
                        )}
                    </div>

                    {/* Desktop table view */}
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden hidden md:block">
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
                                    const stockSummary = getStockSummary(itemId, sourceWarehouseId, { excludeRequestId: request?.id });
                                    const sourceStock = stockSummary.available;
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
                                                        {stockSummary.reserved > 0 && (
                                                            <div className="text-[9px] text-amber-600 font-bold">Giữ chỗ: {stockSummary.reserved}</div>
                                                        )}
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

                    {/* Mobile card view */}
                    <div className="md:hidden space-y-2">
                        {(isEditable ? reqItems : (request?.items || [])).map((row, idx) => {
                            const itemId = row.itemId;
                            const requestQty = isEditable ? row.qty : row.requestQty;
                            const itemInfo = items.find(i => i.id === itemId);
                            const stockSummary = getStockSummary(itemId, sourceWarehouseId, { excludeRequestId: request?.id });
                            const sourceStock = stockSummary.available;
                            const isExcess = !isEditable && (approvedItems.find(ai => ai.itemId === itemId)?.qty || 0) > requestQty;

                            return (
                                <div key={idx} className={`bg-white rounded-xl p-3 border ${isExcess ? 'border-orange-200 bg-orange-50/50' : 'border-slate-200'} shadow-sm`}>
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="min-w-0 flex-1">
                                            <div className="font-bold text-sm text-slate-800 truncate">{itemInfo?.name}</div>
                                            <div className="text-[10px] font-mono text-slate-400">{itemInfo?.sku} • {itemInfo?.unit || '-'}</div>
                                        </div>
                                        {isEditable && (
                                            <button onClick={() => setReqItems(reqItems.filter((_, i) => i !== idx))} className="p-1.5 text-red-400 hover:text-red-600 shrink-0">
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1">
                                            <div className="text-[9px] uppercase font-bold text-slate-400 mb-0.5">SL yêu cầu</div>
                                            {isEditable ? (
                                                <input
                                                    type="number" min="1"
                                                    value={requestQty}
                                                    onChange={(e) => handleUpdateItem(idx, 'qty', e.target.value)}
                                                    className="w-full text-center p-2 border border-slate-200 rounded-lg font-bold text-sm"
                                                />
                                            ) : (
                                                <div className="font-bold text-slate-700 text-sm">{requestQty}</div>
                                            )}
                                        </div>
                                        {!isEditable && (
                                            <>
                                                <div className="flex-1">
                                                    <div className="text-[9px] uppercase font-bold text-blue-400 mb-0.5">Tồn kho</div>
                                                    <div className="font-bold text-blue-600 text-sm">{sourceStock.toLocaleString()}</div>
                                                    {stockSummary.reserved > 0 && <div className="text-[9px] text-amber-600 font-bold">Giữ chỗ: {stockSummary.reserved}</div>}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="text-[9px] uppercase font-bold text-emerald-400 mb-0.5">Duyệt</div>
                                                    {isApproving ? (
                                                        <input
                                                            type="number" min="0" max={sourceStock}
                                                            value={approvedItems.find(i => i.itemId === itemId)?.qty || 0}
                                                            onChange={(e) => handleUpdateApprovedItem(itemId, Number(e.target.value))}
                                                            className={`w-full text-center p-2 border rounded-lg font-bold text-sm ${isExcess ? 'border-orange-400 text-orange-700' : 'border-emerald-200 text-emerald-700'}`}
                                                        />
                                                    ) : (
                                                        <div className={`font-bold text-sm ${isExcess ? 'text-orange-600' : 'text-emerald-700'}`}>
                                                            {row.approvedQty || 0}
                                                        </div>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {isEditable && (
                            <button onClick={handleAddItem} className="w-full py-3 text-accent font-bold rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center active:scale-95 transition-all">
                                <Plus size={16} className="mr-2" /> Thêm vật tư
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
                            <button disabled={isSaving} onClick={handleSubmitCreate} className="px-6 py-2 rounded-lg bg-accent text-white font-bold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-blue-500/20">
                                {isSaving ? <Loader2 size={18} className="mr-2 animate-spin" /> : <Send size={18} className="mr-2" />} {isSaving ? 'Đang gửi...' : 'Gửi đề xuất'}
                            </button>
                        )}

                        {isApproving && (
                            <button
                                disabled={isSaving}
                                onClick={() => setShowApprovalPanel(true)}
                                className="px-6 py-2 rounded-lg bg-accent text-white font-bold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-blue-500/20 transition-all"
                            >
                                {isSaving ? <Loader2 size={18} className="mr-2 animate-spin" /> : <AlertCircle size={18} className="mr-2" />}
                                {isSaving ? 'ĐANG XỬ LÝ...' : 'XỬ LÝ ĐỀ XUẤT'}
                            </button>
                        )}

                        {canExport && (
                            <button disabled={isSaving} onClick={() => handleAction(RequestStatus.IN_TRANSIT)} className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-indigo-500/20">
                                {isSaving ? <Loader2 size={18} className="mr-2 animate-spin" /> : <Truck size={18} className="mr-2" />} {isSaving ? 'Đang xử lý...' : 'Xác nhận xuất kho'}
                            </button>
                        )}

                        {canReceive && (
                            <button disabled={isSaving} onClick={() => handleAction(RequestStatus.COMPLETED)} className="px-6 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-emerald-500/20">
                                {isSaving ? <Loader2 size={18} className="mr-2 animate-spin" /> : <CheckCircle size={18} className="mr-2" />} {isSaving ? 'Đang xử lý...' : fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION ? 'Xác nhận sử dụng' : 'Xác nhận nhận hàng'}
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
