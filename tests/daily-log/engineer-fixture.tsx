// Interaction harness only: real components/services, mocked HTTP in Playwright.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { engineerBundle } from './engineer-bundle';
import { DailyLogContributionWorkEditor } from '../../components/project/daily-log/DailyLogContributionWorkEditor';
import { DailyLogEngineerWorkspace } from '../../components/project/daily-log/DailyLogEngineerWorkspace';
function Fixture() {
  const [area, setArea] = useState('A');
  const [saved, setSaved] = useState('');
  const blank = new URLSearchParams(location.search).has('blank');
  const submitted = new URLSearchParams(location.search).has('submitted');
  if(new URLSearchParams(location.search).has('workspace')) return <DailyLogEngineerWorkspace
    bundle={{...engineerBundle,contribution:null,myContributions:[engineerBundle.contribution!]}}
    projectId="project-1" constructionSiteId={null} date="2026-09-27" onDateChange={() => {}}
    onClose={() => {}} onSubmitted={() => {}} onUploadPhoto={async file => ({name:file.name,url:'/existing-photo.png'})} />;
  const contribution = { ...engineerBundle.contribution!, id: `source-${area}`, workAreaCode: area, workAreaName: `Khu ${area}`,
    status: submitted ? 'submitted' as const : 'returned' as const, returnReason: 'Bổ sung ảnh móng',
    sourceDraftPayload: { ...engineerBundle.contribution!.sourceDraftPayload!,
      items: blank ? [] : engineerBundle.contribution!.sourceDraftPayload!.items,
      content: area === 'A' ? 'Nội dung cũ' : 'Nội dung B' } };
  return <main style={{maxWidth:1280, margin:'auto'}}>
    <button onClick={() => setArea(area === 'A' ? 'B' : 'A')}>Đổi phiếu A/B</button>
    <p role="status">{saved}</p>
    <DailyLogContributionWorkEditor bundle={{ ...engineerBundle, contribution,
      workItems:[{id:'old-work',taskId:'task-1',contributionId:`source-${area}`,ownerType:'contribution',unit:'m³',plannedQuantity:100,
        cumulativeQuantityDone:30,dailyQuantityDone:30,cumulativeProgressPercent:30} as any] }} onClose={() => setSaved('Đóng')}
      onSaved={() => setSaved('Đã lưu')} onSubmitted={() => setSaved('Đã gửi')} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
