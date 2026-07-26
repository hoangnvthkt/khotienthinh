import type { PurchaseMode } from '../../types';

interface PurchaseModeControlProps {
  value: PurchaseMode;
  disabled?: boolean;
  onChange(value: PurchaseMode): void;
}

const options: Array<{ value: PurchaseMode; label: string }> = [
  { value: 'single', label: 'Mua và giao một lần' },
  { value: 'multiple', label: 'Chia nhiều đợt' },
];

export default function PurchaseModeControl({
  value,
  disabled = false,
  onChange,
}: PurchaseModeControlProps) {
  return (
    <div role="group" aria-label="Cách đặt hàng" className="inline-flex rounded-md border border-slate-200 bg-white p-1">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`px-3 py-1.5 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${
            value === option.value
              ? 'rounded bg-slate-900 text-white'
              : 'rounded text-slate-600 hover:bg-slate-100'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
