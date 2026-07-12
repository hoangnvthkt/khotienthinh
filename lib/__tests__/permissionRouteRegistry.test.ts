import { describe, expect, it } from 'vitest';
import { ROUTE_TO_MODULE } from '../../constants/routes';
import { getPermissionRoutes } from '../permissions/permissionRegistry';
import { isAuthenticatedOpenRoute } from '../routeAccess';

describe('permission route registry coverage', () => {
  it('covers every protected route mapping with a permission registry route or authenticated-open whitelist', () => {
    const registryRoutes = new Set(getPermissionRoutes());
    const missingRoutes = Object.keys(ROUTE_TO_MODULE).filter(route =>
      !registryRoutes.has(route) && !isAuthenticatedOpenRoute(route)
    );

    expect(missingRoutes).toEqual([]);
  });
});
