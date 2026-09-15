# Task 12.4.2 — Rollout log

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
