import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  CreditCard,
  Download,
  FileSignature,
  Files,
  GitCompareArrows,
  Info,
  Loader2,
  Package,
  Paperclip,
  TrendingUp,
} from 'lucide-react';
import {
  ContractAttachment,
  ContractItem,
  ContractItemType,
  CustomerContract,
  HdContractStatus,
  PaymentSchedule,
  SubcontractorContract,
} from '../../types';
import { contractItemService } from '../../lib/contractItemService';
import { paymentService } from '../../lib/projectService';
import { variationService } from '../../lib/variationService';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import ContractItemTable from './ContractItemTable';
import ContractVariationPanel from './ContractVariationPanel';
import ContractBoqVersionHistory from './ContractBoqVersionHistory';
import ContractAppendixPanel from './ContractAppendixPanel';
import ContractPaymentSchedulePanel from './ContractPaymentSchedulePanel';
import QuantityAcceptancePanel from './QuantityAcceptancePanel';
import PaymentCertificatePanel from './PaymentCertificatePanel';

type WorkspaceTab = 'info' | 'boq' | 'variation' | 'history' | 'appendices' | 'schedule' | 'acceptance' | 'certificates' | 'documents';

interface Props {
  contract: CustomerContract | SubcontractorContract;
  contractType: ContractItemType;
  embedded?: boolean;
  onBack?: () => void;
  canManageTab?: boolean;
  initialTab?: WorkspaceTab;
}

const statusConfig: Record<HdContractStatus, { label: string; className: string }> = {
  draft: { label: 'Nháp', className: 'bg-slate-100 text-slate-600' },
  negotiating: { label: 'Đàm phán', className: 'bg-amber-50 text-amber-700' },
  signed: { label: 'Đã ký', className: 'bg-blue-50 text-blue-700' },
  active: { label: 'Hiệu lực', className: 'bg-emerald-50 text-emerald-700' },
  completed: { label: 'Hoàn thành', className: 'bg-violet-50 text-violet-700' },
  expired: { label: 'Hết hạn', className: 'bg-red-50 text-red-700' },
  cancelled: { label: 'Huỷ', className: 'bg-slate-200 text-slate-500' },
};

const fmtMoney = (value: number, currency = 'VND') =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0));

const fmtDate = (value?: string) => value ? new Date(value).toLocaleDateString('vi-VN') : '-';
const num = (value: unknown) => Number(value || 0);

const getPartyName = (contract: CustomerContract | SubcontractorContract, contractType: ContractItemType) =>
  contractType === 'customer' ? (contract as CustomerContract).customerName : (contract as SubcontractorContract).subcontractorName;

const getEndDate = (contract: CustomerContract | SubcontractorContract, contractType: ContractItemType) =>
  contractType === 'customer' ? (contract as CustomerContract).endDate : (contract as SubcontractorContract).completionDate;

const isOriginalBoqReadOnly = (status: HdContractStatus) =>
  ['signed', 'active', 'completed', 'expired', 'cancelled'].includes(status);

const ContractWorkspace: React.FC<Props> = ({ contract, contractType, embedded, onBack, canManageTab = true, initialTab }) => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab || 'info');
  const projectId = contract.projectId || null;
  const constructionSiteId = contract.constructionSiteId || null;
  const hasSiteLink = Boolean(constructionSiteId);
  const partyName = getPartyName(contract, contractType);
  const originalBoqLocked = isOriginalBoqReadOnly(contract.status);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const tabs: { key: WorkspaceTab; label: string; icon: React.ReactNode; siteRequired?: boolean }[] = [
    { key: 'info', label: 'Thông tin HĐ', icon: <Info size={13} /> },
    { key: 'boq', label: 'BOQ gốc', icon: <Package size={13} /> },
    { key: 'variation', label: 'Điều chỉnh BOQ', icon: <TrendingUp size={13} />, siteRequired: true },
    { key: 'history', label: 'Lịch sử BOQ / Version', icon: <GitCompareArrows size={13} /> },
    { key: 'appendices', label: 'Phụ lục', icon: <Files size={13} /> },
    { key: 'schedule', label: 'Lịch thanh toán', icon: <CalendarClock size={13} /> },
    { key: 'acceptance', label: 'Nghiệm thu', icon: <ClipboardCheck size={13} />, siteRequired: true },
    { key: 'certificates', label: 'Chứng từ thanh toán', icon: <CreditCard size={13} />, siteRequired: true },
    { key: 'documents', label: 'Tài liệu', icon: <Paperclip size={13} /> },
  ];

  const renderSiteRequired = (title: string) => (
    <div className="rounded-xl border border-amber-100 bg-amber-50 p-5 text-center">
      <AlertTriangle size={18} className="mx-auto mb-2 text-amber-500" />
      <p className="text-sm font-bold text-amber-700">{title} cần liên kết công trường để dùng dữ liệu hiện trường.</p>
    </div>
  );

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-5'}>
      <div className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {onBack && (
                <button onClick={onBack} className="text-[10px] font-bold text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg bg-slate-50">
                  Quay lại
                </button>
              )}
              <span className="font-mono text-xs font-black text-indigo-600">{contract.code}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusConfig[contract.status]?.className || 'bg-slate-100 text-slate-500'}`}>
                {statusConfig[contract.status]?.label || contract.status}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">
                {contractType === 'customer' ? 'HĐ nhận thầu' : 'HĐ thầu phụ'}
              </span>
            </div>
            <h2 className="mt-1 text-lg font-black text-slate-800 dark:text-white truncate">{contract.name}</h2>
            <p className="text-xs font-bold text-slate-400 truncate">{partyName}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] font-bold text-slate-400 uppercase">Giá trị hợp đồng</div>
            <div className="text-lg font-black text-slate-800 dark:text-white">{fmtMoney(contract.value, contract.currency)}</div>
          </div>
        </div>

        <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {tabs.map(tab => {
              const disabled = tab.siteRequired && !hasSiteLink;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                    activeTab === tab.key
                      ? 'text-indigo-700 bg-indigo-100 border border-indigo-200'
                      : disabled
                        ? 'text-slate-300 bg-slate-50'
                        : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {tab.icon} {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-4">
          {activeTab === 'info' && (
            <ContractInfoPanel contract={contract} contractType={contractType} />
          )}
          {activeTab === 'boq' && (
            <ContractItemTable
              contractId={contract.id}
              contractType={contractType}
              projectId={projectId}
              constructionSiteId={constructionSiteId}
              readOnly={originalBoqLocked}
              readOnlyReason={
                originalBoqLocked
                  ? 'BOQ gốc của hợp đồng đã ký/hiệu lực là bản thương mại bất biến. Các thay đổi cần đi qua tab Điều chỉnh BOQ hoặc Phụ lục.'
                  : undefined
              }
            />
          )}
          {activeTab === 'variation' && (
            hasSiteLink ? (
              <ContractVariationPanel
                contractId={contract.id}
                contractType={contractType}
                projectId={projectId || undefined}
                constructionSiteId={constructionSiteId!}
              />
            ) : renderSiteRequired('Điều chỉnh BOQ')
          )}
          {activeTab === 'history' && (
            <ContractBoqVersionHistory contractId={contract.id} contractType={contractType} />
          )}
          {activeTab === 'appendices' && (
            <ContractAppendixPanel
              contractId={contract.id}
              contractType={contractType}
              projectId={projectId}
              constructionSiteId={constructionSiteId}
            />
          )}
          {activeTab === 'schedule' && (
            <ContractPaymentSchedulePanel
              contractId={contract.id}
              contractType={contractType}
              projectId={projectId}
              constructionSiteId={constructionSiteId}
              contactName={partyName}
              contractValue={contract.value}
              currency={contract.currency}
              canManageTab={canManageTab}
            />
          )}
          {activeTab === 'acceptance' && (
            hasSiteLink ? (
              <QuantityAcceptancePanel
                contractId={contract.id}
                contractType={contractType}
                projectId={projectId || undefined}
                constructionSiteId={constructionSiteId!}
              />
            ) : renderSiteRequired('Nghiệm thu')
          )}
          {activeTab === 'certificates' && (
            hasSiteLink ? (
              <PaymentCertificatePanel
                contractId={contract.id}
                contractType={contractType}
                projectId={projectId || undefined}
                constructionSiteId={constructionSiteId!}
              />
            ) : renderSiteRequired('Chứng từ thanh toán')
          )}
          {activeTab === 'documents' && (
            <ContractDocumentsPanel attachments={contract.attachments || []} />
          )}
        </div>
      </div>
    </div>
  );
};

const ContractInfoPanel: React.FC<{ contract: CustomerContract | SubcontractorContract; contractType: ContractItemType }> = ({ contract, contractType }) => {
  const endDate = getEndDate(contract, contractType);
  const details = [
    ['Loại hợp đồng', contractType === 'customer' ? 'HĐ nhận thầu' : 'HĐ thầu phụ'],
    ['Đối tác', getPartyName(contract, contractType)],
    ['Ngày ký', fmtDate(contract.signedDate)],
    ['Ngày hiệu lực', fmtDate(contract.effectiveDate)],
    ['Ngày kết thúc', fmtDate(endDate)],
    ['Tiến độ thanh toán', contract.paymentSchedule || '-'],
    ['Ghi chú', contract.note || '-'],
  ];

  if (contractType === 'subcontractor') {
    const sub = contract as SubcontractorContract;
    details.push(['Phạm vi công việc', sub.scopeOfWork || '-']);
    details.push(['Địa điểm thi công', sub.workLocation || '-']);
    details.push(['Giữ lại', sub.retentionPercent ? `${sub.retentionPercent}%` : '-']);
  }

  return (
    <div className="space-y-4">
      <DataHealthPanel contract={contract} contractType={contractType} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {details.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</div>
            <div className="text-sm font-bold text-slate-700">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const DataHealthPanel: React.FC<{ contract: CustomerContract | SubcontractorContract; contractType: ContractItemType }> = ({ contract, contractType }) => {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [boq, variations, schedules] = await Promise.all([
        contractItemService.listByContract(contract.id, contractType),
        variationService.listByContract(contract.id, contractType),
        paymentService.listByContract(contract.id, contractType),
      ]);
      setWarnings(buildDataWarnings(contract, boq, variations, schedules));
    } catch (error) {
      logApiError('contractWorkspace.health', error);
      toast.error('Không thể kiểm tra dữ liệu hợp đồng', getApiErrorMessage(error, 'Không thể kiểm tra dữ liệu trùng/lệch của hợp đồng.'));
    } finally {
      setLoading(false);
    }
  }, [contract, contractType, toast]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-100 bg-white p-3 text-xs text-slate-400 font-bold">
        <Loader2 size={14} className="inline animate-spin mr-2" />Đang kiểm tra dữ liệu hợp đồng...
      </div>
    );
  }

  if (warnings.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-700 font-bold">
        Dữ liệu hợp đồng đang đồng bộ: chưa phát hiện trùng mã BOQ, version chưa apply, hoặc lịch thanh toán rời hợp đồng.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
      <div className="text-xs font-black text-amber-700 flex items-center gap-1.5 mb-2">
        <AlertTriangle size={14} /> Cần rà soát dữ liệu
      </div>
      <div className="space-y-1">
        {warnings.map(warning => <p key={warning} className="text-xs font-bold text-amber-700">- {warning}</p>)}
      </div>
    </div>
  );
};

const buildDataWarnings = (
  contract: CustomerContract | SubcontractorContract,
  boq: ContractItem[],
  variations: Awaited<ReturnType<typeof variationService.listByContract>>,
  schedules: PaymentSchedule[],
) => {
  const warnings: string[] = [];
  const codeMap = new Map<string, number>();
  for (const item of boq) {
    const key = item.code.trim().toLowerCase();
    if (!key) continue;
    codeMap.set(key, (codeMap.get(key) || 0) + 1);
  }
  const duplicateCodes = Array.from(codeMap.entries()).filter(([, count]) => count > 1).map(([code]) => code);
  if (duplicateCodes.length) warnings.push(`BOQ đang có mã hạng mục bị trùng: ${duplicateCodes.slice(0, 5).join(', ')}.`);

  const approvedDelta = variations.filter(item => item.status === 'approved').reduce((sum, item) => sum + num(item.totalAmountDelta), 0);
  const currentDelta = boq.reduce((sum, item) => sum + (num(item.revisedTotalPrice ?? item.totalPrice) - num(item.totalPrice)), 0);
  if (Math.abs(approvedDelta - currentDelta) > 1) {
    warnings.push('Tổng giá trị version BOQ đã duyệt đang lệch với BOQ hiện hành. Cần kiểm tra version đã duyệt nhưng chưa apply đủ.');
  }

  const currentBoqValue = boq.reduce((sum, item) => sum + num(item.revisedTotalPrice ?? item.totalPrice), 0);
  if (currentBoqValue > 0 && Math.abs(currentBoqValue - num(contract.value)) > 1) {
    warnings.push(`Giá trị hợp đồng (${fmtMoney(contract.value, contract.currency)}) đang lệch tổng BOQ hiện hành (${fmtMoney(currentBoqValue, contract.currency)}).`);
  }

  const unlinkedSchedule = schedules.filter(item => !item.contractId);
  if (unlinkedSchedule.length) warnings.push('Có lịch thanh toán chưa link hợp đồng.');

  return warnings;
};

const ContractDocumentsPanel: React.FC<{ attachments: ContractAttachment[] }> = ({ attachments }) => {
  const toast = useToast();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const download = async (attachment: ContractAttachment) => {
    if (!isSupabaseConfigured) return;
    setDownloadingId(attachment.id);
    try {
      const { data, error } = await supabase.storage.from('contract-files').createSignedUrl(attachment.storagePath, 60);
      if (error) throw error;
      if (data?.signedUrl) window.open(data.signedUrl, '_blank');
    } catch (error) {
      logApiError('contractWorkspace.documents.download', error);
      toast.error('Không thể tải file', getApiErrorMessage(error, 'Không thể tạo đường dẫn tải file.'));
    } finally {
      setDownloadingId(null);
    }
  };

  if (attachments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs font-bold text-slate-400">
        Chưa có tài liệu hợp đồng. File hợp đồng gốc vẫn được upload tại màn tạo/sửa HĐ trong module HD.
      </div>
    );
  }

  return (
    <div className="space-y-2 mt-3">
      {attachments.map(attachment => (
        <div key={attachment.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3">
          <FileSignature size={18} className="text-indigo-500" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate">{attachment.name}</p>
            <p className="text-[10px] text-slate-400">{(attachment.fileSize / 1024).toFixed(0)} KB · {fmtDate(attachment.uploadedAt)}</p>
          </div>
          <button
            onClick={() => download(attachment)}
            disabled={downloadingId === attachment.id}
            className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
          >
            {downloadingId === attachment.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          </button>
        </div>
      ))}
    </div>
  );
};

export default ContractWorkspace;
