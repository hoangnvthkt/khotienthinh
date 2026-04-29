import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, FileText, CheckCircle2, Clock, DollarSign, AlertTriangle,
  ChevronDown, ChevronRight, X, Send, Check, CreditCard,
} from 'lucide-react';
import { PaymentCertificate, PaymentCertificateStatus, ContractItemType, AdvancePayment } from '../../types';
import { paymentCertificateService, calculatePayableAmount } from '../../lib/paymentCertificateService';
import { advancePaymentService } from '../../lib/advancePaymentService';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

interface Props {
  contractId: string;
  contractType: ContractItemType;
  constructionSiteId: string;
}

const fmt = (n: number) => n.toLocaleString('vi-VN');
const fmtM = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' tỷ';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' tr';
  return fmt(n) + ' đ';
};

const STATUS_CFG: Record<PaymentCertificateStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  draft:     { label: 'Nháp',       color: 'text-slate-600',   bg: 'bg-slate-50 border-slate-200',     icon: <Clock size={11} /> },
  submitted: { label: 'Chờ duyệt',  color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-200',     icon: <Send size={11} /> },
  approved:  { label: 'Đã duyệt',   color: 'text-blue-600',    bg: 'bg-blue-50 border-blue-200',       icon: <Check size={11} /> },
  paid:      { label: 'Đã thanh toán', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <CreditCard size={11} /> },
};

const PaymentCertificatePanel: React.FC<Props> = ({ contractId, contractType, constructionSiteId }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [certs, setCerts] = useState<PaymentCertificate[]>([]);
  const [advances, setAdvances] = useState<AdvancePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingCert, setEditingCert] = useState<PaymentCertificate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, a] = await Promise.all([
        paymentCertificateService.listByContract(contractId, contractType),
        advancePaymentService.listByContract(contractId, contractType),
      ]);
      setCerts(c);
      setAdvances(a);
    } catch (e: any) { toast.error('Lỗi tải', e?.message); }
    finally { setLoading(false); }
  }, [contractId, contractType]);

  useEffect(() => { load(); }, [load]);

  // Summary
  const totalPaid = certs.filter(c => c.status === 'paid').reduce((s, c) => s + c.currentPayableAmount, 0);
  const totalApproved = certs.filter(c => c.status === 'approved' || c.status === 'paid').reduce((s, c) => s + c.currentPayableAmount, 0);
  const totalContract = certs[0]?.totalContractValue || 0;
  const advanceBalance = advances.filter(a => a.status === 'active').reduce((s, a) => s + a.remainingAmount, 0);

  const handleCreateCert = async () => {
    try {
      await paymentCertificateService.create(contractId, contractType, constructionSiteId, {});
      await load();
      toast.success('Tạo đợt thanh toán mới');
    } catch (e: any) { toast.error('Lỗi tạo đợt TT', e?.message); }
  };

  const handleStatusChange = async (cert: PaymentCertificate, newStatus: PaymentCertificateStatus) => {
    const labels: Record<string, string> = { submitted: 'Gửi duyệt', approved: 'Phê duyệt', paid: 'Xác nhận thanh toán' };
    const ok = await confirm({ title: labels[newStatus] || newStatus, targetName: `Đợt ${cert.periodNumber}` });
    if (!ok) return;
    try {
      await paymentCertificateService.setStatus(cert.id, newStatus);
      await load();
      toast.success(`${labels[newStatus]} thành công`);
    } catch (e: any) { toast.error('Lỗi', e?.message); }
  };

  const handleUpdateItem = async (cert: PaymentCertificate, itemIdx: number, currentQty: number) => {
    const updatedItems = cert.items.map((item, i) => {
      if (i !== itemIdx) return item;
      const cumQty = item.previousQuantity + currentQty;
      return {
        ...item,
        currentQuantity: currentQty,
        cumulativeQuantity: cumQty,
        currentAmount: currentQty * item.unitPrice,
        cumulativeAmount: cumQty * item.unitPrice,
      };
    });
    const currentCompletedValue = updatedItems.reduce((s, i) => s + i.currentAmount, 0);
    const totalCompletedValue = updatedItems.reduce((s, i) => s + i.cumulativeAmount, 0);

    // Auto calculate advance recovery
    const advanceRecovery = await advancePaymentService.calculateRecovery(contractId, contractType, currentCompletedValue);
    const retentionPercent = cert.retentionPercent || 5;
    const { retentionAmount, currentPayableAmount } = calculatePayableAmount({
      totalCompletedValue,
      advanceRecovery,
      retentionPercent,
      penaltyAmount: cert.penaltyAmount || 0,
      deductionAmount: cert.deductionAmount || 0,
      previousCertifiedAmount: cert.previousCertifiedAmount || 0,
    });

    try {
      await paymentCertificateService.update(cert.id, {
        items: updatedItems,
        currentCompletedValue,
        totalCompletedValue,
        advanceRecovery,
        retentionAmount,
        currentPayableAmount,
      });
      await load();
    } catch (e: any) { toast.error('Lỗi cập nhật', e?.message); }
  };

  const handleDeleteCert = async (cert: PaymentCertificate) => {
    if (cert.status !== 'draft') { toast.warning('Không thể xoá', 'Chỉ xoá được đợt TT ở trạng thái Nháp'); return; }
    const ok = await confirm({ title: 'Xoá đợt thanh toán', targetName: `Đợt ${cert.periodNumber}` });
    if (!ok) return;
    try {
      await paymentCertificateService.remove(cert.id);
      await load();
      toast.success('Đã xoá');
    } catch (e: any) { toast.error('Lỗi', e?.message); }
  };

  // Advance payment handlers
  const [showAddAdvance, setShowAddAdvance] = useState(false);
  const [advForm, setAdvForm] = useState({ amount: 0, date: new Date().toISOString().slice(0, 10), recoveryPercent: 30, note: '' });

  const handleAddAdvance = async () => {
    if (advForm.amount <= 0) { toast.warning('Nhập số tiền tạm ứng'); return; }
    try {
      await advancePaymentService.create({ contractId, contractType, constructionSiteId, amount: advForm.amount, date: advForm.date, recoveryPercent: advForm.recoveryPercent, note: advForm.note });
      setShowAddAdvance(false);
      setAdvForm({ amount: 0, date: new Date().toISOString().slice(0, 10), recoveryPercent: 30, note: '' });
      await load();
      toast.success('Thêm tạm ứng thành công');
    } catch (e: any) { toast.error('Lỗi', e?.message); }
  };

  return (
    <div className="space-y-4 mt-3">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'GT Hợp đồng', value: fmtM(totalContract), color: 'text-slate-800 dark:text-white', icon: <FileText size={11} /> },
          { label: 'Đã thanh toán', value: fmtM(totalPaid), color: 'text-emerald-600', icon: <CreditCard size={11} /> },
          { label: 'Đã duyệt', value: fmtM(totalApproved), color: 'text-blue-600', icon: <CheckCircle2 size={11} /> },
          { label: 'TU còn lại', value: fmtM(advanceBalance), color: 'text-amber-600', icon: <DollarSign size={11} /> },
        ].map((k, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
            <div className="text-[9px] font-bold text-slate-400 uppercase flex items-center gap-1 mb-1">{k.icon} {k.label}</div>
            <div className={`text-lg font-black ${k.color}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Advance Payments Section */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-black text-slate-700 dark:text-white flex items-center gap-1.5">
            <DollarSign size={13} className="text-amber-500" /> Tạm ứng
          </h4>
          <button onClick={() => setShowAddAdvance(!showAddAdvance)}
            className="text-[10px] font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1">
            <Plus size={10} /> Thêm TU
          </button>
        </div>
        {showAddAdvance && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <input type="number" placeholder="Số tiền" value={advForm.amount || ''} onChange={e => setAdvForm({ ...advForm, amount: Number(e.target.value) })}
              className="px-2 py-1.5 rounded-lg border border-amber-300 text-xs outline-none" />
            <input type="date" value={advForm.date} onChange={e => setAdvForm({ ...advForm, date: e.target.value })}
              className="px-2 py-1.5 rounded-lg border border-amber-300 text-xs outline-none" />
            <input type="number" placeholder="% thu hồi" value={advForm.recoveryPercent} onChange={e => setAdvForm({ ...advForm, recoveryPercent: Number(e.target.value) })}
              className="px-2 py-1.5 rounded-lg border border-amber-300 text-xs outline-none" />
            <input placeholder="Ghi chú" value={advForm.note} onChange={e => setAdvForm({ ...advForm, note: e.target.value })}
              className="px-2 py-1.5 rounded-lg border border-amber-300 text-xs outline-none" />
            <div className="flex gap-1">
              <button onClick={handleAddAdvance} className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold text-white bg-amber-500 hover:bg-amber-600">Lưu</button>
              <button onClick={() => setShowAddAdvance(false)} className="px-2 py-1.5 rounded-lg text-[10px] font-bold text-slate-500 hover:bg-slate-100"><X size={12} /></button>
            </div>
          </div>
        )}
        {advances.length === 0 ? (
          <p className="text-[10px] text-slate-400">Chưa có tạm ứng</p>
        ) : (
          <div className="space-y-1.5">
            {advances.map(a => (
              <div key={a.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-700/50 text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-amber-600">{fmtM(a.amount)}</span>
                  <span className="text-slate-400">{new Date(a.date).toLocaleDateString('vi-VN')}</span>
                  <span className="text-[9px] text-slate-400">Thu hồi {a.recoveryPercent}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-emerald-600">Đã thu: {fmtM(a.recoveredAmount)}</span>
                  <span className="text-[10px] font-bold text-red-500">Còn: {fmtM(a.remainingAmount)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payment Certificates List */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <h4 className="text-xs font-black text-slate-700 dark:text-white flex items-center gap-1.5">
            <FileText size={13} className="text-indigo-500" /> Đợt thanh toán ({certs.length})
          </h4>
          <button onClick={handleCreateCert}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100">
            <Plus size={10} /> Tạo đợt mới
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Đang tải...</div>
        ) : certs.length === 0 ? (
          <div className="p-8 text-center">
            <FileText size={32} className="mx-auto mb-2 text-slate-200" />
            <p className="text-xs font-bold text-slate-400">Chưa có đợt thanh toán</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700">
            {certs.map(cert => {
              const st = STATUS_CFG[cert.status];
              const isExpanded = expandedId === cert.id;
              return (
                <div key={cert.id}>
                  {/* Cert Header */}
                  <div className="flex items-center justify-between px-4 py-3 hover:bg-slate-50/50 dark:hover:bg-slate-700/30 cursor-pointer group"
                    onClick={() => setExpandedId(isExpanded ? null : cert.id)}>
                    <div className="flex items-center gap-3">
                      {isExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                      <div>
                        <div className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                          Đợt {cert.periodNumber}
                          <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] font-bold border ${st.bg} ${st.color}`}>
                            {st.icon} {st.label}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400">{cert.description}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-emerald-600">{fmtM(cert.currentPayableAmount)}</div>
                      <div className="text-[10px] text-slate-400">GT đợt này</div>
                    </div>
                  </div>

                  {/* Cert Detail */}
                  {isExpanded && (
                    <div className="px-4 pb-4 bg-slate-50/30 dark:bg-slate-700/20 border-t border-slate-100 dark:border-slate-700 space-y-3">
                      {/* Items Table */}
                      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-600 mt-3">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="bg-indigo-50/50 dark:bg-slate-700">
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase">Mã</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase">Hạng mục</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase text-center">ĐVT</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase text-right">KL HĐ</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase text-right">Đã NT</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase text-right">KL đợt này</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase text-right">Lũy kế</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase text-right">Đơn giá</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase text-right">GT đợt này</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
                            {cert.items.map((item, idx) => (
                              <tr key={idx} className="hover:bg-indigo-50/20">
                                <td className="px-2 py-1.5 text-[10px] font-bold text-indigo-600">{item.contractItemCode}</td>
                                <td className="px-2 py-1.5 text-[10px] text-slate-700 dark:text-slate-300">{item.contractItemName}</td>
                                <td className="px-2 py-1.5 text-[10px] text-center text-slate-500">{item.unit}</td>
                                <td className="px-2 py-1.5 text-[10px] text-right">{fmt(item.contractQuantity)}</td>
                                <td className="px-2 py-1.5 text-[10px] text-right text-slate-400">{fmt(item.previousQuantity)}</td>
                                <td className="px-2 py-1.5 text-right">
                                  {cert.status === 'draft' ? (
                                    <input type="number" value={item.currentQuantity || ''} min={0}
                                      onChange={e => handleUpdateItem(cert, idx, Number(e.target.value))}
                                      className="w-16 px-1 py-0.5 rounded border border-indigo-300 text-[10px] text-right outline-none focus:ring-1 focus:ring-indigo-400" />
                                  ) : (
                                    <span className="text-[10px] font-bold">{fmt(item.currentQuantity)}</span>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 text-[10px] text-right font-bold text-blue-600">{fmt(item.cumulativeQuantity)}</td>
                                <td className="px-2 py-1.5 text-[10px] text-right">{fmt(item.unitPrice)}</td>
                                <td className="px-2 py-1.5 text-[10px] text-right font-bold text-emerald-600">{fmtM(item.currentAmount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Calculation Block */}
                      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600 p-4 space-y-2">
                        <h5 className="text-[10px] font-black text-slate-500 uppercase mb-2">Tính toán thanh toán</h5>
                        {[
                          { label: 'GT hoàn thành lũy kế', value: cert.totalCompletedValue, color: 'text-slate-800 dark:text-white', bold: true },
                          { label: `(−) Thu hồi tạm ứng`, value: -cert.advanceRecovery, color: 'text-red-500' },
                          { label: `(−) Giữ lại bảo hành (${cert.retentionPercent}%)`, value: -cert.retentionAmount, color: 'text-red-500' },
                          { label: '(−) Phạt', value: -cert.penaltyAmount, color: 'text-red-500', note: cert.penaltyReason },
                          { label: '(−) Khấu trừ khác', value: -cert.deductionAmount, color: 'text-red-500', note: cert.deductionReason },
                          { label: '(−) Đã TT đợt trước', value: -cert.previousCertifiedAmount, color: 'text-slate-500' },
                        ].map((row, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="text-slate-500">{row.label} {row.note && <span className="text-[9px] italic">({row.note})</span>}</span>
                            <span className={`font-bold ${row.color} ${row.bold ? 'text-sm' : ''}`}>{fmtM(Math.abs(row.value))}</span>
                          </div>
                        ))}
                        <div className="border-t-2 border-indigo-200 dark:border-indigo-800 pt-2 mt-2 flex items-center justify-between">
                          <span className="text-xs font-black text-indigo-700 dark:text-indigo-300 uppercase">GT thanh toán đợt này</span>
                          <span className="text-lg font-black text-indigo-700 dark:text-indigo-300">{fmtM(cert.currentPayableAmount)}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 justify-end">
                        {cert.status === 'draft' && (
                          <>
                            <button onClick={() => handleDeleteCert(cert)} className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-red-500 hover:bg-red-50 border border-red-200">Xoá</button>
                            <button onClick={() => handleStatusChange(cert, 'submitted')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-white bg-amber-500 hover:bg-amber-600 flex items-center gap-1">
                              <Send size={10} /> Gửi duyệt
                            </button>
                          </>
                        )}
                        {cert.status === 'submitted' && (
                          <button onClick={() => handleStatusChange(cert, 'approved')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-600 flex items-center gap-1">
                            <Check size={10} /> Phê duyệt
                          </button>
                        )}
                        {cert.status === 'approved' && (
                          <button onClick={() => handleStatusChange(cert, 'paid')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-white bg-emerald-500 hover:bg-emerald-600 flex items-center gap-1">
                            <CreditCard size={10} /> Xác nhận thanh toán
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PaymentCertificatePanel;
