import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import {
  FileText, Plus, Search, AlertTriangle, CheckCircle, Clock, XCircle
} from 'lucide-react';
import {
  LaborContract, LaborContractType, LaborContractStatus,
  LABOR_CONTRACT_LABELS
} from '../../types';

const STATUS_LABELS: Record<LaborContractStatus, string> = {
  active: 'Hiệu lực', expired: 'Hết hạn', terminated: 'Chấm dứt', renewed: 'Đã gia hạn',
};
const STATUS_COLORS: Record<LaborContractStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  expired: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  terminated: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  renewed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

const LaborContractPage: React.FC = () => {
  const { employees, laborContracts, addHrmItem, updateHrmItem } = useApp();
  const { theme } = useTheme();

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'Đang làm việc'), [employees]);
  const employeeMap = useMemo(() => new Map(activeEmployees.map(e => [e.id, e])), [activeEmployees]);

  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  // Form state
  const [form, setForm] = useState({
    employeeId: '', contractNumber: '', type: 'fixed_term' as LaborContractType,
    startDate: '', endDate: '', baseSalary: 0, allowancePosition: 0, allowanceOther: 0,
    signedBy: '', note: '',
  });

  const resetForm = () => {
    setForm({ employeeId: '', contractNumber: '', type: 'fixed_term', startDate: '', endDate: '', baseSalary: 0, allowancePosition: 0, allowanceOther: 0, signedBy: '', note: '' });
    setEditId(null);
  };

  // Expiring soon (< 30 days)
  const expiringSoon = useMemo(() => {
    const now = new Date();
    return laborContracts.filter(c => {
      if (c.status !== 'active' || !c.endDate) return false;
      const end = new Date(c.endDate);
      const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysLeft > 0 && daysLeft <= 30;
    });
  }, [laborContracts]);

  // Filter & sort
  const filtered = useMemo(() => {
    let list = [...laborContracts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (filterStatus) list = list.filter(c => c.status === filterStatus);
    if (searchText) {
      const q = searchText.toLowerCase();
      list = list.filter(c => {
        const emp = employeeMap.get(c.employeeId);
        return emp?.fullName.toLowerCase().includes(q) || emp?.employeeCode.toLowerCase().includes(q) || c.contractNumber.toLowerCase().includes(q);
      });
    }
    return list;
  }, [laborContracts, filterStatus, searchText, employeeMap]);

  // KPIs
  const kpis = useMemo(() => ({
    total: laborContracts.length,
    active: laborContracts.filter(c => c.status === 'active').length,
    expiring: expiringSoon.length,
    expired: laborContracts.filter(c => c.status === 'expired').length,
  }), [laborContracts, expiringSoon]);

  const handleSave = () => {
    if (!form.employeeId || !form.contractNumber || !form.startDate || form.baseSalary <= 0) return;
    if (editId) {
      updateHrmItem('hrm_labor_contracts', { ...form, id: editId, status: 'active' as LaborContractStatus });
    } else {
      addHrmItem('hrm_labor_contracts', {
        ...form, id: crypto.randomUUID(), status: 'active' as LaborContractStatus,
        createdAt: new Date().toISOString(),
      });
    }
    setShowModal(false);
    resetForm();
  };

  const handleEdit = (c: LaborContract) => {
    setForm({
      employeeId: c.employeeId, contractNumber: c.contractNumber, type: c.type,
      startDate: c.startDate, endDate: c.endDate || '', baseSalary: c.baseSalary,
      allowancePosition: c.allowancePosition || 0, allowanceOther: c.allowanceOther || 0,
      signedBy: c.signedBy || '', note: c.note || '',
    });
    setEditId(c.id);
    setShowModal(true);
  };

  const handleTerminate = (c: LaborContract) => {
    if (!confirm('Xác nhận chấm dứt hợp đồng?')) return;
    updateHrmItem('hrm_labor_contracts', { ...c, status: 'terminated' });
  };

  const fmtMoney = (v: number) => v.toLocaleString('vi-VN') + 'đ';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <FileText className="text-violet-500" size={24} /> Hợp đồng Lao động
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">Quản lý hợp đồng, gia hạn, chấm dứt</p>
        </div>
        <button onClick={() => { resetForm(); setShowModal(true); }} className="px-4 py-2.5 bg-violet-500 text-white rounded-xl text-xs font-black hover:bg-violet-600 transition flex items-center gap-1.5">
          <Plus size={16} /> Thêm HĐ
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng HĐ</p>
          <p className="text-xl font-black text-slate-800 dark:text-white">{kpis.total}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Hiệu lực</p>
          <p className="text-xl font-black text-emerald-600">{kpis.active}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Sắp hết hạn</p>
          <p className={`text-xl font-black ${kpis.expiring > 0 ? 'text-amber-500' : 'text-slate-400'}`}>{kpis.expiring}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Đã hết hạn</p>
          <p className="text-xl font-black text-red-500">{kpis.expired}</p>
        </div>
      </div>

      {/* Expiring alerts */}
      {expiringSoon.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-500" />
            <span className="text-xs font-black text-amber-700 dark:text-amber-400 uppercase">HĐ sắp hết hạn (≤ 30 ngày)</span>
          </div>
          <div className="space-y-1.5">
            {expiringSoon.map(c => {
              const emp = employeeMap.get(c.employeeId);
              const daysLeft = Math.ceil((new Date(c.endDate!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              return (
                <div key={c.id} className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-300">{emp?.fullName} ({c.contractNumber})</span>
                  <span className="font-black text-amber-600">{daysLeft} ngày</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
          <option value="">Tất cả trạng thái</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Tìm NV / Số HĐ..." value={searchText} onChange={e => setSearchText(e.target.value)}
            className="pl-8 pr-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none w-44" />
        </div>
      </div>

      {/* Contract List */}
      <div className="glass-panel rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <FileText size={48} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm font-black text-slate-400">Chưa có hợp đồng</p>
          </div>
        ) : (
          filtered.map(c => {
            const emp = employeeMap.get(c.employeeId);
            return (
              <div key={c.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-white text-xs font-black shrink-0">
                    {emp?.fullName.charAt(0) || '?'}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-black text-slate-800 dark:text-white truncate">{emp?.fullName || 'N/A'}</div>
                    <div className="text-[10px] font-mono text-slate-400">{c.contractNumber} • {LABOR_CONTRACT_LABELS[c.type]}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs flex-wrap">
                  <div>
                    <span className="text-slate-400 font-bold">Từ:</span>{' '}
                    <span className="font-black text-slate-700 dark:text-slate-300">{new Date(c.startDate).toLocaleDateString('vi-VN')}</span>
                  </div>
                  {c.endDate && (
                    <div>
                      <span className="text-slate-400 font-bold">Đến:</span>{' '}
                      <span className="font-black text-slate-700 dark:text-slate-300">{new Date(c.endDate).toLocaleDateString('vi-VN')}</span>
                    </div>
                  )}
                  <div className="font-black text-emerald-600">{fmtMoney(c.baseSalary)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${STATUS_COLORS[c.status]}`}>
                    {STATUS_LABELS[c.status]}
                  </span>
                  {c.status === 'active' && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleEdit(c)} className="p-1.5 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition" title="Sửa">
                        <FileText size={14} />
                      </button>
                      <button onClick={() => handleTerminate(c)} className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition" title="Chấm dứt">
                        <XCircle size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal Form */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-black text-slate-800 dark:text-white">{editId ? 'Cập nhật' : 'Thêm'} Hợp đồng</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Nhân viên *</label>
                <select value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
                  <option value="">Chọn NV</option>
                  {activeEmployees.map(e => <option key={e.id} value={e.id}>{e.employeeCode} - {e.fullName}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Số HĐ *</label>
                  <input type="text" value={form.contractNumber} onChange={e => setForm({ ...form, contractNumber: e.target.value })}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" placeholder="HĐ-001" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Loại HĐ</label>
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as LaborContractType })}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
                    {Object.entries(LABOR_CONTRACT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Từ ngày *</label>
                  <input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Đến ngày</label>
                  <input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Lương cơ bản *</label>
                <input type="number" value={form.baseSalary} onChange={e => setForm({ ...form, baseSalary: Number(e.target.value) })}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" placeholder="VNĐ / tháng" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">PC Chức vụ</label>
                  <input type="number" value={form.allowancePosition} onChange={e => setForm({ ...form, allowancePosition: Number(e.target.value) })}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">PC Khác</label>
                  <input type="number" value={form.allowanceOther} onChange={e => setForm({ ...form, allowanceOther: Number(e.target.value) })}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Ghi chú</label>
                <textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} rows={2}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none resize-none" />
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button onClick={() => { setShowModal(false); resetForm(); }} className="px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-700 transition">Huỷ</button>
              <button onClick={handleSave} className="px-4 py-2.5 bg-violet-500 text-white rounded-xl text-xs font-black hover:bg-violet-600 transition">
                {editId ? 'Cập nhật' : 'Tạo HĐ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LaborContractPage;
