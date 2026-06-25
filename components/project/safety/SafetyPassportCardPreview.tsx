import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { SafetyCard } from '../../../types';
import { buildSafetyCardQrUrl } from '../../../lib/safetyPassportService';

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
};

const SafetyPassportCardPreview: React.FC<{ card: SafetyCard; compact?: boolean }> = ({ card, compact }) => {
  const worker = card.worker;
  const contractor = card.contractor || card.assignment?.contractor || worker?.contractor;
  const qrUrl = buildSafetyCardQrUrl(card.qrToken);
  const photo = worker?.photoAttachment?.previewUrl || worker?.photoAttachment?.url;

  return (
    <div className={`overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ${compact ? 'w-[320px]' : 'w-full max-w-md'}`}>
      <div className="bg-slate-900 px-4 py-3 text-white">
        <div className="text-[10px] font-black uppercase text-emerald-200">Thẻ an toàn công trường</div>
        <div className="mt-1 font-mono text-sm font-black">{card.cardCode}</div>
      </div>
      <div className="grid grid-cols-[92px_1fr] gap-3 p-4">
        <div className="h-28 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
          {photo ? (
            <img src={photo} alt={worker?.fullName || 'Ảnh nhân công'} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] font-black text-slate-400">NO PHOTO</div>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="break-words text-base font-black text-slate-900">{worker?.fullName || 'Chưa có tên'}</h3>
          <div className="mt-1 font-mono text-[11px] font-black text-orange-600">{worker?.workerCode || '-'}</div>
          <div className="mt-2 space-y-1 text-xs font-bold text-slate-500">
            <div>Tổ đội/NTP: {contractor?.name || worker?.teamName || '-'}</div>
            <div>Vai trò: {card.assignment?.roleName || worker?.roleName || '-'}</div>
            <div>Ngày cấp: {formatDate(card.issuedAt)}</div>
            <div>Hết hạn: {formatDate(card.expiresAt)}</div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
        <div>
          <div className="text-[10px] font-black uppercase text-slate-400">Trạng thái</div>
          <div className={`mt-1 text-xs font-black ${card.status === 'active' ? 'text-emerald-600' : 'text-red-600'}`}>{card.status === 'active' ? 'Hiệu lực' : card.status}</div>
        </div>
        <QRCodeSVG value={qrUrl} size={76} level="M" includeMargin />
      </div>
    </div>
  );
};

export default SafetyPassportCardPreview;
