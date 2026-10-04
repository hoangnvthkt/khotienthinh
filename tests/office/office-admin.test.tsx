import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { OfficeUserPermissions } from '../../pages/office/OfficeSettings';
import { officePermissionSettingsPath, readOfficePermissionFocus } from '../../lib/office/officeAdminNavigation';
import type { OfficeService } from '../../lib/office/officeService';
const service = {} as OfficeService;
describe('Office permission handoff', () => {
 it('encodes the selected user and roundtrips the Office editor focus', () => {
   const path = officePermissionSettingsPath('user +&1');
   expect(readOfficePermissionFocus(path.slice(path.indexOf('?')))).toEqual({ userId: 'user +&1' });
   expect(readOfficePermissionFocus('?tab=users')).toBeNull();
   expect(readOfficePermissionFocus('?tab=account&permissionApp=office')).toBeNull();
 });
 it('offers the user picker and disables the action until a user is selected', () => {
   const html = renderToStaticMarkup(<StaticRouter><OfficeUserPermissions service={service} canManagePermissions /></StaticRouter>);
   expect(html).toContain('Tìm theo tên hoặc email');
   expect(html).toMatch(/<button[^>]*disabled=""/);
   expect(html).toContain('permissionApp=office');
 });
 it('does not offer central grant editing to an Office configuration-only administrator', () => {
   const html = renderToStaticMarkup(<StaticRouter><OfficeUserPermissions service={service} canManagePermissions={false} /></StaticRouter>);
   expect(html).toContain('cần thêm quyền quản lý phân quyền hệ thống');
   expect(html).not.toContain('permissionApp=office');
   expect(html).not.toContain('Tìm theo tên hoặc email');
 });
});
