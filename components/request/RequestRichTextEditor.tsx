import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, Eraser, IndentDecrease, IndentIncrease,
  Italic, List, ListOrdered, Maximize2, Minimize2, Redo2, Strikethrough, Type, Underline, Undo2,
} from 'lucide-react';
import {
  MAX_RICH_TEXT_INDENT, RICH_TEXT_COLORS, RICH_TEXT_SIZES, parseRichText, richTextSizeCss, serializeRichText,
  type RichTextAlign, type RichTextBlock, type RichTextColor, type RichTextDocument, type RichTextRun, type RichTextSize,
} from '../../lib/requestRichText';

const INDENT_PX = 40;
const COLOR_SET = new Set<string>(RICH_TEXT_COLORS.map(color => color.value));
// execCommand('fontSize') levels used for each size; 3 is the browser default.
const SIZE_COMMAND: Record<RichTextSize | 'normal', string> = { sm: '2', normal: '3', lg: '5', xl: '6' };

const toHex = (color: string): string | null => {
  const value = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  return `#${match.slice(1, 4).map(part => Number(part).toString(16).padStart(2, '0')).join('')}`;
};

const sizeFrom = (element: HTMLElement): RichTextSize | undefined | null => {
  const fontTagSize = element.tagName === 'FONT' ? element.getAttribute('size') : null;
  if (fontTagSize) {
    const level = Number(fontTagSize);
    return level <= 2 ? 'sm' : level >= 6 ? 'xl' : level >= 4 ? 'lg' : null;
  }
  const size = element.style.fontSize;
  if (!size) return undefined;
  if (size === 'x-small' || size === 'small' || size === 'smaller') return 'sm';
  if (size === 'medium') return null;
  if (size === 'large' || size === 'x-large' || size === 'larger') return 'lg';
  if (size === 'xx-large' || size === 'xxx-large') return 'xl';
  const px = parseFloat(size) * (size.endsWith('rem') || size.endsWith('em') ? 16 : 1);
  if (!Number.isFinite(px)) return undefined;
  return px < 14 ? 'sm' : px >= 21 ? 'xl' : px >= 17 ? 'lg' : null;
};

type Marks = Omit<RichTextRun, 'text'>;

const marksFor = (element: HTMLElement, inherited: Marks): Marks => {
  const next: Marks = { ...inherited };
  const tag = element.tagName;
  const style = element.style;
  if (tag === 'B' || tag === 'STRONG' || Number(style.fontWeight) >= 600 || style.fontWeight === 'bold') next.b = true;
  if (style.fontWeight === 'normal' || style.fontWeight === '400') delete next.b;
  if (tag === 'I' || tag === 'EM' || style.fontStyle === 'italic') next.i = true;
  const decoration = `${style.textDecoration} ${style.textDecorationLine}`;
  if (tag === 'U' || decoration.includes('underline')) next.u = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || decoration.includes('line-through')) next.s = true;
  const rawColor = tag === 'FONT' ? element.getAttribute('color') : style.color;
  if (rawColor) {
    const hex = toHex(rawColor);
    if (hex && COLOR_SET.has(hex) && hex !== RICH_TEXT_COLORS[0].value) next.color = hex as RichTextColor;
    else delete next.color;
  }
  const size = sizeFrom(element);
  if (size === null) delete next.size;
  else if (size) next.size = size;
  return next;
};

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE']);

const runsFrom = (node: Node, marks: Marks, out: RichTextRun[]) => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? '').replace(/ /g, ' ');
    if (text) out.push({ text, ...marks });
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  if (node.tagName === 'BR') { out.push({ text: '\n', ...marks }); return; }
  const next = marksFor(node, marks);
  node.childNodes.forEach(child => runsFrom(child, next, out));
};

const mergeRuns = (runs: RichTextRun[]) => {
  const merged: RichTextRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    const { text: _lastText, ...lastMarks } = last ?? { text: '' };
    const { text, ...marks } = run;
    if (last && JSON.stringify(lastMarks) === JSON.stringify(marks)) last.text += text;
    else merged.push({ ...run });
  }
  // A trailing line break is how browsers keep an empty line open.
  const tail = merged[merged.length - 1];
  if (tail?.text.endsWith('\n')) tail.text = tail.text.slice(0, -1);
  return merged.filter(run => run.text);
};

const blockStyle = (element: HTMLElement, extraIndent: number): Pick<RichTextBlock, 'align' | 'indent'> => {
  const align = (element.style.textAlign || element.getAttribute('align') || '').toLowerCase();
  const margin = parseFloat(element.style.marginLeft || element.style.paddingLeft || '0');
  const indent = Math.min(MAX_RICH_TEXT_INDENT, extraIndent + (Number.isFinite(margin) ? Math.round(margin / INDENT_PX) : 0));
  return {
    ...(align === 'center' || align === 'right' || align === 'justify' ? { align: align as RichTextAlign } : {}),
    ...(indent > 0 ? { indent } : {}),
  };
};

const blocksFrom = (container: HTMLElement, indent = 0, inherited: Partial<Pick<RichTextBlock, 'align'>> = {}): RichTextBlock[] => {
  const blocks: RichTextBlock[] = [];
  let pending: RichTextRun[] = [];
  const flush = () => {
    if (pending.length) blocks.push({ type: 'paragraph', ...inherited, ...(indent ? { indent } : {}), lines: [mergeRuns(pending)] });
    pending = [];
  };
  container.childNodes.forEach(node => {
    if (!(node instanceof HTMLElement) || !BLOCK_TAGS.has(node.tagName)) { runsFrom(node, {}, pending); return; }
    flush();
    const style = blockStyle(node, indent);
    if (node.tagName === 'UL' || node.tagName === 'OL') {
      const items: RichTextRun[][] = [];
      const nested: RichTextBlock[] = [];
      node.childNodes.forEach(item => {
        if (!(item instanceof HTMLElement)) return;
        const runs: RichTextRun[] = [];
        item.childNodes.forEach(child => {
          if (child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL')) nested.push(...blocksFrom(item, (style.indent ?? 0) + 1).filter(block => block.type !== 'paragraph'));
          else runsFrom(child, {}, runs);
        });
        items.push(mergeRuns(runs));
      });
      blocks.push({ type: node.tagName === 'UL' ? 'bullet' : 'ordered', ...style, lines: items });
      blocks.push(...nested);
      return;
    }
    if (node.tagName === 'BLOCKQUOTE' || [...node.children].some(child => BLOCK_TAGS.has(child.tagName))) {
      blocks.push(...blocksFrom(node, node.tagName === 'BLOCKQUOTE' ? indent + 1 : (style.indent ?? indent), style.align ? { align: style.align } : inherited));
      return;
    }
    const runs: RichTextRun[] = [];
    node.childNodes.forEach(child => runsFrom(child, {}, runs));
    blocks.push({ type: 'paragraph', ...inherited, ...style, lines: [mergeRuns(runs)] });
  });
  flush();
  return blocks;
};

export const documentFromEditor = (root: HTMLElement): RichTextDocument => ({ version: 1, blocks: blocksFrom(root) });

const renderRuns = (target: HTMLElement, runs: RichTextRun[]) => {
  if (!runs.length) { target.append(document.createElement('br')); return; }
  runs.forEach(run => {
    const parts = run.text.split('\n');
    parts.forEach((part, index) => {
      let node: Node = document.createTextNode(part);
      if (run.color || run.size) {
        const span = document.createElement('span');
        if (run.color) span.style.color = run.color;
        if (run.size) span.style.fontSize = richTextSizeCss(run.size) ?? '';
        span.append(node);
        node = span;
      }
      for (const [flag, tag] of [['s', 's'], ['u', 'u'], ['i', 'em'], ['b', 'strong']] as const) {
        if (run[flag]) { const wrap = document.createElement(tag); wrap.append(node); node = wrap; }
      }
      if (part) target.append(node);
      if (index < parts.length - 1) target.append(document.createElement('br'));
    });
  });
};

export const renderDocument = (root: HTMLElement, doc: RichTextDocument) => {
  root.replaceChildren();
  doc.blocks.forEach(block => {
    const element = document.createElement(block.type === 'paragraph' ? 'div' : block.type === 'bullet' ? 'ul' : 'ol');
    if (block.align) element.style.textAlign = block.align;
    if (block.indent) element.style.marginLeft = `${block.indent * INDENT_PX}px`;
    if (block.type === 'paragraph') renderRuns(element, block.lines[0] ?? []);
    else block.lines.forEach(line => { const item = document.createElement('li'); renderRuns(item, line); element.append(item); });
    root.append(element);
  });
};

const ToolButton: React.FC<{ label: string; onRun: () => void; active?: boolean; children: React.ReactNode }> = ({ label, onRun, active, children }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-pressed={active}
    onMouseDown={event => { event.preventDefault(); onRun(); }}
    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white ${active ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-white' : ''}`}
  >{children}</button>
);

const Divider = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200 dark:bg-slate-700" />;

export const RequestRichTextEditor: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: number;
  ariaLabel?: string;
}> = ({ value, onChange, placeholder = 'Nhập nội dung...', disabled, minHeight = 140, ariaLabel }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const [isEmpty, setIsEmpty] = useState(!value);
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState<'color' | 'size' | null>(null);
  const [formats, setFormats] = useState<Record<string, boolean>>({});

  // Only re-render the DOM for values that did not come from this editor,
  // otherwise the caret would jump on every keystroke.
  useEffect(() => {
    const root = editorRef.current;
    if (!root || value === lastEmitted.current) return;
    renderDocument(root, parseRichText(value));
    lastEmitted.current = value;
    setIsEmpty(!value);
  }, [value]);

  // Expanding moves the editor into a portal, which mounts a fresh element.
  useLayoutEffect(() => {
    const root = editorRef.current;
    if (root && !root.childNodes.length && lastEmitted.current) renderDocument(root, parseRichText(lastEmitted.current));
  }, [expanded]);

  const emit = () => {
    const root = editorRef.current;
    if (!root) return;
    const next = serializeRichText(documentFromEditor(root));
    setIsEmpty(!root.textContent?.trim() && !root.querySelector('li'));
    if (next !== lastEmitted.current) { lastEmitted.current = next; onChange(next); }
  };

  const refreshFormats = () => {
    const state = (command: string) => { try { return document.queryCommandState(command); } catch { return false; } };
    setFormats({
      bold: state('bold'), italic: state('italic'), underline: state('underline'), strike: state('strikeThrough'),
      bullet: state('insertUnorderedList'), ordered: state('insertOrderedList'),
      center: state('justifyCenter'), right: state('justifyRight'), justify: state('justifyFull'),
    });
  };

  const run = (command: string, argument?: string) => {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, argument);
    setMenu(null);
    emit();
    refreshFormats();
  };

  const indent = (direction: 'indent' | 'outdent') => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode instanceof HTMLElement ? selection.anchorNode : selection?.anchorNode?.parentElement;
    if (anchor?.closest('li')) { run(direction); return; }
    let block = anchor;
    while (block && block.parentElement !== editorRef.current) block = block.parentElement;
    if (!block || !(block instanceof HTMLElement)) { run(direction); return; }
    const current = Math.round(parseFloat(block.style.marginLeft || '0') / INDENT_PX) || 0;
    const next = Math.max(0, Math.min(MAX_RICH_TEXT_INDENT, current + (direction === 'indent' ? 1 : -1)));
    block.style.marginLeft = next ? `${next * INDENT_PX}px` : '';
    emit();
  };

  const toolbar = (
    <div className="flex items-center gap-0.5 overflow-x-auto border-t border-slate-100 px-1.5 py-1 no-scrollbar dark:border-slate-800">
      <ToolButton label="In đậm (Ctrl/Cmd+B)" active={formats.bold} onRun={() => run('bold')}><Bold size={15} /></ToolButton>
      <ToolButton label="In nghiêng (Ctrl/Cmd+I)" active={formats.italic} onRun={() => run('italic')}><Italic size={15} /></ToolButton>
      <ToolButton label="Gạch chân (Ctrl/Cmd+U)" active={formats.underline} onRun={() => run('underline')}><Underline size={15} /></ToolButton>
      <ToolButton label="Gạch ngang" active={formats.strike} onRun={() => run('strikeThrough')}><Strikethrough size={15} /></ToolButton>
      <ToolButton label="Cỡ chữ" active={menu === 'size'} onRun={() => setMenu(menu === 'size' ? null : 'size')}><Type size={15} /></ToolButton>
      <ToolButton label="Màu chữ" active={menu === 'color'} onRun={() => setMenu(menu === 'color' ? null : 'color')}><Baseline size={15} /></ToolButton>
      <ToolButton label="Xóa định dạng" onRun={() => run('removeFormat')}><Eraser size={15} /></ToolButton>
      <Divider />
      <ToolButton label="Danh sách chấm" active={formats.bullet} onRun={() => run('insertUnorderedList')}><List size={15} /></ToolButton>
      <ToolButton label="Danh sách số" active={formats.ordered} onRun={() => run('insertOrderedList')}><ListOrdered size={15} /></ToolButton>
      <ToolButton label="Tăng thụt lề" onRun={() => indent('indent')}><IndentIncrease size={15} /></ToolButton>
      <ToolButton label="Giảm thụt lề" onRun={() => indent('outdent')}><IndentDecrease size={15} /></ToolButton>
      <Divider />
      <ToolButton label="Căn trái" active={!formats.center && !formats.right && !formats.justify} onRun={() => run('justifyLeft')}><AlignLeft size={15} /></ToolButton>
      <ToolButton label="Căn giữa" active={formats.center} onRun={() => run('justifyCenter')}><AlignCenter size={15} /></ToolButton>
      <ToolButton label="Căn phải" active={formats.right} onRun={() => run('justifyRight')}><AlignRight size={15} /></ToolButton>
      <ToolButton label="Căn đều" active={formats.justify} onRun={() => run('justifyFull')}><AlignJustify size={15} /></ToolButton>
      <Divider />
      <ToolButton label="Hoàn tác (Ctrl/Cmd+Z)" onRun={() => run('undo')}><Undo2 size={15} /></ToolButton>
      <ToolButton label="Làm lại" onRun={() => run('redo')}><Redo2 size={15} /></ToolButton>
      <Divider />
      <ToolButton label={expanded ? 'Thu nhỏ khung soạn thảo' : 'Mở rộng khung soạn thảo'} onRun={() => { setExpanded(value => !value); setMenu(null); }}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</ToolButton>
    </div>
  );

  const editor = (
    <div
      onKeyDown={event => { if (expanded && event.key === 'Escape') { event.stopPropagation(); setExpanded(false); } }}
      className={expanded ? 'fixed inset-0 z-[1250] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm sm:p-8' : ''}>
      <div className={`flex flex-col overflow-visible rounded-xl border border-slate-200 bg-white focus-within:border-teal-500 focus-within:ring-4 focus-within:ring-teal-100/70 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:ring-teal-950 ${expanded ? 'h-full w-full max-w-4xl shadow-2xl' : ''} ${disabled ? 'opacity-60' : ''}`}>
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          {isEmpty && <span className="pointer-events-none absolute left-3.5 top-2.5 text-sm text-slate-400">{placeholder}</span>}
          <div
            ref={editorRef}
            role="textbox"
            aria-multiline="true"
            aria-label={ariaLabel ?? placeholder}
            contentEditable={!disabled}
            suppressContentEditableWarning
            onInput={emit}
            onKeyUp={refreshFormats}
            onMouseUp={refreshFormats}
            onFocus={refreshFormats}
            onPaste={event => {
              // Keep pasted content plain; formatting comes from the toolbar only.
              event.preventDefault();
              document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
            }}
            className="request-rich-text px-3.5 py-2.5 text-sm leading-6 text-slate-800 outline-none dark:text-slate-100 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
            style={{ minHeight: expanded ? '100%' : minHeight }}
          />
        </div>
        {/* Pickers sit in the flow above the scrollable toolbar so they are never clipped. */}
        {menu === 'size' && <div className="flex flex-wrap items-center gap-1 border-t border-slate-100 px-2 py-1.5 dark:border-slate-800">
          {[{ value: 'normal' as const, label: 'Bình thường', css: undefined }, ...RICH_TEXT_SIZES].map(size => <button key={size.value} type="button" onMouseDown={event => { event.preventDefault(); run('fontSize', SIZE_COMMAND[size.value]); }} className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" style={{ fontSize: size.css }}>{size.label}</button>)}
        </div>}
        {menu === 'color' && <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-2.5 py-2 dark:border-slate-800">
          {RICH_TEXT_COLORS.map(color => <button key={color.value} type="button" title={color.label} aria-label={color.label} onMouseDown={event => { event.preventDefault(); run('foreColor', color.value); }} className="h-7 w-7 shrink-0 rounded-full border-2 border-white shadow ring-1 ring-slate-200 dark:border-slate-900 dark:ring-slate-700" style={{ backgroundColor: color.value }} />)}
        </div>}
        {toolbar}
      </div>
    </div>
  );
  // Dialogs create their own stacking context, so the full-screen view must
  // escape to <body> to sit above page chrome such as the floating chat button.
  return expanded ? <>{createPortal(editor, document.body)}<div style={{ minHeight }} className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700" /></> : editor;
};

export default RequestRichTextEditor;
