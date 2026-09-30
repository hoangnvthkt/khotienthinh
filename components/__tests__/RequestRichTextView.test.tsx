import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RequestRichTextView } from '../request/RequestRichTextView';
import { serializeRichText } from '../../lib/requestRichText';

describe('RequestRichTextView', () => {
  it('renders formatting as elements and never injects stored markup', () => {
    const value = serializeRichText({ version: 1, blocks: [
      { type: 'paragraph', align: 'center', lines: [[{ text: 'Lý do', b: true, color: '#dc2626' }]] },
      { type: 'ordered', indent: 1, lines: [[{ text: '<script>x</script>' }], [{ text: 'Hai', size: 'xl' }]] },
    ] });
    const html = renderToStaticMarkup(<RequestRichTextView value={value} />);
    expect(html).toContain('<p style="text-align:center" class="min-h-[1.5em]"><strong><span style="color:#dc2626">Lý do</span></strong></p>');
    expect(html).toContain('<ol style="margin-left:2.5rem" class="list-decimal pl-6">');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('font-size:1.375rem');
  });

  it('shows legacy plain text and the empty placeholder', () => {
    expect(renderToStaticMarkup(<RequestRichTextView value={'Dòng 1\nDòng 2'} />)).toContain('Dòng 2');
    expect(renderToStaticMarkup(<RequestRichTextView value="" emptyText="Không có mô tả chi tiết." />)).toContain('Không có mô tả chi tiết.');
  });
});
