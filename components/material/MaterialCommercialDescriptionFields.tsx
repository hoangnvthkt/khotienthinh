import React from 'react';

type MaterialCommercialDescriptionFieldsProps = {
    sku?: string;
    name: string;
    disabled?: boolean;
    className?: string;
    onNameChange: (value: string) => void;
    /** Quy cách của dòng (một mã nhiều quy cách). Không truyền onSpecificationChange thì không hiện ô. */
    specification?: string;
    onSpecificationChange?: (value: string) => void;
    /** Mã có từ 2 dòng trong phiếu: quy cách bắt buộc và khác nhau. */
    specificationProblem?: string;
};

const MaterialCommercialDescriptionFields: React.FC<MaterialCommercialDescriptionFieldsProps> = ({
    sku,
    name,
    disabled = false,
    className = '',
    onNameChange,
    specification = '',
    onSpecificationChange,
    specificationProblem,
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
        {onSpecificationChange && (
            <div>
                <span className="sr-only">Quy cách</span>
                <input
                    value={specification}
                    disabled={disabled}
                    maxLength={160}
                    onChange={event => onSpecificationChange(event.target.value)}
                    placeholder="Quy cách / ghi chú — VD: loại 1, tôn biên 13 sóng"
                    aria-invalid={!!specificationProblem}
                    className={`w-full rounded-lg border bg-white px-2.5 py-1 text-xs text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 ${specificationProblem ? 'border-rose-400 ring-2 ring-rose-400/20' : 'border-slate-200'}`}
                />
                {specificationProblem && <p className="mt-0.5 text-[10px] font-bold text-rose-600">{specificationProblem}</p>}
            </div>
        )}
    </div>
);

export default MaterialCommercialDescriptionFields;
