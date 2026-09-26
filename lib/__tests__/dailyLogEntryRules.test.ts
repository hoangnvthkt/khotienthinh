import { describe, expect, it } from 'vitest';
import { deriveDailyLogEntry } from '../dailyLogEntryRules';

const basis={plannedQuantity:100,unit:'m³',previousCumulativeQuantity:40,baselineQuantityState:'known' as const};
describe('Daily Log single quantity entry', () => {
  it('daily_entry_preserves_cumulative_semantics', () => {
    expect(deriveDailyLogEntry({mode:'daily_quantity',enteredValue:12,...basis})).toEqual({valid:true,errorCode:null,
      cumulativePercent:52,cumulativeQuantity:52,dailyQuantity:12});
  });
  it('derives equivalent cumulative and percent entries with one authoritative input', () => {
    for (const mode of ['cumulative_quantity','percent'] as const) {
      expect(deriveDailyLogEntry({mode,enteredValue:52,...basis})).toMatchObject({valid:true,cumulativePercent:52,cumulativeQuantity:52,dailyQuantity:12});
    }
  });
  it('reuses Vietnamese decimal parsing without turning blank into zero', () => {
    expect(deriveDailyLogEntry({mode:'daily_quantity',enteredValue:'12,5',...basis})).toMatchObject({valid:true,cumulativeQuantity:52.5,dailyQuantity:12.5});
    for (const enteredValue of ['', ' ',null, undefined,Number.NaN,Infinity,'abc']) {
      expect(deriveDailyLogEntry({mode:'daily_quantity',enteredValue,...basis})).toMatchObject({valid:false,cumulativeQuantity:null,dailyQuantity:null});
    }
    expect(deriveDailyLogEntry({mode:'daily_quantity',enteredValue:0,...basis})).toMatchObject({valid:true,cumulativeQuantity:40,dailyQuantity:0});
  });
  it('uses zero only when no prior official row exists and a quantity basis is known', () => {
    expect(deriveDailyLogEntry({mode:'daily_quantity',enteredValue:12,...basis,previousCumulativeQuantity:null,baselineQuantityState:'none'}))
      .toMatchObject({valid:true,cumulativeQuantity:12,dailyQuantity:12});
    expect(deriveDailyLogEntry({mode:'daily_quantity',enteredValue:12,...basis,previousCumulativeQuantity:null,baselineQuantityState:'unknown'}))
      .toMatchObject({valid:false,errorCode:'unknown_baseline',dailyQuantity:null});
  });
  it('preserves unknown daily quantity for cumulative or percent entries with an unknown baseline', () => {
    for(const mode of ['cumulative_quantity','percent'] as const) {
      expect(deriveDailyLogEntry({mode,enteredValue:52,...basis,previousCumulativeQuantity:null,baselineQuantityState:'unknown'}))
        .toMatchObject({valid:true,cumulativePercent:52,cumulativeQuantity:52,dailyQuantity:null});
    }
  });
  it('only permits percent without a real unit and positive finite planned quantity', () => {
    for (const missing of [{unit:null},{unit:' '},{plannedQuantity:null},{plannedQuantity:0},{plannedQuantity:-5},{plannedQuantity:Infinity}]) {
      expect(deriveDailyLogEntry({mode:'percent',enteredValue:30,...basis,...missing}))
        .toMatchObject({valid:true,cumulativePercent:30,cumulativeQuantity:null,dailyQuantity:null});
      for (const mode of ['daily_quantity','cumulative_quantity'] as const) {
        expect(deriveDailyLogEntry({mode,enteredValue:12,...basis,...missing}))
          .toMatchObject({valid:false,errorCode:'quantity_basis_required'});
      }
    }
  });
  it('rejects negative, below-baseline, invalid known baseline and excess rather than clamping', () => {
    expect(deriveDailyLogEntry({mode:'daily_quantity',enteredValue:-1,...basis})).toMatchObject({valid:false,errorCode:'negative_entry'});
    expect(deriveDailyLogEntry({mode:'cumulative_quantity',enteredValue:39,...basis})).toMatchObject({valid:false,errorCode:'progress_below_baseline'});
    expect(deriveDailyLogEntry({mode:'percent',enteredValue:39,...basis})).toMatchObject({valid:false,errorCode:'progress_below_baseline'});
    expect(deriveDailyLogEntry({mode:'daily_quantity',enteredValue:61,...basis})).toMatchObject({valid:false,errorCode:'progress_above_allowed_maximum'});
    for (const previousCumulativeQuantity of [null,Number.NaN,-1]) {
      expect(deriveDailyLogEntry({mode:'daily_quantity',enteredValue:12,...basis,previousCumulativeQuantity}))
        .toMatchObject({valid:false,errorCode:'invalid_baseline'});
    }
  });
  it('rounds derived physical quantities consistently without corrupting decimals', () => {
    expect(deriveDailyLogEntry({mode:'daily_quantity',enteredValue:'0,1',plannedQuantity:3,unit:'m',previousCumulativeQuantity:0.2,baselineQuantityState:'known'}))
      .toMatchObject({valid:true,cumulativePercent:10,cumulativeQuantity:0.3,dailyQuantity:0.1});
  });
  it('does not let rounding tolerance turn a below-baseline entry into negative physical usage', () => {
    expect(deriveDailyLogEntry({mode:'cumulative_quantity',enteredValue:39.99995,...basis}))
      .toMatchObject({valid:false,errorCode:'progress_below_baseline'});
    expect(deriveDailyLogEntry({mode:'percent',enteredValue:100.00001,...basis}))
      .toMatchObject({valid:false,errorCode:'progress_above_allowed_maximum'});
  });
  it('preserves the existing leaf-task rule allowing progress above 100 only when authorized', () => {
    expect(deriveDailyLogEntry({mode:'percent',enteredValue:110,...basis,allowOver100:true}))
      .toMatchObject({valid:true,cumulativePercent:110,cumulativeQuantity:110,dailyQuantity:70});
    expect(deriveDailyLogEntry({mode:'percent',enteredValue:110,...basis,allowOver100:false})).toMatchObject({valid:false});
  });
});
