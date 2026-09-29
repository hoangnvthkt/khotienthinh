import React from 'react';
import type {DailyLogWorkItem} from '../../../types';
import type {SummaryResourceLine} from './DailyLogAreaCard';
import {formatDailyLogDate,formatDailyLogQuantity} from '../../../lib/dailyLogPresentation';
import {DailyLogPhotoStrip} from './DailyLogPhotoStrip';

interface Props {items:DailyLogWorkItem[];resources:SummaryResourceLine[];mode:'review'|'verified'}
// Read model deliberately has no mutation callbacks.
export function DailyLogWorkItemReadTable({items,resources,mode}:Props) {
  const details=(item:DailyLogWorkItem)=><div className="space-y-3 py-2">
    {resources.filter(line=>line.dailyLogWorkItemId===item.id || line.dailyLogWorkItemId===item.sourceWorkItemId).map((line,index)=><div key={line.id || index} data-resource-kind={line.kind} className="rounded-md border border-border p-3">
      <p className="font-medium">{line.label} · {formatDailyLogQuantity(line.count,line.kind==='labor'?'người':'máy')} · {formatDailyLogQuantity(line.totalHours,'giờ')}</p>
      <p className="mt-1 break-words">{line.providerName}</p><p className="mt-1 text-xs text-muted-foreground">{line.providerType} · {line.providerEntryMode==='catalog'?'Danh mục':'Nhập tay'}</p>
    </div>)}
    {item.forecastFinishDate && <p>Dự kiến hoàn thành: {formatDailyLogDate(item.forecastFinishDate)}{item.forecastChangeReason && ` · ${item.forecastChangeReason}`}</p>}
    {item.note && <p className="whitespace-pre-wrap break-words">{item.note}</p>}
    {item.attachments?.length ? <DailyLogPhotoStrip photos={item.attachments} label="Ảnh hạng mục" />:null}
  </div>;
  const unknown=items.some(item=>!item.unit?.trim());
  return <div className="daily-log-work-report space-y-3 text-sm">
    {unknown && <p className="rounded-md border border-border bg-muted/30 p-3">Có hạng mục chưa có đơn vị tính, nên chỉ hiển thị % hoàn thành; hệ thống không tự quy đổi khối lượng.</p>}
    {items.length===0 && <p className="text-muted-foreground">Chưa có hạng mục được lưu trong phiếu này.</p>}
    <div className="hidden overflow-x-auto rounded-md border border-border md:block">
      <table className="w-full table-fixed border-collapse text-sm"><colgroup><col className="w-[40%]"/><col/><col/><col/></colgroup><thead className="bg-muted/40"><tr>
        <th scope="col" className="p-3 text-left font-medium">Hạng mục / ĐVT</th>
        {['Khối lượng hôm nay','Lũy kế','% lũy kế'].map(label=><th key={label} scope="col" className="p-3 text-right font-medium break-words">{label}</th>)}
      </tr></thead>{items.map(item=><tbody key={item.id || item.sourceWorkItemId} data-work-item-id={item.sourceWorkItemId || item.id} className="border-t border-border">
        <tr><th scope="row" className="p-3 text-left font-medium break-words"><span>{item.wbsCode} {item.taskName}</span><p className="mt-1 font-normal text-muted-foreground">{item.unit?.trim() || 'Chưa xác định đơn vị'}</p></th>
          <td className="p-3 text-right tabular-nums break-words">{formatDailyLogQuantity(item.dailyQuantityDone,item.unit)}</td>
          <td className="p-3 text-right tabular-nums break-words">{formatDailyLogQuantity(item.cumulativeQuantityDone,item.unit)}</td>
          <td className="p-3 text-right tabular-nums break-words">{formatDailyLogQuantity(item.cumulativeProgressPercent,'%')}</td></tr>
        <tr><td colSpan={4} className="px-3 pb-3"><details><summary className="min-h-11 cursor-pointer py-2 font-medium text-teal-800 dark:text-teal-200">Nguồn lực, ghi chú và ảnh</summary>{details(item)}</details></td></tr>
      </tbody>)}</table>
    </div>
    <div className="space-y-4 md:hidden">{items.map(item=><article key={item.id || item.sourceWorkItemId} data-work-item-id={item.sourceWorkItemId || item.id} className="space-y-3 rounded-md border border-border p-3">
      <h4 className="font-semibold">{item.wbsCode} {item.taskName}</h4><p className="text-muted-foreground">ĐVT: {item.unit?.trim() || 'Chưa xác định đơn vị'}</p>
      <dl className="grid grid-cols-2 gap-3 tabular-nums">{[
        ['Khối lượng hôm nay',formatDailyLogQuantity(item.dailyQuantityDone,item.unit)],['Lũy kế',formatDailyLogQuantity(item.cumulativeQuantityDone,item.unit)],['% lũy kế',formatDailyLogQuantity(item.cumulativeProgressPercent,'%')],
      ].map(([label,value])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1">{value}</dd></div>)}</dl>
      <details><summary className="min-h-11 cursor-pointer py-2 font-medium text-teal-800 dark:text-teal-200">Nguồn lực, ghi chú và ảnh</summary>{details(item)}</details>
    </article>)}</div>
  </div>;
}
