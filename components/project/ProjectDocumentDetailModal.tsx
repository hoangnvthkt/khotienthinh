import React from 'react';
import { Clock3, UserCheck, X } from 'lucide-react';

export interface ProjectDocumentDetailAction {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  intent?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  disabled?: boolean;
}

export interface ProjectDocumentDetailInfo {
  label: string;
  value?: React.ReactNode;
}

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  statusLabel: string;
  statusClassName?: string;
  documentLabel?: string;
  currentHandlerName?: string | null;
  lastActionAt?: string | null;
  details?: ProjectDocumentDetailInfo[];
  actions?: ProjectDocumentDetailAction[];
  children?: React.ReactNode;
  onClose: () => void;
}

const intentClass: Record<NonNullable<ProjectDocumentDetailAction['intent']>, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 border-blue-600',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-600',
  warning: 'bg-amber-500 text-white hover:bg-amber-600 border-amber-500',
  danger: 'bg-red-50 text-red-600 hover:bg-red-100 border-red-200',
  neutral: 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200',
};

const ProjectDocumentDetailModal: React.FC<Props> = ({
  open,
  title,
  subtitle,
  statusLabel,
  statusClassName,
  documentLabel = 'Phiếu',
  currentHandlerName,
  lastActionAt,
  details = [],
  actions = [],
  children,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 px-3 py-5" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase text-slate-400">{documentLabel}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${statusClassName || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                {statusLabel}
              </span>
            </div>
            <h3 className="mt-1 truncate text-base font-black text-slate-800">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs font-semibold text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 grid gap-2 md:grid-cols-4">
            <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
              <div className="flex items-center gap-1 text-[9px] font-black uppercase text-amber-600">
                <UserCheck size={11} /> Người giữ bước
              </div>
              <div className="mt-1 truncate text-xs font-black text-slate-700">{currentHandlerName || 'Không có'}</div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-1 text-[9px] font-black uppercase text-slate-400">
                <Clock3 size={11} /> Cập nhật cuối
              </div>
              <div className="mt-1 truncate text-xs font-bold text-slate-600">
                {lastActionAt ? new Date(lastActionAt).toLocaleString('vi-VN') : 'Chưa có'}
              </div>
            </div>
            {details.map((item, index) => (
              <div key={`${item.label}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="text-[9px] font-black uppercase text-slate-400">{item.label}</div>
                <div className="mt-1 truncate text-xs font-bold text-slate-700">{item.value || '-'}</div>
              </div>
            ))}
          </div>

          {children}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4">
          {actions.map((action, index) => (
            <button
              key={`${action.label}-${index}`}
              onClick={action.onClick}
              disabled={action.disabled}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-black disabled:opacity-50 ${intentClass[action.intent || 'neutral']}`}
            >
              {action.icon} {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProjectDocumentDetailModal;
