import React, { useEffect, useMemo, useRef, useState } from "react";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type { WorkInlineNode, WorkTextDocument } from "../../lib/work/workTypes";
import { documentText } from "../../lib/work/workForm";

type MentionRange = { start: number; end: number; userId: string; label: string };

function editorState(document: WorkTextDocument) {
  const ranges: MentionRange[] = [];
  let offset = 0;
  document.content.forEach((paragraph, paragraphIndex) => {
    paragraph.content.forEach((node) => {
      const value = node.type === "mention" ? `@${node.label}` : node.text;
      if (node.type === "mention") ranges.push({ start: offset, end: offset + value.length, userId: node.userId, label: node.label });
      offset += value.length;
    });
    if (paragraphIndex < document.content.length - 1) offset++;
  });
  return { text: documentText(document), ranges };
}

function toDocument(text: string, ranges: MentionRange[]): WorkTextDocument {
  const content: WorkTextDocument["content"] = [];
  let absolute = 0;
  text.split("\n").forEach((line) => {
    const lineStart = absolute;
    const lineEnd = lineStart + line.length;
    const nodes: WorkInlineNode[] = [];
    let cursor = lineStart;
    ranges.filter((range) => range.start >= lineStart && range.end <= lineEnd).sort((a, b) => a.start - b.start).forEach((range) => {
      if (range.start > cursor) nodes.push({ type: "text", text: text.slice(cursor, range.start) });
      nodes.push({ type: "mention", userId: range.userId, label: range.label });
      cursor = range.end;
    });
    if (cursor < lineEnd || !nodes.length) nodes.push({ type: "text", text: text.slice(cursor, lineEnd) });
    content.push({ type: "paragraph", content: nodes });
    absolute = lineEnd + 1;
  });
  return { version: 1, type: "doc", content };
}

function changedRanges(oldText: string, nextText: string, ranges: MentionRange[]) {
  let start = 0;
  while (start < oldText.length && start < nextText.length && oldText[start] === nextText[start]) start++;
  let oldEnd = oldText.length;
  let nextEnd = nextText.length;
  while (oldEnd > start && nextEnd > start && oldText[oldEnd - 1] === nextText[nextEnd - 1]) { oldEnd--; nextEnd--; }
  const delta = nextEnd - oldEnd;
  return ranges.flatMap((range) => {
    if (range.end <= start) return [range];
    if (range.start >= oldEnd) return [{ ...range, start: range.start + delta, end: range.end + delta }];
    return [];
  });
}

export function WorkMentionComposer({ taskId, service, value, onChange, disabled, label }: {
  taskId: string;
  service: WorkTaskService;
  value: WorkTextDocument;
  onChange: (value: WorkTextDocument) => void;
  disabled?: boolean;
  label: string;
}) {
  const state = useMemo(() => editorState(value), [value]);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [items, setItems] = useState<Array<{ userId: string; name: string }>>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!query) return;
    let live = true;
    const timer = window.setTimeout(() => service.mentions(taskId, query.text).then((page) => { if (live) { setItems(page.items); setActive(0); } }).catch(() => live && setItems([])), 180);
    return () => { live = false; window.clearTimeout(timer); };
  }, [taskId, service, query?.text]);

  function detect(text: string, caret: number) {
    const before = text.slice(0, caret);
    const match = before.match(/(?:^|\s)@([^@\n]{0,80})$/u);
    const next = match ? { start: caret - match[1].length - 1, text: match[1] } : null;
    if (next && (next.start !== query?.start || next.text !== query.text)) {
      setItems([]);
      setActive(0);
    }
    setQuery(next);
  }
  function select(item: { userId: string; name: string }) {
    if (!query) return;
    const caret = input.current?.selectionStart ?? state.text.length;
    const token = `@${item.name}`;
    const nextText = state.text.slice(0, query.start) + token + " " + state.text.slice(caret);
    const preserved = state.ranges.filter((range) => range.end <= query.start || range.start >= caret).map((range) => range.start >= caret ? { ...range, start: range.start + token.length + 1 - (caret - query.start), end: range.end + token.length + 1 - (caret - query.start) } : range);
    onChange(toDocument(nextText, [...preserved, { start: query.start, end: query.start + token.length, userId: item.userId, label: item.name }]));
    setQuery(null);
    window.setTimeout(() => { input.current?.focus(); input.current?.setSelectionRange(query.start + token.length + 1, query.start + token.length + 1); }, 0);
  }
  return <div className="work-mention-composer">
    <label className="work-label">{label}
      <textarea ref={input} className="work-input" aria-label="Nội dung bình luận" rows={3} maxLength={10000} required disabled={disabled} value={state.text}
        onChange={(event) => { const ranges = changedRanges(state.text, event.target.value, state.ranges); onChange(toDocument(event.target.value, ranges)); detect(event.target.value, event.target.selectionStart); }}
        onClick={(event) => detect(event.currentTarget.value, event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (query && event.key === "Escape") {
            event.preventDefault();
            setQuery(null);
            return;
          }
          if (query && items.length && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
            event.preventDefault();
            if (event.key === "ArrowDown") setActive((active + 1) % items.length);
            else if (event.key === "ArrowUp") setActive((active - 1 + items.length) % items.length);
            else select(items[active]);
            return;
          }
          if (event.key === "Backspace" && event.currentTarget.selectionStart === event.currentTarget.selectionEnd) {
            const caret = event.currentTarget.selectionStart;
            const mention = state.ranges.find((range) => range.end === caret);
            if (mention) { event.preventDefault(); const next = state.text.slice(0, mention.start) + state.text.slice(mention.end); onChange(toDocument(next, state.ranges.filter((range) => range !== mention).map((range) => range.start >= mention.end ? { ...range, start: range.start - (mention.end - mention.start), end: range.end - (mention.end - mention.start) } : range))); }
          }
        }} />
    </label>
    {query && <div className="work-mention-suggestions" role="listbox" aria-label="Gợi ý nhắc tên">
      {items.map((item, index) => <button key={item.userId} type="button" role="option" aria-selected={index === active} onMouseDown={(event) => event.preventDefault()} onClick={() => select(item)}><span className="work-avatar">{item.name.split(" ").at(-1)?.[0]}</span><span><strong>{item.name}</strong><small>Đã có quyền xem công việc</small></span></button>)}
      {!items.length && <p>Không có người phù hợp.</p>}
    </div>}
  </div>;
}
