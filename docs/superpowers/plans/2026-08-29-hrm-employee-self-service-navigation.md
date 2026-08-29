# HRM Employee Self-Service Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Workspace `AGENTS.md` prohibits sub-agents.

**Goal:** Give a normal employee the intended self-service HRM menu and deep-link access while keeping the company-wide HR dashboard and C3/C4 features restricted to governed HR personas.

**Architecture:** Add explicit route requirements for the HRM routes whose permission scope or sensitivity cannot be inferred from the generic registry. Build the Sidebar HRM menu from one persona-aware navigation model, then remove C3/C4 links and consumption from the Employee Dashboard. This slice is frontend-only: existing effective permission sources and Supabase Cloud RLS/RPC remain authoritative, with Cloud persona smoke tests used as a release gate.

**Tech Stack:** React 18, TypeScript 5.8, React Router 6, Vitest 4, Supabase Cloud Postgres.

**Spec:** `docs/session-handoff-2026-08-29-hrm.md` section 7, consistent with `docs/superpowers/specs/2026-08-28-hrm-personnel-information-scoped-permissions-design.md` sections 10, 11, 18, and 19.

## Global Constraints

- Use Supabase Cloud from `.env`; never use Supabase local or Docker.
- Do not create a migration for this frontend route/menu correction.
- Do not modify, stage, or restore `supabase/.temp/cli-latest`.
- Do not push the 14 existing local commits or the implementation commits unless the user asks.
- Do not restore an implicit `Role.ADMIN` bypass for `hrm.*` routes.
- Do not grant raw access to `employees` or any C2-C4 table; existing guarded projections/RPCs remain the data boundary.
- `BUSINESS_USER` keeps `hrm.employee.view_directory global`, profile actions at `own`, `hrm.attendance.view own`, and `hrm.leave.view own`.
- `/hrm/dashboard` is the company-wide HR dashboard and requires an effective governed HR permission; `/employee-dashboard` is the authenticated employee overview.
- Employee V1 must not expose payroll, contracts, legal/insurance, sensitive documents, HR reports, shift administration, or HR shared-catalog administration.
- Manager routes remain disabled until organization readiness reaches the approved gate; do not authorize from `users.manager_id`.
- Preserve deep-link enforcement in `SubModuleGuard`; hiding a Sidebar item is not sufficient authorization.

---

### Task 1: Lock the HRM route contract with persona tests

**Files:**
- Modify: `lib/__tests__/routeAccess.test.ts`
- Modify: `lib/routeAccess.ts`

**Interfaces:**
- Consumes: effective `User.permissionGrants` loaded from `get_effective_permission_sources`.
- Produces: `HRM_ROUTE_PERMISSION_REQUIREMENTS`, mapping an exact pathname to one permission code and requested scope.
- Produces: `canAccessRoute(user, route)` behavior shared by Sidebar, command palette, quick actions, and `SubModuleGuard`.

- [ ] **Step 1: Add failing persona fixtures and route assertions**

Add a helper that constructs effective grants exactly as the authenticated session exposes them:

```ts
const persona = (
  role: Role,
  grants: Array<[UserPermissionGrant['permissionCode'], UserPermissionGrant['scopeType']]>,
): User => ({
  id: 'persona-1',
  name: 'Persona',
  email: 'persona@example.com',
  role,
  allowedModules: [],
  adminModules: [],
  allowedSubModules: {},
  adminSubModules: {},
  permissionGrants: grants.map(([permissionCode, scopeType]) => ({
    userId: 'persona-1',
    permissionCode,
    scopeType,
    scopeId: '*',
    isActive: true,
  })),
});

const businessUser = persona(Role.EMPLOYEE, [
  ['hrm.employee.view_directory', 'global'],
  ['hrm.employee.view_profile', 'own'],
  ['hrm.employee.edit_profile', 'own'],
  ['hrm.attendance.view', 'own'],
  ['hrm.leave.view', 'own'],
]);
```

Add these assertions:

```ts
it('opens the employee self-service routes with own-scoped grants', () => {
  expect(canAccessRoute(businessUser, '/employee-dashboard')).toBe(true);
  expect(canAccessRoute(businessUser, '/my-profile')).toBe(true);
  expect(canAccessRoute(businessUser, '/hrm/employees')).toBe(true);
  expect(canAccessRoute(businessUser, '/hrm/checkin')).toBe(true);
  expect(canAccessRoute(businessUser, '/hrm/attendance')).toBe(true);
  expect(canAccessRoute(businessUser, '/hrm/leave')).toBe(true);
});

it('keeps HR-wide and sensitive routes closed to a business user', () => {
  for (const route of [
    '/hrm/dashboard',
    '/hrm/shifts',
    '/hrm/payroll',
    '/hrm/contracts',
    '/hrm/documents',
    '/hrm/reports',
    '/hrm/ranking',
    '/settings/hrm-shared-catalog',
  ]) {
    expect(canAccessRoute(businessUser, route), route).toBe(false);
  }
});

it('opens the HR dashboard only from an effective governed HR source', () => {
  const hr = persona(Role.EMPLOYEE, [
    ['hrm.employee.view_sensitive', 'global'],
  ]);
  const hrManage = persona(Role.EMPLOYEE, [
    ['hrm.employee.view_sensitive', 'global'],
    ['hrm.compensation.manage', 'global'],
  ]);
  const technicalAdmin = persona(Role.ADMIN, []);

  expect(canAccessRoute(hr, '/hrm/dashboard')).toBe(true);
  expect(canAccessRoute(hrManage, '/hrm/dashboard')).toBe(true);
  expect(canAccessRoute(technicalAdmin, '/hrm/dashboard')).toBe(false);
});
```

- [ ] **Step 2: Run the focused test and verify the current failure**

```bash
npx vitest run lib/__tests__/routeAccess.test.ts
```

Expected before implementation:

- Business User is denied `/hrm/checkin`, `/hrm/attendance`, and `/hrm/leave` because the generic call requests `global`.
- Business User is allowed `/hrm/dashboard` through `hrm.employee.view_directory global`.
- Technical Admin is allowed `/hrm/dashboard` by the early `Role.ADMIN` return.

- [ ] **Step 3: Implement explicit route requirements and remove the duplicate Admin bypass**

In `lib/routeAccess.ts`, import `PermissionScope`, `canPerform`, and define exact rules:

```ts
interface RoutePermissionRequirement {
  permissionCode: string;
  scope: Required<PermissionScope>;
}

const GLOBAL_SCOPE: Required<PermissionScope> = {
  scopeType: 'global',
  scopeId: '*',
};

const OWN_SCOPE: Required<PermissionScope> = {
  scopeType: 'own',
  scopeId: '*',
};

export const HRM_ROUTE_PERMISSION_REQUIREMENTS: Readonly<Record<string, RoutePermissionRequirement>> = {
  '/hrm/dashboard': {
    permissionCode: 'hrm.employee.view_sensitive',
    scope: GLOBAL_SCOPE,
  },
  '/hrm/employees': {
    permissionCode: 'hrm.employee.view_directory',
    scope: GLOBAL_SCOPE,
  },
  '/hrm/checkin': {
    permissionCode: 'hrm.attendance.view',
    scope: OWN_SCOPE,
  },
  '/hrm/attendance': {
    permissionCode: 'hrm.attendance.view',
    scope: OWN_SCOPE,
  },
  '/hrm/leave': {
    permissionCode: 'hrm.leave.view',
    scope: OWN_SCOPE,
  },
};
```

Resolve authenticated-open routes first, reject unmapped protected paths, apply an exact requirement when present, and otherwise delegate to `canViewRoute`:

```ts
const pathname = normalizeRoutePath(route);
if (isAuthenticatedOpenRoute(pathname)) return true;

const moduleKey = getRouteModuleKey(pathname);
if (!moduleKey) return false;

const requirement = HRM_ROUTE_PERMISSION_REQUIREMENTS[pathname];
if (requirement) {
  return canPerform(user, requirement.permissionCode, requirement.scope);
}

return canViewRoute(user, pathname);
```

Delete `if (user.role === Role.ADMIN) return true;` from `canAccessRoute` and remove the now-unused `Role` import. `canViewRoute` already preserves the Admin shortcut for non-HRM modules and denies implicit HRM access, including `/settings/hrm-shared-catalog`.

- [ ] **Step 4: Run focused permission tests**

```bash
npx vitest run lib/__tests__/routeAccess.test.ts lib/__tests__/permissionService.test.ts lib/__tests__/permissionRouteRegistry.test.ts lib/__tests__/hrmSharedCatalogCapabilities.test.ts
```

Expected: all pass; global HR grants satisfy own route requests, but own Employee grants cannot satisfy global HR routes.

- [ ] **Step 5: Commit the route boundary**

```bash
git add docs/superpowers/plans/2026-08-29-hrm-employee-self-service-navigation.md lib/routeAccess.ts lib/__tests__/routeAccess.test.ts
git commit -m "fix(hrm): enforce persona-aware route scopes"
```

---

### Task 2: Build the Sidebar HRM menu from a persona-aware model

**Files:**
- Create: `lib/hrmNavigation.ts`
- Create: `lib/__tests__/hrmNavigation.test.ts`
- Modify: `components/Sidebar.tsx`
- Modify: `components/UserModal.tsx`

**Interfaces:**
- Consumes: `canAccessRoute(user, route)` from Task 1.
- Produces: `getHrmNavigationItems(user): HrmNavigationItem[]`.
- Produces: the Employee order `employee-dashboard → my-profile → employees → checkin → attendance → leave` after permission filtering.

- [ ] **Step 1: Write the failing menu persona test**

Create `lib/__tests__/hrmNavigation.test.ts` using the same persona fixture shape as Task 1:

```ts
describe('HRM navigation', () => {
  it('returns the approved Employee self-service menu in order', () => {
    expect(getHrmNavigationItems(businessUser)).toEqual([
      { to: '/employee-dashboard', label: 'Tổng quan của tôi' },
      { to: '/my-profile', label: 'Hồ sơ của tôi' },
      { to: '/hrm/employees', label: 'Danh bạ nhân sự' },
      { to: '/hrm/checkin', label: 'Check-in / Check-out' },
      { to: '/hrm/attendance', label: 'Chấm công của tôi' },
      { to: '/hrm/leave', label: 'Nghỉ phép của tôi' },
    ]);
  });

  it('adds the company-wide HR pages from HR view permissions', () => {
    const routes = getHrmNavigationItems(hrUser).map(item => item.to);

    expect(routes).toContain('/hrm/dashboard');
    expect(routes).toContain('/hrm/contracts');
    expect(routes).toContain('/hrm/documents');
    expect(routes).toContain('/hrm/payroll');
    expect(routes).toContain('/hrm/shifts');
  });

  it('keeps the governed HR route set available to HR Manage', () => {
    const routes = getHrmNavigationItems(hrManageUser).map(item => item.to);

    expect(routes).toContain('/hrm/dashboard');
    expect(routes).toContain('/hrm/contracts');
    expect(routes).toContain('/hrm/documents');
    expect(routes).toContain('/hrm/shifts');
    expect(routes).toContain('/hrm/payroll');
  });
});
```

The `hrUser` fixture must include the existing HR global view grants used by the current template: employee sensitive, attendance, leave, contract, document, payroll, and master-data view. The `hrManageUser` fixture adds the corresponding manage grants.

- [ ] **Step 2: Verify the test fails because the navigation model does not exist**

```bash
npx vitest run lib/__tests__/hrmNavigation.test.ts
```

Expected: FAIL with an unresolved `../hrmNavigation` import.

- [ ] **Step 3: Implement the pure navigation model**

Create `lib/hrmNavigation.ts` with route/label data only; keep Lucide icon components in `Sidebar.tsx`:

```ts
import type { User } from '../types';
import { canPerform } from './permissions/permissionService';
import { canAccessRoute } from './routeAccess';

export interface HrmNavigationItem {
  to: string;
  label: string;
}

const GLOBAL_SCOPE = { scopeType: 'global' as const, scopeId: '*' };

const HRM_NAVIGATION_ITEMS = [
  { to: '/employee-dashboard', employeeLabel: 'Tổng quan của tôi', hrLabel: 'Tổng quan của tôi' },
  { to: '/my-profile', employeeLabel: 'Hồ sơ của tôi', hrLabel: 'Hồ sơ của tôi' },
  { to: '/hrm/dashboard', employeeLabel: 'Dashboard nhân sự', hrLabel: 'Dashboard nhân sự' },
  { to: '/hrm/employees', employeeLabel: 'Danh bạ nhân sự', hrLabel: 'Hồ sơ nhân sự' },
  { to: '/hrm/checkin', employeeLabel: 'Check-in / Check-out', hrLabel: 'Check-in / Check-out' },
  { to: '/hrm/attendance', employeeLabel: 'Chấm công của tôi', hrLabel: 'Chấm công' },
  { to: '/hrm/shifts', employeeLabel: 'Ca làm việc', hrLabel: 'Ca làm việc' },
  { to: '/hrm/leave', employeeLabel: 'Nghỉ phép của tôi', hrLabel: 'Nghỉ phép' },
  { to: '/hrm/payroll', employeeLabel: 'Bảng lương', hrLabel: 'Bảng lương' },
  { to: '/hrm/contracts', employeeLabel: 'Hợp đồng LĐ', hrLabel: 'Hợp đồng LĐ' },
  { to: '/hrm/documents', employeeLabel: 'Hồ sơ & Công văn', hrLabel: 'Hồ sơ & Công văn' },
  { to: '/hrm/reports', employeeLabel: 'Báo cáo NS', hrLabel: 'Báo cáo NS' },
  { to: '/hrm/ranking', employeeLabel: 'Xếp hạng NV', hrLabel: 'Xếp hạng NV' },
] as const;

export const getHrmNavigationItems = (
  user: Pick<User, 'role' | 'allowedModules' | 'allowedSubModules' | 'adminModules' | 'adminSubModules' | 'permissionGrants'>,
): HrmNavigationItem[] => {
  const isHrPersona = canPerform(user, 'hrm.employee.view_sensitive', GLOBAL_SCOPE);
  return HRM_NAVIGATION_ITEMS
    .filter(item => canAccessRoute(user, item.to))
    .map(item => ({
      to: item.to,
      label: isHrPersona ? item.hrLabel : item.employeeLabel,
    }));
};
```

- [ ] **Step 4: Replace Sidebar's duplicated HRM array**

In `components/Sidebar.tsx`, import the `LucideIcon` type and keep a route-to-icon table:

```tsx
const HRM_NAV_ICONS: Record<string, LucideIcon> = {
  '/employee-dashboard': LayoutDashboard,
  '/my-profile': User,
  '/hrm/dashboard': LayoutDashboard,
  '/hrm/employees': Users,
  '/hrm/checkin': MapPin,
  '/hrm/attendance': Calendar,
  '/hrm/shifts': Clock,
  '/hrm/leave': CalendarOff,
  '/hrm/payroll': DollarSign,
  '/hrm/contracts': FileSignature,
  '/hrm/documents': FolderOpen,
  '/hrm/reports': BarChart3,
  '/hrm/ranking': Award,
};
```

Build the `HRM` entry with:

```tsx
HRM: getHrmNavigationItems(user).map(item => ({
  ...item,
  icon: HRM_NAV_ICONS[item.to],
})),
```

Keep the existing final `canAccessRoute` filter as defense in depth. Update `detectAppFromUrl()` so `/employee-dashboard` selects the HRM application view.

- [ ] **Step 5: Synchronize only the visible legacy label in UserModal**

Change the `/hrm/employees` label in `SUB_MODULE_CONFIG.HRM` from `Hồ sơ nhân sự` to `Danh bạ nhân sự`. Do not add `/employee-dashboard` or `/my-profile` to legacy sub-module grants because both are authenticated self-service routes. Do not change `replaceUserPermissionGrants`, `set_user_hr_business_role`, or business-role assignments in this task.

- [ ] **Step 6: Run the navigation tests and lint**

```bash
npx vitest run lib/__tests__/hrmNavigation.test.ts lib/__tests__/routeAccess.test.ts lib/__tests__/permissionRouteRegistry.test.ts
npm run lint
```

Expected: the exact six-item Employee menu passes; HR/HR Manage retain only routes backed by their effective actions.

- [ ] **Step 7: Commit the menu model**

```bash
git add lib/hrmNavigation.ts lib/__tests__/hrmNavigation.test.ts components/Sidebar.tsx components/UserModal.tsx
git commit -m "fix(hrm): show employee self-service navigation"
```

---

### Task 3: Remove C3/C4 surfaces from Employee Dashboard

**Files:**
- Create: `lib/__tests__/employeeDashboardSelfService.test.ts`
- Modify: `pages/EmployeeDashboard.tsx`

**Interfaces:**
- Consumes: `canAccessRoute` for non-HRM quick links.
- Produces: an Employee Dashboard that contains own attendance/leave/profile links and no payroll or labor-contract surface.

- [ ] **Step 1: Write a failing source-contract regression test**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'pages', 'EmployeeDashboard.tsx'),
  'utf8',
);

describe('Employee Dashboard self-service boundary', () => {
  it('does not consume or link Employee V1 C3/C4 data', () => {
    expect(source).not.toContain('payrollRecords');
    expect(source).not.toContain('laborContracts');
    expect(source).not.toContain("navigate('/hrm/payroll')");
    expect(source).not.toContain("navigate('/hrm/contracts')");
    expect(source).not.toContain("to: '/hrm/payroll'");
    expect(source).not.toContain('Hợp đồng lao động');
  });

  it('keeps the approved own-service destinations', () => {
    expect(source).toContain("navigate('/hrm/checkin')");
    expect(source).toContain("navigate('/hrm/attendance')");
    expect(source).toContain("navigate('/hrm/leave')");
    expect(source).toContain("navigate('/my-profile')");
  });
});
```

- [ ] **Step 2: Run the test and verify the sensitive links fail it**

```bash
npx vitest run lib/__tests__/employeeDashboardSelfService.test.ts
```

Expected: FAIL on `payrollRecords`, `laborContracts`, the labor-contract card, and the payroll quick link.

- [ ] **Step 3: Remove C3/C4 consumption and presentation**

In `pages/EmployeeDashboard.tsx`:

- Remove `payrollRecords` and `laborContracts` from the `useApp()` destructure.
- Remove the `myContract` memo.
- Remove the entire `Hợp đồng lao động` section.
- Remove the `Bảng lương` quick link.
- Remove the now-unused `DollarSign` import; keep `FileText` because request cards still use it.
- Keep attendance, leave, profile, request, workflow, asset, and check-in behavior unchanged.
- Filter optional quick links such as workflow, requests, AI, and chat through `canAccessRoute(user, link.to)` before rendering so a visible shortcut never points at a route the deep-link guard will reject.

Use one filtered quick-link list instead of filtering in JSX:

```tsx
const quickLinks = [
  { icon: <MapPin size={17} />, label: 'Check-in', to: '/hrm/checkin', gradient: 'from-emerald-500 to-green-600', shadow: 'shadow-emerald-500/20' },
  { icon: <CalendarOff size={17} />, label: 'Nghỉ phép', to: '/hrm/leave', gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/20' },
  { icon: <GitBranch size={17} />, label: 'Quy trình', to: '/wf', gradient: 'from-blue-500 to-indigo-600', shadow: 'shadow-blue-500/20' },
  { icon: <Inbox size={17} />, label: 'Yêu cầu', to: '/rq', gradient: 'from-cyan-500 to-sky-600', shadow: 'shadow-cyan-500/20' },
  { icon: <Bot size={17} />, label: 'Trợ lý AI', to: '/ai', gradient: 'from-fuchsia-500 to-purple-600', shadow: 'shadow-fuchsia-500/20' },
  { icon: <UserIcon size={17} />, label: 'Hồ sơ', to: '/my-profile', gradient: 'from-slate-500 to-slate-700', shadow: 'shadow-slate-500/20' },
  ...(isChatEnabled ? [{ icon: <MessageCircle size={17} />, label: 'Tin nhắn', to: '/chat', gradient: 'from-pink-500 to-rose-600', shadow: 'shadow-pink-500/20' }] : []),
].filter(link => canAccessRoute(user, link.to));
```

Do not add own payroll/contract RPCs or projections; that requires a separate approved change to the V1 C3/C4 decision.

- [ ] **Step 4: Run the focused dashboard and navigation suite**

```bash
npx vitest run lib/__tests__/employeeDashboardSelfService.test.ts lib/__tests__/hrmNavigation.test.ts lib/__tests__/routeAccess.test.ts
npm run lint
```

Expected: all pass with no unused imports or duplicate dashboard shortcuts.

- [ ] **Step 5: Commit the Employee Dashboard boundary**

```bash
git add pages/EmployeeDashboard.tsx lib/__tests__/employeeDashboardSelfService.test.ts
git commit -m "fix(hrm): keep employee dashboard self-service only"
```

---

### Task 4: Verify the complete slice locally and against Supabase Cloud personas

**Files:**
- Verify only: `supabase/tests/auth_effective_permission_boundary_smoke.sql`
- Verify only: `supabase/tests/hrm_checkin_persona_smoke.sql`
- Verify only: `supabase/tests/hrm_permission_health_smoke.sql`
- Verify only: `supabase/tests/hrm_business_role_self_grant_smoke.sql`
- Verify only: `supabase/tests/hrm_personnel_profile_persona_smoke.sql`
- Preserve: `supabase/.temp/cli-latest`

**Interfaces:**
- Consumes: existing Cloud project `ftciqmqhmfvjtwoycswe`, `.env`, and rollback-safe persona smoke scripts.
- Produces: release evidence that frontend navigation agrees with effective permission sources and database enforcement.

- [ ] **Step 1: Run focused tests once more from a clean command**

```bash
npx vitest run \
  lib/__tests__/routeAccess.test.ts \
  lib/__tests__/permissionService.test.ts \
  lib/__tests__/permissionRouteRegistry.test.ts \
  lib/__tests__/hrmSharedCatalogCapabilities.test.ts \
  lib/__tests__/hrmNavigation.test.ts \
  lib/__tests__/employeeDashboardSelfService.test.ts
```

- [ ] **Step 2: Run the full local quality gate**

```bash
npm run lint
npm test
npm run build
```

Expected: TypeScript passes, the entire Vitest suite passes, and Vite completes with only the already-known chunk-size warning.

- [ ] **Step 3: Run the existing SQL persona smoke scripts on Supabase Cloud**

Load credentials without printing them, use the existing Cloud pooler URL read-only, and execute every script with `ON_ERROR_STOP`:

```bash
set -a
source .env
set +a
export PGPASSWORD="$SUPABASE_DB_PASSWORD"

psql "$(tr -d '\n' < supabase/.temp/pooler-url)" -X -v ON_ERROR_STOP=1 -f supabase/tests/auth_effective_permission_boundary_smoke.sql
psql "$(tr -d '\n' < supabase/.temp/pooler-url)" -X -v ON_ERROR_STOP=1 -f supabase/tests/hrm_checkin_persona_smoke.sql
psql "$(tr -d '\n' < supabase/.temp/pooler-url)" -X -v ON_ERROR_STOP=1 -f supabase/tests/hrm_permission_health_smoke.sql
psql "$(tr -d '\n' < supabase/.temp/pooler-url)" -X -v ON_ERROR_STOP=1 -f supabase/tests/hrm_business_role_self_grant_smoke.sql
psql "$(tr -d '\n' < supabase/.temp/pooler-url)" -X -v ON_ERROR_STOP=1 -f supabase/tests/hrm_personnel_profile_persona_smoke.sql

unset PGPASSWORD
```

Expected:

- Effective permission sources load under an authenticated persona.
- Employee and HR Manage check-in flows pass and roll back.
- Direct sensitive grants and implicit Admin HR access remain blocked.
- Admin self-grant/revoke remains audited and rollback-safe.
- Employee profile projection remains `SELF` without C3/C4 sections.

- [ ] **Step 4: Confirm the user-owned temp change was not touched or staged**

```bash
git status --short --branch
git diff -- supabase/.temp/cli-latest
git diff --cached -- supabase/.temp/cli-latest
```

Expected: `supabase/.temp/cli-latest` remains only the pre-existing unstaged user-owned change; the cached diff is empty.

- [ ] **Step 5: Perform a final manual persona check in the application**

With one normal Employee session, verify the visible HRM menu is exactly:

```text
Tổng quan của tôi
Hồ sơ của tôi
Danh bạ nhân sự
Check-in / Check-out
Chấm công của tôi
Nghỉ phép của tôi
```

Paste `/hrm/dashboard` directly into the address bar and confirm `SubModuleGuard` redirects without rendering HR dashboard data. Then verify an HR or HR Manage session can open `/hrm/dashboard`, while a technical System Admin without HR template cannot.

- [ ] **Step 6: Record verification without pushing**

```bash
git log -4 --oneline
git status --short --branch
```

Expected: three local implementation commits are present, the branch is not pushed, and no unrelated file is staged.

---

## Self-Review Checklist

- [ ] Every Employee menu item in handoff section 7 has a route, label, permission, and test.
- [ ] `/hrm/dashboard` requires governed HR access and is denied to Business User and technical Admin without HR template.
- [ ] Employee own attendance/leave grants satisfy both menu filtering and deep-link authorization.
- [ ] Employee cannot see payroll, contracts, documents, reports, shift administration, or shared catalog.
- [ ] Employee Dashboard contains no C3/C4 shortcut or data consumption.
- [ ] No manager route or `users.manager_id` fallback was introduced.
- [ ] No raw-table grant, service-role frontend use, database migration, or local Supabase command was introduced.
- [ ] `supabase/.temp/cli-latest` remains untouched and unstaged.
