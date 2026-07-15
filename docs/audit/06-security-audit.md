# 06. Security audit

## Executive security position

Security posture hiện tại là high risk cho tới khi hai P0 được xác nhận/contain trên live:

1. Authenticated arbitrary dynamic SQL dưới SECURITY DEFINER.
2. HR/payroll PII và write policies cho anon/public trong cloud baseline, không có later hardening tương ứng trong source.

Sau đó ưu tiên contract mutation, AI confused deputy, storage scope, active-session admin và legacy/project authorization.

## Threat model

| Threat actor | Capability giả định | Tài sản bị đe dọa |
|---|---|---|
| Anonymous internet user | anon key công khai, public API/bucket | HR/payroll, files, auth bootstrap |
| Ordinary authenticated employee | JWT hợp lệ, direct PostgREST/RPC | Cross-project/HR/contract/finance data |
| Inactive/compromised admin session | JWT chưa hết hạn | User creation/password reset |
| AI user | ai.assistant.use | Service-role cross-domain reads |
| Malicious data editor | Lưu item/note/name | Stored XSS khi người khác in |
| Operational mistake | Migration drift/direct apply | Policy hardening không deployed hoặc rollback sai |

## Authentication/session flow

~~~mermaid
flowchart TD
    JWT[Supabase JWT] --> GU[getUser]
    GU --> PF[public.users profile]
    PF --> ACTIVE{is_active?}
    ACTIVE -->|no| DENY[Deny + revoke session]
    ACTIVE -->|yes| GR[explicit grants + scope]
    GR --> RLS[RLS/RPC/Edge authorization]
    RLS --> DATA[Scoped data/command]
~~~

Current client/Edge deviations:

- AppContext giữ cached/mock ADMIN nếu profile lookup không thành công.
- create-user/reset-password không check is_active.
- legacy grant fetch errors fallback.
- Auth profile trigger trong baseline tin user_metadata nếu public signup/trigger còn active.

## P0 evidence

### SEC-001 — Dynamic SQL SECURITY DEFINER

Migration grants authenticated EXECUTE; baseline captured dynamic EXECUTE definitions. Một normal JWT có thể gọi RPC trực tiếp ngoài UI. Đây không phải “AI feature only”; nó là public RPC surface. Recommendation audit-only: chuẩn bị immediate revoke/drop migration, catalog snapshot, log review và secret rotation decision; không chạy exploit trên production.

### SEC-002 — HR/payroll exposure

May-21 cloud inventory cho thấy:

- <code>employees_select USING(true)</code> role public với phone/email/DOB/marital/employment fields.
- Labor contracts globally selected, gồm base salary/allowances.
- <code>hrm_documents</code> ALL true.
- <code>hrm_leave_logs</code> anon/authenticated select/insert/update/delete true.
- KPI/salary grade/3P tables ALL true và anon table privileges.

June/July migrations không thay thế toàn bộ policies này. Vì repository có drift, live catalog query là bước đầu tiên; không dùng kết luận snapshot để chạy một broad destructive migration.

## Authorization

### Contract

Contract header SELECT và several resource/catalog/appendix ALL policies dùng true. Phase 4 chỉ seed action codes, không bind chúng vào tables. Ordinary authenticated direct API can bypass UI. Đây là SEC-003/P1.

### AI service role

<code>ai-assistant</code> tạo admin client; main data mode chỉ cần <code>ai.assistant.use</code>. TOOL_ACCESS chỉ định 4 cost tools; mọi tool khác auto-allow. RPC service-role trả project finance, WMS, attendance, employee data; employee search gồm phone/email/DOB/marital status. Knowledge mode cũng không enforce <code>kb.view</code>. Đây là SEC-004/P1.

~~~mermaid
sequenceDiagram
    participant U as AI user
    participant E as ai-assistant
    participant A as TOOL_ACCESS
    participant S as Service-role client
    participant F as SECURITY DEFINER RPC
    U->>E: JWT + question
    E->>E: check ai.assistant.use
    E->>A: authorize tool
    A-->>E: allow by default if unlisted
    E->>S: admin.rpc(tool, params)
    S->>F: bypass caller RLS
    F-->>U: HR/finance/project/WMS result
~~~

### Legacy/project

Phase 5 defaults legacy fallback enabled. Frontend always falls back; <code>can_access_module('DA')</code> remains a broad project SELECT branch and does not honor the Phase 5 cutoff. Project membership cannot yet be treated as uniformly enforced.

## Edge Functions

- create-user/reset-password validate JWT/role but not active profile.
- AI special actions accept body <code>userId</code> as fallback actor; reachability depends deployed verify_jwt.
- send-web-push checks active admin correctly for admin requests and is a useful reference pattern.
- Service role is not present in browser code, a positive control.

## Storage/file upload

Broad bucket policies are documented in SEC-009. File validation is inconsistent; project document MIME allowlist exists but is not applied in upload flow. Excel parsers run in the browser on user-supplied files.

## Dependency vulnerabilities

<code>npm audit --omit=dev</code> on 2026-07-14 reported 9 production vulnerabilities: 1 critical, 7 high, 1 moderate.

- <code>xlsx 0.18.5</code>: prototype pollution and ReDoS; no patched npm release in the advisory. App parses user files in Gantt, Material, Project Dashboard, Attendance, Workflow, Assets and multiple services. See [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) and [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9).
- <code>react-router-dom 6.22.3</code>: redirect/XSS advisories; fixed version reported by npm audit is 6.30.4. Notification fallback paths can pass database <code>link</code> values to navigate. See [GHSA-2w69-qvjg-hvjx](https://github.com/advisories/GHSA-2w69-qvjg-hvjx) and [GHSA-2j2x-hqr9-3h42](https://github.com/advisories/GHSA-2j2x-hqr9-3h42).
- <code>open-docxtemplater-image-module</code> pulls vulnerable xmldom packages, including the critical multiple-root advisory [GHSA-crh6-fp67-6883](https://github.com/advisories/GHSA-crh6-fp67-6883).

Audit không cập nhật dependency. Remediation cần compatibility tests và có thể thay parser/library nếu upstream npm không có fix.

## XSS

Nhiều HTML-rendering paths dùng <code>escapeHtml</code>, nên không bị gắn finding chung chung. Tuy nhiên hai print paths chèn trực tiếp stored values vào <code>document.write</code>:

- <code>RequestModal.tsx:2155-2206,2221-2227</code>: material name/unit, batch/source/note.
- <code>InventoryDetailModal.tsx:253-260</code>: item name/SKU.

Popup about:blank cùng origin và không dùng noopener. SEC-013/P2 cần DOM/textContent hoặc escape đầy đủ và stored payload test.

## Secrets/environment

- Browser Supabase config chỉ dùng VITE URL/anon key.
- <code>vite.config.ts:5-16</code> load mọi env prefix và define Gemini key into process.env aliases. Static scan không tìm source reference nên chưa chứng minh key nằm trong current bundle; đây là config footgun, không phải confirmed leak.
- Không có tracked <code>.env.example</code> để định nghĩa safe public/server variables.
- Vault/Web Push secrets cần live presence/rotation/runbook check.

## Findings

| ID | Vấn đề | Severity | Status |
|---|---|---:|---|
| SEC-001 | Dynamic SQL SECURITY DEFINER | P0 | Confirmed |
| SEC-002 | HR/payroll anon exposure/write | P0 | Confirmed historical/intended; live urgent |
| SEC-003 | Contract read/write quá rộng | P1 | Confirmed |
| SEC-004 | AI service-role confused deputy | P1 | Confirmed |
| SEC-005 | Auth metadata có thể bootstrap ADMIN | P1, P0 nếu signup bật | Needs runtime verification |
| SEC-006 | Inactive admin vẫn dùng privileged Edge actions | P1 | Confirmed |
| SEC-007 | AI body actor spoof | P1 | Needs runtime verification |
| SEC-008 | Legacy/project scope fail-open | P1 | Confirmed |
| SEC-009 | Storage cross-scope/mutable evidence | P1 | Confirmed |
| SEC-010 | Vulnerable production dependencies | P1 | Confirmed |
| SEC-011 | users directory/username oracle | P2 | Confirmed |
| SEC-012 | Projection function caller auth | P1 | Needs runtime verification |
| SEC-013 | Stored XSS in print popups | P2 | Confirmed |

Chi tiết đủ trường nằm trong <code>10-issue-register.md</code>.

## Incident-oriented runtime checklist

1. Kiểm live proacl/definition hai SQL executors và access logs; containment change phải do owner phê duyệt.
2. Test anon read/write bằng safe empty/rollback-free requests đối với HR tables; không thử destructive writes.
3. Nếu exposure live: kích hoạt privacy/security incident process, xác định access history và secret data reachability.
4. Kiểm Auth signup, trigger bindings và crafted metadata trên isolated project.
5. Kiểm Edge verify_jwt/deployed revision và inactive admin JWT.
6. Persona matrix: anon, employee, project A member, project B member, HR, contract manager, warehouse keeper, AI-only.
7. Storage path cross-scope read/write/overwrite/delete tests.
