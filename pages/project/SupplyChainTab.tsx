import React, { useState, useMemo, useEffect } from 'react';
import {
    Plus, Edit2, Trash2, X, Save, Truck, Star, Phone, Mail, MapPin,
    FileText, CheckCircle2, Clock, Ban, Send, Package, ChevronDown,
    ChevronUp, Users, DollarSign, ShoppingCart, AlertTriangle
} from 'lucide-react';
import { ProjectVendor, PurchaseOrder, POStatus } from '../../types';
import { vendorService, poService } from '../../lib/projectService';

interface SupplyChainTabProps {
    constructionSiteId: string;
}

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    return n.toLocaleString('vi-VN');
};

const PO_STATUS: Record<POStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    draft: { label: 'Nháp', color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200', icon: <Clock size={12} /> },
    sent: { label: 'Đã gửi', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: <Send size={12} /> },
    partial: { label: 'Giao 1 phần', color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200', icon: <Package size={12} /> },
    delivered: { label: 'Đã giao', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={12} /> },
    cancelled: { label: 'Huỷ', color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: <Ban size={12} /> },
};

const VENDOR_CATS = ['Xi măng', 'Thép', 'Cát & Đá', 'Gạch', 'Gỗ', 'Sơn', 'Ống/Phụ kiện nước', 'Dây & TB điện', 'VLXD khác'];

const SupplyChainTab: React.FC<SupplyChainTabProps> = ({ constructionSiteId }) => {
    const [subTab, setSubTab] = useState<'vendor' | 'po'>('vendor');

    // Vendors
    const [vendors, setVendors] = useState<ProjectVendor[]>([]);
    // POs
    const [pos, setPos] = useState<PurchaseOrder[]>([]);

    useEffect(() => {
        vendorService.list(constructionSiteId).then(setVendors).catch(console.error);
        poService.list(constructionSiteId).then(setPos).catch(console.error);
    }, [constructionSiteId]);

    const [showVendorForm, setShowVendorForm] = useState(false);
    const [editingVendor, setEditingVendor] = useState<ProjectVendor | null>(null);
    const [showPoForm, setShowPoForm] = useState(false);
    const [editingPo, setEditingPo] = useState<PurchaseOrder | null>(null);
    const [expandedPoId, setExpandedPoId] = useState<string | null>(null);

    // Vendor Form
    const [vName, setVName] = useState('');
    const [vContact, setVContact] = useState('');
    const [vPhone, setVPhone] = useState('');
    const [vEmail, setVEmail] = useState('');
    const [vAddress, setVAddress] = useState('');
    const [vTax, setVTax] = useState('');
    const [vRating, setVRating] = useState(3);
    const [vCats, setVCats] = useState<string[]>([]);
    const [vNotes, setVNotes] = useState('');

    // PO Form
    const [pVendorId, setPVendorId] = useState('');
    const [pNum, setPNum] = useState('');
    const [pDate, setPDate] = useState(new Date().toISOString().split('T')[0]);
    const [pExpDate, setPExpDate] = useState('');
    const [pItems, setPItems] = useState<{ name: string; unit: string; qty: number; unitPrice: number }[]>([{ name: '', unit: '', qty: 0, unitPrice: 0 }]);
    const [pNote, setPNote] = useState('');

    // Vendor CRUD
    const resetVendorForm = () => {
        setEditingVendor(null); setShowVendorForm(false);
        setVName(''); setVContact(''); setVPhone(''); setVEmail('');
        setVAddress(''); setVTax(''); setVRating(3); setVCats([]); setVNotes('');
    };
    const openEditVendor = (v: ProjectVendor) => {
        setEditingVendor(v); setVName(v.name); setVContact(v.contact);
        setVPhone(v.phone); setVEmail(v.email || ''); setVAddress(v.address || '');
        setVTax(v.taxCode || ''); setVRating(v.rating); setVCats([...v.categories]);
        setVNotes(v.notes || ''); setShowVendorForm(true);
    };
    const handleSaveVendor = async () => {
        if (!vName || !vPhone) return;
        const vendorPosData = pos.filter(p => editingVendor ? p.vendorId === editingVendor.id : false);
        const v: ProjectVendor = {
            id: editingVendor?.id || crypto.randomUUID(), constructionSiteId,
            name: vName, contact: vContact, phone: vPhone, email: vEmail || undefined,
            address: vAddress || undefined, taxCode: vTax || undefined, rating: vRating,
            categories: vCats, totalOrders: vendorPosData.length,
            totalValue: vendorPosData.reduce((s, p) => s + p.totalAmount, 0),
            notes: vNotes || undefined, createdAt: editingVendor?.createdAt || new Date().toISOString(),
        };
        await vendorService.upsert(v);
        setVendors(await vendorService.list(constructionSiteId));
        resetVendorForm();
    };

    // PO CRUD
    const resetPoForm = () => {
        setEditingPo(null); setShowPoForm(false);
        setPVendorId(''); setPNum(''); setPDate(new Date().toISOString().split('T')[0]);
        setPExpDate(''); setPItems([{ name: '', unit: '', qty: 0, unitPrice: 0 }]); setPNote('');
    };
    const openEditPo = (po: PurchaseOrder) => {
        setEditingPo(po); setPVendorId(po.vendorId); setPNum(po.poNumber);
        setPDate(po.orderDate); setPExpDate(po.expectedDeliveryDate || '');
        setPItems(po.items.map(i => ({ name: i.name, unit: i.unit, qty: i.qty, unitPrice: i.unitPrice })));
        setPNote(po.note || ''); setShowPoForm(true);
    };
    const handleSavePo = async () => {
        if (!pVendorId || !pNum) return;
        const validItems = pItems.filter(i => i.name);
        const totalAmount = validItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
        const vendor = vendors.find(v => v.id === pVendorId);
        const poItem: PurchaseOrder = editingPo ? {
            ...editingPo, vendorId: pVendorId, vendorName: vendor?.name,
            poNumber: pNum, items: validItems, totalAmount, orderDate: pDate,
            expectedDeliveryDate: pExpDate || undefined, note: pNote || undefined,
        } : {
            id: crypto.randomUUID(), constructionSiteId, vendorId: pVendorId,
            vendorName: vendor?.name, poNumber: pNum, items: validItems,
            totalAmount, orderDate: pDate, expectedDeliveryDate: pExpDate || undefined,
            status: 'draft', note: pNote || undefined, createdAt: new Date().toISOString(),
        };
        await poService.upsert(poItem);
        setPos(await poService.list(constructionSiteId));
        resetPoForm();
    };

    const updatePoStatus = async (id: string, status: POStatus) => {
        const po = pos.find(p => p.id === id);
        if (!po) return;
        const updated = {
            ...po, status,
            actualDeliveryDate: status === 'delivered' ? new Date().toISOString().split('T')[0] : po.actualDeliveryDate,
        };
        await poService.upsert(updated);
        setPos(await poService.list(constructionSiteId));
    };

    // Stats
    const stats = useMemo(() => {
        const totalPo = pos.length;
        const totalValue = pos.reduce((s, p) => s + p.totalAmount, 0);
        const delivered = pos.filter(p => p.status === 'delivered').length;
        const pending = pos.filter(p => p.status === 'sent' || p.status === 'draft').length;
        return { vendorCount: vendors.length, totalPo, totalValue, delivered, pending };
    }, [vendors, pos]);

    const poTotalCalc = useMemo(() => pItems.reduce((s, i) => s + i.qty * i.unitPrice, 0), [pItems]);

    return (
        <div className="space-y-6">
            {/* KPI */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Users size={10} /> Nhà cung cấp</div>
                    <div className="text-2xl font-black text-slate-800">{stats.vendorCount}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><ShoppingCart size={10} /> Đơn hàng</div>
                    <div className="text-2xl font-black text-slate-800">{stats.totalPo}</div>
                    <div className="text-[10px] text-slate-400 mt-1">Tổng: {fmt(stats.totalValue)} đ</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Truck size={10} /> Đã giao</div>
                    <div className="text-2xl font-black text-emerald-600">{stats.delivered}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Clock size={10} /> Chờ giao</div>
                    <div className="text-2xl font-black text-amber-600">{stats.pending}</div>
                </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-1 bg-white rounded-2xl p-1.5 border border-slate-100 shadow-sm">
                {[
                    { key: 'vendor' as const, label: '🏢 Nhà cung cấp', count: vendors.length },
                    { key: 'po' as const, label: '📄 Đơn hàng (PO)', count: pos.length },
                ].map(t => (
                    <button key={t.key} onClick={() => setSubTab(t.key)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                            subTab === t.key ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'
                        }`}>
                        {t.label} {t.count > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${subTab === t.key ? 'bg-white/20' : 'bg-slate-100'}`}>{t.count}</span>}
                    </button>
                ))}
            </div>

            {/* Vendor Tab */}
            {subTab === 'vendor' && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><Users size={16} className="text-cyan-500" /> Danh sách NCC</h3>
                        <button onClick={() => { resetVendorForm(); setShowVendorForm(true); }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-cyan-600 bg-cyan-50 border border-cyan-200 hover:bg-cyan-100">
                            <Plus size={12} /> Thêm NCC
                        </button>
                    </div>
                    {vendors.length === 0 ? (
                        <div className="p-12 text-center">
                            <Users size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Chưa có nhà cung cấp</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {vendors.map(v => {
                                const vendorPos = pos.filter(p => p.vendorId === v.id);
                                const vendorValue = vendorPos.reduce((s, p) => s + p.totalAmount, 0);
                                return (
                                    <div key={v.id} className="px-5 py-4 hover:bg-slate-50/30 group">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-sm font-black shrink-0">
                                                    {v.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                                        {v.name}
                                                        <span className="flex items-center gap-0.5">
                                                            {[1,2,3,4,5].map(s => (
                                                                <Star key={s} size={9} className={s <= v.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'} />
                                                            ))}
                                                        </span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
                                                        {v.contact && <span className="flex items-center gap-0.5"><Users size={8} /> {v.contact}</span>}
                                                        <span className="flex items-center gap-0.5"><Phone size={8} /> {v.phone}</span>
                                                        {v.email && <span className="flex items-center gap-0.5"><Mail size={8} /> {v.email}</span>}
                                                    </div>
                                                    {v.categories.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {v.categories.map(c => (
                                                                <span key={c} className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-50 text-cyan-600 border border-cyan-100">{c}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <div className="text-right hidden md:block">
                                                    <div className="text-xs font-bold text-slate-700">{vendorPos.length} PO</div>
                                                    <div className="text-[10px] text-slate-400">{fmt(vendorValue)} đ</div>
                                                </div>
                                                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                                                    <button onClick={() => openEditVendor(v)} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-blue-500"><Edit2 size={11} /></button>
                                                    <button onClick={async () => { if(confirm('Xoá NCC?')) { await vendorService.remove(v.id); setVendors(await vendorService.list(constructionSiteId)); } }}
                                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-red-500"><Trash2 size={11} /></button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* PO Tab */}
            {subTab === 'po' && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><FileText size={16} className="text-blue-500" /> Đơn đặt hàng (PO)</h3>
                        <button onClick={() => { resetPoForm(); setPNum(`PO-${String(pos.length + 1).padStart(3, '0')}`); setShowPoForm(true); }}
                            disabled={vendors.length === 0}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed">
                            <Plus size={12} /> Tạo PO
                        </button>
                    </div>
                    {vendors.length === 0 ? (
                        <div className="p-8 text-center">
                            <AlertTriangle size={28} className="mx-auto mb-2 text-amber-300" />
                            <p className="text-xs font-bold text-slate-400">Thêm NCC trước khi tạo đơn hàng</p>
                        </div>
                    ) : pos.length === 0 ? (
                        <div className="p-12 text-center">
                            <FileText size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Chưa có đơn hàng</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {pos.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(po => {
                                const stCfg = PO_STATUS[po.status];
                                const isExpanded = expandedPoId === po.id;
                                return (
                                    <div key={po.id}>
                                        <div className="px-5 py-4 hover:bg-slate-50/30 group cursor-pointer"
                                            onClick={() => setExpandedPoId(isExpanded ? null : po.id)}>
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                    <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                                                        <FileText size={14} className="text-blue-500" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                                            {po.poNumber}
                                                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border ${stCfg.bg} ${stCfg.color}`}>
                                                                {stCfg.icon} {stCfg.label}
                                                            </span>
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 mt-0.5">
                                                            NCC: <span className="font-bold text-slate-500">{po.vendorName || '—'}</span>
                                                            {' • '}{new Date(po.orderDate).toLocaleDateString('vi-VN')}
                                                            {' • '}{po.items.length} mục
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3 shrink-0">
                                                    <div className="text-right">
                                                        <div className="text-sm font-black text-slate-800">{fmt(po.totalAmount)} đ</div>
                                                        {po.expectedDeliveryDate && (
                                                            <div className="text-[9px] text-slate-400">
                                                                Giao: {new Date(po.expectedDeliveryDate).toLocaleDateString('vi-VN')}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {/* Status actions */}
                                                    <div className="flex gap-1">
                                                        {po.status === 'draft' && (
                                                            <button onClick={e => { e.stopPropagation(); updatePoStatus(po.id, 'sent'); }} title="Gửi đơn"
                                                                className="w-7 h-7 rounded-lg flex items-center justify-center text-amber-400 hover:text-amber-600 hover:bg-amber-50 border border-transparent hover:border-amber-200"><Send size={13} /></button>
                                                        )}
                                                        {po.status === 'sent' && (
                                                            <button onClick={e => { e.stopPropagation(); updatePoStatus(po.id, 'delivered'); }} title="Đã giao"
                                                                className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 border border-transparent hover:border-emerald-200"><Truck size={13} /></button>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                                                        <button onClick={e => { e.stopPropagation(); openEditPo(po); }} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-blue-500"><Edit2 size={11} /></button>
                                                        <button onClick={async e => { e.stopPropagation(); if(confirm('Xoá?')) { await poService.remove(po.id); setPos(await poService.list(constructionSiteId)); } }}
                                                            className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-red-500"><Trash2 size={11} /></button>
                                                    </div>
                                                    {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                                </div>
                                            </div>
                                        </div>
                                        {/* Expanded items */}
                                        {isExpanded && (
                                            <div className="px-5 pb-4 bg-slate-50/30">
                                                <table className="w-full text-[11px]">
                                                    <thead>
                                                        <tr className="text-[9px] font-bold text-slate-400 uppercase">
                                                            <th className="text-left py-2 px-2">Vật tư</th>
                                                            <th className="text-center py-2 px-2">ĐVT</th>
                                                            <th className="text-right py-2 px-2">SL</th>
                                                            <th className="text-right py-2 px-2">Đơn giá</th>
                                                            <th className="text-right py-2 px-2">Thành tiền</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {po.items.map((item, i) => (
                                                            <tr key={i}>
                                                                <td className="py-1.5 px-2 font-bold text-slate-700">{item.name}</td>
                                                                <td className="py-1.5 px-2 text-center text-slate-500">{item.unit}</td>
                                                                <td className="py-1.5 px-2 text-right text-slate-600">{item.qty.toLocaleString()}</td>
                                                                <td className="py-1.5 px-2 text-right text-slate-500">{fmt(item.unitPrice)}</td>
                                                                <td className="py-1.5 px-2 text-right font-bold text-slate-700">{fmt(item.qty * item.unitPrice)} đ</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot>
                                                        <tr className="font-black text-xs">
                                                            <td colSpan={4} className="py-2 px-2 text-right text-slate-600">TỔNG:</td>
                                                            <td className="py-2 px-2 text-right text-slate-800">{fmt(po.totalAmount)} đ</td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                                {po.note && <div className="mt-2 px-2 text-[10px] text-slate-400 italic">💬 {po.note}</div>}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Vendor Form Modal */}
            {showVendorForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editingVendor ? <><Edit2 size={18} /> Sửa NCC</> : <><Plus size={18} /> Thêm NCC</>}
                            </span>
                            <button onClick={resetVendorForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tên NCC *</label>
                                <input value={vName} onChange={e => setVName(e.target.value)} placeholder="VD: Công ty TNHH Xi măng ABC"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-cyan-500 outline-none" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Người liên hệ</label>
                                    <input value={vContact} onChange={e => setVContact(e.target.value)} placeholder="Tên"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Điện thoại *</label>
                                    <input value={vPhone} onChange={e => setVPhone(e.target.value)} placeholder="0901..."
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Email</label>
                                    <input value={vEmail} onChange={e => setVEmail(e.target.value)} placeholder="email@..."
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Mã số thuế</label>
                                    <input value={vTax} onChange={e => setVTax(e.target.value)} placeholder="MST"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Địa chỉ</label>
                                <input value={vAddress} onChange={e => setVAddress(e.target.value)} placeholder="Địa chỉ..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đánh giá</label>
                                <div className="flex gap-1">
                                    {[1,2,3,4,5].map(s => (
                                        <button key={s} onClick={() => setVRating(s)} className="p-1">
                                            <Star size={20} className={s <= vRating ? 'fill-amber-400 text-amber-400' : 'text-slate-200 hover:text-amber-300'} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Loại vật tư cung cấp</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {VENDOR_CATS.map(c => (
                                        <button key={c} onClick={() => setVCats(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
                                            className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${vCats.includes(c) ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                                            {c}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={vNotes} onChange={e => setVNotes(e.target.value)} rows={2} placeholder="..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none resize-none" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetVendorForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                            <button onClick={handleSaveVendor} disabled={!vName || !vPhone}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-500 shadow-lg flex items-center gap-2 disabled:opacity-50">
                                <Save size={16} /> {editingVendor ? 'Lưu' : 'Thêm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* PO Form Modal */}
            {showPoForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editingPo ? <><Edit2 size={18} /> Sửa PO</> : <><Plus size={18} /> Tạo đơn hàng</>}
                            </span>
                            <button onClick={resetPoForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Số PO</label>
                                    <input value={pNum} onChange={e => setPNum(e.target.value)} placeholder="PO-001"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Nhà cung cấp *</label>
                                    <select value={pVendorId} onChange={e => setPVendorId(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none">
                                        <option value="">— Chọn NCC —</option>
                                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngày đặt</label>
                                    <input type="date" value={pDate} onChange={e => setPDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngày giao dự kiến</label>
                                    <input type="date" value={pExpDate} onChange={e => setPExpDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center justify-between">
                                    <span>Danh sách vật tư</span>
                                    <button onClick={() => setPItems([...pItems, { name: '', unit: '', qty: 0, unitPrice: 0 }])}
                                        className="text-blue-500 hover:text-blue-700 flex items-center gap-0.5"><Plus size={10} /> Thêm dòng</button>
                                </label>
                                <div className="space-y-2 mt-2">
                                    {pItems.map((item, i) => (
                                        <div key={i} className="flex gap-1.5 items-center">
                                            <input value={item.name} onChange={e => { const n=[...pItems]; n[i].name=e.target.value; setPItems(n); }}
                                                placeholder="Tên" className="flex-1 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
                                            <input value={item.unit} onChange={e => { const n=[...pItems]; n[i].unit=e.target.value; setPItems(n); }}
                                                placeholder="ĐVT" className="w-14 px-2 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
                                            <input type="number" value={item.qty||''} onChange={e => { const n=[...pItems]; n[i].qty=Number(e.target.value); setPItems(n); }}
                                                placeholder="SL" className="w-14 px-2 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
                                            <input type="number" value={item.unitPrice||''} onChange={e => { const n=[...pItems]; n[i].unitPrice=Number(e.target.value); setPItems(n); }}
                                                placeholder="Đơn giá" className="w-20 px-2 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
                                            {pItems.length > 1 && <button onClick={() => setPItems(pItems.filter((_,j) => j!==i))} className="text-red-300 hover:text-red-500"><X size={14} /></button>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {poTotalCalc > 0 && (
                                <div className="px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-xs flex items-center justify-between">
                                    <span className="text-blue-400">Tổng giá trị:</span>
                                    <span className="font-black text-blue-700 text-sm">{fmt(poTotalCalc)} đ</span>
                                </div>
                            )}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={pNote} onChange={e => setPNote(e.target.value)} rows={2} placeholder="..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetPoForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                            <button onClick={handleSavePo} disabled={!pVendorId || !pNum}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-500 to-indigo-500 shadow-lg flex items-center gap-2 disabled:opacity-50">
                                <Save size={16} /> {editingPo ? 'Lưu' : 'Tạo'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SupplyChainTab;
