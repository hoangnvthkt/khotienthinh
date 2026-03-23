
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Role, User } from '../types';
import { Mail, Shield, MapPin, MoreVertical, Plus, Phone, Trash2 } from 'lucide-react';
import UserModal from '../components/UserModal';
import DeleteUserModal from '../components/DeleteUserModal';

const UserManagement: React.FC = () => {
  const { users, warehouses, addUser, updateUser, removeUser, user: currentUser } = useApp();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);

  const handleAddUser = () => {
    setEditingUser(null);
    setIsModalOpen(true);
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setIsModalOpen(true);
  };

  const handleDeleteClick = (user: User) => {
    if (user.id === currentUser.id) {
      alert("Bạn không thể tự xoá tài khoản của chính mình!");
      return;
    }
    setDeletingUser(user);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = () => {
    if (deletingUser) {
      removeUser(deletingUser.id);
      setIsDeleteModalOpen(false);
      setDeletingUser(null);
    }
  };

  const handleSaveUser = (userData: User) => {
    if (editingUser) {
      updateUser(userData);
    } else {
      addUser(userData);
    }
  };

  const getRoleBadge = (role: Role) => {
    switch (role) {
      case Role.ADMIN: return <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full text-[10px] font-bold">ADMIN</span>;
      case Role.EMPLOYEE: return <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-[10px] font-bold">NHÂN VIÊN</span>;
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
      />

      <DeleteUserModal 
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        targetUser={deletingUser}
      />

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Quản lý người dùng</h1>
          <p className="text-sm text-slate-500">Phân quyền nhân sự và phạm vi quản lý kho bãi.</p>
        </div>
        <button 
          onClick={handleAddUser}
          className="flex items-center px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition font-medium shadow-lg shadow-slate-900/20"
        >
          <Plus size={18} className="mr-2" /> Thêm nhân sự
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {users.map((u) => {
          const assignedWarehouse = warehouses.find(w => w.id === u.assignedWarehouseId);
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
                  </div>

                  <div className="pt-4 border-t border-slate-50 space-y-2">
                     <div className="flex items-center text-xs text-slate-400 uppercase font-bold tracking-wider">
                        <MapPin size={12} className="mr-1" /> Phạm vi quản lý
                     </div>
                     <div className="font-bold text-xs text-slate-700">
                        {assignedWarehouse ? assignedWarehouse.name : 'Tất cả các kho (Toàn hệ thống)'}
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
                    onClick={() => handleDeleteClick(u)}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all shadow-sm border
                      ${u.id === currentUser.id 
                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' 
                        : 'bg-white text-red-600 border-red-100 hover:bg-red-600 hover:text-white'
                      }`}
                  >
                     Xoá
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
