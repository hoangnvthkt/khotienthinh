import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, Edit2, Trash2, UserPlus, Users, X, XCircle } from 'lucide-react';
import { HrmPosition, ProjectStaff, Role } from '../../types';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { fromDb } from '../../lib/dbMapping';
import { projectStaffService } from '../../lib/projectStaffService';
import { supabase } from '../../lib/supabase';
import PremiumMemberSelect, { MemberOption } from '../../components/common/PremiumMemberSelect';

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
};

const ProjectOrgTab: React.FC<Props> = ({ projectId, constructionSiteId }) => {
  const { users, hrmPositions, user: currentUser } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const isSystemAdmin = currentUser?.role === Role.ADMIN;
  const [staff, setStaff] = useState<ProjectStaff[]>([]);
  const [positions, setPositions] = useState<HrmPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<ProjectStaff | null>(null);
  const [fUserId, setFUserId] = useState('');
  const [fPositionId, setFPositionId] = useState('');
  const [fStartDate, setFStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [fNote, setFNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [staffData, positionResult] = await Promise.all([
        projectStaffService.listByProject(projectId, constructionSiteId || undefined),
        supabase.from('hrm_positions').select('*').order('level', { ascending: true }).order('name', { ascending: true }),
      ]);
      if (positionResult.error) throw positionResult.error;
      setStaff(staffData);
      setPositions((positionResult.data || []).map(row => fromDb(row) as HrmPosition));
    } catch (error: any) {
      toast.error('Lỗi tải tổ chức dự án', error?.message);
      setPositions(current => current.length ? current : hrmPositions);
    } finally {
      setLoading(false);
    }
  }, [constructionSiteId, hrmPositions, projectId, toast]);

  useEffect(() => { load(); }, [load]);

  const groupedStaff = useMemo(() => {
    const groups = new Map<number, ProjectStaff[]>();
    staff.forEach(member => {
      const level = member.positionLevel ?? 99;
      groups.set(level, [...(groups.get(level) || []), member]);
    });
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [staff]);

  const sortedPositions = useMemo(() => [...(positions.length ? positions : hrmPositions)]
    .sort((a, b) => (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name, 'vi')),
  [hrmPositions, positions]);

  const memberOptions = useMemo<MemberOption[]>(() => {
    const assignedUserIds = new Set(staff.map(member => member.userId));
    return users
      .filter(user => !assignedUserIds.has(user.id) && user.isActive !== false)
      .map(user => ({
        id: user.id,
        name: user.name || user.username || user.email || 'Nhân sự',
        avatarUrl: user.avatar || null,
        roleLabel: user.role || null,
        subtitle: user.email || null,
      }));
  }, [staff, users]);

  const resetForm = () => {
    setEditingStaff(null);
    setFUserId('');
    setFPositionId('');
    setFStartDate(new Date().toISOString().slice(0, 10));
    setFNote('');
    setShowModal(false);
  };

  const requireSystemAdmin = () => {
    if (isSystemAdmin) return true;
    toast.warning('Chỉ admin hệ thống', 'Chỉ admin hệ thống được thêm, sửa hoặc xoá nhân sự dự án.');
    return false;
  };

  const openAdd = () => {
    if (!requireSystemAdmin()) return;
    resetForm();
    setShowModal(true);
  };

  const openEdit = (member: ProjectStaff) => {
    if (!requireSystemAdmin()) return;
    setEditingStaff(member);
    setFUserId(member.userId);
    setFPositionId(member.positionId);
    setFStartDate(member.startDate || new Date().toISOString().slice(0, 10));
    setFNote(member.note || '');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!requireSystemAdmin()) return;
    if (!fUserId || !fPositionId) {
      toast.warning('Thiếu thông tin', 'Vui lòng chọn nhân viên và vị trí công việc.');
      return;
    }
    try {
      if (editingStaff) {
        await projectStaffService.update(editingStaff.id, {
          positionId: fPositionId,
          startDate: fStartDate,
          note: fNote,
        }, currentUser?.id, currentUser?.name);
        toast.success('Đã cập nhật thành viên');
      } else {
        await projectStaffService.add({
          projectId,
          constructionSiteId: constructionSiteId || null,
          userId: fUserId,
          positionId: fPositionId,
          permissionTypeIds: [],
          startDate: fStartDate,
          note: fNote,
          grantedBy: currentUser?.id,
          operatorName: currentUser?.name,
        });
        toast.success('Đã thêm thành viên');
      }
      await load();
      resetForm();
    } catch (error: any) {
      toast.error('Không thể lưu thành viên', error?.message);
    }
  };

  const handleEnd = async (member: ProjectStaff) => {
    if (!requireSystemAdmin()) return;
    if (!await confirm({
      title: 'Kết thúc phân công',
      targetName: `${member.userName} — ${member.positionName}`,
      warningText: 'Dữ liệu lịch sử được giữ, nhưng nhân sự sẽ không còn hoạt động tại dự án.',
    })) return;
    try {
      await projectStaffService.update(member.id, { endDate: new Date().toISOString().slice(0, 10) }, currentUser?.id, currentUser?.name);
      await load();
      toast.success('Đã kết thúc phân công');
    } catch (error: any) {
      toast.error('Không thể kết thúc phân công', error?.message);
    }
  };

  const handleDelete = async (member: ProjectStaff) => {
    if (!requireSystemAdmin()) return;
    if (!await confirm({
      title: 'Xoá thành viên',
      targetName: `${member.userName} — ${member.positionName}`,
      warningText: 'Thành viên sẽ bị gỡ khỏi dự án; các Room liên quan cũng không còn hiệu lực.',
    })) return;
    try {
      await projectStaffService.remove(member.id, currentUser?.id, currentUser?.name);
      await load();
      toast.success('Đã xoá thành viên');
    } catch (error: any) {
      toast.error('Không thể xoá thành viên', error?.message);
    }
  };

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-500/20"><Users size={18} className="text-white" /></div>
        <div>
          <h3 className="text-lg font-black text-slate-800 dark:text-white">Tổ chức dự án</h3>
          <p className="text-xs text-slate-400">{staff.length} thành viên · {groupedStaff.length} cấp bậc</p>
        </div>
      </div>
      {isSystemAdmin && <button type="button" onClick={openAdd} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white shadow-sm shadow-indigo-500/25 transition hover:bg-indigo-700 active:scale-[0.98]"><UserPlus size={14} />Thêm thành viên</button>}
    </div>

    {!isSystemAdmin && <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Danh sách tổ chức chỉ để xem. Admin hệ thống quản lý nhân sự và phân quyền tại tab riêng.</div>}

    {loading ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl border border-slate-100 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />)}</div>
      : staff.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-800"><Users size={36} className="mx-auto mb-3 text-slate-300" /><p className="text-sm font-bold text-slate-500">Chưa có nhân sự trong dự án</p>{isSystemAdmin && <button type="button" onClick={openAdd} className="mt-4 text-xs font-black text-indigo-600 hover:text-indigo-700">Thêm thành viên đầu tiên</button>}</div>
      : groupedStaff.map(([level, members]) => <section key={level} className="space-y-3"><div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full bg-gradient-to-r ${LEVEL_COLORS[level] || LEVEL_COLORS[5]}`} /><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cấp {level} · {members[0]?.positionName || 'Khác'}</span><span className="h-px flex-1 bg-slate-100 dark:bg-slate-700" /></div><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{members.map(member => {
        const ended = Boolean(member.endDate);
        return <article key={member.id} className={`rounded-2xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-800 ${ended ? 'border-slate-200 opacity-60 dark:border-slate-700' : 'border-slate-100 dark:border-slate-700'}`}><div className="flex items-start gap-3"><div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${LEVEL_COLORS[level] || LEVEL_COLORS[5]} text-sm font-black text-white`}>{member.userAvatar ? <img src={member.userAvatar} alt={member.userName} className="h-full w-full rounded-xl object-cover" /> : (member.userName || '?').slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-slate-800 dark:text-white">{member.userName || 'Chưa có tên'}</p><p className="truncate text-xs font-medium text-slate-500">{member.positionName || 'Chưa xác định vị trí'}</p><p className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-400"><Calendar size={10} />{member.startDate ? new Date(member.startDate).toLocaleDateString('vi-VN') : 'Chưa có ngày bắt đầu'}{ended && ' · Đã kết thúc'}</p></div>{isSystemAdmin && <div className="flex gap-1"><button type="button" onClick={() => openEdit(member)} title="Sửa" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"><Edit2 size={14} /></button>{!ended && <button type="button" onClick={() => handleEnd(member)} title="Kết thúc" className="rounded-lg p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600"><XCircle size={14} /></button>}<button type="button" onClick={() => handleDelete(member)} title="Xoá" className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button></div>}</div>{member.note && <p className="mt-3 truncate border-t border-slate-100 pt-3 text-[11px] italic text-slate-400 dark:border-slate-700">{member.note}</p>}</article>;
      })}</div></section>)}

    {showModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm" onClick={resetForm}><div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl dark:bg-slate-800" onClick={event => event.stopPropagation()}><div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-700"><div><h4 className="text-sm font-black text-slate-800 dark:text-white">{editingStaff ? 'Sửa thành viên' : 'Thêm thành viên'}</h4><p className="mt-0.5 text-xs text-slate-400">Phân quyền nghiệp vụ được quản lý ở tab Phân quyền.</p></div><button type="button" onClick={resetForm} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={16} /></button></div><div className="space-y-4 p-6"><div><label className="mb-2 block text-xs font-bold text-slate-700 dark:text-slate-200">Nhân viên</label>{editingStaff ? <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-600">{editingStaff.userName}</div> : <PremiumMemberSelect options={memberOptions} selectedIds={fUserId ? [fUserId] : []} onChange={ids => setFUserId(ids[0] || '')} isMulti={false} placeholder="Tìm nhân viên..." />}</div><div><label className="mb-2 block text-xs font-bold text-slate-700 dark:text-slate-200">Vị trí công việc</label><select value={fPositionId} onChange={event => setFPositionId(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white"><option value="">Chọn vị trí</option>{sortedPositions.map(position => <option key={position.id} value={position.id}>{position.name}</option>)}</select></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><label className="mb-2 block text-xs font-bold text-slate-700 dark:text-slate-200">Ngày bắt đầu</label><input type="date" value={fStartDate} onChange={event => setFStartDate(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white" /></div><div><label className="mb-2 block text-xs font-bold text-slate-700 dark:text-slate-200">Ghi chú</label><input value={fNote} onChange={event => setFNote(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white" /></div></div></div><div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-700"><button type="button" onClick={resetForm} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Huỷ</button><button type="button" onClick={handleSave} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white hover:bg-indigo-700 active:scale-[0.98]">{editingStaff ? 'Lưu thay đổi' : 'Thêm thành viên'}</button></div></div></div>}
  </div>;
};

export default ProjectOrgTab;
