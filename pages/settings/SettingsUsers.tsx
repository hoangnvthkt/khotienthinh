import React from 'react';
import { User, Role, Warehouse } from '../../types';
import { Plus, MapPin, Shield, Mail, Phone, MoreVertical, Edit2 } from 'lucide-react';
import UserModal from '../../components/UserModal';
import DeleteUserModal from '../../components/DeleteUserModal';

interface SettingsUsersProps {
  users: User[];
  currentUser: User;
  warehouses: Warehouse[];
  isUserModalOpen: boolean;
  setIsUserModalOpen: (v: boolean) => void;
  isUserDeleteModalOpen: boolean;
  setIsUserDeleteModalOpen: (v: boolean) => void;
  editingUser: User | null;
  deletingUser: User | null;
  handleAddUser: () => void;
  handleEditUser: (u: User) => void;
  handleDeleteUserClick: (u: User) => void;
  handleConfirmDeleteUser: () => void;
  handleSaveUser: (u: User) => void;
  getRoleBadge: (role: Role) => React.ReactNode;
}

const SettingsUsers: React.FC<SettingsUsersProps> = ({
  users, currentUser, warehouses,
  isUserModalOpen, setIsUserModalOpen,
  isUserDeleteModalOpen, setIsUserDeleteModalOpen,
  editingUser, deletingUser,
  handleAddUser, handleEditUser, handleDeleteUserClick,
  handleConfirmDeleteUser, handleSaveUser, getRoleBadge
}) => (
  <>
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Quản lý nhân sự</h2>
          <p className="text-xs text-slate-500 font-medium">Phân quyền và phạm vi quản lý kho bãi cho nhân viên.</p>
        </div>
        <button
          onClick={handleAddUser}
          className="flex items-center px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition font-bold text-xs shadow-lg shadow-slate-900/20"
        >
          <Plus className="w-4 h-4 mr-2" /> Thêm nhân sự
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {users.map((u) => {
          const assignedWarehouse = warehouses.find(w => w.id === u.assignedWarehouseId);
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

                <div className="mb-4">
                  {getRoleBadge(u.role)}
                </div>

                <div className="pt-4 border-t border-slate-50 space-y-2">
                  <div className="flex items-center text-[10px] text-slate-400 uppercase font-black tracking-widest">
                    <MapPin size={12} className="mr-1" /> Phạm vi quản lý
                  </div>
                  <div className="font-bold text-xs text-slate-700">
                    {assignedWarehouse ? assignedWarehouse.name : 'Toàn hệ thống'}
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
                  onClick={() => handleDeleteUserClick(u)}
                  className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-sm border
                      ${u.id === currentUser.id
                      ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      : 'bg-white text-red-600 border-red-100 hover:bg-red-600 hover:text-white'
                    }`}
                >
                  Xoá
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

    <DeleteUserModal
      isOpen={isUserDeleteModalOpen}
      onClose={() => setIsUserDeleteModalOpen(false)}
      onConfirm={handleConfirmDeleteUser}
      targetUser={deletingUser}
    />
  </>
);

export default SettingsUsers;
