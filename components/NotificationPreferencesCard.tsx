import React, { useEffect, useState } from 'react';
import { BellRing, Check, Loader2, Lock, RefreshCw, Save } from 'lucide-react';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationService,
  type NotificationPreferences,
} from '../lib/notificationService';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';

const DIGEST_TIMES = ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '20:00'];

type Option<T extends string> = { value: T; label: string };

const WATCHING_OPTIONS: Option<NotificationPreferences['watchingMode']>[] = [
  { value: 'instant', label: 'Báo ngay' },
  { value: 'digest', label: 'Tổng hợp cuối ngày' },
  { value: 'muted', label: 'Không báo' },
];

const RESPONSIBLE_OPTIONS: Option<NotificationPreferences['responsibleMode']>[] = [
  { value: 'instant', label: 'Báo ngay' },
  { value: 'digest', label: 'Tổng hợp cuối ngày' },
];

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`min-h-8 rounded-md px-3 text-xs font-black transition ${
              selected
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const Row: React.FC<{ title: string; hint: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="flex flex-col gap-2 border-t border-slate-100 py-4 first:border-t-0 first:pt-0 dark:border-slate-800 md:flex-row md:items-center md:justify-between">
    <div className="min-w-0">
      <p className="text-sm font-black text-slate-800 dark:text-white">{title}</p>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

// Per-person choice of how "Following" and "Business area" notices arrive.
const NotificationPreferencesCard: React.FC<{ userId: string }> = ({ userId }) => {
  const toast = useToast();
  const [saved, setSaved] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [draft, setDraft] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setState('loading');
    try {
      const preferences = await notificationService.getMyPreferences(userId);
      setSaved(preferences);
      setDraft(preferences);
      setState('ready');
    } catch (error) {
      logApiError('notifications.preferences.load', error);
      setState('error');
    }
  };

  useEffect(() => {
    load();
  }, [userId]);

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const usesDigest = draft.watchingMode === 'digest' || draft.responsibleMode === 'digest';

  const save = async () => {
    setSaving(true);
    try {
      await notificationService.saveMyPreferences(draft);
      setSaved(draft);
      toast.success('Đã lưu cách nhận thông báo', usesDigest ? `Tổng hợp gửi lúc ${draft.digestTime} mỗi ngày.` : 'Áp dụng cho thông báo mới.');
    } catch (error) {
      logApiError('notifications.preferences.save', error);
      toast.error('Không lưu được', getApiErrorMessage(error, 'Không thể lưu cách nhận thông báo.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="notification-preferences" className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 md:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
            <BellRing size={18} />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900 dark:text-white">Cách nhận thông báo</h2>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Chọn báo ngay hay gom vào một bản tổng hợp cuối ngày. Áp dụng cho thông báo mới.
            </p>
          </div>
        </div>
      </div>

      {state === 'loading' && (
        <div className="flex items-center gap-2 py-4 text-sm font-bold text-slate-400">
          <Loader2 size={16} className="animate-spin" /> Đang tải...
        </div>
      )}

      {state === 'error' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          Không tải được cài đặt thông báo.
          <button type="button" onClick={load} className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-xs font-black hover:bg-red-100">
            <RefreshCw size={12} /> Thử lại
          </button>
        </div>
      )}

      {state === 'ready' && (
        <>
          <Row title="Việc của tôi" hint="Được giao việc, đến lượt bạn duyệt, được nhắc tên.">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <Lock size={12} /> Luôn báo ngay
            </span>
          </Row>
          <Row
            title="Theo dõi"
            hint={draft.watchingMode === 'muted'
              ? 'Không báo: vẫn lưu ở tab Theo dõi và tự đánh dấu đã đọc.'
              : 'Cập nhật về phiếu, hồ sơ bạn tạo hoặc đang theo dõi.'}
          >
            <Segmented label="Theo dõi" value={draft.watchingMode} options={WATCHING_OPTIONS}
              onChange={watchingMode => setDraft(prev => ({ ...prev, watchingMode }))} />
          </Row>
          <Row title="Nghiệp vụ" hint="Cảnh báo cho mảng bạn phụ trách. Cảnh báo nghiêm trọng luôn báo ngay.">
            <Segmented label="Nghiệp vụ" value={draft.responsibleMode} options={RESPONSIBLE_OPTIONS}
              onChange={responsibleMode => setDraft(prev => ({ ...prev, responsibleMode }))} />
          </Row>
          {usesDigest && (
            <Row title="Giờ nhận tổng hợp" hint="Một thông báo tóm tắt mỗi ngày, chỉ gửi khi có nội dung.">
              <select
                value={draft.digestTime}
                onChange={event => setDraft(prev => ({ ...prev, digestTime: event.target.value }))}
                className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-indigo-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                {DIGEST_TIMES.map(time => <option key={time} value={time}>{time}</option>)}
              </select>
            </Row>
          )}
          <div className="mt-2 flex items-center justify-end gap-3">
            {!dirty && <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-400"><Check size={12} /> Đã lưu</span>}
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-4 text-xs font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-900"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu thay đổi
            </button>
          </div>
        </>
      )}
    </section>
  );
};

export default NotificationPreferencesCard;
