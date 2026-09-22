# ERP completion — pilot, cutover và recovery

Runbook này áp dụng cho G9. Nó không tự cấp quyền, không tự chọn cohort và không thay thế xác nhận của người dùng nghiệp vụ. File manifest trong cùng thư mục là bản nháp preview; trước khi kích hoạt phải thay bằng project/site/kho/NCC, actor, owner, thời gian và commit thật.

## Điều kiện trước khi mở pilot

1. Artifact đã deploy phải đúng `commitSha`; Cloud migration head phải có `20260921190000` và không có migration ngoài release manifest.
2. Chạy `node scripts/g9/release-manifest.mjs docs/runbooks/erp-completion-pilot-manifest.json --activatable`. Manifest phải ở trạng thái `ready`.
3. Xác minh riêng sáu người dùng buyer, QS, kho, QC, kế toán và quản lý đang active. Mọi grant bổ sung phải qua preview/apply V3 với fingerprint mới đọc, expiry và warning acceptance đã có control owner; rollout gate không tự cấp quyền.
4. Project/site, mọi kho và NCC trong manifest phải tồn tại và cùng scope dự kiến. Không dùng admin làm bằng chứng cho persona.
5. Health snapshot không có mismatch nghiêm trọng. `permissionErrors`, `commandLatency` và `clientReplayConflicts` phải có bằng chứng từ log/monitoring ngoài DB; giá trị `external_evidence_required` không được hiểu là đạt.
6. Chạy regression release, smoke rollback trên preview và walkthrough 390/768/desktop. Fixture chỉ là bằng chứng kỹ thuật.
7. Xác nhận artifact trước đó còn deploy được và người chịu trách nhiệm pause/recovery đang trực.

## Cách mở an toàn

1. Chạy `supabase/operations/g9_erp_completion_pilot.sql` với `commit_changes=false`, truyền `release_owner` và `support_owner` đúng manifest. Review exact rows và các lỗi preflight.
2. Chạy lại với `target_mode=read_only`, `commit_changes=true`. Kiểm tra access RPC theo từng actor và giữ command bị khóa.
3. Thu health snapshot, test deep link/giá/quyền bằng từng persona và lưu run ID, thời điểm, actor, expected/actual, evidence, cleanup.
4. Khi review đạt, đổi config sang `pilot` bằng cùng operations script và reason mới. Bật frontend bằng cả `VITE_ENABLE_ERP_COMPLETION_PILOT=true` và exact `VITE_ERP_COMPLETION_PILOT_SITE_IDS`; server vẫn là authority.
5. Chạy J01–J08. Một journey chỉ `passed` khi có actual result, evidence, cleanup và tên người nghiệp vụ xác nhận. Cập nhật manifest sau mỗi lần chạy.
6. Sau một chu kỳ kế hoạch → phân bổ/mua → nhận/cấp → invoice/payment thực tế, đối soát stock, allocation, AP, cash và dashboard trước khi mở rộng.

## Vai trò và việc cần xác nhận

| Vai trò | Việc chính | Xác nhận bắt buộc |
|---|---|---|
| QS | Lập/revise kế hoạch, giữ nguồn BOQ, chuyển một phần sang MR | Allocation, revision và lượng còn lại đúng; draft không giữ tồn/AP |
| Buyer | Nhận demand, phân bổ nguồn, tạo PO | Không mua trùng; scope/NCC/UOM/giá lịch sử đúng |
| Kho | Dispatch/receive/dispose transfer, kiểm kê | Chứng từ, physical count, accepted và custody tách riêng; không thấy giá khi không có quyền |
| QC | Đánh giá accepted/rejected/custody | Kết quả QC không bị suy từ delivered; exception có owner |
| Kế toán | Match invoice, post/reverse payment | Coverage/variance đúng scope; retry không nhân đôi; kỳ khóa được tôn trọng |
| Quản lý | Đọc M01–M05, drill lineage và quyết định exception | KPI/list/export cùng filter/cutoff; unknown không thành 0 |

## J01–J08 và evidence

| Journey | Chủ trì | Evidence tối thiểu |
|---|---|---|
| J01 kế hoạch 10+5 → preview 15 → MR | QS | plan/revision/MR IDs, allocation 10/5, ảnh desktop/mobile |
| J02 trả sửa và gửi lại revision | QS + người duyệt | revision/hash trước/sau, audit hành động, xác nhận không duyệt link cũ |
| J03 phân cấp 5/mua 10 → PO | Buyer | demand balance, allocation, PO ID, thử cạnh tranh không mua trùng |
| J04 đặt 100/giao 98.5/đếm 98.2/đạt 98 | Kho + QC | delivery/QC/custody rows, stock ledger, giá readonly |
| J05 cấp 60/dùng 40/hoàn 10 | Kho + đội nhận | issue/custody/return refs, tồn đội 10, kho +10 khi nhận |
| J06 invoice/payment partial và retry | Kế toán | AP/invoice/payment IDs, balance trước/sau, replay cùng key |
| J07 drill M01/M02 → PO → MR → BOQ | Quản lý | filter/cutoff/metric version, lineage và back-navigation |
| J08 denied/deep link/mobile 390px | Kho + user khác scope | denied API/UI, không lộ giá/aggregate, focus và đường quay về |

Mỗi evidence record phải có run ID, release ID, commit, môi trường, actor persona, scope, expected, actual, thời gian, đường dẫn bằng chứng và cleanup. Không lưu token, cookie hoặc thông tin cá nhân không cần thiết.

## Lỗi thường gặp

- `ERP_COMPLETION_PILOT_COMMAND_DISABLED`: command chưa mở, scope/actor không khớp, scope đã hết hạn hoặc pilot đang pause. Không retry bằng actor/admin khác; kiểm manifest, access RPC và audit config.
- `40001`/stale version: reload record, giữ nội dung người dùng, so revision rồi thực hiện lại với key phù hợp.
- `SoD warning acknowledgement required`: dừng apply quyền, review rule/scope và chỉ tiếp tục khi control owner có `system.authorization.audit` chấp nhận reason, compensating controls và expiry cụ thể.
- Timeout sau submit: không tạo key mới. Đọc lại aggregate/command result bằng cùng scope rồi replay cùng idempotency key.
- Unknown/partial/denied: không sửa chứng từ hoặc điền 0 để làm màn hình xanh; giao cho data exception owner kèm source IDs.
- Outbox/backlog tăng: dừng mở rộng cohort, xác định oldest pending và consumer owner. Không xóa event để giảm count.

## Theo dõi và mức sự cố

- Integrity: reconciliation issue mới, source revision changed, allocation vượt, stock/AP/cash effect trùng.
- Delivery: outbox pending/oldest, incomplete command, replay/conflict rate.
- Security: permission denied bất thường, cross-scope probe, aggregate/price exposure.
- UX/API: p50/p95/p99 command/read latency, timeout và error theo command/scope/release.

Sai stock/AP/cash, lộ scope/giá hoặc effect tài chính/kho trùng là critical: pause command tạo mới ngay và báo release owner trong SLA manifest. Backlog/latency cao hoặc journey bị chặn là high. Lỗi hướng dẫn không ảnh hưởng dữ liệu là standard. Không ghi `healthy` cho metric ngoài DB khi chưa có telemetry.

## Pause và recovery

1. Đặt scope về `paused` với audit reason. Mode này chỉ giữ các command trong `completion_commands`: nhận/xử lý transfer đang mở, chốt kiểm kê đã bắt đầu và reversal invoice/payment. Nếu tiếp tục các command đó không an toàn, chuyển `read_only` sau khi business owner xác nhận cách xử lý hồ sơ dở dang.
2. Giữ toàn bộ read/RLS và thu evidence. Không xóa plan, PO, ledger, AP, invoice hoặc payment đã post.
3. Phân loại: config/quyền, release regression, backlog/event, source data, duplicate effect hay policy unsupported.
4. Khôi phục artifact cũ khi lỗi ứng dụng; dùng reversal/adjustment đúng engine khi đã có effect. Schema expand và audit rows được giữ.
5. Đối soát theo từng source ID và scope. Chỉ mở lại `pilot` bằng audit reason mới, health snapshot mới và signoff của owner liên quan.

## Exit criteria

Pilot chỉ hoàn tất khi J01–J08 và các A-case áp dụng có evidence đúng lớp, một chu kỳ nghiệp vụ thật đã đối soát, sáu persona xác nhận phần việc, critical/high issue đã đóng hoặc có disposition/owner, và manifest chuyển `completed`. Preview smoke, automation hoặc dữ liệu synthetic không thay thế điều kiện này.
