import React from 'react';
import { InventoryItem } from '../types';
import SearchableSelect from './common/SearchableSelect';

interface InventoryItemComboboxProps {
  value?: string | null;
  items: InventoryItem[];
  onChange: (item: InventoryItem | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}

export default function InventoryItemCombobox({
  value,
  items,
  onChange,
  placeholder = 'Gõ SKU, tên vật tư, nhóm...',
  disabled,
  className,
  inputClassName,
}: InventoryItemComboboxProps) {
  return (
    <SearchableSelect
      value={value}
      options={items}
      onChange={onChange}
      getOptionValue={item => item.id}
      getOptionLabel={item => `${item.sku} - ${item.name}`}
      getOptionSearchText={item => [
        item.sku,
        item.name,
        item.category,
        item.unit,
        item.purchaseUnit,
      ].filter(Boolean).join(' ')}
      renderOption={item => (
        <div>
          <div className="font-black text-slate-800 dark:text-slate-100">{item.sku} - {item.name}</div>
          <div className="mt-0.5 text-[10px] font-semibold text-slate-400">
            {item.category || 'Chưa phân nhóm'} • {item.unit}
          </div>
        </div>
      )}
      placeholder={placeholder}
      emptyLabel="Không tìm thấy vật tư"
      disabled={disabled}
      className={className}
      inputClassName={inputClassName}
    />
  );
}
