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

## Daily Log WBS: pilot riêng, không dùng mode của Procurement

Phạm vi này dùng `app_private.daily_log_wbs_rollout_scopes` và operation
`supabase/operations/daily_log_wbs_area_pilot.sql`. Không thay đổi manifest hoặc
quyền Project V2/Procurement. Chỉ dùng Supabase Cloud, không Docker/local DB.

### Điều kiện và thao tác operator

1. Xác minh Cloud ref, project/site, release, ngày cutover và owner đang ACTIVE.
   Kiểm tra đủ migration Nhật ký đến `20260925153000`; không áp dụng lại migration
   đã có trong history. Lưu source/hash của migration trong bằng chứng release.
2. Người tổng hợp phải có Room `verify` + `submit`; CHT có `approve` +
   `publish_progress`, assignment hợp lệ. QS chỉ đọc; kiểm thử user bị từ chối.
   Điều hướng ERP còn cần `project.daily_log.view` theo đúng project scope để
   project hiện trong danh sách; Room grant một mình không đủ cho RLS `projects`.
   Không thay bằng admin để vượt lỗi quyền nghiệp vụ.
3. Mở transaction trên Cloud đã xác minh. Dùng `set_config` đặt
   `app.daily_log_operation` là JSON với đủ `projectId`, `constructionSiteId`
   (null tường minh nếu không có site), `mode`, `cutoverDate`, `releaseId`,
   `ownerUserId`, `reason`. Chạy nội dung operation trong **cùng transaction**.
   Dry-run bằng ROLLBACK; chỉ COMMIT sau khi kiểm đúng scope/owner/receipt.
   Operation ghi audit before/after, reason và operator role; không gọi trực tiếp
   helper configure để bỏ qua audit. Không đưa service key vào trình duyệt.
4. Bắt đầu `pilot`: nguồn mới không ghi progress; CHT “Đối chiếu thử nghiệm” chỉ
   ghi shadow, không xác nhận đã công bố. Đường nhập tiến độ cũ vẫn hoạt động.
   Đối chiếu phần trăm, khối lượng lũy kế/ngày, row identity/version; unknown
   không được thay bằng 0. Owner xử lý nguyên nhân sai khác, không sửa số liệu
   thật chỉ để đạt shadow xanh.
5. Chỉ đổi `enforced` cùng release/ngày cutover khi shadow mới nhất từng summary
   không sai khác và còn khớp dữ liệu hiện hành. Mọi bản tổng hợp chuẩn hóa đã
   `submitted` trong scope/ngày cutover đều phải có shadow khớp của release này;
   cổng server từ chối thiếu shadow, shadow stale hoặc mismatch. Sau cutover,
   manual save/close kèm draft bị chặn;
   chốt kỳ không kèm draft và mở kỳ vẫn giữ quyền quản trị kỳ hiện có.
6. Kiểm tra một summary → một progress/task/day, lineage source/card, provider
   catalog/manual, replay command không nhân đôi và không có giao dịch/giá/tiền
   từ Nhật ký. Ghi receipt/command ID, actor, thời điểm và screenshot.

### Pause, rollback và hỗ trợ

- Dùng operation với `paused` hoặc `off`, reason mới và cùng scope; giữ toàn bộ
  nguồn/snapshot/audit/progress, không delete hoặc backfill. Hai mode này ngừng
  publish WBS và trả authority về đường legacy; **không phải khóa toàn bộ nhập
  tiến độ**. Nếu cần ngừng mọi ghi, owner phải xử lý quyền/kỳ theo quy trình riêng.
- `ROW_VERSION_CONFLICT`, `SHADOW_COMMAND_INPUT_CHANGED`, nguồn changed/returned:
  reload và so diff; không âm thầm ghi đè snapshot. Chỉ cấp command ID mới khi
  đó thật sự là một lần so sánh mới, không phải retry sau timeout.
- Kỳ ngày/tuần khóa: không bypass guard. Gửi owner kỳ để quyết định mở kỳ có audit;
  sửa bản verified bằng revision, không rollback legacy. Exception tiến độ cần
  quyền kép, reason và before/after audit; chỉ dùng trong enforced scope.
- Support owner là `ownerUserId` của release; kèm release/project/site, summary,
  command ID, mã lỗi và version (không kèm token/password). Pause ngay khi có
  duplicate/lineage sai hoặc lộ quyền; giữ evidence trước khi xử lý.

### Kiểm thử nhánh baseline được ủy quyền

Hiện fixture dành riêng cho `baseline-vioo-git` (`oymkraihhqahqvzahhtx`), project
`DL-WBS-PILOT-20260925`; runner từ chối đổi sang main. Cần fixture project/WBS,
Room và provider đã tạo trên nhánh. Root `.env` không bị thay đổi; nạp cấu hình
vào environment shell mà không in secret, rồi chạy:

```sh
node tests/daily-log/run-cloud-smokes.mjs
npx playwright test --config tests/daily-log/cloud-playwright.config.ts
```

SQL smokes rollback; browser test **ghi dữ liệu synthetic**, xoay password của
sáu persona test và pause scope trong finally. Không chạy song song runner này.
Không tự xóa dữ liệu sau test. Fixture browser gồm hành trình component/service
và một ca mở summary qua shell ERP thật bằng phiên CHT cùng deep link.
Ca shell kiểm tra đọc/lineage; các mutation được kiểm bằng harness Cloud.
Xem evidence riêng trong
`docs/superpowers/evidence/2026-09-25-daily-log-baseline-cloud-smoke.md`.

## Bằng chứng nguồn lực Nhật ký → Thanh toán: read-only pilot riêng

Phạm vi này chỉ đọc nhân công/máy đã verified trong summary WBS. Không dùng
cost/accrual/transaction của Nhật ký, không đổi rollout Plan 1 và không đụng
Project V2/Procurement. Migration Cloud cần có `20260925160000`,
`20260925161000` và bản hardening `20260926022433` (private definer/public
invoker); kiểm source hash trong evidence release trước khi bật.

1. Xác minh đúng branch/project/site, owner active, date range tối đa 366 ngày,
   `releaseId`, `reason`, `expiresAt` trong vòng 30 ngày. Kiểm ít nhất một QS
   active có Payment Room `view_resource_evidence` đúng scope; không cấp từ
   quyền xem Thanh toán chung. Binding ban đầu là `audit_only`.
2. Chạy `supabase/operations/resource_usage_evidence_pilot.sql` trong transaction
   với `app.resource_evidence_operation` JSON. Dry-run ROLLBACK trước; review
   missing provider/lineage, duplicate current, recipient và grant ở scope khác.
   Operation fail-closed nếu thiếu bất kỳ điều kiện nào. `EXPLAIN` đi kèm để lưu
   query-plan evidence. Chỉ COMMIT `mode=pilot` khi release owner chấp thuận.
3. Dùng QS thật đăng nhập đọc NCC → ngày → khu vực → WBS → Nhật ký gốc ở
   desktop/tablet/mobile. Thử user thiếu quyền và khác scope. Mỗi dòng chỉ có
   số người/máy và giờ công/giờ máy; `unknownLegacyCount` không được cộng vào
   tổng và không được diễn giải thành giờ. Provider inactive vẫn đọc snapshot
   đã xác nhận; nguồn nhập tay không bị tự ghép vào BusinessPartner.
4. Revision current là mặc định; toggle lịch sử hiển thị `superseded` rõ ràng
   nhưng không cộng lại vào KPI. Kiểm JSON và UI không có khóa tiền, và
   `project_transactions` không đổi. Nếu sai quyền, lineage, revision hoặc lọt
   giá/tiền: dừng pilot, giữ evidence, báo support owner.
5. Pause/rollback bằng cùng operation với `mode=audit_only`, reason mới, sau đó
   vô hiệu hóa grant test. Không xóa Nhật ký, source, revision hay legacy; không
   backfill. Binding này là toàn cục nên preflight chặn active grant ở project
   khác. `expiresAt` là deadline operator, không có auto-expiry DB: support owner
   phải chủ động pause trước deadline. Muốn rollout nhiều project cần thiết kế
   cohort binding riêng, không dùng operation pilot này.

Test branch `baseline-vioo-git` dùng `node --env-file=/Users/admin/khotienthinh/.env
tests/daily-log/run-resource-evidence-pilot.mjs` và browser config
`tests/daily-log/resource-evidence-playwright.config.mjs`. Runner tạo/đăng nhập
persona synthetic, chỉ mở binding trong thời gian test, rồi trả `audit_only` và
deactivate grant trong `finally`; không chạy song song với runner Plan 1. Evidence
ghi ở `docs/superpowers/evidence/2026-09-25-resource-usage-evidence-pilot.md`.
