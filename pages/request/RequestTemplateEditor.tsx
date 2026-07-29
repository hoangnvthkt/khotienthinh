import React from 'react';
import { ArrowLeft, FileText, Wrench } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

const RequestTemplateEditor: React.FC = () => {
  const navigate = useNavigate();
  const { templateId } = useParams();

  return <div className="mx-auto max-w-5xl space-y-6">
    <button onClick={() => navigate('/rq/templates')} className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-accent"><ArrowLeft size={16} /> Quay lại danh sách mẫu</button>
    <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-accent dark:bg-emerald-900/30"><FileText size={28} /></div>
      <h1 className="mt-4 text-2xl font-bold text-slate-800 dark:text-white">{templateId ? 'Chỉnh sửa mẫu yêu cầu' : 'Tạo mẫu yêu cầu'}</h1>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500 dark:text-slate-400">Khung biên tập thông tin chung, mẫu form, luồng phê duyệt và phạm vi sử dụng sẽ được hoàn thiện ở task tiếp theo.</p>
      <div className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Wrench size={16} /> Template ID: {templateId || 'mới'}</div>
    </section>
  </div>;
};

export default RequestTemplateEditor;
