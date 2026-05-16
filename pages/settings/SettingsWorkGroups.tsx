import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Edit2, Plus, Save, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { WorkGroup, WorkGroupMember, WorkGroupMemberRole, WorkGroupWithMembers } from '../../types';
import { workGroupService } from '../../lib/workGroupService';

const emptyGroup = (): WorkGroup => ({
  id: '',
  code: '',
  name: '',
  description: '',
  sortOrder: 0,
  isActive: true,
});

const SettingsWorkGroups: React.FC = () => {
  const { users } = useApp();
  const [groups, setGroups] = useState<WorkGroupWithMembers[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkGroup>(emptyGroup);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [memberUserId, setMemberUserId] = useState('');
  const [memberRole, setMemberRole] = useState<WorkGroupMemberRole>('member');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await workGroupService.listGroupsWithMembers({ activeOnly: false, memberActiveOnly: false });
      setGroups(rows);
      setActiveGroupId(current => current && rows.some(group => group.id === current) ? current : rows[0]?.id || null);
    } catch (error: any) {
      alert(`Không tải được nhóm làm việc: ${error?.message || 'Lỗi không xác định'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeUsers = useMemo(() => users.filter(user => user.isActive !== false), [users]);
  const userMap = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  const activeGroup = useMemo(
    () => groups.find(group => group.id === activeGroupId) || null,
    [groups, activeGroupId]
  );
  const availableUsers = useMemo(() => {
    const activeMemberIds = new Set((activeGroup?.members || []).filter(member => member.isActive).map(member => member.userId));
    return activeUsers.filter(user => !activeMemberIds.has(user.id));
  }, [activeGroup, activeUsers]);

  const resetDraft = () => {
    setDraft(emptyGroup());
    setEditingId(null);
  };

  const openEdit = (group: WorkGroup) => {
    setDraft({ ...group });
    setEditingId(group.id);
  };

  const saveGroup = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      if (editingId) await workGroupService.updateGroup(draft);
      else await workGroupService.createGroup(draft);
      resetDraft();
      await load();
    } catch (error: any) {
      alert(`Không lưu được nhóm làm việc: ${error?.message || 'Lỗi không xác định'}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleGroupActive = async (group: WorkGroupWithMembers) => {
    try {
      await workGroupService.updateGroup({ ...group, isActive: !group.isActive });
      await load();
    } catch (error: any) {
      alert(`Không cập nhật trạng thái nhóm: ${error?.message || 'Lỗi không xác định'}`);
    }
  };

  const removeGroup = async (group: WorkGroupWithMembers) => {
    if (!confirm(`Xóa nhóm làm việc "${group.name}"? Thành viên trong nhóm cũng sẽ bị xóa khỏi danh mục nhóm.`)) return;
    try {
      await workGroupService.removeGroup(group.id);
      if (editingId === group.id) resetDraft();
      await load();
    } catch (error: any) {
      alert(`Không xóa được nhóm làm việc: ${error?.message || 'Lỗi không xác định'}`);
    }
  };

  const addMember = async () => {
    if (!activeGroup || !memberUserId) return;
    try {
      await workGroupService.addMember(activeGroup.id, memberUserId, memberRole);
      setMemberUserId('');
      setMemberRole('member');
      await load();
    } catch (error: any) {
      alert(`Không thêm được thành viên: ${error?.message || 'Lỗi không xác định'}`);
    }
  };

  const updateMember = async (member: WorkGroupMember, updates: { memberRole?: WorkGroupMemberRole; isActive?: boolean }) => {
    try {
      await workGroupService.updateMember(member.id, updates);
      await load();
    } catch (error: any) {
      alert(`Không cập nhật được thành viên: ${error?.message || 'Lỗi không xác định'}`);
    }
  };

  const removeMember = async (member: WorkGroupMember) => {
    const targetUser = userMap.get(member.userId);
    if (!confirm(`Xóa ${targetUser?.name || targetUser?.email || member.userId} khỏi nhóm?`)) return;
    try {
      await workGroupService.removeMember(member.id);
      await load();
    } catch (error: any) {
      alert(`Không xóa được thành viên: ${error?.message || 'Lỗi không xác định'}`);
    }
  };

  const renderUserName = (userId: string) => {
    const targetUser = userMap.get(userId);
    return targetUser?.name || targetUser?.username || targetUser?.email || userId;
  };

  return (
    <div className="animate-in slide-in-from-right-4 duration-300">
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden min-h-[620px]">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl bg-cyan-50 text-cyan-600 flex items-center justify-center">
              <Users size={22} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800">Nhóm làm việc</h2>
              <p className="text-xs text-slate-500 font-medium">Tạo nhóm user linh hoạt để tag nhanh vào dự án.</p>
            </div>
          </div>
          {loading && <span className="text-xs font-bold text-slate-400">Đang tải...</span>}
        </div>

        <div className="p-8 grid grid-cols-1 xl:grid-cols-[390px_1fr] gap-6">
          <div className="space-y-6">
            <div className="bg-slate-50 p-5 rounded-3xl border border-slate-200 space-y-4">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                {editingId ? 'Cập nhật nhóm' : 'Thêm nhóm mới'}
              </h3>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Tên nhóm</label>
                <input
                  value={draft.name}
                  onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="VD: Ban chỉ huy công trường"
                  className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-cyan-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Mã</label>
                  <input
                    value={draft.code || ''}
                    onChange={e => setDraft(prev => ({ ...prev, code: e.target.value }))}
                    placeholder="Tự sinh nếu trống"
                    className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-cyan-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Thứ tự</label>
                  <input
                    type="number"
                    value={draft.sortOrder}
                    onChange={e => setDraft(prev => ({ ...prev, sortOrder: Number(e.target.value) || 0 }))}
                    className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-cyan-400"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Mô tả</label>
                <textarea
                  rows={3}
                  value={draft.description || ''}
                  onChange={e => setDraft(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Mục đích hoặc phạm vi sử dụng nhóm..."
                  className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-cyan-400 resize-none"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={e => setDraft(prev => ({ ...prev, isActive: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                Đang sử dụng
              </label>
              <div className="flex gap-2">
                {editingId && (
                  <button
                    onClick={resetDraft}
                    className="px-4 py-3 rounded-2xl border border-slate-200 text-xs font-black text-slate-500 hover:bg-white transition"
                  >
                    Hủy
                  </button>
                )}
                <button
                  onClick={saveGroup}
                  disabled={!draft.name.trim() || saving}
                  className="flex-1 px-5 py-3 rounded-2xl text-xs font-black text-white disabled:opacity-50 bg-cyan-500 hover:bg-cyan-600 flex items-center justify-center gap-2 transition"
                >
                  {editingId ? <Save size={15} /> : <Plus size={15} />}
                  {saving ? 'Đang lưu...' : editingId ? 'Cập nhật' : 'Thêm mới'}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {groups.length === 0 ? (
                <div className="p-8 rounded-3xl border border-dashed border-slate-200 text-center text-sm font-bold text-slate-400">
                  Chưa có nhóm làm việc
                </div>
              ) : groups.map(group => {
                const activeCount = group.members.filter(member => member.isActive).length;
                return (
                  <button
                    key={group.id}
                    onClick={() => setActiveGroupId(group.id)}
                    className={`w-full text-left p-4 rounded-3xl border transition ${activeGroupId === group.id ? 'bg-cyan-50 border-cyan-200 shadow-sm' : 'bg-white border-slate-100 hover:border-slate-200 hover:shadow-sm'} ${group.isActive ? '' : 'opacity-70'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-black text-slate-800">{group.name}</span>
                          {group.code && <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-slate-100 text-slate-500">{group.code}</span>}
                          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${group.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>
                            {group.isActive ? 'Đang dùng' : 'Đã ẩn'}
                          </span>
                        </div>
                        {group.description && <p className="mt-1 text-xs font-medium text-slate-400">{group.description}</p>}
                        <p className="mt-1 text-[10px] font-bold text-slate-400">{activeCount} thành viên đang dùng</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={e => { e.stopPropagation(); openEdit(group); }}
                          className="p-2 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition"
                        >
                          <Edit2 size={15} />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={e => { e.stopPropagation(); toggleGroupActive(group); }}
                          className="p-2 rounded-xl text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition"
                        >
                          <Archive size={15} />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={e => { e.stopPropagation(); removeGroup(group); }}
                          className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                        >
                          <Trash2 size={15} />
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
              <div>
                <h3 className="text-sm font-black text-slate-800">
                  {activeGroup ? `Thành viên: ${activeGroup.name}` : 'Thành viên nhóm'}
                </h3>
                <p className="text-xs font-medium text-slate-400">Danh sách này được bung ra thành user khi tạo dự án.</p>
              </div>
              <span className="text-xs font-black text-slate-400">{activeGroup?.members.filter(member => member.isActive).length || 0} active</span>
            </div>

            {activeGroup ? (
              <div className="p-5 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_auto] gap-3">
                  <select
                    value={memberUserId}
                    onChange={e => setMemberUserId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-cyan-400"
                  >
                    <option value="">{availableUsers.length === 0 ? 'Không còn user để thêm' : 'Chọn user'}</option>
                    {availableUsers.map(targetUser => (
                      <option key={targetUser.id} value={targetUser.id}>{targetUser.name || targetUser.username || targetUser.email}</option>
                    ))}
                  </select>
                  <select
                    value={memberRole}
                    onChange={e => setMemberRole(e.target.value as WorkGroupMemberRole)}
                    className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-cyan-400"
                  >
                    <option value="member">Thành viên</option>
                    <option value="lead">Trưởng nhóm</option>
                  </select>
                  <button
                    onClick={addMember}
                    disabled={!memberUserId}
                    className="px-5 py-3 rounded-2xl text-xs font-black text-white disabled:opacity-50 bg-cyan-500 hover:bg-cyan-600 flex items-center justify-center gap-2 transition"
                  >
                    <UserPlus size={15} />
                    Thêm
                  </button>
                </div>

                <div className="space-y-3">
                  {activeGroup.members.length === 0 ? (
                    <div className="p-10 rounded-3xl border border-dashed border-slate-200 text-center text-sm font-bold text-slate-400">
                      Nhóm chưa có thành viên
                    </div>
                  ) : activeGroup.members.map(member => {
                    const targetUser = userMap.get(member.userId);
                    const displayName = renderUserName(member.userId);
                    return (
                      <div key={member.id} className={`p-4 rounded-3xl border flex flex-col md:flex-row md:items-center justify-between gap-4 ${member.isActive ? 'border-slate-100 bg-white' : 'border-slate-200 bg-slate-50 opacity-75'}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          {targetUser?.avatar ? (
                            <img src={targetUser.avatar} className="w-10 h-10 rounded-2xl object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-2xl bg-cyan-50 text-cyan-600 flex items-center justify-center text-sm font-black">
                              {displayName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-black text-slate-800 truncate">{displayName}</span>
                              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${member.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>
                                {member.isActive ? 'Active' : 'Ẩn'}
                              </span>
                            </div>
                            <p className="text-xs font-medium text-slate-400 truncate">{targetUser?.email || member.userId}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <select
                            value={member.memberRole}
                            onChange={e => updateMember(member, { memberRole: e.target.value as WorkGroupMemberRole })}
                            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-cyan-400"
                          >
                            <option value="member">Thành viên</option>
                            <option value="lead">Trưởng nhóm</option>
                          </select>
                          <button
                            onClick={() => updateMember(member, { isActive: !member.isActive })}
                            className="p-2 rounded-xl text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition"
                            title={member.isActive ? 'Ẩn thành viên' : 'Hiện thành viên'}
                          >
                            <Archive size={15} />
                          </button>
                          <button
                            onClick={() => removeMember(member)}
                            className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                            title="Xóa khỏi nhóm"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-12 text-center">
                <X size={28} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm font-bold text-slate-400">Chọn hoặc tạo nhóm để quản lý thành viên</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsWorkGroups;
