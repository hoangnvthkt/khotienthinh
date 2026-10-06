import React from 'react';
import { X } from 'lucide-react';

export interface CenterWorkTab {
  id: string;
  title: string;
  /** "Hôm nay" luôn mở; hồ sơ / thao tác mở thêm thì có nút ✕. */
  closable: boolean;
}

const WorkTabs: React.FC<{
  tabs: readonly CenterWorkTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}> = ({ tabs, activeId, onSelect, onClose }) => (
  <div className="vcc-wtabs" role="tablist" aria-label="Vùng làm việc" data-single={tabs.length === 1}>
    {tabs.map(tab => (
      <div key={tab.id} className="vcc-wtab" data-active={tab.id === activeId}>
        <button type="button" role="tab" aria-selected={tab.id === activeId} onClick={() => onSelect(tab.id)}>{tab.title}</button>
        {tab.closable && (
          <button type="button" className="vcc-wtab-x" aria-label={`Đóng ${tab.title}`} onClick={() => onClose(tab.id)}>
            <X size={12} />
          </button>
        )}
      </div>
    ))}
  </div>
);

export default WorkTabs;
