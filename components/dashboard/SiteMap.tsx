import React, { useState } from 'react';
import { MapPin } from 'lucide-react';

// Bản đồ nhỏ vị trí công trường (tọa độ chấm công GPS của công trường). Ghép 3×3 ô ảnh nền OpenStreetMap (không cần
// khóa, ghi nguồn theo quy định OSM), không cần thư viện bản đồ; ảnh tải lười. Chưa có tọa độ thì nói rõ, không đặt ghim sai.
const ZOOM = 14;
const TILE = 256;

const tileOf = (lat: number, lng: number) => {
  const n = 2 ** ZOOM;
  const rad = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n };
};

const SiteMap: React.FC<{ lat: number | null; lng: number | null; label: string }> = ({ lat, lng, label }) => {
  // Mạng chặn máy chủ bản đồ → nền trung tính, vẫn có ghim + "Mở bản đồ".
  const [failed, setFailed] = useState(false);
  if (lat == null || lng == null) {
    return (
      <div className="vdb-map" aria-label={`Bản đồ ${label}`}>
        <div className="vdb-map-empty">Công trường chưa có tọa độ.<br />HR cập nhật ở Danh mục công trường (dùng cho chấm công GPS).</div>
      </div>
    );
  }
  const { x, y } = tileOf(lat, lng);
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const pinX = TILE + (x - cx) * TILE;
  const pinY = TILE + (y - cy) * TILE;
  const tiles = [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => ({ dx, dy })));
  return (
    <div className="vdb-map" aria-label={`Bản đồ ${label}`}>
      {failed && <div className="vdb-map-empty" style={{ alignItems: 'end', paddingBottom: 26 }}>Chưa tải được nền bản đồ</div>}
      <div className="vdb-map-tiles" style={{ left: `calc(50% - ${pinX}px)`, top: `calc(55% - ${pinY}px)`, display: failed ? 'none' : undefined }} aria-hidden="true">
        {tiles.map(({ dx, dy }) => (
          <img key={`${dx}:${dy}`} alt="" loading="lazy" decoding="async" draggable={false} referrerPolicy="strict-origin-when-cross-origin" onError={() => setFailed(true)}
            src={`https://tile.openstreetmap.org/${ZOOM}/${cx + dx}/${cy + dy}.png`} />
        ))}
      </div>
      <span className="vdb-map-pin" style={{ left: '50%', top: '55%' }}><MapPin size={30} fill="currentColor" stroke="#fff" strokeWidth={1.5} /></span>
      <a className="vdb-map-open" href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">Mở bản đồ</a>
      <span className="vdb-map-attr">© OpenStreetMap</span>
    </div>
  );
};

export default SiteMap;
