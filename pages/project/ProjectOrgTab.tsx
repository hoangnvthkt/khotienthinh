import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users, Plus, Trash2, Edit2, Save, X, Shield, Search, UserPlus,
  ChevronDown, CheckCircle2, XCircle, Calendar, GripVertical
} from 'lucide-react';
import { ProjectStaff, ProjectPermissionType, HrmPosition } from '../../types';
import { projectStaffService, projectPermissionTypeService } from '../../lib/projectStaffService';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
}

const LEVEL_COLORS: Record<number, string> = {
  1: 'from-amber-500 to-orange-600',
  2: 'from-violet-500 to-purple-600',
  3: 'from-blue-500 to-indigo-600',
  4: 'from-emerald-500 to-teal-600',
  5: 'from-slate-400 to-slate-600',
  6: 'from-slate-300 to-slate-500',
};

const LEVEL_BG: Record<number, string> = {
  1: 'bg-amber-50 border-amber-200',
  2: 'bg-violet-50 border-violet-200',
  3: 'bg-blue-50 border-blue-200',
  4: 'bg-emerald-50 border-emerald-200',
  5: 'bg-slate-50 border-slate-200',
  6: 'bg-slate-50 border-slate-100',
};

const ProjectOrgTab: React.FC<Props> = ({ projectId, constructionSiteId }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const { users, hrmPositions } = useApp();
  const { user: currentUser } = useApp();

  const [staff, setStaff] = useState<ProjectStaff[]>([]);
  const [permTypes, setPermTypes] = useState<ProjectPermissionType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<ProjectStaff | null>(null);

  // Form
  const [fUserId, setFUserId] = useState('');
  const [fPositionId, setFPositionId] = useState('');
  const [fStartDate, setFStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [fNote, setFNote] = useState('');
  const [fPermIds, setFPermIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [staffData, permData] = await Promise.all([
        projectStaffService.listByProject(projectId, constructionSiteId || undefined),
        projectPermissionTypeService.list(),
      ]);
      setStaff(staffData);
      setPermTypes(permData.filter(p => p.isActive));
    } catch (e: any) {
      toast.error('Lỗi tải dữ liệu', e?.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, constructionSiteId]);

  useEffect(() => { load(); }, [load]);

  // Group staff by position level for visual hierarchy
  const groupedStaff = useMemo(() => {
    const groups = new Map<number, ProjectStaff[]>();
    for (const s of staff) {
      const level = s.positionLevel ?? 99;
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level)!.push(s);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [staff]);

  // Sorted positions for dropdown
  const sortedPositions = useMemo(() =>
    [...hrmPositions].sort((a, b) => (a.level || 0) - (b.level || 0)),
  [hrmPositions]);

  // Filter users for search
  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return users.filter(u =>
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [users, searchQuery]);

  const resetForm = () => {
    setEditingStaff(null);
    setFUserId('');
    setFPositionId('');
    setFStartDate(new Date().toISOString().slice(0, 10));
    setFNote('');
    setFPermIds(new Set());
    setSearchQuery('');
    setShowModal(false);
  };

  const openAdd = () => {
    resetForm();
    setShowModal(true);
  };

  const openEdit = (s: ProjectStaff) => {
    setEditingStaff(s);
    setFUserId(s.userId);
    setFPositionId(s.positionId);
    setFStartDate(s.startDate || new Date().toISOString().slice(0, 10));
    setFNote(s.note || '');
    setFPermIds(new Set(
      (s.permissions || []).filter(p => p.isActive).map(p => p.permissionTypeId)
    ));
    setShowModal(true);
  };

  const togglePerm = (ptId: string) => {
    setFPermIds(prev => {
      const next = new Set(prev);
      if (next.has(ptId)) next.delete(ptId);
      else next.add(ptId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!fUserId) { toast.warning('Thiếu', 'Vui lòng chọn nhân viên'); return; }
    if (!fPositionId) { toast.warning('Thiếu', 'Vui lòng chọn vị trí'); return; }

    try {
      if (editingStaff) {
        // Update staff info
        await projectStaffService.update(editingStaff.id, {
          positionId: fPositionId,
          startDate: fStartDate,
          note: fNote,
        }, currentUser?.id, currentUser?.name);
        // Update permissions (replace all)
        await projectStaffService.setPermissions(editingStaff.id, [...fPermIds], currentUser?.id, currentUser?.name);
        toast.success('Đã cập nhật thành viên');
      } else {
        await projectStaffService.add({
          projectId,
          constructionSiteId: constructionSiteId || null,
          userId: fUserId,
          positionId: fPositionId,
          permissionTypeIds: [...fPermIds],
          startDate: fStartDate,
          note: fNote,
          grantedBy: currentUser?.id,
          operatorName: currentUser?.name,
        });
        toast.success('Đã thêm thành viên mới');
      }
      await load();
      resetForm();
    } catch (e: any) {
      toast.error('Lỗi', e?.message);
    }
  };

  const handleDelete = async (s: ProjectStaff) => {
    const ok = await confirm({
      title: 'Xoá thành viên',
      targetName: `${s.userName} — ${s.positionName}`,
      warningText: 'Sẽ xoá tất cả quyền nghiệp vụ đã gán cho thành viên này tại dự án.',
    });
    if (!ok) return;
    try {
      await projectStaffService.remove(s.id, currentUser?.id, currentUser?.name);
      await load();
      toast.success('Đã xoá thành viên');
    } catch (e: any) {
      toast.error('Lỗi', e?.message);
    }
  };

  const handleEndDate = async (s: ProjectStaff) => {
    const ok = await confirm({
      title: 'Kết thúc phân công',
      targetName: `${s.userName} — ${s.positionName}`,
      warningText: 'Đánh dấu thành viên này ngừng hoạt động tại vị trí hiện tại. Dữ liệu lịch sử vẫn được giữ.',
    });
    if (!ok) return;
    try {
      await projectStaffService.update(s.id, { endDate: new Date().toISOString().slice(0, 10) }, currentUser?.id, currentUser?.name);
      await load();
      toast.success('Đã cập nhật');
    } catch (e: any) {
      toast.error('Lỗi', e?.message);
    }
  };

  // Quick inline permission toggle
  const handleQuickTogglePerm = async (s: ProjectStaff, ptId: string) => {
    const currentPerms = (s.permissions || []).filter(p => p.isActive).map(p => p.permissionTypeId);
    const newPerms = currentPerms.includes(ptId)
      ? currentPerms.filter(id => id !== ptId)
      : [...currentPerms, ptId];
    try {
      await projectStaffService.setPermissions(s.id, newPerms, currentUser?.id, currentUser?.name);
      await load();
    } catch (e: any) {
      toast.error('Lỗi', e?.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Users size={18} className="text-white" />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-800 dark:text-white">Tổ chức Dự Án</h3>
            <p className="text-xs text-slate-400">{staff.length} thành viên • {groupedStaff.length} cấp bậc</p>
          </div>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black text-white bg-gradient-to-r from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:scale-[1.02] transition-all">
          <UserPlus size={14} /> Thêm thành viên
        </button>
      </div>

      {/* Staff Grid by Level */}
      {loading ? (
        <div className="p-12 text-center text-sm text-slate-400 font-bold">Đang tải...</div>
      ) : staff.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 p-12 text-center">
          <Users size={40} className="mx-auto mb-3 text-slate-200" />
          <p className="text-sm font-bold text-slate-400">Chưa phân bổ nhân sự</p>
          <p className="text-xs text-slate-300 mt-1">Bấm "Thêm thành viên" để bắt đầu xây dựng tổ chức dự án</p>
        </div>
      ) : (
        groupedStaff.map(([level, members]) => (
          <div key={level}>
            <div className="flex items-center gap-2 mb-3">
              <div className={`h-0.5 w-6 rounded-full bg-gradient-to-r ${LEVEL_COLORS[level] || LEVEL_COLORS[5]}`} />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Cấp {level} — {members[0]?.positionName?.split(' ').slice(-1)[0] || 'Khác'}
              </span>
              <div className={`h-0.5 flex-1 rounded-full bg-gradient-to-r ${LEVEL_COLORS[level] || LEVEL_COLORS[5]} opacity-10`} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {members.map(s => {
                const isEnded = !!s.endDate;
                const activePerms = (s.permissions || []).filter(p => p.isActive);
                return (
                  <div key={s.id}
                    className={`relative bg-white dark:bg-slate-800 rounded-2xl border shadow-sm overflow-hidden transition-all hover:shadow-lg group ${
                      isEnded ? 'opacity-50 border-slate-200' : `border-slate-100 dark:border-slate-700 ${LEVEL_BG[level] || ''}`
                    }`}>
                    {/* Header gradient bar */}
                    <div className={`h-1.5 bg-gradient-to-r ${LEVEL_COLORS[level] || LEVEL_COLORS[5]}`} />

                    <div className="p-4">
                      {/* User info */}
                      <div className="flex items-start gap-3">
                        <div className="relative flex-shrink-0">
                          {s.userAvatar ? (
                            <img src={s.userAvatar} alt={s.userName} className="w-12 h-12 rounded-2xl object-cover border-2 border-white shadow-sm" />
                          ) : (
                            <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${LEVEL_COLORS[level] || LEVEL_COLORS[5]} flex items-center justify-center text-white font-black text-sm shadow-sm`}>
                              {(s.userName || '?')[0]?.toUpperCase()}
                            </div>
                          )}
                          {!isEnded && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-black text-slate-800 dark:text-white truncate">{s.userName || 'Unknown'}</div>
                          <div className="text-[10px] font-bold text-slate-500 truncate">{s.positionName}</div>
                          {s.startDate && (
                            <div className="text-[9px] text-slate-400 flex items-center gap-1 mt-0.5">
                              <Calendar size={8} /> {new Date(s.startDate).toLocaleDateString('vi-VN')}
                              {isEnded && <span className="text-red-400"> → {new Date(s.endDate!).toLocaleDateString('vi-VN')}</span>}
                            </div>
                          )}
                        </div>
                        {/* Actions */}
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEdit(s)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors" title="Sửa">
                            <Edit2 size={12} />
                          </button>
                          {!isEnded && (
                            <button onClick={() => handleEndDate(s)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Kết thúc">
                              <XCircle size={12} />
                            </button>
                          )}
                          <button onClick={() => handleDelete(s)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors" title="Xoá">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>

                      {/* Permissions — inline toggles */}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {permTypes.map(pt => {
                          const has = activePerms.some(p => p.permissionTypeId === pt.id);
                          return (
                            <button key={pt.id}
                              onClick={() => handleQuickTogglePerm(s, pt.id)}
                              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold transition-all border ${
                                has
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm'
                                  : 'bg-white text-slate-300 border-slate-100 hover:border-slate-200'
                              }`}
                              title={pt.description || pt.name}>
                              {has ? <CheckCircle2 size={9} /> : <XCircle size={9} />}
                              {pt.code}
                            </button>
                          );
                        })}
                      </div>

                      {s.note && (
                        <div className="mt-2 text-[9px] text-slate-400 italic truncate">📝 {s.note}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Modal — Add/Edit Staff */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => resetForm()}>
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                  <UserPlus size={14} className="text-white" />
                </div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">
                  {editingStaff ? 'Sửa thành viên' : 'Thêm thành viên'}
                </h3>
              </div>
              <button onClick={resetForm} className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* User selection */}
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1.5">Nhân viên *</label>
                {editingStaff ? (
                  <div className="px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-600">
                    {editingStaff.userName} (không đổi được — xoá rồi thêm mới nếu cần)
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                      <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Tìm nhân viên..."
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-700 dark:border-slate-600" />
                    </div>
                    {searchQuery && (
                      <div className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-white dark:bg-slate-700 shadow-lg">
                        {filteredUsers.map(u => (
                          <button key={u.id} onClick={() => { setFUserId(u.id); setSearchQuery(u.name); }}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-bold hover:bg-indigo-50 dark:hover:bg-slate-600 transition-colors ${fUserId === u.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'}`}>
                            {u.avatar ? (
                              <img src={u.avatar} alt="" className="w-6 h-6 rounded-lg object-cover" />
                            ) : (
                              <div className="w-6 h-6 rounded-lg bg-slate-200 flex items-center justify-center text-[10px] font-black">{u.name?.[0]}</div>
                            )}
                            {u.name}
                            <span className="text-[9px] text-slate-400 ml-auto">{u.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Position */}
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1.5">Vị trí công việc *</label>
                <select value={fPositionId} onChange={e => setFPositionId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-700 dark:border-slate-600">
                  <option value="">— Chọn vị trí —</option>
                  {sortedPositions.map(p => (
                    <option key={p.id} value={p.id}>
                      {'·'.repeat(p.level || 0)} {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Start Date + Note */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1.5">Ngày bắt đầu</label>
                  <input type="date" value={fStartDate} onChange={e => setFStartDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-700 dark:border-slate-600" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1.5">Ghi chú</label>
                  <input value={fNote} onChange={e => setFNote(e.target.value)} placeholder="VD: Kiêm nhiệm"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-700 dark:border-slate-600" />
                </div>
              </div>

              {/* Permissions — tick tay */}
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                  <Shield size={10} className="inline mr-1" />Quyền nghiệp vụ (tick từng quyền)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {permTypes.map(pt => (
                    <label key={pt.id}
                      className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${
                        fPermIds.has(pt.id)
                          ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700'
                          : 'bg-white border-slate-100 hover:border-slate-200 dark:bg-slate-700 dark:border-slate-600'
                      }`}>
                      <input type="checkbox" checked={fPermIds.has(pt.id)} onChange={() => togglePerm(pt.id)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                      <div>
                        <div className="text-xs font-bold text-slate-700 dark:text-white">{pt.name}</div>
                        <div className="text-[9px] text-slate-400">{pt.code}{pt.module ? ` (${pt.module})` : ''}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-2">
              <button onClick={resetForm}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 border border-slate-200">
                Huỷ
              </button>
              <button onClick={handleSave}
                className="px-5 py-2.5 rounded-xl text-xs font-black text-white bg-gradient-to-r from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20 hover:shadow-xl transition-all">
                <Save size={12} className="inline mr-1" />{editingStaff ? 'Cập nhật' : 'Thêm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectOrgTab;
