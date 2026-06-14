import React, { useEffect, useMemo, useState } from 'react';
import { MessageSquarePlus, Plus, Save, Trash2, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { EmptyState, FilterBar, MobileCardList, PageHeader, PriorityBadge, StatusBadge } from '../components/erp';
import { FeedbackItem, FeedbackPriority, FeedbackStatus, feedbackService } from '../lib/feedbackService';
import { matchesSearchQueryMultiple } from '../lib/searchUtils';

const MODULE_OPTIONS = ['Chung', 'Dự án', 'Vật tư', 'Kho', 'Chất lượng', 'Hợp đồng', 'Nhân sự', 'Tài chính', 'Mobile'];
const PRIORITY_OPTIONS: Array<{ value: FeedbackPriority; label: string }> = [
  { value: 'low', label: 'Thấp' },
  { value: 'medium', label: 'Trung bình' },
  { value: 'high', label: 'Cao' },
  { value: 'critical', label: 'Khẩn cấp' },
];
const STATUS_OPTIONS: Array<{ value: FeedbackStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'new', label: 'Mới' },
  { value: 'triaged', label: 'Đã phân loại' },
  { value: 'in_progress', label: 'Đang xử lý' },
  { value: 'resolved', label: 'Đã xử lý' },
  { value: 'closed', label: 'Đóng' },
];

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'Mới',
  triaged: 'Đã phân loại',
  in_progress: 'Đang xử lý',
  resolved: 'Đã xử lý',
  closed: 'Đóng',
};

const formatDate = (value: string) => new Date(value).toLocaleDateString('vi-VN');

const FeedbackHub: React.FC = () => {
  const { user } = useApp();
  const confirm = useConfirm();
  const toast = useToast();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<FeedbackStatus | 'all'>('all');
  const [module, setModule] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    module: 'Chung',
    priority: 'medium' as FeedbackPriority,
  });

  const load = async () => {
    setItems(await feedbackService.list());
  };

  useEffect(() => {
    void load();
  }, []);

  const counts = useMemo(() => items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    acc[item.priority] = (acc[item.priority] || 0) + 1;
    return acc;
  }, {}), [items]);

  const filtered = useMemo(() => items.filter(item => {
    const matchStatus = status === 'all' || item.status === status;
    const matchModule = module === 'all' || item.module === module;
    const matchSearch = !search.trim() || matchesSearchQueryMultiple([
      item.code,
      item.title,
      item.description,
      item.reporterName,
      item.assigneeName || '',
      item.note || '',
    ], search);
    return matchStatus && matchModule && matchSearch;
  }), [items, module, search, status]);

  const resetForm = () => setForm({ title: '', description: '', module: 'Chung', priority: 'medium' });

  const handleCreate = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast.warning('Thiếu thông tin', 'Vui lòng nhập tiêu đề và nội dung góp ý.');
      return;
    }
    await feedbackService.create({
      ...form,
      reporterId: user.id,
      reporterName: user.name,
    });
    toast.success('Đã ghi nhận góp ý', 'Feedback đang lưu tạm local cho tới khi có schema backend.');
    resetForm();
    setShowForm(false);
    await load();
  };

  const handleStatus = async (item: FeedbackItem, nextStatus: FeedbackStatus) => {
    await feedbackService.update(item.id, {
      status: nextStatus,
      assigneeName: nextStatus === 'new' ? item.assigneeName : item.assigneeName || user.name,
    });
    await load();
  };

  const handleRemove = async (item: FeedbackItem) => {
    const ok = await confirm({
      title: 'Xoá góp ý',
      targetName: `${item.code} - ${item.title}`,
      warningText: 'Góp ý local này sẽ bị xoá khỏi trình duyệt hiện tại.',
      actionLabel: 'Xoá',
      intent: 'danger',
      countdownSeconds: 1,
    });
    if (!ok) return;
    await feedbackService.remove(item.id);
    await load();
  };

  const renderItem = (item: FeedbackItem, framed = true) => (
    <div className={framed ? 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900' : ''}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] font-black text-slate-400">{item.code}</span>
            <StatusBadge status={item.status} label={STATUS_LABELS[item.status]} tone={item.status === 'resolved' || item.status === 'closed' ? 'success' : item.status === 'in_progress' ? 'info' : 'warning'} />
            <PriorityBadge priority={item.priority} />
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-500">{item.module}</span>
          </div>
          <h3 className="mt-2 text-sm font-black text-slate-900 dark:text-white">{item.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">{item.description}</p>
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-bold text-slate-400">
            <span>Người gửi: {item.reporterName}</span>
            {item.assigneeName && <span>Phụ trách: {item.assigneeName}</span>}
            <span>Cập nhật: {formatDate(item.updatedAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 lg:justify-end">
          {(['triaged', 'in_progress', 'resolved', 'closed'] as FeedbackStatus[]).map(next => (
            <button
              key={next}
              type="button"
              onClick={() => handleStatus(item, next)}
              disabled={item.status === next}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              {STATUS_LABELS[next]}
            </button>
          ))}
          <button type="button" onClick={() => handleRemove(item)} className="rounded-lg border border-red-200 px-2.5 py-1.5 text-red-600 hover:bg-red-50">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="ERP Feedback"
        title="Feedback Hub"
        description="Ghi nhận góp ý vận hành theo module để gom lỗi UX, dữ liệu sai và nhu cầu cải tiến."
        meta={
          <>
            <StatusBadge status="new" label={`${counts.new || 0} mới`} tone="warning" size="md" />
            <StatusBadge status="in_progress" label={`${counts.in_progress || 0} đang xử lý`} tone="info" size="md" />
            <StatusBadge status="critical" label={`${counts.critical || 0} khẩn cấp`} tone={(counts.critical || 0) > 0 ? 'danger' : 'neutral'} size="md" />
          </>
        }
        primaryAction={{
          label: showForm ? 'Đóng form' : 'Gửi góp ý',
          icon: showForm ? <X size={16} /> : <Plus size={16} />,
          onClick: () => setShowForm(prev => !prev),
        }}
      />

      {showForm && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <input value={form.title} onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))} placeholder="Tiêu đề góp ý..." className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none lg:col-span-2" />
            <select value={form.module} onChange={event => setForm(prev => ({ ...prev, module: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold">
              {MODULE_OPTIONS.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={form.priority} onChange={event => setForm(prev => ({ ...prev, priority: event.target.value as FeedbackPriority }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold">
              {PRIORITY_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <textarea value={form.description} onChange={event => setForm(prev => ({ ...prev, description: event.target.value }))} placeholder="Mô tả tình huống, màn hình, dữ liệu sai hoặc đề xuất cải tiến..." className="min-h-24 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none lg:col-span-4" />
          </div>
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={handleCreate} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800">
              <Save size={14} /> Lưu góp ý
            </button>
          </div>
        </div>
      )}

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Tìm mã, nội dung, người gửi..."
        canClear={!!search || status !== 'all' || module !== 'all'}
        onClear={() => { setSearch(''); setStatus('all'); setModule('all'); }}
        filters={
          <>
            <select value={status} onChange={event => setStatus(event.target.value as FeedbackStatus | 'all')} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">
              {STATUS_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select value={module} onChange={event => setModule(event.target.value)} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">
              <option value="all">Tất cả module</option>
              {MODULE_OPTIONS.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<MessageSquarePlus size={18} />}
          title="Chưa có góp ý phù hợp"
          message="Gửi góp ý đầu tiên hoặc xoá bộ lọc để xem lại danh sách."
        />
      ) : (
        <>
          <div className="hidden space-y-3 md:block">
            {filtered.map(item => <div key={item.id}>{renderItem(item)}</div>)}
          </div>
          <MobileCardList
            items={filtered}
            getKey={item => item.id}
            renderItem={item => renderItem(item, false)}
          />
        </>
      )}
    </div>
  );
};

export default FeedbackHub;
