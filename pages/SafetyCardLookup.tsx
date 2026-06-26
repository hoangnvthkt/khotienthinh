import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { safetyPassportService } from '../lib/safetyPassportService';
import { SafetyCard } from '../types';
import SafetyPassportCardPreview from '../components/project/safety/SafetyPassportCardPreview';
import LoadingSpinner from '../components/LoadingSpinner';

const SafetyCardLookup: React.FC = () => {
  const { qrToken } = useParams();
  const [card, setCard] = useState<SafetyCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    safetyPassportService.getCardByQrToken(qrToken || '')
      .then(result => {
        if (!mounted) return;
        setCard(result);
        setError(result ? null : 'Không tìm thấy thẻ an toàn.');
      })
      .catch(err => {
        if (!mounted) return;
        setError(err?.message || 'Không tra cứu được thẻ an toàn.');
      })
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [qrToken]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="min-h-[70vh] bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase text-orange-600">Safety Passport</div>
            <h1 className="text-xl font-black text-slate-900">Tra cứu thẻ an toàn</h1>
          </div>
        </div>

        {error || !card ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
            <div className="flex items-center gap-2"><AlertTriangle size={16} /> {error || 'Không tìm thấy thẻ.'}</div>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[auto_1fr]">
            <SafetyPassportCardPreview card={card} compact />
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-black text-slate-800">Thông tin kiểm tra</h2>
              <div className="mt-3 space-y-2 text-sm font-bold text-slate-600">
                <div>Nhân công: <span className="text-slate-900">{card.worker?.fullName || '-'}</span></div>
                <div>Mã nhân công: <span className="font-mono text-slate-900">{card.worker?.workerCode || '-'}</span></div>
                <div>Nhà thầu/Tổ đội: <span className="text-slate-900">{card.contractor?.name || card.assignment?.contractor?.name || '-'}</span></div>
                <div>Trạng thái thẻ: <span className={card.status === 'active' ? 'text-emerald-600' : 'text-red-600'}>{card.status === 'active' ? 'Hiệu lực' : card.status}</span></div>
                <div>Trạng thái vào công trường: <span className={card.assignment?.eligibilityStatus === 'eligible' ? 'text-emerald-600' : 'text-orange-600'}>{card.assignment?.eligibilityStatus || '-'}</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SafetyCardLookup;
