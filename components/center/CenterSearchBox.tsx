import React from 'react';
import { Search } from 'lucide-react';
import { openGlobalSearch, searchShortcutLabel } from '../../lib/search/openGlobalSearch';

// Ô Tìm kiếm toàn hệ thống giữa đầu trang Hôm nay. Bấm (hoặc gõ ngay khi ô đang chọn) → mở hộp tìm kiếm
// với chữ vừa gõ. Hiệu ứng: viền chuyển màu nhẹ, ánh sáng lướt qua 2 lần khi mở trang rồi đứng yên.
const CenterSearchBox: React.FC = () => (
  <button
    type="button"
    className="vcc-search"
    onClick={() => openGlobalSearch()}
    onKeyDown={event => {
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        openGlobalSearch(event.key);
      }
    }}
    aria-label="Tìm kiếm chức năng, hồ sơ, người, mã phiếu"
  >
    <span className="vcc-search-icon"><Search size={17} /></span>
    <span className="vcc-search-text">Tìm chức năng, hồ sơ, người, mã phiếu…</span>
    <kbd className="vcc-search-kbd">{searchShortcutLabel()}</kbd>
  </button>
);

export default CenterSearchBox;
