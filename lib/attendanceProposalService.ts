import { AttendanceRecord, AttendanceProposal } from '../types';
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';

export type AttendanceProposalDecision = 'approved' | 'rejected';

export interface ReviewAttendanceProposalResult {
  proposal: AttendanceProposal;
  attendance: AttendanceRecord | null;
}

type ReviewAttendanceProposalPayload = {
  p_proposal_id: string;
  p_decision: AttendanceProposalDecision;
  p_rejection_reason: string | null;
};

const assertJsonSafe = (payload: ReviewAttendanceProposalPayload): string => {
  if (!payload.p_proposal_id) throw new Error('Thiếu proposal_id.');
  if (!payload.p_decision) throw new Error('Thiếu quyết định duyệt đề xuất.');
  const body = JSON.stringify(payload);
  if (!body || body === '{}' || body === 'null') throw new Error('Payload duyệt đề xuất rỗng.');
  console.info('[review_attendance_proposal_v1] payload', payload);
  console.info('[review_attendance_proposal_v1] JSON.stringify(payload)', body);
  return body;
};

export const attendanceProposalService = {
  async review(
    proposalId: string,
    decision: AttendanceProposalDecision,
    rejectionReason?: string,
  ): Promise<ReviewAttendanceProposalResult> {
    if (!supabaseUrl || !supabaseAnonKey) throw new Error('Chưa cấu hình Supabase URL/Anon Key.');

    const body = assertJsonSafe({
      p_proposal_id: proposalId,
      p_decision: decision,
      p_rejection_reason: rejectionReason?.trim() || null,
    });

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error('Phiên đăng nhập Supabase không hợp lệ.');

    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/review_attendance_proposal_v1`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    });

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`Supabase trả về phản hồi không phải JSON (${response.status}): ${text.slice(0, 180)}`);
      }
    }

    if (!response.ok) throw parsed || new Error(`Supabase RPC lỗi ${response.status}`);
    if (!parsed || typeof parsed !== 'object') throw new Error('Supabase không trả về kết quả duyệt hợp lệ.');

    return parsed as ReviewAttendanceProposalResult;
  },
};
