import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { ContractAppendix, ContractItemType, PaymentSchedule } from '../../types';
import { contractAppendixService } from '../../lib/hdService';
import { paymentService } from '../../lib/projectService';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

interface Props {
  contractId: string;
  contractType: ContractItemType;
  projectId?: string | null;
  constructionSiteId?: string | null;
  contactName?: string;
}

const fmtMoney = (value: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));

const statusLabel: Record<PaymentSchedule['status'], string> = {
  pending: 'Chờ thanh toán',
  paid: 'Đã thanh toán',
  overdue: 'Quá hạn',
};

const defaultSchedule = (
  contractId: string,
  contractType: ContractItemType,
  projectId?: string | null,
  constructionSiteId?: string | null,
  contactName?: string,
): PaymentSchedule => ({
  id: crypto.randomUUID(),
  projectId: projectId || null,
  constructionSiteId: constructionSiteId || projectId || '',
  contractId,
  contractType,
  description: '',
  amount: 0,
  dueDate: new Date().toISOString().slice(0, 10),
  status: 'pending',
  type: contractType === 'customer' ? 'receivable' : 'payable',
  contactName,
  note: '',
});

const ContractPaymentSchedulePanel: React.FC<Props> = ({ contractId, contractType, projectId, constructionSiteId, contactName }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const { loading: saving, run } = useAsyncAction({
    errorTitle: 'Không thể lưu lịch thanh toán',
    fallbackError: 'Không thể lưu lịch thanh toán lên Supabase.',
    logScope: 'contractPaymentSchedule.save',
  });
  const [items, setItems] = useState<PaymentSchedule[]>([]);
  const [appendices, setAppendices] = useState<ContractAppendix[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<PaymentSchedule | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [scheduleRows, appendixRows] = await Promise.all([
        paymentService.listByContract(contractId, contractType),
        contractAppendixService.listByContract(contractId, contractType),
      ]);
      setItems(scheduleRows);
      setAppendices(appendixRows);
    } catch (error) {
      logApiError('contractPaymentSchedule.load', error);
      toast.error('Không thể tải lịch thanh toán', getApiErrorMessage(error, 'Không thể tải lịch thanh toán của hợp đồng.'));
    } finally {
      setLoading(false);
    }
  }, [contractId, contractType, toast]);

  useEffect(() => { load(); }, [load]);

  const total = useMemo(() => items.reduce((sum, item) => sum + Number(item.amount || 0), 0), [items]);
  const paid = useMemo(() => items.reduce((sum, item) => sum + Number(item.paidAmount || (item.status === 'paid' ? item.amount : 0)), 0), [items]);

  const openCreate = () => setForm(defaultSchedule(contractId, contractType, projectId, constructionSiteId, contactName));
  const openEdit = (item: PaymentSchedule) => setForm({ ...item });

  const save = async () => {
    if (!form) return;
    if (!form.description.trim()) {
      toast.warning('Thiếu mô tả đợt thanh toán', 'Vui lòng nhập nội dung hoặc tên đợt thanh toán.');
      return;
    }
    if (!form.constructionSiteId && !form.projectId) {
      toast.warning('Thiếu liên kết dự án/công trường', 'Hợp đồng cần có dự án hoặc công trường trước khi tạo lịch thanh toán.');
      return;
    }
    await run(async () => {
      await paymentService.upsert({
        ...form,
        contractId,
        contractType,
        projectId: projectId || form.projectId || null,
        constructionSiteId: constructionSiteId || form.constructionSiteId || projectId || '',
        description: form.description.trim(),
        amount: Number(form.amount || 0),
        paidAmount: Number(form.paidAmount || 0),
      });
      setForm(null);
      await load();
    }, { successTitle: 'Đã lưu lịch thanh toán' });
  };

  const remove = async (item: PaymentSchedule) => {
    const ok = await confirm({
      title: 'Xoá lịch thanh toán',
      targetName: item.description,
      warningText: 'Đợt thanh toán này sẽ bị xoá khỏi CashFlow và workspace hợp đồng.',
    });
    if (!ok) return;
    await run(async () => {
      await paymentService.remove(item.id);
      await load();
    }, { successTitle: 'Đã xoá lịch thanh toán', errorTitle: 'Không thể xoá lịch thanh toán' });
  };

  const markPaid = async (item: PaymentSchedule) => {
    await run(async () => {
      await paymentService.upsert({
        ...item,
        status: 'paid',
        paidDate: new Date().toISOString().slice(0, 10),
        paidAmount: item.amount,
      });
      await load();
    }, { successTitle: 'Đã xác nhận thanh toán', errorTitle: 'Không thể cập nhật thanh toán' });
  };

  return (
    <div className="space-y-4 mt-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-black text-slate-700 dark:text-white flex items-center gap-1.5">
            <CalendarClock size={14} className="text-emerald-500" /> Lịch thanh toán
          </h4>
          <p className="text-[10px] text-slate-400 font-bold mt-1">Dùng chung dữ liệu với CashFlow, không tạo bảng thanh toán riêng.</p>
        </div>
        <button
          onClick={openCreate}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
        >
          <Plus size={12} /> Thêm đợt
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Metric label="Tổng kế hoạch" value={fmtMoney(total)} />
        <Metric label="Đã thanh toán" value={fmtMoney(paid)} tone="emerald" />
        <Metric label="Còn lại" value={fmtMoney(total - paid)} tone="amber" />
      </div>

      {loading ? (
        <div className="p-6 text-center text-sm text-slate-400"><Loader2 size={16} className="inline animate-spin mr-2" />Đang tải lịch thanh toán...</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs font-bold text-slate-400">
          Chưa có lịch thanh toán cho hợp đồng này
        </div>
      ) : (
        <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-400 uppercase text-[10px]">
              <tr>
                <th className="p-3 text-left">Đợt</th>
                <th className="p-3 text-center">Ngày hạn</th>
                <th className="p-3 text-right">Số tiền</th>
                <th className="p-3 text-center">Loại</th>
                <th className="p-3 text-center">Trạng thái</th>
                <th className="p-3 text-left">Phụ lục</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map(item => {
                const appendix = appendices.find(row => row.id === item.appendixId);
                return (
                  <tr key={item.id} className="hover:bg-slate-50/60">
                    <td className="p-3 font-bold text-slate-700">{item.description}</td>
                    <td className="p-3 text-center text-slate-500">{item.dueDate ? new Date(item.dueDate).toLocaleDateString('vi-VN') : '-'}</td>
                    <td className="p-3 text-right font-black text-slate-800">{fmtMoney(item.amount)}</td>
                    <td className="p-3 text-center text-slate-500">{item.type === 'receivable' ? 'Phải thu' : 'Phải trả'}</td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${item.status === 'paid' ? 'bg-emerald-50 text-emerald-600' : item.status === 'overdue' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                        {statusLabel[item.status]}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500">{appendix?.appendixNumber || '-'}</td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {item.status !== 'paid' && <button onClick={() => markPaid(item)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-emerald-600 hover:bg-emerald-50">Đã TT</button>}
                      <button onClick={() => openEdit(item)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-indigo-600 hover:bg-indigo-50">Sửa</button>
                      <button onClick={() => remove(item)} className="ml-1 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-emerald-500 uppercase">Lịch thanh toán hợp đồng</p>
                <h3 className="font-black text-slate-800">{form.description || 'Đợt thanh toán mới'}</h3>
              </div>
              <button onClick={() => setForm(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Mô tả đợt *" className="md:col-span-2" value={form.description} onChange={value => setForm({ ...form, description: value })} />
              <Field label="Ngày đến hạn" type="date" value={form.dueDate} onChange={value => setForm({ ...form, dueDate: value })} />
              <Field label="Số tiền" type="number" value={String(form.amount || 0)} onChange={value => setForm({ ...form, amount: Number(value) })} />
              <SelectField label="Loại dòng tiền" value={form.type} onChange={value => setForm({ ...form, type: value as PaymentSchedule['type'] })}>
                <option value="receivable">Phải thu</option>
                <option value="payable">Phải trả</option>
              </SelectField>
              <SelectField label="Trạng thái" value={form.status} onChange={value => setForm({ ...form, status: value as PaymentSchedule['status'] })}>
                <option value="pending">Chờ thanh toán</option>
                <option value="paid">Đã thanh toán</option>
                <option value="overdue">Quá hạn</option>
              </SelectField>
              <Field label="Đã thanh toán" type="number" value={String(form.paidAmount || 0)} onChange={value => setForm({ ...form, paidAmount: Number(value) })} />
              <Field label="Ngày thanh toán" type="date" value={form.paidDate || ''} onChange={value => setForm({ ...form, paidDate: value })} />
              <SelectField label="Phụ lục" value={form.appendixId || ''} onChange={value => setForm({ ...form, appendixId: value || undefined })}>
                <option value="">Không gắn phụ lục</option>
                {appendices.map(item => <option key={item.id} value={item.id}>{item.appendixNumber} - {item.name}</option>)}
              </SelectField>
              <Field label="Ghi chú" className="md:col-span-3" value={form.note || ''} onChange={value => setForm({ ...form, note: value })} />
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
              <button onClick={() => setForm(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl font-bold text-sm text-slate-600">Huỷ</button>
              <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu lịch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; tone?: 'slate' | 'emerald' | 'amber' }> = ({ label, value, tone = 'slate' }) => {
  const color = tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-800';
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</div>
      <div className={`text-lg font-black ${color}`}>{value}</div>
    </div>
  );
};

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  className?: string;
}> = ({ label, value, onChange, type = 'text', className = '' }) => (
  <label className={`block ${className}`}>
    <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</span>
    <input
      type={type}
      value={value}
      onChange={event => onChange(event.target.value)}
      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
    />
  </label>
);

const SelectField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}> = ({ label, value, onChange, children }) => (
  <label className="block">
    <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</span>
    <select
      value={value}
      onChange={event => onChange(event.target.value)}
      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 bg-white"
    >
      {children}
    </select>
  </label>
);

export default ContractPaymentSchedulePanel;
