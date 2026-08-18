import React from 'react';

type MaterialCommercialDescriptionFieldsProps = {
    sku?: string;
    catalogName?: string;
    name: string;
    specification?: string;
    disabled?: boolean;
    nameLabel?: string;
    className?: string;
    onNameChange: (value: string) => void;
    onSpecificationChange: (value: string) => void;
};

const MaterialCommercialDescriptionFields: React.FC<MaterialCommercialDescriptionFieldsProps> = ({
    sku,
    catalogName,
    name,
    specification = '',
    disabled = false,
    nameLabel = 'Tên trên chứng từ',
    className = '',
    onNameChange,
    onSpecificationChange,
}) => (
    <div className={`space-y-2 ${className}`.trim()}>
        <div className="rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2 text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
            <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{sku || 'CHƯA MÃ'}</span>
            {catalogName && <span className="ml-2">Danh mục: {catalogName}</span>}
        </div>
        <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{nameLabel}</span>
            <input
                value={name}
                disabled={disabled}
                onChange={event => onNameChange(event.target.value)}
                placeholder="Nhập tên vật tư dùng trên chứng từ"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:bg-muted"
            />
        </label>
        <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Quy cách / mô tả</span>
            <input
                value={specification}
                disabled={disabled}
                onChange={event => onSpecificationChange(event.target.value)}
                placeholder="Ví dụ: D32, PN20, màu xanh..."
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:bg-muted"
            />
        </label>
    </div>
);

export default MaterialCommercialDescriptionFields;
