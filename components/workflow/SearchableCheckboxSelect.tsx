import React, { useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';

export interface SearchableCheckboxSelectProps {
    options: { id: string; label: string; sublabel?: string }[];
    selectedValues: string[];
    onChange: (values: string[]) => void;
    placeholder?: string;
    maxHeightClass?: string;
}

/** Search + multi-check list used by the Quy trình builder and the project step editor. */
const SearchableCheckboxSelect: React.FC<SearchableCheckboxSelectProps> = ({
    options,
    selectedValues,
    onChange,
    placeholder = 'Tìm kiếm...',
    maxHeightClass = 'h-36',
}) => {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredOptions = options.filter(opt => {
        return matchesSearchQueryMultiple([opt.label, opt.sublabel], searchTerm);
    });

    const handleToggle = (id: string) => {
        if (selectedValues.includes(id)) {
            onChange(selectedValues.filter(val => val !== id));
        } else {
            onChange([...selectedValues, id]);
        }
    };

    const handleSelectAll = () => {
        const filteredIds = filteredOptions.map(opt => opt.id);
        const allFilteredSelected = filteredIds.every(id => selectedValues.includes(id));
        if (allFilteredSelected) {
            onChange(selectedValues.filter(id => !filteredIds.includes(id)));
        } else {
            onChange(Array.from(new Set([...selectedValues, ...filteredIds])));
        }
    };

    const isAllFilteredSelected = filteredOptions.length > 0 && filteredOptions.every(opt => selectedValues.includes(opt.id));

    return (
        <div className="flex flex-col border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white/80 dark:bg-slate-800/50 focus-within:ring-2 focus-within:ring-indigo-200 transition">
            {/* Search Bar */}
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-700/50 px-3 py-2 bg-slate-50/50 dark:bg-slate-800/30">
                <Search size={14} className="text-slate-400 shrink-0" />
                <input
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    className="w-full bg-transparent border-none outline-none text-xs text-slate-700 dark:text-slate-300 placeholder-slate-400 font-medium"
                />
                {searchTerm && (
                    <button
                        type="button"
                        onClick={() => setSearchTerm('')}
                        aria-label="Xóa tìm kiếm"
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition p-0.5 rounded"
                    >
                        <X size={12} />
                    </button>
                )}
            </div>

            {/* Quick Actions */}
            {filteredOptions.length > 0 && (
                <div className="flex justify-between items-center px-3 py-1 bg-slate-50/20 dark:bg-slate-800/10 border-b border-slate-100 dark:border-slate-700/30 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    <span>Kết quả: {filteredOptions.length}</span>
                    <button
                        type="button"
                        onClick={handleSelectAll}
                        className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 transition"
                    >
                        {isAllFilteredSelected ? 'Bỏ chọn hết' : 'Chọn tất cả'}
                    </button>
                </div>
            )}

            {/* Options List */}
            <div className={`overflow-y-auto divide-y divide-slate-100/50 dark:divide-slate-700/30 ${maxHeightClass} custom-scrollbar`}>
                {filteredOptions.length > 0 ? (
                    filteredOptions.map(opt => {
                        const isSelected = selectedValues.includes(opt.id);
                        return (
                            <div
                                key={opt.id}
                                role="checkbox"
                                aria-checked={isSelected}
                                tabIndex={0}
                                onClick={() => handleToggle(opt.id)}
                                onKeyDown={event => {
                                    if (event.key === ' ' || event.key === 'Enter') {
                                        event.preventDefault();
                                        handleToggle(opt.id);
                                    }
                                }}
                                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition text-xs select-none ${
                                    isSelected
                                        ? 'bg-indigo-50/40 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 font-bold'
                                        : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/30 text-slate-600 dark:text-slate-300 font-medium'
                                }`}
                            >
                                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${
                                    isSelected
                                        ? 'border-indigo-500 bg-indigo-500 text-white shadow-sm shadow-indigo-500/20'
                                        : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-transparent'
                                }`}>
                                    <Check size={11} className="stroke-[3]" />
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="truncate">{opt.label}</span>
                                    {opt.sublabel && (
                                        <span className={`text-[10px] truncate ${isSelected ? 'text-indigo-400 dark:text-indigo-500' : 'text-slate-400'}`}>
                                            {opt.sublabel}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="px-3 py-4 text-center text-xs text-slate-400 font-semibold">
                        Không tìm thấy kết quả phù hợp
                    </div>
                )}
            </div>
        </div>
    );
};

export default SearchableCheckboxSelect;
