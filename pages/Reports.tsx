
import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  FileText, Download, Calendar, Filter,
  ArrowDownLeft, ArrowUpRight, RotateCcw,
  Search, Building, Package, PieChart, Printer
} from 'lucide-react';
import { TransactionType, TransactionStatus, Role } from '../types';
import * as XLSX from 'xlsx';

const Reports: React.FC = () => {
  const { items, transactions, warehouses, user, appSettings } = useApp();

  const isAdmin = user.role === Role.ADMIN;
  const isAccountant = user.role === Role.ACCOUNTANT;
  const isKeeper = user.role === Role.KEEPER;
  const assignedWarehouse = warehouses.find(w => w.id === user.assignedWarehouseId);

  // State filter
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1); // Mặc định từ đầu tháng
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  // Thủ kho: chỉ xem được kho mình, không cho đổi
  const [selectedWh, setSelectedWh] = useState(user.assignedWarehouseId || 'ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Logic tính toán báo cáo
  const reportData = useMemo(() => {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    return items
      .filter(item => {
        // Thủ kho chỉ thấy vật tư có trong kho mình
        if (isKeeper && user.assignedWarehouseId) {
          return user.assignedWarehouseId in item.stockByWarehouse;
        }
        return true;
      })
      .map(item => {
        let openingBalance = 0;
        let inImport = 0;
        let inTransfer = 0;
        let inAdjustment = 0;
        let outExport = 0;
        let outTransfer = 0;
        let outLiquidation = 0;

        // Duyệt qua tất cả giao dịch của vật tư này
        transactions.forEach(tx => {
          if (tx.status !== TransactionStatus.COMPLETED) return;

          const txDate = new Date(tx.date);
          const txItem = tx.items.find(i => i.itemId === item.id);
          if (!txItem) return;

          const qty = txItem.quantity;

          // Kiểm tra xem giao dịch có thuộc kho đang lọc không
          const isRelatedToWh = selectedWh === 'ALL' ||
            tx.targetWarehouseId === selectedWh ||
            tx.sourceWarehouseId === selectedWh;

          if (!isRelatedToWh) return;

          // Logic tính toán
          if (txDate < start) {
            // Tính tồn đầu kỳ: Cộng dồn mọi biến động TRƯỜC ngày bắt đầu
            if (tx.type === TransactionType.IMPORT && (selectedWh === 'ALL' || tx.targetWarehouseId === selectedWh)) {
              openingBalance += qty;
            } else if (tx.type === TransactionType.EXPORT && (selectedWh === 'ALL' || tx.sourceWarehouseId === selectedWh)) {
              openingBalance -= qty;
            } else if (tx.type === TransactionType.TRANSFER) {
              if (selectedWh !== 'ALL') {
                if (tx.targetWarehouseId === selectedWh) openingBalance += qty;
                if (tx.sourceWarehouseId === selectedWh) openingBalance -= qty;
              }
              // Nếu ALL, Transfer không làm thay đổi tổng tồn hệ thống
            } else if (tx.type === TransactionType.ADJUSTMENT) {
              // Giả định Adjustment trong db demo là nhập (+), bạn có thể tùy biến
              if (tx.targetWarehouseId === selectedWh || selectedWh === 'ALL') openingBalance += qty;
            }
          } else if (txDate >= start && txDate <= end) {
            // Tính phát sinh TRONG kỳ
            if (tx.type === TransactionType.IMPORT && (selectedWh === 'ALL' || tx.targetWarehouseId === selectedWh)) {
              inImport += qty;
            } else if (tx.type === TransactionType.EXPORT && (selectedWh === 'ALL' || tx.sourceWarehouseId === selectedWh)) {
              outExport += qty;
            } else if (tx.type === TransactionType.TRANSFER) {
              if (selectedWh === 'ALL') {
                // ALL thì Transfer nội bộ không tính vào Nhập/Xuất hệ thống
              } else {
                if (tx.targetWarehouseId === selectedWh) inTransfer += qty;
                if (tx.sourceWarehouseId === selectedWh) outTransfer += qty;
              }
            } else if (tx.type === TransactionType.ADJUSTMENT) {
              inAdjustment += qty;
            }
          }
        });

        const totalIn = inImport + inTransfer + inAdjustment;
        const totalOut = outExport + outTransfer + outLiquidation;
        const closingBalance = openingBalance + totalIn - totalOut;

        return {
          id: item.id,
          sku: item.sku,
          name: item.name,
          unit: item.unit,
          opening: openingBalance,
          inImport,
          inTransfer,
          inAdjustment,
          totalIn,
          outExport,
          outTransfer,
          outLiquidation,
          totalOut,
          closing: closingBalance,
          value: closingBalance * item.priceIn
        };
      }).filter(row =>
        row.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        row.sku.toLowerCase().includes(searchTerm.toLowerCase())
      );
  }, [items, transactions, startDate, endDate, selectedWh, searchTerm]);

  // Tổng hợp số liệu thẻ
  const summary = useMemo(() => {
    return reportData.reduce((acc, row) => ({
      totalValue: acc.totalValue + row.value,
      totalIn: acc.totalIn + row.totalIn,
      totalOut: acc.totalOut + row.totalOut
    }), { totalValue: 0, totalIn: 0, totalOut: 0 });
  }, [reportData]);

  const handleExportExcel = () => {
    const data = reportData.map(r => ({
      'Mã SKU': r.sku,
      'Tên vật tư': r.name,
      'ĐVT': r.unit,
      'Tồn đầu kỳ': r.opening,
      'Nhập mua': r.inImport,
      'Nhập chuyển kho': r.inTransfer,
      'Nhập khác': r.inAdjustment,
      'Tổng Nhập': r.totalIn,
      'Xuất bán/CT': r.outExport,
      'Xuất chuyển kho': r.outTransfer,
      'Tổng Xuất': r.totalOut,
      'Tồn cuối kỳ': r.closing,
      'Giá trị tồn (đ)': r.value
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Báo cáo XNT");
    XLSX.writeFile(wb, `BaoCao_XNT_${startDate}_to_${endDate}.xlsx`);
  };



  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Báo cáo Xuất - Nhập - Tồn</h1>
          <p className="text-sm text-slate-500 font-medium">Thống kê chi tiết biến động vật tư theo thời gian.</p>
          {isKeeper && assignedWarehouse && (
            <div className="flex items-center gap-2 mt-2 bg-blue-50 text-accent px-2 py-1 rounded-lg border border-blue-100 text-[10px] font-black uppercase tracking-widest w-fit">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              Phạm vi: {assignedWarehouse.name}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center px-4 py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition shadow-lg shadow-slate-900/20 font-bold text-sm"
          >
            <Printer size={18} className="mr-2" /> In PDF
          </button>
          <button
            onClick={handleExportExcel}
            className="flex items-center px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition shadow-lg shadow-emerald-500/20 font-bold text-sm"
          >
            <Download size={18} className="mr-2" /> Xuất Excel
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-wrap gap-4 items-end">
        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
            <Calendar size={12} className="mr-1" /> Khoảng thời gian
          </label>
          <div className="flex items-center gap-2">
            <input
              type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-accent"
            />
            <span className="text-slate-400 font-bold">→</span>
            <input
              type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        <div className="space-y-1.5 w-full md:w-64">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
            <Building size={12} className="mr-1" /> Kho lưu trữ
          </label>
          <select
            disabled={isKeeper || (!isAdmin && !isAccountant)}
            value={selectedWh} onChange={e => setSelectedWh(e.target.value)}
            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
          >
            {(isAdmin || isAccountant) && <option value="ALL">Tất cả kho (Toàn công ty)</option>}
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          {isKeeper && (
            <p className="text-[10px] text-blue-500 font-bold">Bạn chỉ xem được kho được giao</p>
          )}
        </div>

        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
            <Search size={12} className="mr-1" /> Tìm vật tư
          </label>
          <input
            type="text" placeholder="Tên hoặc mã SKU..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center border border-blue-100"><PieChart size={24} /></div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase">Giá trị tồn cuối kỳ</p>
            <p className="text-lg font-black text-slate-800">{summary.totalValue.toLocaleString()} ₫</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center border border-emerald-100"><ArrowDownLeft size={24} /></div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase">Tổng nhập trong kỳ</p>
            <p className="text-lg font-black text-emerald-600">{summary.totalIn.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center border border-orange-100"><ArrowUpRight size={24} /></div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase">Tổng xuất trong kỳ</p>
            <p className="text-lg font-black text-orange-600">{summary.totalOut.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Report Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-black text-slate-400 tracking-wider">
                <th className="p-4 sticky left-0 bg-slate-50 z-10 border-r border-slate-100">Vật tư / SKU</th>
                <th className="p-4 text-right bg-blue-50/30">Tồn đầu kỳ</th>
                <th className="p-4 text-center border-x border-slate-100">Nhập Mua</th>
                <th className="p-4 text-center">Nhập Chuyển</th>
                <th className="p-4 text-center">Nhập Khác</th>
                <th className="p-4 text-right bg-emerald-50/50 font-bold text-emerald-700">Tổng Nhập</th>
                <th className="p-4 text-center border-x border-slate-100">Xuất Bán/CT</th>
                <th className="p-4 text-center">Xuất Chuyển</th>
                <th className="p-4 text-right bg-orange-50/50 font-bold text-orange-700">Tổng Xuất</th>
                <th className="p-4 text-right bg-slate-800 text-white font-bold">Tồn Cuối</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {reportData.map(row => (
                <tr key={row.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="p-4 sticky left-0 bg-white group-hover:bg-slate-50 z-10 border-r border-slate-100">
                    <div className="font-bold text-slate-800">{row.name}</div>
                    <div className="text-[10px] font-mono text-slate-400">{row.sku} • {row.unit}</div>
                  </td>
                  <td className="p-4 text-right font-bold text-slate-600 bg-blue-50/10">
                    {row.opening.toLocaleString()}
                  </td>
                  <td className="p-4 text-center text-slate-500 border-x border-slate-100">{row.inImport || '-'}</td>
                  <td className="p-4 text-center text-slate-500">{row.inTransfer || '-'}</td>
                  <td className="p-4 text-center text-slate-500">{row.inAdjustment || '-'}</td>
                  <td className="p-4 text-right font-black text-emerald-600 bg-emerald-50/20">
                    {row.totalIn.toLocaleString()}
                  </td>
                  <td className="p-4 text-center text-slate-500 border-x border-slate-100">{row.outExport || '-'}</td>
                  <td className="p-4 text-center text-slate-500">{row.outTransfer || '-'}</td>
                  <td className="p-4 text-right font-black text-orange-600 bg-orange-50/20">
                    {row.totalOut.toLocaleString()}
                  </td>
                  <td className="p-4 text-right font-black text-slate-900 bg-slate-100/30">
                    {row.closing.toLocaleString()}
                  </td>
                </tr>
              ))}
              {reportData.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-20 text-center">
                    <div className="flex flex-col items-center opacity-30">
                      <Package size={48} />
                      <p className="mt-4 font-bold">Không có dữ liệu cho khoảng thời gian này</p>
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

export default Reports;
