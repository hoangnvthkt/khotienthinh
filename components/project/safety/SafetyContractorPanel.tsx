import React, { useState } from 'react';
import { HardHat, Plus, Save, X } from 'lucide-react';
import { SafetyContractorStatus, SafetySubcontractor, User } from '../../../types';
import { EmptyState, MobileCardList, StatusBadge } from '../../erp';
import { SAFETY_CONTRACTOR_STATUS_LABELS, getSafetyContractorTone } from '../../../lib/safetyWorkflow';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
  contractors: SafetySubcontractor[];
  currentUser: User;
  canManage?: boolean;
  loading?: boolean;
  onSave: (input: Partial<SafetySubcontractor> & { projectId: string; name: string }) => Promise<void>;
}

const statusOptions: SafetyContractorStatus[] = ['pending_documents', 'approved', 'active', 'suspended', 'completed'];

const ContractorForm: React.FC<{
  projectId: string;
  constructionSiteId?: string | null;
  currentUser: User;
  onClose: () => void;
  onSave: Props['onSave'];
}> = ({ projectId, constructionSiteId, currentUser, onClose, onSave }) => {
  const [name, setName] = useState('');
  const [representativeName, setRepresentativeName] = useState('');
  const [representativePhone, setRepresentativePhone] = useState('');
  const [workScope, setWorkScope] = useState('');
  const [status, setStatus] = useState<SafetyContractorStatus>('pending_documents');
  const [documentsStatus, setDocumentsStatus] = useState<'missing' | 'partial' | 'complete'>('missing');
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        projectId,
        constructionSiteId: constructionSiteId || null,
        name: name.trim(),
        representativeName: representativeName.trim() || null,
        representativePhone: representativePhone.trim() || null,
        workScope: workScope.trim() || null,
        status,
        documentsStatus,
        createdBy: currentUser.id,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-6">
      <form onSubmit={submit} className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-[10px] font-black uppercase text-orange-600">Nhà thầu phụ</div>
            <h3 className="mt-1 text-base font-black text-slate-800">Thêm nhà thầu an toàn</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Tên nhà thầu</label>
            <input value={name} onChange={event => setName(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
          </div>
          <input value={representativeName} onChange={event => setRepresentativeName(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Người đại diện" />
          <input value={representativePhone} onChange={event => setRepresentativePhone(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Số điện thoại" />
          <input value={workScope} onChange={event => setWorkScope(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none md:col-span-2" placeholder="Hạng mục thi công" />
          <select value={status} onChange={event => setStatus(event.target.value as SafetyContractorStatus)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
            {statusOptions.map(option => <option key={option} value={option}>{SAFETY_CONTRACTOR_STATUS_LABELS[option]}</option>)}
          </select>
          <select value={documentsStatus} onChange={event => setDocumentsStatus(event.target.value as any)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
            <option value="missing">Thiếu hồ sơ</option>
            <option value="partial">Chưa đủ</option>
            <option value="complete">Đã đủ</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Hủy</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white disabled:opacity-50"><Save size={14} /> Lưu</button>
        </div>
      </form>
    </div>
  );
};

const SafetyContractorPanel: React.FC<Props> = ({ projectId, constructionSiteId, contractors, currentUser, canManage, loading, onSave }) => {
  const [showForm, setShowForm] = useState(false);
  const renderContractor = (contractor: SafetySubcontractor, framed = true) => (
    <div className={framed ? 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm' : ''}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-black text-slate-800">{contractor.name}</h3>
          <p className="mt-1 text-xs font-medium text-slate-500">{contractor.workScope || 'Chưa khai báo hạng mục'}</p>
        </div>
        <StatusBadge status={contractor.status} label={SAFETY_CONTRACTOR_STATUS_LABELS[contractor.status]} tone={getSafetyContractorTone(contractor.status)} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500">
        <div>Đại diện: {contractor.representativeName || '-'}</div>
        <div>Vi phạm: {contractor.violationCount || 0}</div>
        <div className="col-span-2">
          <StatusBadge
            status={contractor.documentsStatus}
            label={contractor.documentsStatus === 'complete' ? 'Đủ hồ sơ' : contractor.documentsStatus === 'partial' ? 'Chưa đủ hồ sơ' : 'Thiếu hồ sơ'}
            tone={contractor.documentsStatus === 'complete' ? 'success' : 'warning'}
          />
        </div>
      </div>
    </div>
  );

  return (
    <section className="space-y-4">
      <div className="flex justify-end">
        {canManage && <button type="button" onClick={() => setShowForm(true)} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white"><Plus size={14} /> Thêm nhà thầu</button>}
      </div>
      {loading ? (
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      ) : contractors.length === 0 ? (
        <EmptyState icon={<HardHat size={18} />} title="Chưa có nhà thầu phụ" message="Thêm nhà thầu để theo dõi hồ sơ an toàn và vi phạm." />
      ) : (
        <>
          <MobileCardList items={contractors} getKey={item => item.id} renderItem={contractor => renderContractor(contractor, false)} />
          <div className="hidden grid-cols-2 gap-3 md:grid xl:grid-cols-3">{contractors.map(contractor => <div key={contractor.id}>{renderContractor(contractor)}</div>)}</div>
        </>
      )}
      {showForm && <ContractorForm projectId={projectId} constructionSiteId={constructionSiteId} currentUser={currentUser} onClose={() => setShowForm(false)} onSave={onSave} />}
    </section>
  );
};

export default SafetyContractorPanel;
