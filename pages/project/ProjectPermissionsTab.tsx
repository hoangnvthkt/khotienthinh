import React, { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Role } from '../../types';
import { useApp } from '../../context/AppContext';
import ProjectPermissionRoomsPanel from '../../components/project/permissions/ProjectPermissionRoomsPanel';
import ProjectSensitiveAccessRoomCard from '../../components/project/permissions/ProjectSensitiveAccessRoomCard';
import ProjectRoomTemplateAssign from '../../components/project/permissions/ProjectRoomTemplateAssign';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
}

const ProjectPermissionsTab: React.FC<Props> = ({ projectId, constructionSiteId }) => {
  const { user } = useApp();
  const [roomsVersion, setRoomsVersion] = useState(0);
  if (user?.role !== Role.ADMIN) {
    return <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-medium text-amber-900">
      <ShieldAlert size={20} className="mt-0.5 shrink-0" />
      <div><p className="font-black">Chỉ admin hệ thống được quản lý phân quyền dự án.</p><p className="mt-1 text-xs">Các Room và thành viên được chỉnh tại đây để bảo đảm người duyệt không bị lẫn giữa các nghiệp vụ.</p></div>
    </div>;
  }
  return <div className="space-y-4">
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
      Quyền nghiệp vụ của dự án được cấp tại đây, theo từng Room và đúng công trường của dự án.
    </div>
    <ProjectRoomTemplateAssign
      projectId={projectId}
      constructionSiteId={constructionSiteId}
      onApplied={() => setRoomsVersion(value => value + 1)}
    />
    <ProjectPermissionRoomsPanel
      key={roomsVersion}
      projectId={projectId}
      constructionSiteId={constructionSiteId}
      leadingCard={{
        groupCode: 'finance',
        searchText: 'Ai được xem Tài chính & Hợp đồng dữ liệu nhạy cảm công tắc',
        node: <ProjectSensitiveAccessRoomCard key="sensitive-access" projectId={projectId} />,
      }}
    />
  </div>;
};

export default ProjectPermissionsTab;
