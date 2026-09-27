import React from 'react';
import { Loader2, Lock, RefreshCw } from 'lucide-react';
import type { SensitiveAccessState } from '../../../hooks/project/useProjectSensitiveAccess';

const LABEL = { finance: 'tài chính', contract: 'hợp đồng' } as const;

interface Props {
  access: SensitiveAccessState;
  domain: 'finance' | 'contract';
  children: React.ReactNode;
}

/** Renders children only when the user may view the domain; never shows empty numbers as 0. */
const SensitiveDataGate: React.FC<Props> = ({ access, domain, children }) => {
  if (access.status === 'loading') {
    return <div className="rounded-2xl border border-slate-100 bg-white p-10 text-center text-sm font-semibold text-slate-400 dark:border-slate-700 dark:bg-slate-800">
      <Loader2 size={20} className="mx-auto mb-2 animate-spin text-slate-400" />Đang kiểm tra quyền xem {LABEL[domain]}…
    </div>;
  }
  if (access.status === 'error') {
    return <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
      <p className="text-sm font-bold text-red-800">Không kiểm tra được quyền xem {LABEL[domain]}</p>
      <p className="mt-1 text-xs text-red-700">{access.message}</p>
      <button type="button" onClick={access.retry} className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-3 py-2 text-xs font-black text-white hover:bg-red-800"><RefreshCw size={13} />Thử lại</button>
    </div>;
  }
  if (!access[domain]) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700"><Lock size={20} className="text-slate-500" /></span>
      <p className="mt-3 text-sm font-black text-slate-700 dark:text-slate-200">Chưa được mở quyền xem {LABEL[domain]} của dự án này</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500 dark:text-slate-400">
        Số liệu {LABEL[domain]} chỉ hiển thị cho người được Admin bật trong tab Phân quyền của dự án. Liên hệ Admin nếu công việc của anh/chị cần xem.
      </p>
    </div>;
  }
  return <>{children}</>;
};

export default SensitiveDataGate;
