/**
 * Rich text for request content ("Nội dung & Lý do đề xuất" and long-text
 * form fields).
 *
 * Stored as a structured document serialised with a `RT1:` prefix inside the
 * existing text/jsonb string slots, so no schema change is needed and legacy
 * plain strings keep working. Only whitelisted marks, palette colours, sizes,
 * alignments and indents survive parsing — nothing is ever stored or rendered
 * as raw HTML.
 */

export const RICH_TEXT_PREFIX = 'RT1:';

export const RICH_TEXT_COLORS = [
  { value: '#0f172a', label: 'Đen' },
  { value: '#64748b', label: 'Xám' },
  { value: '#dc2626', label: 'Đỏ' },
  { value: '#ea580c', label: 'Cam' },
  { value: '#ca8a04', label: 'Vàng' },
  { value: '#16a34a', label: 'Xanh lá' },
  { value: '#2563eb', label: 'Xanh dương' },
  { value: '#7c3aed', label: 'Tím' },
] as const;
export type RichTextColor = typeof RICH_TEXT_COLORS[number]['value'];

export const RICH_TEXT_SIZES = [
  { value: 'sm', label: 'Nhỏ', css: '0.8125rem' },
  { value: 'lg', label: 'Lớn', css: '1.125rem' },
  { value: 'xl', label: 'Rất lớn', css: '1.375rem' },
] as const;
export type RichTextSize = typeof RICH_TEXT_SIZES[number]['value'];

export type RichTextAlign = 'left' | 'center' | 'right' | 'justify';
export const MAX_RICH_TEXT_INDENT = 4;

export interface RichTextRun {
  text: string;
  b?: true;
  i?: true;
  u?: true;
  s?: true;
  color?: RichTextColor;
  size?: RichTextSize;
}

export interface RichTextBlock {
  type: 'paragraph' | 'bullet' | 'ordered';
  align?: RichTextAlign;
  indent?: number;
  /** paragraph: one entry; lists: one entry per item. */
  lines: RichTextRun[][];
}

export interface RichTextDocument {
  version: 1;
  blocks: RichTextBlock[];
}

const COLOR_SET = new Set<string>(RICH_TEXT_COLORS.map(color => color.value));
const SIZE_SET = new Set<string>(RICH_TEXT_SIZES.map(size => size.value));
const ALIGN_SET = new Set<string>(['left', 'center', 'right', 'justify']);

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const cleanRun = (value: unknown): RichTextRun | null => {
  if (!isRecord(value) || typeof value.text !== 'string' || !value.text) return null;
  const run: RichTextRun = { text: value.text };
  if (value.b === true) run.b = true;
  if (value.i === true) run.i = true;
  if (value.u === true) run.u = true;
  if (value.s === true) run.s = true;
  if (typeof value.color === 'string' && COLOR_SET.has(value.color)) run.color = value.color as RichTextColor;
  if (typeof value.size === 'string' && SIZE_SET.has(value.size)) run.size = value.size as RichTextSize;
  return run;
};

const cleanBlock = (value: unknown): RichTextBlock | null => {
  if (!isRecord(value) || !['paragraph', 'bullet', 'ordered'].includes(String(value.type)) || !Array.isArray(value.lines)) return null;
  const block: RichTextBlock = {
    type: value.type as RichTextBlock['type'],
    lines: value.lines.map(line => (Array.isArray(line) ? line.map(cleanRun).filter((run): run is RichTextRun => !!run) : [])),
  };
  if (typeof value.align === 'string' && ALIGN_SET.has(value.align) && value.align !== 'left') block.align = value.align as RichTextAlign;
  if (Number.isInteger(value.indent) && (value.indent as number) > 0) block.indent = Math.min(value.indent as number, MAX_RICH_TEXT_INDENT);
  if (block.type === 'paragraph' && block.lines.length !== 1) block.lines = [block.lines.flat()];
  return block;
};

export const isRichText = (value: unknown): value is string => typeof value === 'string' && value.startsWith(RICH_TEXT_PREFIX);

/** Legacy plain strings become one paragraph per line. */
export const parseRichText = (value: unknown): RichTextDocument => {
  if (isRichText(value)) {
    try {
      const raw = JSON.parse(value.slice(RICH_TEXT_PREFIX.length)) as unknown;
      if (isRecord(raw) && Array.isArray(raw.blocks)) {
        return { version: 1, blocks: raw.blocks.map(cleanBlock).filter((block): block is RichTextBlock => !!block) };
      }
    } catch {
      // Fall through to treating the value as text.
    }
  }
  const text = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  if (!text) return { version: 1, blocks: [] };
  return { version: 1, blocks: text.split('\n').map(line => ({ type: 'paragraph' as const, lines: [line ? [{ text: line }] : []] })) };
};

const hasFormatting = (doc: RichTextDocument) => doc.blocks.some(block => block.type !== 'paragraph' || block.align || block.indent
  || block.lines.some(line => line.some(run => run.b || run.i || run.u || run.s || run.color || run.size)));

const documentToPlain = (doc: RichTextDocument): string => doc.blocks.map(block => block.lines.map((line, index) => {
  const text = line.map(run => run.text).join('');
  const pad = '  '.repeat(block.indent ?? 0);
  if (block.type === 'bullet') return `${pad}• ${text}`;
  if (block.type === 'ordered') return `${pad}${index + 1}. ${text}`;
  return `${pad}${text}`;
}).join('\n')).join('\n');

export const richTextToPlain = (value: unknown): string => documentToPlain(parseRichText(value));

export const isRichTextEmpty = (value: unknown) => !richTextToPlain(value).replace(/[•\d.\s]/g, '');

/**
 * Serialise for storage. Unformatted content is stored as plain text so it
 * stays readable everywhere (search, exports, older clients).
 */
export const serializeRichText = (doc: RichTextDocument): string => {
  const blocks = doc.blocks.map(block => ({ ...block, lines: block.lines.map(line => line.filter(run => run.text)) }));
  while (blocks.length && blocks[blocks.length - 1].lines.every(line => !line.length) && blocks[blocks.length - 1].type === 'paragraph') blocks.pop();
  const trimmed: RichTextDocument = { version: 1, blocks };
  if (!blocks.length) return '';
  if (!hasFormatting(trimmed)) return documentToPlain(trimmed);
  return RICH_TEXT_PREFIX + JSON.stringify({ blocks });
};

export const richTextSizeCss = (size?: RichTextSize) => RICH_TEXT_SIZES.find(item => item.value === size)?.css;

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Escaped HTML for the print preview; every attribute comes from a whitelist. */
export const richTextToSafeHtml = (value: unknown): string => parseRichText(value).blocks.map(block => {
  const style = [
    block.align ? `text-align:${block.align}` : '',
    block.indent ? `margin-left:${block.indent * 1.5}em` : '',
  ].filter(Boolean).join(';');
  const runs = (line: RichTextRun[]) => line.map(run => {
    let html = escapeHtml(run.text).replace(/\n/g, '<br>');
    const css = [run.color ? `color:${run.color}` : '', run.size ? `font-size:${richTextSizeCss(run.size)}` : ''].filter(Boolean).join(';');
    if (css) html = `<span style="${css}">${html}</span>`;
    if (run.s) html = `<s>${html}</s>`;
    if (run.u) html = `<u>${html}</u>`;
    if (run.i) html = `<em>${html}</em>`;
    if (run.b) html = `<strong>${html}</strong>`;
    return html;
  }).join('') || '<br>';
  const styleAttr = style ? ` style="${style}"` : '';
  if (block.type === 'paragraph') return `<p${styleAttr}>${runs(block.lines[0] ?? [])}</p>`;
  const tag = block.type === 'bullet' ? 'ul' : 'ol';
  return `<${tag}${styleAttr}>${block.lines.map(line => `<li>${runs(line)}</li>`).join('')}</${tag}>`;
}).join('');
