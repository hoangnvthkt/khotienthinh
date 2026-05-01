import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ContractItemType, PaymentCertificate } from '../../types';
import { paymentCertificateService } from '../../lib/paymentCertificateService';

interface Props {
  contractId: string;
  contractType: ContractItemType;
}

const fmt = (n: number) => n.toLocaleString('vi-VN') + ' đ';

const RetentionPanel: React.FC<Props> = ({ contractId, contractType }) => {
  const [certs, setCerts] = useState<PaymentCertificate[]>([]);
  const load = useCallback(async () => setCerts(await paymentCertificateService.listByContract(contractId, contractType)), [contractId, contractType]);
  useEffect(() => { load().catch(console.error); }, [load]);

  const summary = useMemo(() => {
    const approved = certs.filter(c => c.status === 'approved' || c.status === 'paid');
    return {
      thisPeriod: approved.reduce((s, c) => s + (c.retentionThisPeriod ?? c.retentionAmount ?? 0), 0),
      paidGross: approved.reduce((s, c) => s + (c.grossThisPeriod ?? c.currentCompletedValue ?? 0), 0),
      count: approved.length,
    };
  }, [certs]);

  return (
    <div className="space-y-3 mt-3">
      <div className="rounded-xl border border-slate-100 bg-white p-4">
        <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5 mb-3"><ShieldCheck size={13} className="text-blue-500" /> Giữ lại bảo hành</h4>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-[9px] font-bold uppercase text-slate-400">GT nghiệm thu</div>
            <div className="text-sm font-black text-slate-700">{fmt(summary.paidGross)}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase text-slate-400">Giữ lại lũy kế</div>
            <div className="text-sm font-black text-blue-600">{fmt(summary.thisPeriod)}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase text-slate-400">Số đợt</div>
            <div className="text-sm font-black text-slate-700">{summary.count}</div>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
        {certs.filter(c => c.status === 'approved' || c.status === 'paid').map(cert => (
          <div key={cert.id} className="px-3 py-2 border-b border-slate-50 flex items-center justify-between text-xs">
            <span className="font-bold text-slate-700">Đợt {cert.periodNumber}</span>
            <span className="text-blue-600 font-black">{fmt(cert.retentionThisPeriod ?? cert.retentionAmount ?? 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RetentionPanel;
