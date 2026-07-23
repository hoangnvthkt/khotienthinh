import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Role } from '../../types';
import { useApp } from '../../context/AppContext';
import ProjectPermissionRoomsPanel from '../../components/project/permissions/ProjectPermissionRoomsPanel';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
}

const ProjectPermissionsTab: React.FC<Props> = ({ projectId, constructionSiteId }) => {
  const { user } = useApp();
  if (user?.role !== Role.ADMIN) {
    return <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-medium text-amber-900">
      <ShieldAlert size={20} className="mt-0.5 shrink-0" />
      <div><p className="font-black">Chỉ admin hệ thống được quản lý phân quyền dự án.</p><p className="mt-1 text-xs">Các Room và thành viên được chỉnh tại đây để bảo đảm người duyệt không bị lẫn giữa các nghiệp vụ.</p></div>
    </div>;
  }
  return <ProjectPermissionRoomsPanel projectId={projectId} constructionSiteId={constructionSiteId} />;
};

export default ProjectPermissionsTab;
