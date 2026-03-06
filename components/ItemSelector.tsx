import React, { useState, useRef, useEffect } from 'react';
import { InventoryItem } from '../types';
import { Search, Package } from 'lucide-react';

interface ItemSelectorProps {
    items: InventoryItem[];
    value: string;
    onChange: (itemId: string) => void;
    sourceWarehouseId?: string;
}

const ItemSelector: React.FC<ItemSelectorProps> = ({ items, value, onChange, sourceWarehouseId }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    const selectedItem = items.find(i => i.id === value);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredItems = items.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="relative w-full" ref={wrapperRef}>
            <div
                className="w-full bg-slate-50 border border-slate-200 p-2 rounded-lg cursor-pointer flex justify-between items-center hover:bg-slate-100 transition-colors"
                onClick={() => setIsOpen(!isOpen)}
            >
                {selectedItem ? (
                    <div className="flex flex-col">
                        <span className="font-bold text-slate-800 text-sm whitespace-normal">{selectedItem.name}</span>
                        <span className="text-[10px] uppercase text-slate-400 font-mono font-bold tracking-widest leading-tight">{selectedItem.sku}</span>
                    </div>
                ) : (
                    <span className="text-sm text-slate-400 italic">Nhấn để tìm & chọn vật tư...</span>
                )}
            </div>

            {isOpen && (
                <div className="absolute z-[100] w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="p-2 border-b border-slate-100 bg-slate-50 relative">
                        <Search size={14} className="absolute left-4 top-4 text-slate-400" />
                        <input
                            type="text"
                            autoFocus
                            placeholder="Gõ tên hoặc mã SKU để tìm..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-sm bg-white border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-accent"
                        />
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                        {filteredItems.length > 0 ? (
                            filteredItems.map(item => {
                                const stock = sourceWarehouseId ? (item.stockByWarehouse[sourceWarehouseId] || 0) : 0;
                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => {
                                            onChange(item.id);
                                            setIsOpen(false);
                                            setSearchTerm('');
                                        }}
                                        className={`p-3 flex justify-between items-center cursor-pointer border-b last:border-0 border-slate-50 hover:bg-blue-50 transition-colors ${value === item.id ? 'bg-blue-50/50' : ''}`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                                                <Package size={14} className="text-slate-400" />
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="font-bold text-slate-800 text-sm">{item.name}</span>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[10px] text-slate-400 font-mono font-bold bg-slate-100 px-1.5 py-0.5 rounded">{item.sku}</span>
                                                    <span className="text-xs text-slate-500">• {item.category}</span>
                                                </div>
                                            </div>
                                        </div>
                                        {sourceWarehouseId && (
                                            <div className="flex flex-col items-end">
                                                <span className="text-[10px] text-slate-400 uppercase font-black tracking-widest">Tồn kho</span>
                                                <span className={`text-sm font-black ${stock > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                                    {stock} {item.unit}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="p-4 text-center text-sm text-slate-500 italic">
                                Không tìm thấy vật tư phù hợp
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ItemSelector;
