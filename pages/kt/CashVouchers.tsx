import React, { useState, useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
  FileText, Plus, Search, Filter, ArrowDownCircle, ArrowUpCircle,
  Check, X, Trash2, Edit3, Eye, Printer, Clock, CheckCircle, Ban,
  ChevronDown, AlertTriangle
} from 'lucide-react';
import {
  CashVoucher, CashVoucherItem, CashVoucherType, CashVoucherStatus,
  CASH_VOUCHER_TYPE_LABELS, CASH_VOUCHER_STATUS_LABELS,
  CASH_CONTACT_TYPE_LABELS, CashContactType, Role
} from '../../types';

const CashVouchers: React.FC = () => {
  const {
    cashFunds, cashVouchers, cashVoucherItems,
    addCashVoucher, updateCashVoucher, approveCashVoucher, cancelCashVoucher, removeCashVoucher
  } = useFinance();
  const { user, users } = useApp();
  const toast = useToast();

  // Filters
  const [activeTab, setActiveTab] = useState<'all' | 'receipt' | 'payment'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterFund, setFilterFund] = useState<string>('all');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createType, setCreateType] = useState<CashVoucherType>('receipt');
  const [detailVoucher, setDetailVoucher] = useState<CashVoucher | null>(null);
  const [editingVoucher, setEditingVoucher] = useState<CashVoucher | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form state
  const emptyForm = {
    fundId: '', date: new Date().toISOString().split('T')[0],
    contactName: '', contactType: '' as string, contactId: '',
    reason: '', note: '',
    items: [{ id: '', description: '', amount: 0, costCategory: '' }] as { id: string; description: string; amount: number; costCategory: string }[],
  };
  const [form, setForm] = useState(emptyForm);

  // ============ Computed ============
  const filteredVouchers = useMemo(() => {
    return cashVouchers.filter(v => {
      if (activeTab !== 'all' && v.type !== activeTab) return false;
      if (filterStatus !== 'all' && v.status !== filterStatus) return false;
      if (filterFund !== 'all' && v.fundId !== filterFund) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        return v.code.toLowerCase().includes(q) || v.reason.toLowerCase().includes(q) || (v.contactName || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [cashVouchers, activeTab, filterStatus, filterFund, searchTerm]);

  const totalAmount = useMemo(() => filteredVouchers.reduce((s, v) => s + v.amount, 0), [filteredVouchers]);

  // ============ Helpers ============
  const formatMoney = (n: number) => n.toLocaleString('vi-VN') + 'đ';

  const getNextCode = (type: CashVoucherType) => {
    const prefix = type === 'receipt' ? 'PT' : 'PC';
    const existing = cashVouchers.filter(v => v.type === type);
    const maxNum = existing.reduce((max, v) => {
      const m = v.code.match(new RegExp(`^${prefix}-(\\d+)$`));
      return m ? Math.max(max, parseInt(m[1])) : max;
    }, 0);
    return `${prefix}-${String(maxNum + 1).padStart(4, '0')}`;
  };

  const getStatusIcon = (status: CashVoucherStatus) => {
    switch (status) {
      case 'draft': return Clock;
      case 'approved': return CheckCircle;
      case 'cancelled': return Ban;
    }
  };

  const getStatusColor = (status: CashVoucherStatus) => {
    switch (status) {
      case 'approved': return 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800';
      case 'draft': return 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800';
      case 'cancelled': return 'bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700';
    }
  };

  const getFundName = (id: string) => cashFunds.find(f => f.id === id)?.name || '—';
  const getUserName = (id: string) => users.find(u => u.id === id)?.name || '—';

  // ============ Form Actions ============
  const openCreate = (type: CashVoucherType) => {
    setCreateType(type);
    setForm({
      ...emptyForm,
      fundId: cashFunds[0]?.id || '',
      items: [{ id: crypto.randomUUID(), description: '', amount: 0, costCategory: '' }],
    });
    setEditingVoucher(null);
    setShowCreateModal(true);
  };

  const openEdit = (voucher: CashVoucher) => {
    const vItems = cashVoucherItems.filter(i => i.voucherId === voucher.id);
    setCreateType(voucher.type);
    setForm({
      fundId: voucher.fundId,
      date: voucher.date.split('T')[0],
      contactName: voucher.contactName || '',
      contactType: voucher.contactType || '',
      contactId: voucher.contactId || '',
      reason: voucher.reason,
      note: voucher.note || '',
      items: vItems.length > 0
        ? vItems.map(i => ({ id: i.id, description: i.description, amount: i.amount, costCategory: i.costCategory || '' }))
        : [{ id: crypto.randomUUID(), description: '', amount: 0, costCategory: '' }],
    });
    setEditingVoucher(voucher);
    setShowCreateModal(true);
  };

  const addFormItem = () => {
    setForm(p => ({ ...p, items: [...p.items, { id: crypto.randomUUID(), description: '', amount: 0, costCategory: '' }] }));
  };

  const removeFormItem = (idx: number) => {
    if (form.items.length <= 1) return;
    setForm(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));
  };

  const updateFormItem = (idx: number, field: string, value: any) => {
    setForm(p => ({
      ...p,
      items: p.items.map((item, i) => i === idx ? { ...item, [field]: value } : item)
    }));
  };

  const formTotal = useMemo(() => form.items.reduce((s, i) => s + Number(i.amount || 0), 0), [form.items]);

  const handleSave = () => {
    if (!form.fundId) { toast.error('Lỗi', 'Vui lòng chọn quỹ'); return; }
    if (!form.reason.trim()) { toast.error('Lỗi', 'Vui lòng nhập lý do'); return; }
    if (formTotal <= 0) { toast.error('Lỗi', 'Tổng số tiền phải lớn hơn 0'); return; }

    const voucherItems: CashVoucherItem[] = form.items.filter(i => i.amount > 0).map(i => ({
      id: i.id || crypto.randomUUID(),
      voucherId: editingVoucher?.id || '',
      description: i.description,
      amount: Number(i.amount),
      costCategory: i.costCategory || undefined,
    }));

    if (editingVoucher) {
      const updated: CashVoucher = {
        ...editingVoucher,
        fundId: form.fundId,
        date: new Date(form.date).toISOString(),
        amount: formTotal,
        contactName: form.contactName || undefined,
        contactType: (form.contactType as CashContactType) || undefined,
        contactId: form.contactId || undefined,
        reason: form.reason,
        note: form.note || undefined,
      };
      voucherItems.forEach(i => i.voucherId = updated.id);
      updateCashVoucher(updated, voucherItems);
      toast.success('Cập nhật thành công', `${CASH_VOUCHER_TYPE_LABELS[editingVoucher.type]} ${editingVoucher.code} đã cập nhật`);
    } else {
      const newId = crypto.randomUUID();
      const newVoucher: CashVoucher = {
        id: newId,
        code: getNextCode(createType),
        type: createType,
        fundId: form.fundId,
        date: new Date(form.date).toISOString(),
        amount: formTotal,
        contactName: form.contactName || undefined,
        contactType: (form.contactType as CashContactType) || undefined,
        contactId: form.contactId || undefined,
        reason: form.reason,
        status: 'draft',
        note: form.note || undefined,
        createdBy: user.id,
        createdAt: new Date().toISOString(),
      };
      voucherItems.forEach(i => i.voucherId = newId);
      addCashVoucher(newVoucher, voucherItems);
      toast.success('Tạo thành công', `${CASH_VOUCHER_TYPE_LABELS[createType]} ${newVoucher.code} đã được tạo`);
    }
    setShowCreateModal(false);
  };

  const handleApprove = (id: string) => {
    approveCashVoucher(id, user.id);
    toast.success('Đã duyệt', 'Phiếu đã được phê duyệt');
    if (detailVoucher?.id === id) setDetailVoucher(prev => prev ? { ...prev, status: 'approved', approvedBy: user.id, approvedAt: new Date().toISOString() } : null);
  };

  const handleCancel = (id: string) => {
    cancelCashVoucher(id);
    toast.info('Đã hủy', 'Phiếu đã bị hủy');
    if (detailVoucher?.id === id) setDetailVoucher(prev => prev ? { ...prev, status: 'cancelled' } : null);
  };

  const handleDelete = (id: string) => {
    removeCashVoucher(id);
    setDeleteConfirm(null);
    toast.success('Đã xóa', 'Phiếu đã được xóa');
  };

  const tabCounts = useMemo(() => ({
    all: cashVouchers.length,
    receipt: cashVouchers.filter(v => v.type === 'receipt').length,
    payment: cashVouchers.filter(v => v.type === 'payment').length,
  }), [cashVouchers]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-5">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <FileText className="text-cyan-500" size={24} /> Phiếu thu / Phiếu chi
          </h1>
          <p className="text-sm text-slate-400 mt-1">Quản lý chứng từ thu chi tiền mặt</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => openCreate('receipt')} className="flex items-center px-5 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl hover:shadow-lg transition text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20">
            <ArrowDownCircle className="w-4 h-4 mr-2" /> Phiếu thu
          </button>
          <button onClick={() => openCreate('payment')} className="flex items-center px-5 py-2 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-xl hover:shadow-lg transition text-[10px] font-black uppercase tracking-widest shadow-lg shadow-red-500/20">
            <ArrowUpCircle className="w-4 h-4 mr-2" /> Phiếu chi
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
        {(['all', 'receipt', 'payment'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${activeTab === tab
              ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
            }`}>
            {tab === 'all' ? 'Tất cả' : CASH_VOUCHER_TYPE_LABELS[tab]}
            <span className="ml-1.5 bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-full text-[9px]">{tabCounts[tab]}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input type="text" placeholder="Tìm theo mã phiếu, lý do, người nộp..."
            className="w-full pl-10 pr-4 py-3 text-sm border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-cyan-500 font-medium bg-slate-50/50 dark:bg-slate-800"
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-4 py-3 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/50 dark:bg-slate-800 font-bold uppercase tracking-tighter">
          <option value="all">Tất cả trạng thái</option>
          {Object.entries(CASH_VOUCHER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterFund} onChange={e => setFilterFund(e.target.value)}
          className="px-4 py-3 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/50 dark:bg-slate-800 font-bold uppercase tracking-tighter">
          <option value="all">Tất cả quỹ</option>
          {cashFunds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      {/* Summary bar */}
      <div className="flex items-center justify-between bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-950/20 dark:to-blue-950/20 p-3 rounded-xl border border-cyan-100 dark:border-cyan-900/30">
        <span className="text-xs text-slate-500 font-bold">{filteredVouchers.length} phiếu</span>
        <span className="text-sm font-black text-slate-800 dark:text-white">Tổng: {formatMoney(totalAmount)}</span>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
        {/* Desktop */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700 text-slate-500 text-[10px] uppercase font-black tracking-widest">
                <th className="p-4">Mã phiếu</th>
                <th className="p-4">Ngày</th>
                <th className="p-4">Người nộp/nhận</th>
                <th className="p-4">Lý do</th>
                <th className="p-4 text-right">Số tiền</th>
                <th className="p-4 text-center">Trạng thái</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {filteredVouchers.length === 0 ? (
                <tr><td colSpan={7} className="p-12 text-center text-slate-400 italic">Không có phiếu nào</td></tr>
              ) : (
                filteredVouchers.map(v => {
                  const StatusIcon = getStatusIcon(v.status);
                  return (
                    <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1.5 font-mono text-xs font-bold ${v.type === 'receipt' ? 'text-emerald-600' : 'text-red-500'}`}>
                          {v.type === 'receipt' ? <ArrowDownCircle size={14} /> : <ArrowUpCircle size={14} />}
                          {v.code}
                        </span>
                      </td>
                      <td className="p-4 text-slate-500 font-medium text-xs">{new Date(v.date).toLocaleDateString('vi-VN')}</td>
                      <td className="p-4 text-slate-700 dark:text-slate-300 font-medium text-xs">{v.contactName || <span className="text-slate-300 italic">—</span>}</td>
                      <td className="p-4 font-medium text-slate-700 dark:text-slate-300 max-w-[200px] truncate cursor-pointer hover:text-cyan-500" onClick={() => setDetailVoucher(v)}>
                        {v.reason}
                      </td>
                      <td className={`p-4 text-right font-black ${v.type === 'receipt' ? 'text-emerald-600' : 'text-red-500'}`}>
                        {v.type === 'receipt' ? '+' : '-'}{formatMoney(v.amount)}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black uppercase border ${getStatusColor(v.status)}`}>
                          <StatusIcon size={10} /> {CASH_VOUCHER_STATUS_LABELS[v.status]}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setDetailVoucher(v)} className="p-2 text-slate-300 hover:text-cyan-600 transition-colors" title="Xem chi tiết"><Eye size={14} /></button>
                          {v.status === 'draft' && (
                            <>
                              <button onClick={() => openEdit(v)} className="p-2 text-slate-300 hover:text-blue-600 transition-colors" title="Sửa"><Edit3 size={14} /></button>
                              {(user.role === Role.ADMIN || user.role === Role.ACCOUNTANT) && (
                                <button onClick={() => handleApprove(v.id)} className="p-2 text-slate-300 hover:text-emerald-600 transition-colors" title="Duyệt"><Check size={14} /></button>
                              )}
                            </>
                          )}
                          {v.status === 'draft' && (
                            deleteConfirm === v.id ? (
                              <div className="flex gap-1">
                                <button onClick={() => handleDelete(v.id)} className="p-1.5 bg-red-500 text-white rounded-lg text-[9px] font-bold">Xóa</button>
                                <button onClick={() => setDeleteConfirm(null)} className="p-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg text-[9px] font-bold">Hủy</button>
                              </div>
                            ) : (
                              <button onClick={() => setDeleteConfirm(v.id)} className="p-2 text-slate-300 hover:text-red-600 transition-colors" title="Xóa"><Trash2 size={14} /></button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {filteredVouchers.length === 0 ? (
            <div className="p-12 text-center text-slate-400 italic">Không có phiếu nào</div>
          ) : (
            filteredVouchers.map(v => {
              const StatusIcon = getStatusIcon(v.status);
              return (
                <div key={v.id} className="p-4 space-y-2" onClick={() => setDetailVoucher(v)}>
                  <div className="flex justify-between items-start">
                    <span className={`inline-flex items-center gap-1 font-mono text-xs font-bold ${v.type === 'receipt' ? 'text-emerald-600' : 'text-red-500'}`}>
                      {v.type === 'receipt' ? <ArrowDownCircle size={13} /> : <ArrowUpCircle size={13} />}
                      {v.code}
                    </span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black uppercase border ${getStatusColor(v.status)}`}>
                      <StatusIcon size={10} /> {CASH_VOUCHER_STATUS_LABELS[v.status]}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 truncate">{v.reason}</p>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-400">{new Date(v.date).toLocaleDateString('vi-VN')} • {v.contactName || '—'}</span>
                    <span className={`font-black text-sm ${v.type === 'receipt' ? 'text-emerald-600' : 'text-red-500'}`}>
                      {v.type === 'receipt' ? '+' : '-'}{formatMoney(v.amount)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ============ CREATE / EDIT MODAL ============ */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className={`p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between ${createType === 'receipt' ? 'bg-gradient-to-r from-emerald-50 to-emerald-100/50 dark:from-emerald-950/20 dark:to-emerald-900/10' : 'bg-gradient-to-r from-red-50 to-rose-100/50 dark:from-red-950/20 dark:to-rose-900/10'}`}>
              <div className="flex items-center gap-3">
                {createType === 'receipt' ? <ArrowDownCircle size={20} className="text-emerald-500" /> : <ArrowUpCircle size={20} className="text-red-500" />}
                <h3 className="text-lg font-black text-slate-800 dark:text-white">
                  {editingVoucher ? `Sửa ${CASH_VOUCHER_TYPE_LABELS[createType]}` : `Tạo ${CASH_VOUCHER_TYPE_LABELS[createType]}`}
                </h3>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Fund + Date */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Quỹ *</label>
                  <select value={form.fundId} onChange={e => setForm(p => ({ ...p, fundId: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-cyan-500">
                    <option value="">Chọn quỹ</option>
                    {cashFunds.filter(f => f.isActive).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Ngày</label>
                  <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-cyan-500" />
                </div>
              </div>

              {/* Contact */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">{createType === 'receipt' ? 'Người nộp' : 'Người nhận'}</label>
                  <input value={form.contactName} onChange={e => setForm(p => ({ ...p, contactName: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder="Họ tên..." />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Đối tượng</label>
                  <select value={form.contactType} onChange={e => setForm(p => ({ ...p, contactType: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-cyan-500">
                    <option value="">Không chọn</option>
                    {Object.entries(CASH_CONTACT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Lý do {createType === 'receipt' ? 'thu' : 'chi'} *</label>
                <input value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder={createType === 'receipt' ? 'VD: Thu tiền bán hàng...' : 'VD: Chi mua vật tư...'} />
              </div>

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase">Chi tiết khoản mục</label>
                  <button onClick={addFormItem} className="text-[10px] font-bold text-cyan-500 hover:text-cyan-600 flex items-center gap-1">
                    <Plus size={12} /> Thêm dòng
                  </button>
                </div>
                <div className="space-y-2">
                  {form.items.map((item, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <input value={item.description} onChange={e => updateFormItem(idx, 'description', e.target.value)}
                        className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-cyan-500"
                        placeholder="Diễn giải..." />
                      <input type="number" value={item.amount || ''} onChange={e => updateFormItem(idx, 'amount', Number(e.target.value))}
                        className="w-32 px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-black text-right outline-none focus:ring-2 focus:ring-cyan-500"
                        placeholder="Số tiền" />
                      {form.items.length > 1 && (
                        <button onClick={() => removeFormItem(idx)} className="p-2 text-slate-300 hover:text-red-500 transition-colors shrink-0">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className={`mt-3 p-3 rounded-xl border text-right ${createType === 'receipt' ? 'bg-emerald-50 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-800' : 'bg-red-50 border-red-100 dark:bg-red-950/20 dark:border-red-800'}`}>
                  <span className="text-[10px] text-slate-500 font-bold uppercase mr-2">Tổng cộng:</span>
                  <span className={`text-lg font-black ${createType === 'receipt' ? 'text-emerald-600' : 'text-red-500'}`}>{formatMoney(formTotal)}</span>
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Ghi chú</label>
                <textarea value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} rows={2}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-cyan-500 resize-none" />
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
              <button onClick={() => setShowCreateModal(false)} className="px-6 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm">Hủy</button>
              <button onClick={handleSave} className={`px-6 py-2.5 rounded-xl text-white font-bold text-sm shadow-lg transition-all ${createType === 'receipt' ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-emerald-500/20 hover:shadow-xl' : 'bg-gradient-to-r from-red-500 to-rose-600 shadow-red-500/20 hover:shadow-xl'}`}>
                {editingVoucher ? 'Cập nhật' : createType === 'receipt' ? 'Tạo phiếu thu' : 'Tạo phiếu chi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ DETAIL MODAL ============ */}
      {detailVoucher && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setDetailVoucher(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className={`p-6 border-b border-slate-100 dark:border-slate-800 ${detailVoucher.type === 'receipt' ? 'bg-gradient-to-r from-emerald-50 to-emerald-100/50 dark:from-emerald-950/20 dark:to-emerald-900/10' : 'bg-gradient-to-r from-red-50 to-rose-100/50 dark:from-red-950/20 dark:to-rose-900/10'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono text-slate-400 font-bold">{detailVoucher.code}</span>
                  <h3 className="text-lg font-black text-slate-800 dark:text-white">{CASH_VOUCHER_TYPE_LABELS[detailVoucher.type]}</h3>
                </div>
                <button onClick={() => setDetailVoucher(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
            </div>
            {/* Body */}
            <div className="p-6 space-y-4">
              {(() => {
                const StatusIcon = getStatusIcon(detailVoucher.status);
                const vItems = cashVoucherItems.filter(i => i.voucherId === detailVoucher.id);
                return (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-black uppercase border ${getStatusColor(detailVoucher.status)}`}>
                        <StatusIcon size={12} /> {CASH_VOUCHER_STATUS_LABELS[detailVoucher.status]}
                      </span>
                      <span className="text-xs text-slate-400 bg-slate-50 dark:bg-slate-800 px-3 py-1 rounded-lg font-bold">{getFundName(detailVoucher.fundId)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                        <p className="text-[9px] text-slate-400 font-bold uppercase">Ngày</p>
                        <p className="text-sm font-bold text-slate-800 dark:text-white">{new Date(detailVoucher.date).toLocaleDateString('vi-VN')}</p>
                      </div>
                      <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                        <p className="text-[9px] text-slate-400 font-bold uppercase">{detailVoucher.type === 'receipt' ? 'Người nộp' : 'Người nhận'}</p>
                        <p className="text-sm font-bold text-slate-800 dark:text-white">{detailVoucher.contactName || '—'}</p>
                      </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                      <p className="text-[9px] text-slate-400 font-bold uppercase">Lý do</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-white">{detailVoucher.reason}</p>
                    </div>
                    {/* Amount */}
                    <div className={`p-4 rounded-xl border ${detailVoucher.type === 'receipt' ? 'bg-emerald-50 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-800' : 'bg-red-50 border-red-100 dark:bg-red-950/20 dark:border-red-800'}`}>
                      <p className={`text-[10px] font-black uppercase mb-1 ${detailVoucher.type === 'receipt' ? 'text-emerald-500' : 'text-red-500'}`}>Số tiền</p>
                      <p className={`text-2xl font-black ${detailVoucher.type === 'receipt' ? 'text-emerald-600' : 'text-red-500'}`}>{formatMoney(detailVoucher.amount)}</p>
                    </div>
                    {/* Items */}
                    {vItems.length > 0 && (
                      <div>
                        <p className="text-[10px] text-slate-400 font-black uppercase mb-2">Chi tiết khoản mục</p>
                        <div className="space-y-1">
                          {vItems.map(item => (
                            <div key={item.id} className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 p-2.5 rounded-lg text-sm">
                              <span className="text-slate-600 dark:text-slate-300">{item.description || '—'}</span>
                              <span className="font-black text-slate-800 dark:text-white">{formatMoney(item.amount)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Meta */}
                    <div className="text-[10px] text-slate-400 space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <p>Người tạo: <span className="font-bold text-slate-500">{getUserName(detailVoucher.createdBy)}</span></p>
                      {detailVoucher.approvedBy && <p>Người duyệt: <span className="font-bold text-slate-500">{getUserName(detailVoucher.approvedBy)}</span></p>}
                      {detailVoucher.note && <p>Ghi chú: <span className="font-bold text-slate-500">{detailVoucher.note}</span></p>}
                    </div>
                  </>
                );
              })()}
            </div>
            {/* Actions */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-between">
              <div>
                {detailVoucher.status === 'draft' && (
                  <button onClick={() => { setDetailVoucher(null); openEdit(detailVoucher); }}
                    className="px-4 py-2 rounded-xl bg-blue-500 text-white font-bold text-xs hover:bg-blue-600 transition-colors flex items-center gap-2">
                    <Edit3 size={13} /> Chỉnh sửa
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                {detailVoucher.status === 'draft' && (user.role === Role.ADMIN || user.role === Role.ACCOUNTANT) && (
                  <>
                    <button onClick={() => handleCancel(detailVoucher.id)}
                      className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 font-bold text-xs hover:bg-slate-50 dark:hover:bg-slate-800">
                      <Ban size={13} className="mr-1 inline" /> Hủy phiếu
                    </button>
                    <button onClick={() => handleApprove(detailVoucher.id)}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-xs shadow-lg shadow-emerald-500/20">
                      <Check size={13} className="mr-1 inline" /> Duyệt phiếu
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CashVouchers;
