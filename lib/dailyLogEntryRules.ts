import type { DailyLogBaselineQuantityState, DailyLogEntryMode } from '../types';
import { parseQuantityInput } from './quantityInput';
import { shortDailyLogDate as shortDate } from './dailyLogProgressIssues';

export interface DailyLogEntryResult {
  valid: boolean;
  errorCode: string | null;
  cumulativePercent: number | null;
  cumulativeQuantity: number | null;
  dailyQuantity: number | null;
}
const invalid=(errorCode:string):DailyLogEntryResult=>({valid:false,errorCode,cumulativePercent:null,cumulativeQuantity:null,dailyQuantity:null});
const round=(value:number)=>Math.round((value+Number.EPSILON)*10000)/10000;

export interface DailyLogApprovedBound { date: string; percent: number }
// Cùng ngưỡng với máy chủ (PROGRESS_BELOW_APPROVED / PROGRESS_ABOVE_APPROVED_LATER).
const outsideApproved=(percent:number,bounds:{approvedBefore?:DailyLogApprovedBound|null;approvedAfter?:DailyLogApprovedBound|null})=>
  bounds.approvedBefore && percent<Number(bounds.approvedBefore.percent)-0.0001 ? 'progress_below_approved'
  : bounds.approvedAfter && percent>Number(bounds.approvedAfter.percent)+0.0001 ? 'progress_above_approved_later' : null;
const pct=(value:number)=>`${Number(value).toLocaleString('vi-VN',{maximumFractionDigits:2})}%`;

/** Câu báo khi % nằm ngoài mốc đã ghi nhận; null nếu không phải lỗi mốc. */
export const approvedBoundMessage=(errorCode:string|null|undefined,bounds:{approvedBefore?:DailyLogApprovedBound|null;approvedAfter?:DailyLogApprovedBound|null}):string|null=>
  errorCode==='progress_below_approved' && bounds.approvedBefore
    ? `Thấp hơn ${pct(bounds.approvedBefore.percent)} đã ghi nhận ngày ${shortDate(bounds.approvedBefore.date)}. Lũy kế là tổng từ đầu, không được giảm.`
  : errorCode==='progress_above_approved_later' && bounds.approvedAfter
    ? `Vượt ${pct(bounds.approvedAfter.percent)} đã duyệt ngày ${shortDate(bounds.approvedAfter.date)} (ngày sau).` : null;

/** Mốc đã ghi nhận để kỹ sư biết khoảng hợp lệ trước khi nhập. */
export const approvedBoundHint=(bounds:{approvedBefore?:DailyLogApprovedBound|null;approvedAfter?:DailyLogApprovedBound|null}):string|null=>{
  const parts=[bounds.approvedBefore?`Đã ghi nhận ${pct(bounds.approvedBefore.percent)} (${shortDate(bounds.approvedBefore.date)})`:null,
    bounds.approvedAfter?`ngày sau ${shortDate(bounds.approvedAfter.date)}: ${pct(bounds.approvedAfter.percent)}`:null].filter(Boolean);
  return parts.length?parts.join(' · '):null;
};

export const deriveDailyLogEntry = (input: {
  mode: DailyLogEntryMode;
  enteredValue: number | string | null | undefined;
  plannedQuantity: number | null;
  unit: string | null;
  previousCumulativeQuantity: number | null;
  baselineQuantityState: DailyLogBaselineQuantityState;
  allowOver100?: boolean;
  /** Tiến độ hạng mục đã ghi nhận trước / sau ngày phiếu; chỉ truyền khi hạng mục chưa chia mũi (% phiếu = % hạng mục). */
  approvedBefore?: DailyLogApprovedBound | null;
  approvedAfter?: DailyLogApprovedBound | null;
}): DailyLogEntryResult => {
  const value=parseQuantityInput(input.enteredValue);
  if (!Number.isFinite(value)) return invalid('entry_required');
  if (value<0) return invalid('negative_entry');
  if (!['daily_quantity','cumulative_quantity','percent'].includes(input.mode)) return invalid('invalid_entry_mode');
  const hasBasis=Number.isFinite(input.plannedQuantity) && Number(input.plannedQuantity)>0 && Boolean(input.unit?.trim());
  if (!hasBasis) {
    if (input.mode!=='percent') return invalid('quantity_basis_required');
    if (!input.allowOver100 && value>100) return invalid('progress_above_allowed_maximum');
    const bound=outsideApproved(value,input);
    if (bound) return invalid(bound);
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
  const bound=outsideApproved(percent,input);
  if (bound) return invalid(bound);
  return {valid:true,errorCode:null,cumulativePercent:round(percent),cumulativeQuantity:round(cumulative),
    dailyQuantity:previous===null?null:round(cumulative-previous)};
};
