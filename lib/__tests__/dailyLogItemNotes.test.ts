import { describe, expect, it } from 'vitest';
import { bulletLines, composeSlipNotes, insertBulletBreak, normalizeBulletText } from '../dailyLogItemNotes';

describe('daily log item notes', () => {
  it('normalizes every line to one dash bullet and drops empty bullets', () => {
    expect(normalizeBulletText('- Ép cọc A1\n-\n• Ép cọc A2\n\nĐổ bê tông')).toBe('- Ép cọc A1\n- Ép cọc A2\n- Đổ bê tông');
    expect(normalizeBulletText('- ')).toBe('');
    expect(bulletLines('- a\n- \n- b')).toEqual(['a', 'b']);
  });

  it('starts a new bullet on Enter, but not from an empty bullet', () => {
    expect(insertBulletBreak('- Ép cọc', 8, 8)).toEqual({ value: '- Ép cọc\n- ', caret: 11 });
    expect(insertBulletBreak('- Ép cọc\n- ', 11, 11)).toBeNull();
  });

  it('derives slip content and issues grouped by item', () => {
    const rows = [
      { wbsCode: '1.1', taskName: 'Ép cọc thí nghiệm D400', note: '- Ép 3 cọc\n- Nghiệm thu tim', issues: '- Máy hỏng 2 giờ' },
      { wbsCode: '1.2', taskName: 'Ép cọc đại trà', note: '', issues: null },
    ];
    expect(composeSlipNotes(rows)).toEqual({
      content: '1.1 Ép cọc thí nghiệm D400:\n  - Ép 3 cọc\n  - Nghiệm thu tim',
      issues: '1.1 Ép cọc thí nghiệm D400:\n  - Máy hỏng 2 giờ',
    });
  });
});
