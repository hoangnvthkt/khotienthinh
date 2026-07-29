import React from 'react';
import type { RequestTemplateDraft, RequestTemplateDraftAction, RequestTemplateValidationIssue } from '../../../lib/requestTemplateEditorModel';

interface Props {
  draft: RequestTemplateDraft;
  updatedAt: string | null;
  dispatch: (action: RequestTemplateDraftAction) => void;
  issues: RequestTemplateValidationIssue[];
}

const RequestTemplateGeneralSection: React.FC<Props> = ({ draft, updatedAt, dispatch, issues }) => {
  const generalIssues = issues.filter(issue => issue.section === 'GENERAL');
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
    <header className="border-b border-slate-200 px-5 py-4 dark:border-slate-700"><h2 className="text-lg font-bold text-slate-800 dark:text-white">Thông tin chung</h2><p className="mt-1 text-sm text-slate-500">Thiết lập thông tin nhận diện và SLA mặc định cho mẫu đề xuất.</p></header>
    <div className="space-y-5 p-5">
      <label className="block"><span className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200">Tên mẫu yêu cầu <span className="text-red-500">*</span></span><input value={draft.name} onChange={event => dispatch({ type: 'PATCH_GENERAL', patch: { name: event.target.value } })} placeholder="Ví dụ: Đề xuất mua hàng" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800" /></label>
      <label className="block"><span className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200">Mô tả</span><textarea value={draft.description} onChange={event => dispatch({ type: 'PATCH_GENERAL', patch: { description: event.target.value } })} rows={3} placeholder="Mô tả ngắn giúp người dùng chọn đúng mẫu..." className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800" /></label>
      <label className="block max-w-xs"><span className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200">SLA toàn đề xuất (giờ)</span><input type="number" min="1" max="8760" value={draft.requestSlaHours ?? ''} onChange={event => dispatch({ type: 'PATCH_GENERAL', patch: { requestSlaHours: event.target.value === '' ? null : Number(event.target.value) } })} placeholder="Để trống nếu không giới hạn" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800" /><span className="mt-1 block text-xs text-slate-400">Từ 1 đến 8.760 giờ.</span></label>
      <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/70 sm:grid-cols-3"><div><dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Trạng thái</dt><dd className="mt-1 font-bold text-slate-700 dark:text-slate-200">{draft.status === 'DRAFT' ? 'Bản nháp' : draft.status === 'PUBLISHED' ? 'Đang áp dụng' : 'Ngừng áp dụng'}</dd></div><div><dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Phiên bản</dt><dd className="mt-1 font-bold text-slate-700 dark:text-slate-200">{draft.status === 'PUBLISHED' ? 'Đã phát hành' : 'Chưa phát hành'}</dd></div><div><dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Cập nhật</dt><dd className="mt-1 font-bold text-slate-700 dark:text-slate-200">{updatedAt ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(updatedAt)) : 'Chưa lưu'}</dd></div></dl>
      {generalIssues.length > 0 && <ul className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-300">{generalIssues.map(issue => <li key={issue.code}>{issue.message}</li>)}</ul>}
    </div>
  </section>;
};

export default RequestTemplateGeneralSection;
