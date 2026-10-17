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

Không đưa tệp thiết kế của công ty lên trang chuyển đổi trực tuyến; mọi bước chạy trên máy.
