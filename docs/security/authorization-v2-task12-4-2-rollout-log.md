# Task 12.4.2 — Rollout log

Handoff mới nhất cho phiên làm việc kế tiếp: `authorization-v2-task12-4-2-handoff-2026-09-15.md` (chốt sau E13, Git/Cloud/CI đã đối soát).

## Khởi động — 2026-09-14

- Branch `feature/authorization-v2-task12-4-2`, worktree riêng từ `origin/main` tại `abc35de` sau fetch.
- Cloud main `ftciqmqhmfvjtwoycswe`, xác minh linked ref; dùng `.env` hiện có. Chỉ read-only Cloud ở checkpoint này.
- Baseline: 391 files / 1.862 tests pass (Vitest, 8.08s). Không dùng kết quả này để đánh dấu nghiệm thu release.
- Inventory tại 08:20:54 UTC: 56 active, 3 disabled; nguồn grant/template/policy tổng hợp trong `authorization-v2-task12-4-2-inventory.json`. Không xuất tên/email hoặc dữ liệu nghiệp vụ.

## A0 — Đối soát ledger

Sáu migration đã apply ngày 12/09 còn thiếu trên main. Đã đối chiếu từng statement remote theo đúng thứ tự với file gốc worktree `task-participant-web-push`: toàn bộ 111 statements khớp nguyên văn, phần dư chỉ là dấu kết thúc statement/whitespace. Bản đưa vào branch mới byte-identical với source gốc; không replay SQL, không sửa history Cloud, không mở notification gate.

| File | Statements | SHA-256 source |
|---|---:|---|
| 20260912044730_work_notification_preview_recipients.sql | 8 | 06ec61a4118b04682148aaab466f808e0944d2a7546684e9090566e00c86fe6d |
| 20260912045358_workflow_notification_outbox.sql | 36 | bbf9d177e4085bfc480127eeccbabe8694dd926cc1dc4051c4c0a8a0b0f7061f |
| 20260912045733_workflow_notification_commands.sql | 33 | 193d00f589e77121646997df583d728bd1362c7bdd7a6b60c4629c45b1eeea06 |
| 20260912050458_request_participant_notifications.sql | 11 | 5cd6dbcd7b683d3197a3b977f65be9ab6410f3109ff9231cc6d2b428be138639 |
| 20260912050744_task_notification_deadline_reminders.sql | 20 | d800ef5da6377a147d2b057ea00763c95f8ab225fa5ef46948b46b2063d8e719 |
| 20260912052011_task_notification_source_guards.sql | 3 | e93c51546e09428dc09460a270699363c23dd9e6af91700fadcf520e6b4295a7 |

Allowlist cũng bổ sung migration `20260914075111_request_discussion_rpc_permissions.sql` vốn đã nằm trong main và remote ledger nhưng bị thiếu trong current.json. Migration baseline sau đối soát: **52 active / 402 archived**, pass.

## Trạng thái

- A: đang thực hiện access-map/coverage và persona inventory; A0 đã xác minh source và ledger.
- B–H: chưa triển khai. Không có migration phân quyền mới, không có thay đổi quyền tài khoản thật, chưa bắt đầu observation.
- Task 13: blocked cho tới khi Task 12.4.2 và observation gate đạt.

## A1 — Inventory và access-map

- Đã lưu query read-only tái chạy được, inventory Cloud tổng hợp, access-map cho 18 mục Settings (gồm tab thực, account self-service và org-chart metadata lệch), danh sách 87 submodule registry/route/action/scope.
- Mapping ghi rõ bảng/API owner, các capability dự kiến và quyền dùng chung với WMS/Project/HR; source chưa có phép thay thế tương đương được giữ/manual review, không auto-revoke theo tên.
- Policy `loss_norms_all` vẫn ALL true sau active-account gate; các bảng dùng chung còn quyền read rộng hoặc write admin-only. B phải xử lý enforcement, không chỉ hiện thêm lựa chọn catalog.
- Scope bug được chứng minh ở D: removeApplicationDirectGrants không lọc scope; ActionRow chỉ hiện grant và inherited source đầu tiên. Ưu tiên sửa tiểu-checkpoint D1 này trước batch dữ liệu, độc lập với migration Settings B. Đây là thay đổi thứ tự triển khai; B/C và phần D còn lại vẫn chưa đạt exit.

## D1 — Đã kiểm thử editor, chưa release

- Test RED: 5/6 ca scope thất bại đúng vì gỡ chéo scope; component test nhiều nguồn cũng fail do chỉ hiện grant/source đầu.
- Sửa: chọn rõ phạm vi khi module có nhiều scope, giữ scope khác/nguồn ẩn; mỗi direct tuple có control ổn định; hiển thị tất cả nguồn kế thừa còn hiệu lực; reload làm mất hiệu lực preview cũ.
- Targeted GREEN: 4 files / 26 tests; TypeScript pass, production build pass (chunk-size warning hiện hữu).
- Playwright Chromium: 3/3 pass — gỡ kho A giữ B/global/ROLE C; gỡ từng row liên tiếp đúng tuple; reload hủy confirmation cũ. Playwright ban đầu thiếu browser, đã cài headless shell; test dùng click rồi kiểm draft vì row biến mất sau khi bỏ chọn, không chờ checkbox đã unmount.
- Đây là kiểm editor với dữ liệu giả, không phải persona production hay kiểm RLS. Không có Cloud mutation cho D1. Phần receipt/refresh sau lưu và dẫn tới owner của nguồn thuộc D còn lại.

## E1 — Bỏ redirect legacy, chưa release

- App.tsx không còn dùng allowedSubModules để chọn landing khi route bị từ chối. Chỉ quay về tổng quan Dự án nếu capability hiện hành cho phép; nếu không về Home. ADMIN role đơn lẻ và quyền hết hạn không mở landing.
- Scanner runtime mở rộng tới App/root, context và Edge Functions; mapper/type legacy còn giữ được allowlist riêng, không cho phép làm quyết định quyền.
- RED: 5 ca thất bại trước sửa; GREEN targeted: 4 files / 35 tests. Hồi quy sau sửa: 393 files / 1.873 tests pass; TypeScript pass; baseline 52 active / 402 archived; audit/check Supabase queries đều 0 findings; git diff --check pass.
- Chỉ hoàn tất tiểu-checkpoint redirect/scanner, không thay thế nghiệm thu toàn bộ menu/route/API E. Settings B, account transition C, receipt/refresh D, surface API coverage E và F–H vẫn đang chờ triển khai.

## D2a — Tách trạng thái lưu khỏi tải lại

- UserModal phân biệt mutation thất bại với mutation có receipt nhưng refresh thất bại. Trường hợp thứ hai khóa form sửa và hiện “Đã lưu tài khoản — chưa tải lại được quyền”; nút tải lại chỉ gọi read-refresh, không gửi mutation lần hai.
- Receipt target được dùng để refresh. Trạng thái chờ không bị xóa chỉ vì parent thay object của cùng tài khoản. Đóng/mở hoặc chuyển tài khoản mới reset trạng thái.
- RED đã tái hiện lỗi network sau write bị ném như lỗi save; GREEN 3 tests cho write reject, refresh reject và thứ tự write/read đúng target. Hồi quy 394 files / 1.876 tests pass; TypeScript/build pass (cảnh báo chunk-size hiện hữu).
- Chưa nghiệm thu browser lỗi mạng trên UserModal thật, so version/count của snapshot với receipt, cross-session/offline refresh. Các mục này và B/C/F–H vẫn chưa hoàn tất; không diễn giải D2a là toàn bộ D đã đạt.

## B1 — Capability Cài đặt chi tiết, chờ apply Cloud

- Bổ sung 14 phân hệ Cài đặt với cặp Xem/Quản lý; gói Xem mặc định chỉ gồm 8 mục vận hành thông thường. Người dùng, Cảnh báo, Permission health, AI Learning và Bảo trì không nằm trong gói; các quyền nhạy cảm không cho direct grant.
- UI mở đúng tab theo capability; manage kéo theo view; `system.settings.manage` tiếp tục là nguồn cha. Tài khoản chỉ có Xem thấy cảnh báo read-only và các control native bị khóa.
- Backend thêm helper theo JWT actor, mở bổ sung RLS cho caller Settings nhưng giữ nguyên caller WMS/Dự án. RPC binding kho, danh mục DA và nhóm làm việc dùng cùng capability. Policy `loss_norms_all = true` được thay bằng view/manage riêng. Branding `app_settings` vẫn cho active account đọc vì cần lúc bootstrap, chỉ khóa write.
- TDD frontend: 5/5 ca RED trước sửa; GREEN 2 files / 23 tests. Migration và SQL smoke được chạy ghép trên Cloud main trong transaction rồi rollback: view không update được app_settings, manage update được, capability không lan feature, sensitive bundle bị loại. Post-rollback xác nhận 0 module/action/policy thử nghiệm còn lại.
- Hồi quy trước commit: 395 files / 1.881 tests pass; TypeScript và production build pass (chunk warning hiện hữu); migration baseline 53 active / 402 archived; query audit/check 0 finding; dry-run chỉ liệt kê migration `20260914084622`.
- Chưa apply migration hoặc cấp/gỡ quyền tài khoản thật tại thời điểm ghi mục này. Các mục nhạy cảm còn `declared` và role-only cho tới khi endpoint tương ứng được audit ở checkpoint tiếp theo.

### B1 Cloud postflight

- Migration `20260914084622` đã apply lên Cloud main. Postflight: 14 module, 28 action, 18 action cho direct grant, 8 default-view; `loss_norms_all` còn 0; không có `settings.*` grant nào được tự tạo.
- SQL smoke standalone exit 0 và rollback. Security advisor không chỉ ra finding mới gắn với helper; performance advisor báo `multiple_permissive_policies` trên 23 bảng do giữ policy nghiệp vụ cũ và thêm nhánh Settings. Đây là debt cần hợp nhất policy, không phải bằng chứng mở rộng quyền ngoài các nhánh OR đã kiểm.

## C1 — Chuyển loại tài khoản nguyên tử, chờ apply Cloud

- Client command bắt buộc reason >=10, version hiện hành và phạm vi Thủ kho tường minh (`warehouse id` hoặc `*` cho toàn bộ kho); role khác không gửi kho cũ.
- RPC khóa tuần tự toàn bộ transition, lock target, kiểm actor có cả manage_roles và manage_grants, chặn stale version/self-promotion, giữ trigger lịch sử application, kiểm kho active và bảo vệ admin cuối cùng.
- Role `ADMIN` và assignment `SYSTEM_ADMIN` được tạo/thu hồi cùng transaction; các business role khác không bị chạm; receipt và audit cùng giao dịch. Quick-role cũ đã bỏ, UserModal là đường duy nhất và không cho trộn role transition với thay đổi hồ sơ/direct grant.
- RED frontend 4/4 trước sửa; GREEN 2 files / 7 tests. Rehearsal Cloud rollback đạt: stale reject, keeper all-warehouse, promote + mirror, demote + revoke mirror, audit và last-admin guard. Sau rollback role counts giữ nguyên 1 Admin / 50 Employee / 5 Warehouse keeper.
- Hồi quy trước commit: 396 files / 1.885 tests pass; TypeScript/build pass; baseline 54 active / 402 archived; query audit/check 0 finding; dry-run chỉ liệt kê migration `20260914090003`.

### C1 Cloud postflight

- Migration `20260914090003` đã apply lên Cloud main; RPC public tồn tại đúng một signature. SQL smoke standalone exit 0 và rollback.
- Postflight sau smoke giữ nguyên 1 Admin / 50 Employee / 5 Warehouse keeper và 1 assignment SYSTEM_ADMIN active. Không role hoặc assignment thật nào bị đổi bởi smoke.

## F1 — Manifest builder an toàn, chưa có batch được duyệt

- Builder tạo manifest ổn định theo source ID, hash toàn bộ source của từng user và loại trùng source. Unknown mapping luôn `manual_review`; `system.authorization.*` mặc định retain; source hết hạn giữ nguyên expiry và không sinh replacement.
- Tập source cần chuyển đổi (`candidateSourceIds`) được tách khỏi snapshot dùng để khóa cạnh tranh: manifest chỉ sinh item cho source được chọn nhưng `expectedSourceHash` vẫn bao phủ toàn bộ source của user. Vì vậy một thay đổi quyền ngoài batch cũng làm batch cũ bị từ chối thay vì ghi đè trạng thái mới.
- Unit test manifest: `8/8` đạt, gồm cả trường hợp source ngoài batch thay đổi làm hash thay đổi, nhận hash chuẩn từ Cloud và giữ state cần cho restore.
- Replacement khác scope được kiểm chặn khi mở own/cụ thể thành global. Không có quy tắc xóa theo tiền tố `system.*` hoặc gán HR rộng.
- RED ban đầu: module chưa tồn tại; bộ GREEN sau đó được mở rộng tới 8 test cho retain, unknown, scope expansion, expiry, idempotency/hash và hợp đồng snapshot Cloud.
- Migration command thêm snapshot/hash bao phủ direct grant, role/template, Project Room và Vioo Work Workspace. Preview chỉ dành cho actor có `system.authorization.manage_grants`.
- Apply fail-closed với batch/mapping/version/hash, chặn `manual_review`, khóa user theo thứ tự, audit và refresh trong cùng transaction; retry cùng nội dung không nhân đôi. Mutation ở F hiện chỉ cho source `DIRECT`; role/Room/Workspace bị từ chối rõ ràng cho tới khi có command chuyên biệt đã kiểm tương đương.
- Restore chỉ chạy khi toàn bộ post-source hash còn nguyên; source thay đổi ngoài batch làm restore dừng. Grant thay thế do batch tạo bị xóa và source cũ được phục hồi từ state đã chụp.
- Cloud rehearsal trong một transaction và rollback đạt: preview, manual-review rejection, unsupported-source rejection, stale apply rejection, apply, idempotent replay, stale restore rejection, restore và restore replay. Dry-run chỉ liệt kê migration `20260914091341`; query audit 0 finding.
- Hồi quy trước commit: 397 files / 1.893 tests pass; TypeScript và production build pass (chỉ còn chunk-size warning hiện hữu); baseline 55 active / 402 archived; query baseline/check 0 finding.
- Chưa tạo/apply manifest có user ID thật và chưa thu hồi grant thật. Operator approval cho manifest cụ thể vẫn là điều kiện bắt buộc trước checkpoint G.

### F1 Cloud postflight

- Migration `20260914091341` đã apply lên Cloud main; ba RPC preview/apply/restore tồn tại đúng một signature mỗi RPC.
- Reconciliation và restore smoke chạy standalone đều exit 0 và rollback. Postflight: `persistedBatches=0`, direct grant `system.*=417`, role active giữ nguyên 1 Admin / 50 Employee / 5 Warehouse keeper. Không có batch hay thay đổi quyền thật được lưu bởi bước cài command.

## E2 — Request template surface parity

- Audit Cloud tìm thấy `app_private.request_user_can_manage` vẫn đọc `role`, `admin_modules` và `admin_sub_modules`; đây là fallback làm checkbox V2 có thể không thu hồi được quyền sửa Mẫu yêu cầu.
- Hợp đồng mới: `request.template.view` mở danh sách read-only; `/rq/templates/new` và `/rq/templates/:id`, các nút tạo/sửa/sao chép/ngừng áp dụng và command ghi đều yêu cầu `request.template.manage`.
- Backend `request_user_can_manage`, template/version select và `list_request_templates` được chuyển sang canonical capability. RED Cloud xác nhận legacy RQ còn giữ manage; GREEN rehearsal rollback xác nhận bỏ canonical manage thì legacy không giữ quyền, view vẫn đọc được list.
- Regression mục tiêu: 4 files / 33 tests pass. Full suite: 398 files / 1.896 tests pass; TypeScript/build pass (chunk warning hiện hữu); baseline 56 active / 402 archived; query audit/check 0; dry-run chỉ có migration `20260914092853`.
- Audit rộng còn thấy các helper compatibility khác (`is_module_admin`, `can_access_module`, Chat/AI và lifecycle/projection). Không xóa cơ học: phải phân loại consumer quyết định quyền với consumer audit/guard/projection trước Task 13.

### E2 Cloud postflight

- Migration `20260914092853` đã apply lên Cloud main; surface smoke standalone exit 0 và rollback.
- Postflight: 6 canonical Request template managers, 32 canonical viewers, `legacyOnlyRequestManagers=0`, `persistedBatches=0`. Smoke không giữ lại thay đổi quyền tài khoản thật.

## E3 — Canonical Chat và AI Learning helpers

- `chat_v2_has_app_access` chuyển từ `role/allowed_modules` sang `system.chat.view/manage`; vì helper nằm trong restrictive RLS, bỏ grant canonical sẽ chặn API/storage Chat thay vì chỉ ẩn menu.
- `can_manage_ai_learning` chuyển từ `role/admin_modules/admin_sub_modules` sang hợp đồng `settings_has_action('ai_learning', true)`; SYSTEM_ADMIN vẫn cấp quyền cha `system.settings.manage` cho Admin hiện hành.
- RED Cloud: tắt `system.chat.view` trong transaction vẫn còn truy cập do legacy field. GREEN rehearsal rollback: helper trả deny và Admin vẫn quản trị AI Learning qua nguồn canonical.
- Full suite: 398 files / 1.897 tests pass; TypeScript/build pass (chunk warning hiện hữu); baseline 57 active / 402 archived; query check 0; dry-run chỉ có migration `20260914093239`.

### E3 Cloud postflight

- Migration `20260914093239` đã apply lên Cloud main; helper smoke standalone exit 0 và rollback.
- Postflight: 54 tài khoản có Chat qua capability canonical, `legacyOnlyChatUsers=0`, `persistedBatches=0`. Không có thay đổi grant thật được lưu.

## E4 — Legacy runtime dependency gate

- Cloud còn 17 function tham chiếu trực tiếp bốn cột legacy; phần lớn là guard/projection/lifecycle phải giữ đến Task 13. Hai decision helper còn hoạt động là `is_module_admin` và `can_access_module`.
- Fan-out hiện tại: `is_module_admin` xuất hiện trong 57 function và 130 policy; `can_access_module` trong 2 function và 11 policy. Chi tiết và thứ tự chia cohort được ghi tại `authorization-v2-task12-4-2-legacy-runtime-dependencies.md`.
- Kết luận kiểm soát: chưa có manifest thu hồi thật đủ điều kiện duyệt. Thay helper dùng chung bằng phép “any manage/view” bị loại vì có thể nâng quyền hẹp thành quyền toàn module.

## F2 — Multi-replacement command và preview cohort WMS

**Đính chính sau review F3:** mapping WMS v1 trong checkpoint này chưa tương đương về hành vi và không được sử dụng để apply. Các số 63/63 replace, 207 grant cần bổ sung chỉ mô tả preview v1 đã bị loại; trạng thái hiện hành ở F3 bên dưới.

- Manifest builder hỗ trợ một source legacy được thay bằng nhiều DIRECT capability cùng scope/expiry. Nếu bất kỳ target nào thiếu permission hoặc mở rộng scope, toàn item chuyển sang `manual_review`; target trùng bị loại ổn định ở builder và bị Cloud command từ chối phòng thủ.
- Migration `20260914095129` đã apply Cloud main. Command mới bao transaction cũ: target đầu tiên và mọi target bổ sung cùng commit/rollback; receipt lưu toàn bộ ID được dùng/tạo. Restore chỉ xóa grant do chính batch tạo, giữ grant đã tồn tại từ nguồn khác, rồi khôi phục source cũ. Entry point single-target cũ đã bị thu hồi quyền EXECUTE trực tiếp.
- TDD: unit RED 2 ca multi-target trước sửa; GREEN hiện 11/11. Cloud reconciliation RED trên command cũ; GREEN sau migration với hai replacement, idempotent apply, stale apply/restore guard và restore đầy đủ. Bốn smoke tương thích ngược Task 12.4.2 đều exit 0; mọi fixture rollback.
- Mapping WMS được chốt theo catalog Cloud active/direct-assignable: shell Xem → 3 quyền đọc; shell Quản lý → đủ 13 quyền đọc/thao tác. Tất cả source hiện hành đều `global/*`, không expiry.
- Preview riêng tư hiện tại: 40 user, 63 source (`system.wms.view=40`, `system.wms.manage=23`), 63/63 item `replace`, 0 `manual_review`, 419 replacement references. Trong đó 212 reference đã có grant active và 207 grant thao tác còn thiếu sẽ được tạo; không có tên/email trong log, manifest có UUID chỉ nằm ở thư mục tạm mode 0700/file 0600.
- **Chưa apply batch WMS thật.** 40 quyền shell và helper legacy vẫn còn nguyên. Cần operator duyệt đúng cohort/diff trước apply; helper WMS chỉ được cutover sau khi batch thành công, rồi mới quan sát và cân nhắc revoke các nguồn legacy tiếp theo.
- Baseline sau migration: 58 active / 402 archived; TypeScript pass. Việc apply schema command không tự tạo grant và không đổi quyền tài khoản thật.

## F3 — Loại mapping WMS làm tăng quyền ngoài ý muốn

- Kiểm lại `app_private.material_issue_actor_can_reverse(uuid,text)` trên Cloud và `canReverseWmsTransaction` ở client: Hủy duyệt yêu cầu chính xác `wms.transaction.reverse` từ nguồn canonical; shell `system.wms.manage` không đáp ứng điều kiện này.
- Cloud read-only xác nhận 23 tài khoản có shell Quản lý, **0/23 có quyền Hủy duyệt global**, `persistedBatches=0`. Vì vậy đề xuất v1 cấp đủ 13 quyền sẽ làm tăng quyền Hủy duyệt và chưa được phép gọi là chuyển đổi tương đương. Không batch v1 nào đã apply.
- Mapping v2 đưa toàn bộ `system.wms.manage` vào `manual_review` để đối chiếu từng action/API. Preview mới: 40 user, 63 source, 40 read replacements/120 references và 23 manual-review items. Không tự cấp 207 grant của đề xuất cũ. Preview có blocker trả exit 2, chỉ xuất `review-required.json` quyền 0600, không xuất executable `manifest.json`.
- Test builder đã tái hiện v1 fail và v2 pass. Cloud reconciliation mở rộng xác nhận: target thứ hai sai catalog rollback target đầu; duplicate bị từ chối; target đầu đã tồn tại được giữ, target thứ hai do batch tạo bị xóa khi restore; checksum toàn bộ source sau restore khớp trước apply. Tất cả writes trong test rollback.
- Sửa selector fixture để tránh chọn tài khoản đã có `settings.general.view`; lần test đầu vướng unique constraint ở dữ liệu fixture, lần sau exit 0. Không xóa hay ghi đè grant thật để chạy test.
- Fetch và merge-tree với `origin/main` (`abc35de`) không có conflict Git. Workspace root có chỉnh sửa chưa commit và một bản plan chưa tracked khác đúng dòng tiến độ; chưa thay đổi các file đó.
- Gate dữ liệu còn mở: kiểm equivalence các thao tác WMS, hoàn thiện API coverage B–E và xác nhận persona trên frontend phát hành trước batch thật. Đây là việc triển khai còn lại, không phải thiếu xác nhận “tiếp tục” từ operator.

## E5 — WMS từ chối action ngoài catalog

- Cloud RED chứng minh `wms_has_action('wms.unknown_action.for_smoke')` trả allow cho Admin qua nhánh legacy. Migration `20260914151015` thêm điều kiện action WMS phải tồn tại và active trước khi xét các nguồn hiện hữu; null/khác module/unknown/inactive trả false.
- Thử migration cùng smoke trong transaction rollback đạt. So trước/sau 91 tổ hợp action/kho trên 3 persona (Admin, Employee, Warehouse keeper) giữ nguyên quyết định cho action active. Đây không phải nghiệm thu toàn bộ endpoint WMS hay cutover các helper legacy.
- Dry-run chỉ liệt kê migration trên; đã xác minh ref `.env` và linked đều là Cloud main `ftciqmqhmfvjtwoycswe`, apply và smoke standalone đạt. Postflight: 13 action WMS active, 40 view shell/23 manage shell và 0 transition batch thật.
- Security advisor: 205 findings toàn project (15 search_path, 5 extension/public, 11 anon definer, 173 authenticated definer, 1 leaked-password protection); không finding nào chỉ tới `wms_has_action`. Không coi tổng advisor này là bằng chứng mọi finding cũ đã được xử lý.
- Playwright editor 3/3 pass, targeted manifest/WMS/return-policy 23/23 pass. Migration baseline 59 active/402 archived. Test reconciliation bổ sung tại F3 cũng đã rollback thành công trên Cloud.

## E6 — Bảo toàn capability Hủy duyệt canonical-only

- Cloud RED sau E5: `wms_has_action('wms.transaction.reverse')` vẫn trả allow cho Admin không có capability reverse vì nhánh legacy/module/keeper. Điều này lệch hợp đồng đã phát hành của `material_issue_actor_can_reverse` và client `canReverseWmsTransaction`.
- Migration `20260915010215` giới hạn riêng mã nhạy cảm `wms.transaction.reverse`: chỉ nguồn canonical global/warehouse qua `has_permission` được chấp nhận; Admin, shell WMS và Warehouse keeper không tự có quyền này. Các action WMS khác giữ nguyên hành vi E5.
- Smoke tạo canonical reverse grant trong transaction để chứng minh deny-before/allow-after rồi rollback. Cloud standalone smoke và `material_issue_reversal_return_smoke` đều đạt; migration ledger có đúng một dòng.
- Postflight giữ `persistedBatches=0`, 40 view shell và 23 manage shell. Không grant/revoke quyền tài khoản thật; thay đổi chỉ làm helper dùng chung tuân đúng quy tắc canonical-only đã có của Hủy duyệt.
- Migration baseline: 60 active/402 archived. Task 12.4.2 vẫn chưa chuyển 23 WMS manage shell; các source này tiếp tục `manual_review` cho tới khi từng consumer/action được đối chiếu.

## E7 — Nối capability đọc WMS tới resource helper

- Cloud RED bằng employee không có bốn trường legacy WMS nhưng có DIRECT grant theo kho: `wms.inventory.view` chưa mở `can_read_inventory_scope`; test dừng trước ca phiếu xuất. Migration `20260915010425` nối `can_read_inventory_scope` với `wms.inventory.view` và `material_issue_can_view` với `wms.transaction.view`, truyền đúng kho/người lập/người phụ trách.
- Các nhánh creator/approver/recipient, Project document và Warehouse keeper hiện hữu được giữ. `wms_has_action` tiếp tục cung cấp compatibility cho module-admin ở action không nhạy cảm, nên đây là cutover consumer đọc từng bước chứ chưa tắt fallback WMS.
- Rehearsal rollback so 112 hàng trên toàn bộ 56 tài khoản active và hai kho: không có allow hiện hữu thành deny. Smoke canonical-only đạt sau migration; catalog/sensitive-action smoke vẫn đạt.
- Migration đã dry-run một file, apply Cloud main và ledger có đúng một dòng. Postflight `persistedBatches=0`; số function chứa trực tiếp cả `is_module_admin` và `WMS` giảm từ 17 xuống 15.
- Baseline: 61 active/402 archived. Chưa chuyển quyền quản lý/xóa/xử lý/PO/attachment; các consumer này vẫn nằm trong gate WMS.

## Release/CI checkpoint — 2026-09-15

- Git `main` đã nhận SHA `a2b7737`; GitHub CI run `34916870277`, Supabase Preview check và Vercel Production deployment đều thành công. Lỗi CI trước đó được truy về test catalog phụ thuộc `.env`; service hiện chỉ yêu cầu cấu hình Supabase khi dùng gateway mặc định, còn gateway được inject vẫn kiểm payload/RPC như cũ. Runtime không cấu hình tiếp tục fail-closed.
- Phiên production hiện có là một tài khoản `EMPLOYEE`: màn hình Cài đặt chỉ hiện `Danh mục dùng chung HRM` và `Tài khoản`; khi mở danh mục HRM, UI báo chỉ có quyền Xem và toàn bộ thao tác thay đổi bị khóa. Đây là bằng chứng persona read-only cho checkpoint B, không thay cho persona Admin/HR/Thủ kho hoặc kiểm revoke.
- Cloud main khớp tới migration `20260915010425` trước E8; 56 tài khoản active (1 Admin, 50 Employee, 5 Warehouse keeper), 3 disabled, 0 transition batch/item. Không dùng phiên production để đổi grant thật.

## E8 — Tách quyền đọc và ghi tệp đính kèm WMS

- Trước E8, cùng helper `wms_transaction_attachment_can_access` bảo vệ SELECT, INSERT và DELETE của bucket riêng `wms-transaction-attachments`; vì vậy nối quyền Xem canonical vào helper cũ sẽ đồng thời mở upload/xóa. Hợp đồng mới tách SELECT sang `wms.transaction.view`, INSERT/DELETE sang `wms.transaction.approve`; các nhánh Admin, WMS module-admin, global/scoped keeper và requester hiện hữu vẫn được giữ qua compatibility helper cũ.
- TDD Cloud: smoke RED dừng ở helper đọc chưa tồn tại. Rehearsal migration + smoke rollback đạt; capability view đọc được nhưng không mutate, capability approve mutate được. Parity chạy 56 tài khoản trên 34 tổ hợp duy nhất `(type, source warehouse, target warehouse, requester)` và không có allow cũ thành deny.
- Migration `20260915012751` đã apply Cloud main. Postflight đầu phát hiện hai helper mới lặp trực tiếp `is_module_admin('WMS')`, làm dependency function trực tiếp tăng 15→17. Không sửa migration đã chạy; forward migration `20260915013536` chuyển phần compatibility về helper cũ, rehearsal lại cùng parity rồi apply. Sau forward migration, số dependency WMS trực tiếp trở về 15.
- Smoke attachment standalone, catalog WMS, canonical read, PO actual receipt và material issue reversal/return đều exit 0; fixture rollback. Ledger có đúng một row cho mỗi migration; policy SELECT/INSERT/DELETE trỏ đúng helper; `persistedBatches=0`, item=0, shell view/manage giữ 40/23.
- Baseline Git: 63 active/402 archived. E8 chỉ gỡ coupling policy attachment và mở đường capability canonical; chưa thu hồi shell, helper compatibility cũ vẫn là blocker Task 13 và 23 source `system.wms.manage` vẫn `manual_review`.

## E9 — Đồng bộ command trạng thái phiếu kho với capability

- Audit boundary UI → RPC xác nhận `canApproveWmsTransaction`/`canReceiveWmsTransaction` dùng `wms.transaction.approve/complete`, nhưng Cloud `process_transaction_status` vẫn chỉ xét `is_module_admin`, requester và `assigned_warehouse_id`. Smoke RED chứng minh direct grant approve đúng kho vẫn nhận `42501`.
- Migration `20260915015543` chuyển APPROVED/COMPLETED sang `wms_has_action`, giữ requester tự hủy và các persona Admin/module-admin/keeper qua compatibility hiện hành. Đồng thời đóng hai bypass không có trên UI: requester tự duyệt phiếu của mình và EMPLOYEE hoàn tất chỉ vì warehouse ID trùng hoặc cùng `NULL`.
- Reconciliation không định danh trên 56 tài khoản active và 7 decision tuple phiếu chưa kết thúc: 1 EMPLOYEE có capability được mở duyệt (7 tuple), 1 requester-only mất tự duyệt (1 tuple), 29 EMPLOYEE không quyền không còn lọt qua complete (203 tuple). Không có Admin/WAREHOUSE_KEEPER hợp lệ bị mất trong diff.
- Rehearsal migration + smoke rollback đạt; standalone smoke sau apply đạt, sai scope bị chặn, requester tự hủy vẫn hoạt động, fixture không rò. `po_actual_receipt_wms_smoke`, attachment/read smoke và material issue reversal/return đều đạt; fixture material return được sửa để cấp rõ approve/complete thay vì dựa vào requester bypass.
- Hai smoke rộng cũ chưa dùng làm bằng chứng E9 vì đã lệch schema trước authorization assertion: `company_procurement_flow_smoke` thiếu business-event metadata khi hoàn tất; `purchase_package_delivery_receipt_v2_smoke` còn ghi bốn cột legacy đã bị guard chặn. Đây là test debt cần sửa ở cohort tương ứng, không được ghi nhận là pass.
- Cloud postflight: migration ledger đúng 1 row, dry-run up-to-date, số function tham chiếu trực tiếp `is_module_admin('WMS')` giảm 15→14. Không grant/revoke tài khoản thật, không transition batch; 23 source `system.wms.manage` vẫn `manual_review`.
- Hồi quy trước commit: 398 files / 1.901 tests pass; 7 test WMS/material mục tiêu / 30 ca pass; TypeScript, production build, migration baseline 64/402, query audit/check và `git diff --check` đều đạt. Security advisor giữ 205 warning hiện hữu; warning của RPC này là authenticated có thể gọi SECURITY DEFINER, nhưng RPC đã kiểm quyền nội bộ và đã chủ động revoke `public/anon`.

## E10 — Đồng bộ điều chỉnh số lượng và nhận hàng theo đúng kho tác nghiệp

- Audit UI → RPC phát hiện `TransactionDetailModal` đã quyết định bằng `wms.transaction.approve/complete`, nhưng `update_transaction_items_for_receipt` và `sync_fulfillment_receipt_for_transaction` vẫn chỉ xét legacy Admin/module-admin/keeper. RPC sync còn chấp nhận `p_actor_user_id` khác JWT, làm sai danh tính người nhận được ghi vào audit nghiệp vụ.
- Migration `20260915020916` tạo helper riêng tư chọn duy nhất kho tác nghiệp như frontend: duyệt nhập và phiếu fulfillment ở kho đích, duyệt chuyển kho thường/xuất/thanh lý ở kho nguồn; hoàn tất nhập/chuyển ở kho đích và xuất/thanh lý ở kho nguồn. `process_transaction_status` được forward-fix để không còn chấp nhận grant ở sai phía của phiếu chuyển kho; hai RPC nhận hàng dùng cùng helper, và actor sync bắt buộc khớp JWT.
- TDD Cloud RED tái hiện direct grant đúng kho bị RPC điều chỉnh từ chối và grant sai phía vẫn có thể duyệt phiếu chuyển kho. Rehearsal migration + hai smoke trong một transaction rollback đạt; sau apply, hai smoke standalone đạt, gồm allow đúng scope/trạng thái, deny khác kho, deny sai phía nguồn/đích, giữ requester tự hủy và deny actor giả mạo.
- Reconciliation khử định danh quét 56 tài khoản active trên toàn bộ 20 cặp nguồn/đích của 5 kho cho phiếu chuyển kho thường: không có quyết định hiện hành nào đổi và không có allow mới. Smoke fixture riêng vẫn chứng minh grant chỉ ở sai phía bị deny, nên quy tắc mới đã được kiểm cả trên trạng thái Cloud hiện hành lẫn ca biên chủ động.
- Hồi quy `po_actual_receipt_wms_smoke`, `material_issue_reversal_return_smoke`, WMS read và attachment đều đạt; mọi fixture rollback. Postflight: ledger migration đúng 1 row, helper tồn tại nhưng `authenticated` không được gọi trực tiếp, public RPC chỉ cấp cho `authenticated/service_role`, fixture=0, transition batch/item=0 và shell view/manage giữ 40/23.
- Số function gọi trực tiếp literal `is_module_admin('WMS')` giảm 14→12; 23 source `system.wms.manage` vẫn `manual_review`. E10 không cấp hoặc thu hồi quyền tài khoản thật và chưa chạy batch WMS.
- Hồi quy trước commit: 398 files / 1.901 tests pass; TypeScript, production build, migration baseline 65/402, query audit/check và `git diff --check` đều đạt. Cloud dry-run up-to-date và security advisor mức ERROR không có issue.
- Release E10: commit `5a9bf93` đã fast-forward lên `main`; GitHub CI run `34921027177`, Supabase Preview check và Vercel Production deployment của đúng SHA đều thành công.

## E11 — Khóa danh tính actor và target trạng thái ngoài hợp đồng

- Self-review E10 phát hiện `process_transaction_status` kiểm quyền theo JWT nhưng vẫn ghi `p_approver_id` do client truyền, nên caller hợp lệ có thể ghi nhận một user khác; target `PENDING` cũng không đi qua nhánh kiểm quyền nào. Call graph hiện hành chỉ truyền user đang đăng nhập và chỉ dùng APPROVED/COMPLETED/CANCELLED, vì vậy hai hành vi này không phải yêu cầu tương thích.
- Smoke RED trên Cloud E10 chứng minh approver giả mạo được chấp nhận. Migration `20260915022522` bắt buộc approver khác `NULL` phải khớp JWT, luôn ghi actor suy từ JWT và từ chối target ngoài APPROVED/COMPLETED/CANCELLED bằng `22023` trước khi đọc chứng từ.
- Rehearsal migration + smoke rollback đạt và không để lại schema/fixture. Sau apply, smoke command, receipt, PO actual receipt và material issue reversal/return đều đạt; fixture=0, migration ledger đúng 1 row, actor/target guard có mặt, `anon` không có EXECUTE và transition batch/item vẫn bằng 0.
- `phase4_permission_surface_smoke` ban đầu dừng ở fixture cũ trước assertion liên quan. Fixture đã được cập nhật để không ghi bốn cột legacy, dùng kho GENERAL, cấp quyền nhạy cảm có expiry và biểu diễn own scope bằng `*`; smoke sau đó đạt trên Cloud và rollback. Guard production không bị nới để phục vụ test.
- Full gate: lần chạy song song đầu tiên có một timeout 15 giây ở test quét query trong lúc build/audit cùng dùng tài nguyên; chạy lại riêng toàn suite đạt 398/398 files, 1.901/1.901 tests. TypeScript, production build, migration baseline 66/402, query audit/check, Cloud dry-run up-to-date, Security Advisor mức ERROR và `git diff --check` đều đạt.
- Release E11: commit `812c8a8` đã fast-forward lên `main`; GitHub CI run `34921408506`, Supabase Preview check và Vercel Production deployment của đúng SHA đều thành công.

## E12 — Tách capability theo stage nhận hàng PO

- Audit call graph xác nhận cùng helper legacy `current_user_can_receive_purchase_batch_v2` đang phục vụ ba private implementation: duyệt SL/CL cần `wms.transaction.approve`, còn finalize nhập kho cần `wms.transaction.complete`. Gộp hai capability thành một phép OR ở public boundary sẽ làm approve-only có thể complete hoặc ngược lại, nên phương án đó bị loại.
- Migration `20260915023633` đặt guard action-specific tại bốn public wrapper, chuyển wrapper sang `SECURITY DEFINER` với `search_path=''`, và thu hồi EXECUTE của `authenticated` khỏi ba implementation cùng helper riêng tư. Helper nội bộ giữ legacy persona và nhận thêm hai capability canonical để implementation chạy sau khi public guard đã xác nhận đúng stage.
- Smoke RED trước migration chứng minh authenticated còn gọi thẳng private implementation. Rehearsal migration + smoke + reconciliation rollback đạt: approve-only chỉ vào được duyệt SL/CL, complete-only chỉ vào được finalize, actor khác JWT bị chặn và private bypass bị đóng.
- Reconciliation khử định danh trên 56 tài khoản active × 5 kho không có legacy allow nào bị mất; 1 employee đã có capability canonical được mở thêm đúng đường nhận hàng ở 5 kho. Sau apply, stage smoke, reconciliation, WMS receipt command và PO actual receipt đều đạt; mọi fixture rollback.
- Postflight: migration ledger đúng 1 row, bốn public wrapper có `SECURITY DEFINER`, authenticated chỉ gọi public wrapper, transition batch/item=0 và shell view/manage giữ 40/23. `create_purchase_order_supplier_return` chưa cutover: UI chỉ cho Admin/thủ kho tổng, backend còn Project PO manager/WMS module-admin; gán sang `wms.transaction.create` lúc này có thể tăng quyền nên tiếp tục `manual_review`.
- Full gate: 398/398 files, 1.901/1.901 tests; TypeScript, production build, migration baseline 67/402, query audit/check, Cloud dry-run up-to-date, Security Advisor mức ERROR và `git diff --check` đều đạt. E12 không tạo grant, không thu hồi shell và không chạy transition batch thật.
- Release E12: commit `1449822` đã fast-forward lên `main`; GitHub CI run `34922221577`, Supabase Preview check và Vercel Production deployment của đúng SHA đều thành công.

## E13 — Nối tạo/gửi phiếu xuất cấp với capability canonical

- Audit tách riêng hai boundary rõ nghĩa: tạo draft và gửi phiếu đều sinh giao dịch xuất kho tại `source_warehouse_id`, nên dùng `wms.transaction.create`. Các thao tác xác nhận nhận, hoàn, quyết toán và hủy không được gộp vào E13 vì cùng helper legacy hiện phục vụ nhiều chủ thể và ý nghĩa nghiệp vụ khác nhau.
- Smoke RED trên Cloud chứng minh employee có direct grant `wms.transaction.create` đúng kho vẫn bị `create_material_issue_order` từ chối. Migration `20260915024855` thêm helper canonical-only không kéo theo fallback module-admin/thủ kho, rồi cộng đúng capability này vào helper tạo/gửi trong khi giữ nguyên Admin, WMS module-admin, keeper, người lập và quyền Project hiện hữu.
- Rehearsal migration với smoke, reconciliation, WMS catalog và material issue reversal/return đạt trong transaction rollback. Reconciliation trên 56 tài khoản active × 5 kho không có legacy allow nào bị mất; 1 employee có canonical create được mở đúng 5 quyết định tạo và 5 quyết định gửi phiếu của người khác.
- Dry-run chỉ liệt kê migration E13; apply Cloud main và năm smoke/reconciliation standalone đều đạt. Postflight: ledger đúng 1 row, ba helper mới không cấp EXECUTE cho authenticated, direct dependency WMS giảm 12→11, fixture=0, transition batch/item=0 và shell view/manage giữ 40/23.
- Full gate: 398/398 files, 1.901/1.901 tests; TypeScript, production build, migration baseline 68/402, query audit/check, Cloud dry-run up-to-date và `git diff --check` đạt. Security Advisor có 0 ERROR; ba WARN liên quan là public command `SECURITY DEFINER` chủ đích có kiểm quyền nội bộ. Cloud DB lint vẫn báo chín lỗi tồn đọng ở function ngoài E13 và không chỉ tới helper/function mới của checkpoint này.

## E14 — Tách quyền xử lý phiếu xuất cấp theo nghiệp vụ

- Cloud call graph trước migration xác nhận `material_issue_can_process` chỉ phục vụ bốn boundary: xác nhận nhận hàng, tạo hoàn trả, quyết toán và hoàn tác quyết toán. Không có nhánh Project/Room trong contract hiện hành. Phương án dùng một capability chung cho cả bốn bị loại.
- Hợp đồng mới: `confirm_material_issue_receipt` nhận thêm canonical-only `wms.transaction.complete` đúng kho nguồn; `create_material_issue_return_v2_impl` nhận thêm canonical-only `wms.transaction.create` đúng kho nguồn. Cả hai vẫn giữ Admin, WMS module-admin, thủ kho đúng kho/toàn kho, creator, responsible và employee recipient. Quyết toán/hoàn tác có helper riêng nhưng giữ exact compatibility và tiếp tục `manual_review`; không suy `complete` hoặc `reverse` thành quyền quyết toán.
- Smoke Cloud RED dừng đúng vì helper action-specific chưa tồn tại. Migration `20260915045138` tạo năm helper private với `search_path=''`, thu hồi EXECUTE client, nối bốn command và drop helper dùng chung cũ. Rehearsal migration + smoke capability + reconciliation + đảo/hoàn + quyết toán đạt trong transaction rollback.
- Reconciliation trên 56 tài khoản active × 5 kho × bốn quan hệ actor không có `unexpected_legacy_loss` hoặc thay đổi ở quyết toán/hoàn tác. Chỉ 1 EMPLOYEE được mở xác nhận nhận ở 5 kho bởi `complete` và 1 EMPLOYEE được mở tạo hoàn ở 5 kho bởi `create`; smoke command thực tế xác nhận allow đúng kho, deny sai kho, đồng thời giữ creator/responsible/employee recipient/keeper.
- Dry-run chỉ liệt kê migration E14; migration đã apply Cloud main và ledger có đúng một dòng. Bảy smoke/reconciliation standalone đạt; fixture còn lại 0. Postflight: helper cũ không còn, đủ 5 helper mới, `authenticatedPrivateExecute=0`, direct dependency literal WMS vẫn 11, transition batch/item=0, shell view/manage giữ 40/23 và bốn flag legacy giữ nguyên.
- Security Advisor có 0 ERROR. Bốn WARN liên quan là bốn public command `SECURITY DEFINER` được client gọi có authorization guard nội bộ; năm helper private mới không xuất hiện trong finding. Tổng 209 WARN là baseline toàn project, không được diễn giải là advisor toàn dự án sạch.
- Full gate sau apply: 398/398 files, 1.901/1.901 tests; TypeScript, production build, migration baseline 69/402, query audit/check, Cloud dry-run up-to-date và `git diff --check` đều đạt. Build chỉ còn cảnh báo chunk size hiện hữu.
- Release E14: commit `96e31fe` đã fast-forward lên `main`; GitHub CI run `34931058538`, Supabase Preview và Vercel Production deployment của đúng SHA đều thành công.

## E15 — Nối hủy phiếu xuất cấp trước xuất với quyền duyệt

- Audit xác nhận `cancel_material_issue_order` chỉ áp dụng trạng thái `draft/submitted/wms_pending`, đồng thời hủy giao dịch WMS còn `PENDING`. UI WMS dùng quyền approve cho hành động từ chối, nên E15 chốt canonical-only `wms.transaction.approve` đúng kho nguồn; `wms.transaction.reverse` dành cho đảo phiếu sau xuất và không được dùng ở boundary này.
- Smoke Cloud RED dừng đúng vì helper cancel action-specific chưa tồn tại. Migration `20260915050534` tạo `app_private.material_issue_can_cancel`, giữ Admin/WMS module-admin/người lập, thêm canonical approve đúng kho, thu hồi EXECUTE client và nối public command tới helper.
- Rehearsal migration + smoke/reconciliation + smoke E14/đảo hoàn/WMS command đạt trong transaction rollback. Smoke command thật xác nhận approve đúng kho hủy cả phiếu và WMS pending, ghi actor từ JWT; approve sai kho và reverse-only bị chặn; creator vẫn hủy draft của mình.
- Reconciliation 56 tài khoản active × 5 kho × hai quan hệ creator không có `unexpected_legacy_loss`; chỉ 1 EMPLOYEE được mở hủy phiếu của người khác ở 5 kho bởi canonical approve. Dry-run chỉ liệt kê E15; migration đã apply Cloud main và năm smoke/reconciliation standalone đạt.
- Postflight: ledger đúng 1 row, helper tồn tại/command đã nối, authenticated không gọi helper private, fixture=0, transition batch/item=0, shell view/manage giữ 40/23 và direct dependency literal WMS vẫn 11. Security Advisor có 0 ERROR; WARN liên quan duy nhất là public `cancel_material_issue_order` SECURITY DEFINER có guard nội bộ, helper private không có finding.
- Full gate sau apply: 398/398 files, 1.901/1.901 tests; TypeScript, production build, migration baseline 70/402, query audit/check, Cloud dry-run up-to-date và `git diff --check` đều đạt. Build chỉ còn cảnh báo chunk size hiện hữu.
- Release E15: commit `fa70e4c` đã fast-forward lên `main`; GitHub CI run `34931750215`, Supabase Preview và Vercel Production deployment của đúng SHA đều thành công.

## E16 — Đối chiếu boundary trả hàng nhà cung cấp

- Audit xác nhận UI phát hành chỉ hiển thị/tác nghiệp trả NCC cho Admin hoặc thủ kho tổng, trong khi `create_purchase_order_supplier_return` còn cho WMS module-admin và actor có `project.material_po.manage`. Canonical `wms.transaction.create` là một tập quyền thứ ba; không tập nào có thể được coi là tương đương cơ học.
- Reconciliation Cloud khử định danh trên 56 tài khoản active × 15 context PO/kho cho thấy RPC hiện rộng hơn UI ở 285 quyết định. Phương án cộng `wms.transaction.create` sẽ mở thêm 15 quyết định RPC và cả 15 đều rộng hơn UI phát hành; `unexpected_legacy_loss=0`. Test chạy trong transaction rollback, không để lại fixture hoặc grant.
- E16 giữ `create_purchase_order_supplier_return` ở `manual_review`. Không có migration, không đổi catalog/UI/backend, không tạo batch và không cấp/thu hồi quyền tài khoản thật. Muốn cutover boundary này phải chốt capability trả NCC riêng cùng owner nghiệp vụ, sau đó đồng bộ UI + RPC + persona test; không suy từ quyền tạo giao dịch WMS.
- Release evidence E16: commit `fcf4922` đã fast-forward lên `main`; GitHub CI run `34932234367`, Supabase Preview và Vercel Production deployment của đúng SHA đều thành công.

## E17 — Cô lập compatibility xóa yêu cầu WMS

- Audit call graph xác nhận policy DELETE của `public.requests` chỉ gọi `material_request_can_delete_v3`: v3 tự xử lý origin Project bằng Room action `material_request/delete` và gọi `_v2` cho origin WMS. Helper v1 không có runtime caller; v1/v2 vẫn có thể bị client gọi trực tiếp và cùng lặp fallback `is_module_admin('WMS')` dù catalog chưa có action xóa WMS tương đương.
- Smoke Cloud RED dừng đúng vì compatibility helper chưa tồn tại. Migration `20260915052209` gom nguyên predicate WMS vào `material_request_wms_can_delete_compatibility`, nối v1/v2 tới helper, giữ nhánh Project nguyên trạng và thu hồi direct EXECUTE của `authenticated` khỏi helper/v1/v2. v3 vẫn callable bởi `authenticated` để policy RLS hoạt động; service role giữ đường trusted.
- Reconciliation Cloud trên 56 tài khoản active × 5 kho nguồn × 5 kho công trường × 4 trạng thái × 3 quan hệ actor, tổng 16.800 quyết định, có `unexpected_legacy_loss=0` và `unexpected_access_change=0`. Rehearsal và standalone sau apply đều rollback sạch; `project_warehouse_material_control_v1_smoke` cũng đạt.
- Hai smoke cũ không được dùng làm bằng chứng E17 vì dừng trước assertion liên quan: Room pilot kỳ vọng bảy action nhưng catalog hiện trả 0; Phase 3 kỳ vọng action `project.custom_material.create` đã không còn trong catalog. Không nới production guard hoặc sửa dữ liệu Cloud để ép các fixture cũ qua.
- Postflight: ledger migration đúng 1 row, helper tồn tại, authenticated EXECUTE helper/v1/v2 đều false và v3 true; số function chứa trực tiếp literal `is_module_admin('WMS')` giảm 11→10. 56 tài khoản active, transition batch/item=0. Security Advisor có 0 ERROR và không finding liên quan helper/function E17.
- Full gate sau apply: 398/398 files, 1.901/1.901 tests; TypeScript, production build, migration baseline 71/402, query audit/check, Cloud dry-run up-to-date và `git diff --check` đều đạt. Build chỉ còn cảnh báo chunk size hiện hữu.
- Release E17: commit `4f23db9` đã fast-forward lên `main`; GitHub CI run `34936388892`, Supabase Preview và Vercel Production deployment của đúng SHA đều thành công.

## E18 — Capability riêng cho quyết toán và hoàn tác quyết toán phiếu xuất cấp

- Owner nghiệp vụ đã chấp thuận hai capability riêng: `wms.material_issue.settle` và `wms.material_issue.reverse_settlement`. Cả hai chỉ nhận scope `global/warehouse`; quyền hoàn tác ở mức `sensitive` và direct grant bắt buộc có thời hạn. Không suy quyền từ `wms.transaction.complete` hoặc `wms.transaction.reverse`.
- TDD Cloud RED dừng đúng vì action catalog chưa tồn tại; registry unit RED thiếu đúng hai action. Migration `20260915064553` thêm module `wms.material_issue`, nối riêng từng capability vào helper quyết toán/hoàn tác và giữ toàn bộ nhánh compatibility Admin/WMS module-admin/thủ kho/creator/responsible/employee-recipient hiện hành.
- Smoke command thực tế chứng minh capability quyết toán không thể hoàn tác, capability hoàn tác không thể tạo quyết toán, grant ở sai kho bị chặn và hoàn tác tạo bản ghi bù trừ. Reconciliation toàn bộ 56 tài khoản active × 5 kho × 4 quan hệ × 2 action, tổng 2.240 quyết định, có `legacy_losses=0` và `unexpected_changes=0`.
- Migration đã rehearsal rollback, dry-run đúng một file rồi apply Cloud main. Năm smoke/reconciliation standalone đạt. Postflight: ledger đúng một dòng, hai action active/enforced/direct-assignable, helper private không cấp EXECUTE cho authenticated, fixture=0, transition batch/item=0 và direct dependency literal WMS giữ 10.
- Full gate sau apply: 398/398 files, 1.901/1.901 tests; TypeScript, production build, migration baseline 72/402, query audit/check, Cloud dry-run up-to-date, Security Advisor 0 ERROR và `git diff --check` đều đạt. Build chỉ còn cảnh báo chunk size hiện hữu.
- Release E18: commit `156ecf9` đã fast-forward lên `main`; GitHub CI run `34939140400`, Supabase Preview và Vercel Production deployment của đúng SHA đều thành công.

## E19 — Capability riêng cho trả hàng nhà cung cấp

- Owner nghiệp vụ đã chấp thuận capability `wms.purchase_order.return_supplier`, scope `global/warehouse`. Action này không được suy từ `wms.transaction.create`: tạo phiếu trả mới sinh WMS export `PENDING`, còn stock và finance chỉ thay đổi ở bước xử lý sau.
- TDD Cloud RED dừng đúng vì action catalog chưa tồn tại; frontend RED thiếu action và chưa hiển thị hành động từ capability riêng. Migration `20260915070008` thêm module/action, tạo helper private giữ toàn bộ Admin/WMS module-admin/thủ kho tổng/Project PO manager hiện hành rồi cộng đúng capability theo kho nguồn.
- UI phát hành thêm hành động trả NCC khi actor có capability tại ít nhất một kho và chỉ truyền các kho actor được cấp vào dialog. Backend vẫn kiểm lại kho đã chọn. Smoke command thực tế xác nhận tạo đồng thời phiếu trả và WMS export chờ duyệt; grant sai kho và actor chỉ có `wms.transaction.create` đều bị từ chối.
- Reconciliation 56 tài khoản active × 15 context, tổng 840 quyết định, có `legacy_losses=0`, `unexpected_changes=0`. 285 quyết định RPC rộng hơn UI là compatibility đã ghi ở E16 và tiếp tục được giữ để không gây breaking change; capability mới đồng bộ UI/RPC nhưng không biến generic create thành trả NCC.
- Migration đã rehearsal rollback, dry-run đúng một file rồi apply Cloud main. Ba smoke/reconciliation standalone đạt. Postflight: ledger đúng một dòng, action active/enforced/direct-assignable, helper private không cấp EXECUTE cho authenticated, command chỉ callable bởi authenticated/service role, fixture=0, transition batch/item=0 và direct dependency literal WMS giữ 10.
- Full gate sau apply: 398/398 files, 1.902/1.902 tests; TypeScript, production build, migration baseline 73/402, query audit/check, Cloud dry-run up-to-date, Security Advisor 0 ERROR và `git diff --check` đều đạt. Build chỉ còn cảnh báo chunk size hiện hữu.
- Release E19: commit `2f85420` đã fast-forward lên `main`; GitHub CI run `34940087835`, Supabase Preview và Vercel Production deployment của đúng SHA đều thành công.

## E20 — Capability riêng cho xóa yêu cầu WMS

- Owner nghiệp vụ đã chấp thuận capability `wms.request.delete`, scope `global/warehouse`. Capability chỉ áp dụng origin WMS ở trạng thái `DRAFT/PENDING/REJECTED` và được phép khớp kho nguồn hoặc kho công trường; nhánh capability không mở `APPROVED`. Quyền chung `wms.request.approve` không được suy thành quyền xóa; persona compatibility cũ vẫn được giữ riêng để không gây breaking change.
- Frontend dùng cùng helper quyết định tại nút xóa và guard mutation; luồng Project/Room giữ nguyên. Backend thêm action helper private theo mô hình compatibility OR exact capability, nối vào nhánh WMS của v1/v2; policy production tiếp tục đi `material_request_can_delete_v3 → v2`, còn nhánh Project trong v3 không đổi. Authenticated không thể gọi trực tiếp compatibility/action helper hoặc v1/v2.
- TDD Cloud RED dừng đúng vì capability chưa tồn tại. Rehearsal rollback và smoke DELETE thật đạt: direct grant đúng kho xóa được request `PENDING`; grant sai kho, actor chỉ có `wms.request.approve`, và request `APPROVED` đều không bị xóa. Mọi fixture/grant/kho/request của smoke rollback sạch.
- Reconciliation snapshot kho trước khi đổi JWT để không bị RLS làm thiếu context, chia bốn shard do statement timeout Cloud. Tổng đủ 56 tài khoản active × 5 kho nguồn × 5 kho công trường × 4 trạng thái × 3 quan hệ = 16.800 quyết định; `legacy_losses=0`, `unexpected_changes=0`. Bốn shard đều báo 14 actor/4.200 quyết định.
- Migration `20260915071458` đã dry-run đúng một file rồi apply Cloud main. Postflight: ledger đúng một dòng/latest, action active/enforced/direct-assignable, action/compatibility helper cùng v1/v2 không cấp EXECUTE client, v3 vẫn callable cho RLS, fixture=0, transition batch/item=0 và direct dependency literal WMS giữ 10.
- Full gate sau apply: 398/398 files, 1.903/1.903 tests; TypeScript, production build, migration baseline 74/402, query audit/check, Cloud dry-run up-to-date và `git diff --check` đều đạt. Security Advisor có 0 ERROR và không finding liên quan capability/helper E20. Cloud DB lint vẫn có chín lỗi tồn đọng ngoài E20; helper/function mới không xuất hiện trong danh sách lỗi. Build chỉ còn cảnh báo chunk size hiện hữu.
- Release E20: commit `1790ff6` đã fast-forward lên `main`; GitHub CI run `34942620397`, Supabase Preview và Vercel Production deployment của đúng SHA đều thành công.

## E21 — Làm mới inventory và preview manifest WMS

- Snapshot Cloud read-only lúc `2026-09-15T09:58:13Z` ghi nhận 56 tài khoản `ACTIVE`, 3 `DISABLED`, 50 nhóm grant hệ thống đang hoạt động và 12 nhóm assignment role đang hoạt động; không ghi định danh tài khoản vào Git và không tạo mutation.
- Cờ hardening vẫn đúng: `legacy_fallback_disabled=true`, `legacy_governance_fallback_disabled=true`, `legacy_projection_enabled=false`, `legacy_permission_writes_disabled=true`. Cloud giữ `0 transition batch / 0 transition item`, migration mới nhất `20260915071458`, 10 function gọi trực tiếp literal `is_module_admin('WMS')`.
- WMS preview dùng snapshot Cloud hiện tại: 40 nguồn `system.wms.view` → 120 replacement references (40 `replace`); 23 nguồn `system.wms.manage` vẫn `manual_review`, không sinh executable manifest. Đây là kết quả chủ ý vì shell manage không tương đương toàn bộ capability WMS.
- Inventory SQL và preview script chạy thành công trên Supabase Cloud, không cấp/gỡ quyền và không tạo batch. Unit test manifest tiếp tục phải giữ các invariant stale hash, scope expansion, expired source và manual review.
- E21 exit đạt ở mức inventory/preview. Bước kế tiếp là E22: đối chiếu 23 `system.wms.manage` theo consumer và persona để quyết định source nào `retain`, source nào có replacement canonical, và source nào cần operator duyệt riêng; chưa được apply batch thật.

## E22 — Audit consumer/persona cho `system.wms.manage`

- Cloud read-only xác nhận 23 shell grant đều `global/*`: 1 Admin, 17 Employee không gán kho, 3 thủ kho toàn kho và 2 thủ kho gán kho. Cả 23 đã có bốn direct canonical grant đọc/master-data (`wms.inventory.view`, `wms.master_data.manage`, `wms.request.view`, `wms.transaction.view`), nhưng chưa có direct grant canonical cho nhóm thao tác nhạy cảm từ snapshot này.
- Call-graph audit xác nhận 10 function consumers và 17 policy rows còn đi qua `wms_has_action` hoặc compatibility: binding kho/site, nhận PO, custom-material select, hủy phiếu xuất cấp, tạo/gửi phiếu, xử lý phiếu, xóa yêu cầu, trả NCC, boundary WMS dùng chung và attachment object.
- Ma trận consumer → capability ứng viên → disposition đã ghi tại [WMS manage audit](authorization-v2-task12-4-2-wms-manage-audit.md). Không consumer nào được tự động map `system.wms.manage` thành toàn bộ capability; các boundary composite đều `manual_review` hoặc giữ compatibility cho tới khi owner chốt actor/kho/nghiệp vụ.
- E22 chạy inventory/persona/call-graph SQL read-only thành công, không cấp/gỡ quyền, không tạo batch và không đổi schema. E22 exit đạt ở mức audit: 23/23 source có lý do rõ; chưa đạt điều kiện để sinh manifest executable hoặc revoke shell.
- Bước kế tiếp là E23: đóng các cohort ngoài WMS và thu thập owner decision cho các nhóm WMS có thể thay thế theo actor/kho; chỉ sau đó mới tạo manifest có định danh trong evidence store riêng.
- Trong lúc kiểm release, Supabase Preview phát hiện remote-only migration `20260915094533_request_attachment_processor_rpc_wrappers` chưa có trong local checkout. Đã đối chiếu trực tiếp `supabase_migrations.schema_migrations.statements`, bổ sung đúng migration wrapper service-role vào local và allowlist baseline; không apply lại, không sửa Cloud và không thay đổi quyền tài khoản. Đây là drift reconciliation bắt buộc để ledger Git/Cloud khớp trước E23.

## E23 — Audit cohort ngoài WMS và owner-decision gate

- Snapshot Cloud read-only có 56 tài khoản active: 2 Admin, 49 Employee, 5 Warehouse Keeper. Thay đổi 1 Admin/50 Employee ở E22 thành 2 Admin/49 Employee là thao tác quản trị do người dùng thực hiện trước E23, không phải mutation của audit này. Hardening flags vẫn đúng và transition ledger giữ 0 batch/0 item.
- Ngoài WMS có 356 direct source active thuộc 36 mã; catalog có 40 action. Mapping E23 ghi disposition rõ cho đủ 40/40: sáu capability `system.authorization.*` được bảo vệ bằng `retain`, mọi shell business còn lại là `manual_review` cho tới khi owner chốt action/actor/scope.
- Persona reconciliation xác nhận role label không tương đương full app: Project Room đang có 39/398/104 membership và 174/993/258 active action tương ứng Admin/Employee/Warehouse Keeper; workspace có 2 Admin membership và 1 Employee membership. Không được thay shell bằng quyền global dựa trên persona.
- Call graph còn literal legacy boundary tại DA 24 function/64 policy, EX 1/0, FEEDBACK 1/0, HD 0/76, PROCUREMENT 1/0, RQ 2/0, SETTINGS 2/26, TENDER_AI 0/24, TS 2/6 và WF 14/8. Consumer trực tiếp bằng permission code vẫn phải được audit riêng; không suy revoke từ việc không có literal hit.
- Owner decision register ghi 15 cohort `owner_pending`, gồm 14 nhóm business ngoài authorization và `system.wms.manage`; không tái sử dụng disposition lịch sử như phê duyệt owner hiện tại.
- Cloud preview đối chiếu đủ 356 source: 353 `manual_review`, 3 `retain`, 0 `replace`, 0 `revoke`, 0 replacement reference. Evidence directory/file đạt mode 0700/0600; script exit code 2 đúng gate, chỉ tạo `review-required.json`, không tạo executable manifest.
- E23 hoàn tất sáu đầu việc audit/reconcile/call-graph/decision-register/preview/manifest-gate và không thay đổi Cloud. Bước kế tiếp chỉ được mở sau khi owner ký nhận mapping theo actor/scope và preview mới có 0 manual review.
