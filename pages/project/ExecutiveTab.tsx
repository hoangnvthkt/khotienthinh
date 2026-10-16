import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import FastConsDashboard from '../../components/project/FastConsDashboard';
import { ScheduleVariancePanel } from '../../components/project/schedule-variance/ScheduleVarianceUi';
import { computeScheduleVariance, recentDailyLogIssues, varianceDataDate } from '../../lib/projectScheduleVariance';
import { loadScheduleVarianceInputs, localToday, type ScheduleVarianceInputs } from '../../lib/projectScheduleVarianceService';

interface ExecutiveTabProps {
  constructionSiteId: string;
  projectId?: string;
}

// Thẻ "Tiến độ tổng — đang tới đâu?" (PR-3, 15/10/2026): Ban lãnh đạo xem nhanh chậm / nhanh so với tiến độ tổng.
const ScheduleVarianceSection: React.FC<{ projectId: string; constructionSiteId: string | null }> = ({ projectId, constructionSiteId }) => {
  const [inputs, setInputs] = useState<ScheduleVarianceInputs | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'hidden'>('loading');
  useEffect(() => {
    let cancelled = false;
    setState('loading');
    loadScheduleVarianceInputs(projectId, constructionSiteId)
      .then(data => { if (!cancelled) { setInputs(data); setState(data.tasks.length ? 'ready' : 'hidden'); } })
      .catch(error => { console.warn('Schedule variance load failed', error); if (!cancelled) setState('hidden'); });
    return () => { cancelled = true; };
  }, [constructionSiteId, projectId]);
  const today = localToday();
  const view = useMemo(() => {
    if (!inputs) return null;
    const dataDate = varianceDataDate({ today, authoritative: inputs.authoritative, logs: inputs.logs });
    return {
      result: computeScheduleVariance(inputs.tasks, dataDate),
      manualLinks: inputs.tasks.reduce((count, task) => count + (task.dependencies || []).filter(dep => dep.type === 'FS').length, 0),
      issues: recentDailyLogIssues(inputs.logs),
    };
  }, [inputs, today]);
  if (state === 'loading') return <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Đang tính tiến độ tổng…</div>;
  if (state === 'hidden' || !view || !inputs) return null;
  return <ScheduleVariancePanel result={view.result} today={today} authoritative={inputs.authoritative} manualLinkCount={view.manualLinks} issues={view.issues} delayReasons={inputs.delayReasons} />;
};

const ExecutiveTab: React.FC<ExecutiveTabProps> = ({ constructionSiteId, projectId }) => (
  <div className="space-y-4">
    {projectId && <div className="max-w-[860px]"><ScheduleVarianceSection projectId={projectId} constructionSiteId={constructionSiteId || null} /></div>}
    <FastConsDashboard constructionSiteId={constructionSiteId} projectId={projectId} />
  </div>
);

export default ExecutiveTab;
