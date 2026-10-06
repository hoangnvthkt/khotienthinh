import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newOfficeDraft, officeNumberParts } from '../office/officePresentation';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261009100000_office_manual_document_number.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('Office mã văn bản nhập tay', () => {
  it('tách mẫu sổ quanh ô số theo loại và năm', () => {
    expect(officeNumberParts('{sequence}/{year}/{code}-TT', 'TB', 2026)).toEqual({ prefix: '', suffix: '/2026/TB-TT' });
    expect(officeNumberParts('{code}-{sequence}/{year}', 'QĐ', 2027)).toEqual({ prefix: 'QĐ-', suffix: '/2027' });
  });

  it('bản nháp mới chưa chọn số', () => {
    expect(newOfficeDraft().proposed_sequence).toBeNull();
  });

  it('số người soạn chọn chỉ lưu nháp, chính thức tại Cấp số và báo trùng', () => {
    expect(sql).toContain("'effective_on','proposed_sequence']");
    expect(sql).toContain('set proposed_sequence=d.proposed_sequence');
    expect(sql).toMatch(/if d\.proposed_sequence is not null then[\s\S]+'office_number_taken'[\s\S]+d\.sequence_number:=d\.proposed_sequence/);
    // bộ đếm không lùi khi chọn số nhỏ hơn, để số tự động không trùng số đã chọn
    expect(sql).toContain('last_value=greatest(app_private.office_number_sequences.last_value,excluded.last_value)');
    // để trống vẫn cấp tự động như cũ
    expect(sql).toContain('last_value=app_private.office_number_sequences.last_value+1');
  });

  it('gợi ý số cần quyền Office và không lộ tiêu đề văn bản người hỏi không được xem', () => {
    expect(sql).toContain('create or replace function public.office_number_suggestion_v1');
    expect(sql).toContain('app_private.office_access(a)');
    expect(sql).toContain('app_private.office_can_view(taken.id, a)');
    expect(sql).toMatch(/revoke all on function public\.office_number_suggestion_v1\(uuid, integer, uuid\) from public, anon/);
  });
});
