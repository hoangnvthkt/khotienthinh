import React, { useCallback, useEffect, useState } from 'react';
import { Check, ClipboardCheck, CreditCard, Plus, RotateCcw, Send, XCircle } from 'lucide-react';
import { ContractItemType, QuantityAcceptance } from '../../types';
import { quantityAcceptanceService } from '../../lib/quantityAcceptanceService';
import { paymentCertificateService } from '../../lib/paymentCertificateService';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useApp } from '../../context/AppContext';

interface Props {
  contractId: string;
  contractType: ContractItemType;
  constructionSiteId: string;
}

const fmt = (n: number) => n.toLocaleString('vi-VN');
const today = () => new Date().toISOString().slice(0, 10);

const QuantityAcceptancePanel: React.FC<Props> = ({ contractId, contractType, constructionSiteId }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useApp();
  const [items, setItems] = useState<QuantityAcceptance[]>([]);
  const [periodStart, setPeriodStart] = useState(today().slice(0, 8) + '01');
  const [periodEnd, setPeriodEnd] = useState(today());
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setItems(await quantityAcceptanceService.listByContract(contractId, contractType));
  }, [contractId, contractType]);

  useEffect(() => { load().catch(console.error); }, [load]);

  const createDraft = async () => {
    setCreating(true);
    try {
      const acceptance = await quantityAcceptanceService.createDraftFromVerifiedLogs({
        contractId,
        contractType,
        constructionSiteId,
        periodStart,
        periodEnd,
      });
      await load();
      toast.success('Đã tạo nghiệm thu nháp', `${acceptance.items.length} hạng mục từ nhật ký đã xác nhận`);
    } catch (e: any) {
      toast.error('Không tạo được nghiệm thu', e?.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSetStatus = async (item: QuantityAcceptance, status: 'submitted' | 'returned' | 'approved' | 'cancelled') => {
    const labels: Record<string, string> = {
      submitted: 'Gửi duyệt',
      returned: 'Trả lại',
      approved: 'Phê duyệt',
      cancelled: 'Huỷ nghiệm thu',
    };
    const warningTexts: Record<string, string | undefined> = {
      approved: 'Duyệt nghiệm thu sẽ khóa các hạng mục BOQ liên quan và cập nhật KL hoàn thành.',
      cancelled: 'Huỷ sẽ mở khoá hạng mục BOQ và hoàn trả KL hoàn thành về trạng thái trước.',
    };
    const ok = await confirm({
      title: labels[status] || status,
      targetName: `Nghiệm thu Đợt ${item.periodNumber}`,
      warningText: warningTexts[status],
    });
    if (!ok) return;

    try {
      await quantityAcceptanceService.setStatus(item.id, status, user.id, undefined, user);
      await load();
      toast.success(`${labels[status]} thành công`);
    } catch (e: any) {
      toast.error('Lỗi', e?.message);
    }
  };

  const createPayment = async (acceptance: QuantityAcceptance) => {
    if (acceptance.status !== 'approved') {
      toast.warning('Chưa thể tạo thanh toán', 'Nghiệm thu cần được duyệt trước.');
      return;
    }
    const ok = await confirm({
      title: 'Tạo chứng từ thanh toán',
      targetName: `từ Nghiệm thu Đợt ${acceptance.periodNumber}`,
      warningText: `Sẽ tạo đợt thanh toán với ${acceptance.items.length} hạng mục, GT: ${fmt(acceptance.totalAcceptedAmount)} đ`,
    });
    if (!ok) return;

    try {
      await paymentCertificateService.create(contractId, contractType, constructionSiteId, {
        acceptanceId: acceptance.id,
        periodStart: acceptance.periodStart,
        periodEnd: acceptance.periodEnd,
        description: `Thanh toán từ nghiệm thu đợt ${acceptance.periodNumber}`,
        items: acceptance.items.map(item => ({
          contractItemId: item.contractItemId,
          contractItemCode: item.contractItemCode,
          contractItemName: item.contractItemName,
          unit: item.unit,
          contractQuantity: item.cumulativeAcceptedQuantity,
          revisedContractQuantity: item.cumulativeAcceptedQuantity,
          previousQuantity: item.previousAcceptedQuantity,
          currentQuantity: item.acceptedQuantity,
          certifiedQuantity: item.acceptedQuantity,
          cumulativeQuantity: item.cumulativeAcceptedQuantity,
          unitPrice: item.unitPrice,
          currentAmount: item.acceptedAmount,
          cumulativeAmount: item.cumulativeAcceptedQuantity * item.unitPrice,
          sourceAcceptanceItemId: item.id,
        })),
      });
      await load();
      toast.success('Đã tạo chứng từ thanh toán từ nghiệm thu');
    } catch (e: any) {
      toast.error('Lỗi tạo chứng từ', e?.message);
    }
  };

  return (
    <div className="space-y-3 mt-3">
      <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
          <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5"><ClipboardCheck size={13} className="text-emerald-500" /> Nghiệm thu khối lượng</h4>
          <div className="flex items-center gap-2">
            <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-200 text-[10px]" />
            <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-200 text-[10px]" />
            <button onClick={createDraft} disabled={creating} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 disabled:opacity-50">
              <Plus size={10} /> Tạo từ nhật ký verified
            </button>
          </div>
        </div>
        <div className="divide-y divide-slate-50">
          {items.map(item => (
            <div key={item.id} className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-slate-800">Đợt {item.periodNumber} • {item.description}</div>
                  <div className="text-[10px] text-slate-400">{new Date(item.periodStart).toLocaleDateString('vi-VN')} - {new Date(item.periodEnd).toLocaleDateString('vi-VN')} • {item.items.length} hạng mục</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${
                    item.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    item.status === 'submitted' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    item.status === 'cancelled' ? 'bg-slate-100 text-slate-500 border-slate-200' :
                    'bg-slate-50 text-slate-600 border-slate-200'
                  }`}>{item.status === 'cancelled' ? 'Đã huỷ' : item.status}</span>
                  <span className="text-xs font-black text-emerald-600">{fmt(item.totalAcceptedAmount)} đ</span>
                  {item.status === 'draft' && (
                    <button onClick={() => handleSetStatus(item, 'submitted')} title="Gửi duyệt" className="text-amber-500 hover:text-amber-700 transition-colors">
                      <Send size={13} />
                    </button>
                  )}
                  {item.status === 'submitted' && (
                    <>
                      <button onClick={() => handleSetStatus(item, 'returned')} title="Trả lại" className="text-red-500 hover:text-red-700 transition-colors">
                        <RotateCcw size={13} />
                      </button>
                      <button onClick={() => handleSetStatus(item, 'approved')} title="Phê duyệt" className="text-emerald-500 hover:text-emerald-700 transition-colors">
                        <Check size={13} />
                      </button>
                    </>
                  )}
                  {item.status === 'approved' && (
                    <>
                      <button onClick={() => createPayment(item)} title="Tạo thanh toán" className="text-indigo-500 hover:text-indigo-700 transition-colors">
                        <CreditCard size={13} />
                      </button>
                      <button onClick={() => handleSetStatus(item, 'cancelled')} title="Huỷ nghiệm thu" className="text-slate-400 hover:text-red-600 transition-colors">
                        <XCircle size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {item.items.length > 0 && (
                <div className="mt-2 rounded-lg bg-slate-50 overflow-hidden">
                  {item.items.slice(0, 5).map((line, idx) => (
                    <div key={idx} className="px-2 py-1 flex items-center justify-between text-[10px] border-b border-white">
                      <span className="font-bold text-slate-600">{line.contractItemCode} - {line.contractItemName}</span>
                      <span>{fmt(line.acceptedQuantity)} {line.unit}</span>
                    </div>
                  ))}
                  {item.items.length > 5 && (
                    <div className="px-2 py-1 text-[9px] text-slate-400 text-center">+{item.items.length - 5} hạng mục khác</div>
                  )}
                </div>
              )}
            </div>
          ))}
          {items.length === 0 && <div className="p-6 text-center text-xs font-bold text-slate-400">Chưa có nghiệm thu</div>}
        </div>
      </div>
    </div>
  );
};

export default QuantityAcceptancePanel;
