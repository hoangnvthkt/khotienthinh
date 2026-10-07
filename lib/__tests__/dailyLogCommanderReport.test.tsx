import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {DailyLogSummaryWorkspace} from '../../components/project/daily-log/DailyLogSummaryWorkspace';
import {summaryBundle} from '../../tests/daily-log/summary-bundle';
import {StaticRouter} from 'react-router-dom/server';
import type {DailyLogWbsBundle} from '../dailyLogWbsService';
const commandBundle={...summaryBundle,summaryLog:{...summaryBundle.summaryLog!,status:'submitted' as const},permissions:{...summaryBundle.permissions,canApprove:true,canPublishProgress:true}};
const render=(bundle:DailyLogWbsBundle=commandBundle)=>renderToStaticMarkup(<StaticRouter location="/"><DailyLogSummaryWorkspace bundle={bundle} mode="review" onReturnAll={()=>{}} onPublish={()=>{}} /></StaticRouter>);
// Ô tìm kiếm của Báo cáo ngày (chủ SP 07/10) không phải ô nhập liệu của phiếu.
const withoutSearch=(html:string)=>html.replace(/<input[^>]*aria-label="Tìm trong báo cáo ngày"[^>]*>/g,'');
describe('commander report and verified history',()=>{
  it('reads as a commander briefing before drilling into sources and audit',()=>{
    const html=render({...commandBundle,summaryLog:{...commandBundle.summaryLog,issues:'Lối vào bị cản',description:'Đã hoàn thành đổ móng'}});
    // v3 (05/10): cùng bố cục Báo cáo ngày — ô số → cần chú ý → bảng theo mũi → ghi chú → lịch sử.
    const order=['Nhân công','Cần chú ý','Theo mũi thi công','Sự cố chung','Nội dung tổng hợp dạng văn bản','Nguồn phiếu và lịch sử duyệt'];
    expect(order.map(label=>html.indexOf(label))).toEqual([...order.map(label=>html.indexOf(label))].sort((a,b)=>a-b));
    expect(order.every(label=>html.includes(label))).toBe(true);
    expect(html).toContain('Đã hoàn thành đổ móng');
    expect(html).toContain('Lối vào bị cản');
  });
  it('leads with active work fronts and shows a calm state when no action is pending',()=>{
    const ready={...commandBundle,summarySources:[commandBundle.summarySources[0]],workItems:[commandBundle.workItems[1]],
      contributionsForSummary:commandBundle.contributionsForSummary.map(source=>({...source,issues:''}))};
    const html=render(ready);
    expect(html).toContain('Theo mũi thi công');
    expect(html).toContain('Khu A');
    expect(html).not.toContain('Khu B');
  });
  it('includes recorded field issues in the report attention count',()=>{
    const html=render({...commandBundle,summaryLog:{...commandBundle.summaryLog,issues:'Lối đi bị chặn'}});
    expect(html).toContain('Cần chú ý');
    expect(html).toContain('Lối đi bị chặn');
  });
  it('shows each area’s engineer, physical quantities and resource hours without claiming a delay from missing dates',()=>{
    const html=render();
    expect(html).toContain('Kỹ sư A');
    expect(html).toMatch(/\+30<\/span> <span[^>]*>m²/);
    expect(html).toMatch(/56<\/span> giờ/);
    expect(html).toMatch(/máy · 12 giờ/);
    expect(html).not.toMatch(/Trễ \d+ ngày/);
  });
  it('keeps saved photos visible in the photo section and source metadata inside audit details',()=>{
    const photo={id:'report-photo',name:'Hiện trường hôm nay',url:'/today.png',fileType:'image' as const};
    const html=render({...commandBundle,summaryLog:{...commandBundle.summaryLog,photos:[photo]}});
    expect(html).toContain('Ảnh hiện trường');
    expect(html).toContain('Hiện trường hôm nay');
    expect(html).toMatch(/<details[^>]*>[\s\S]*Nguồn phiếu và lịch sử duyệt/);
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
    expect(html).toContain('Trễ 2 ngày');
    expect(html).toMatch(/trễ 2 ngày, dự kiến xong 03\/10 \(Khu A\)/);
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
    expect(html).toContain('Chưa xác định giờ công');
    expect(html).not.toMatch(/>\d+<\/span> giờ công/);
  });
  it('starts with a report header and separate summary-return action',()=>{
    const html=render();
    expect(html).toContain('Bản tổng hợp thi công ngày');expect(html).toContain('Trả bản tổng hợp');
    expect(html).not.toContain('Trả lại toàn bộ');expect(withoutSearch(html)).not.toMatch(/<(input|select)\b/);
    expect(html).toContain('Tiến độ chính thức không thay đổi');
  });
  it('offers exact source return with a mandatory reason, not the old review-comment command',()=>{
    const html=render();
    // Lý do bắt buộc nhập ở ô hiện ra sau khi bấm (nút gửi khóa khi trống) — xem DailyLogSummaryWorkspace.
    expect(html).toContain('Trả phiếu sửa');
    expect(withoutSearch(html)).not.toMatch(/<(input|textarea)\b/);
    expect(html).not.toContain('Yêu cầu sửa khu vực');
  });
  it('shows real verification metadata without deriving approval from updatedAt',()=>{
    const verified={...commandBundle,summaryLog:{...commandBundle.summaryLog,status:'verified' as const,verifiedBy:'CHT thật',verifiedAt:'2026-09-27T04:30:00Z'}};
    const html=render(verified);
    expect(html).toContain('CHT thật');expect(html).toContain('11:30');expect(html).toContain('27/09/2026');
    expect(withoutSearch(html)).not.toMatch(/<(input|select|textarea)\b/);expect(html).not.toContain('Trả phiếu sửa');expect(html).not.toContain('Trả bản tổng hợp');
    expect(html).not.toContain('Đối chiếu thử nghiệm');expect(html).not.toContain('Cần xử lý trước khi gửi');
  });
  it('keeps historical anomalies informative, not an instruction to rewrite confirmed history',()=>{
    const verified={...commandBundle,summaryLog:{...commandBundle.summaryLog,status:'verified' as const},summarySources:commandBundle.summarySources.map(source=>({...source,sourceState:'changed' as const})),workItems:commandBundle.workItems.map(item=>({...item,unit:null}))};
    const html=render(verified);
    expect(html).toContain('Chưa xác định người duyệt');expect(html).toContain('Chưa xác định thời điểm duyệt');
    expect(html).not.toContain('trước khi gửi');expect(html).not.toContain('Cập nhật từ phiếu');
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
    expect(html.match(/>Chưa xác định<\/span>/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('Thiếu số liệu đã lưu');
  });
  it('does not substitute a newer source submission time for a missing historical copy time',()=>{
    const html=render({...commandBundle,summaryLog:{...commandBundle.summaryLog,status:'verified'},
      contributionsForSummary:commandBundle.contributionsForSummary.map(source=>({...source,submittedAt:'2026-09-27T13:22:00Z'})),
      summarySources:commandBundle.summarySources.map(source=>({...source,sourceSnapshot:{}}))});
    expect(html).not.toContain('20:22');
    expect(html).toContain('Phiên bản phiếu 3 · Chưa xác định');
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
