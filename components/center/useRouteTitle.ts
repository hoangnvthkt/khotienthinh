import { useCallback, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { navigationModulesFor, useModuleNavigation } from '../Sidebar';

/** Tên tab cho một màn: nhãn chức năng trên thanh bên (khớp đúng đường dẫn, rồi khớp phần đường dẫn), không thì tên app. */
export const useRouteTitle = () => {
  const { user } = useApp();
  const navFor = useModuleNavigation();
  const entries = useMemo(() => navigationModulesFor(user).flatMap(module => [
    ...navFor(module.key as Parameters<typeof navFor>[0]).map(item => ({ to: item.to, label: item.label })),
    { to: module.route, label: module.label },
  ]), [user, navFor]);
  return useCallback((route: string): string | null => {
    const path = route.split(/[?#]/)[0];
    return entries.find(entry => entry.to === route)?.label
      || entries.find(entry => entry.to.split(/[?#]/)[0] === path)?.label
      || null;
  }, [entries]);
};
