import React, { useState } from 'react';
import { StateBox } from '../procurement/hub/hubUi';

type InboxTab = 'mine' | 'sent' | 'watch';

const TABS: ReadonlyArray<{ id: InboxTab; label: string }> = [
  { id: 'mine', label: 'Chờ tôi' },
  { id: 'sent', label: 'Tôi gửi' },
  { id: 'watch', label: 'Theo dõi' },
];

// PR-A: khung cột "Việc của tôi". Nguồn việc (vcc_my_work_items_v1) nối ở PR-B — tới lúc đó
// không hiện số đếm và không nói "không có việc", vì việc thật vẫn đang chờ trong từng module.
const InboxPanel: React.FC<{ hidden: boolean; onOpenHome: () => void }> = ({ hidden, onOpenHome }) => {
  const [tab, setTab] = useState<InboxTab>('mine');
  return (
    <aside className="vcc-inbox" data-hidden={hidden} aria-label="Việc của tôi">
      <div className="vcc-tabs" role="tablist" aria-label="Nhóm việc">
        {TABS.map(item => (
          <button key={item.id} type="button" role="tab" className="vcc-tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="vcc-scroll p-3" role="tabpanel">
        <StateBox
          kind="empty"
          title="Đang nối nguồn việc"
          message="Việc chờ bạn ở mọi module sẽ gom về đây. Hiện việc vẫn nằm ở trang Hôm nay và trong từng module."
        />
        <div className="mt-3 flex justify-center">
          <button type="button" className="vcc-btn" onClick={onOpenHome}>Xem việc ở trang Hôm nay</button>
        </div>
      </div>
      <div className="vcc-foot">Lấy từ phân công thật của từng module. Thông báo không tính là việc.</div>
    </aside>
  );
};

export default InboxPanel;
