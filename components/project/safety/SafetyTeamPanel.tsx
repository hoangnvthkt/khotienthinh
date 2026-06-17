import React, { useEffect, useState } from 'react';
import { Edit2, Eye, Plus, Save, Trash2, Users, X } from 'lucide-react';
import { SafetyAttachment, SafetyTeam, User } from '../../../types';
import { EmptyState, MobileCardList, StatusBadge } from '../../erp';
import SafetyAttachmentUploader from './SafetyAttachmentUploader';
import SafetyAttachmentList from './SafetyAttachmentList';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
  teams: SafetyTeam[];
  currentUser: User;
  canManage?: boolean;
  loading?: boolean;
  onSave: (input: Partial<SafetyTeam> & { projectId: string; name: string }) => Promise<void>;
  onDelete?: (team: SafetyTeam) => Promise<void>;
  onPreviewAttachment?: (attachments: SafetyAttachment[], index: number) => void;
}

const statusOptions: Array<SafetyTeam['status']> = ['active', 'inactive', 'suspended'];

const statusLabels: Record<SafetyTeam['status'], string> = {
  active: 'Đang hoạt động',
  inactive: 'Ngừng hoạt động',
  suspended: 'Tạm dừng',
};

const getStatusTone = (status: SafetyTeam['status']) => {
  if (status === 'active') return 'success';
  if (status === 'suspended') return 'danger';
  return 'neutral';
};

const TeamForm: React.FC<{
  projectId: string;
  constructionSiteId?: string | null;
  currentUser: User;
  team: SafetyTeam | null;
  onClose: () => void;
  onSave: Props['onSave'];
  onPreviewAttachment?: Props['onPreviewAttachment'];
}> = ({ projectId, constructionSiteId, currentUser, team, onClose, onSave, onPreviewAttachment }) => {
  const [tempId] = useState(() => team?.id || `draft-${crypto.randomUUID()}`);
  const [name, setName] = useState('');
  const [supervisorName, setSupervisorName] = useState('');
  const [supervisorPhone, setSupervisorPhone] = useState('');
  const [status, setStatus] = useState<SafetyTeam['status']>('active');
  const [note, setNote] = useState('');
  const [attachments, setAttachments] = useState<SafetyAttachment[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (team) {
      setName(team.name || '');
      setSupervisorName(team.supervisorName || '');
      setSupervisorPhone(team.supervisorPhone || '');
      setStatus(team.status);
      setNote(team.note || '');
      setAttachments(team.attachments || []);
    }
  }, [team]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        id: team?.id,
        projectId,
        constructionSiteId: constructionSiteId || null,
        name: name.trim(),
        supervisorName: supervisorName.trim() || null,
        supervisorPhone: supervisorPhone.trim() || null,
        status,
        note: note.trim() || null,
        attachments,
        createdBy: team?.createdBy || currentUser.id,
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
            <div className="text-[10px] font-black uppercase text-orange-600">Tổ đội thi công</div>
            <h3 className="mt-1 text-base font-black text-slate-800">
              {team ? 'Sửa tổ đội an toàn' : 'Thêm tổ đội an toàn'}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Tên tổ đội</label>
              <input
                value={name}
                onChange={event => setName(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none"
                placeholder="Nhập tên tổ đội (VD: Tổ sắt 1)..."
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Tổ trưởng / Giám sát</label>
              <input value={supervisorName} onChange={event => setSupervisorName(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Họ và tên" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Số điện thoại</label>
              <input value={supervisorPhone} onChange={event => setSupervisorPhone(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Số điện thoại" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Trạng thái hoạt động</label>
              <select value={status} onChange={event => setStatus(event.target.value as SafetyTeam['status'])} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
                {statusOptions.map(option => <option key={option} value={option}>{statusLabels[option]}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Ghi chú</label>
              <textarea rows={2} value={note} onChange={event => setNote(event.target.value)} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Thông tin bổ sung..." />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <SafetyAttachmentUploader
              projectId={projectId}
              recordType="team"
              recordId={tempId}
              attachments={attachments}
              onChange={setAttachments}
              uploadedBy={currentUser.name || currentUser.username}
              label="Hồ sơ danh sách công nhân / cam kết an toàn"
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

const SafetyTeamPanel: React.FC<Props> = ({
  projectId,
  constructionSiteId,
  teams,
  currentUser,
  canManage,
  loading,
  onSave,
  onDelete,
  onPreviewAttachment,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editingTeam, setEditingTeam] = useState<SafetyTeam | null>(null);

  const renderTeam = (team: SafetyTeam, framed = true) => {
    const listAttachments = team.attachments || [];
    return (
      <div className={framed ? 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm relative group' : 'relative group'}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-800">{team.name}</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">{team.note || 'Tổ đội tại công trường'}</p>
          </div>
          <StatusBadge status={team.status} label={statusLabels[team.status]} tone={getStatusTone(team.status)} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500 border-t border-slate-50 pt-2">
          <div>Tổ trưởng: {team.supervisorName || '-'}</div>
          <div>SĐT: {team.supervisorPhone || '-'}</div>
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
                    setEditingTeam(team);
                    setShowForm(true);
                  }}
                  className="rounded-lg border border-slate-200 bg-white p-1.5 text-blue-600 hover:bg-blue-50 shadow-sm"
                  title="Sửa"
                >
                  <Edit2 size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete?.(team)}
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
              setEditingTeam(null);
              setShowForm(true);
            }}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white"
          >
            <Plus size={14} /> Thêm tổ đội
          </button>
        )}
      </div>
      {loading ? (
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      ) : teams.length === 0 ? (
        <EmptyState icon={<Users size={18} />} title="Chưa có tổ đội thi công" message="Thêm tổ đội an toàn tự do tại công trường để quản lý." />
      ) : (
        <>
          <div className="md:hidden">
            <MobileCardList items={teams} getKey={item => item.id} renderItem={team => renderTeam(team, false)} />
          </div>
          <div className="hidden grid-cols-2 gap-3 md:grid xl:grid-cols-3">
            {teams.map(team => <div key={team.id}>{renderTeam(team)}</div>)}
          </div>
        </>
      )}
      {showForm && (
        <TeamForm
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          currentUser={currentUser}
          team={editingTeam}
          onClose={() => {
            setShowForm(false);
            setEditingTeam(null);
          }}
          onSave={onSave}
          onPreviewAttachment={onPreviewAttachment}
        />
      )}
    </section>
  );
};

export default SafetyTeamPanel;
