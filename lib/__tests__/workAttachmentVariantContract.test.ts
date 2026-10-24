import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 24/10/2026 — Đính kèm Vioo Work hỏng từ PR #311: bộ xử lý thôi tạo fallback.png (vượt CPU 2 s của
// Edge Function) nhưng app_private.work_finish_attachment vẫn bắt ảnh phải có đủ thumbnail + display
// + fallback → WORK_INVALID_VARIANTS (400) → Edge Function 500 → tệp kẹt 'processing' → màn báo
// "Tệp đang được xử lý. Vui lòng thử lại sau ít phút." (Untitled.png, hai lần, đều 'rejected').
const fix = readFileSync('supabase/migrations/20261031130000_work_attachment_no_fallback_variant.sql', 'utf8');
const origin = readFileSync('supabase/migrations/20260907041036_work_r1a_private_attachments.sql', 'utf8');
const processor = readFileSync('supabase/functions/work-attachments/processor.ts', 'utf8');
const client = readFileSync('lib/work/workAttachmentService.ts', 'utf8');

describe('Biến thể ảnh đính kèm Vioo Work', () => {
  it('bộ xử lý chỉ ghi display + thumbnail, không còn fallback.png', () => {
    expect(processor).toContain('No fallback.png');
    expect(processor).toContain("outputs.push({ name: 'display.webp'");
    expect(processor).toContain("outputs.push({ name: 'thumbnail.webp'");
    expect(processor).not.toMatch(/name: 'fallback\.png'/);
  });
  it('máy chủ không còn bắt ảnh phải có fallback', () => {
    expect(origin).toContain("?& array['thumbnail','display','fallback']");
    expect(fix).toContain("?& array['thumbnail','display']");
    expect(fix).not.toContain("?& array['thumbnail','display','fallback']");
  });
  it('fallback vẫn là khóa hợp lệ, đường dẫn và kiểu tệp giữ nguyên ràng buộc', () => {
    expect(fix).toContain("p_variants-array['thumbnail','display','fallback','original']");
    expect(fix).toContain("when 'fallback' then 'fallback.png'");
    expect(fix).toContain("when 'fallback' then 'image/png'");
  });
  it('phiếu cũ còn fallback vẫn xem được, phiếu mới xem bằng display', () => {
    expect(client).toContain("if (variants.display) return { kind: 'image', variant: 'display' };");
    expect(client).toContain("if (variants.fallback) return { kind: 'image', variant: 'fallback' };");
  });
  it('giữ nguyên các chốt an toàn khác của hàm', () => {
    for (const guard of ['work_require_notification_worker', 'work_attachment_can_mutate', 'processing_expires_at<=now()']) {
      expect(fix).toContain(guard);
    }
  });
});
