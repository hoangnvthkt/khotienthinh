import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, ScanText, ThumbsDown, ThumbsUp } from 'lucide-react';
import { aiErrorMessage } from '../../lib/aiGateway';
import { DOC_READ_ACCEPT, defaultDocReadHooks, prepareDocReadInput, type DocReadHooks, type DocReadResult, type DocReadSkill } from '../../lib/aiDocRead';

// B5 (chủ SP 22/10/2026) — nút "Đọc từ ảnh / PDF (AI)" dùng chung cho form Hợp đồng NCC, Hóa đơn NCC, Văn bản đến: chọn tệp → đọc trên máy
// (PDF chữ / ảnh) → cổng AI → gọi onResult để màn ĐIỀN SẴN ô trống. Trạng thái: chưa bật AI (ẩn), đang đọc (~20–40 s), lỗi (lời theo mã +
// Đọc lại cùng tệp), xong (đã điền gì, lưu ý của AI, 👍 / 👎). Người dùng vẫn kiểm từng ô và tự lưu.

interface Props<S extends DocReadSkill> {
  skill: S;
  /** Chữ trên nút, VD "Đọc hợp đồng (AI)". */
  label: string;
  /** Một dòng dưới nút: điền được gì. */
  hint: string;
  screen: string;
  /** Màn nhận kết quả → điền form; trả về danh sách ô đã điền để báo. */
  onResult: (result: DocReadResult[S], ctx: { runId: string | null; files: File[]; pages: number }) => Promise<string[]> | string[];
  disabled?: boolean;
  compact?: boolean;
  hooks?: DocReadHooks;
}

type State = { kind: 'idle' } | { kind: 'reading'; files: File[] } | { kind: 'error'; files: File[]; message: string } | { kind: 'done'; files: File[]; filled: string[]; warnings: string[]; runId: string | null; rated?: boolean };

export function AiDocReadButton<S extends DocReadSkill>({ skill, label, hint, screen, onResult, disabled, compact, hooks = defaultDocReadHooks }: Props<S>) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  const token = useRef(0);
  useEffect(() => { let alive = true; hooks.available(skill).then(v => { if (alive) setAvailable(v); }); return () => { alive = false; }; }, [hooks, skill]);

  const read = async (files: File[]) => {
    const my = ++token.current;
    setState({ kind: 'reading', files });
    try {
      const prepared = await prepareDocReadInput(files);
      if (!prepared.input.images.length && prepared.input.text.length < 20) { setState({ kind: 'error', files, message: prepared.errors[0] || 'Tệp không có chữ hay ảnh đọc được — chụp lại rõ hơn.' }); return; }
      const r = await hooks.run(skill, prepared.input, screen);
      if (my !== token.current) return;
      if (r.code !== 'OK') { setState({ kind: 'error', files, message: aiErrorMessage(r) }); return; }
      const filled = await onResult(r.result, { runId: r.runId ?? null, files, pages: prepared.pages });
      const warnings = [...prepared.errors, ...((r.result as { warnings?: string[] }).warnings || [])];
      setState({ kind: 'done', files, filled, warnings, runId: r.runId ?? null });
    } catch (e) {
      if (my === token.current) setState({ kind: 'error', files, message: e instanceof Error ? e.message : 'Chưa đọc được tệp.' });
    }
  };
  const rate = (accepted: boolean) => { if (state.kind === 'done' && state.runId && !state.rated) { hooks.feedback(state.runId, accepted); setState({ ...state, rated: true }); } };

  if (available === false) return null;
  const busy = state.kind === 'reading';
  const names = (files: File[]) => files.map(f => f.name).join(', ');
  return (
    <div className={`rounded-xl border border-dashed border-teal-300 bg-teal-50/40 px-3 py-2.5 dark:border-teal-800 dark:bg-teal-950/20 ${compact ? 'text-xs' : 'text-sm'}`} data-testid={`ai-doc-read-${skill}`}>
      <input ref={inputRef} type="file" accept={DOC_READ_ACCEPT} multiple className="hidden" aria-label={`${label} — chọn tệp`}
        onChange={e => { const files = Array.from(e.target.files || []).slice(0, 6); e.target.value = ''; if (files.length) void read(files); }} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || busy || available === null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ScanText size={15} aria-hidden="true" />} {label}
        </button>
        <span className="text-xs text-muted-foreground">{hint} Ảnh chụp hoặc PDF; AI chỉ điền ô còn trống, anh / chị kiểm lại rồi lưu.</span>
      </div>
      {state.kind === 'reading' && <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground" aria-live="polite"><Loader2 size={13} className="animate-spin text-teal-700" aria-hidden="true" /> AI đang đọc {names(state.files)}… (khoảng 20–40 giây)</p>}
      {state.kind === 'error' && (
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-amber-800 dark:text-amber-200" role="alert">
          <AlertTriangle size={13} aria-hidden="true" /> {state.message}
          <button type="button" onClick={() => void read(state.files)} className="font-semibold text-teal-700 hover:underline dark:text-teal-300">Đọc lại</button>
        </p>
      )}
      {state.kind === 'done' && (
        <div className="mt-1.5 space-y-1 text-xs" aria-live="polite">
          <p className="font-semibold text-foreground">{state.filled.length ? `Đã điền ${state.filled.length} ô: ${state.filled.join(', ')}.` : 'Không có ô trống nào để điền — xem lưu ý.'} Kiểm lại trước khi lưu.</p>
          {state.warnings.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-amber-800 dark:text-amber-200">{state.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {state.runId && !state.rated && (
            <p className="flex items-center gap-1 text-muted-foreground">AI đọc đúng không?
              <button type="button" onClick={() => rate(true)} className="rounded px-1.5 py-0.5 hover:bg-leaf-50" aria-label="Đọc đúng"><ThumbsUp size={13} /></button>
              <button type="button" onClick={() => rate(false)} className="rounded px-1.5 py-0.5 hover:bg-rose-50" aria-label="Đọc sai"><ThumbsDown size={13} /></button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default AiDocReadButton;
