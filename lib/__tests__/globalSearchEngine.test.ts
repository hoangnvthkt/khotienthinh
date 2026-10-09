import { describe, expect, it } from 'vitest';
import { compactCode, foldVi, telexToPlain, tokenVariants, vniToPlain } from '../search/viText';
import { highlightRanges, parseQuery, prepareEntry, rankLocal, scoreEntry, serverTerms, suggestCorrection } from '../search/searchEngine';
import type { SearchEntry } from '../search/searchTypes';

const entry = (title: string, extra: Partial<SearchEntry> = {}): SearchEntry => ({
  key: title, kind: 'page', group: 'page', title, ...extra,
});

const titles = (query: string, entries: SearchEntry[]) =>
  rankLocal(entries.map(prepareEntry), parseQuery(query)).map(result => result.entry.title);

describe('viText', () => {
  it('folds Vietnamese without losing letters', () => {
    expect(foldVi('Đề nghị Thanh toán ĐỢT 2')).toBe('de nghi thanh toan dot 2');
    expect(compactCode('PO-2026/015')).toBe('po2026015');
  });

  it('reads raw Telex typed with the input method off', () => {
    expect(telexToPlain('nhaapj')).toBe('nhap');
    expect(telexToPlain('dduwowngf')).toBe('duong');
    expect(telexToPlain('hopwj')).toBe('hop');
    expect(telexToPlain('thanhf')).toBe('thanh');
    expect(telexToPlain('xuaats')).toBe('xuat');
    expect(telexToPlain('kho')).toBeNull();
    expect(telexToPlain('ccdc')).toBeNull();
  });

  it('reads raw VNI but leaves codes alone', () => {
    expect(vniToPlain('va6t5')).toBe('vat');
    expect(vniToPlain('d9u7o7ng2')).toBe('duong');
    expect(vniToPlain('d10')).toBeNull();
    expect(tokenVariants('po2026')).toEqual(['po2026']);
  });
});

describe('parseQuery', () => {
  it('expands abbreviations and synonyms, and hints the record kind', () => {
    const query = parseQuery('po thép');
    expect(query.groups[0].alts.map(alt => alt.text)).toEqual(expect.arrayContaining(['po', 'don hang']));
    expect(query.kindHints).toContain('purchase_order');
    expect(query.groups[1].alts[0].text).toBe('thep');
  });

  it('keeps multi-word phrases together', () => {
    const query = parseQuery('đề nghị thanh toán Hòa Phát');
    expect(query.groups.map(group => group.text)).toEqual(['de nghi thanh toan', 'hoa', 'phat']);
    expect(query.groups[0].alts.map(alt => alt.text)).toContain('dntt');
    expect(query.kindHints).toContain('payment_request');
  });

  it('fixes small typos against the domain vocabulary', () => {
    const query = parseQuery('thpe');
    expect(query.groups[0].alts.some(alt => alt.text === 'thep' && alt.source === 'typo')).toBe(true);
    expect(suggestCorrection(query)).toBe('thép');
  });

  it('does not "correct" a real 4-letter word into another one', () => {
    expect(parseQuery('phat').groups[0].alts.map(alt => alt.text)).toEqual(['phat']);
    expect(suggestCorrection(parseQuery('thep hoa phat'))).toBeNull();
  });

  it('records keyboard fixes so the UI can say what it understood', () => {
    const query = parseQuery('nhaapj kho');
    expect(query.keyboardFixes).toEqual([['nhaapj', 'nhap']]);
  });

  it('only sends safe folded text to the server', () => {
    expect(serverTerms(parseQuery('PO-2026.015 (thép)'))).toEqual([['po-2026.015'], ['thep']]);
  });
});

describe('ranking', () => {
  const pages = [
    entry('Phiếu kho', { keywords: 'nhap xuat chuyen' }),
    entry('Chấm công'),
    entry('Bảng lương', { keywords: 'payroll' }),
    entry('Đề nghị chi'),
    entry('Nhập kho', { kind: 'action', group: 'action' }),
  ];

  it('finds pages typed without diacritics', () => {
    expect(titles('cham cong', pages)[0]).toBe('Chấm công');
    expect(titles('bang luong', pages)[0]).toBe('Bảng lương');
  });

  it('finds pages typed in raw Telex', () => {
    expect(titles('chaams coong', pages)[0]).toBe('Chấm công');
    expect(titles('nhaapj kho', pages)[0]).toBe('Nhập kho');
  });

  it('finds pages by abbreviation and acronym', () => {
    expect(titles('cc', pages)).toContain('Chấm công');
    expect(titles('dnc', pages)).toContain('Đề nghị chi');
  });

  it('tolerates a typo in a longer word', () => {
    expect(titles('cahm cong', pages)[0]).toBe('Chấm công');
  });

  it('does not stretch a 4-letter typo onto a different word (phép is not thép)', () => {
    expect(titles('thpe', [entry('Xin nghỉ phép'), entry('Thép cây D10')])).toEqual(['Thép cây D10']);
  });

  it('keeps machine-added short abbreviations to whole words (cc is not ccdc)', () => {
    const list = [entry('Chấm công'), entry('Mua nóng / CCDC', { keywords: 'mua nong ccdc cong cu dung cu' })];
    expect(titles('chấm công', list)).toEqual(['Chấm công']);
    // Người dùng tự gõ "cc" thì vẫn khớp đầu từ.
    expect(titles('cc', list)).toContain('Mua nóng / CCDC');
  });

  it('requires every word to match', () => {
    expect(titles('cham luong', pages)).toEqual([]);
  });

  it('ranks an exact code above a partial title match', () => {
    const records = [
      entry('Đơn thép Hòa Phát', { kind: 'purchase_order', group: 'purchase', code: 'PO-2026-015' }),
      entry('PO 2026 015 tổng hợp', { kind: 'page', group: 'page' }),
    ];
    expect(titles('po2026015', records)[0]).toBe('Đơn thép Hòa Phát');
  });

  it('prefers the record kind the user named', () => {
    const records = [
      entry('Thép D10', { kind: 'item', group: 'material' }),
      entry('Thép D10', { key: 'po', kind: 'purchase_order', group: 'purchase', code: 'PO-1' }),
    ];
    const ranked = rankLocal(records.map(prepareEntry), parseQuery('đơn hàng thép d10'));
    expect(ranked[0].entry.kind).toBe('purchase_order');
  });

  it('gives a positive score to server records even when matched through hidden fields', () => {
    const score = scoreEntry(prepareEntry(entry('Phiếu nhập kho', { kind: 'wms_tx', group: 'material' })), parseQuery('xi mang'));
    expect(score.matchedAll).toBe(false);
  });
});

describe('highlightRanges', () => {
  it('maps folded matches back onto the accented title', () => {
    const title = 'Đề nghị thanh toán';
    const ranges = highlightRanges(title, parseQuery('de nghi'));
    expect(ranges.map(([start, end]) => title.slice(start, end))).toEqual(['Đề nghị']);
  });

  it('highlights synonyms the user did not type literally', () => {
    const title = 'Đơn hàng thép';
    const ranges = highlightRanges(title, parseQuery('po thep'));
    expect(ranges.map(([start, end]) => title.slice(start, end))).toEqual(['Đơn hàng thép']);
  });
});
