# 01. System context

## Phạm vi và thời điểm

Audit được thực hiện ngày 2026-07-14 trên commit <code>3aafb5e</code>, nhánh <code>main</code>. Đây là audit-only: không sửa source, migration, dependency, cấu hình production; không kết nối hay ghi lên Supabase Cloud; không deploy.

Baseline Git trước audit chỉ có một file chưa được track có sẵn: <code>.agent/workflows/Agent.md</code>. File này không bị sửa.

## Hệ thống được quan sát

Vioo là ERP dạng React SPA/PWA cho doanh nghiệp xây dựng, dùng:

- React 18, TypeScript, Vite, React Router và Context API ở frontend.
- Supabase Auth, Postgres, RLS, Realtime, Storage và Edge Functions ở backend.
- Vercel cho static hosting/SPA rewrite.
- Gemini qua Edge Function cho AI Assistant/Tender AI.
- Web Push qua Service Worker, pg_net trigger và Edge Function.
- Xuất/nhập Excel, Word và dữ liệu kế toán MISA ở phía client.

README hiện mô tả backend/database “giả lập”, nhưng repository thực tế đã là một ERP Supabase nhiều module. Sai lệch này được ghi nhận tại ARC-003 trong issue register.

## Actors và trust boundaries

| Actor | Mục tiêu chính | Boundary bắt buộc |
|---|---|---|
| Admin | Quản trị người dùng, quyền, module | JWT hợp lệ, profile active, quyền server-side |
| Nhân viên | Tự phục vụ, yêu cầu, thông báo | Chỉ dữ liệu bản thân/phạm vi được giao |
| Thành viên dự án | Daily Log, vật tư, hồ sơ dự án | Project/site membership và action grant |
| KTT | Kiểm tra/tổng hợp nhật ký, vật tư | Phân công cụ thể và quyền verify/summarize |
| CHT | Duyệt nhật ký/công trường | Quyền approve theo project/site |
| Thủ kho | Nhập/xuất/chuyển/hoàn tất kho | Warehouse scope và transition RPC |
| HR/Kế toán/Hợp đồng | Dữ liệu nhạy cảm nghiệp vụ | Domain permission, row scope, audit log |
| Người tra cứu công khai | QR safety card | Chỉ projection công khai tối thiểu |
| Edge Function | Tác vụ đặc quyền | Không được biến thành confused deputy |
| Dịch vụ ngoài | Gemini, Web Push, Vercel | Secret chỉ ở server; payload tối thiểu |

~~~mermaid
flowchart LR
    U[Người dùng/PWA] -->|HTTPS + Supabase JWT| SPA[React SPA]
    SPA -->|anon key + JWT| AUTH[Supabase Auth]
    SPA -->|PostgREST/RPC| DB[(Postgres + RLS)]
    SPA -->|Realtime| RT[Realtime]
    SPA -->|upload/download| ST[Storage]
    SPA -->|JWT| EF[Edge Functions]
    EF -->|service role, scoped command| DB
    EF -->|prompt/data tối thiểu| GEM[Gemini]
    DB -->|trigger + pg_net| PUSH[send-web-push]
    PUSH -->|Web Push protocol| DEV[Thiết bị người dùng]
    V[Vercel] --> SPA
~~~

## Dữ liệu nhạy cảm

- HR/payroll: hồ sơ cá nhân, ngày sinh, điện thoại, email, lương, hợp đồng lao động, nghỉ phép.
- Finance/contract: giá trị hợp đồng, ngân sách, giao dịch, đơn giá, định mức, bảo lãnh.
- Project/WMS: dự án, tiến độ, nhật ký, BOQ, tồn kho, đơn mua và giao nhận.
- Safety/quality/documents: kiểm tra an toàn, hồ sơ tuân thủ, file đính kèm, chữ ký và ảnh.
- Authorization: vai trò, module arrays, grants, project staff permissions.
- AI/knowledge: hội thoại, memory, tài liệu RAG và kết quả truy vấn nội bộ.

## Data-flow chính

~~~mermaid
sequenceDiagram
    participant B as Browser
    participant A as Supabase Auth
    participant P as Profile/permission
    participant R as RLS/RPC
    participant E as Edge Function

    B->>A: getSession + getUser
    A-->>B: verified JWT user
    B->>P: users + user_permission_grants
    P-->>B: profile/grants
    B->>R: query hoặc business command
    R->>R: bind auth.uid, scope, transition, transaction
    R-->>B: scoped result
    opt privileged integration
        B->>E: JWT + typed command
        E->>E: active user + permission + scope
        E->>R: minimum service-role operation
        R-->>E: result
        E-->>B: safe response
    end
~~~

Hiện trạng lệch khỏi flow mục tiêu ở các điểm quan trọng: dynamic SQL SECURITY DEFINER, chính sách HR/contract quá rộng, AI service-role không kiểm tra quyền từng tool, legacy fallback và nhiều transaction boundary nằm ở client. Xem SEC-001 đến SEC-009 và WF-001 đến WF-006 trong <code>10-issue-register.md</code>.

## Môi trường và nguồn bằng chứng

- Source và Git history cục bộ.
- 234 migration, 58.710 dòng SQL.
- Snapshot public schema ngày 2026-05-21: 147 tables, 143 tables bật RLS, 154 functions, 438 policies, 514 indexes và 17 triggers. Snapshot này là bằng chứng lịch sử, không được coi là trạng thái production hiện tại.
- Live-apply logs Phase 0–2 và handoff notes trong repository.
- Static import graph, test/build/type checks và npm security audit.
- Tài liệu chính thức Supabase về [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) và [securing the Data API](https://supabase.com/docs/guides/api/securing-your-api).

## Ngoài khả năng kết luận

Không có Docker daemon/local Postgres nên không thể replay migration, chạy <code>supabase db lint</code>, EXPLAIN ANALYZE hoặc SQL smoke tests. Không truy cập cloud nên chưa xác nhận current pg_policies, proacl, exposed schemas, Edge verify_jwt, Auth signup setting, row counts, query plans, bucket ACL, production logs, backups/RPO/RTO hay migration history hiện tại. Các khoảng trống này được liệt kê thành checklist runtime trong từng tài liệu.
