import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  LocalizedMoneyInput,
  LocalizedNumberInput,
} from '../../../components/common/LocalizedNumberInput';
import {
  commitLocalizedNumberDraft,
  inspectLocalizedNumberDraft,
} from '../inputDraft';
import type { DecimalPolicy } from '../decimal';

const quantityPolicy: DecimalPolicy = {
  kind: 'quantity',
  maxFractionDigits: 6,
  min: 0,
  allowNegative: false,
};

describe('localized number draft lifecycle', () => {
  it('preserves intermediate draft text while the user types a decimal', () => {
    const first = inspectLocalizedNumberDraft('1', quantityPolicy);
    const separator = inspectLocalizedNumberDraft('1,', quantityPolicy);
    const decimal = inspectLocalizedNumberDraft('1,25', quantityPolicy);

    expect(first).toMatchObject({ draft: '1', ok: true, canonical: '1' });
    expect(separator).toEqual({ draft: '1,', ok: false, code: 'invalid' });
    expect(decimal).toMatchObject({ draft: '1,25', ok: true, canonical: '1.25' });
  });

  it('strictly reparses and formats a valid draft when committed', () => {
    expect(commitLocalizedNumberDraft('1234,500', quantityPolicy)).toEqual({
      draft: '1.234,5',
      ok: true,
      value: 1234.5,
      canonical: '1234.5',
    });
  });

  it('does not rewrite an invalid draft on commit', () => {
    expect(commitLocalizedNumberDraft('12.34', quantityPolicy)).toEqual({
      draft: '12.34',
      ok: false,
      code: 'invalid_grouping',
    });
  });

  it('accepts an empty optional draft and rejects an empty required draft', () => {
    expect(inspectLocalizedNumberDraft('', quantityPolicy)).toEqual({
      draft: '',
      ok: true,
      value: null,
      canonical: null,
    });
    expect(inspectLocalizedNumberDraft('', quantityPolicy, { allowEmpty: false })).toEqual({
      draft: '',
      ok: false,
      code: 'empty',
    });
  });

  it('enforces scale, negative, minimum, and maximum policy during draft validation', () => {
    const bounded: DecimalPolicy = {
      kind: 'quantity',
      maxFractionDigits: 2,
      min: 1,
      max: 10,
      allowNegative: false,
    };

    expect(inspectLocalizedNumberDraft('1,001', bounded)).toMatchObject({
      ok: false,
      code: 'too_many_fraction_digits',
    });
    expect(inspectLocalizedNumberDraft('-1', bounded)).toMatchObject({
      ok: false,
      code: 'out_of_range',
    });
    expect(inspectLocalizedNumberDraft('0,5', bounded)).toMatchObject({
      ok: false,
      code: 'out_of_range',
    });
    expect(inspectLocalizedNumberDraft('10,01', bounded)).toMatchObject({
      ok: false,
      code: 'out_of_range',
    });
  });
});

describe('localized input primitives', () => {
  it('renders a decimal text input and exposes invalid draft state accessibly', () => {
    const html = renderToStaticMarkup(
      React.createElement(LocalizedNumberInput, {
        value: '1,',
        policy: quantityPolicy,
        onDraftChange: () => undefined,
        'aria-label': 'Số lượng',
      }),
    );

    expect(html).toContain('type="text"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('data-validation-code="invalid"');
  });

  it('uses zero fractional digits for VND unless a unit-price scale is provided', () => {
    const vndHtml = renderToStaticMarkup(
      React.createElement(LocalizedMoneyInput, {
        value: '1,25',
        onDraftChange: () => undefined,
        'aria-label': 'Giá trị VND',
      }),
    );
    const unitPriceHtml = renderToStaticMarkup(
      React.createElement(LocalizedMoneyInput, {
        value: '1,25',
        maxFractionDigits: 6,
        onDraftChange: () => undefined,
        'aria-label': 'Đơn giá',
      }),
    );

    expect(vndHtml).toContain('aria-invalid="true"');
    expect(vndHtml).toContain('data-validation-code="too_many_fraction_digits"');
    expect(unitPriceHtml).toContain('aria-invalid="false"');
    expect(unitPriceHtml).not.toContain('data-validation-code');
  });
});
