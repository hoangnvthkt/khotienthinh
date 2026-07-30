import React from 'react';
import { Bell } from 'lucide-react';
import type { RequestTemplateDraft, RequestTemplateDraftAction } from '../../../lib/requestTemplateEditorModel';

const events: Array<{ id: RequestTemplateDraft['notificationEvents'][number]; label: string; description: string }> = [
  { id: 'SUBMITTED', label: 'Khi gửi đề xuất', description: 'Thông báo cho người xử lý đầu tiên.' },
  { id: 'ASSIGNED', label: 'Khi được giao duyệt', description: 'Bắt buộc để không bỏ sót khối duyệt đang hoạt động.' },
  { id: 'REASSIGNED', label: 'Khi thay đổi người xử lý', description: 'Thông báo khi việc duyệt được giao lại.' },
  { id: 'REMINDER', label: 'Nhắc hạn SLA', description: 'Chỉ khả dụng khi có SLA toàn đề xuất hoặc một khối duyệt.' },
  { id: 'RETURNED', label: 'Khi trả lại', description: 'Thông báo cho người tạo bổ sung thông tin.' },
  { id: 'APPROVED', label: 'Khi hoàn tất phê duyệt', description: 'Thông báo đề xuất đã được chấp thuận.' },
  { id: 'REJECTED', label: 'Khi từ chối', description: 'Thông báo đề xuất bị từ chối toàn bộ.' },
];

interface Props { draft: RequestTemplateDraft; dispatch: (action: RequestTemplateDraftAction) => void; }
const RequestTemplateNotificationSection: React.FC<Props> = ({ draft, dispatch }) => {
  const reminderAvailable = draft.requestSlaHours !== null || draft.approverBlocks.some(block => block.slaHours !== null);
  const set = (id: RequestTemplateDraft['notificationEvents'][number], checked: boolean) => dispatch({ type: 'SET_NOTIFICATIONS', events: checked ? [...new Set([...draft.notificationEvents, id])] : draft.notificationEvents.filter(event => event !== id) });
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"><header className="border-b border-slate-200 px-5 py-4 dark:border-slate-700"><h2 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-white"><Bell size={19} className="text-accent" /> Thông báo</h2><p className="mt-1 text-sm text-slate-500">Chọn sự kiện tạo thông báo trong luồng đề xuất.</p></header><div className="divide-y divide-slate-100 dark:divide-slate-800">{events.map(event => { const disabled = event.id === 'ASSIGNED' || (event.id === 'REMINDER' && !reminderAvailable); const checked = event.id === 'ASSIGNED' || draft.notificationEvents.includes(event.id); return <label key={event.id} className={`flex items-center justify-between gap-4 px-5 py-4 ${disabled && event.id === 'REMINDER' ? 'opacity-50' : 'cursor-pointer'}`}><span><span className="block text-sm font-bold text-slate-700 dark:text-slate-200">{event.label}</span><span className="mt-1 block text-xs text-slate-400">{event.description}</span></span><input type="checkbox" checked={checked} disabled={disabled} onChange={change => set(event.id, change.target.checked)} className="h-5 w-5 accent-emerald-600" /></label>; })}</div></section>;
};
export default RequestTemplateNotificationSection;
