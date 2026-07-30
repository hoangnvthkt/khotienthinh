import React from 'react';
import { Eye } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import type { RequestTemplateDraftAction } from '../../../lib/requestTemplateEditorModel';
import UserSearchSelect from '../../common/UserSearchSelect';

interface Props { watcherIds: string[]; dispatch: (action: RequestTemplateDraftAction) => void; }

const RequestTemplateWatcherSection: React.FC<Props> = ({ watcherIds, dispatch }) => {
  const { users } = useApp();
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <header className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-white">
          <Eye size={19} className="text-accent" /> Người theo dõi
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Người theo dõi cố định có thể xem đề xuất và nhận báo cáo liên quan.
        </p>
      </header>
      <div className="space-y-4 p-5">
        <div>
          <span className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">
            Danh sách người theo dõi
          </span>
          <UserSearchSelect
            users={users}
            multiple
            values={watcherIds}
            onValuesChange={userIds => dispatch({ type: 'SET_WATCHERS', userIds })}
            placeholder="Gõ tên hoặc vị trí để thêm người theo dõi..."
          />
        </div>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/70">
          Người tạo và người duyệt được runtime cấp quyền qua vai trò tham gia; không cần thêm vào đây.
        </p>
      </div>
    </section>
  );
};

export default RequestTemplateWatcherSection;
