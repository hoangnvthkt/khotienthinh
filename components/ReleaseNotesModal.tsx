import React from 'react';
import {
  Bell,
  Bug,
  CalendarDays,
  CheckCircle2,
  History,
  Loader2,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { AppRelease, ReleaseNoteEntry } from '../lib/releaseNoticeService';

interface ReleaseNotesModalProps {
  isOpen: boolean;
  release: AppRelease | null;
  isSubmitting?: boolean;
  onAcknowledge: () => void | Promise<void>;
  onViewHistory?: () => void;
}

const formatReleaseDate = (dateValue: string) => {
  if (!dateValue) return 'Chưa có ngày cập nhật';

  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateValue;

  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

const getEntryTitle = (entry: ReleaseNoteEntry) => typeof entry === 'string' ? entry : entry.title;
const getEntryDescription = (entry: ReleaseNoteEntry) => typeof entry === 'string' ? '' : entry.description;

const ReleaseSection: React.FC<{
  title: string;
  items: ReleaseNoteEntry[];
  icon: React.ReactNode;
  accentClass: string;
}> = ({ title, items, icon, accentClass }) => {
  if (items.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${accentClass}`}>
          {icon}
        </span>
        <h3 className="text-sm font-black text-slate-800 dark:text-white">{title}</h3>
      </div>
      <ul className="space-y-2 pl-9">
        {items.map((item, index) => {
          const description = getEntryDescription(item);
          return (
            <li key={`${title}-${index}`} className="relative text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              <span className="absolute -left-4 top-2 h-1.5 w-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
              <span className="font-semibold text-slate-800 dark:text-slate-100">{getEntryTitle(item)}</span>
              {description && (
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {description}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

const ReleaseNotesModal: React.FC<ReleaseNotesModalProps> = ({
  isOpen,
  release,
  isSubmitting = false,
  onAcknowledge,
  onViewHistory,
}) => {
  if (!isOpen || !release) return null;

  const hasDetails =
    release.features.length > 0 ||
    release.improvements.length > 0 ||
    release.bugFixes.length > 0;

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="release-notes-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900">
              <Bell size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-black uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  Phiên bản {release.version}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <CalendarDays size={13} />
                  {formatReleaseDate(release.releaseDate)}
                </span>
              </div>
              <h2 id="release-notes-title" className="text-lg font-black text-slate-900 dark:text-white sm:text-xl">
                Có gì mới trong phiên bản {release.version}
              </h2>
              <p className="mt-1 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                {release.title}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          {release.summary && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
              {release.summary}
            </p>
          )}

          {hasDetails ? (
            <div className="space-y-5">
              <ReleaseSection
                title="Tính năng mới"
                items={release.features}
                icon={<Sparkles size={15} />}
                accentClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"
              />
              <ReleaseSection
                title="Cải tiến"
                items={release.improvements}
                icon={<Wrench size={15} />}
                accentClass="bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300"
              />
              <ReleaseSection
                title="Sửa lỗi"
                items={release.bugFixes}
                icon={<Bug size={15} />}
                accentClass="bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300"
              />
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Bản cập nhật này tập trung làm hệ thống ổn định và dễ dùng hơn.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          {onViewHistory ? (
            <button
              type="button"
              onClick={onViewHistory}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <History size={16} />
              Xem lịch sử cập nhật
            </button>
          ) : (
            <div />
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onAcknowledge}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Không hiển thị lại phiên bản này
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onAcknowledge}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-emerald-600/20 transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              Đã hiểu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReleaseNotesModal;
