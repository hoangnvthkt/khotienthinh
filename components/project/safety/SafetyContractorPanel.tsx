import React, { useEffect, useState } from 'react';
import { Edit2, Eye, HardHat, Plus, Save, Trash2, X } from 'lucide-react';
import { SafetyAttachment, SafetyContractorStatus, SafetySubcontractor, User, BusinessPartner } from '../../../types';
import { EmptyState, MobileCardList, StatusBadge } from '../../erp';
import { SAFETY_CONTRACTOR_STATUS_LABELS, getSafetyContractorTone } from '../../../lib/safetyWorkflow';
import { partnerService } from '../../../lib/partnerService';
import SafetyAttachmentUploader from './SafetyAttachmentUploader';
import SafetyAttachmentList from './SafetyAttachmentList';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
  contractors: SafetySubcontractor[];
  currentUser: User;
  canManage?: boolean;
  loading?: boolean;
  onSave: (input: Partial<SafetySubcontractor> & { projectId: string; name: string }) => Promise<void>;
  onDelete?: (contractor: SafetySubcontractor) => Promise<void>;
  onPreviewAttachment?: (attachments: SafetyAttachment[], index: number) => void;
}

const statusOptions: SafetyContractorStatus[] = ['pending_documents', 'approved', 'active', 'suspended', 'completed'];

const ContractorForm: React.FC<{
  projectId: string;
  constructionSiteId?: string | null;
  currentUser: User;
  contractor: SafetySubcontractor | null;
  onClose: () => void;
  onSave: Props['onSave'];
  onPreviewAttachment?: Props['onPreviewAttachment'];
}> = ({ projectId, constructionSiteId, currentUser, contractor, onClose, onSave, onPreviewAttachment }) => {
  const [tempId] = useState(() => contractor?.id || `draft-${crypto.randomUUID()}`);
  const [name, setName] = useState('');
  const [representativeName, setRepresentativeName] = useState('');
  const [representativePhone, setRepresentativePhone] = useState('');
  const [workScope, setWorkScope] = useState('');
  const [status, setStatus] = useState<SafetyContractorStatus>('pending_documents');
  const [documentsStatus, setDocumentsStatus] = useState<'missing' | 'partial' | 'complete'>('missing');
  const [attachments, setAttachments] = useState<SafetyAttachment[]>([]);
  const [saving, setSaving] = useState(false);

  // Đối tác kinh doanh
  const [partners, setPartners] = useState<BusinessPartner[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    partnerService.list()
      .then(setPartners)
      .catch(err => console.warn('Không tải được danh sách đối tác', err));
  }, []);

  useEffect(() => {
    if (contractor) {
      setName(contractor.name || '');
      setRepresentativeName(contractor.representativeName || '');
      setRepresentativePhone(contractor.representativePhone || '');
      setWorkScope(contractor.workScope || '');
      setStatus(contractor.status);
      setDocumentsStatus(contractor.documentsStatus);
      setAttachments(contractor.attachments || []);
    }
  }, [contractor]);

  const filteredPartners = partners.filter(p =>
    p.name.toLowerCase().includes(name.toLowerCase())
  );

  const selectPartner = (p: BusinessPartner) => {
    setName(p.name);
    setRepresentativeName(p.contactName || '');
    setRepresentativePhone(p.contactPhone || p.phone || '');
    setShowDropdown(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        id: contractor?.id,
        projectId,
        constructionSiteId: constructionSiteId || null,
        name: name.trim(),
        representativeName: representativeName.trim() || null,
        representativePhone: representativePhone.trim() || null,
        workScope: workScope.trim() || null,
        status,
        documentsStatus,
        attachments,
        createdBy: contractor?.createdBy || currentUser.id,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-6">
      <form onSubmit={submit} className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-[10px] font-black uppercase text-orange-600">Nhà thầu phụ</div>
            <h3 className="mt-1 text-base font-black text-slate-800">
              {contractor ? 'Sửa nhà thầu an toàn' : 'Thêm nhà thầu an toàn'}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="relative md:col-span-2">
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Tên nhà thầu</label>
              <input
                value={name}
                onChange={event => {
                  setName(event.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none"
                placeholder="Nhập tên hoặc chọn đối tác..."
                required
              />
              {showDropdown && name.trim() && filteredPartners.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {filteredPartners.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={() => selectPartner(p)}
                      className="w-full px-4 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                    >
                      <div className="text-slate-800">{p.name}</div>
                      <div className="text-[10px] text-slate-400">Đại diện: {p.contactName || '-'} • SĐT: {p.contactPhone || p.phone || '-'}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Người đại diện</label>
              <input value={representativeName} onChange={event => setRepresentativeName(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Người đại diện" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Số điện thoại</label>
              <input value={representativePhone} onChange={event => setRepresentativePhone(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Số điện thoại" />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Hạng mục thi công</label>
              <input value={workScope} onChange={event => setWorkScope(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Hạng mục thi công" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Trạng thái duyệt</label>
              <select value={status} onChange={event => setStatus(event.target.value as SafetyContractorStatus)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
                {statusOptions.map(option => <option key={option} value={option}>{SAFETY_CONTRACTOR_STATUS_LABELS[option]}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Hồ sơ an toàn</label>
              <select value={documentsStatus} onChange={event => setDocumentsStatus(event.target.value as any)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
                <option value="missing">Thiếu hồ sơ</option>
                <option value="partial">Chưa đủ</option>
                <option value="complete">Đã đủ</option>
              </select>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <SafetyAttachmentUploader
              projectId={projectId}
              recordType="contractor"
              recordId={tempId}
              attachments={attachments}
              onChange={setAttachments}
              uploadedBy={currentUser.name || currentUser.username}
              label="Hồ sơ năng lực / chứng chỉ an toàn đính kèm"
              onPreview={onPreviewAttachment}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Hủy</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white disabled:opacity-50"><Save size={14} /> Lưu</button>
        </div>
      </form>
    </div>
  );
};

const SafetyContractorPanel: React.FC<Props> = ({
  projectId,
  constructionSiteId,
  contractors,
  currentUser,
  canManage,
  loading,
  onSave,
  onDelete,
  onPreviewAttachment,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editingContractor, setEditingContractor] = useState<SafetySubcontractor | null>(null);

  const renderContractor = (contractor: SafetySubcontractor, framed = true) => {
    const listAttachments = contractor.attachments || [];
    return (
      <div className={framed ? 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm relative group' : 'relative group'}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-800">{contractor.name}</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">{contractor.workScope || 'Chưa khai báo hạng mục'}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <StatusBadge status={contractor.status} label={SAFETY_CONTRACTOR_STATUS_LABELS[contractor.status]} tone={getSafetyContractorTone(contractor.status)} />
            <StatusBadge
              status={contractor.documentsStatus}
              label={contractor.documentsStatus === 'complete' ? 'Đủ hồ sơ' : contractor.documentsStatus === 'partial' ? 'Chưa đủ hồ sơ' : 'Thiếu hồ sơ'}
              tone={contractor.documentsStatus === 'complete' ? 'success' : 'warning'}
            />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500 border-t border-slate-50 pt-2">
          <div>Đại diện: {contractor.representativeName || '-'}</div>
          <div>SĐT: {contractor.representativePhone || '-'}</div>
          <div className="col-span-2">Vi phạm: {contractor.violationCount || 0}</div>
        </div>

        <SafetyAttachmentList
          label="Tài liệu đính kèm"
          attachments={listAttachments}
          onPreview={onPreviewAttachment}
        />

        {(listAttachments.length > 0 || canManage) && (
          <div className="mt-3 flex justify-end gap-1">
            <button
              type="button"
              onClick={() => onPreviewAttachment?.(listAttachments, 0)}
              disabled={listAttachments.length === 0}
              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              title={listAttachments.length > 0 ? 'Xem hồ sơ' : 'Chưa có hồ sơ đính kèm'}
            >
              <Eye size={12} />
            </button>
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditingContractor(contractor);
                    setShowForm(true);
                  }}
                  className="rounded-lg border border-slate-200 bg-white p-1.5 text-blue-600 hover:bg-blue-50 shadow-sm"
                  title="Sửa"
                >
                  <Edit2 size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete?.(contractor)}
                  className="rounded-lg border border-slate-200 bg-white p-1.5 text-red-600 hover:bg-red-50 shadow-sm"
                  title="Xóa"
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="space-y-4">
      <div className="flex justify-end">
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setEditingContractor(null);
              setShowForm(true);
            }}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white"
          >
            <Plus size={14} /> Thêm nhà thầu
          </button>
        )}
      </div>
      {loading ? (
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      ) : contractors.length === 0 ? (
        <EmptyState icon={<HardHat size={18} />} title="Chưa có nhà thầu phụ" message="Thêm nhà thầu để theo dõi hồ sơ an toàn và vi phạm." />
      ) : (
        <>
          <div className="md:hidden">
            <MobileCardList items={contractors} getKey={item => item.id} renderItem={contractor => renderContractor(contractor, false)} />
          </div>
          <div className="hidden grid-cols-2 gap-3 md:grid xl:grid-cols-3">
            {contractors.map(contractor => <div key={contractor.id}>{renderContractor(contractor)}</div>)}
          </div>
        </>
      )}
      {showForm && (
        <ContractorForm
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          currentUser={currentUser}
          contractor={editingContractor}
          onClose={() => {
            setShowForm(false);
            setEditingContractor(null);
          }}
          onSave={onSave}
          onPreviewAttachment={onPreviewAttachment}
        />
      )}
    </section>
  );
};

export default SafetyContractorPanel;
