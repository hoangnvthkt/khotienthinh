import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { Role, type User } from '../../../types';
import { MacOSDockLauncher } from '../MacOSDockLauncher';
const render = (permissions: string[]) => {
 const user: User = { id: 'u', name: 'Employee', email: 'e@example.com', role: Role.EMPLOYEE, permissionGrants: permissions.map(permissionCode => ({ userId: 'u', permissionCode, scopeType: 'global', scopeId: '*', isActive: true })) };
 return renderToStaticMarkup(<StaticRouter location="/office/settings"><MacOSDockLauncher user={user} /></StaticRouter>);
};
describe('Office application launcher', () => {
 it('shows Office with canonical access', () => expect(render(['office.module.access'])).toContain('Vioo Office'));
 it('hides Office without its access grant', () => expect(render([])).not.toContain('Vioo Office'));
});
