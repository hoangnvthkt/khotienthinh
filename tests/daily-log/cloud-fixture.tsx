// Acceptance harness: production components/services, real authenticated Cloud.
// Only navigation/scope setup replaces the full ERP shell. No mocked RPCs.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '../../index.css';
import { supabase } from '../../lib/supabase';
import { dailyLogWbsService, getDailyLogPublicationOutcome, type DailyLogWbsBundle } from '../../lib/dailyLogWbsService';
import { DailyLogContributionWorkEditor } from '../../components/project/daily-log/DailyLogContributionWorkEditor';
import { DailyLogSummaryWorkspace } from '../../components/project/daily-log/DailyLogSummaryWorkspace';
import { DailyProgressCutoverFields } from '../../pages/project/WeeklyProgressTab';

const params=new URLSearchParams(location.search);
const date=params.get('date')!;
const screen=params.get('screen')||'source';
const projectId='DL-WBS-PILOT-20260925';
const summaryId=`DL-WBS-E2E-${date}`;
const approverId='72000000-0000-4000-8000-000000000004';
const fromDb=(row:any)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase()),value]));

function Fixture() {
  const [bundle,setBundle]=useState<DailyLogWbsBundle|null>(null);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [progress,setProgress]=useState<any[]>([]);
  const [version,setVersion]=useState(0);
  async function load() {
    try {
      setBundle(await dailyLogWbsService.getBundle({projectId,constructionSiteId:null,logDate:date,dailyLogId:screen==='source'?null:summaryId}));
      if(screen==='progress') {
        const r=await supabase.from('project_daily_task_progress').select('*').eq('project_id',projectId).eq('progress_date',date);
        if(r.error) throw r.error;
        setProgress((r.data||[]).map(fromDb));
      }
      setVersion(v=>v+1);
    } catch(e:any) { setError(e.message); }
  }
  useEffect(()=>{void load();},[]);
  async function ensureContribution() {
    const actor=await supabase.rpc('current_app_user_id');
    if(actor.error) throw actor.error;
    const r=await supabase.from('daily_log_contributions').insert({id:crypto.randomUUID(),project_id:projectId,date,
      author_user_id:actor.data,author_name:params.get('persona'),status:'draft',content:'Dữ liệu kiểm thử trình duyệt'}).select().single();
    if(r.error) throw r.error;
    return fromDb(r.data) as any;
  }
  async function ensureSummary() {
    if(bundle?.summaryLog) return bundle.summaryLog;
    const actor=await supabase.rpc('current_app_user_id');
    const r=await supabase.from('daily_logs').insert({id:summaryId,project_id:projectId,date,status:'draft',
      created_by:'Người tổng hợp',created_by_id:actor.data,description:'Tổng hợp hai khu vực — Cloud E2E',
      summary_source_type:'member_contributions',photo_required:false}).select().single();
    if(r.error) throw r.error;
    return fromDb(r.data) as any;
  }
  return <main className="mx-auto max-w-6xl space-y-4 p-4 md:p-8">
    <header><p className="text-xs font-bold uppercase tracking-wide text-teal-700">Nhật ký công trường · dự án kiểm thử</p><h1 className="mt-2 text-xl font-bold">Ngày {date} · {params.get('persona')}</h1></header>
    {error&&<div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</div>}
    {message&&<p role="status" className="rounded-xl bg-teal-50 p-4 text-teal-900">{message}</p>}
    {!bundle&&!error&&<p>Đang tải…</p>}
    {bundle&&screen==='source'&&<DailyLogContributionWorkEditor key={version} bundle={bundle}
      ensureContribution={ensureContribution} onSubmitted={()=>{setMessage('Đã gửi tổng hợp');void load();}} />}
    {bundle&&screen==='summary'&&<DailyLogSummaryWorkspace key={version} bundle={bundle} mode="summarize"
      ensureSummaryLog={ensureSummary} onSubmit={async receipt=>{
        await dailyLogWbsService.submitSummary({dailyLogId:summaryId,expectedUpdatedAt:receipt.updatedAt,approverUserId:approverId});
        setMessage('Đã gửi CHT');await load();
      }} />}
    {bundle&&screen==='review'&&<DailyLogSummaryWorkspace key={version} bundle={bundle} mode="review" onPublish={async()=>{
      const log=bundle.summaryLog!;
      const receipt=await dailyLogWbsService.publishSummary({dailyLogId:summaryId,expectedUpdatedAt:log.lastActionAt||log.createdAt,commandId:crypto.randomUUID()});
      setMessage(getDailyLogPublicationOutcome(receipt).message);await load();
    }} />}
    {bundle&&screen==='progress'&&<><p>{progress.length} dòng tiến độ chính thức</p>{progress.map(row=><DailyProgressCutoverFields key={row.id}
      authoritative row={row} progressPercent={String(row.progressPercent)} quantityDone={String(row.quantityDone??'')} note={row.note||''}
      unit="m³" dailyLogHref={`/da?tab=dailylog&dailyLogId=${row.sourceDailyLogId}`} onChange={()=>undefined} />)}
      <DailyLogSummaryWorkspace bundle={bundle} mode="review" />
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<HashRouter><Fixture /></HashRouter>);
