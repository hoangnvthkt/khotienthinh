import React from 'react';
import { getProjectV2AllowedActions } from '../../lib/projectV2/planDomain';
import type { ProjectV2PlanSummary } from '../../lib/projectV2/readService';
import type { ProjectV2CapabilitySet } from '../../types/projectV2';

export function ProjectV2PlanWorkflowActions({ plan, capabilities, actorId, busy, onAction }: {
  plan: ProjectV2PlanSummary; capabilities: Record<string, unknown>; actorId: string;
  busy: boolean; onAction: (action: 'submit' | 'approve' | 'return' | 'revise' | 'cancel') => void;
}) {
  const allowed = getProjectV2AllowedActions({ status: plan.status,
    capabilities: Object.fromEntries(['edit', 'submit', 'approve', 'return', 'revise', 'cancel']
      .map(key => [key, capabilities[key] === true])) as unknown as ProjectV2CapabilitySet,
    actorId, creatorId: plan.creatorUserId, submitterId: plan.submitterUserId });
  const primary = allowed.submit ? { action: 'submit' as const, label: 'Gửi duyệt' }
    : allowed.approve ? { action: 'approve' as const, label: 'Phê duyệt' }
      : allowed.revise ? { action: 'revise' as const, label: 'Tạo bản điều chỉnh' } : null;
  return <div className="flex flex-wrap gap-2">
    {primary && <button type="button" disabled={busy} onClick={() => onAction(primary.action)}
      className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{busy ? 'Đang xử lý…' : primary.label}</button>}
    {allowed.return && <button type="button" disabled={busy} onClick={() => onAction('return')}
      className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold dark:border-slate-600">Trả lại</button>}
    {allowed.cancel && <button type="button" disabled={busy} onClick={() => onAction('cancel')}
      className="min-h-11 rounded-xl border border-red-300 px-4 text-sm font-semibold text-red-700">Hủy kế hoạch</button>}
  </div>;
}
