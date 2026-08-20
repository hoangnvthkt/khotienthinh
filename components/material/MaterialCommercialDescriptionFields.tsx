import React from 'react';

type MaterialCommercialDescriptionFieldsProps = {
    sku?: string;
    name: string;
    disabled?: boolean;
    className?: string;
    onNameChange: (value: string) => void;
};

const MaterialCommercialDescriptionFields: React.FC<MaterialCommercialDescriptionFieldsProps> = ({
    sku,
    name,
    disabled = false,
    className = '',
    onNameChange,
}) => (
    <div className={`space-y-2 ${className}`.trim()}>
        <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Mã vật tư</span>
            <input
                value={sku || 'CHƯA MÃ'}
                readOnly
                aria-readonly="true"
                className="w-full cursor-default rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm font-bold text-muted-foreground outline-none"
            />
        </label>
        <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Tên vật tư</span>
            <input
                value={name}
                disabled={disabled}
                onChange={event => onNameChange(event.target.value)}
                placeholder="Nhập tên vật tư dùng trên chứng từ"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:bg-muted"
            />
        </label>
    </div>
);

export default MaterialCommercialDescriptionFields;
