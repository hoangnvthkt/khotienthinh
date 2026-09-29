import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../supabase',()=>({supabase:{rpc:mocks.rpc}}));
import { dailyLogWbsService } from '../dailyLogWbsService';

describe('Scoped source return and resubmit commands',()=>{
  beforeEach(()=>mocks.rpc.mockReset());
  it('returns exactly the selected source with summary/source versions and a stable command ID',async()=>{
    const input={commandId:'return-command',dailyLogId:'summary',summarySourceId:'card-a',contributionId:'source-a',
      expectedSummaryUpdatedAt:'2026-09-26T00:00:00Z',expectedRowVersion:3,reason:'Bổ sung khối lượng'};
    mocks.rpc.mockResolvedValue({data:{contribution_id:'source-a',status:'returned',row_version:4,source_fingerprint:'original-physical',
      updated_at:'2026-09-26T01:00:00Z',daily_log_id:'summary',summary_updated_at:'2026-09-26T01:00:00Z'},error:null});
    expect(await dailyLogWbsService.returnSource(input)).toMatchObject({contributionId:'source-a',status:'returned',rowVersion:4,
      sourceFingerprint:'original-physical',dailyLogId:'summary',summaryUpdatedAt:'2026-09-26T01:00:00Z'});
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('return_daily_log_source_v2',{p_input:input});
  });
  it('uses one server-owned initial-submit/resubmit command and returns the server version',async()=>{
    const input={commandId:'submit-command',contributionId:'source-a',expectedRowVersion:5};
    mocks.rpc.mockResolvedValue({data:{contribution_id:'source-a',status:'submitted',row_version:6,
      updated_at:'2026-09-26T02:00:00Z',source_fingerprint:'corrected-physical'},error:null});
    expect(await dailyLogWbsService.submitSource(input)).toEqual({contributionId:'source-a',status:'submitted',rowVersion:6,
      updatedAt:'2026-09-26T02:00:00Z',sourceFingerprint:'corrected-physical'});
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('submit_daily_log_source_v2',{p_input:input});
  });
  it.each([
    ['DAILY_LOG_SOURCE_RETURN_REASON_REQUIRED','lý do'],
    ['DAILY_LOG_SOURCE_RETURN_DENIED','quyền'],
    ['DAILY_LOG_SOURCE_RELATION_MISMATCH','bản tổng hợp'],
    ['SUMMARY_UPDATED_AT_CONFLICT','tải lại'],
  ])('makes return failure %s actionable without claiming the source was returned',async(code,hint)=>{
    mocks.rpc.mockResolvedValue({data:null,error:{message:code,code:'PT409'}});
    await expect(dailyLogWbsService.returnSource({commandId:'cmd',dailyLogId:'summary',summarySourceId:'card-a',contributionId:'source-a',
      expectedSummaryUpdatedAt:'2026-09-26T00:00:00Z',expectedRowVersion:3,reason:'Sửa khối lượng'}))
      .rejects.toMatchObject({code,message:expect.stringContaining(hint)});
  });
  it.each([
    ['DAILY_LOG_SOURCE_NOT_COMPLETE','hoàn thiện'],
    ['DAILY_LOG_SOURCE_SUBMIT_DENIED','quyền'],
    ['VERIFIED_SOURCE_IMMUTABLE','điều chỉnh'],
    ['SOURCE_CHANGED','thay đổi'],
  ])('surfaces submit failure %s without bypassing server completeness or ownership',async(code,hint)=>{
    mocks.rpc.mockResolvedValue({data:null,error:{message:code}});
    await expect(dailyLogWbsService.submitSource({commandId:'cmd',contributionId:'source-a',expectedRowVersion:5}))
      .rejects.toMatchObject({code,message:expect.stringContaining(hint)});
  });
});
