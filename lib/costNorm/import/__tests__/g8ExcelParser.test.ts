import { describe, expect, it } from 'vitest';
import { parseVietnameseNumber, normalizeSearchText } from '../normalize';
import { detectG8HeaderRow, parseG8Rows } from '../g8ExcelParser';
import { G8RawRow } from '../types';

const makeRows = (rows: string[][], sheetName = 'G8'): G8RawRow[] =>
  rows.map((values, index) => ({
    sheetName,
    rowNumber: index + 1,
    values,
    rawValues: Object.fromEntries(values.map((value, col) => [`${col}`, value]).filter(([, value]) => value)),
    text: values.map(value => value.trim()).filter(Boolean).join(' | '),
  }));

const sampleRows = () => makeRows([
  ['STT', 'Mã hiệu đơn giá', 'Tên công tác', 'Đơn vị', 'Định mức'],
  ['', 'AA.22111', 'Phá dỡ kết cấu bê tông có cốt thép bằng búa căn khí nén 3m3/ph', 'm3', ''],
  ['', '', 'Vật liệu', '', ''],
  ['', 'V00515', 'Que hàn', 'kg', '0,96'],
  ['', '', 'Nhân công', '', ''],
  ['', 'N0006', 'Nhân công bậc 3,0/7 - Nhóm 1', 'công', '0,6'],
  ['', '', 'Máy thi công', '', ''],
  ['', 'M112.4002_TT11', 'Biến thế hàn xoay chiều - công suất: 23 kW', 'ca', '0,23'],
  ['', 'M108.0302_TT11', 'Máy nén khí, động cơ diezel - năng suất: 360 m3/h', 'ca', '0,15'],
  ['', 'M112.2902', 'Búa căn khí nén', 'ca', '0,3'],
]);

describe('G8 Excel parser', () => {
  it('parses Vietnamese decimal numbers', () => {
    expect(parseVietnameseNumber('0,96')).toBe(0.96);
    expect(parseVietnameseNumber('0,6')).toBe(0.6);
    expect(parseVietnameseNumber('1.234,56')).toBe(1234.56);
  });

  it('normalizes searchable Vietnamese text', () => {
    expect(normalizeSearchText('Phá dỡ bê tông cốt thép')).toBe('pha do be tong cot thep');
  });

  it('detects G8 header mapping', () => {
    const detected = detectG8HeaderRow(sampleRows());
    expect(detected.rowNumber).toBe(1);
    expect(detected.mapping.itemCodeCol).toBe(1);
    expect(detected.mapping.resourceCodeCol).toBe(1);
    expect(detected.mapping.nameCol).toBe(2);
    expect(detected.mapping.unitCol).toBe(3);
    expect(detected.mapping.coefficientCol).toBe(4);
  });

  it('parses AA.22111 and groups material labor machine components', () => {
    const rows = sampleRows();
    const detected = detectG8HeaderRow(rows);
    const result = parseG8Rows(rows, detected.mapping, detected.rowNumber);
    const item = result.items[0];

    expect(result.parsedItems).toBe(1);
    expect(result.parsedComponents).toBe(5);
    expect(item.code).toBe('AA.22111');
    expect(item.unit).toBe('m3');
    expect(item.components.filter(row => row.resourceType === 'material')).toHaveLength(1);
    expect(item.components.filter(row => row.resourceType === 'labor')).toHaveLength(1);
    expect(item.components.filter(row => row.resourceType === 'machine')).toHaveLength(3);
    expect(item.components.find(row => row.resourceCode === 'M112.4002_TT11')?.coefficient).toBe(0.23);
  });

  it('classifies raw rows for import trace persistence', () => {
    const rows = sampleRows();
    const detected = detectG8HeaderRow(rows);
    const result = parseG8Rows(rows, detected.mapping, detected.rowNumber);

    expect(result.classifiedRows).toHaveLength(rows.length);
    expect(result.classifiedRows[0].rowType).toBe('ignored');
    expect(result.classifiedRows[1]).toMatchObject({
      rowType: 'work_item',
      itemCode: 'AA.22111',
    });
    expect(result.classifiedRows[2]).toMatchObject({
      rowType: 'group',
      groupType: 'material',
    });
    expect(result.classifiedRows[3]).toMatchObject({
      rowType: 'component',
      parentItemCode: 'AA.22111',
      resourceCode: 'V00515',
      resourceType: 'material',
      coefficient: 0.96,
    });
  });

  it('warns about duplicate work item codes', () => {
    const rows = makeRows([
      ['STT', 'Mã hiệu đơn giá', 'Tên công tác', 'Đơn vị', 'Định mức'],
      ['', 'AA.22111', 'Phá dỡ bê tông', 'm3', ''],
      ['', 'AA.22111', 'Phá dỡ bê tông lặp', 'm3', ''],
    ]);
    const detected = detectG8HeaderRow(rows);
    const result = parseG8Rows(rows, detected.mapping, detected.rowNumber);
    expect(result.items).toHaveLength(1);
    expect(result.issues.some(issue => issue.code === 'duplicate_item_code')).toBe(true);
  });

  it('warns about components without parent work item', () => {
    const rows = makeRows([
      ['STT', 'Mã hiệu đơn giá', 'Tên công tác', 'Đơn vị', 'Định mức'],
      ['', 'V00515', 'Que hàn', 'kg', '0,96'],
    ]);
    const detected = detectG8HeaderRow(rows);
    const result = parseG8Rows(rows, detected.mapping, detected.rowNumber);
    expect(result.items).toHaveLength(0);
    expect(result.issues.some(issue => issue.code === 'component_without_parent')).toBe(true);
  });

  it('keeps component and warns when coefficient is missing', () => {
    const rows = makeRows([
      ['STT', 'Mã hiệu đơn giá', 'Tên công tác', 'Đơn vị', 'Định mức'],
      ['', 'AA.22111', 'Phá dỡ bê tông', 'm3', ''],
      ['', '', 'Vật liệu', '', ''],
      ['', 'V00515', 'Que hàn', 'kg', ''],
    ]);
    const detected = detectG8HeaderRow(rows);
    const result = parseG8Rows(rows, detected.mapping, detected.rowNumber);
    expect(result.items[0].components[0].coefficient).toBeNull();
    expect(result.issues.some(issue => issue.message.includes('Thiếu định mức'))).toBe(true);
  });
});
