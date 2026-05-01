import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X, DollarSign } from 'lucide-react';
import { AdvancePayment, ContractItemType } from '../../types';
import { advancePaymentService } from '../../lib/advancePaymentService';
import { useToast } from '../../context/ToastContext';

interface Props {
  contractId: string;
  contractType: ContractItemType;
  constructionSiteId: string;
}

const fmt = (n: number) => n.toLocaleString('vi-VN') + ' đ';

const AdvancePaymentPanel: React.FC<Props> = ({ contractId, contractType, constructionSiteId }) => {
  const toast = useToast();
  const [items, setItems] = useState<AdvancePayment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [recoveryPercent, setRecoveryPercent] = useState('30');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setItems(await advancePaymentService.listByContract(contractId, contractType));
  }, [contractId, contractType]);

  useEffect(() => { load().catch(console.error); }, [load]);

  const summary = useMemo(() => ({
    amount: items.filter(i => i.status !== 'cancelled').reduce((s, i) => s + i.amount, 0),
    recovered: items.reduce((s, i) => s + i.recoveredAmount, 0),
    remaining: items.filter(i => i.status === 'active').reduce((s, i) => s + i.remainingAmount, 0),
  }), [items]);

  const handleCreate = async () => {
    if (!Number(amount)) return;
    await advancePaymentService.create({
      contractId,
      contractType,
      constructionSiteId,
      amount: Number(amount),
      date,
      recoveryPercent: Number(recoveryPercent) || 0,
      note,
    });
    setAmount('');
    setRecoveryPercent('30');
    setNote('');
    setShowForm(false);
    await load();
    toast.success('Đã thêm tạm ứng');
  };

  return (
    <div className="space-y-3 mt-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <div className="text-[9px] font-bold uppercase text-slate-400">Tạm ứng</div>
          <div className="text-sm font-black text-amber-600">{fmt(summary.amount)}</div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <div className="text-[9px] font-bold uppercase text-slate-400">Đã thu hồi</div>
          <div className="text-sm font-black text-emerald-600">{fmt(summary.recovered)}</div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <div className="text-[9px] font-bold uppercase text-slate-400">Còn lại</div>
          <div className="text-sm font-black text-red-500">{fmt(summary.remaining)}</div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex items-center justify-between">
          <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5"><DollarSign size={13} className="text-amber-500" /> Tạm ứng hợp đồng</h4>
          <button onClick={() => setShowForm(!showForm)} className="text-[10px] font-bold text-amber-600 flex items-center gap-1"><Plus size={10} /> Thêm</button>
        </div>
        {showForm && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 p-3 bg-amber-50/60 border-b border-amber-100">
            <input type="number" placeholder="Số tiền" value={amount} onChange={e => setAmount(e.target.value)} className="px-2 py-1.5 rounded-lg border border-amber-200 text-xs" />
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="px-2 py-1.5 rounded-lg border border-amber-200 text-xs" />
            <input type="number" placeholder="% thu hồi" value={recoveryPercent} onChange={e => setRecoveryPercent(e.target.value)} className="px-2 py-1.5 rounded-lg border border-amber-200 text-xs" />
            <input placeholder="Ghi chú" value={note} onChange={e => setNote(e.target.value)} className="px-2 py-1.5 rounded-lg border border-amber-200 text-xs" />
            <div className="flex gap-1">
              <button onClick={handleCreate} className="flex-1 px-2 py-1.5 rounded-lg bg-amber-500 text-white text-[10px] font-bold">Lưu</button>
              <button onClick={() => setShowForm(false)} className="px-2 py-1.5 rounded-lg text-slate-500 hover:bg-white"><X size={12} /></button>
            </div>
          </div>
        )}
        <div className="divide-y divide-slate-50">
          {items.map(item => (
            <div key={item.id} className="px-3 py-2 flex items-center justify-between text-xs">
              <div>
                <div className="font-bold text-slate-700">{fmt(item.amount)}</div>
                <div className="text-[10px] text-slate-400">{new Date(item.date).toLocaleDateString('vi-VN')} • Thu hồi {item.recoveryPercent}%</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold text-emerald-600">Đã thu {fmt(item.recoveredAmount)}</div>
                <div className="text-[10px] font-bold text-red-500">Còn {fmt(item.remainingAmount)}</div>
              </div>
            </div>
          ))}
          {items.length === 0 && <div className="p-6 text-center text-xs font-bold text-slate-400">Chưa có tạm ứng</div>}
        </div>
      </div>
    </div>
  );
};

export default AdvancePaymentPanel;
