import React from 'react';
import { MapPinOff } from 'lucide-react';
import type { User } from '../../../types';
import type { SafetyWorkforceRequestScope } from '../../../lib/safetyWorkforceApi';
import SafetyPassportDashboardView from './passport/SafetyPassportDashboardView';
import SafetyWorkerRosterView from './passport/SafetyWorkerRosterView';
import SafetyActiveWorkforceView from './passport/SafetyActiveWorkforceView';

export type SafetyPassportMode = 'passport' | 'passportWorkers' | 'passportAssignments';

interface Props {
  mode: SafetyPassportMode;
  projectId: string;
  constructionSiteId?: string | null;
  currentUser: User;
  canManage?: boolean;
}

const SafetyPassportPanel: React.FC<Props> = ({
  mode,
  projectId,
  constructionSiteId,
  currentUser,
}) => {
  if (!projectId.trim() || !constructionSiteId?.trim()) {
    return (
      <section className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
        <MapPinOff className="mx-auto text-slate-400" size={24} />
        <h2 className="mt-3 text-sm font-black text-slate-800 dark:text-slate-100">Chưa chọn công trường</h2>
        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">Chọn công trường để xem dữ liệu an toàn đúng phạm vi.</p>
      </section>
    );
  }

  const scope: SafetyWorkforceRequestScope = {
    userId: currentUser.id,
    projectId,
    constructionSiteId,
  };

  if (mode === 'passport') {
    return <SafetyPassportDashboardView scope={scope} currentUser={currentUser} />;
  }
  if (mode === 'passportWorkers') {
    return <SafetyWorkerRosterView scope={scope} currentUser={currentUser} />;
  }
  return <SafetyActiveWorkforceView scope={scope} currentUser={currentUser} />;
};

export default SafetyPassportPanel;
