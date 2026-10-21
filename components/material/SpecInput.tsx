import React, { useEffect, useId, useState } from 'react';
import { itemSpecService, matchItemSpec, specSizeConflict, type ItemSpecOption } from '../../lib/itemSpecService';

// Ô Quy cách dùng chung cho mọi chứng từ: gợi ý danh sách quy cách chuẩn của mã, gõ khác cách viết thì tự đổi về đúng tên
// ("hoa phat cb 300" → "Hòa Phát CB300"), quy cách chưa có → nhãn "mới" (không chặn — người Cấp mã rà sau).

export const useItemSpecOptions = (itemId?: string | null) => {
  const [options, setOptions] = useState<ItemSpecOption[]>([]);
  useEffect(() => {
    let live = true;
    if (!itemId) { setOptions([]); return; }
    itemSpecService.options(itemId).then(o => { if (live) setOptions(o); }).catch(() => { if (live) setOptions([]); });
    return () => { live = false; };
  }, [itemId]);
  return options;
};

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  itemId?: string | null;
  itemName?: string;
  value: string;
  onChange: (value: string) => void;
  /** Ẩn dòng gợi ý dưới ô (khi dòng đã có chỗ báo lỗi riêng). */
  hideHint?: boolean;
};

export const SpecInput: React.FC<Props> = ({ itemId, itemName, value, onChange, hideHint, onBlur, ...rest }) => {
  const options = useItemSpecOptions(itemId);
  const listId = useId();
  const text = value.trim();
  const hit = text ? matchItemSpec(options, text) : null;
  const size = text && itemName ? specSizeConflict(itemName, text) : null;
  const hint = !text || hideHint ? null
    : size ? <span className="text-amber-700 dark:text-amber-300">{size}</span>
    : hit ? (hit.status === 'pending' ? <span className="text-muted-foreground">Quy cách mới, đang chờ người Cấp mã rà</span> : null)
    : options.length || itemId ? <span className="text-muted-foreground"><b className="font-semibold text-teal-700 dark:text-teal-300">mới</b> — người Cấp mã sẽ rà{options.length ? `; mã đã có ${options.length} quy cách, gõ để chọn` : ''}</span>
    : null;
  return <>
    <input {...rest} value={value} list={options.length ? listId : undefined}
      onChange={e => onChange(e.target.value)}
      onBlur={e => { if (hit && hit.name !== text) onChange(hit.name); onBlur?.(e); }} />
    {options.length > 0 && <datalist id={listId}>{options.map(o => <option key={o.id} value={o.name}>{o.status === 'pending' ? 'mới, chờ rà' : ''}</option>)}</datalist>}
    {hint && <span className="mt-0.5 block w-full text-[11px] leading-snug">{hint}</span>}
  </>;
};
