# VIOO Sensitive Direct-Grant Revoke-All/Regrant Design

## 1. Mục tiêu

Đóng blocker Task 13 Step 5 bằng một quy trình fail-closed hai pha:

1. thu hồi toàn bộ 467 active sensitive direct grants đang thiếu expiry;
2. chỉ cấp lại direct grants đã được business owner duyệt, đúng permission/scope và có expiry 90 ngày.

Thiết kế này là phương án thay thế cho quy trình retain/revoke theo từng
principal. Hai phương án không được chạy đồng thời.

## 2. Quyết định đã duyệt

- Phạm vi chỉ gồm 467 sensitive direct grants thuộc 23 principals và 26
  permission codes trong inventory hiện tại.
- Non-sensitive direct grants không thay đổi.
- Business Roles, responsibility assignments, legacy permission fields và
  account lifecycle không thay đổi.
- Quyền được cấp lại vẫn là direct grant; không tạo Business Role thay thế.
- Mọi quyền được cấp lại dùng cùng một cutoff UTC, đúng 90 ngày từ lúc mở
  maintenance window.
- Danh sách cấp lại phải được business owner duyệt đầy đủ trước mutation đầu
  tiên.
- Cả ba rollout flags giữ `false` trong toàn bộ quy trình.
- Mọi mutation đi qua authenticated Permission Admin và RPC
  `public.replace_user_permission_grants_v2`; không dùng bulk SQL.

## 3. Ranh giới phạm vi

### Trong phạm vi

- Snapshot tập 467 grant nguồn và lập manifest cấp lại.
- Thu hồi từng principal bằng full direct-grant replacement draft, trong đó
  giữ nguyên non-sensitive rows và bỏ toàn bộ sensitive rows thuộc tập nguồn.
- Chứng minh checkpoint toàn cục: không còn active grant nào thuộc tập nguồn.
- Cấp lại danh sách đã duyệt bằng full replacement draft, có future expiry,
  reason và SoD evidence khi cần.
- Ghi aggregate evidence và dừng trước resolver enablement.

### Ngoài phạm vi

- Bật `business_role_resolver_enabled`.
- Tắt legacy governance fallback hoặc System Admin business-approval bypass.
- Tạo/sửa/gán Business Role nghiệp vụ.
- Sửa migrations đã apply, thêm privileged bulk command hoặc hot-patch Cloud.
- Daily Log Phase 4, Payment Phase 5, workflow hoặc frontend mới.

## 4. Kiến trúc vận hành

Quy trình có bốn boundary độc lập:

### 4.1 Approved regrant manifest

Trước maintenance window, business owner phân loại toàn bộ tập nguồn:

- `REGRANT`: permission/scope được cấp lại;
- `DROP`: không cấp lại.

Manifest chứa đúng grant key
`(principal, permission_code, scope_type, scope_id)` và quyết định. Manifest
không được commit vào Git, apply log hoặc chat vì chứa principal identity và
dữ liệu phân quyền vận hành. Apply log chỉ nhận aggregate tổng số principals,
`REGRANT` rows và `DROP` rows.

Tổng `REGRANT + DROP` phải bằng đúng 467 và không có key trùng trước khi mở
maintenance window.

### 4.2 Revoke-all phase

Permission Admin xử lý tuần tự từng principal:

1. tải lại full active direct-grant draft;
2. giữ nguyên mọi non-sensitive row;
3. xóa khỏi draft toàn bộ sensitive row thuộc tập nguồn của principal;
4. preview bằng `preview_direct_grant_replacement`;
5. lưu đúng một lần bằng `replace_user_permission_grants_v2` với reason chuẩn;
6. xác minh audit và unresolved aggregate trước principal tiếp theo.

Sau principal cuối, một read-only gate phải chứng minh:

- active grant thuộc snapshot nguồn: `0`;
- active sensitive grant có null/past expiry: `0`;
- non-sensitive direct-grant delta: `0`;
- rollout flags được bật: `0`.

Đây là checkpoint bắt buộc giữa hai pha. Không cấp lại trước khi checkpoint
toàn cục PASS.

### 4.3 Regrant phase

Permission Admin tiếp tục tuần tự từng principal có `REGRANT` rows:

1. tải lại full draft sau revoke;
2. giữ nguyên toàn bộ row đang active;
3. thêm đúng các approved permission/scope keys;
4. đặt cùng future expiry 90 ngày;
5. nhập reason chuẩn;
6. preview backend và xử lý SoD warning nếu được duyệt;
7. lưu đúng một lần;
8. xác minh exact source, expiry, audit và absence của `DROP` rows.

Không được cấp lại một key không có trong manifest. Không được tự mở rộng scope
hoặc thay project/construction-site scope bằng global.

### 4.4 Final gate

Final gate chứng minh:

- active sensitive direct grants thiếu future expiry/reason: `0`;
- active regranted keys bằng đúng approved `REGRANT` aggregate;
- active dropped source keys: `0`;
- non-sensitive direct-grant delta: `0`;
- mỗi changed principal có một revoke audit event và, nếu được cấp lại, một
  regrant audit event;
- ba rollout flags vẫn `false`;
- durable rollout-operator count ít nhất `1`.

Sau gate, quy trình dừng và xin một approval riêng cho Task 13 Step 7.

## 5. Data flow

```text
Cloud read-only snapshot
        |
        v
Business-owner manifest (ephemeral, complete, approved)
        |
        v
Maintenance freeze
        |
        v
Per-principal revoke preview -> governed mutation -> audit -> verification
        |
        v
Global zero-source checkpoint
        |
        v
Per-principal regrant preview -> SoD evidence -> governed mutation -> audit
        |
        v
Final aggregate gate -> evidence log -> resolver approval checkpoint
```

## 6. Authorization và audit

- Actor phải có effective permission `system.authorization.manage_grants`.
- Actor không được sensitive-self-grant; target và actor phải tách khi backend
  rule yêu cầu.
- Public RPC tiếp tục là `security invoker`; private implementation tự derive
  actor từ authenticated session.
- Mọi full-draft change yêu cầu reason ít nhất mười ký tự.
- Mọi regranted sensitive row yêu cầu future expiry.
- Hard SoD deny dừng principal đó.
- Warning chỉ được accept khi có independent control owner, reason,
  compensating controls và future expiry.
- Exact no-op không tạo thêm audit event hoặc data churn.

Reason chuẩn:

- Revoke phase: `Task 13 Step 5: thu hồi toàn bộ quyền nhạy cảm trước tái cấp`.
- Regrant phase: `Task 13 Step 5: tái cấp quyền nhạy cảm đã được phê duyệt`.

## 7. Maintenance window và tác động nghiệp vụ

Từ khi principal đầu tiên được revoke đến khi regrant phase hoàn tất, một phần
hoặc toàn bộ 23 principals có thể mất quyền duyệt/xác nhận/verify/mark-paid và
các sensitive actions khác. Vì vậy:

- manifest phải hoàn chỉnh trước maintenance;
- business owner phải duyệt thời điểm bắt đầu;
- không mở maintenance khi có nghiệp vụ nhạy cảm đang chờ xử lý bắt buộc;
- mọi permission-editing khác phải tạm dừng;
- trạng thái tiến độ được theo dõi bằng aggregate, không bằng trí nhớ phiên chat.

Thiết kế chấp nhận gián đoạn có kiểm soát để đạt checkpoint “đã thu hồi toàn
bộ”. Đây là khác biệt chính so với phương án retain/revoke theo từng principal.

## 8. Failure handling và recovery

### Lỗi trong revoke phase

- Dừng trước principal tiếp theo.
- Không cấp lại sớm.
- Sửa lỗi vận hành hoặc forward-fix theo quy trình riêng rồi tiếp tục revoke từ
  principal chưa hoàn tất.
- Các principal đã revoke giữ trạng thái fail-closed.

### Lỗi tại zero-source checkpoint

- Không bắt đầu regrant.
- Đối chiếu aggregate snapshot với audit/history để tìm principal còn active
  source.
- Chỉ tiếp tục revoke qua governed RPC.

### Lỗi trong regrant phase

- Dừng principal hiện tại và không tự khôi phục toàn bộ snapshot cũ.
- Tiếp tục regrant từ approved manifest sau khi lỗi được xử lý.
- Quyền chưa regrant tiếp tục bị deny; đây là trạng thái an toàn mặc định.

### Dừng khẩn cấp do ảnh hưởng nghiệp vụ

Không có rollback “restore all” vì manifest đã phân loại một phần quyền là
`DROP`. Recovery hợp lệ là ưu tiên cấp lại các `REGRANT` rows đã duyệt cho
principal bị ảnh hưởng, qua cùng preview/mutation/audit path. Không update table
trực tiếp và không bật compatibility flag để che thiếu quyền.

## 9. Verification strategy

### Trước mutation

- Reconfirm baseline 467/23/26 và zero past-expiry rows.
- Prove `REGRANT + DROP = 467`, no duplicate manifest keys.
- Prove all rollout flags `false` and durable operator count at least `1`.
- Capture active non-sensitive grant count and source-key fingerprint.

### Sau mỗi principal revoke

- Source-set count decreases exactly by that principal's source-row count.
- Non-sensitive active count/fingerprint remains unchanged.
- Audit count increases by exactly one.
- Flags remain `false`.

### Giữa hai pha

- Source snapshot active count equals `0`.
- Sensitive null/past-expiry active count equals `0`.
- No regrant audit exists yet.

### Sau mỗi principal regrant

- Regranted keys exactly match the approved subset for that principal.
- Every regrant uses the shared future expiry and valid reason.
- Dropped keys remain inactive.
- Audit count increases by exactly one.

### Kết thúc

- Final SQL gate PASS.
- Supabase security/performance advisor baselines have no new issue.
- Repository tests, TypeScript and production build PASS.
- Aggregate evidence is committed and pushed to the existing draft PR.

## 10. Completion criteria

- Tập nguồn 467 rows đã được revoke hoàn toàn trước regrant đầu tiên.
- Chỉ approved `REGRANT` rows được active lại.
- Mọi regranted sensitive row có đúng scope, reason và shared 90-day expiry.
- Mọi `DROP` row vẫn inactive và giữ revoke history.
- Không có non-sensitive direct-grant drift.
- Không có Business Role, responsibility, migration-history hoặc rollout-flag
  mutation ngoài phạm vi.
- Evidence không chứa identity, token hoặc raw permission payload.
- Quy trình dừng trước resolver enablement.
