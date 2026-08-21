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
    <div className={`space-y-1 ${className}`.trim()}>
        <div className="flex items-center gap-2">
            <span className="sr-only">Mã vật tư</span>
            <input
                value={sku || 'CHƯA MÃ'}
                readOnly
                aria-readonly="true"
                title="Mã vật tư"
                className="w-28 shrink-0 rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 font-mono text-xs font-black text-slate-600 outline-none select-all"
            />
            <div className="relative flex-1 min-w-0">
                <span className="sr-only">Tên vật tư</span>
                <input
                    value={name}
                    disabled={disabled}
                    onChange={event => onNameChange(event.target.value)}
                    placeholder="Tên vật tư dùng trên chứng từ..."
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 disabled:cursor-not-allowed disabled:bg-slate-100"
                />
            </div>
        </div>
    </div>
);

export default MaterialCommercialDescriptionFields;
