// Tab "Tiến độ thực tế" (trước là Chốt tiến độ). Dự án đã dùng Nhật ký chính thức → màn chỉ xem số từ nhật ký;
// dự án chưa bật vẫn nhập tay theo tuần ở màn cũ (chủ SP chốt 15/10/2026).
import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import ActualProgressView from '../../components/project/progress/ActualProgressView';
import { StateBox } from '../../components/procurement/hub/hubUi';
import { projectWeeklyProgressService } from '../../lib/projectWeeklyProgressService';
import WeeklyProgressTab from './WeeklyProgressTab';

interface Props {
  projectId: string;
  constructionSiteId?: string;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function ActualProgressTab({ projectId, constructionSiteId }: Props) {
  const [mode, setMode] = useState<'loading' | 'daily_log' | 'manual'>('loading');
  const [showLegacy, setShowLegacy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMode('loading'); setShowLegacy(false);
    projectWeeklyProgressService.getDailyProgressAuthority({ projectId, constructionSiteId: constructionSiteId || null, progressDate: todayIso() })
      .then(authority => { if (!cancelled) setMode(authority?.authoritative === true ? 'daily_log' : 'manual'); })
      .catch(() => { if (!cancelled) setMode('manual'); });
    return () => { cancelled = true; };
  }, [constructionSiteId, projectId]);

  if (mode === 'loading') return <StateBox kind="loading" />;
  if (mode === 'manual') return <WeeklyProgressTab projectId={projectId} constructionSiteId={constructionSiteId} />;
  if (showLegacy) return <div className="space-y-3">
    <button type="button" onClick={() => setShowLegacy(false)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 hover:underline dark:text-teal-300">
      <ArrowLeft size={15} />Về Tiến độ thực tế</button>
    <WeeklyProgressTab projectId={projectId} constructionSiteId={constructionSiteId} />
  </div>;
  return <ActualProgressView projectId={projectId} constructionSiteId={constructionSiteId || null} onShowLegacy={() => setShowLegacy(true)} />;
}
