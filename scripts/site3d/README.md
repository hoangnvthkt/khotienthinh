# Công trường 3D — chuẩn bị mô hình

Tab **Công trường 3D** (Trung tâm điều hành) đọc mô hình ở kho Supabase riêng tư `site-models`:

| Đường dẫn | Nội dung |
|---|---|
| `<project_id>/architecture.glb` | Mô hình thiết kế (SketchUp → GLB nén meshopt). Tên khối `PART\|loại\|tầng\|ô trục` để bật theo tiến độ. |
| `<project_id>/structure.glb` | Kết cấu thép (Tekla IFC → GLB). Tên khối `TK\|giai đoạn\|bước trục`. |

Admin tải lên bằng nút **Mô hình** trong tab (tối đa 60 MB / tệp). Thiết kế và quyền: `docs/command-center/08-dong-chay-cong-viec-2026-10-13.md` mục 16.

## Gắn dữ liệu phụ vào GLB (không cần thư viện)

```bash
node scripts/site3d/embed-glb-extras.mjs docs/command-center/mockups/xinhai/xinhai.glb /tmp/architecture.glb bushes=docs/command-center/mockups/xinhai/xinhai-bushes.json
```

Ghi JSON vào `scenes[0].extras` (cảnh đọc qua `gltf.scene.userData`), giữ nguyên phần hình đã nén. XinHai dùng `bushes` = bụi cây viền `[x, z, dài x, cao, dài z]`.

## Bộ chuyển đổi XinHai (`xinhai/`)

Viết riêng cho mô hình `TMB+NM_V1` (bảng `PART` trong `convert-sketchup.mjs` ánh xạ nhóm SketchUp → hạng mục). Công trường khác cần ánh xạ nhóm mới.
Cần thư viện ngoài repo, cài vào một thư mục tạm rồi chạy từ đó (không thêm vào package.json):

```bash
npm i --no-save @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 meshoptimizer@0.21.0 web-ifc@0.0.66
```

1. SketchUp → File → Export → 3D Model → COLLADA (.dae), giải nén vào một thư mục.
2. `SITE3D_DAE_DIR=<thư mục .dae> node convert-sketchup.mjs` → `xinhai-raw.glb` + `xinhai-bushes.json` (dựng trong Chrome headless bằng ColladaLoader, xoay thẳng trục khu đất −14,33°).
3. `node optimize.mjs` → `xinhai.glb` (gộp, hàn đỉnh, giảm tam giác phần nền / nhà máy GĐ1, lượng tử hoá, nén meshopt).
4. Tekla → File → Export → IFC: `node ifc2glb.mjs <tệp.ifc>` → `xinhai-tekla.glb` (bỏ đinh, bu lông, tôn bao; chia giai đoạn lắp dựng theo bước trục).
5. Gắn bụi cây (mục trên) rồi tải `architecture.glb`, `structure.glb` lên bằng nút **Mô hình**.

## Bộ chuyển đổi Sơn Miền Bắc (`smb/`) — đọc COLLADA trong Node

Tệp DAE SMB 189 MB làm tab Chrome headless hết bộ nhớ (giới hạn ~4 GB / tab), nên `smb/` đọc thẳng trong Node: `node-dae.mjs` dùng ColladaLoader của three.js với
`@xmldom/xmldom` thay DOMParser (5 giây, 1,8 GB), ảnh vật liệu gắn lại từ tệp khi xuất GLB. Dùng được cho công trường khác (sửa `map-*.json`).

```bash
npm i --no-save three@0.169.0 @xmldom/xmldom@0.8.10 sharp @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 meshoptimizer@0.21.0 web-ifc@0.0.66
node --max-old-space-size=13000 convert-dae.mjs <thư mục>/2026.09.dae smb-raw.glb map-smb.json   # gom khối theo phần|loại|tầng, dời tâm khu đất về gốc
node --max-old-space-size=13000 optimize.mjs smb-raw.glb architecture.glb ratio-smb.json         # giảm tam giác theo phần, ảnh ≤ 512 px, meshopt (~11 MB)
node --max-old-space-size=8000 ifc2glb-x3.mjs "IFC 3D X3.ifc" structure.glb                     # Tekla xưởng 3: giai đoạn × bước khung, bỏ tôn / tấm sàn / bu lông
node glb-stats.mjs architecture.glb                                                             # tam giác theo phần
```

`map-smb.json`: nhóm SketchUp → phần (`NVP`, `NX1`, `NX2`, `NX3`, `PHU`, `HT`, `DIAHINH`), quy tắc loại (`factory`: thân / mái / sàn theo hộp bao; `floors`:
tầng theo cao độ 3,6 m, mặt dựng theo vật liệu), nhóm bỏ (vật trang trí hàng triệu tam giác, xe đứng yên). Tekla xưởng 3 đặt trong cảnh bằng xoay 90° quanh trục đứng,
dời (92,05; 0,3; 32,9) — chiều dài Tekla (z) theo hướng đông–tây, đầu z = −75 là đầu tây gần cổng.

Không đưa tệp thiết kế của công ty lên trang chuyển đổi trực tuyến; mọi bước chạy trên máy.
