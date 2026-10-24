import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Role, type User } from '../types';
import { canAccessRoute } from '../lib/routeAccess';
import { useUserDirectManagers } from '../lib/userDirectManagerService';
import UserModal from '../components/UserModal';
import PermissionCenterView from '../components/permissions/center/PermissionCenterView';

/** /permissions — Trung tâm phân quyền. Vỏ trang: người dùng đang đăng nhập, danh sách tài khoản, màn chỉnh chi tiết. */
const PermissionCenter: React.FC = () => {
  const { user, users, warehouses, updateUser, reloadManagedUser } = useApp();
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { managers } = useUserDirectManagers(users.length);

  return (
    <>
      <PermissionCenterView
        allowed={canAccessRoute(user, '/permissions')}
        currentUserId={user.id}
        isAdmin={user.role === Role.ADMIN}
        people={users.map(candidate => ({ id: candidate.id, name: candidate.name, active: candidate.isActive !== false && candidate.accountStatus !== 'DISABLED' }))}
        canOpenRoute={path => canAccessRoute(user, path)}
        onOpenDetail={userId => setDetailUser(users.find(candidate => candidate.id === userId) || null)}
        reloadKey={reloadKey}
      />
      <UserModal
        isOpen={Boolean(detailUser)}
        onClose={() => { setDetailUser(null); setReloadKey(value => value + 1); }}
        onSave={updateUser}
        onAuthorizationSaved={reloadManagedUser}
        userToEdit={detailUser}
        warehouses={warehouses}
        users={users}
        directManager={detailUser ? managers?.get(detailUser.id) ?? null : null}
        canAssignAdminRole={user.role === Role.ADMIN}
        canGrantPermissions
        currentUserId={user.id}
      />
    </>
  );
};

export default PermissionCenter;
