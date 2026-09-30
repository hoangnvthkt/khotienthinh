import React from 'react';
import { ChevronDown, ChevronUp, Trash2, TriangleAlert } from 'lucide-react';
import type { User } from '../../../types';
import {
  changeApproverBlockSource,
  type RequestApproverBlockDraft,
} from '../../../lib/requestTemplateEditorModel';
import UserSearchSelect from '../../common/UserSearchSelect';

export interface DirectManagerCoverage { activeUsers: number; withoutManager: number; sampleNames: string[] }

interface Props {
  block: RequestApproverBlockDraft;
  index: number;
  count: number;
  users: User[];
  directManagerCoverage: DirectManagerCoverage | null;
  onChange: (block: RequestApproverBlockDraft) => void;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}

const SOURCES: Array<{ value: RequestApproverBlockDraft['source']; label: string; description: string }> = [
  { value: 'DYNAMIC_CREATOR_SELECT', label: 'Duyệt linh động', description: 'Người tạo gõ tên người duyệt khi tạo đề xuất. Dùng cho “Quản lý trực tiếp”, “Giám đốc vật tư”…' },
  { value: 'FIXED_SINGLE', label: 'Một người cố định', description: 'Luôn là một người được chọn sẵn trong mẫu.' },
  { value: 'FIXED_MULTI', label: 'Nhiều người cố định', description: 'Nhóm người chọn sẵn; điều kiện hoàn thành theo cài đặt luồng.' },
  { value: 'DIRECT_MANAGER', label: 'Quản lý theo hồ sơ nhân sự', description: 'Tự lấy quản lý trực tiếp đã khai báo trong tài khoản người tạo.' },
];

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800';

const RequestApproverBlockEditor: React.FC<Props> = ({ block, index, count, users, directManagerCoverage, onChange, onMove, onRemove }) => (
  <article className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
    <div className="flex items-start gap-3">
      <span className="mt-6 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-3 md:flex-row">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-bold text-slate-500">Tên bước duyệt</span>
            <input value={block.name} onChange={event => onChange({ ...block, name: event.target.value })} placeholder="Vd: Quản lý trực tiếp, Giám đốc vật tư" className={inputClass} />
          </label>
          <label className="w-full md:w-36">
            <span className="mb-1 block text-xs font-bold text-slate-500">SLA (giờ)</span>
            <input type="number" min="1" max="8760" value={block.slaHours ?? ''} onChange={event => onChange({ ...block, slaHours: event.target.value === '' ? null : Number(event.target.value) })} placeholder="Không giới hạn" className={inputClass} />
          </label>
        </div>

        <fieldset className="mt-3">
          <legend className="mb-1.5 text-xs font-bold text-slate-500">Người duyệt của bước này</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SOURCES.map(source => {
              const active = block.source === source.value;
              return <label key={source.value} className={`flex cursor-pointer gap-2.5 rounded-lg border p-2.5 transition ${active ? 'border-emerald-500 bg-emerald-50/60 dark:border-emerald-600 dark:bg-emerald-950/30' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}>
                <input type="radio" name={`approver-source-${block.key}`} checked={active} onChange={() => onChange(changeApproverBlockSource(block, source.value))} className="mt-0.5 accent-emerald-600" />
                <span><span className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{source.label}</span><span className="block text-xs text-slate-500">{source.description}</span></span>
              </label>;
            })}
          </div>
        </fieldset>

        {block.source === 'FIXED_SINGLE' && (
          <div className="mt-3">
            <span className="mb-1 block text-xs font-bold text-slate-500">Người duyệt <span className="text-red-500">*</span></span>
            <UserSearchSelect users={users} value={block.fixedUserIds[0] || ''} onChange={userId => onChange({ ...block, fixedUserIds: userId ? [userId] : [] })} placeholder="Gõ tên hoặc vị trí để tìm người duyệt..." />
          </div>
        )}
        {block.source === 'FIXED_MULTI' && (
          <div className="mt-3">
            <span className="mb-1 block text-xs font-bold text-slate-500">Người duyệt <span className="text-red-500">*</span> <span className="font-normal text-slate-400">(tối thiểu 2)</span></span>
            <UserSearchSelect users={users} multiple values={block.fixedUserIds} onValuesChange={userIds => onChange({ ...block, fixedUserIds: userIds })} placeholder="Gõ tên để thêm người duyệt..." />
          </div>
        )}
        {block.source === 'DYNAMIC_CREATOR_SELECT' && (
          <label className="mt-3 block max-w-xs">
            <span className="mb-1 block text-xs font-bold text-slate-500">Số người duyệt tối thiểu <span className="text-red-500">*</span></span>
            <input type="number" min="1" value={block.minimumDynamicApprovers ?? ''} onChange={event => onChange({ ...block, minimumDynamicApprovers: event.target.value === '' ? null : Number(event.target.value) })} className={inputClass} />
          </label>
        )}
        {block.source === 'DIRECT_MANAGER' && directManagerCoverage && directManagerCoverage.withoutManager > 0 && (
          <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            <p>
              <strong>{directManagerCoverage.withoutManager}/{directManagerCoverage.activeUsers}</strong> người dùng chưa khai báo quản lý trực tiếp nên sẽ <strong>không gửi được</strong> đề xuất theo mẫu này
              {directManagerCoverage.sampleNames.length > 0 && <> (vd: {directManagerCoverage.sampleNames.slice(0, 4).join(', ')}{directManagerCoverage.withoutManager > 4 ? '…' : ''})</>}.
              {' '}Hãy bổ sung quản lý trong Quản lý người dùng, hoặc dùng “Duyệt linh động” để người tạo tự gõ tên.
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 sm:flex-row">
        <button type="button" aria-label="Chuyển bước lên trước" disabled={index === 0} onClick={() => onMove(index, index - 1)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"><ChevronUp size={16} /></button>
        <button type="button" aria-label="Chuyển bước xuống sau" disabled={index === count - 1} onClick={() => onMove(index, index + 1)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"><ChevronDown size={16} /></button>
        <button type="button" aria-label="Xóa bước duyệt" onClick={onRemove} className="rounded-lg p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 size={16} /></button>
      </div>
    </div>
  </article>
);

export default RequestApproverBlockEditor;
