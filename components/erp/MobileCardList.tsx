import React from 'react';

type MobileCardListProps<T> = {
  items: T[];
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
};

function MobileCardList<T>({ items, getKey, renderItem, className = '' }: MobileCardListProps<T>) {
  return (
    <div className={`grid grid-cols-1 gap-3 md:hidden ${className}`}>
      {items.map((item, index) => (
        <div key={getKey(item, index)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  );
}

export default MobileCardList;
