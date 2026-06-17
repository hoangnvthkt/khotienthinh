import React, { useEffect, useState } from 'react';
import { Edit2, Eye, Plus, Save, Trash2, Truck, X } from 'lucide-react';
import { SafetyAttachment, SafetyEquipment, SafetyEquipmentStatus, User } from '../../../types';
import { EmptyState, MobileCardList, StatusBadge } from '../../erp';
import { SAFETY_EQUIPMENT_STATUS_LABELS, getSafetyEquipmentTone } from '../../../lib/safetyWorkflow';
import SafetyAttachmentUploader from './SafetyAttachmentUploader';
import SafetyAttachmentList from './SafetyAttachmentList';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
  equipment: SafetyEquipment[];
  currentUser: User;
  canManage?: boolean;
  loading?: boolean;
  onSave: (input: Partial<SafetyEquipment> & { projectId: string; name: string }) => Promise<void>;
  onDelete?: (item: SafetyEquipment) => Promise<void>;
  onPreviewAttachment?: (attachments: SafetyAttachment[], index: number) => void;
}

const statusOptions: SafetyEquipmentStatus[] = ['pending_review', 'approved', 'active', 'expired', 'suspended', 'removed'];

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
};

const EquipmentForm: React.FC<{
  projectId: string;
  constructionSiteId?: string | null;
  currentUser: User;
  equipment: SafetyEquipment | null;
  onClose: () => void;
  onSave: Props['onSave'];
  onPreviewAttachment?: Props['onPreviewAttachment'];
}> = ({ projectId, constructionSiteId, currentUser, equipment, onClose, onSave, onPreviewAttachment }) => {
  const [tempId] = useState(() => equipment?.id || `draft-${crypto.randomUUID()}`);
  const [name, setName] = useState('');
  const [equipmentCode, setEquipmentCode] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [inspectionExpiryDate, setInspectionExpiryDate] = useState('');
  const [status, setStatus] = useState<SafetyEquipmentStatus>('pending_review');
  const [documentsStatus, setDocumentsStatus] = useState<'missing' | 'partial' | 'complete'>('missing');
  const [attachments, setAttachments] = useState<SafetyAttachment[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (equipment) {
      setName(equipment.name || '');
      setEquipmentCode(equipment.equipmentCode || '');
      setOwnerName(equipment.ownerName || '');
      setOperatorName(equipment.operatorName || '');
      setInspectionExpiryDate(equipment.inspectionExpiryDate || '');
      setStatus(equipment.status);
      setDocumentsStatus(equipment.documentsStatus);
      setAttachments(equipment.attachments || []);
    }
  }, [equipment]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        id: equipment?.id,
        projectId,
        constructionSiteId: constructionSiteId || null,
        name: name.trim(),
        equipmentCode: equipmentCode.trim() || null,
        ownerName: ownerName.trim() || null,
        operatorName: operatorName.trim() || null,
        inspectionExpiryDate: inspectionExpiryDate || null,
        status,
        documentsStatus,
        attachments,
        createdBy: equipment?.createdBy || currentUser.id,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-6">
      <form onSubmit={submit} className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-[10px] font-black uppercase text-orange-600">Máy móc / thiết bị</div>
            <h3 className="mt-1 text-base font-black text-slate-800">
              {equipment ? 'Sửa thiết bị công trường' : 'Thêm thiết bị vào công trường'}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Tên thiết bị</label>
              <input value={name} onChange={event => setName(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Tên máy móc / thiết bị" required />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Mã thiết bị</label>
              <input value={equipmentCode} onChange={event => setEquipmentCode(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Mã thiết bị / biển số" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Chủ sở hữu</label>
              <input value={ownerName} onChange={event => setOwnerName(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Chủ sở hữu" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Người vận hành</label>
              <input value={operatorName} onChange={event => setOperatorName(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Họ tên người vận hành" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Hạn kiểm định</label>
              <input type="date" value={inspectionExpiryDate} onChange={event => setInspectionExpiryDate(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Trạng thái thiết bị</label>
              <select value={status} onChange={event => setStatus(event.target.value as SafetyEquipmentStatus)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
                {statusOptions.map(option => <option key={option} value={option}>{SAFETY_EQUIPMENT_STATUS_LABELS[option]}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Hồ sơ thiết bị</label>
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
              recordType="equipment"
              recordId={tempId}
              attachments={attachments}
              onChange={setAttachments}
              uploadedBy={currentUser.name || currentUser.username}
              label="Hồ sơ kiểm định / ảnh thiết bị"
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

const SafetyEquipmentPanel: React.FC<Props> = ({
  projectId,
  constructionSiteId,
  equipment,
  currentUser,
  canManage,
  loading,
  onSave,
  onDelete,
  onPreviewAttachment,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<SafetyEquipment | null>(null);

  const renderEquipment = (item: SafetyEquipment, framed = true) => {
    const listAttachments = item.attachments || [];
    return (
      <div className={framed ? 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm relative group' : 'relative group'}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] font-black text-orange-600">{item.equipmentCode || 'NO-CODE'}</div>
            <h3 className="mt-1 text-sm font-black text-slate-800">{item.name}</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">Vận hành: {item.operatorName || '-'}</p>
          </div>
          <StatusBadge status={item.status} label={SAFETY_EQUIPMENT_STATUS_LABELS[item.status]} tone={getSafetyEquipmentTone(item.status)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge status="expiry" label={`Hạn kiểm định: ${formatDate(item.inspectionExpiryDate)}`} tone={item.inspectionExpiryDate && item.inspectionExpiryDate < new Date().toISOString().slice(0, 10) ? 'danger' : 'neutral'} />
          <StatusBadge status={item.documentsStatus} label={item.documentsStatus === 'complete' ? 'Đủ hồ sơ' : 'Thiếu hồ sơ'} tone={item.documentsStatus === 'complete' ? 'success' : 'warning'} />
        </div>

        <SafetyAttachmentList
          label="Hồ sơ kiểm định"
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
                    setEditingEquipment(item);
                    setShowForm(true);
                  }}
                  className="rounded-lg border border-slate-200 bg-white p-1.5 text-blue-600 hover:bg-blue-50 shadow-sm"
                  title="Sửa"
                >
                  <Edit2 size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete?.(item)}
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
              setEditingEquipment(null);
              setShowForm(true);
            }}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white"
          >
            <Plus size={14} /> Thêm thiết bị
          </button>
        )}
      </div>
      {loading ? (
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      ) : equipment.length === 0 ? (
        <EmptyState icon={<Truck size={18} />} title="Chưa có thiết bị" message="Thêm thiết bị vào công trường để theo dõi kiểm định và hồ sơ an toàn." />
      ) : (
        <>
          <div className="md:hidden">
            <MobileCardList items={equipment} getKey={item => item.id} renderItem={item => renderEquipment(item, false)} />
          </div>
          <div className="hidden grid-cols-2 gap-3 md:grid xl:grid-cols-3">
            {equipment.map(item => <div key={item.id}>{renderEquipment(item)}</div>)}
          </div>
        </>
      )}
      {showForm && (
        <EquipmentForm
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          currentUser={currentUser}
          equipment={editingEquipment}
          onClose={() => {
            setShowForm(false);
            setEditingEquipment(null);
          }}
          onSave={onSave}
          onPreviewAttachment={onPreviewAttachment}
        />
      )}
    </section>
  );
};

export default SafetyEquipmentPanel;
