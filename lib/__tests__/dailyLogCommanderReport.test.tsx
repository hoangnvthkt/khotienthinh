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
  it('reads as a commander briefing before drilling into sources and audit',()=>{
    const html=render({...commandBundle,summaryLog:{...commandBundle.summaryLog,issues:'Lối vào bị cản',description:'Đã hoàn thành đổ móng'}});
    const order=['Tổng quan ngày','Kết quả tổng hợp theo WBS','Cảnh báo và vướng mắc','Các mũi thi công','Ảnh hiện trường','Nguồn và lịch sử duyệt'];
    expect(order.map(label=>html.indexOf(label))).toEqual([...order.map(label=>html.indexOf(label))].sort((a,b)=>a-b));
    expect(order.every(label=>html.includes(label))).toBe(true);
    expect(html).toContain('Đã hoàn thành đổ móng');
    expect(html).toContain('Lối vào bị cản');
  });
  it('leads with active work fronts and shows a calm state when no action is pending',()=>{
    const ready={...commandBundle,summarySources:[commandBundle.summarySources[0]],workItems:[commandBundle.workItems[1]],
      contributionsForSummary:commandBundle.contributionsForSummary.map(source=>({...source,issues:''}))};
    const html=render(ready);
    expect(html).toContain('Mũi thi công</dt><dd');
    expect(html).toContain('1</dd><dd class="text-xs text-muted-foreground">1 / 3 phiếu được tổng hợp');
    expect(html).toContain('dl-metric-calm');
  });
  it('includes recorded field issues in the report attention count',()=>{
    const html=render({...commandBundle,summaryLog:{...commandBundle.summaryLog,issues:'Lối đi bị chặn'}});
    expect(html).toContain('Cần chú ý</dt><dd');
    expect(html).toContain('3 điểm');
  });
  it('shows each area’s engineer, physical quantities and resource hours without claiming a delay from missing dates',()=>{
    const html=render();
    expect(html).toContain('Kỹ sư A');
    expect(html).toContain('30 m²');
    expect(html).toContain('56 giờ công');
    expect(html).toContain('12 giờ máy');
    expect(html).toContain('Chưa đủ căn cứ đánh giá tiến độ mũi');
    expect(html).not.toContain('Mũi thi công chậm');
  });
  it('keeps saved photos visible in the photo section and source metadata inside audit details',()=>{
    const photo={id:'report-photo',name:'Hiện trường hôm nay',url:'/today.png',fileType:'image' as const};
    const html=render({...commandBundle,summaryLog:{...commandBundle.summaryLog,photos:[photo]}});
    expect(html).toContain('Ảnh hiện trường');
    expect(html).toContain('Hiện trường hôm nay');
    expect(html).toMatch(/<details[^>]*>[\s\S]*Nguồn và lịch sử duyệt/);
  });
  it('keeps non-image work attachments in drill-down but out of the photo gallery',()=>{
    const workItems=commandBundle.workItems.map(item=>item.id==='work-A-1'?{...item,attachments:[...(item.attachments || []),{name:'Biên bản PDF',url:'/minutes.pdf',fileType:'pdf'}]}:item);
    const html=render({...commandBundle,workItems});
    expect(html).toContain('Biên bản PDF');
    expect(html).not.toContain('<img src="/minutes.pdf"');
  });
  it('flags a dated forecast only when a saved area item finishes after its plan',()=>{
    const workItems=commandBundle.workItems.map(item=>item.id==='work-A-2'?{...item,scheduleFinishDate:'2026-10-01',forecastFinishDate:'2026-10-03'}:item);
    const html=render({...commandBundle,workItems});
    expect(html).toContain('Có hạng mục dự kiến trễ theo ngày kế hoạch');
    expect(html).toContain('Khu A: có hạng mục dự kiến hoàn thành sau ngày kế hoạch');
  });
  it('does not substitute live source issues or photos into verified history',()=>{
    const html=render({...commandBundle,summaryLog:{...commandBundle.summaryLog,status:'verified'},
      contributionsForSummary:commandBundle.contributionsForSummary.map(source=>({...source,issues:'Sự cố mới',photos:[{name:'Ảnh mới',url:'/new.png'}]}))});
    expect(html).not.toContain('Sự cố mới');
    expect(html).not.toContain('Ảnh mới');
    expect(html).not.toContain('/new.png');
  });
  it('keeps partially unknown area hours unknown rather than treating the missing line as zero',()=>{
    const labor=commandBundle.labor.map(line=>line.laborType==='Tổ tường A'?{...line,totalLaborHours:null}:line);
    const html=render({...commandBundle,labor});
    const areaA=html.split('data-testid="daily-log-area-card"')[1].split('data-testid="daily-log-area-card"')[0];
    expect(areaA).toContain('Giờ công</dt><dd>Chưa xác định');
  });
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
