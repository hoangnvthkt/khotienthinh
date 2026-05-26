import React from 'react';
import { BusinessPartner } from '../types';
import SearchableSelect from './common/SearchableSelect';

interface SupplierComboboxProps {
  value?: string | null;
  suppliers: BusinessPartner[];
  onChange: (supplier: BusinessPartner | null) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  inputClassName?: string;
}

export default function SupplierCombobox({
  value,
  suppliers,
  onChange,
  placeholder = 'Gõ mã, tên NCC, MST, SĐT...',
  disabled,
  clearable = true,
  className,
  inputClassName,
}: SupplierComboboxProps) {
  return (
    <SearchableSelect
      value={value}
      options={suppliers}
      onChange={onChange}
      getOptionValue={supplier => supplier.id}
      getOptionLabel={supplier => `${supplier.code ? `${supplier.code} - ` : ''}${supplier.name}`}
      getOptionSearchText={supplier => [
        supplier.code,
        supplier.name,
        supplier.taxCode,
        supplier.phone,
        supplier.contactName,
        supplier.contactPhone,
        supplier.email,
      ].filter(Boolean).join(' ')}
      renderOption={supplier => (
        <div>
          <div className="font-black text-slate-800 dark:text-slate-100">
            {supplier.code ? `${supplier.code} - ` : ''}{supplier.name}
          </div>
          <div className="mt-0.5 text-[10px] font-semibold text-slate-400">
            {[supplier.taxCode ? `MST ${supplier.taxCode}` : '', supplier.phone, supplier.contactName].filter(Boolean).join(' • ') || 'Nhà cung cấp'}
          </div>
        </div>
      )}
      placeholder={placeholder}
      emptyLabel="Không tìm thấy NCC"
      disabled={disabled}
      clearable={clearable}
      className={className}
      inputClassName={inputClassName}
    />
  );
}
