import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, FilePlus2, FileText, Pencil, Power, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { usePermission } from '../../hooks/usePermission';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { requestTemplateService, type RequestTemplateSummary } from '../../lib/requestTemplateService';

const STATUS: Record<RequestTemplateSummary['status'], { label: string; className: string }> = {
  DRAFT: { label: 'Bản nháp', className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/25 dark:text-amber-300 dark:border-amber-800' },
  PUBLISHED: { label: 'Đang áp dụng', className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-300 dark:border-emerald-800' },
  DEACTIVATED: { label: 'Ngừng áp dụng', className: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
};

const formatDateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short', timeStyle: 'short',
}).format(new Date(value));

const RequestTemplates: React.FC = () => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { canManage } = usePermission();
  const [items, setItems] = useState<RequestTemplateSummary[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | RequestTemplateSummary['status']>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [isMutatingId, setIsMutatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mayManage = canManage('/rq/templates');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await requestTemplateService.list({
        search: search.trim() || undefined,
        status: status === 'ALL' ? undefined : status,
      });
      setItems(result.items);
    } catch (cause) {
      console.error('Load request templates failed:', cause);
      setError('Không thể tải danh sách mẫu yêu cầu. Vui lòng thử lại.');
    } finally {
      setIsLoading(false);
    }
  }, [search, status]);

  useEffect(() => { void load(); }, [load]);

  const emptyMessage = useMemo(() => search || status !== 'ALL'
    ? 'Không có mẫu nào khớp với bộ lọc.'
    : 'Chưa có mẫu yêu cầu nào.', [search, status]);

  const editPublished = async (template: RequestTemplateSummary) => {
    setIsMutatingId(template.id);
    try {
      const draft = await requestTemplateService.createDraftFromPublished(template.id);
      toast.success('Đã tạo bản nháp', `Bạn đang sửa mẫu “${template.name}”.`);
      navigate(`/rq/templates/${draft.id}`);
    } catch (cause) {
      console.error('Create request template draft from published failed:', cause);
      toast.error('Không thể sửa mẫu', 'Vui lòng thử lại.');
    } finally {
      setIsMutatingId(null);
    }
  };

  const copyTemplate = async (template: RequestTemplateSummary) => {
    setIsMutatingId(template.id);
    try {
      const draft = await requestTemplateService.duplicate(template.id);
      toast.success('Đã sao chép mẫu', `Đã tạo “${draft.payload.name}”.`);
      navigate(`/rq/templates/${draft.id}`);
    } catch (cause) {
      console.error('Duplicate request template failed:', cause);
      toast.error('Không thể sao chép mẫu', 'Vui lòng thử lại.');
    } finally {
      setIsMutatingId(null);
    }
  };

  const deactivate = async (template: RequestTemplateSummary) => {
    const accepted = await confirm({
      title: 'Ngừng áp dụng mẫu yêu cầu?',
      targetName: template.name,
      subtitle: 'Các đề xuất đã gửi vẫn giữ nguyên lịch sử; người dùng sẽ không thể tạo đề xuất mới từ mẫu này.',
      actionLabel: 'Ngừng áp dụng',
      intent: 'warning',
    });
    if (!accepted) return;
    setIsMutatingId(template.id);
    try {
      await requestTemplateService.deactivate({ templateId: template.id, expectedUpdatedAt: template.updatedAt });
      toast.success('Đã ngừng áp dụng mẫu', template.name);
      await load();
    } catch (cause) {
      console.error('Deactivate request template failed:', cause);
      toast.error('Không thể ngừng áp dụng mẫu', 'Mẫu có thể vừa được cập nhật bởi người khác. Hãy tải lại và thử lại.');
    } finally {
      setIsMutatingId(null);
    }
  };

  if (!mayManage) {
    return <div className="flex flex-col items-center justify-center h-[60vh] text-slate-400">
      <ShieldAlert size={48} className="mb-4 opacity-20" />
      <h1 className="text-xl font-black uppercase tracking-widest">Truy cập bị từ chối</h1>
      <p className="text-sm font-medium">Bạn chưa có quyền quản trị Mẫu yêu cầu.</p>
    </div>;
  }

  return <div className="space-y-6">
    <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800 dark:text-white"><FileText className="text-accent" size={28} /> Mẫu yêu cầu</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Thiết kế biểu mẫu và luồng phê duyệt tự động cho các đề xuất.</p>
      </div>
      <button onClick={() => navigate('/rq/templates/new')} className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-600">
        <FilePlus2 size={18} className="mr-2" /> Tạo mẫu yêu cầu
      </button>
    </header>

    <section className="glass-card rounded-xl p-4">
      <div className="flex flex-col gap-3 md:flex-row">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm theo tên mẫu..." className="w-full rounded-xl border border-slate-200 bg-white/70 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800/70" />
        </label>
        <select value={status} onChange={event => setStatus(event.target.value as typeof status)} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800/70">
          <option value="ALL">Tất cả trạng thái</option>
          <option value="DRAFT">Bản nháp</option>
          <option value="PUBLISHED">Đang áp dụng</option>
          <option value="DEACTIVATED">Ngừng áp dụng</option>
        </select>
        <button onClick={() => void load()} aria-label="Tải lại danh sách" className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-3 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"><RefreshCw size={17} className={isLoading ? 'animate-spin' : ''} /></button>
      </div>
    </section>

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      {error && <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
      <div className="hidden grid-cols-[minmax(18rem,2fr)_9rem_7rem_11rem_12rem] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 md:grid">
        <span>Mẫu yêu cầu</span><span>Trạng thái</span><span>Phiên bản</span><span>Phạm vi</span><span>Cập nhật</span>
      </div>
      {isLoading ? <div className="px-5 py-12 text-center text-sm text-slate-400">Đang tải mẫu yêu cầu...</div> : items.length === 0 ? <div className="px-5 py-12 text-center text-sm text-slate-400">{emptyMessage}</div> : items.map(template => {
        const state = STATUS[template.status];
        const busy = isMutatingId === template.id;
        return <article key={template.id} className="grid gap-3 border-b border-slate-100 px-5 py-4 last:border-b-0 dark:border-slate-800 md:grid-cols-[minmax(18rem,2fr)_9rem_7rem_11rem_12rem] md:items-center md:gap-4">
          <div className="min-w-0"><p className="truncate font-bold text-slate-800 dark:text-slate-100">{template.name}</p><p className="mt-1 text-xs text-slate-400">ID: {template.id}</p></div>
          <div><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${state.className}`}>{state.label}</span></div>
          <div className="text-sm text-slate-600 dark:text-slate-300">{template.publishedVersionNumber ? `v${template.publishedVersionNumber}` : '—'}</div>
          <div className="text-sm text-slate-600 dark:text-slate-300">{template.usageScopeLabel}</div>
          <div className="flex items-center justify-between gap-3 text-sm text-slate-500"><span>{formatDateTime(template.updatedAt)}</span><div className="flex shrink-0 gap-1">
            {template.status === 'DRAFT' && <button disabled={busy} onClick={() => navigate(`/rq/templates/${template.id}`)} title="Sửa bản nháp" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-accent disabled:opacity-50 dark:hover:bg-slate-800"><Pencil size={16} /></button>}
            {template.status === 'PUBLISHED' && <button disabled={busy} onClick={() => void editPublished(template)} title="Sửa mẫu" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-accent disabled:opacity-50 dark:hover:bg-slate-800"><Pencil size={16} /></button>}
            <button disabled={busy} onClick={() => void copyTemplate(template)} title="Sao chép mẫu" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-accent disabled:opacity-50 dark:hover:bg-slate-800"><Copy size={16} /></button>
            {template.status !== 'DEACTIVATED' && <button disabled={busy} onClick={() => void deactivate(template)} title="Ngừng áp dụng" className="rounded-lg p-2 text-slate-500 transition hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50 dark:hover:bg-amber-950/30"><Power size={16} /></button>}
          </div></div>
        </article>;
      })}
    </section>
  </div>;
};

export default RequestTemplates;
