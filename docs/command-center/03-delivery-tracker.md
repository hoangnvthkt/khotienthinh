# Theo dõi triển khai

Ngày 29/09/2026. Lượt hiện tại thực hiện **đánh giá ban đầu theo yêu cầu trực tiếp**, chưa thay đổi chức năng.

**Ưu tiên cập nhật:** lấy dự án/công trường làm trung tâm, gồm nhân sự, quyết định và thông báo điều động. Roadmap sản phẩm P0–P5 ở [05-project-first-strategy.md](05-project-first-strategy.md). M0–M5 bên dưới là nhóm gate kỹ thuật của handoff, không còn quyết định thứ tự ưu tiên domain.

| Chặng | Trạng thái | Kết quả / gate tiếp theo |
|---|---|---|
| Đọc và đánh giá handoff | DONE | Đọc 8 file; prompt ngoài ZIP khớp; đối chiếu kiến trúc và các đường nghiệp vụ đại diện |
| M0 — Inventory toàn hành động | IN_PROGRESS | Giữ đủ 148 ứng viên, bổ sung các action thật đã thấy; còn nhiều dòng UNVERIFIED. Chưa đạt G0 |
| Củng cố nền tảng hiện hữu | PROPOSED | F01/F02 quyền AI/hội thoại; F03 prepare/receipt; F04 draft; baseline typecheck |
| M1 — Shell + registry + gateway | NOT_STARTED | Query thật + một command đầy đủ allow/deny/conflict/replay; AI lỗi vẫn làm trực tiếp |
| M2 — Luồng dọc đầu tiên theo dự án | NOT_STARTED | Đề xuất/giao việc trong dự án; mở tiếp chuỗi nhân sự–quyết định và nhu cầu–cung ứng. Kiểm tính tổng quát qua các phòng ban phục vụ dự án |
| M3 — Domain phức tạp | NOT_STARTED | Project V2/BOQ, Procurement V2/PO, WMS, nhật ký, tài chính; giữ pilot gates hiện hữu |
| M4 — Phủ rộng | NOT_STARTED | Hoàn tất inventory rồi tích hợp các action còn lại, gồm quản trị/tệp/communication/jobs |
| M5 — UAT và rollout | NOT_STARTED | Cloud tests, responsive, telemetry/cost, pilot cohort; kiểm rollback và receipt sau deploy |

## Thứ tự kỹ thuật đề xuất

1. Chốt baseline source/schema/deployment và kiểm đủ hành động Request + Work theo dự án/công trường; mở rộng audit nhân sự/điều động/quyết định và nhu cầu/cung ứng. Xác minh Cloud chỉ đọc qua cấu hình repo trước khi viết migration; Cloud mutation tests dùng môi trường test được xác định rõ.
2. Củng cố quyền AI/hội thoại có regression tests; sửa phạm vi typecheck để tài liệu prototype không làm nhiễu gate (thay đổi riêng, không cài dependency Next vào app Vite).
3. Thống nhất contracts và transaction strategy theo Request. Làm menu/form trực tiếp và gateway trước hoặc song song với provider routing, không để LLM là điều kiện sử dụng.
4. Chạy một đề xuất phục vụ công trường hoàn chỉnh: tạo nháp theo scope → prepare → confirm → submit → người được giao review/approve → receipt → UI cũ đọc lại. Bổ sung return/resubmit cùng ID và unknown-outcome resume; nối công việc thực hiện có nguồn theo policy, không coi duyệt là đã đáp ứng.
5. Sau luồng này mới mở rộng renderer/domain theo inventory, ưu tiên hành động hay dùng và backend đã có guards; không đánh dấu ready do chỉ có RPC hoặc link legacy.

## Độ phủ

- 148 là số ứng viên handoff, không là mẫu số production.
- `01-capability-inventory.csv` giữ mỗi action một dòng, nêu rõ `UNVERIFIED`, `STATIC_TRACE` hoặc `GAP_CONFIRMED_FROM_SOURCE`.
- `evidence/inventory-summary.json` ghi số dòng theo trạng thái/kind. Các dòng unclassified chưa được tính ép sang read/write.
- Chưa có action tích hợp Center. `ready = 0`, `read_only = 0`, `legacy_fallback = 0` trong sản phẩm Center chưa được tạo; các module hiện tại vẫn tồn tại như cũ.
- Không tính phần trăm coverage vì tổng action áp dụng được còn chưa xác định. Dòng blocked/unverified được giữ nguyên, không loại khỏi phạm vi để làm đẹp số liệu.

Inventory ban đầu có **174 dòng = 148 ứng viên + 26 action bổ sung**: 31 `STATIC_TRACE`, 9 `GAP_CONFIRMED_FROM_SOURCE`, 2 `SERVICE_TRACE_UI_ENTRY_ONLY`, 132 `UNVERIFIED`. Có 11 query, 2 draft, 29 command và 132 dòng chưa phân loại. 9 dòng blocked liên quan 4 nhóm khoảng trống đã ghi rõ; không phải 9 lỗi độc lập. `STATIC_TRACE` chỉ có bằng chứng code UI/service/RPC, chưa chứng minh toàn bộ runtime permission hay đạt nghiệm thu. `schema_evidence` nêu các định nghĩa migration gần nhất tìm thấy cho RPC; không thay thế việc kiểm tra toàn chuỗi wrapper/helper/trigger/policy.

Nhãn test `V1` trong CSV trỏ đến lệnh targeted baseline trong `evidence/baseline.json`. Nó chỉ ghi nhóm unit/mock/static đã chạy, không khẳng định từng ca acceptance của action đã pass. Những test/domain chưa chạy giữ `NOT_RUN`.

## Kiểm thử cần bổ sung

Tái dùng `ACCEPTANCE_TESTS.md` trong ZIP. Trọng tâm đầu tiên: C02–C05; D02/D05–D07; P01–P08; T01–T12; L01–L04; O01/O02/O05. Không gắn nhãn pass cho các mã này từ 80 unit/mock tests baseline.

Ngoài bộ handoff: test ID hội thoại của người khác; tri thức/RAG khác ACL; permission bị thu hồi trước operation lookup; lỗi provider không ngăn form; hai tab cùng draft; stale registry/schema sau frontend rollback; chuyển giữa cohort Project/Procurement cũ–mới; không đưa command vào offline auto-sync.

## Rollout / rollback đề xuất

Chưa deploy/migrate trong bước này. Khi triển khai: migration thêm tương thích, route mới mặc định tắt, server allowlist theo actor/scope/capability; mở query trước khi write đủ gate. Tách kill switch AI và write; giữ read/status lookup để xử lý operation đang chờ. Tắt Center không xóa dữ liệu, draft hay receipt và không replay command. UI cũ tiếp tục qua domain services đã được củng cố. Không dùng rollback migration phá dữ liệu đã ghi; ưu tiên roll forward khi schema đã dùng.
