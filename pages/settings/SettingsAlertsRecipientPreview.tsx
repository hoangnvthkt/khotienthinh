import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Eye, Loader2 } from 'lucide-react';
import {
  notificationAlertRuleService,
  type AlertRecipientPreview,
  type AlertRecipientSource,
  type NotificationAlertRule,
} from '../../lib/notificationAlertRules';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

export interface AlertPreviewProject {
  id: string;
  name: string;
  code?: string | null;
}

// Alerts raised for one project; everything else is company-wide.
const PROJECT_ALERT_KEYS = new Set([
  'overdue_payment', 'stale_daily_log', 'budget_overrun', 'slow_progress', 'material_waste', 'safety_critical',
]);

const SOURCE_LABELS: Record<AlertRecipientSource, string> = {
  project_permission: 'Quyền trong dự án',
  site_command: 'Ban chỉ huy',
  admin: 'Admin',
  fallback: 'Admin (dự phòng)',
  module_admins: 'Quản trị module',
  roles: 'Theo vai trò',
  users: 'Chỉ định',
  employee_owner: 'Nhân sự liên quan',
  broadcast: 'Mọi người',
};

const SOURCE_TONES: Partial<Record<AlertRecipientSource, string>> = {
  site_command: 'bg-orange-50 text-orange-700',
  project_permission: 'bg-blue-50 text-blue-700',
  fallback: 'bg-amber-50 text-amber-700',
};

interface Props {
  rule: NotificationAlertRule;
  projects: AlertPreviewProject[];
}

// "Who gets this?" for the rule as currently edited (saved or not).
const SettingsAlertsRecipientPreview: React.FC<Props> = ({ rule, projects }) => {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [recipients, setRecipients] = useState<AlertRecipientPreview[]>([]);

  const mode = rule.recipientConfig?.mode || 'admin';
  const needsProject = PROJECT_ALERT_KEYS.has(rule.alertKey)
    && (mode === 'project_permission' || rule.recipientConfig?.includeSiteCommand);

  const runPreview = async () => {
    setState('loading');
    setError('');
    try {
      setRecipients(await notificationAlertRuleService.previewRecipients(
        rule.alertKey, needsProject ? projectId : null, rule.recipientConfig));
      setState('ready');
    } catch (err) {
      logApiError('settings.alerts.preview', err);
      setError(getApiErrorMessage(err, 'Không xem trước được người nhận.'));
      setState('error');
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-xs font-black text-slate-600 hover:bg-slate-50"
      >
        <span className="inline-flex items-center gap-2"><Eye size={14} /> Xem trước người nhận</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-100 px-4 py-3">
          {mode === 'employee_owner' ? (
            <p className="text-xs font-bold text-slate-500">Cảnh báo này gửi cho chính nhân sự phát sinh cảnh báo.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row">
                {needsProject && (
                  <select
                    value={projectId}
                    onChange={event => { setProjectId(event.target.value); setState('idle'); }}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-blue-300"
                  >
                    <option value="">Chọn dự án để xem...</option>
                    {projects.map(project => (
                      <option key={project.id} value={project.id}>
                        {project.code ? `${project.code} · ${project.name}` : project.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={runPreview}
                  disabled={state === 'loading' || (needsProject && !projectId)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {state === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Xem
                </button>
              </div>
              <p className="text-[11px] font-bold text-slate-400">Theo cấu hình đang sửa trên màn hình, kể cả khi chưa bấm Lưu.</p>

              {state === 'error' && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>
              )}
              {state === 'ready' && recipients.length === 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                  Không ai nhận cảnh báo này với cấu hình hiện tại.
                </p>
              )}
              {state === 'ready' && recipients.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-black text-slate-600">{recipients.length} người nhận</p>
                  <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
                    {recipients.map(recipient => (
                      <li key={recipient.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span className="text-sm font-bold text-slate-700">{recipient.name}</span>
                        <span className="flex flex-wrap gap-1">
                          {recipient.sources.map(source => (
                            <span key={source} className={`rounded-full px-2 py-0.5 text-[10px] font-black ${SOURCE_TONES[source] || 'bg-slate-100 text-slate-600'}`}>
                              {SOURCE_LABELS[source] || source}
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SettingsAlertsRecipientPreview;
