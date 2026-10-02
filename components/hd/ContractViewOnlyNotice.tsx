import React from 'react';
import { Lock } from 'lucide-react';
import { contractManageLockReason, type ContractManageKind } from '../../lib/permissions/contractPermissions';

// Why the add / edit / delete buttons are missing for someone who can only view.
const ContractViewOnlyNotice: React.FC<{ kind: ContractManageKind }> = ({ kind }) => (
  <div role="note" className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
    <Lock size={14} className="mt-0.5 shrink-0 text-slate-400" />
    <span>{contractManageLockReason(kind)}</span>
  </div>
);

export default ContractViewOnlyNotice;
