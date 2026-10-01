import { describe, expect, it } from 'vitest';
import {
  RICH_TEXT_PREFIX, isRichText, isRichTextEmpty, parseRichText, richTextToPlain, richTextToSafeHtml, serializeRichText,
  type RichTextDocument,
} from '../requestRichText';

const doc = (blocks: RichTextDocument['blocks']): RichTextDocument => ({ version: 1, blocks });

describe('request rich text', () => {
  it('keeps legacy plain text readable as paragraphs', () => {
    expect(parseRichText('Dòng 1\nDòng 2').blocks.map(block => block.lines[0][0]?.text)).toEqual(['Dòng 1', 'Dòng 2']);
    expect(richTextToPlain('Dòng 1\nDòng 2')).toBe('Dòng 1\nDòng 2');
  });

  it('stores unformatted content as plain text and formatted content with the prefix', () => {
    expect(serializeRichText(doc([{ type: 'paragraph', lines: [[{ text: 'Xin cấp máy tính' }]] }]))).toBe('Xin cấp máy tính');
    const stored = serializeRichText(doc([{ type: 'paragraph', align: 'center', lines: [[{ text: 'Tiêu đề', b: true, color: '#dc2626' }]] }]));
    expect(stored.startsWith(RICH_TEXT_PREFIX)).toBe(true);
    expect(isRichText(stored)).toBe(true);
    expect(parseRichText(stored).blocks[0]).toEqual({ type: 'paragraph', align: 'center', lines: [[{ text: 'Tiêu đề', b: true, color: '#dc2626' }]] });
  });

  it('drops anything outside the whitelist when parsing', () => {
    const hostile = RICH_TEXT_PREFIX + JSON.stringify({ blocks: [
      { type: 'script', lines: [[{ text: 'x' }]] },
      { type: 'paragraph', align: 'left;background:url(x)', indent: 99, lines: [[{ text: 'a', color: 'red;position:fixed', size: '99px', onclick: 'x' }]] },
    ] });
    expect(parseRichText(hostile).blocks).toEqual([{ type: 'paragraph', indent: 4, lines: [[{ text: 'a' }]] }]);
  });

  it('renders escaped, whitelisted HTML for printing', () => {
    const stored = serializeRichText(doc([
      { type: 'bullet', lines: [[{ text: '<img src=x onerror=alert(1)>', u: true }], [{ text: 'Mục 2', size: 'lg' }]] },
    ]));
    const html = richTextToSafeHtml(stored);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain('<ul><li><u>');
    expect(html).toContain('font-size:1.125rem');
  });

  it('converts lists to plain text for Word export and detects empty content', () => {
    const stored = serializeRichText(doc([
      { type: 'ordered', lines: [[{ text: 'Một', b: true }], [{ text: 'Hai' }]] },
      { type: 'bullet', indent: 1, lines: [[{ text: 'Con' }]] },
    ]));
    expect(richTextToPlain(stored)).toBe('1. Một\n2. Hai\n  • Con');
    expect(isRichTextEmpty(serializeRichText(doc([{ type: 'bullet', lines: [[]] }])))).toBe(true);
    expect(isRichTextEmpty('')).toBe(true);
    expect(isRichTextEmpty(stored)).toBe(false);
  });
});
