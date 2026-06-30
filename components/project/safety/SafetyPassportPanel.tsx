import React, { useEffect, useState } from 'react';
import { Briefcase, IdCard, Plus, Save, UserRound, X, LayoutGrid, List } from 'lucide-react';
import { EmptyState, MobileCardList, StatusBadge } from '../../erp';
import { useToast } from '../../../context/ToastContext';
import {
  useSafetyCards,
  useSafetyPassportContractors,
  useSafetyPassportDashboard,
  useSafetyProjectAssignments,
  useSafetyProjectWorkerRows,
  useSafetyWorkers,
} from '../../../hooks/useSafetyPassport';
import {
  SafetyPassportContractor,
  SafetyPassportContractorType,
  SafetyProjectAssignment,
  SafetyProjectWorkerRow,
  SafetyWorkerProfile,
  User,
} from '../../../types';
import { safetyPassportService } from '../../../lib/safetyPassportService';
import SafetyPassportCardPreview from './SafetyPassportCardPreview';
import SafetyPassportWorkerDetailModal from './SafetyPassportWorkerDetailModal';
import SafetyPassportWorkerTable from './SafetyPassportWorkerTable';

export type SafetyPassportMode = 'passport' | 'passportContractors' | 'passportWorkers' | 'passportAssignments' | 'passportCards';

interface Props {
  mode: SafetyPassportMode;
  projectId: string;
  constructionSiteId?: string | null;
  currentUser: User;
  canManage?: boolean;
}

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
};

const nextYearIso = () => {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
};

const ModalShell: React.FC<{ title: string; eyebrow: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }> = ({ title, eyebrow, onClose, children, footer }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-6">
    <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <div className="text-[10px] font-black uppercase text-orange-600">{eyebrow}</div>
          <h3 className="mt-1 text-base font-black text-slate-800">{title}</h3>
        </div>
        <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">{footer}</div>
    </div>
  </div>
);

const ContractorModal: React.FC<{
  item: SafetyPassportContractor | null;
  onClose: () => void;
  onSaved: (item: SafetyPassportContractor) => void;
}> = ({ item, onClose, onSaved }) => {
  const toast = useToast();
  const [contractorType, setContractorType] = useState<SafetyPassportContractorType>(item?.contractorType || 'subcontractor');
  const [name, setName] = useState(item?.name || '');
  const [code, setCode] = useState(item?.code || '');
  const [representativeName, setRepresentativeName] = useState(item?.representativeName || '');
  const [representativePhone, setRepresentativePhone] = useState(item?.representativePhone || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const saved = await safetyPassportService.upsertContractor({
        id: item?.id,
        contractorType,
        name: name.trim(),
        code: code.trim() || null,
        representativeName: representativeName.trim() || null,
        representativePhone: representativePhone.trim() || null,
        status: item?.status || 'active',
      });
      onSaved(saved);
      toast.success('Đã lưu nhà thầu/tổ đội');
      onClose();
    } catch (error: any) {
      toast.error('Không lưu được nhà thầu/tổ đội', error?.message || 'Có lỗi xảy ra');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={item ? 'Sửa nhà thầu/tổ đội' : 'Thêm nhà thầu/tổ đội'}
      eyebrow="Safety Passport"
      onClose={onClose}
      footer={<><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Hủy</button><button type="button" disabled={saving} onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white"><Save size={14} /> Lưu</button></>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Loại</label>
          <select value={contractorType} onChange={event => setContractorType(event.target.value as SafetyPassportContractorType)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
            <option value="subcontractor">Nhà thầu phụ</option>
            <option value="team">Tổ đội</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Mã</label>
          <input value={code} onChange={event => setCode(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Tên</label>
          <input value={name} onChange={event => setName(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" required />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Người đại diện</label>
          <input value={representativeName} onChange={event => setRepresentativeName(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Số điện thoại</label>
          <input value={representativePhone} onChange={event => setRepresentativePhone(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
        </div>
      </div>
    </ModalShell>
  );
};

const AssignmentModal: React.FC<{
  projectId: string;
  constructionSiteId?: string | null;
  workers: SafetyWorkerProfile[];
  contractors: SafetyPassportContractor[];
  currentUser: User;
  onClose: () => void;
  onSaved: (item: SafetyProjectAssignment) => void;
}> = ({ projectId, constructionSiteId, workers, contractors, currentUser, onClose, onSaved }) => {
  const toast = useToast();
  const [workerId, setWorkerId] = useState('');
  const selectedWorker = workers.find(item => item.id === workerId);
  const [contractorId, setContractorId] = useState('');
  const [roleName, setRoleName] = useState('');
  const [workType, setWorkType] = useState('');
  const [siteAccessCardCode, setSiteAccessCardCode] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [siteTrainingStatus, setSiteTrainingStatus] = useState<'pending' | 'completed' | 'expired'>('pending');
  const [commitmentStatus, setCommitmentStatus] = useState<'pending' | 'signed'>('pending');
  const [ppeStatus, setPpeStatus] = useState<'missing' | 'partial' | 'complete'>('missing');
  const [toolboxStatus, setToolboxStatus] = useState<'pending' | 'completed' | 'expired'>('pending');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedWorker) return;
    setContractorId(selectedWorker.contractorId || '');
    setRoleName(selectedWorker.roleName || '');
  }, [selectedWorker]);

  const save = async () => {
    if (!workerId) return;
    setSaving(true);
    try {
      const saved = await safetyPassportService.assignWorkerToProject({
        workerId,
        projectId,
        constructionSiteId: constructionSiteId || null,
        contractorId: contractorId || null,
        teamName: selectedWorker?.teamName || null,
        roleName: roleName.trim() || selectedWorker?.roleName || null,
        workType: workType.trim() || null,
        siteAccessCardCode: siteAccessCardCode.trim() || null,
        startDate,
        siteTrainingStatus,
        commitmentStatus,
        ppeStatus,
        toolboxStatus,
        createdBy: currentUser.id,
      });
      onSaved(saved);
      toast.success('Đã gán nhân công vào công trình');
      onClose();
    } catch (error: any) {
      toast.error('Không gán được nhân công', error?.message || 'Có lỗi xảy ra');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="Gán nhân công vào công trình"
      eyebrow="Safety Passport"
      onClose={onClose}
      footer={<><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Hủy</button><button type="button" disabled={saving || !workerId} onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white"><Save size={14} /> Gán</button></>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Nhân công</label>
          <select value={workerId} onChange={event => setWorkerId(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
            <option value="">Chọn nhân công có sẵn</option>
            {workers.map(item => <option key={item.id} value={item.id}>{item.workerCode} - {item.fullName}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Nhà thầu/tổ đội</label>
          <select value={contractorId} onChange={event => setContractorId(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
            <option value="">Theo hồ sơ gốc / chưa chọn</option>
            {contractors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Vai trò công trình</label>
          <input value={roleName} onChange={event => setRoleName(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Loại công việc</label>
          <input value={workType} onChange={event => setWorkType(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Mã thẻ vào ra</label>
          <input value={siteAccessCardCode} onChange={event => setSiteAccessCardCode(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Ngày vào</label>
          <input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Đào tạo nội quy</label>
          <select value={siteTrainingStatus} onChange={event => setSiteTrainingStatus(event.target.value as any)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
            <option value="pending">Chưa xong</option><option value="completed">Đã xong</option><option value="expired">Hết hạn</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Cam kết an toàn</label>
          <select value={commitmentStatus} onChange={event => setCommitmentStatus(event.target.value as any)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
            <option value="pending">Chưa ký</option><option value="signed">Đã ký</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">PPE</label>
          <select value={ppeStatus} onChange={event => setPpeStatus(event.target.value as any)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
            <option value="missing">Thiếu</option><option value="partial">Chưa đủ</option><option value="complete">Đã đủ</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Toolbox đầu vào</label>
          <select value={toolboxStatus} onChange={event => setToolboxStatus(event.target.value as any)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
            <option value="pending">Chưa xong</option><option value="completed">Đã xong</option><option value="expired">Hết hạn</option>
          </select>
        </div>
      </div>
    </ModalShell>
  );
};

const SafetyPassportPanel: React.FC<Props> = ({ mode, projectId, constructionSiteId, currentUser, canManage }) => {
  const toast = useToast();
  const dashboard = useSafetyPassportDashboard(projectId, constructionSiteId);
  const contractors = useSafetyPassportContractors();
  const workers = useSafetyWorkers();
  const assignments = useSafetyProjectAssignments(projectId, constructionSiteId);
  const projectWorkerRows = useSafetyProjectWorkerRows(projectId, constructionSiteId);
  const cards = useSafetyCards(projectId, constructionSiteId);
  const [contractorModal, setContractorModal] = useState<SafetyPassportContractor | null | 'new'>(null);
  const [workerDetailContext, setWorkerDetailContext] = useState<{
    worker: SafetyWorkerProfile | null;
    assignment?: SafetyProjectAssignment | null;
    documents?: SafetyProjectWorkerRow['documents'];
  } | null>(null);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState<any>(null);
  const [workerViewMode, setWorkerViewMode] = useState<'list' | 'card'>('list');

  const reloadAll = async () => {
    await Promise.all([dashboard.reload(), contractors.reload(), workers.reload(), assignments.reload(), projectWorkerRows.reload(), cards.reload()]);
  };

  const issueCard = async (assignment: SafetyProjectAssignment) => {
    try {
      const card = await safetyPassportService.issueSafetyCard({ assignment, expiresAt: nextYearIso(), createdBy: currentUser.id });
      cards.setData(prev => [card, ...prev]);
      await projectWorkerRows.reload();
      toast.success('Đã cấp thẻ an toàn');
    } catch (error: any) {
      toast.error('Không cấp được thẻ', error?.message || 'Có lỗi xảy ra');
    }
  };

  const printCard = async (card: any) => {
    await safetyPassportService.logCardPrint(card, currentUser.id).catch(() => undefined);
    window.print();
  };

  const workerDetailModal = workerDetailContext && (
    <SafetyPassportWorkerDetailModal
      worker={workerDetailContext.worker}
      assignment={workerDetailContext.assignment}
      documents={workerDetailContext.documents}
      projectId={workerDetailContext.assignment ? projectId : undefined}
      constructionSiteId={workerDetailContext.assignment ? constructionSiteId : undefined}
      contractors={contractors.data}
      currentUser={currentUser}
      canManage={canManage}
      onClose={() => setWorkerDetailContext(null)}
      onSaved={result => {
        workers.setData(prev => [result.worker, ...prev.filter(item => item.id !== result.worker.id)]);
        if (result.assignment) {
          assignments.setData(prev => [result.assignment as SafetyProjectAssignment, ...prev.filter(item => item.id !== result.assignment?.id)]);
        }
        void reloadAll();
      }}
    />
  );

  if (mode === 'passport') {
    const data = dashboard.data;
    return (
      <section className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-xs font-bold text-slate-500">Nhân công</div><div className="mt-1 text-2xl font-black">{data?.totalWorkers || 0}</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-xs font-bold text-slate-500">Đang tham gia</div><div className="mt-1 text-2xl font-black">{data?.totalAssignments || 0}</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-xs font-bold text-slate-500">Đủ điều kiện</div><div className="mt-1 text-2xl font-black text-emerald-600">{data?.eligibleAssignments || 0}</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-xs font-bold text-slate-500">Cần xử lý</div><div className="mt-1 text-2xl font-black text-orange-600">{(data?.totalAssignments || 0) - (data?.eligibleAssignments || 0)}</div></div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-black text-slate-800">Cảnh báo hồ sơ</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <StatusBadge status="missing_profile" label={`${data?.missingProfile || 0} thiếu hồ sơ`} tone="warning" />
              <StatusBadge status="missing_certificate" label={`${data?.missingCertificate || 0} thiếu chứng chỉ`} tone="warning" />
              <StatusBadge status="expired_certificate" label={`${data?.expiredCertificate || 0} hết hạn chứng chỉ`} tone="danger" />
              <StatusBadge status="site" label={`${data?.missingSiteRequirement || 0} thiếu yêu cầu công trình`} tone="attention" />
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-black text-slate-800">Sắp hết hạn</h3>
            <div className="mt-3 space-y-2 text-xs font-bold text-slate-600">
              <div>Chứng chỉ trong 7 ngày: <span className="font-black text-red-600">{data?.expiringCertificates7Days.length || 0}</span></div>
              <div>Chứng chỉ trong 30 ngày: <span className="font-black text-orange-600">{data?.expiringCertificates30Days.length || 0}</span></div>
              <div>Thẻ trong 30 ngày: <span className="font-black text-orange-600">{data?.expiringCards30Days.length || 0}</span></div>
            </div>
          </div>
        </div>
        {(data?.problematicContractors.length || 0) > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-black text-slate-800">Tổ đội/NTP nhiều lỗi</h3>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {data?.problematicContractors.map(row => (
                <div key={row.contractor.id} className="rounded-lg border border-orange-100 bg-orange-50 p-3">
                  <div className="text-xs font-black text-slate-800">{row.contractor.name}</div>
                  <div className="mt-1 text-[11px] font-bold text-orange-700">{row.issueCount} hồ sơ cần xử lý</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  if (mode === 'passportContractors') {
    const renderContractor = (item: SafetyPassportContractor, framed = true) => (
      <div className={framed ? 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm' : ''}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase text-orange-600">{item.contractorType === 'team' ? 'Tổ đội' : 'Nhà thầu phụ'}</div>
            <h3 className="mt-1 text-sm font-black text-slate-800">{item.name}</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">{item.representativeName || '-'} · {item.representativePhone || '-'}</p>
          </div>
          <StatusBadge status={item.status} label={item.status === 'active' ? 'Hoạt động' : item.status} tone={item.status === 'active' ? 'success' : 'warning'} />
        </div>
      </div>
    );
    return (
      <section className="space-y-4">
        <div className="flex justify-end">{canManage && <button onClick={() => setContractorModal('new')} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white"><Plus size={14} /> Thêm</button>}</div>
        {contractors.data.length === 0 ? <EmptyState icon={<Briefcase size={18} />} title="Chưa có nhà thầu/tổ đội" message="Tạo master để quản lý nhân công Safety Passport." /> : (
          <>
            <div className="md:hidden"><MobileCardList items={contractors.data} getKey={item => item.id} renderItem={item => renderContractor(item, false)} /></div>
            <div className="hidden grid-cols-2 gap-3 md:grid xl:grid-cols-3">{contractors.data.map(item => <div key={item.id}>{renderContractor(item)}</div>)}</div>
          </>
        )}
        {contractorModal && <ContractorModal item={contractorModal === 'new' ? null : contractorModal} onClose={() => setContractorModal(null)} onSaved={saved => contractors.setData(prev => [saved, ...prev.filter(item => item.id !== saved.id)])} />}
      </section>
    );
  }

  if (mode === 'passportWorkers') {
    const renderWorker = (item: SafetyWorkerProfile, framed = true) => (
      <div className={framed ? 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm' : ''}>
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 overflow-hidden rounded-lg bg-slate-100">
            {item.photoAttachment?.url ? <img src={item.photoAttachment.url} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[9px] font-black text-slate-400">NO</div>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] font-black text-orange-600">{item.workerCode}</div>
            <h3 className="mt-1 text-sm font-black text-slate-800">{item.fullName}</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">{item.contractor?.name || item.teamName || '-'} · {item.phone || '-'}</p>
          </div>
          <StatusBadge status={item.status} label={item.status === 'active' ? 'Hoạt động' : item.status} tone={item.status === 'active' ? 'success' : 'warning'} />
        </div>
        <div className="mt-3 flex justify-end">{canManage && <button onClick={() => setWorkerDetailContext({ worker: item })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-blue-600 hover:bg-blue-50">Xem/Sửa</button>}</div>
      </div>
    );
    return (
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-800/10 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setWorkerViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-black transition-all ${
                workerViewMode === 'list'
                  ? 'bg-white shadow-sm text-slate-800 dark:bg-slate-700 dark:text-white'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <List size={14} />
              <span>Danh sách</span>
            </button>
            <button
              type="button"
              onClick={() => setWorkerViewMode('card')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-black transition-all ${
                workerViewMode === 'card'
                  ? 'bg-white shadow-sm text-slate-800 dark:bg-slate-700 dark:text-white'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <LayoutGrid size={14} />
              <span>Thẻ</span>
            </button>
          </div>
          {canManage && (
            <button
              onClick={() => setWorkerDetailContext({ worker: null })}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white hover:bg-slate-800 transition"
            >
              <Plus size={14} /> Tạo hồ sơ
            </button>
          )}
        </div>

        {workers.data.length === 0 ? (
          <EmptyState icon={<UserRound size={18} />} title="Chưa có hồ sơ nhân công" message="Tạo hồ sơ gốc một lần để tái sử dụng ở nhiều công trình." />
        ) : workerViewMode === 'list' ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 text-xs dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 uppercase tracking-wider">
                  <th className="p-3.5 w-12 text-center">Ảnh</th>
                  <th className="p-3.5">Mã nhân công</th>
                  <th className="p-3.5">Họ và tên</th>
                  <th className="p-3.5">Nhà thầu / Tổ đội</th>
                  <th className="p-3.5">Số điện thoại</th>
                  <th className="p-3.5 w-32 text-center">Trạng thái</th>
                  {canManage && <th className="p-3.5 w-24 text-center"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {workers.data.map(item => (
                  <tr
                    key={item.id}
                    onClick={() => setWorkerDetailContext({ worker: item })}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group"
                  >
                    <td className="p-3.5 text-center align-middle" onClick={e => e.stopPropagation()}>
                      <div className="h-10 w-10 overflow-hidden rounded-full border border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800 mx-auto">
                        {item.photoAttachment?.url ? (
                          <img src={item.photoAttachment.url} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] font-black text-slate-400">NO</div>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 font-mono font-bold text-xs text-orange-655 align-middle">
                      {item.workerCode}
                    </td>
                    <td className="p-3.5 font-bold text-slate-800 dark:text-slate-200 group-hover:text-blue-600 transition-colors align-middle">
                      {item.fullName}
                    </td>
                    <td className="p-3.5 text-slate-600 dark:text-slate-400 align-middle">
                      {item.contractor?.name || item.teamName || '-'}
                    </td>
                    <td className="p-3.5 font-mono text-slate-600 dark:text-slate-400 align-middle">
                      {item.phone || '-'}
                    </td>
                    <td className="p-3.5 text-center align-middle" onClick={e => e.stopPropagation()}>
                      <StatusBadge
                        status={item.status}
                        label={item.status === 'active' ? 'Hoạt động' : item.status}
                        tone={item.status === 'active' ? 'success' : 'warning'}
                      />
                    </td>
                    {canManage && (
                      <td className="p-3.5 text-center align-middle" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setWorkerDetailContext({ worker: item })}
                          className="rounded-lg border border-slate-200 bg-white hover:bg-blue-50 dark:hover:bg-slate-800 px-2.5 py-1 text-xs font-black text-blue-600 dark:border-slate-700/80 transition"
                        >
                          Xem/Sửa
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div className="md:hidden"><MobileCardList items={workers.data} getKey={item => item.id} renderItem={item => renderWorker(item, false)} /></div>
            <div className="hidden grid-cols-2 gap-3 md:grid xl:grid-cols-3">{workers.data.map(item => <div key={item.id}>{renderWorker(item)}</div>)}</div>
          </>
        )}
        {workerDetailModal}
      </section>
    );
  }

  if (mode === 'passportAssignments') {
    return (
      <>
        <SafetyPassportWorkerTable
          rows={projectWorkerRows.data}
          loading={projectWorkerRows.loading}
          canManage={canManage}
          onCreateAssignment={() => setShowAssignmentModal(true)}
          onOpenDetail={row => setWorkerDetailContext({ worker: row.worker, assignment: row.assignment, documents: row.documents })}
          onIssueCard={row => issueCard(row.assignment)}
          onPrintCard={printCard}
        />
        {showAssignmentModal && <AssignmentModal projectId={projectId} constructionSiteId={constructionSiteId} workers={workers.data} contractors={contractors.data} currentUser={currentUser} onClose={() => setShowAssignmentModal(false)} onSaved={saved => { assignments.setData(prev => [saved, ...prev.filter(item => item.id !== saved.id)]); void reloadAll(); }} />}
        {workerDetailModal}
      </>
    );
  }

  const activeCards = cards.data;
  return (
    <section className="space-y-4">
      {activeCards.length === 0 ? <EmptyState icon={<IdCard size={18} />} title="Chưa có thẻ an toàn" message="Cấp thẻ từ danh sách nhân công đủ điều kiện." /> : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {activeCards.map(card => (
            <div key={card.id} className="space-y-2">
              <SafetyPassportCardPreview card={card} compact />
              <div className="flex justify-end gap-2">
                <button onClick={() => setSelectedCard(card)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-50">Xem</button>
                {canManage && <button onClick={() => printCard(card)} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">In thẻ</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {selectedCard && (
        <ModalShell title="Thẻ an toàn" eyebrow="Safety Passport" onClose={() => setSelectedCard(null)} footer={<button type="button" onClick={() => setSelectedCard(null)} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Đóng</button>}>
          <div className="flex justify-center"><SafetyPassportCardPreview card={selectedCard} /></div>
        </ModalShell>
      )}
    </section>
  );
};

export default SafetyPassportPanel;
