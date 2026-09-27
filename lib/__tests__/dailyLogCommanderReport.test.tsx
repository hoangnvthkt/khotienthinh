import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {DailyLogSummaryWorkspace} from '../../components/project/daily-log/DailyLogSummaryWorkspace';
import {summaryBundle} from '../../tests/daily-log/summary-bundle';
import {StaticRouter} from 'react-router-dom/server';
import type {DailyLogWbsBundle} from '../dailyLogWbsService';
const commandBundle={...summaryBundle,summaryLog:{...summaryBundle.summaryLog!,status:'submitted' as const},permissions:{...summaryBundle.permissions,canApprove:true,canPublishProgress:true}};
const render=(bundle:DailyLogWbsBundle=commandBundle)=>renderToStaticMarkup(<StaticRouter location="/"><DailyLogSummaryWorkspace bundle={bundle} mode="review" onReturnAll={()=>{}} onPublish={()=>{}} /></StaticRouter>);
describe('commander report and verified history',()=>{
  it('starts with a report header and separate summary-return action',()=>{
    const html=render();
    expect(html).toContain('Bản tổng hợp thi công ngày');expect(html).toContain('Trả bản tổng hợp');
    expect(html).not.toContain('Trả lại toàn bộ');expect(html).not.toMatch(/<(input|select)\b/);
    expect(html).toContain('chưa công bố tiến độ chính thức');
  });
  it('offers exact source return with a mandatory reason, not the old review-comment command',()=>{
    const html=render();
    expect(html).toContain('Trả phiếu sửa');expect(html).toContain('Lý do trả phiếu');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Trả phiếu sửa/);
    expect(html).not.toContain('Yêu cầu sửa khu vực');
  });
  it('shows real verification metadata without deriving approval from updatedAt',()=>{
    const verified={...commandBundle,summaryLog:{...commandBundle.summaryLog,status:'verified' as const,verifiedBy:'CHT thật',verifiedAt:'2026-09-27T04:30:00Z'}};
    const html=render(verified);
    expect(html).toContain('CHT thật');expect(html).toContain('11:30');expect(html).toContain('27/09/2026');
    expect(html).not.toMatch(/<(input|select|textarea)\b/);expect(html).not.toContain('Trả phiếu sửa');expect(html).not.toContain('Trả bản tổng hợp');
    expect(html).not.toContain('Đối chiếu thử nghiệm');expect(html).not.toContain('Cần xử lý trước khi gửi');
  });
  it('keeps historical anomalies informative, not an instruction to rewrite confirmed history',()=>{
    const verified={...commandBundle,summaryLog:{...commandBundle.summaryLog,status:'verified' as const},summarySources:commandBundle.summarySources.map(source=>({...source,sourceState:'changed' as const})),workItems:commandBundle.workItems.map(item=>({...item,unit:null}))};
    const html=render(verified);
    expect(html).toContain('Chưa xác định người duyệt');expect(html).toContain('Chưa xác định thời điểm duyệt');
    expect(html).toContain('Chất lượng dữ liệu');expect(html).not.toContain('trước khi gửi');expect(html).not.toContain('Cập nhật từ phiếu');
    expect(html).not.toContain('Nhập giá trị chính thức');
  });
  it('keeps a reader free of return or publication actions',()=>{
    const html=render({...commandBundle,permissions:{...commandBundle.permissions,canApprove:false,canPublishProgress:false}});
    expect(html).not.toContain('Trả phiếu sửa');expect(html).not.toContain('Trả bản tổng hợp');expect(html).not.toContain('Đối chiếu thử nghiệm');
  });
  it('does not replace absent verified copies with live source work or guessed decisions',()=>{
    const html=render({...commandBundle,summaryLog:{...commandBundle.summaryLog,status:'verified' as any}});
    expect(html).not.toContain('Bê tông móng');expect(html).not.toContain('Nguồn móng A');
    expect(html).toContain('Chưa có hạng mục được lưu');
    expect(html).toMatch(/WBS duy nhất<\/dt><dd[^>]*>Chưa xác định/);
    expect(html).toMatch(/Giờ công<\/dt><dd[^>]*>Chưa xác định/);
    expect(html).toMatch(/Giờ máy<\/dt><dd[^>]*>Chưa xác định/);
    expect(html).toContain('Thiếu dữ liệu bản sao đã lưu');
    expect(html).toMatch(/Chất lượng dữ liệu<\/dt><dd[^>]*>2 ghi nhận/);
  });
  it('does not substitute a newer source submission time for a missing historical copy time',()=>{
    const html=render({...commandBundle,summaryLog:{...commandBundle.summaryLog,status:'verified'},
      contributionsForSummary:commandBundle.contributionsForSummary.map(source=>({...source,submittedAt:'2026-09-27T13:22:00Z'})),
      summarySources:commandBundle.summarySources.map(source=>({...source,sourceSnapshot:{}}))});
    expect(html).not.toContain('20:22');
    expect(html).toContain('Phiếu nguồn v3 · Chưa xác định');
  });
  it('labels a missing historical decision as missing data, never a new decision to make',()=>{
    const copy={...summaryBundle.workItems[0],id:'copy-A',sourceWorkItemId:'work-A-1',ownerType:'summary_source' as const,contributionId:null,dailyLogId:'summary-1',summarySourceId:'card-A',unit:null};
    const html=render({...commandBundle,summaryLog:{...commandBundle.summaryLog,status:'verified'},workItems:[...summaryBundle.workItems,copy]});
    expect(html).not.toContain('Cần quyết định');expect(html).toContain('Thiếu căn cứ đã lưu');
    expect(html).toContain('Chưa xác định căn cứ đã lưu');expect(html).not.toContain('Nhập %');
  });
  it('routes locked review to progress-period reopening, not publication',()=>{
    const html=render({...commandBundle,periodState:{isLocked:true} as any});
    expect(html).toContain('Kỳ tiến độ đang khóa');expect(html).toContain('Mở Chốt tiến độ');
    expect(html).not.toContain('Đối chiếu thử nghiệm');
  });
});
