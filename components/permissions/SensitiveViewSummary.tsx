import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import {
  projectSensitiveAccessService,
  type UserSensitiveViewSummary,
} from '../../lib/projectSensitiveAccessService';
import { getScopeEntityLabel, usePermissionScopeEntities } from '../../lib/permissions/permissionScopeEntities';

interface SensitiveViewSummaryProps {
  userId: string;
  isAdmin: boolean;
}

const MAX_NAMES = 4;

// Who may see Finance and Contracts is switched per project by an Admin in the project's
// own Permissions tab; this card only shows the result for the person being edited.
const SensitiveViewSummary: React.FC<SensitiveViewSummaryProps> = ({ userId, isAdmin }) => {
  const { entities } = usePermissionScopeEntities();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [summary, setSummary] = useState<UserSensitiveViewSummary | null>(null);
  const [reload, setReload] = useState(0);
  const retry = useCallback(() => setReload(count => count + 1), []);

  useEffect(() => {
    if (isAdmin) return undefined;
    let cancelled = false;
    setState('loading');
    projectSensitiveAccessService.getUserSummary(userId)
      .then(result => { if (!cancelled) { setSummary(result); setState('ready'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [userId, isAdmin, reload]);

  const projectLinks = (ids: readonly string[]) => (
    <>
      {ids.slice(0, MAX_NAMES).map((id, index) => (
        <React.Fragment key={id}>
          {index > 0 && ', '}
          <a
            href={`#/da?projectId=${encodeURIComponent(id)}&tab=permissions`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-bold text-indigo-700 hover:text-indigo-900"
          >
            {getScopeEntityLabel(entities, 'project', id)} <ExternalLink size={10} />
          </a>
        </React.Fragment>
      ))}
      {ids.length > MAX_NAMES && ` và ${ids.length - MAX_NAMES} dự án khác`}
    </>
  );

  const line = (label: string, all: boolean, projectIds: readonly string[], extra?: React.ReactNode) => {
    const enabled = all || projectIds.length > 0 || Boolean(extra);
    return (
      <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
        <span className="w-16 shrink-0 font-black text-slate-700">{label}</span>
        <span className={enabled ? 'text-slate-600' : 'text-slate-400'}>
          {all && <span className="font-bold text-emerald-700">Tất cả dự án</span>}
          {!all && projectIds.length > 0 && projectLinks(projectIds)}
          {extra && <span>{(all || projectIds.length > 0) ? '. ' : ''}{extra}</span>}
          {!enabled && 'Chưa được bật'}
        </span>
      </li>
    );
  };

  return (
    <section className="rounded-xl border border-indigo-100 bg-white p-3">
      <div className="text-xs font-black uppercase tracking-wide text-indigo-700">Xem Tài chính và Hợp đồng</div>
      <p className="mt-1 text-[11px] text-slate-500">
        Quản trị viên bật cho từng dự án ở tab Phân quyền của dự án. Ở đây chỉ để xem kết quả của người này.
      </p>

      {isAdmin && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
          Quản trị viên xem được Tài chính và Hợp đồng của mọi dự án.
        </p>
      )}
      {!isAdmin && state === 'loading' && (
        <p className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-400"><Loader2 size={14} className="animate-spin" /> Đang tải…</p>
      )}
      {!isAdmin && state === 'error' && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
          Không tải được quyền xem Tài chính và Hợp đồng của người này.
          <button type="button" onClick={retry} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-black">
            <RefreshCw size={12} /> Thử lại
          </button>
        </div>
      )}
      {!isAdmin && state === 'ready' && summary && (
        <ul className="mt-3 space-y-1.5">
          {line('Tài chính', summary.financeAll, summary.financeProjectIds)}
          {line('Hợp đồng', summary.contractAll, summary.contractProjectIds,
            summary.contractManager ? 'Là người quản lý hợp đồng công ty, xem mọi hợp đồng' : undefined)}
          {summary.roomProjectIds.length > 0 && (
            <li className="text-[11px] text-slate-500">
              Tự động xem cả hai ở: {projectLinks(summary.roomProjectIds)} (xử lý Thanh toán hoặc Nghiệm thu)
            </li>
          )}
        </ul>
      )}
    </section>
  );
};

export default SensitiveViewSummary;
