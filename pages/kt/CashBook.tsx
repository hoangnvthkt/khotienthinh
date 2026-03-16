import React, { useState, useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
  BookOpen, Wallet, TrendingUp, TrendingDown, Clock,
  Calendar, Filter, Plus, ArrowUpCircle, ArrowDownCircle,
  Edit3, X, Check, ChevronLeft, ChevronRight
} from 'lucide-react';
import { CashFund, CashVoucher, CASH_VOUCHER_TYPE_LABELS, CASH_VOUCHER_STATUS_LABELS, CashVoucherStatus } from '../../types';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';

const CashBook: React.FC = () => {
  const { cashFunds, cashVouchers, cashVoucherItems, addCashFund, updateCashFund, removeCashFund } = useFinance();
  const { user } = useApp();
  const toast = useToast();

  const [selectedFundId, setSelectedFundId] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [showFundModal, setShowFundModal] = useState(false);
  const [editingFund, setEditingFund] = useState<CashFund | null>(null);
  const [fundForm, setFundForm] = useState({ name: '', currency: 'VND', openingBalance: 0, description: '' });

  // ============ Computed values ============

  const filteredVouchers = useMemo(() => {
    return cashVouchers.filter(v => {
      if (selectedFundId !== 'all' && v.fundId !== selectedFundId) return false;
      const vDate = new Date(v.date);
      const [y, m] = selectedMonth.split('-').map(Number);
      return vDate.getFullYear() === y && vDate.getMonth() + 1 === m;
    });
  }, [cashVouchers, selectedFundId, selectedMonth]);

  const approvedVouchers = useMemo(() => filteredVouchers.filter(v => v.status === 'approved'), [filteredVouchers]);

  const totalReceipts = useMemo(() => approvedVouchers.filter(v => v.type === 'receipt').reduce((s, v) => s + v.amount, 0), [approvedVouchers]);
  const totalPayments = useMemo(() => approvedVouchers.filter(v => v.type === 'payment').reduce((s, v) => s + v.amount, 0), [approvedVouchers]);
  const pendingCount = useMemo(() => filteredVouchers.filter(v => v.status === 'draft').length, [filteredVouchers]);

  const currentBalance = useMemo(() => {
    const funds = selectedFundId === 'all' ? cashFunds : cashFunds.filter(f => f.id === selectedFundId);
    const opening = funds.reduce((s, f) => s + f.openingBalance, 0);
    // All approved vouchers (not just current month)
    const allApproved = cashVouchers.filter(v => {
      if (selectedFundId !== 'all' && v.fundId !== selectedFundId) return false;
      return v.status === 'approved';
    });
    const totalIn = allApproved.filter(v => v.type === 'receipt').reduce((s, v) => s + v.amount, 0);
    const totalOut = allApproved.filter(v => v.type === 'payment').reduce((s, v) => s + v.amount, 0);
    return opening + totalIn - totalOut;
  }, [cashFunds, cashVouchers, selectedFundId]);

  // Build daily cashbook entries
  const cashBookEntries = useMemo(() => {
    const sorted = [...approvedVouchers].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let runningBalance = currentBalance - totalReceipts + totalPayments; // Start of month balance
    return sorted.map(v => {
      const receipt = v.type === 'receipt' ? v.amount : 0;
      const payment = v.type === 'payment' ? v.amount : 0;
      runningBalance += receipt - payment;
      return { ...v, receipt, payment, balance: runningBalance };
    });
  }, [approvedVouchers, currentBalance, totalReceipts, totalPayments]);

  // Chart data: daily aggregation
  const chartData = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const dailyMap: Record<string, { day: string; thu: number; chi: number }> = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const key = String(d).padStart(2, '0');
      dailyMap[key] = { day: `${key}/${String(m).padStart(2, '0')}`, thu: 0, chi: 0 };
    }
    approvedVouchers.forEach(v => {
      const day = String(new Date(v.date).getDate()).padStart(2, '0');
      if (dailyMap[day]) {
        if (v.type === 'receipt') dailyMap[day].thu += v.amount;
        else dailyMap[day].chi += v.amount;
      }
    });
    return Object.values(dailyMap);
  }, [approvedVouchers, selectedMonth]);

  // Month navigation
  const navMonth = (dir: -1 | 1) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const monthLabel = (() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    return `Tháng ${m}/${y}`;
  })();

  // ============ Fund CRUD ============
  const openAddFund = () => {
    setFundForm({ name: '', currency: 'VND', openingBalance: 0, description: '' });
    setEditingFund(null);
    setShowFundModal(true);
  };

  const openEditFund = (fund: CashFund) => {
    setFundForm({ name: fund.name, currency: fund.currency, openingBalance: fund.openingBalance, description: fund.description || '' });
    setEditingFund(fund);
    setShowFundModal(true);
  };

  const handleSaveFund = () => {
    if (!fundForm.name.trim()) { toast.error('Lỗi', 'Vui lòng nhập tên quỹ'); return; }
    if (editingFund) {
      updateCashFund({ ...editingFund, ...fundForm, openingBalance: Number(fundForm.openingBalance) });
      toast.success('Cập nhật thành công', `Quỹ "${fundForm.name}" đã được cập nhật`);
    } else {
      addCashFund({
        id: crypto.randomUUID(),
        ...fundForm,
        openingBalance: Number(fundForm.openingBalance),
        isActive: true,
        createdAt: new Date().toISOString(),
      });
      toast.success('Tạo quỹ thành công', `Quỹ "${fundForm.name}" đã được tạo`);
    }
    setShowFundModal(false);
  };

  const formatMoney = (n: number) => n.toLocaleString('vi-VN') + 'đ';
  const formatMoneyShort = (n: number) => {
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'tr';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'k';
    return formatMoney(n);
  };

  const getStatusColor = (status: CashVoucherStatus) => {
    switch (status) {
      case 'approved': return 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800';
      case 'draft': return 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800';
      case 'cancelled': return 'bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-5">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <BookOpen className="text-cyan-500" size={24} /> Sổ quỹ tiền mặt
          </h1>
          <p className="text-sm text-slate-400 mt-1">Theo dõi thu/chi và số dư quỹ tiền mặt</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={openAddFund} className="flex items-center px-4 py-2 bg-slate-800 dark:bg-slate-700 text-white rounded-xl hover:bg-slate-700 transition text-[10px] font-black uppercase tracking-widest">
            <Plus className="w-4 h-4 mr-2" /> Thêm quỹ
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-4 items-center">
        <div className="flex items-center gap-2">
          <Wallet size={16} className="text-cyan-500" />
          <select value={selectedFundId} onChange={e => setSelectedFundId(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-cyan-500">
            <option value="all">Tất cả quỹ</option>
            {cashFunds.filter(f => f.isActive).map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => navMonth(-1)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition">
            <ChevronLeft size={18} />
          </button>
          <div className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-xl text-sm font-black min-w-[140px] text-center">
            {monthLabel}
          </div>
          <button onClick={() => navMonth(1)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition">
            <ChevronRight size={18} />
          </button>
        </div>
        {cashFunds.length > 0 && selectedFundId !== 'all' && (
          <button onClick={() => openEditFund(cashFunds.find(f => f.id === selectedFundId)!)}
            className="ml-auto p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition" title="Sửa quỹ">
            <Edit3 size={16} />
          </button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-950/30 flex items-center justify-center"><Wallet size={18} className="text-cyan-500" /></div>
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase">Số dư hiện tại</p>
              <p className="text-xl font-black text-slate-800 dark:text-white">{formatMoneyShort(currentBalance)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center"><TrendingUp size={18} className="text-emerald-500" /></div>
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase">Thu trong kỳ</p>
              <p className="text-xl font-black text-emerald-600">{formatMoneyShort(totalReceipts)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/30 flex items-center justify-center"><TrendingDown size={18} className="text-red-500" /></div>
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase">Chi trong kỳ</p>
              <p className="text-xl font-black text-red-600">{formatMoneyShort(totalPayments)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center"><Clock size={18} className="text-amber-500" /></div>
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase">Phiếu chờ duyệt</p>
              <p className="text-xl font-black text-amber-600">{pendingCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      {approvedVouchers.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 shadow-sm">
          <h3 className="text-sm font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-cyan-500" /> Biểu đồ dòng tiền – {monthLabel}
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v >= 1e6 ? `${(v/1e6).toFixed(0)}tr` : v >= 1e3 ? `${(v/1e3).toFixed(0)}k` : String(v)} />
              <Tooltip
                formatter={(value: number, name: string) => [formatMoney(value), name === 'thu' ? 'Thu' : 'Chi']}
                contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 12, fontWeight: 700 }}
              />
              <Legend formatter={(value: string) => value === 'thu' ? 'Thu' : 'Chi'} />
              <Bar dataKey="thu" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="chi" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Cash Book Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
            <BookOpen size={16} className="text-cyan-500" /> Sổ quỹ – {monthLabel}
          </h3>
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700 text-slate-500 text-[10px] uppercase font-black tracking-widest">
                <th className="p-4">Ngày</th>
                <th className="p-4">Mã phiếu</th>
                <th className="p-4">Diễn giải</th>
                <th className="p-4 text-right">Thu</th>
                <th className="p-4 text-right">Chi</th>
                <th className="p-4 text-right">Tồn quỹ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {cashBookEntries.length === 0 ? (
                <tr><td colSpan={6} className="p-12 text-center text-slate-400 italic">Không có giao dịch nào trong kỳ</td></tr>
              ) : (
                cashBookEntries.map(entry => (
                  <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="p-4 text-slate-500 font-medium text-xs">{new Date(entry.date).toLocaleDateString('vi-VN')}</td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1 font-mono text-xs font-bold ${entry.type === 'receipt' ? 'text-emerald-600' : 'text-red-500'}`}>
                        {entry.type === 'receipt' ? <ArrowDownCircle size={13} /> : <ArrowUpCircle size={13} />}
                        {entry.code}
                      </span>
                    </td>
                    <td className="p-4 font-medium text-slate-700 dark:text-slate-300 max-w-[250px] truncate">{entry.reason}</td>
                    <td className="p-4 text-right font-black text-emerald-600">{entry.receipt > 0 ? formatMoney(entry.receipt) : ''}</td>
                    <td className="p-4 text-right font-black text-red-500">{entry.payment > 0 ? formatMoney(entry.payment) : ''}</td>
                    <td className="p-4 text-right font-black text-slate-800 dark:text-white">{formatMoney(entry.balance)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {cashBookEntries.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 dark:bg-slate-800/80 border-t-2 border-slate-200 dark:border-slate-600 font-black text-sm">
                  <td colSpan={3} className="p-4 text-slate-500 uppercase text-[10px] tracking-widest">Tổng cộng</td>
                  <td className="p-4 text-right text-emerald-600">{formatMoney(totalReceipts)}</td>
                  <td className="p-4 text-right text-red-500">{formatMoney(totalPayments)}</td>
                  <td className="p-4 text-right text-slate-800 dark:text-white">{formatMoney(currentBalance)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {cashBookEntries.length === 0 ? (
            <div className="p-12 text-center text-slate-400 italic">Không có giao dịch nào</div>
          ) : (
            cashBookEntries.map(entry => (
              <div key={entry.id} className="p-4">
                <div className="flex justify-between items-start mb-1">
                  <span className={`inline-flex items-center gap-1 font-mono text-xs font-bold ${entry.type === 'receipt' ? 'text-emerald-600' : 'text-red-500'}`}>
                    {entry.type === 'receipt' ? <ArrowDownCircle size={13} /> : <ArrowUpCircle size={13} />}
                    {entry.code}
                  </span>
                  <span className="text-[10px] text-slate-400">{new Date(entry.date).toLocaleDateString('vi-VN')}</span>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300 truncate">{entry.reason}</p>
                <div className="flex justify-between items-center mt-2">
                  <span className={`font-black text-sm ${entry.type === 'receipt' ? 'text-emerald-600' : 'text-red-500'}`}>
                    {entry.type === 'receipt' ? '+' : '-'}{formatMoney(entry.amount)}
                  </span>
                  <span className="text-xs text-slate-400">Tồn: <span className="font-bold text-slate-700 dark:text-white">{formatMoneyShort(entry.balance)}</span></span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Fund List */}
      {cashFunds.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
              <Wallet size={16} className="text-cyan-500" /> Danh sách quỹ
            </h3>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {cashFunds.map(fund => {
              const fundVouchers = cashVouchers.filter(v => v.fundId === fund.id && v.status === 'approved');
              const totalIn = fundVouchers.filter(v => v.type === 'receipt').reduce((s, v) => s + v.amount, 0);
              const totalOut = fundVouchers.filter(v => v.type === 'payment').reduce((s, v) => s + v.amount, 0);
              const balance = fund.openingBalance + totalIn - totalOut;
              return (
                <div key={fund.id} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-black text-xs">
                      {fund.currency}
                    </div>
                    <div>
                      <p className="font-black text-slate-800 dark:text-white text-sm">{fund.name}</p>
                      <p className="text-[10px] text-slate-400">Mở: {formatMoney(fund.openingBalance)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-lg text-slate-800 dark:text-white">{formatMoneyShort(balance)}</p>
                    <div className="flex gap-2 text-[10px]">
                      <span className="text-emerald-500 font-bold">+{formatMoneyShort(totalIn)}</span>
                      <span className="text-red-500 font-bold">-{formatMoneyShort(totalOut)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {cashFunds.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 p-16 text-center">
          <Wallet size={56} className="mx-auto text-slate-200 dark:text-slate-700 mb-4" />
          <p className="text-slate-500 font-bold text-lg">Chưa có quỹ nào</p>
          <p className="text-sm text-slate-400 mt-1">Tạo quỹ tiền mặt đầu tiên để bắt đầu quản lý thu/chi</p>
          <button onClick={openAddFund} className="mt-4 px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-cyan-500/20 hover:shadow-xl transition-all">
            <Plus className="w-4 h-4 mr-2 inline" /> Tạo quỹ
          </button>
        </div>
      )}

      {/* ============ FUND MODAL ============ */}
      {showFundModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setShowFundModal(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-800 dark:text-white">{editingFund ? 'Cập nhật quỹ' : 'Tạo quỹ mới'}</h3>
              <button onClick={() => setShowFundModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Tên quỹ *</label>
                <input value={fundForm.name} onChange={e => setFundForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="VD: Quỹ tiền mặt VNĐ" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Loại tiền</label>
                  <select value={fundForm.currency} onChange={e => setFundForm(p => ({ ...p, currency: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-cyan-500">
                    <option value="VND">VND</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Số dư đầu kỳ</label>
                  <input type="number" value={fundForm.openingBalance} onChange={e => setFundForm(p => ({ ...p, openingBalance: Number(e.target.value) }))}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-black outline-none focus:ring-2 focus:ring-cyan-500" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Mô tả</label>
                <textarea value={fundForm.description} onChange={e => setFundForm(p => ({ ...p, description: e.target.value }))} rows={2}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-cyan-500 resize-none" />
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
              <button onClick={() => setShowFundModal(false)} className="px-6 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Hủy</button>
              <button onClick={handleSaveFund} className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-sm shadow-lg shadow-cyan-500/20 hover:shadow-xl transition-all">
                {editingFund ? 'Cập nhật' : 'Tạo quỹ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CashBook;
