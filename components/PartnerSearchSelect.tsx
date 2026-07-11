import React, { useMemo } from 'react';
import { BusinessPartner } from '../types';
import SearchableSelect from './common/SearchableSelect';

const LEGACY_PARTNER_VALUE = '__legacy_counterparty_snapshot__';

type PartnerSearchOption =
  | { kind: 'legacy'; value: string; name: string }
  | { kind: 'partner'; partner: BusinessPartner };

interface PartnerSearchSelectProps {
  value?: string | null;
  partners: BusinessPartner[];
  legacyName?: string | null;
  onChange: (partner: BusinessPartner | null) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  inputClassName?: string;
}

const partnerLabel = (partner: BusinessPartner) =>
  [partner.code, partner.name].filter(Boolean).join(' - ') || partner.name || 'Đối tác';

export default function PartnerSearchSelect({
  value,
  partners,
  legacyName,
  onChange,
  placeholder = 'Gõ mã, tên đối tác, MST, SĐT...',
  disabled,
  clearable = true,
  className,
  inputClassName,
}: PartnerSearchSelectProps) {
  const legacyLabel = legacyName?.trim();
  const options = useMemo<PartnerSearchOption[]>(() => {
    const rows: PartnerSearchOption[] = partners.map(partner => ({ kind: 'partner', partner }));
    const hasSelectedPartner = Boolean(value && partners.some(partner => partner.id === value));
    if (legacyLabel && !hasSelectedPartner) {
      rows.unshift({ kind: 'legacy', value: value || LEGACY_PARTNER_VALUE, name: legacyLabel });
    }
    return rows;
  }, [legacyLabel, partners, value]);

  return (
    <SearchableSelect
      value={value || (legacyLabel ? LEGACY_PARTNER_VALUE : '')}
      options={options}
      onChange={option => {
        if (!option) {
          onChange(null);
          return;
        }
        if (option.kind === 'partner') onChange(option.partner);
      }}
      getOptionValue={option => option.kind === 'legacy' ? option.value : option.partner.id}
      getOptionLabel={option => option.kind === 'legacy' ? `${option.name} (chưa link danh mục)` : partnerLabel(option.partner)}
      getOptionSearchText={option => {
        if (option.kind === 'legacy') return option.name;
        const partner = option.partner;
        return [
          partner.code,
          partner.name,
          partner.taxCode,
          partner.phone,
          partner.contactName,
          partner.contactPhone,
          partner.email,
        ].filter(Boolean).join(' ');
      }}
      renderOption={option => {
        if (option.kind === 'legacy') {
          return (
            <div>
              <div className="font-black text-slate-800 dark:text-slate-100">{option.name}</div>
              <div className="mt-0.5 text-[10px] font-semibold text-slate-400">Chưa link danh mục đối tác</div>
            </div>
          );
        }
        const partner = option.partner;
        return (
          <div>
            <div className="font-black text-slate-800 dark:text-slate-100">{partnerLabel(partner)}</div>
            <div className="mt-0.5 text-[10px] font-semibold text-slate-400">
              {[partner.taxCode ? `MST ${partner.taxCode}` : '', partner.phone, partner.contactName].filter(Boolean).join(' • ') || 'Đối tác'}
            </div>
          </div>
        );
      }}
      placeholder={placeholder}
      emptyLabel="Không tìm thấy đối tác"
      disabled={disabled}
      clearable={clearable}
      className={className}
      inputClassName={inputClassName}
    />
  );
}
