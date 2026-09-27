// Literal multi-WBS fixture: expectations in tests are hand-derived.
import type { DailyLogWbsBundle } from '../../lib/dailyLogWbsService';
export const summaryBundle: DailyLogWbsBundle = {
  rollout:{mode:'pilot',enabled:true,cutoverDate:'2026-09-23'}, tasks:[],workBoqItems:[],resourceProviders:[],previousProgressRows:[],nextProgressRows:[],contribution:null,
  contributionsForSummary:['A','B','C'].map(area=>({id:`source-${area}`,projectId:'project-1',constructionSiteId:null,date:'2026-09-27',authorUserId:`user-${area}`,authorName:`Kỹ sư ${area}`,
    workAreaCode:area,workAreaName:`Khu ${area}`,content:`Nội dung ${area}`,issues:area==='A'?'Lối vào hẹp':'',status:'submitted',rowVersion:3,sourceFingerprint:`fp-${area}`,createdAt:'2026-09-27T00:00:00Z',submittedAt:'2026-09-27T02:00:00Z'})),
  summaryLog:{id:'summary-1',projectId:'project-1',date:'2026-09-27',weather:'sunny',workerCount:0,description:'Tổng hợp',status:'draft',summarySourceType:'member_contributions',createdBy:'Người tổng hợp',createdAt:'2026-09-27T03:00:00Z',lastActionAt:'2026-09-27T03:00:00Z'},
  summarySources:['A','B'].map(area=>({id:`card-${area}`,dailyLogId:'summary-1',contributionId:`source-${area}`,sourceVersion:3,sourceFingerprint:`fp-${area}`,sourceState:'current',reviewStatus:'ready',workAreaName:`Khu ${area}`,sourceUserName:`Kỹ sư ${area}`})),
  workItems:[
    {id:'work-A-1',ownerType:'contribution',contributionId:'source-A',taskId:'task-1',wbsCode:'1.1',taskName:'Bê tông móng',workAreaCode:'A',workAreaName:'Khu A',unit:'m³',plannedQuantity:100,areaPlannedQuantity:null,baselineProgressPercent:10,baselineQuantityDone:null,cumulativeProgressPercent:30,cumulativeQuantityDone:null,dailyQuantityDone:null,note:'Ghi chú móng A',attachments:[{id:'photo-A-1',name:'Ảnh móng A',url:'/photo-A.png',fileType:'image'}]},
    {id:'work-A-2',ownerType:'contribution',contributionId:'source-A',taskId:'task-2',wbsCode:'1.2',taskName:'Xây tường',workAreaCode:'A',workAreaName:'Khu A',unit:'m²',plannedQuantity:200,areaPlannedQuantity:200,baselineProgressPercent:10,baselineQuantityDone:20,cumulativeProgressPercent:25,cumulativeQuantityDone:50,dailyQuantityDone:30},
    {id:'work-B-1',ownerType:'contribution',contributionId:'source-B',taskId:'task-1',wbsCode:'1.1',taskName:'Bê tông móng',workAreaCode:'B',workAreaName:'Khu B',unit:'m³',plannedQuantity:100,areaPlannedQuantity:null,baselineProgressPercent:10,baselineQuantityDone:null,cumulativeProgressPercent:30,cumulativeQuantityDone:null,dailyQuantityDone:null},
    {id:'work-C-1',ownerType:'contribution',contributionId:'source-C',taskId:'task-3',wbsCode:'1.3',taskName:'Công việc C',workAreaCode:'C',workAreaName:'Khu C',baselineProgressPercent:0,cumulativeProgressPercent:10},
  ],decisions:[],
  labor:[
    {id:'labor-A-1',contributionId:'source-A',dailyLogWorkItemId:'work-A-1',laborType:'Tổ móng A',peopleCount:5,hoursPerPerson:8,totalLaborHours:40,providerEntryMode:'manual',manualProviderType:'free_crew',manualProviderName:'Nguồn móng A'},
    {id:'labor-A-2',contributionId:'source-A',dailyLogWorkItemId:'work-A-2',laborType:'Tổ tường A',peopleCount:2,hoursPerPerson:8,totalLaborHours:16,providerEntryMode:'manual',manualProviderType:'day_labor',manualProviderName:'Nguồn tường A'},
    {id:'labor-C-1',contributionId:'source-C',dailyLogWorkItemId:'work-C-1',laborType:'Không chọn C',peopleCount:99,hoursPerPerson:8,totalLaborHours:792,providerEntryMode:'manual',manualProviderType:'free_crew',manualProviderName:'Nguồn C'},
  ] as any,
  machines:[{id:'machine-B-1',contributionId:'source-B',dailyLogWorkItemId:'work-B-1',machineType:'Máy trộn B',machineCount:2,hoursPerMachine:6,totalMachineHours:12,providerEntryMode:'manual',manualProviderType:'machine_owner',manualProviderName:'Chủ máy B'}] as any,
  periodState:null,permissions:{canEditSource:false,canSummarize:true,canApprove:false,canPublishProgress:false},
};
