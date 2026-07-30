import React from 'react';
import { ChevronDown, ChevronUp, GripVertical, Trash2, Users } from 'lucide-react';
import type { User } from '../../../types';
import type { RequestApproverBlockDraft } from '../../../lib/requestTemplateEditorModel';
import UserSearchSelect from '../../common/UserSearchSelect';

interface Props {
  block: RequestApproverBlockDraft;
  index: number;
  count: number;
  users: User[];
  onChange: (block: RequestApproverBlockDraft) => void;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}

const sourceLabels = { FIXED_SINGLE: 'Người duyệt cố định', FIXED_MULTI: 'Nhiều người duyệt cố định', DIRECT_MANAGER: 'Quản lý trực tiếp', DYNAMIC_CREATOR_SELECT: 'Người tạo chọn khi gửi' } as const;

const RequestApproverBlockEditor: React.FC<Props> = ({ block, index, count, users, onChange, onMove, onRemove }) => {
  return (
    <article className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex items-start gap-3">
        <GripVertical className="mt-2 text-slate-300" size={18} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 md:flex-row">
            <label className="flex-1">
              <span className="mb-1 block text-xs font-bold text-slate-500">Tên khối người duyệt</span>
              <input
                value={block.name}
                onChange={event => onChange({ ...block, name: event.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
            <label className="w-full md:w-36">
              <span className="mb-1 block text-xs font-bold text-slate-500">SLA (giờ)</span>
              <input
                type="number"
                min="1"
                max="8760"
                value={block.slaHours ?? ''}
                onChange={event => onChange({ ...block, slaHours: event.target.value === '' ? null : Number(event.target.value) })}
                placeholder="Không giới hạn"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
          </div>
          <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">{sourceLabels[block.source]}</p>
          {block.source === 'FIXED_SINGLE' && (
            <div className="mt-3">
              <span className="mb-1 block text-xs font-bold text-slate-500">Người duyệt <span className="text-red-500">*</span></span>
              <UserSearchSelect
                users={users}
                value={block.fixedUserIds[0] || ''}
                onChange={userId => onChange({ ...block, fixedUserIds: userId ? [userId] : [] })}
                placeholder="Gõ tên hoặc vị trí để tìm người duyệt..."
              />
            </div>
          )}
          {block.source === 'FIXED_MULTI' && (
            <div className="mt-3">
              <span className="mb-1 block text-xs font-bold text-slate-500">Người duyệt <span className="text-red-500">*</span></span>
              <UserSearchSelect
                users={users}
                multiple
                values={block.fixedUserIds}
                onValuesChange={userIds => onChange({ ...block, fixedUserIds: userIds })}
                placeholder="Gõ tên để thêm người duyệt..."
              />
              <span className="mt-1 block text-xs text-slate-400">Cần tối thiểu hai người duyệt.</span>
            </div>
          )}
          {block.source === 'DIRECT_MANAGER' && (
            <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
              <Users className="mr-1 inline" size={15} />Quản lý trực tiếp được xác định tự động khi người tạo gửi đề xuất.
            </p>
          )}
          {block.source === 'DYNAMIC_CREATOR_SELECT' && (
            <label className="mt-3 block max-w-xs">
              <span className="mb-1 block text-xs font-bold text-slate-500">Số người duyệt tối thiểu <span className="text-red-500">*</span></span>
              <input
                type="number"
                min="1"
                value={block.minimumDynamicApprovers ?? ''}
                onChange={event => onChange({ ...block, minimumDynamicApprovers: event.target.value === '' ? null : Number(event.target.value) })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
          )}
        </div>
        <div className="flex gap-1">
          <button type="button" aria-label="Di chuyển khối lên" disabled={index === 0} onClick={() => onMove(index, index - 1)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"><ChevronUp size={16} /></button>
          <button type="button" aria-label="Di chuyển khối xuống" disabled={index === count - 1} onClick={() => onMove(index, index + 1)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"><ChevronDown size={16} /></button>
          <button type="button" aria-label="Xóa khối người duyệt" onClick={onRemove} className="rounded-lg p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 size={16} /></button>
        </div>
      </div>
    </article>
  );
};

export default RequestApproverBlockEditor;
