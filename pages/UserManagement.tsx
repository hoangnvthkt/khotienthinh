
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Role, User } from '../types';
import { Mail, Shield, MapPin, MoreVertical, Plus, Phone, RotateCcw, UserX } from 'lucide-react';
import UserModal from '../components/UserModal';
import UserAccountStatusModal from '../components/UserAccountStatusModal';
import { useModuleData } from '../hooks/useModuleData';
import { useToast } from '../context/ToastContext';
import { useAsyncAction } from '../hooks/useAsyncAction';

const UserManagement: React.FC = () => {
  const {
    users,
    warehouses,
    addUser,
    updateUser,
    disableUserAccount,
    reactivateUserAccount,
    user: currentUser,
  } = useApp();
  useModuleData('wms');
  const toast = useToast();
  const { loading: accountStatusLoading, run: runAccountStatusUpdate } = useAsyncAction({
    successTitle: 'Đã cập nhật trạng thái tài khoản',
    errorTitle: 'Không thể cập nhật trạng thái tài khoản',
    fallbackError: 'Không thể cập nhật trạng thái tài khoản trên Supabase.',
    logScope: 'userManagement.accountStatus',
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [accountTargetId, setAccountTargetId] = useState<string | null>(null);
  const [accountAction, setAccountAction] = useState<'DISABLE' | 'REACTIVATE'>('DISABLE');
  const [accountFilter, setAccountFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const accountTarget = users.find(candidate => candidate.id === accountTargetId) || null;
  const visibleUsers = users.filter(candidate => {
    const disabled = candidate.accountStatus === 'DISABLED' || candidate.isActive === false;
    if (accountFilter === 'active') return !disabled;
    if (accountFilter === 'disabled') return disabled;
    return true;
  });

  const handleAddUser = () => {
    setEditingUser(null);
    setIsModalOpen(true);
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setIsModalOpen(true);
  };

  const openAccountAction = (target: User, action: 'DISABLE' | 'REACTIVATE') => {
    if (target.id === currentUser.id) {
      toast.warning('Không thể tự vô hiệu hóa', 'Bạn không thể thay đổi trạng thái tài khoản đang đăng nhập.');
      return;
    }
    setAccountTargetId(target.id);
    setAccountAction(
      target.accountOperationStatus !== 'IDLE' && target.accountOperationAction
        ? target.accountOperationAction
        : action,
    );
  };

  const handleAccountAction = async (input: { reason: string; newPassword?: string }) => {
    if (!accountTarget) return;
    const completed = await runAccountStatusUpdate(async () => {
      const result = accountAction === 'DISABLE'
        ? await disableUserAccount(accountTarget.id, input.reason)
        : await reactivateUserAccount(accountTarget.id, input.reason, input.newPassword || '');
      if ((result.revocationSummary?.needsReassignment || 0) > 0) {
        toast.warning(
          'Cần phân công lại trách nhiệm',
          `${result.revocationSummary?.needsReassignment} trách nhiệm đã được đóng an toàn.`,
        );
      }
      return true;
    });
    if (completed) setAccountTargetId(null);
  };

  const handleSaveUser = async (userData: User) => {
    if (editingUser) {
      await updateUser(userData);
    } else {
      await addUser(userData);
    }
  };

  const getRoleBadge = (role: Role) => {
    switch (role) {
      case Role.ADMIN: return <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full text-[10px] font-bold">ADMIN</span>;
      case Role.WAREHOUSE_KEEPER: return <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-[10px] font-bold">THỦ KHO</span>;
      case Role.EMPLOYEE: return <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-[10px] font-bold">TÀI KHOẢN THƯỜNG</span>;
      default: return <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-[10px] font-bold">{role}</span>;
    }
  };

  if (currentUser.role !== Role.ADMIN) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8">
        <Shield size={48} className="text-slate-300 mb-4" />
        <h2 className="text-xl font-bold">Từ chối truy cập</h2>
        <p>Bạn không có quyền quản trị để xem trang này.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <UserModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSave={handleSaveUser}
        userToEdit={editingUser}
        warehouses={warehouses}
        users={users}
      />

      <UserAccountStatusModal
        isOpen={Boolean(accountTarget)}
        action={accountAction}
        targetUser={accountTarget}
        onClose={() => setAccountTargetId(null)}
        onConfirm={handleAccountAction}
        isSaving={accountStatusLoading}
      />

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Tài khoản hệ thống</h1>
          <p className="text-sm text-slate-500">Tài khoản đăng nhập phần mềm; chỉ gán quyền kho khi người dùng có nghiệp vụ kho.</p>
        </div>
        <button 
          onClick={handleAddUser}
          className="flex items-center px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition font-medium shadow-lg shadow-slate-900/20"
        >
          <Plus size={18} className="mr-2" /> Thêm tài khoản
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleUsers.map((u) => {
          const assignedWarehouse = warehouses.find(w => w.id === u.assignedWarehouseId);
          const disabled = u.accountStatus === 'DISABLED' || u.isActive === false;
          const lifecycleAction = u.accountOperationStatus !== 'IDLE' && u.accountOperationAction
            ? u.accountOperationAction
            : disabled ? 'REACTIVATE' : 'DISABLE';
          const isReactivate = lifecycleAction === 'REACTIVATE';
          return (
            <div key={u.id} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden group hover:border-accent/50 transition-all">
               <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                     <div className="relative">
                        <img src={u.avatar} alt={u.name} className="w-16 h-16 rounded-full border-4 border-slate-50" />
                        <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full shadow-sm">
                           <Shield size={14} className={`text-accent ${u.role === Role.ADMIN ? 'text-red-500' : 'text-blue-500'}`} />
                        </div>
                     </div>
                     <div className="flex items-center gap-2">
                        {u.id === currentUser.id && <span className="text-[10px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded">BẠN</span>}
                        <button className="text-slate-300 hover:text-slate-600">
                           <MoreVertical size={20} />
                        </button>
                     </div>
                  </div>
                  
                  <h3 className="font-bold text-lg text-slate-800 mb-1">{u.name}</h3>
                  <div className="space-y-1 mb-4">
                     <div className="flex items-center text-xs text-slate-500">
                        <Mail size={12} className="mr-2 shrink-0" /> {u.email}
                     </div>
                     {u.phone && (
                        <div className="flex items-center text-xs text-slate-500">
                           <Phone size={12} className="mr-2 shrink-0" /> {u.phone}
                        </div>
                     )}
                  </div>
                  
                  <div className="mb-4">
                     {getRoleBadge(u.role)}
                     <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${disabled ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                       {disabled ? 'Đã vô hiệu hóa' : 'Đang hoạt động'}
                     </span>
                     {u.accountOperationStatus === 'PENDING' && (
                       <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">Đang đồng bộ Auth</span>
                     )}
                     {u.accountOperationStatus === 'AUTH_RETRY' && (
                       <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Cần thử lại đồng bộ đăng nhập</span>
                     )}
                  </div>

                  <div className="pt-4 border-t border-slate-50 space-y-2">
                     <div className="flex items-center text-xs text-slate-400 uppercase font-bold tracking-wider">
                        <MapPin size={12} className="mr-1" /> Kho phụ trách
                     </div>
                     <div className="font-bold text-xs text-slate-700">
                        {assignedWarehouse ? assignedWarehouse.name : (u.role === Role.WAREHOUSE_KEEPER ? 'Phòng vật tư - toàn bộ kho' : 'Không gán kho')}
                     </div>
                  </div>
               </div>
               
               <div className="px-6 py-3 bg-slate-50 flex gap-2">
                  <button 
                    onClick={() => handleEditUser(u)}
                    className="flex-1 py-2 text-xs font-bold text-accent bg-white border border-slate-200 rounded-lg hover:bg-accent hover:text-white transition-all shadow-sm"
                  >
                     Sửa
                  </button>
                  <button 
                    type="button"
                    disabled={u.id === currentUser.id}
                    onClick={() => openAccountAction(u, lifecycleAction)}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all shadow-sm border
                      ${u.id === currentUser.id 
                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' 
                        : isReactivate
                          ? 'bg-white text-emerald-600 border-emerald-100 hover:bg-emerald-600 hover:text-white'
                          : 'bg-white text-red-600 border-red-100 hover:bg-red-600 hover:text-white'
                      }`}
                  >
                     {isReactivate
                       ? <><RotateCcw size={14} className="mr-1 inline" /> Khôi phục</>
                       : <><UserX size={14} className="mr-1 inline" /> Vô hiệu hóa</>}
                  </button>
                  <button className="flex-1 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-all shadow-sm">
                     Nhật ký
                  </button>
               </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default UserManagement;
