import type { DailyLogBaselineQuantityState, DailyLogEntryMode } from '../types';
import { parseQuantityInput } from './quantityInput';

export interface DailyLogEntryResult {
  valid: boolean;
  errorCode: string | null;
  cumulativePercent: number | null;
  cumulativeQuantity: number | null;
  dailyQuantity: number | null;
}
const invalid=(errorCode:string):DailyLogEntryResult=>({valid:false,errorCode,cumulativePercent:null,cumulativeQuantity:null,dailyQuantity:null});
const round=(value:number)=>Math.round((value+Number.EPSILON)*10000)/10000;

export const deriveDailyLogEntry = (input: {
  mode: DailyLogEntryMode;
  enteredValue: number | string | null | undefined;
  plannedQuantity: number | null;
  unit: string | null;
  previousCumulativeQuantity: number | null;
  baselineQuantityState: DailyLogBaselineQuantityState;
  allowOver100?: boolean;
}): DailyLogEntryResult => {
  const value=parseQuantityInput(input.enteredValue);
  if (!Number.isFinite(value)) return invalid('entry_required');
  if (value<0) return invalid('negative_entry');
  if (!['daily_quantity','cumulative_quantity','percent'].includes(input.mode)) return invalid('invalid_entry_mode');
  const hasBasis=Number.isFinite(input.plannedQuantity) && Number(input.plannedQuantity)>0 && Boolean(input.unit?.trim());
  if (!hasBasis) {
    if (input.mode!=='percent') return invalid('quantity_basis_required');
    if (!input.allowOver100 && value>100) return invalid('progress_above_allowed_maximum');
    return {valid:true,errorCode:null,cumulativePercent:round(value),cumulativeQuantity:null,dailyQuantity:null};
  }
  let previous:number|null=null;
  if (input.baselineQuantityState==='none') previous=0;
  else if (input.baselineQuantityState==='known') {
    if (!Number.isFinite(input.previousCumulativeQuantity) || Number(input.previousCumulativeQuantity)<0) return invalid('invalid_baseline');
    previous=input.previousCumulativeQuantity;
  }
  if (input.mode==='daily_quantity' && previous===null) return invalid('unknown_baseline');
  const planned=Number(input.plannedQuantity);
  const cumulative=input.mode==='daily_quantity' ? Number(previous)+value : input.mode==='percent' ? planned*value/100 : value;
  const percent=input.mode==='percent' ? value : cumulative/planned*100;
  if (!input.allowOver100 && percent>100) return invalid('progress_above_allowed_maximum');
  if (previous!==null && cumulative<previous) return invalid('progress_below_baseline');
  return {valid:true,errorCode:null,cumulativePercent:round(percent),cumulativeQuantity:round(cumulative),
    dailyQuantity:previous===null?null:round(cumulative-previous)};
};
