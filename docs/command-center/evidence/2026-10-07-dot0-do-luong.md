# Đợt 0 — số đo hiệu năng và WebKit (07/10/2026, PR-F)

## RPC trên dữ liệu production (giao dịch rollback, không ghi)

Migration `20261008138000` … `20261008138004` + kịch bản bật thí điểm, gọi dưới quyền từng người trong 28 người
Tổ chức dự án SMB-2026 (giả lập đúng `auth_id` của họ). Không in tên người.

| RPC | Trước sửa (p95) | Sau `20261008138004` (p95) | Max sau sửa | Kết quả cũ = mới |
|---|---|---|---|---|
| `vcc_my_work_items_v1('mine')` | 1 196–1 305 ms | **438 ms** | 492 ms | 28/28 |
| `vcc_my_work_items_v1('sent')` | 87 ms | 72 ms | 74 ms | 28/28 |
| `vcc_my_work_items_v1('watch')` | 85 ms | 72 ms | 76 ms | 28/28 |
| `vcc_my_center_v1(null)` (Hôm nay, gọi lại 'mine') | 1 427–1 499 ms | **649 ms** | 661 ms | — |
| `vcc_my_actions_v1` (3 người) | — | 269 ms | 272 ms | — |

- Nguyên nhân chậm: nguồn **phiếu kho** gọi `wms_has_action` (~30 ms/lần, tới 5 lần kiểm quyền) cho từng phiếu đang mở
  (27 phiếu). Sửa: một lần cho mỗi bộ (việc, kho nguồn, kho đích, tôi lập?, tôi được giao?) — 27 phiếu có 4 bộ.
- Còn lại đáng kể: Office (`office_filtered` 5 lần) ~100 ms. Chưa sửa (đã đạt mục tiêu).
- Tổng việc "Chờ tôi" của 28 người: 237 (TB 8,5; nhiều nhất 29). "Tôi gửi": 112. "Theo dõi": 39.
- Mục tiêu kế hoạch 07: `vcc_my_work_items_v1` < 800 ms, p95 < 1 s — **đạt**.

## WebKit khi đứng yên (fixture, iPhone 13 giả lập, Playwright WebKit)

`npx playwright test -c tests/center/playwright.config.ts --project webkit-idle` → `.center-test-results/webkit-idle.json`.

| Màn | Animation | setTimeout / setInterval / rAF / đổi DOM trong 10 s | CPU WebKit | Trên nền trang trống (3,6%) | Phần tử DOM |
|---|---|---|---|---|---|
| Việc của tôi (9 việc) | 0 | 0 / 0 / 0 / 0 | 5,8% | +2,2 | 569 |
| Hôm nay | 0 | 0 / 0 / 0 / 0 | 5,5% | +1,9 | 569 |
| Thư mục thao tác đang mở | 0 | 0 / 0 / 0 / 0 | 5,3% | +1,7 | 652 |
| 200 việc (dựng xong 0,78 s) | 0 | 0 / 0 / 0 / 0 | 6,4% | +2,8 | 1 906 |

- Trang không tự làm việc gì khi đứng yên; phần CPU trên nền là của WebKit headless + kết nối HMR máy chủ dev.
- So sánh: sự cố #117 (`/wf` sập trên Safari) ~25% CPU khi đứng yên.
- Đo trên máy thật (Safari iPhone, bản build production, dữ liệu thật) làm trong UAT (`uat-dot-0.md`).
