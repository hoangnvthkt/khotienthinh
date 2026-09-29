import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyLogSummaryWorkspace, buildDailyLogSummaryDraft, adjustSummaryCardProgress } from '../../components/project/daily-log/DailyLogSummaryWorkspace';
import { DailyLogAreaCard } from '../../components/project/daily-log/DailyLogAreaCard';
import { summaryBundle } from '../../tests/daily-log/summary-bundle';

describe('source-slip-driven consolidation',()=>{
  it('uses only persisted selection on open, not every received source',()=>{
    expect(buildDailyLogSummaryDraft(summaryBundle).cards.map(card=>card.contribution.id)).toEqual(['source-A','source-B']);
  });
  it('honors explicit two-of-three selection without mutating the excluded source',()=>{
    const before=JSON.stringify(summaryBundle);
    const draft=(buildDailyLogSummaryDraft as any)(summaryBundle,['source-A','source-B']);
    expect(draft.cards.map((card:any)=>card.contribution.id)).toEqual(['source-A','source-B']);
    expect(draft.groups.map((group:any)=>group.aggregate.taskId)).toEqual(['task-1','task-2']);
    expect(JSON.stringify(summaryBundle)).toBe(before);
  });
  it('totals unique WBS and physical hours without claiming unique headcount or report completeness',()=>{
    const html=renderToStaticMarkup(<DailyLogSummaryWorkspace bundle={summaryBundle} mode="summarize" />);
    expect(html).toContain('Hạng mục</dt>'); expect(html).toContain('Giờ công'); expect(html).toContain('56'); expect(html).toContain('Giờ máy');expect(html).toContain('12');
    expect(html).toContain('lượt người');expect(html).not.toContain('106 người');expect(html).not.toMatch(/đủ kỹ sư|đủ phiếu/i);
  });
  it('allows an unresolved safe draft to save, but never submit or silently add two 30 percents',()=>{
    const draft=buildDailyLogSummaryDraft(summaryBundle);
    expect(draft.decisions['task-1'].officialCumulativePercent).toBeNull();
    const html=renderToStaticMarkup(<DailyLogSummaryWorkspace bundle={summaryBundle} mode="summarize" />);
    const save=html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(button=>button.includes('Lưu tổng hợp'));
    expect(save).toBeDefined();expect(save).not.toContain('disabled=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Gửi CHT/);
  });
  it('keeps saved review comments distinct from source matching and opens the blocked card',()=>{
    const draft=buildDailyLogSummaryDraft({...summaryBundle,summarySources:summaryBundle.summarySources.map((s,i)=>i===0?{...s,reviewStatus:'change_requested',reviewComment:'Bổ sung ảnh móng đã yêu cầu'}:s)});
    const html=renderToStaticMarkup(<DailyLogAreaCard card={draft.cards[0]} mode="summarize" />);
    expect(html).toContain('Bổ sung ảnh móng đã yêu cầu');expect(html).not.toContain('Khớp phiếu kỹ sư đã gửi');expect(html).toMatch(/<details[^>]*open=""/);
  });
  it('collapses a current card and keeps resources and photographs under the matching work item',()=>{
    const card=buildDailyLogSummaryDraft(summaryBundle).cards[0];
    const html=renderToStaticMarkup(<DailyLogAreaCard card={card} mode="summarize" />);
    expect(html).not.toMatch(/<details[^>]*open=""/);
    expect(html).toContain('Ảnh móng A');expect(html).toContain('Ghi chú móng A');expect(html).toContain('Lối vào hẹp');
    // A resource moved to another WBS must fail this item-level association.
    expect(html).toMatch(/data-work-item-id="work-A-1"[\s\S]*?Nguồn móng A[\s\S]*?data-work-item-id="work-A-2"[\s\S]*?Nguồn tường A/);
  });
  it('retains an adjusted snapshot when a newer source arrives, including an intentionally empty resource copy',()=>{
    const bundle={...summaryBundle,contributionsForSummary:summaryBundle.contributionsForSummary.map((s,i)=>i===0?{...s,rowVersion:6,sourceFingerprint:'new-fp'}:s),
      summarySources:summaryBundle.summarySources.map((s,i)=>i===0?{...s,hasAdjustments:true,adjustmentReason:'Đã kiểm tra'}:s),
      workItems:[...summaryBundle.workItems,{...summaryBundle.workItems[0],id:'copy-A-1',contributionId:null,dailyLogId:'summary-1',summarySourceId:'card-A',sourceWorkItemId:'work-A-1',ownerType:'summary_source' as const,cumulativeProgressPercent:35}]};
    const card=buildDailyLogSummaryDraft(bundle).cards[0];
    expect(card.editedItems[0].cumulativeProgressPercent).toBe(35);expect(card.resources).toEqual([]);
    expect(card.source.sourceVersion).toBe(3);expect(card.source.sourceFingerprint).toBe('fp-A');expect(card.source.sourceState).toBe('changed');
  });
  it('adjusts only the chosen copy and derives qualified quantities without inventing a baseline',()=>{
    const cards=buildDailyLogSummaryDraft(summaryBundle).cards;
    const before=JSON.stringify(cards);
    const changed=adjustSummaryCardProgress(cards[0],'work-A-2',30,'Đã đo lại tường');
    expect(changed.editedItems[1]).toMatchObject({cumulativeProgressPercent:30,cumulativeQuantityDone:60,dailyQuantityDone:40});
    expect(changed.editedItems[0]).toEqual(cards[0].editedItems[0]);
    expect(changed.source.adjustmentReason).toBe('Đã đo lại tường');
    expect(JSON.stringify(cards)).toBe(before);
    expect(adjustSummaryCardProgress(cards[0],'work-A-1',35,'Đã đo lại móng').editedItems[0]).toMatchObject({cumulativeQuantityDone:null,dailyQuantityDone:null});
    expect(()=>adjustSummaryCardProgress(cards[0],'work-A-2',30,'')).toThrow(/lý do/i);
    expect(adjustSummaryCardProgress(cards[0],'work-A-2',Number.NaN,'Đang nhập').editedItems[1]).toMatchObject({cumulativeQuantityDone:null,dailyQuantityDone:null});
  });
  it('requires an explicit decision for duplicate areas or mixed units instead of summing them',()=>{
    for (const patch of [{workAreaCode:'A',areaPlannedQuantity:100},{unit:'m²',areaPlannedQuantity:100}]) {
      const draft=buildDailyLogSummaryDraft({...summaryBundle,workItems:summaryBundle.workItems.map(item=>item.taskId==='task-1'?{...item,areaPlannedQuantity:100,...(item.contributionId==='source-B'?patch:{})}:item)});
      expect(draft.decisions['task-1'].officialCumulativePercent).toBeNull();
      expect(draft.decisions['task-1'].officialCumulativeQuantity).toBeNull();
    }
  });
  it('invalidates a saved decision when selection changes its source work items',()=>{
    const loaded={...summaryBundle,decisions:[{dailyLogId:'summary-1',taskId:'task-1',officialCumulativePercent:30,aggregationMethod:'manual_override' as const,dailyQuantityMethod:'manual_override' as const,resolutionReason:'Cả hai khu vực',includedSourceWorkItemIds:['work-A-1','work-B-1'],sourceFingerprint:''}]};
    expect(buildDailyLogSummaryDraft(loaded,['source-A']).decisions['task-1'].aggregationMethod).toBe('single_source');
    expect(buildDailyLogSummaryDraft(loaded,['source-A']).decisions['task-1'].resolutionReason).toBeUndefined();
  });
  it('shows a resolved result neutrally with collapsed reasoning, and report mode without disabled forms',()=>{
    const resolved={...summaryBundle,decisions:[{dailyLogId:'summary-1',taskId:'task-1',officialCumulativePercent:30,aggregationMethod:'manual_override' as const,dailyQuantityMethod:'manual_override' as const,resolutionReason:'Chốt phạm vi móng',includedSourceWorkItemIds:['work-A-1','work-B-1'],sourceFingerprint:''}]};
    const html=renderToStaticMarkup(<DailyLogSummaryWorkspace bundle={resolved} mode="review" />);
    expect(html).not.toMatch(/<(input|select|textarea)\b/);
    expect(html).toContain('30 %');expect(html).toContain('Chốt phạm vi móng');expect(html).toContain('Đã chốt số liệu');
    expect(html).not.toMatch(/<details[^>]*open=""/);
  });
  it('explains why a slip cannot be returned while local edits are unsaved',()=>{
    const html=renderToStaticMarkup(<DailyLogAreaCard card={buildDailyLogSummaryDraft(summaryBundle).cards[0]} mode="summarize" canRequestChange onRequestChange={()=>{}} returnDisabledReason="Lưu tổng hợp trước khi trả phiếu để giữ chỉnh sửa." />);
    expect(html).toContain('Lưu tổng hợp trước khi trả phiếu để giữ chỉnh sửa.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Trả phiếu cho kỹ sư/);
  });
  it('does not label an already addressed review comment as a current request to fix',()=>{
    const card=buildDailyLogSummaryDraft(summaryBundle).cards[0];
    const html=renderToStaticMarkup(<DailyLogAreaCard card={{...card,source:{...card.source,reviewStatus:'ready',reviewComment:'Bổ sung ảnh đã cập nhật'}}} mode="summarize" />);
    expect(html).toContain('Nhận xét trước đó');expect(html).toContain('Bổ sung ảnh đã cập nhật');
    expect(html).not.toContain('Cần sửa theo nhận xét');
  });
  it('rejects unsafe numeric decisions for draft save without substituting zero',()=>{
    const html=renderToStaticMarkup(<DailyLogSummaryWorkspace bundle={{...summaryBundle,decisions:[{dailyLogId:'summary-1',taskId:'task-1',officialCumulativePercent:30,officialDailyQuantity:-1,aggregationMethod:'manual_override',dailyQuantityMethod:'manual_override',resolutionReason:'Đã chốt',includedSourceWorkItemIds:['work-A-1','work-B-1'],sourceFingerprint:''}]}} mode="summarize" />);
    const save=html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(button=>button.includes('Lưu tổng hợp'));
    expect(save).toContain('disabled=""');
  });
  it('keeps send disabled with a clear reason when the parent workflow is not ready',()=>{
    const bundle={...summaryBundle,decisions:[{dailyLogId:'summary-1',taskId:'task-1',officialCumulativePercent:30,aggregationMethod:'manual_override' as const,dailyQuantityMethod:'manual_override' as const,resolutionReason:'Chốt phạm vi',includedSourceWorkItemIds:['work-A-1','work-B-1'],sourceFingerprint:''}]};
    const html=renderToStaticMarkup(<DailyLogSummaryWorkspace bundle={bundle} mode="summarize" canSendSummary={false} sendDisabledReason="Chọn CHT duyệt trước khi gửi." />);
    const send=html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(button=>button.includes('Gửi CHT'));
    expect(send).toContain('disabled=""');expect(html).toContain('Chọn CHT duyệt trước khi gửi.');
  });
  it('keeps partial missing units unresolved even when area quantities add up to the whole plan',()=>{
    const bundle={...summaryBundle,workItems:summaryBundle.workItems.map(item=>item.taskId==='task-1'?{...item,areaPlannedQuantity:50,plannedQuantity:100,unit:item.contributionId==='source-B'?null:'m³'}:item)};
    expect(buildDailyLogSummaryDraft(bundle).decisions['task-1'].officialCumulativePercent).toBeNull();
  });
  it('shows real notes from the resubmitted source inside the comparison without replacing copied notes',()=>{
    const card=buildDailyLogSummaryDraft(summaryBundle).cards[0];
    const changed={...card,contribution:{...card.contribution,rowVersion:6,content:'Nội dung gửi lại để so sánh',issues:'Vướng mắc đã cập nhật'},source:{...card.source,sourceState:'changed' as const,sourceSnapshot:{content:'Nội dung bản sao đang giữ',issues:'Vướng mắc bản sao',photos:[]}}};
    const html=renderToStaticMarkup(<DailyLogAreaCard card={changed} mode="summarize" />);
    expect(html).toContain('Nội dung bản sao đang giữ');expect(html).toContain('Nội dung gửi lại để so sánh');expect(html).toContain('Vướng mắc đã cập nhật');
  });
});
