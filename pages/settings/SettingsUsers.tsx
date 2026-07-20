import React, { useState } from 'react';
import { User, Role, Warehouse } from '../../types';
import { Plus, MapPin, Shield, Mail, Phone, MoreVertical, RotateCcw, UserX } from 'lucide-react';
import UserModal from '../../components/UserModal';
import UserAccountStatusModal from '../../components/UserAccountStatusModal';

interface SettingsUsersProps {
  users: User[];
  currentUser: User;
  warehouses: Warehouse[];
  isUserModalOpen: boolean;
  setIsUserModalOpen: (v: boolean) => void;
  editingUser: User | null;
  accountTarget: User | null;
  accountAction: 'DISABLE' | 'REACTIVATE';
  closeAccountAction: () => void;
  openAccountAction: (user: User, action: 'DISABLE' | 'REACTIVATE') => void;
  handleAccountAction: (input: { reason: string; newPassword?: string }) => void | Promise<void>;
  handleAddUser: () => void;
  handleEditUser: (u: User) => void;
  handleSaveUser: (u: User) => void | Promise<void>;
  getRoleBadge: (role: Role) => React.ReactNode;
  isSavingAccount?: boolean;
}

const SettingsUsers: React.FC<SettingsUsersProps> = ({
  users,
  currentUser,
  warehouses,
  isUserModalOpen,
  setIsUserModalOpen,
  editingUser,
  accountTarget,
  accountAction,
  closeAccountAction,
  openAccountAction,
  handleAccountAction,
  handleAddUser,
  handleEditUser,
  handleSaveUser,
  getRoleBadge,
  isSavingAccount = false,
}) => {
  const [accountFilter, setAccountFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const visibleUsers = users.filter(candidate => {
    const disabled = candidate.accountStatus === 'DISABLED' || candidate.isActive === false;
    if (accountFilter === 'active') return !disabled;
    if (accountFilter === 'disabled') return disabled;
    return true;
  });

  return (
    <>
      <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
        <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Tài khoản hệ thống</h2>
            <p className="text-xs text-slate-500 font-medium">Tài khoản đăng nhập phần mềm; chỉ gán quyền kho khi người dùng có nghiệp vụ kho.</p>
          </div>
          <button
            onClick={handleAddUser}
            className="flex items-center px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition font-bold text-xs shadow-lg shadow-slate-900/20"
          >
            <Plus className="w-4 h-4 mr-2" /> Thêm tài khoản
          </button>
        </div>

        <div className="flex w-fit rounded-lg border border-slate-200 bg-white p-1">
          {([
            ['all', 'Tất cả'],
            ['active', 'Đang hoạt động'],
            ['disabled', 'Đã vô hiệu hóa'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setAccountFilter(value)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${accountFilter === value ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {visibleUsers.map((u) => {
            const assignedWarehouse = warehouses.find(w => w.id === u.assignedWarehouseId);
            const disabled = u.accountStatus === 'DISABLED' || u.isActive === false;
            const lifecycleAction = u.accountOperationStatus !== 'IDLE' && u.accountOperationAction
              ? u.accountOperationAction
              : disabled ? 'REACTIVATE' : 'DISABLE';
            const isReactivate = lifecycleAction === 'REACTIVATE';
            return (
              <div key={u.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden group hover:border-accent/30 transition-all">
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div className="relative">
                      <img src={u.avatar} alt={u.name} className="w-14 h-14 rounded-full border-4 border-slate-50" />
                      <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full shadow-sm">
                        <Shield size={12} className={`text-accent ${u.role === Role.ADMIN ? 'text-red-500' : 'text-blue-500'}`} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {u.id === currentUser.id && <span className="text-[9px] font-black text-accent bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">BẠN</span>}
                      <button className="text-slate-300 hover:text-slate-600">
                        <MoreVertical size={18} />
                      </button>
                    </div>
                  </div>

                  <h3 className="font-black text-slate-800 mb-1">{u.name}</h3>
                  <div className="space-y-1 mb-4">
                    <div className="flex items-center text-[11px] text-slate-500 font-medium">
                      <Mail size={12} className="mr-2 shrink-0 text-slate-300" /> {u.email}
                    </div>
                    {u.phone && (
                      <div className="flex items-center text-[11px] text-slate-500 font-medium">
                        <Phone size={12} className="mr-2 shrink-0 text-slate-300" /> {u.phone}
                      </div>
                    )}
                  </div>

                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    {getRoleBadge(u.role)}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${disabled ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {disabled ? 'Đã vô hiệu hóa' : 'Đang hoạt động'}
                    </span>
                    {u.accountOperationStatus === 'PENDING' && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">Đang đồng bộ Auth</span>
                    )}
                    {u.accountOperationStatus === 'AUTH_RETRY' && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Cần thử lại đồng bộ đăng nhập</span>
                    )}
                  </div>

                  <div className="pt-4 border-t border-slate-50 space-y-2">
                    <div className="flex items-center text-[10px] text-slate-400 uppercase font-black tracking-widest">
                      <MapPin size={12} className="mr-1" /> Kho phụ trách
                    </div>
                    <div className="font-bold text-xs text-slate-700">
                      {assignedWarehouse ? assignedWarehouse.name : (u.role === Role.WAREHOUSE_KEEPER ? 'Phòng vật tư - toàn bộ kho' : 'Không gán kho')}
                    </div>
                  </div>
                </div>

                <div className="px-6 py-3 bg-slate-50/50 flex gap-2 border-t border-slate-50">
                  <button
                    onClick={() => handleEditUser(u)}
                    className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest text-accent bg-white border border-slate-200 rounded-xl hover:bg-accent hover:text-white transition-all shadow-sm"
                  >
                    Sửa
                  </button>
                  <button
                    type="button"
                    disabled={u.id === currentUser.id}
                    onClick={() => openAccountAction(u, lifecycleAction)}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-sm border ${u.id === currentUser.id
                      ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      : isReactivate
                        ? 'bg-white text-emerald-600 border-emerald-100 hover:bg-emerald-600 hover:text-white'
                        : 'bg-white text-red-600 border-red-100 hover:bg-red-600 hover:text-white'
                    }`}
                  >
                    {isReactivate
                      ? <><RotateCcw size={13} className="mr-1 inline" /> Khôi phục</>
                      : <><UserX size={13} className="mr-1 inline" /> Vô hiệu hóa</>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <UserModal
        isOpen={isUserModalOpen}
        onClose={() => setIsUserModalOpen(false)}
        onSave={handleSaveUser}
        userToEdit={editingUser}
        warehouses={warehouses}
      />

      <UserAccountStatusModal
        isOpen={Boolean(accountTarget)}
        action={accountAction}
        targetUser={accountTarget}
        onClose={closeAccountAction}
        onConfirm={handleAccountAction}
        isSaving={isSavingAccount}
      />
    </>
  );
};

export default SettingsUsers;
