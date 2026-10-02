import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Role } from '../../types';
import type { ProjectStaff } from '../../types';
import { useApp } from '../../context/AppContext';
import { projectStaffService } from '../../lib/projectStaffService';
import { projectRoomTemplateService, type ProjectRoomTemplate } from '../../lib/projectRoomTemplateService';
import {
  projectPermissionRoomService,
  type ProjectPermissionRoomOverview,
} from '../../lib/projectPermissionRoomService';
import type { RoomRulesByRoom } from '../../lib/projectRoomPersonDraft';
import { logApiError, getApiErrorMessage } from '../../lib/apiError';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import type { ProjectPermissionRoomCode } from '../../lib/permissions/projectPermissionRooms';
import ProjectPersonRoomEditor from '../../components/project/permissions/ProjectPersonRoomEditor';
import ProjectRoomOverview from '../../components/project/permissions/ProjectRoomOverview';
import ProjectRoomBulkApply from '../../components/project/permissions/ProjectRoomBulkApply';
import ProjectSensitiveAccessRoomCard from '../../components/project/permissions/ProjectSensitiveAccessRoomCard';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
}

interface TabData {
  staff: ProjectStaff[];
  templates: ProjectRoomTemplate[];
  overview: ProjectPermissionRoomOverview;
}

const ProjectPermissionsTab: React.FC<Props> = ({ projectId, constructionSiteId }) => {
  const { user } = useApp();
  const isAdmin = user?.role === Role.ADMIN;
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<TabData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [staffId, setStaffId] = useState('');

  const load = useCallback(async () => {
    try {
      const [staffRows, candidateIds, templates, overview] = await Promise.all([
        projectStaffService.listByProject(projectId, constructionSiteId || undefined),
        projectPermissionRoomService.listStaffCandidateIds(projectId, constructionSiteId),
        projectRoomTemplateService.list(),
        projectPermissionRoomService.listOverview(projectId, constructionSiteId),
      ]);
      // The people Rooms can be given to: still on the project and with an active account.
      const staff = staffRows
        .filter(row => !row.endDate && candidateIds.has(row.id))
        .sort((a, b) => (a.userName || '').localeCompare(b.userName || '', 'vi'));
      setData({ staff, templates, overview });
      setState('ready');
    } catch (loadError) {
      logApiError('projectPermissionsTab.load', loadError);
      setState('error');
    }
  }, [constructionSiteId, projectId]);

  useEffect(() => {
    if (!isAdmin) return;
    setState('loading');
    setStaffId('');
    void load();
  }, [isAdmin, load]);

  const rules = useMemo<RoomRulesByRoom>(() => Object.fromEntries((data?.overview.rooms || []).map(room => [
    room.roomCode,
    { actionEnforcement: room.actionEnforcement, actionPrerequisites: room.actionPrerequisites },
  ])), [data?.overview.rooms]);

  const eligibleStaffIds = useMemo(() => new Set((data?.staff || []).map(row => row.id)), [data?.staff]);

  const removeStale = async (roomCode: ProjectPermissionRoomCode, staleStaffId: string) => {
    const members = data?.overview.membersByRoom[roomCode] || [];
    const stale = members.find(member => member.staffId === staleStaffId);
    const ok = await confirm({
      title: 'Gỡ dòng quyền cũ?',
      targetName: stale?.userName || 'Nhân sự',
      warningText: 'Người này đã rời dự án hoặc tài khoản bị khóa nên quyền này không còn hiệu lực. Gỡ để danh sách sạch.',
      confirmText: 'Gỡ',
      intent: 'warning',
    });
    if (!ok) return;
    try {
      await projectPermissionRoomService.replaceMembers(
        projectId, constructionSiteId, roomCode,
        members.filter(member => member.staffId !== staleStaffId).map(member => ({ staffId: member.staffId, actionCodes: member.actionCodes })),
      );
      toast.success('Đã gỡ dòng quyền cũ');
      await load();
    } catch (removeError) {
      logApiError('projectPermissionsTab.removeStale', removeError);
      toast.error('Không gỡ được', getApiErrorMessage(removeError, 'Thử lại sau.'));
    }
  };

  const editPerson = (id: string) => {
    setStaffId(id);
    window.setTimeout(() => document.getElementById('project-person-room-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  if (!isAdmin) {
    return <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-medium text-amber-900">
      <ShieldAlert size={20} className="mt-0.5 shrink-0" />
      <div><p className="font-black">Chỉ admin hệ thống được quản lý phân quyền dự án.</p><p className="mt-1 text-xs">Các Room và thành viên được chỉnh tại đây để bảo đảm người duyệt không bị lẫn giữa các nghiệp vụ.</p></div>
    </div>;
  }

  return <div className="space-y-5">
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
      Quyền nghiệp vụ của dự án được cấp tại đây, theo từng Room và đúng công trường của dự án.
    </div>

    {state === 'loading' && (
      <p className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-400"><Loader2 size={16} className="animate-spin" /> Đang tải nhân sự, mẫu và quyền Room…</p>
    )}
    {state === 'error' && (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm font-bold text-red-800">Không tải được phân quyền dự án</p>
        <p className="mt-1 text-xs text-red-700">Kiểm tra kết nối rồi thử lại. Chưa có thay đổi nào được ghi.</p>
        <button type="button" onClick={() => { setState('loading'); void load(); }} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-3 py-2 text-xs font-black text-white hover:bg-red-800"><RefreshCw size={13} /> Thử lại</button>
      </div>
    )}

    {state === 'ready' && data && <>
      <ProjectPersonRoomEditor
        projectId={projectId}
        constructionSiteId={constructionSiteId}
        staff={data.staff}
        templates={data.templates}
        overview={data.overview}
        rules={rules}
        staffId={staffId}
        onStaffChange={setStaffId}
        onApplied={load}
      />
      {data.staff.length > 1 && (
        <ProjectRoomBulkApply
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          staff={data.staff}
          templates={data.templates}
          rules={rules}
          onApplied={load}
        />
      )}
      <ProjectRoomOverview overview={data.overview} eligibleStaffIds={eligibleStaffIds} onEditPerson={editPerson} onRemoveStale={removeStale} />
    </>}

    <div className="md:max-w-sm"><ProjectSensitiveAccessRoomCard projectId={projectId} /></div>
  </div>;
};

export default ProjectPermissionsTab;
