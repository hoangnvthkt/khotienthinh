// Gõ nhanh đề xuất (A1): khung gõ / dán danh sách → dòng nháp có mã. Danh mục là 175 mã thật (16/10/2026); không gọi Supabase.
// ?ai=none (chưa bật AI) · ?ai=fail · ?project=0 (đề xuất kho, không có ô lý do)
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { QuickRequestLines, type QuickLine, type QuickLinesHooks } from '../../components/QuickRequestLines';
import CATALOG from './quick-lines-items.json';

const params = new URLSearchParams(location.search);
const ITEMS = (CATALOG as Array<{ id: string; sku: string; name: string; unit: string; category: string | null }>)
  .map(i => ({ ...i, stockByWarehouse: {}, status: 'active' }) as never);
// Kết quả AI thật (deepseek-v4.1-flash qua RevidAPI, 16/10) cho các câu mẫu; câu khác trả theo dòng.
const AI_LINES: Record<string, Array<{ name: string; spec: string | null; qty: number | null; unit: string | null; note: string | null }>> = {
  'tổ anh hùng': [{ name: 'băng tan', spec: null, qty: 10, unit: 'cuộn', note: 'tổ anh Hùng, làm tường rào' }, { name: 'đinh', spec: '10', qty: 5, unit: 'kg', note: 'tổ anh Hùng, làm tường rào' }, { name: 'đá cắt', spec: '100', qty: 3, unit: 'hộp', note: 'tổ anh Hùng, làm tường rào' }],
  'thép d16': [{ name: 'thép', spec: 'D16', qty: 2, unit: 'tấn', note: 'móng M3' }, { name: 'xi măng', spec: 'PCB40', qty: 50, unit: 'bao', note: 'móng M3' }],
};
// Ảnh phiếu viết tay giả lập (?photo=fail: AI lỗi). Kết quả mô phỏng phiếu đề xuất SMB viết tay.
const PHOTO_READ = {
  lines: [
    { name: 'Ống PVC', spec: '110 C1', qty: 20, unit: 'cây', note: null },
    { name: 'Cút PVC', spec: '110', qty: 15, unit: 'cái', note: null },
    { name: 'Keo dán ống', spec: null, qty: 2, unit: 'kg', note: null },
    { name: 'Xi măng PCB40', spec: null, qty: 2.5, unit: 'tấn', note: 'đổ móng M3' },
    { name: 'Băng tan', spec: null, qty: 10, unit: 'cuộn', note: null },
  ],
  purpose: 'Thoát nước mưa nhà xưởng 1', neededDate: '2026-10-20', warnings: ['Dòng 3: số lượng viết đè, đọc là 2 — kiểm lại.'],
};
const hooks: QuickLinesHooks = {
  aiStatus: async () => ({ text: params.get('ai') !== 'none', photo: params.get('ai') !== 'none' }),
  readPhotos: async () => {
    await new Promise(r => setTimeout(r, 1800));
    if (params.get('photo') === 'fail') return { code: 'AI_FAILED', error: 'AI_HTTP_502' };
    return { code: 'OK', runId: 'run-photo', result: PHOTO_READ, model: 'claude-sonnet-5-5', provider: 'openai_compatible', usage: { tokensIn: 900, tokensOut: 400, costUsd: null, durationMs: 1800 } };
  },
  split: async text => {
    await new Promise(r => setTimeout(r, 1500));
    if (params.get('ai') === 'fail') return { code: 'AI_FAILED', error: 'AI_TRUNCATED' };
    const key = Object.keys(AI_LINES).find(k => text.toLowerCase().includes(k));
    return { code: 'OK', runId: 'run-1', result: { lines: key ? AI_LINES[key] : [] }, model: 'deepseek-v4.1-flash', provider: 'openai_compatible', usage: { tokensIn: 200, tokensOut: 300, costUsd: null, durationMs: 1500 } };
  },
  feedback: () => undefined,
};

const Fixture: React.FC = () => {
  const project = params.get('project') !== '0';
  const [open, setOpen] = useState(true);
  const [lines, setLines] = useState<QuickLine[]>([]);
  return <div className="min-h-screen bg-background p-3 sm:p-6">
    <div className="mx-auto max-w-4xl space-y-3 rounded-2xl border border-border bg-card p-3 sm:p-4">
      <h1 className="text-base font-black">Đề xuất vật tư · SMB-2026</h1>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-2 py-1.5">Vật tư</th><th className="px-2 py-1.5">SL</th><th className="px-2 py-1.5">Quy cách</th>{project && <th className="px-2 py-1.5">Lý do</th>}</tr></thead>
          <tbody data-testid="request-lines">{lines.length ? lines.map((l, i) => <tr key={i} className="border-b border-border last:border-0">
            <td className="px-2 py-1.5">{l.item.name}{l.neededDate ? <span className="ml-1 text-xs text-muted-foreground">· cần {l.neededDate}</span> : null}</td><td className="px-2 py-1.5 tabular-nums">{l.qty} {l.item.unit}</td><td className="px-2 py-1.5">{l.specification}</td>{project && <td className="px-2 py-1.5">{l.reason}</td>}</tr>)
            : <tr><td colSpan={4} className="px-2 py-4 text-center text-muted-foreground">Chưa có vật tư</td></tr>}</tbody>
        </table>
        {!open && <button type="button" onClick={() => setOpen(true)} className="w-full py-3 text-xs font-bold text-indigo-700">Gõ nhanh</button>}
      </div>
      {open && <QuickRequestLines items={ITEMS} withReason={project} allowAllItems hooks={hooks}
        onAdd={l => { setLines(prev => [...prev, ...l]); setOpen(false); }} onClose={() => setOpen(false)} />}
    </div>
  </div>;
};
createRoot(document.getElementById('root')!).render(<Fixture />);
