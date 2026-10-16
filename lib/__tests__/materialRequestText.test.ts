import { describe, expect, it } from 'vitest';
import { matchLines, parseRequestText, parseSegment, parseViNumber, rankItems, scoreItem } from '../materialRequestText';
import { SKILLS } from '../../supabase/functions/ai-gateway/skills';

// Danh mục mẫu lấy theo tên mã thật (16/10/2026).
const CATALOG = [
  ['i1', 'Ống PVC 110 C1', 'Cây'], ['i2', 'Cút PVC 110', 'Cái'], ['i3', 'Chếch PVC 110', 'Cái'], ['i4', 'Bịt PVC 110', 'Cái'],
  ['i5', 'Keo dán ống 1000g', 'Kg'], ['i6', 'Cút PPR ren trong 25*1/2', 'Cái'], ['i7', 'Tê ren trong PPR 25x1/2', 'Cái'],
  ['i8', 'Ống PPR 25', 'Cây'], ['i9', 'Ống tránh PPR 25', 'Cây'], ['i10', 'Thép hộp mạ kẽm 50x100x1.8 ly', 'Cây'],
  ['i11', 'Thép hộp mạ kẽm 50x100x2 ly', 'Cây'], ['i12', 'Xi măng PCB40', 'Bao'], ['i13', 'Thép XD D16', 'Kg'], ['i14', 'Thép tròn trơn D16', 'Kg'],
  ['i15', 'Khóa cáp 10', 'Cái'], ['i16', 'Đá cắt 100', 'Hộp'], ['i17', 'Cống bi thường D500', 'Mét'], ['i18', 'Đế cống D500', 'Cái'],
  ['i19', 'Tôn sóng công nghiệp dày 0.45mm', 'm2'], ['i20', 'Cút PVC 90', 'Cái'],
].map(([id, name, unit]) => ({ id, name, unit, sku: `VT${id.slice(1).padStart(4, '0')}` }));
const one = (text: string) => matchLines(parseRequestText(text), CATALOG)[0];

describe('Gõ nhanh đề xuất — tách dòng bằng quy tắc', () => {
  it('số kiểu Việt: 1.332,42 · 7,5 · 2.000 · 7.5', () => {
    expect([parseViNumber('1.332,42'), parseViNumber('7,5'), parseViNumber('2.000'), parseViNumber('7.5'), parseViNumber('abc')]).toEqual([1332.42, 7.5, 2000, 7.5, null]);
  });

  it('danh sách nhiều kiểu: xuống dòng, gạch đầu dòng, dấu phẩy, "x 15", "SL: 4", số dính đơn vị', () => {
    const lines = parseRequestText('- Ống PVC 110 C1 20 cây\n2) cút PVC 110 x 15, keo dán ống: 2\nTôn sóng 0.45 trắng 120m2; Bê tông M250 7,5 m3');
    expect(lines.map(l => [l.name, l.qty, l.unit])).toEqual([
      ['Ống PVC 110 C1', 20, 'cây'], ['cút PVC 110', 15, null], ['keo dán ống', 2, null], ['Tôn sóng 0.45 trắng', 120, 'm2'], ['Bê tông M250', 7.5, 'm3'],
    ]);
  });

  it('câu văn: bỏ lời mở đầu, tách "và / với", phần "cho …" thành ghi chú', () => {
    const lines = parseRequestText('cần 2 tấn thép D16 và 50 bao xi măng PCB40 cho móng M3');
    expect(lines.map(l => [l.name, l.qty, l.unit, l.note])).toEqual([['thép D16', 2, 'tấn', null], ['xi măng PCB40', 50, 'bao', 'móng M3']]);
    expect(parseRequestText('Anh ơi đặt giúp em:\n- Vít bắn tôn 2000 con').map(l => l.name)).toEqual(['Vít bắn tôn']);
  });

  it('không thấy số lượng thì qty null và gắn cờ chưa chắc; ghi chú trong ngoặc', () => {
    expect(parseSegment('Silicon 1 thùng (24 tuýp)')).toMatchObject({ name: 'Silicon', qty: 1, unit: 'thùng', note: '24 tuýp' });
    expect(one('Cống D500 (thường) 45 m')).toMatchObject({ name: 'Cống D500 thường', qty: 45, candidates: [{ item: { name: 'Cống bi thường D500' } }, expect.anything()] });
    expect(parseSegment('giao trước thứ 7 nha')).toMatchObject({ qty: null, unsure: true });
  });
});

describe('Gõ nhanh đề xuất — khớp mã', () => {
  it('chọn sẵn khi chắc: D110 = 110, "sắt" = thép, tên trùng khít thắng tên dài hơn', () => {
    expect(one('Cút PVC D110 15 cái')).toMatchObject({ pick: { name: 'Cút PVC 110' }, specGuess: null });
    expect(one('Cống D500 (thường) 45 m').pick?.name).toBe('Cống bi thường D500'); // m = Mét
    expect(one('Sắt hộp mạ kẽm 50x100x1.8 x6m 180 cây')).toMatchObject({ pick: { name: 'Thép hộp mạ kẽm 50x100x1.8 ly' }, specGuess: 'x6m' });
    expect(one('Ống PPR 25 42 cây').pick?.name).toBe('Ống PPR 25');
  });

  it('từ đầu tên mã phải có trong câu: Tê ≠ Cút, Cốc cáp ≠ Khóa cáp', () => {
    expect(one('Tê ren trong PPR 25 1/2 1 cái').pick?.name).toBe('Tê ren trong PPR 25x1/2');
    expect(one('Cút ren trong PPR 25 1/2 151 cái').pick?.name).toBe('Cút PPR ren trong 25*1/2');
    expect(one('Cốc cáp 10 3 cái').candidates.map(c => c.item.name)).not.toContain('Khóa cáp 10');
    expect(scoreItem('Cút PVC 110', 'Cút PVC 90')).toBeLessThan(0.5);
  });

  it('lệch đơn vị (câu ghi tấn / bao, mã tính kg) → không chọn sẵn, vẫn gợi ý', () => {
    const m = one('cần 2 tấn thép D16');
    expect(m.pick).toBeNull();
    expect(m.candidates.map(c => c.item.name).slice(0, 2)).toEqual(['Thép XD D16', 'Thép tròn trơn D16']);
    const xm = one('50 bao xi măng PCB40');
    expect(xm.pick?.name).toBe('Xi măng PCB40');
    expect(xm.unitMismatch).toBe(false);
  });

  it('số lượng giữa câu: chọn phía khớp mã tốt hơn ("cho tổ anh Hùng 3 hộp đá cắt 100")', () => {
    expect(one('Lấy cho tổ anh Hùng 3 hộp đá cắt 100')).toMatchObject({ name: 'đá cắt 100', qty: 3, note: 'tổ anh Hùng', pick: { name: 'Đá cắt 100' } });
  });

  it('mã công trường hay dùng được ưu tiên khi ngang điểm; gõ đúng mã SKU thì khớp ngay', () => {
    const boosted = rankItems('Cống D500', CATALOG, { boost: new Set(['i18']) });
    expect(boosted.map(c => c.item.id)).toContain('i18');
    expect(rankItems('VT0012 50 bao', CATALOG)[0].item.name).toBe('Xi măng PCB40');
  });
});

describe('Gõ nhanh đề xuất — dòng AI tách', () => {
  it('quy cách AI tách đã nằm trong tên mã thì bỏ ("100" với "Đá cắt 100"); quy cách mới thì giữ', () => {
    const [a, b] = matchLines([
      { name: 'đá cắt', spec: '100', qty: 3, unit: 'hộp', note: 'tường rào', raw: 'đá cắt 100' },
      { name: 'ống PVC', spec: '110 C1 PN10', qty: 20, unit: 'cây', note: null, raw: 'ống PVC 110 C1 PN10' },
    ], CATALOG);
    expect(a).toMatchObject({ pick: { name: 'Đá cắt 100' }, specGuess: null, note: 'tường rào' });
    expect(b).toMatchObject({ pick: { name: 'Ống PVC 110 C1' }, specGuess: 'PN10' });
  });
});

describe('skill mr_text_lines', () => {
  const skill = SKILLS.mr_text_lines;
  it('bọc câu trong <du_lieu>; chuẩn hóa dòng AI: bỏ dòng không tên, SL chuỗi "1,5", "null" thành null', () => {
    expect(skill.user(skill.parseInput({ text: 'cần 2 tấn thép D16' }))).toContain('yeu_cau');
    expect(skill.parseOutput({ lines: [
      { name: 'thép', spec: 'D16', qty: 2, unit: 'tấn', note: 'móng M3' },
      { name: '', qty: 3 },
      { name: 'xi măng', spec: 'null', qty: '1,5', unit: 'tấn', note: null },
    ] })).toEqual({ lines: [
      { name: 'thép', spec: 'D16', qty: 2, unit: 'tấn', note: 'móng M3' },
      { name: 'xi măng', spec: null, qty: 1.5, unit: 'tấn', note: null },
    ] });
    expect(() => skill.parseInput({ text: 'a' })).toThrow('AI_BAD_INPUT');
  });
});

describe('skill mr_photo_lines (chụp phiếu đề xuất viết tay)', () => {
  const skill = SKILLS.mr_photo_lines;
  const img = (b64 = 'A'.repeat(400)) => ({ mime: 'image/jpeg', b64 });
  it('chỉ nhận 1–4 ảnh JPG/PNG/WebP base64; skill có ảnh để cổng gửi sang kết nối đọc ảnh', () => {
    expect(skill.images).toBeTypeOf('function');
    expect(skill.parseInput({ images: [img(), img()] })).toEqual({ pages: '2' });
    expect(skill.images!({ images: [img()] })).toEqual([{ mime: 'image/jpeg', b64: 'A'.repeat(400) }]);
    expect(() => skill.parseInput({ images: [] })).toThrow('AI_BAD_INPUT');
    expect(() => skill.parseInput({ images: [img(), img(), img(), img(), img()] })).toThrow('AI_BAD_INPUT');
    expect(() => skill.parseInput({ images: [{ mime: 'application/pdf', b64: 'A'.repeat(400) }] })).toThrow('AI_BAD_INPUT');
    expect(() => skill.parseInput({ images: [img('<script>'.repeat(50))] })).toThrow('AI_BAD_INPUT');
  });
  it('chuẩn hóa: SL "1.500" = 1500, ngày cần hợp lệ, cảnh báo; model trả mảng thì lấy phiếu đầu', () => {
    const out = skill.parseOutput([{ lines: [{ name: 'Gạch 2 lỗ', qty: '1.500', unit: 'viên' }, { name: ' ', qty: 2 }], purpose: 'Xây tường rào', neededDate: '2026-10-20', warnings: ['Dòng 1 viết đè'] }]);
    expect(out).toEqual({ lines: [{ name: 'Gạch 2 lỗ', spec: null, qty: 1500, unit: 'viên', note: null }], purpose: 'Xây tường rào', neededDate: '2026-10-20', warnings: ['Dòng 1 viết đè'] });
    expect(skill.parseOutput({ lines: [], purpose: null, neededDate: '20/10/2026', warnings: [] }).neededDate).toBeNull();
  });
});
