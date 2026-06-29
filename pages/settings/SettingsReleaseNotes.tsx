import React, { useEffect, useMemo, useState } from 'react';
import {
  Bug,
  CalendarDays,
  Edit2,
  Eye,
  Loader2,
  Megaphone,
  Plus,
  RefreshCcw,
  Save,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import {
  AppRelease,
  AppReleaseInput,
  AppReleaseWithStats,
  ReleaseNoteEntry,
  releaseNoticeService,
} from '../../lib/releaseNoticeService';
import { isSupabaseConfigured } from '../../lib/supabase';

type ReleaseFormState = {
  version: string;
  title: string;
  releaseDate: string;
  summary: string;
  features: string;
  improvements: string;
  bugFixes: string;
  isActive: boolean;
};

const toLocalDateInputValue = (value = new Date()) => {
  const offset = value.getTimezoneOffset();
  const local = new Date(value.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
};

const defaultVersion = () => toLocalDateInputValue().replace(/-/g, '.');

const emptyForm = (): ReleaseFormState => ({
  version: defaultVersion(),
  title: '',
  releaseDate: toLocalDateInputValue(),
  summary: '',
  features: '',
  improvements: '',
  bugFixes: '',
  isActive: true,
});

const noteEntryToLine = (entry: ReleaseNoteEntry) => {
  if (typeof entry === 'string') return entry;
  return entry.description ? `${entry.title} - ${entry.description}` : entry.title;
};

const notesToLines = (items: ReleaseNoteEntry[]) => items.map(noteEntryToLine).join('\n');

const linesToNotes = (value: string): ReleaseNoteEntry[] =>
  value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

const releaseToForm = (release: AppRelease): ReleaseFormState => ({
  version: release.version,
  title: release.title,
  releaseDate: release.releaseDate,
  summary: release.summary,
  features: notesToLines(release.features),
  improvements: notesToLines(release.improvements),
  bugFixes: notesToLines(release.bugFixes),
  isActive: release.isActive,
});

const formToInput = (form: ReleaseFormState): AppReleaseInput => ({
  version: form.version.trim(),
  title: form.title.trim(),
  releaseDate: form.releaseDate,
  summary: form.summary.trim(),
  features: linesToNotes(form.features),
  improvements: linesToNotes(form.improvements),
  bugFixes: linesToNotes(form.bugFixes),
  isActive: form.isActive,
});

const formatDate = (value: string) => {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

const countLines = (value: string) => linesToNotes(value).length;

const NoteTextarea: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon: React.ReactNode;
  placeholder: string;
}> = ({ label, value, onChange, icon, placeholder }) => (
  <div className="space-y-2">
    <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
      {icon}
      {label}
      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-400">{countLines(value)}</span>
    </label>
    <textarea
      value={value}
      onChange={event => onChange(event.target.value)}
      rows={4}
      placeholder={placeholder}
      className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
    />
  </div>
);

const SettingsReleaseNotes: React.FC = () => {
  const toast = useToast();
  const confirm = useConfirm();
  const [releases, setReleases] = useState<AppReleaseWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRelease, setEditingRelease] = useState<AppReleaseWithStats | null>(null);
  const [form, setForm] = useState<ReleaseFormState>(emptyForm);

  const stats = useMemo(() => {
    const active = releases.filter(release => release.isActive).length;
    const totalReads = releases.reduce((sum, release) => sum + release.readCount, 0);
    const latestActive = releases.find(release => release.isActive) || null;
    return { active, totalReads, latestActive };
  }, [releases]);

  const fetchReleases = async () => {
    if (!isSupabaseConfigured) {
      setReleases([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const rows = await releaseNoticeService.listReleasesWithStats();
      setReleases(rows);
    } catch (error) {
      logApiError('settings.releaseNotes.fetch', error);
      toast.error('Không tải được thông báo phiên bản', getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchReleases();
  }, []);

  const openCreateModal = () => {
    setEditingRelease(null);
    setForm(emptyForm());
    setIsModalOpen(true);
  };

  const openEditModal = (release: AppReleaseWithStats) => {
    setEditingRelease(release);
    setForm(releaseToForm(release));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setIsModalOpen(false);
    setEditingRelease(null);
    setForm(emptyForm());
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    const input = formToInput(form);
    if (!input.version || !input.title) {
      toast.warning('Thiếu thông tin phiên bản', 'Vui lòng nhập version và tiêu đề.');
      return;
    }

    setSaving(true);
    try {
      if (editingRelease) {
        await releaseNoticeService.updateRelease(editingRelease.id, input);
        toast.success('Đã cập nhật thông báo phiên bản');
      } else {
        await releaseNoticeService.createRelease(input);
        toast.success('Đã tạo thông báo phiên bản');
      }
      closeModal();
      await fetchReleases();
    } catch (error) {
      logApiError('settings.releaseNotes.save', error);
      toast.error('Không lưu được thông báo phiên bản', getApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (release: AppReleaseWithStats) => {
    setActionId(release.id);
    try {
      await releaseNoticeService.setReleaseActive(release.id, !release.isActive);
      await fetchReleases();
    } catch (error) {
      logApiError('settings.releaseNotes.toggle', error);
      toast.error('Không cập nhật được trạng thái', getApiErrorMessage(error));
    } finally {
      setActionId(null);
    }
  };

  const handleResetReads = async (release: AppReleaseWithStats) => {
    const ok = await confirm({
      title: 'Xoá lượt đã xem',
      targetName: `phiên bản ${release.version}`,
      warningText: 'Người dùng đã xem phiên bản này sẽ thấy lại thông báo sau khi đăng nhập hoặc tải lại app.',
      actionLabel: 'Xoá lượt xem',
      intent: 'warning',
      countdownSeconds: 1,
    });
    if (!ok) return;

    setActionId(release.id);
    try {
      await releaseNoticeService.resetReleaseReads(release.id);
      toast.success('Đã xoá lượt đã xem');
      await fetchReleases();
    } catch (error) {
      logApiError('settings.releaseNotes.resetReads', error);
      toast.error('Không xoá được lượt đã xem', getApiErrorMessage(error));
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (release: AppReleaseWithStats) => {
    const ok = await confirm({
      title: 'Xoá thông báo phiên bản',
      targetName: release.version,
      warningText: 'Thông báo và toàn bộ lượt đã xem của phiên bản này sẽ bị xoá.',
      actionLabel: 'Xoá',
      intent: 'danger',
      countdownSeconds: 2,
    });
    if (!ok) return;

    setActionId(release.id);
    try {
      await releaseNoticeService.deleteRelease(release.id);
      toast.success('Đã xoá thông báo phiên bản');
      await fetchReleases();
    } catch (error) {
      logApiError('settings.releaseNotes.delete', error);
      toast.error('Không xoá được thông báo phiên bản', getApiErrorMessage(error));
    } finally {
      setActionId(null);
    }
  };

  const updateForm = <K extends keyof ReleaseFormState>(key: K, value: ReleaseFormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
              <Megaphone size={22} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-black text-slate-900">Thông báo phiên bản</h2>
              <p className="text-xs font-semibold text-slate-500">What&apos;s New sau đăng nhập</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={fetchReleases}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCcw size={15} className={loading ? 'animate-spin' : ''} />
              Làm mới
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700"
            >
              <Plus size={15} />
              Tạo phiên bản
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 border-b border-slate-100 sm:grid-cols-3">
          <div className="px-5 py-4">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tổng phiên bản</div>
            <div className="mt-1 text-2xl font-black text-slate-900">{releases.length}</div>
          </div>
          <div className="border-t border-slate-100 px-5 py-4 sm:border-l sm:border-t-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Đang active</div>
            <div className="mt-1 text-2xl font-black text-emerald-600">{stats.active}</div>
          </div>
          <div className="border-t border-slate-100 px-5 py-4 sm:border-l sm:border-t-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lượt đã xem</div>
            <div className="mt-1 text-2xl font-black text-slate-900">{stats.totalReads}</div>
          </div>
        </div>

        {stats.latestActive && (
          <div className="border-b border-emerald-100 bg-emerald-50/60 px-5 py-3 text-sm font-semibold text-emerald-800">
            Phiên bản sẽ hiện sau đăng nhập: <span className="font-black">{stats.latestActive.version}</span>
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-sm font-bold text-slate-400">
              <Loader2 size={20} className="animate-spin text-emerald-500" />
              Đang tải thông báo phiên bản...
            </div>
          ) : releases.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-5 py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                <Megaphone size={26} />
              </div>
              <h3 className="text-sm font-black text-slate-700">Chưa có thông báo phiên bản</h3>
              <button
                type="button"
                onClick={openCreateModal}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white transition hover:bg-emerald-700"
              >
                <Plus size={15} />
                Tạo phiên bản đầu tiên
              </button>
            </div>
          ) : (
            releases.map(release => {
              const busy = actionId === release.id;
              const detailCount = release.features.length + release.improvements.length + release.bugFixes.length;
              return (
                <div key={release.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-black uppercase text-slate-700">
                        {release.version}
                      </span>
                      {release.isActive ? (
                        <span className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-black uppercase text-emerald-700">
                          Active
                        </span>
                      ) : (
                        <span className="rounded-md bg-slate-50 px-2 py-1 text-[11px] font-black uppercase text-slate-400">
                          Inactive
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                        <CalendarDays size={13} />
                        {formatDate(release.releaseDate)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                        <Eye size={13} />
                        {release.readCount}
                      </span>
                    </div>
                    <h3 className="truncate text-base font-black text-slate-900">{release.title}</h3>
                    {release.summary && (
                      <p className="mt-1 line-clamp-2 text-sm font-medium leading-relaxed text-slate-500">{release.summary}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500">
                      <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">Tính năng: {release.features.length}</span>
                      <span className="rounded-md bg-sky-50 px-2 py-1 text-sky-700">Cải tiến: {release.improvements.length}</span>
                      <span className="rounded-md bg-rose-50 px-2 py-1 text-rose-700">Sửa lỗi: {release.bugFixes.length}</span>
                      {detailCount === 0 && <span className="rounded-md bg-slate-50 px-2 py-1 text-slate-400">Không có mục chi tiết</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(release)}
                      disabled={busy}
                      className={`inline-flex min-w-28 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-black transition disabled:opacity-60 ${
                        release.isActive
                          ? 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                          : 'bg-emerald-600 text-white hover:bg-emerald-700'
                      }`}
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                      {release.isActive ? 'Tắt' : 'Bật'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(release)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
                      title="Sửa"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResetReads(release)}
                      disabled={busy || release.readCount === 0}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-amber-50 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Xoá lượt đã xem"
                    >
                      <RefreshCcw size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(release)}
                      disabled={busy}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      title="Xoá"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  {editingRelease ? 'Cập nhật thông báo phiên bản' : 'Tạo thông báo phiên bản'}
                </h3>
                <p className="text-xs font-semibold text-slate-500">Nội dung sẽ hiện trong modal What&apos;s New.</p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="flex-1 overflow-y-auto">
              <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Version</label>
                  <input
                    value={form.version}
                    onChange={event => updateForm('version', event.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    placeholder="2026.06.29"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Ngày cập nhật</label>
                  <input
                    type="date"
                    value={form.releaseDate}
                    onChange={event => updateForm('releaseDate', event.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Tiêu đề</label>
                  <input
                    value={form.title}
                    onChange={event => updateForm('title', event.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    placeholder="Cập nhật hệ thống Vioo"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Tóm tắt</label>
                  <textarea
                    value={form.summary}
                    onChange={event => updateForm('summary', event.target.value)}
                    rows={3}
                    className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    placeholder="Bản cập nhật bổ sung các cải tiến quan trọng cho người dùng."
                  />
                </div>
                <NoteTextarea
                  label="Tính năng mới"
                  value={form.features}
                  onChange={value => updateForm('features', value)}
                  icon={<Sparkles size={14} className="text-emerald-600" />}
                  placeholder="Mỗi dòng là một tính năng mới"
                />
                <NoteTextarea
                  label="Cải tiến"
                  value={form.improvements}
                  onChange={value => updateForm('improvements', value)}
                  icon={<Wrench size={14} className="text-sky-600" />}
                  placeholder="Mỗi dòng là một cải tiến"
                />
                <div className="md:col-span-2">
                  <NoteTextarea
                    label="Sửa lỗi"
                    value={form.bugFixes}
                    onChange={value => updateForm('bugFixes', value)}
                    icon={<Bug size={14} className="text-rose-600" />}
                    placeholder="Mỗi dòng là một lỗi đã sửa"
                  />
                </div>
                <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 md:col-span-2">
                  <span>
                    <span className="block text-sm font-black text-slate-800">Active</span>
                    <span className="block text-xs font-semibold text-slate-500">Cho phép hiển thị sau đăng nhập</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={event => updateForm('isActive', event.target.checked)}
                    className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:opacity-70"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {editingRelease ? 'Cập nhật' : 'Tạo phiên bản'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsReleaseNotes;
