import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BadgeCheck, Briefcase, CheckCircle2, CreditCard, FileWarning, HardHat, IdCard, Plus, Save, ShieldCheck, Upload, UserRound, X } from 'lucide-react';
import { EmptyState, MobileCardList, StatusBadge } from '../../erp';
import { useToast } from '../../../context/ToastContext';
import {
  useSafetyCards,
  useSafetyPassportContractors,
  useSafetyPassportDashboard,
  useSafetyProjectAssignments,
  useSafetyWorkers,
} from '../../../hooks/useSafetyPassport';
import {
  SafetyAttachment,
  SafetyPassportAssignmentStatus,
  SafetyPassportContractor,
  SafetyPassportContractorType,
  SafetyProjectAssignment,
  SafetyWorkerProfile,
  User,
} from '../../../types';
import {
  getSafetyAssignmentStatusLabel,
  safetyPassportService,
} from '../../../lib/safetyPassportService';
import SafetyPassportCardPreview from './SafetyPassportCardPreview';

export type SafetyPassportMode = 'passport' | 'passportContractors' | 'passportWorkers' | 'passportAssignments' | 'passportCards';

interface Props {
  mode: SafetyPassportMode;
  projectId: string;
  constructionSiteId?: string | null;
  currentUser: User;
  canManage?: boolean;
}

const statusTone = (status: SafetyPassportAssignmentStatus) => {
  if (status === 'eligible') return 'success';
  if (status === 'suspended' || status === 'expired_certificate') return 'danger';
  return 'warning';
};

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

const FilePicker: React.FC<{ label: string; onPick: (file: File) => void }> = ({ label, onPick }) => (
  <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 text-xs font-black text-slate-600 hover:border-orange-300 hover:bg-orange-50">
    <Upload size={14} /> {label}
    <input type="file" className="hidden" onChange={event => {
      const file = event.target.files?.[0];
      if (file) onPick(file);
      event.currentTarget.value = '';
    }} />
  </label>
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

const WorkerModal: React.FC<{
  worker: SafetyWorkerProfile | null;
  contractors: SafetyPassportContractor[];
  currentUser: User;
  onClose: () => void;
  onSaved: (item: SafetyWorkerProfile) => void;
}> = ({ worker, contractors, currentUser, onClose, onSaved }) => {
  const toast = useToast();
  const [fullName, setFullName] = useState(worker?.fullName || '');
  const [workerCode, setWorkerCode] = useState(worker?.workerCode || '');
  const [phone, setPhone] = useState(worker?.phone || '');
  const [identityNumber, setIdentityNumber] = useState(worker?.identityNumber || '');
  const [roleName, setRoleName] = useState(worker?.roleName || '');
  const [contractorId, setContractorId] = useState(worker?.contractorId || '');
  const [teamName, setTeamName] = useState(worker?.teamName || '');
  const [photoAttachment, setPhotoAttachment] = useState<SafetyAttachment | null>(worker?.photoAttachment || null);
  const [identityAttachments, setIdentityAttachments] = useState<SafetyAttachment[]>(worker?.identityAttachments || []);
  const [documentName, setDocumentName] = useState('');
  const [certificateTypeId, setCertificateTypeId] = useState('');
  const [certificateNo, setCertificateNo] = useState('');
  const [certificateExpiry, setCertificateExpiry] = useState('');
  const [certificateAttachment, setCertificateAttachment] = useState<SafetyAttachment | null>(null);
  const [types, setTypes] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    safetyPassportService.listCertificateTypes().then(setTypes).catch(() => setTypes([]));
  }, []);

  const upload = async (file: File, category: string) => safetyPassportService.uploadAttachment({
    workerId: worker?.id || 'draft',
    category,
    file,
    uploadedBy: currentUser.name || currentUser.username,
  });

  const save = async () => {
    if (!fullName.trim()) return;
    setSaving(true);
    try {
      const saved = await safetyPassportService.upsertWorkerProfile({
        id: worker?.id,
        fullName: fullName.trim(),
        workerCode: workerCode.trim() || undefined,
        phone: phone.trim() || null,
        identityNumber: identityNumber.trim() || null,
        identityType: 'cccd',
        contractorId: contractorId || null,
        teamName: teamName.trim() || null,
        roleName: roleName.trim() || null,
        photoAttachment,
        identityAttachments,
        status: worker?.status || 'active',
        createdBy: worker?.createdBy || currentUser.id,
        updatedBy: currentUser.id,
      });

      if (documentName.trim()) {
        await safetyPassportService.upsertWorkerDocument({
          workerId: saved.id,
          documentType: 'identity',
          name: documentName.trim(),
          attachments: identityAttachments,
          status: identityAttachments.length ? 'submitted' : 'missing',
          isRequired: true,
          createdBy: currentUser.id,
        });
      }

      if (certificateTypeId) {
        await safetyPassportService.upsertWorkerCertificate({
          workerId: saved.id,
          certificateTypeId,
          certificateNo: certificateNo.trim() || null,
          expiryDate: certificateExpiry || null,
          attachments: certificateAttachment ? [certificateAttachment] : [],
          status: 'submitted',
          createdBy: currentUser.id,
        });
      }

      onSaved(await safetyPassportService.getWorkerProfile(saved.id) || saved);
      toast.success('Đã lưu hồ sơ nhân công');
      onClose();
    } catch (error: any) {
      toast.error('Không lưu được hồ sơ nhân công', error?.message || 'Có lỗi xảy ra');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={worker ? 'Sửa hồ sơ nhân công' : 'Tạo hồ sơ nhân công'}
      eyebrow="Safety Passport"
      onClose={onClose}
      footer={<><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Hủy</button><button type="button" disabled={saving} onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white"><Save size={14} /> Lưu</button></>}
    >
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Họ tên</label>
            <input value={fullName} onChange={event => setFullName(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" required />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Mã nhân công</label>
            <input value={workerCode} onChange={event => setWorkerCode(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Tự sinh nếu bỏ trống" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">CCCD/giấy tờ</label>
            <input value={identityNumber} onChange={event => setIdentityNumber(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Điện thoại</label>
            <input value={phone} onChange={event => setPhone(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Nhà thầu/tổ đội</label>
            <select value={contractorId} onChange={event => setContractorId(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
              <option value="">Chưa chọn</option>
              {contractors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Tổ đội / vai trò</label>
            <div className="grid grid-cols-2 gap-2">
              <input value={teamName} onChange={event => setTeamName(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Tổ đội" />
              <input value={roleName} onChange={event => setRoleName(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Vai trò" />
            </div>
          </div>
        </div>
        <div className="grid gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 md:grid-cols-2">
          <div>
            <div className="mb-2 text-[10px] font-black uppercase text-slate-400">Ảnh nhân công</div>
            <FilePicker label={photoAttachment ? 'Đổi ảnh' : 'Tải ảnh'} onPick={async file => setPhotoAttachment(await upload(file, 'photo'))} />
            {photoAttachment && <div className="mt-2 text-xs font-bold text-emerald-600">{photoAttachment.name}</div>}
          </div>
          <div>
            <div className="mb-2 text-[10px] font-black uppercase text-slate-400">File CCCD/giấy tờ</div>
            <FilePicker label="Tải giấy tờ" onPick={async file => {
              const attachment = await upload(file, 'identity');
              setIdentityAttachments(prev => [...prev, attachment]);
            }} />
            <div className="mt-2 text-xs font-bold text-slate-500">{identityAttachments.length} file</div>
          </div>
        </div>
        <div className="grid gap-3 rounded-lg border border-slate-100 p-3 md:grid-cols-2">
          <div>
            <div className="mb-2 text-[10px] font-black uppercase text-slate-400">Hồ sơ bổ sung</div>
            <input value={documentName} onChange={event => setDocumentName(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="VD: Giấy khám sức khỏe" />
          </div>
          <div>
            <div className="mb-2 text-[10px] font-black uppercase text-slate-400">Chứng chỉ</div>
            <div className="grid gap-2 md:grid-cols-3">
              <select value={certificateTypeId} onChange={event => setCertificateTypeId(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
                <option value="">Chọn loại</option>
                {types.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <input value={certificateNo} onChange={event => setCertificateNo(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Số chứng chỉ" />
              <input type="date" value={certificateExpiry} onChange={event => setCertificateExpiry(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
            </div>
            <div className="mt-2">
              <FilePicker label={certificateAttachment ? 'Đổi file chứng chỉ' : 'Tải chứng chỉ'} onPick={async file => setCertificateAttachment(await upload(file, 'certificate'))} />
            </div>
          </div>
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
  const cards = useSafetyCards(projectId, constructionSiteId);
  const [contractorModal, setContractorModal] = useState<SafetyPassportContractor | null | 'new'>(null);
  const [workerModal, setWorkerModal] = useState<SafetyWorkerProfile | null | 'new'>(null);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState<any>(null);

  const reloadAll = async () => {
    await Promise.all([dashboard.reload(), contractors.reload(), workers.reload(), assignments.reload(), cards.reload()]);
  };

  const issueCard = async (assignment: SafetyProjectAssignment) => {
    try {
      const card = await safetyPassportService.issueSafetyCard({ assignment, expiresAt: nextYearIso(), createdBy: currentUser.id });
      cards.setData(prev => [card, ...prev]);
      toast.success('Đã cấp thẻ an toàn');
    } catch (error: any) {
      toast.error('Không cấp được thẻ', error?.message || 'Có lỗi xảy ra');
    }
  };

  const printCard = async (card: any) => {
    await safetyPassportService.logCardPrint(card, currentUser.id).catch(() => undefined);
    window.print();
  };

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
        <div className="mt-3 flex justify-end">{canManage && <button onClick={() => setWorkerModal(item)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-blue-600 hover:bg-blue-50">Sửa</button>}</div>
      </div>
    );
    return (
      <section className="space-y-4">
        <div className="flex justify-end">{canManage && <button onClick={() => setWorkerModal('new')} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white"><Plus size={14} /> Tạo hồ sơ</button>}</div>
        {workers.data.length === 0 ? <EmptyState icon={<UserRound size={18} />} title="Chưa có hồ sơ nhân công" message="Tạo hồ sơ gốc một lần để tái sử dụng ở nhiều công trình." /> : (
          <>
            <div className="md:hidden"><MobileCardList items={workers.data} getKey={item => item.id} renderItem={item => renderWorker(item, false)} /></div>
            <div className="hidden grid-cols-2 gap-3 md:grid xl:grid-cols-3">{workers.data.map(item => <div key={item.id}>{renderWorker(item)}</div>)}</div>
          </>
        )}
        {workerModal && <WorkerModal worker={workerModal === 'new' ? null : workerModal} contractors={contractors.data} currentUser={currentUser} onClose={() => setWorkerModal(null)} onSaved={saved => workers.setData(prev => [saved, ...prev.filter(item => item.id !== saved.id)])} />}
      </section>
    );
  }

  if (mode === 'passportAssignments') {
    const renderAssignment = (item: SafetyProjectAssignment, framed = true) => (
      <div className={framed ? 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm' : ''}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] font-black text-orange-600">{item.worker?.workerCode || '-'}</div>
            <h3 className="mt-1 text-sm font-black text-slate-800">{item.worker?.fullName || item.workerId}</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">{item.contractor?.name || item.teamName || '-'} · {item.roleName || '-'}</p>
          </div>
          <StatusBadge status={item.eligibilityStatus} label={getSafetyAssignmentStatusLabel(item.eligibilityStatus)} tone={statusTone(item.eligibilityStatus)} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold text-slate-500">
          <div>Nội quy: {item.siteTrainingStatus}</div>
          <div>Cam kết: {item.commitmentStatus}</div>
          <div>PPE: {item.ppeStatus}</div>
          <div>Toolbox: {item.toolboxStatus}</div>
        </div>
        {canManage && item.eligibilityStatus === 'eligible' && (
          <div className="mt-3 flex justify-end"><button onClick={() => issueCard(item)} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700"><CreditCard size={13} /> Cấp thẻ</button></div>
        )}
      </div>
    );
    return (
      <section className="space-y-4">
        <div className="flex justify-end">{canManage && <button onClick={() => setShowAssignmentModal(true)} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white"><Plus size={14} /> Gán nhân công</button>}</div>
        {assignments.data.length === 0 ? <EmptyState icon={<HardHat size={18} />} title="Chưa có nhân công công trình" message="Gán hồ sơ Safety Passport vào công trình để kiểm tra điều kiện." /> : (
          <>
            <div className="md:hidden"><MobileCardList items={assignments.data} getKey={item => item.id} renderItem={item => renderAssignment(item, false)} /></div>
            <div className="hidden grid-cols-2 gap-3 md:grid xl:grid-cols-3">{assignments.data.map(item => <div key={item.id}>{renderAssignment(item)}</div>)}</div>
          </>
        )}
        {showAssignmentModal && <AssignmentModal projectId={projectId} constructionSiteId={constructionSiteId} workers={workers.data} contractors={contractors.data} currentUser={currentUser} onClose={() => setShowAssignmentModal(false)} onSaved={saved => assignments.setData(prev => [saved, ...prev.filter(item => item.id !== saved.id)])} />}
      </section>
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
