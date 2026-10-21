import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SKILL_INFO, skillCatalog } from '../../supabase/functions/ai-gateway/catalog';
import { SKILLS } from '../../supabase/functions/ai-gateway/skills';
import { TOOLS, TOOL_INFO } from '../../supabase/functions/ai-gateway/tools';
import { CHAT_SKILL } from '../../supabase/functions/ai-gateway/chat';
import { lineCount, parseSkillCatalog, parseSkillUsage } from '../aiSkillCatalog';

// Chủ SP 19/10: Trung tâm AI → tab Skill → bấm vào mỗi skill / công cụ xem dùng khi nào, lời dặn, quyền, thẻ tạo ra, lượt dùng 7 ngày.
describe('Trung tâm AI · xem bên trong skill — danh mục từ mã cổng', () => {
  it('mọi skill (kể cả Trợ lý) có màn gọi + kết quả; mọi công cụ có loại, quyền, kết quả, nguồn dữ liệu — thêm mới mà quên là test đỏ', () => {
    for (const code of [...Object.keys(SKILLS), CHAT_SKILL]) expect(SKILL_INFO[code]?.result, code).toBeTruthy();
    for (const t of TOOLS) {
      const info = TOOL_INFO[t.name];
      expect(info, t.name).toBeTruthy();
      expect(info.permission && info.result && info.rpcs.length, t.name).toBeTruthy();
      expect(info.kind === 'chuan_bi', t.name).toBe(t.name.startsWith('chuan_bi_'));
      if (info.kind === 'chuan_bi') expect(info.commandKind, t.name).toBeTruthy();
    }
    expect(Object.keys(TOOL_INFO).sort()).toEqual(TOOLS.map(t => t.name).sort());
  });

  it('nguồn dữ liệu ghi cho công cụ đúng là lệnh máy chủ có trong mã cổng (không ghi bịa / cũ)', () => {
    const source = ['tools.ts', 'workTools.ts'].map(f => readFileSync(`supabase/functions/ai-gateway/${f}`, 'utf8')).join('\n');
    for (const info of Object.values(TOOL_INFO)) for (const rpc of info.rpcs) expect(source.includes(`rpc('${rpc}'`), rpc).toBe(true);
  });

  it('danh mục: lời dặn đúng như gửi model; Trợ lý kèm đủ công cụ, "dùng khi" là mô tả model đọc; tham số có cờ bắt buộc', () => {
    const c = skillCatalog('Chủ nhật 19/10/2026, 09:41');
    const chat = c.skills.find(s => s.code === CHAT_SKILL)!;
    expect(chat.tools).toEqual(TOOLS.map(t => t.name));
    expect(chat.instructions).toContain('Hôm nay là Chủ nhật 19/10/2026, 09:41');
    expect(chat.instructions).toContain('bien_dong_nhan_su');
    expect(c.skills.find(s => s.code === 'po_review_brief')).toMatchObject({ where: SKILL_INFO.po_review_brief.where, instructions: SKILLS.po_review_brief.system, tools: [] });
    expect(c.skills.find(s => s.code === 'mr_photo_lines')!.readsImages).toBe(true);
    expect(c.skills.find(s => s.code === 'text_summary')!.where).toBeNull();
    const chart = c.tools.find(t => t.name === 'bien_dong_nhan_su')!;
    expect(chart).toMatchObject({ kind: 'bieu_do', label: 'Biến động nhân sự', rpcs: ['get_hrm_headcount_trend_v1'] });
    expect(chart.description).toBe(TOOLS.find(t => t.name === 'bien_dong_nhan_su')!.description);
    expect(c.tools.find(t => t.name === 'tim_ho_so')!.params.find(p => p.name === 'tu_khoa')).toMatchObject({ required: true });
    expect(c.tools.find(t => t.name === 'viec_cua_toi')!.params.find(p => p.name === 'nhom')!.description).toContain('cho_toi / toi_gui / theo_doi');
    expect(c.guard.length).toBeGreaterThan(20);
  });

  it('màn hình đọc lại danh mục cổng trả; dòng hỏng bị bỏ; loại công cụ lạ về "tra cứu"', () => {
    const parsed = parseSkillCatalog(JSON.parse(JSON.stringify(skillCatalog('x'))));
    expect(parsed.tools).toHaveLength(TOOLS.length);
    expect(parsed.skills.length).toBe(Object.keys(SKILLS).length + 1);
    expect(parseSkillCatalog({ skills: [{}], tools: [{ name: 'a', kind: 'xoa_het' }] })).toMatchObject({ skills: [], tools: [{ name: 'a', kind: 'tra_cuu', commandKind: null }] });
    expect(lineCount('a\nb\n')).toBe(2);
    expect(lineCount('  ')).toBe(0);
  });
});

describe('Trung tâm AI · lượt dùng 7 ngày', () => {
  it('đọc số theo skill / công cụ / thẻ; tên công cụ lạ bị bỏ; thiếu số → 0', () => {
    const u = parseSkillUsage({ days: 7,
      skills: [{ code: 'assistant_chat', name: 'Trợ lý · hội thoại', access: 'granted', runs: 142, people: 11, dislikes: 4, lastAt: '2026-10-19T02:00:00Z' }, { name: 'không mã' }],
      tools: [{ tool: 'bien_dong_nhan_su', runs: 4, people: 2 }, { tool: 'DROP TABLE', runs: 1 }],
      commands: [{ kind: 'purchase_order', prepared: 21, done: 14 }] });
    expect(u.skills).toHaveLength(1);
    expect(u.skills[0]).toMatchObject({ access: 'granted', runs: 142, people: 11, dislikes: 4, likes: 0, errors: 0, costUsd: 0, enabled: true });
    expect(u.tools).toEqual([{ tool: 'bien_dong_nhan_su', runs: 4, people: 2, lastAt: null }]);
    expect(u.commands).toEqual([{ kind: 'purchase_order', prepared: 21, done: 14 }]);
    expect(parseSkillUsage(null).days).toBe(7);
  });
});
