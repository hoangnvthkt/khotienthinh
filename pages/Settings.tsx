
import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Warehouse, WarehouseType, Supplier, ItemCategory, ItemUnit, HrmArea, HrmOffice, HrmEmployeeType, HrmPosition, HrmSalaryPolicy, HrmWorkSchedule } from '../types';
import {
  Building, MapPin, Plus, X, Save, Settings as SettingsIcon, Users,
  HardHat, Briefcase, Tag, Ruler, Trash2, Edit2,
  Image as ImageIcon, Globe, Upload, Trash, Truck, User as UserIcon, Search, AlertCircle,
  Database, Mail, Phone, Shield, MoreVertical, MapPinned, Clock, DollarSign, Calendar, Layers
} from 'lucide-react';
import MasterDataConfirmModal from '../components/MasterDataConfirmModal';
import UserModal from '../components/UserModal';
import DeleteUserModal from '../components/DeleteUserModal';
import { Role, User } from '../types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const Settings: React.FC = () => {
  const {
    warehouses, addWarehouse, updateWarehouse, removeWarehouse, categories, units, suppliers,
    addCategory, updateCategory, removeCategory,
    addUnit, updateUnit, removeUnit,
    addSupplier, updateSupplier, removeSupplier,
    appSettings, updateAppSettings, clearAllData, connectionError,
    users, addUser, updateUser, removeUser, user: currentUser, logout,
    hrmAreas, hrmOffices, hrmEmployeeTypes, hrmPositions, hrmSalaryPolicies, hrmWorkSchedules,
    addHrmItem, updateHrmItem, removeHrmItem
  } = useApp();

  const [activeTab, setActiveTab] = useState('general');
  const [isWhModalOpen, setIsWhModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // User Management States
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isUserDeleteModalOpen, setIsUserDeleteModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);

  // States for Safety Modal
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'danger' | 'warning' | 'success';
    actionLabel: string;
    onConfirm: () => void;
    countdown: boolean;
  }>({
    isOpen: false, title: '', message: '', type: 'warning', actionLabel: '', onConfirm: () => { }, countdown: true
  });

  // General settings form state
  const [appName, setAppName] = useState(appSettings.name);
  const [appLogo, setAppLogo] = useState(appSettings.logo);

  // Warehouse form state
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [newWhName, setNewWhName] = useState('');
  const [newWhAddress, setNewWhAddress] = useState('');
  const [newWhType, setNewWhType] = useState<WarehouseType>('SITE');

  // Master data state management
  const [activeMasterSection, setActiveMasterSection] = useState<'categories' | 'units' | 'suppliers' | null>(null);
  const [activeHrmSection, setActiveHrmSection] = useState<'areas' | 'offices' | 'employee_types' | 'positions' | 'salary_policies' | 'work_schedules' | null>(null);
  const [editingItem, setEditingItem] = useState<{ type: 'cat' | 'unit' | 'sup', data: any } | null>(null);
  const [editingHrmItem, setEditingHrmItem] = useState<any | null>(null);
  const [newHrmName, setNewHrmName] = useState('');
  const [newHrmDesc, setNewHrmDesc] = useState('');

  // Input fields for adding
  const [newCatName, setNewCatName] = useState('');
  const [newUnitName, setNewUnitName] = useState('');
  const [newSup, setNewSup] = useState({ name: '', contact: '', phone: '' });

  // Password change state
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [passError, setPassError] = useState('');
  const [passSuccess, setPassSuccess] = useState('');

  useEffect(() => {
    setAppName(appSettings.name);
    setAppLogo(appSettings.logo);
  }, [appSettings]);

  // General Handlers
  const handleSaveGeneral = (e: React.FormEvent) => {
    e.preventDefault();
    if (!appName.trim()) return;
    updateAppSettings({ name: appName, logo: appLogo });
    alert("Đã cập nhật cấu hình ứng dụng!");
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => setAppLogo(event.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      updateUser({ ...currentUser, avatar: base64 });
      alert("Đã cập nhật ảnh đại diện thành công!");
    };
    reader.readAsDataURL(file);
  };

  // Warehouse Handlers
  const handleAddWarehouse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWhName.trim() || !newWhAddress.trim()) return;

    if (editingWarehouse) {
      triggerAction(
        "Xác nhận cập nhật kho",
        `Bạn đang thay đổi thông tin kho "${editingWarehouse.name}". Mọi dữ liệu tồn kho và báo cáo sẽ được cập nhật theo tên mới.`,
        'warning',
        'Cập nhật ngay',
        () => {
          updateWarehouse({
            ...editingWarehouse,
            name: newWhName,
            address: newWhAddress,
            type: newWhType
          });
          setEditingWarehouse(null);
          setNewWhName(''); setNewWhAddress(''); setIsWhModalOpen(false);
        }
      );
    } else {
      addWarehouse({
        id: `wh-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: newWhName,
        address: newWhAddress,
        type: newWhType
      });
      setNewWhName(''); setNewWhAddress(''); setIsWhModalOpen(false);
    }
  };

  const handleEditWarehouse = (wh: Warehouse) => {
    setEditingWarehouse(wh);
    setNewWhName(wh.name);
    setNewWhAddress(wh.address);
    setNewWhType(wh.type);
    setIsWhModalOpen(true);
  };

  const handleDeleteWarehouse = (wh: Warehouse) => {
    triggerAction(
      "Xác nhận xoá kho bãi",
      `Hành động xoá kho "${wh.name}" là thao tác nhạy cảm. Nếu kho vẫn còn tồn kho, hệ thống sẽ chuyển kho vào trạng thái 'Lưu trữ' để bảo toàn dữ liệu báo cáo cho đến khi lượng tồn được chuyển đi hết.`,
      'danger',
      'Xác nhận xoá',
      () => removeWarehouse(wh.id)
    );
  };

  // Master Data CRUD with Confirmation
  const triggerAction = (
    title: string,
    message: string,
    type: 'danger' | 'warning' | 'success',
    actionLabel: string,
    onConfirm: () => void,
    countdown: boolean = true
  ) => {
    setConfirmModal({ isOpen: true, title, message, type, actionLabel, onConfirm, countdown });
  };

  // CRUD for Categories
  const handleAddCat = () => {
    if (!newCatName.trim()) return;

    if (editingItem && editingItem.type === 'cat') {
      const cat = editingItem.data as ItemCategory;
      triggerAction(
        "Xác nhận sửa danh mục",
        `Bạn đang thay đổi danh mục "${cat.name}" thành "${newCatName}". Điều này ảnh hưởng đến phân loại vật tư hiện có.`,
        'warning',
        'Lưu thay đổi',
        () => {
          updateCategory({ ...cat, name: newCatName.trim() });
          setEditingItem(null);
          setNewCatName('');
        }
      );
    } else {
      addCategory(newCatName.trim());
      setNewCatName('');
    }
  };

  const handleEditCat = (cat: ItemCategory) => {
    setEditingItem({ type: 'cat', data: cat });
    setNewCatName(cat.name);
  };

  const handleDeleteCat = (cat: ItemCategory) => {
    triggerAction(
      "Xoá danh mục vật tư",
      `Tất cả vật tư thuộc danh mục "${cat.name}" sẽ mất phân loại gốc. Bạn chắc chắn muốn xoá?`,
      'danger',
      'Xoá vĩnh viễn',
      () => removeCategory(cat.id)
    );
  };

  // CRUD for Units
  const handleAddUnit = () => {
    if (!newUnitName.trim()) return;

    if (editingItem && editingItem.type === 'unit') {
      const unit = editingItem.data as ItemUnit;
      triggerAction(
        "Xác nhận sửa đơn vị",
        `Thay đổi đơn vị "${unit.name}" thành "${newUnitName}" sẽ cập nhật hiển thị trên toàn bộ phiếu kho.`,
        'warning',
        'Lưu thay đổi',
        () => {
          updateUnit({ ...unit, name: newUnitName.trim() });
          setEditingItem(null);
          setNewUnitName('');
        }
      );
    } else {
      addUnit(newUnitName.trim());
      setNewUnitName('');
    }
  };

  const handleEditUnit = (unit: ItemUnit) => {
    setEditingItem({ type: 'unit', data: unit });
    setNewUnitName(unit.name);
  };

  const handleDeleteUnit = (unit: ItemUnit) => {
    triggerAction(
      "Xoá đơn vị tính",
      `Bạn chắc chắn muốn xoá đơn vị "${unit.name}"? Tồn kho hiện tại sẽ không còn đơn vị định danh.`,
      'danger',
      'Xoá vĩnh viễn',
      () => removeUnit(unit.id)
    );
  };

  // CRUD for Suppliers
  const handleAddSup = () => {
    if (!newSup.name.trim() || !newSup.phone.trim()) return;

    if (editingItem && editingItem.type === 'sup') {
      const sup = editingItem.data as Supplier;
      triggerAction(
        "Cập nhật thông tin đối tác",
        `Bạn đang thay đổi thông tin nhà cung cấp "${sup.name}".`,
        'warning',
        'Lưu thông tin',
        () => {
          updateSupplier({
            ...sup,
            name: newSup.name.trim(),
            contactPerson: newSup.contact.trim(),
            phone: newSup.phone.trim()
          });
          setEditingItem(null);
          setNewSup({ name: '', contact: '', phone: '' });
        }
      );
    } else {
      addSupplier({
        id: `sup-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: newSup.name,
        contactPerson: newSup.contact,
        phone: newSup.phone,
        debt: 0
      });
      setNewSup({ name: '', contact: '', phone: '' });
    }
  };

  const handleEditSup = (sup: Supplier) => {
    setEditingItem({ type: 'sup', data: sup });
    setNewSup({
      name: sup.name,
      contact: sup.contactPerson || '',
      phone: sup.phone
    });
  };

  const handleDeleteSup = (sup: Supplier) => {
    triggerAction(
      "Xoá nhà cung cấp",
      `Mọi lịch sử nhập hàng liên quan đến "${sup.name}" sẽ không còn đối tác tham chiếu.`,
      'danger',
      'Xoá vĩnh viễn',
      () => removeSupplier(sup.id)
    );
  };

  // User Handlers
  const handleAddUser = () => {
    setEditingUser(null);
    setIsUserModalOpen(true);
  };

  const handleEditUser = (u: User) => {
    setEditingUser(u);
    setIsUserModalOpen(true);
  };

  const handleDeleteUserClick = (u: User) => {
    if (u.id === currentUser.id) {
      alert("Bạn không thể tự xoá tài khoản của chính mình!");
      return;
    }
    setDeletingUser(u);
    setIsUserDeleteModalOpen(true);
  };

  const handleConfirmDeleteUser = () => {
    if (deletingUser) {
      removeUser(deletingUser.id);
      setIsUserDeleteModalOpen(false);
      setDeletingUser(null);
    }
  };

  const handleSaveUser = (userData: User) => {
    if (editingUser) {
      updateUser(userData);
    } else {
      addUser(userData);
    }
    setIsUserModalOpen(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');
    setPassSuccess('');

    if (passwords.new.length < 6) {
      setPassError('Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }

    if (passwords.new !== passwords.confirm) {
      setPassError('Xác nhận mật khẩu mới không khớp.');
      return;
    }

    if (isSupabaseConfigured) {
      try {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: currentUser.email,
          password: passwords.current,
        });

        if (signInError) {
          setPassError('Mật khẩu hiện tại không chính xác.');
          return;
        }

        const { error: updateError } = await supabase.auth.updateUser({
          password: passwords.new
        });

        if (updateError) {
          setPassError('Có lỗi xảy ra khi cập nhật mật khẩu.');
          return;
        }

        setPassSuccess('Đã đổi mật khẩu thành công!');
        setPasswords({ current: '', new: '', confirm: '' });
      } catch (err: any) {
        setPassError(err.message || 'Có lỗi xảy ra.');
      }
    } else {
      if (passwords.current !== currentUser.password) {
        setPassError('Mật khẩu hiện tại không chính xác.');
        return;
      }
      updateUser({ ...currentUser, password: passwords.new });
      setPassSuccess('Đã đổi mật khẩu thành công!');
      setPasswords({ current: '', new: '', confirm: '' });
    }
  };

  const getRoleBadge = (role: Role) => {
    switch (role) {
      case Role.ADMIN: return <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-[10px] font-bold">QUẢN TRỊ VIÊN</span>;
      case Role.ACCOUNTANT: return <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-[10px] font-bold">KẾ TOÁN</span>;
      case Role.KEEPER: return <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-[10px] font-bold">THỦ KHO</span>;
      default: return <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-[10px] font-bold">NHÂN VIÊN</span>;
    }
  };

  const tabs = [
    { id: 'general', label: 'Chung', icon: SettingsIcon, roles: [Role.ADMIN] },
    { id: 'warehouses', label: 'Kho bãi', icon: Building, roles: [Role.ADMIN] },
    { id: 'master-data', label: 'Dữ liệu gốc', icon: Database, roles: [Role.ADMIN] },
    { id: 'hrm-master-data', label: 'Dữ liệu gốc HRM', icon: Briefcase, roles: [Role.ADMIN] },
    { id: 'users', label: 'Người dùng', icon: Users, roles: [Role.ADMIN] },
    { id: 'account', label: 'Tài khoản', icon: UserIcon },
    { id: 'maintenance', label: 'Bảo trì', icon: AlertCircle, roles: [Role.ADMIN] },
  ].filter(tab => !tab.roles || tab.roles.includes(currentUser.role));

  useEffect(() => {
    // If current tab is not allowed, switch to account
    if (!tabs.find(t => t.id === activeTab)) {
      setActiveTab('account');
    }
  }, [currentUser.role]);

  return (
    <div className="space-y-6">
      <MasterDataConfirmModal
        {...confirmModal}
        onClose={() => setConfirmModal(p => ({ ...p, isOpen: false }))}
        onConfirm={() => { confirmModal.onConfirm(); setConfirmModal(p => ({ ...p, isOpen: false })); }}
      />

      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-black text-slate-800 tracking-tight">Cấu hình hệ thống</h1>
        <div className="flex items-center gap-2">
          {connectionError ? (
            <div className="bg-red-50 text-red-600 px-3 py-1 rounded-full text-[10px] font-black uppercase flex items-center border border-red-100">
              <AlertCircle size={12} className="mr-1" /> Lỗi kết nối Database
            </div>
          ) : (
            <div className="bg-amber-50 text-amber-600 px-3 py-1 rounded-full text-[10px] font-black uppercase flex items-center border border-amber-100">
              <AlertCircle size={12} className="mr-1" /> Chế độ Offline (Local)
            </div>
          )}
          <div className="bg-blue-50 text-accent px-3 py-1 rounded-full text-[10px] font-black uppercase flex items-center border border-blue-100">
            <AlertCircle size={12} className="mr-1" /> Toàn quyền Admin
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Navigation Sidebar */}
        <div className="w-full lg:w-64 flex-shrink-0">
          <nav className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden p-2 space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center px-4 py-3 rounded-xl text-sm font-bold transition-all
                  ${activeTab === tab.id
                    ? 'bg-primary text-white shadow-lg shadow-slate-900/20'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                  }`}
              >
                <tab.icon className="w-5 h-5 mr-3" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1">
          {activeTab === 'general' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                <h2 className="text-lg font-bold text-slate-800">Thông tin ứng dụng</h2>
                <p className="text-xs text-slate-500 font-medium">Cấu hình nhận diện thương hiệu công ty.</p>
              </div>
              <form onSubmit={handleSaveGeneral} className="p-6 space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">Tên doanh nghiệp</label>
                      <input
                        type="text" value={appName} onChange={(e) => setAppName(e.target.value)}
                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-accent outline-none font-bold text-slate-700"
                      />
                    </div>
                    <div className="space-y-4">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Logo công ty</label>
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={() => fileInputRef.current?.click()} className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-700 hover:bg-slate-50 transition flex items-center justify-center gap-2">
                          <Upload size={18} /> Tải logo mới
                        </button>
                        <input type="file" ref={fileInputRef} onChange={handleLogoUpload} accept="image/*" className="hidden" />
                        {appLogo && (
                          <button type="button" onClick={() => setAppLogo('')} className="p-3 bg-red-50 text-red-600 rounded-xl border border-red-100 hover:bg-red-600 hover:text-white transition shadow-sm"><Trash size={18} /></button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4 bg-primary/5 p-6 rounded-2xl border border-dashed border-slate-200">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center block">Xem trước thương hiệu</label>
                    <div className="bg-primary p-6 rounded-xl flex items-center gap-4 shadow-xl">
                      {appLogo ? <img src={appLogo} alt="" className="w-10 h-10 object-contain rounded" /> : <div className="w-10 h-10 bg-accent rounded flex items-center justify-center font-bold text-white">KV</div>}
                      <span className="text-white text-xl font-black">{appName}</span>
                    </div>
                  </div>
                </div>
                <div className="pt-4 border-t border-slate-100 flex justify-end">
                  <button type="submit" className="px-8 py-3 bg-accent text-white rounded-xl font-bold hover:bg-blue-700 transition shadow-lg shadow-blue-500/20 flex items-center"><Save size={18} className="mr-2" /> Lưu cấu hình</button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'warehouses' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Danh mục Kho bãi</h2>
                  <p className="text-xs text-slate-500 font-medium">Hệ thống quản lý địa điểm lưu trữ.</p>
                </div>
                <button
                  onClick={() => {
                    setEditingWarehouse(null);
                    setNewWhName('');
                    setNewWhAddress('');
                    setNewWhType('SITE');
                    setIsWhModalOpen(true);
                  }}
                  className="flex items-center px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition font-bold text-xs"
                >
                  <Plus className="w-4 h-4 mr-2" /> Thêm kho
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {warehouses.map((wh) => (
                  <div key={wh.id} className={`bg-white p-5 rounded-2xl shadow-sm border group relative transition-all ${wh.isArchived ? 'opacity-60 border-dashed border-slate-300 bg-slate-50' : 'border-slate-100 hover:border-accent/30'}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${wh.isArchived ? 'bg-slate-200 text-slate-400' : 'bg-slate-50 text-slate-400 group-hover:text-accent'}`}>
                        <Building size={20} />
                      </div>
                      <div className="flex items-center gap-2">
                        {wh.isArchived && (
                          <span className="text-[9px] font-black px-2 py-1 rounded-lg uppercase bg-red-50 text-red-600 border border-red-100">
                            Đã lưu trữ (Còn tồn)
                          </span>
                        )}
                        <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase border ${wh.type === 'GENERAL' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-orange-50 text-orange-600 border-orange-100'}`}>
                          {wh.type === 'GENERAL' ? 'Kho Tổng' : 'Công trình'}
                        </span>
                      </div>
                    </div>
                    <h3 className={`font-bold mb-1 ${wh.isArchived ? 'text-slate-500' : 'text-slate-800'}`}>{wh.name}</h3>
                    <div className="flex items-start text-slate-400 text-[11px] leading-relaxed mb-4">
                      <MapPin className="w-3 h-3 mr-1 mt-0.5" />{wh.address}
                    </div>

                    <div className="flex gap-2 pt-3 border-t border-slate-50 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleEditWarehouse(wh)}
                        className="flex-1 py-2 bg-slate-50 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-blue-50 hover:text-accent transition-colors flex items-center justify-center"
                      >
                        <Edit2 size={12} className="mr-1" /> Chỉnh sửa
                      </button>
                      <button
                        onClick={() => handleDeleteWarehouse(wh)}
                        className="flex-1 py-2 bg-slate-50 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-red-50 hover:text-red-600 transition-colors flex items-center justify-center"
                      >
                        <Trash2 size={12} className="mr-1" /> Xoá kho
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'master-data' && (
            <div className="animate-in slide-in-from-right-4 duration-300">
              {!activeMasterSection ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <button
                    onClick={() => setActiveMasterSection('categories')}
                    className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:border-accent/20 transition-all group text-left"
                  >
                    <div className="w-14 h-14 bg-blue-50 text-accent rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                      <Tag size={28} />
                    </div>
                    <h3 className="text-xl font-black text-slate-800 mb-2">Danh mục vật tư</h3>
                    <p className="text-sm text-slate-500 font-medium">Quản lý các nhóm phân loại vật tư trong hệ thống.</p>
                    <div className="mt-6 flex items-center text-accent font-bold text-xs uppercase tracking-widest">
                      Thiết lập ngay <Plus size={14} className="ml-1" />
                    </div>
                  </button>

                  <button
                    onClick={() => setActiveMasterSection('units')}
                    className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:border-accent/20 transition-all group text-left"
                  >
                    <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                      <Ruler size={28} />
                    </div>
                    <h3 className="text-xl font-black text-slate-800 mb-2">Đơn vị tính</h3>
                    <p className="text-sm text-slate-500 font-medium">Cấu hình các đơn vị đo lường (kg, bao, cái, mét...).</p>
                    <div className="mt-6 flex items-center text-emerald-600 font-bold text-xs uppercase tracking-widest">
                      Thiết lập ngay <Plus size={14} className="ml-1" />
                    </div>
                  </button>

                  <button
                    onClick={() => setActiveMasterSection('suppliers')}
                    className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:border-accent/20 transition-all group text-left"
                  >
                    <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                      <Truck size={28} />
                    </div>
                    <h3 className="text-xl font-black text-slate-800 mb-2">Nhà cung cấp</h3>
                    <p className="text-sm text-slate-500 font-medium">Quản lý thông tin đối tác cung ứng vật tư.</p>
                    <div className="mt-6 flex items-center text-amber-600 font-bold text-xs uppercase tracking-widest">
                      Thiết lập ngay <Plus size={14} className="ml-1" />
                    </div>
                  </button>
                </div>
              ) : (
                <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden flex flex-col min-h-[600px]">
                  <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => {
                          setActiveMasterSection(null);
                          setEditingItem(null);
                          setNewCatName('');
                          setNewUnitName('');
                          setNewSup({ name: '', contact: '', phone: '' });
                        }}
                        className="p-2 hover:bg-white rounded-xl text-slate-400 hover:text-slate-800 transition-all border border-transparent hover:border-slate-200"
                      >
                        <X size={20} />
                      </button>
                      <div>
                        <h2 className="text-lg font-black text-slate-800">
                          {activeMasterSection === 'categories' && 'Quản lý Danh mục vật tư'}
                          {activeMasterSection === 'units' && 'Quản lý Đơn vị tính'}
                          {activeMasterSection === 'suppliers' && 'Quản lý Nhà cung cấp'}
                        </h2>
                        <p className="text-xs text-slate-500 font-medium">Thêm, sửa hoặc xoá các thông tin dữ liệu gốc.</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 p-8">
                    {activeMasterSection === 'categories' && (
                      <div className="max-w-2xl mx-auto space-y-6">
                        <div className="flex gap-3">
                          <input
                            type="text" placeholder="Nhập tên danh mục mới..." value={newCatName}
                            onChange={(e) => setNewCatName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddCat()}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:ring-2 focus:ring-accent transition-all"
                          />
                          {editingItem?.type === 'cat' && (
                            <button
                              onClick={() => { setEditingItem(null); setNewCatName(''); }}
                              className="px-6 py-4 border border-slate-200 text-slate-500 rounded-2xl font-bold text-xs uppercase hover:bg-slate-50 transition-all"
                            >
                              Hủy
                            </button>
                          )}
                          <button onClick={handleAddCat} className="bg-accent text-white px-8 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition shadow-lg shadow-blue-500/20 flex items-center gap-2">
                            {editingItem?.type === 'cat' ? <Save size={18} /> : <Plus size={18} />}
                            {editingItem?.type === 'cat' ? 'Cập nhật' : 'Thêm mới'}
                          </button>
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                          {categories.map(cat => (
                            <div key={cat.id} className="flex items-center justify-between p-5 rounded-2xl bg-white border border-slate-100 hover:border-accent/20 hover:shadow-md transition-all group">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-blue-50 text-accent rounded-xl flex items-center justify-center font-black text-xs">
                                  {cat.name.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-sm font-bold text-slate-700">{cat.name}</span>
                              </div>
                              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => handleEditCat(cat)} className="p-2 text-slate-400 hover:text-accent hover:bg-blue-50 rounded-xl transition-colors"><Edit2 size={16} /></button>
                                <button onClick={() => handleDeleteCat(cat)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"><Trash2 size={16} /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeMasterSection === 'units' && (
                      <div className="max-w-2xl mx-auto space-y-6">
                        <div className="flex gap-3">
                          <input
                            type="text" placeholder="Nhập đơn vị tính mới (kg, bao, cái...)" value={newUnitName}
                            onChange={(e) => setNewUnitName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddUnit()}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:ring-2 focus:ring-accent transition-all"
                          />
                          {editingItem?.type === 'unit' && (
                            <button
                              onClick={() => { setEditingItem(null); setNewUnitName(''); }}
                              className="px-6 py-4 border border-slate-200 text-slate-500 rounded-2xl font-bold text-xs uppercase hover:bg-slate-50 transition-all"
                            >
                              Hủy
                            </button>
                          )}
                          <button onClick={handleAddUnit} className="bg-emerald-600 text-white px-8 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition shadow-lg shadow-emerald-500/20 flex items-center gap-2">
                            {editingItem?.type === 'unit' ? <Save size={18} /> : <Plus size={18} />}
                            {editingItem?.type === 'unit' ? 'Cập nhật' : 'Thêm mới'}
                          </button>
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                          {units.map(unit => (
                            <div key={unit.id} className="flex items-center justify-between p-5 rounded-2xl bg-white border border-slate-100 hover:border-emerald-200 hover:shadow-md transition-all group">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center font-black text-xs">
                                  {unit.name}
                                </div>
                                <span className="text-sm font-bold text-slate-700">Đơn vị: {unit.name}</span>
                              </div>
                              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => handleEditUnit(unit)} className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors"><Edit2 size={16} /></button>
                                <button onClick={() => handleDeleteUnit(unit)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"><Trash2 size={16} /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeMasterSection === 'suppliers' && (
                      <div className="max-w-4xl mx-auto space-y-8">
                        <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200 space-y-4">
                          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                            {editingItem?.type === 'sup' ? 'Cập nhật nhà cung cấp' : 'Thêm nhà cung cấp mới'}
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <input
                              type="text" placeholder="Tên đối tác..."
                              className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-accent"
                              value={newSup.name} onChange={(e) => setNewSup({ ...newSup, name: e.target.value })}
                            />
                            <input
                              type="text" placeholder="Người liên hệ..."
                              className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-accent"
                              value={newSup.contact} onChange={(e) => setNewSup({ ...newSup, contact: e.target.value })}
                            />
                            <div className="flex gap-2">
                              <input
                                type="text" placeholder="Số điện thoại..."
                                className="flex-1 bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-accent"
                                value={newSup.phone} onChange={(e) => setNewSup({ ...newSup, phone: e.target.value })}
                              />
                              {editingItem?.type === 'sup' && (
                                <button
                                  onClick={() => { setEditingItem(null); setNewSup({ name: '', contact: '', phone: '' }); }}
                                  className="px-4 bg-white border border-slate-200 text-slate-500 rounded-2xl font-bold text-xs uppercase hover:bg-slate-50 transition-all"
                                >
                                  Hủy
                                </button>
                              )}
                              <button onClick={handleAddSup} className={`${editingItem?.type === 'sup' ? 'bg-blue-600' : 'bg-amber-600'} text-white px-6 rounded-2xl hover:opacity-90 transition font-black text-xs uppercase tracking-widest shadow-lg`}>
                                {editingItem?.type === 'sup' ? 'Cập nhật' : 'Thêm'}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {suppliers.map(sup => (
                            <div key={sup.id} className="p-6 rounded-3xl bg-white border border-slate-100 hover:border-amber-200 hover:shadow-xl group transition-all relative">
                              <div className="flex justify-between items-start">
                                <div className="flex gap-4">
                                  <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center">
                                    <Truck size={24} />
                                  </div>
                                  <div>
                                    <p className="text-lg font-black text-slate-800 mb-1">{sup.name}</p>
                                    <div className="flex flex-col gap-1">
                                      <p className="text-xs text-slate-400 flex items-center font-bold uppercase tracking-tight">
                                        <UserIcon size={12} className="mr-1 text-slate-300" /> {sup.contactPerson || 'N/A'}
                                      </p>
                                      <p className="text-xs text-amber-600 font-black tracking-widest">{sup.phone}</p>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => handleEditSup(sup)} className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-colors"><Edit2 size={16} /></button>
                                  <button onClick={() => handleDeleteSup(sup)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"><Trash2 size={16} /></button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'hrm-master-data' && (
            <div className="animate-in slide-in-from-right-4 duration-300">
              {!activeHrmSection ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[
                    { key: 'areas' as const, label: 'Khu vực / Chuyên môn', desc: 'Phân vùng theo lĩnh vực chuyên môn.', icon: MapPinned, color: 'blue', count: hrmAreas.length },
                    { key: 'offices' as const, label: 'Văn phòng', desc: 'Các địa điểm văn phòng công ty.', icon: Building, color: 'emerald', count: hrmOffices.length },
                    { key: 'employee_types' as const, label: 'Phân loại nhân sự', desc: 'Fulltime, Part-time, Intern...', icon: Layers, color: 'violet', count: hrmEmployeeTypes.length },
                    { key: 'positions' as const, label: 'Vị trí công việc', desc: 'Ban GĐ, Trưởng phòng, Chuyên viên...', icon: HardHat, color: 'amber', count: hrmPositions.length },
                    { key: 'salary_policies' as const, label: 'Chính sách lương', desc: 'Lương VP, Lương nhà máy, công trường...', icon: DollarSign, color: 'rose', count: hrmSalaryPolicies.length },
                    { key: 'work_schedules' as const, label: 'Lịch làm việc', desc: 'Lịch VP, Lịch nhà máy, công trường...', icon: Calendar, color: 'cyan', count: hrmWorkSchedules.length },
                  ].map(item => (
                    <button
                      key={item.key}
                      onClick={() => setActiveHrmSection(item.key)}
                      className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:border-slate-200 transition-all group text-left"
                    >
                      <div className={`w-14 h-14 bg-${item.color}-50 text-${item.color}-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                        <item.icon size={28} />
                      </div>
                      <h3 className="text-xl font-black text-slate-800 mb-2">{item.label}</h3>
                      <p className="text-sm text-slate-500 font-medium">{item.desc}</p>
                      <div className="mt-6 flex items-center justify-between">
                        <span className={`text-${item.color}-600 font-bold text-xs uppercase tracking-widest flex items-center`}>
                          Thiết lập ngay <Plus size={14} className="ml-1" />
                        </span>
                        <span className="text-xs font-black text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">{item.count} mục</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (() => {
                const hrmConfig: Record<string, { table: string; label: string; items: any[]; hasDesc: boolean; placeholderName: string; placeholderDesc?: string; color: string; icon: any }> = {
                  'areas': { table: 'hrm_areas', label: 'Khu vực / Chuyên môn', items: hrmAreas, hasDesc: true, placeholderName: 'VD: Kết cấu thép, Xây dựng, Cơ khí...', placeholderDesc: 'Mô tả khu vực', color: 'blue', icon: MapPinned },
                  'offices': { table: 'hrm_offices', label: 'Văn phòng', items: hrmOffices, hasDesc: true, placeholderName: 'VD: Văn phòng Hà Nội...', placeholderDesc: 'Địa chỉ văn phòng', color: 'emerald', icon: Building },
                  'employee_types': { table: 'hrm_employee_types', label: 'Phân loại nhân sự', items: hrmEmployeeTypes, hasDesc: false, placeholderName: 'VD: Fulltime, Part-time, Intern...', color: 'violet', icon: Layers },
                  'positions': { table: 'hrm_positions', label: 'Vị trí công việc', items: hrmPositions, hasDesc: false, placeholderName: 'VD: Ban GĐ, Trưởng phòng, Chuyên viên...', color: 'amber', icon: HardHat },
                  'salary_policies': { table: 'hrm_salary_policies', label: 'Chính sách lương', items: hrmSalaryPolicies, hasDesc: true, placeholderName: 'VD: Lương văn phòng, Lương nhà máy...', placeholderDesc: 'Mô tả chính sách', color: 'rose', icon: DollarSign },
                  'work_schedules': { table: 'hrm_work_schedules', label: 'Lịch làm việc', items: hrmWorkSchedules, hasDesc: true, placeholderName: 'VD: Lịch văn phòng, Lịch nhà máy...', placeholderDesc: 'Mô tả lịch làm việc', color: 'cyan', icon: Calendar },
                };
                const cfg = hrmConfig[activeHrmSection];
                if (!cfg) return null;

                const handleHrmAdd = () => {
                  if (!newHrmName.trim()) return;
                  if (editingHrmItem) {
                    const updated = { ...editingHrmItem, name: newHrmName.trim(), ...(cfg.hasDesc ? { [cfg.table === 'hrm_offices' ? 'address' : 'description']: newHrmDesc.trim() } : {}) };
                    updateHrmItem(cfg.table, updated);
                    setEditingHrmItem(null);
                  } else {
                    const newItem: any = { id: crypto.randomUUID(), name: newHrmName.trim() };
                    if (cfg.hasDesc) {
                      newItem[cfg.table === 'hrm_offices' ? 'address' : 'description'] = newHrmDesc.trim();
                    }
                    addHrmItem(cfg.table, newItem);
                  }
                  setNewHrmName('');
                  setNewHrmDesc('');
                };

                const handleHrmEdit = (item: any) => {
                  setEditingHrmItem(item);
                  setNewHrmName(item.name);
                  setNewHrmDesc(item.description || item.address || '');
                };

                const handleHrmDelete = (id: string) => {
                  const item = cfg.items.find((i: any) => i.id === id);
                  triggerAction(
                    `Xoá ${cfg.label}`,
                    `Bạn chắc chắn muốn xoá "${item?.name}"? Nhân sự đang sử dụng mục này sẽ mất liên kết.`,
                    'danger',
                    'Xoá vĩnh viễn',
                    () => removeHrmItem(cfg.table, id)
                  );
                };

                return (
                  <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden flex flex-col min-h-[600px]">
                    <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => { setActiveHrmSection(null); setEditingHrmItem(null); setNewHrmName(''); setNewHrmDesc(''); }}
                          className="p-2 hover:bg-white rounded-xl text-slate-400 hover:text-slate-800 transition-all border border-transparent hover:border-slate-200"
                        >
                          <X size={20} />
                        </button>
                        <div>
                          <h2 className="text-lg font-black text-slate-800">Quản lý {cfg.label}</h2>
                          <p className="text-xs text-slate-500 font-medium">Thêm, sửa hoặc xoá dữ liệu gốc HRM.</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 p-8">
                      <div className="max-w-2xl mx-auto space-y-6">
                        <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200 space-y-4">
                          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                            {editingHrmItem ? `Cập nhật ${cfg.label}` : `Thêm ${cfg.label} mới`}
                          </h3>
                          <div className="space-y-3">
                            <input
                              type="text" placeholder={cfg.placeholderName} value={newHrmName}
                              onChange={(e) => setNewHrmName(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && !cfg.hasDesc && handleHrmAdd()}
                              className="w-full bg-white border border-slate-200 rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:ring-2 focus:ring-accent transition-all"
                            />
                            {cfg.hasDesc && (
                              <input
                                type="text" placeholder={cfg.placeholderDesc} value={newHrmDesc}
                                onChange={(e) => setNewHrmDesc(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleHrmAdd()}
                                className="w-full bg-white border border-slate-200 rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:ring-2 focus:ring-accent transition-all"
                              />
                            )}
                            <div className="flex gap-3">
                              {editingHrmItem && (
                                <button
                                  onClick={() => { setEditingHrmItem(null); setNewHrmName(''); setNewHrmDesc(''); }}
                                  className="px-6 py-3 border border-slate-200 text-slate-500 rounded-2xl font-bold text-xs uppercase hover:bg-slate-50 transition-all"
                                >
                                  Hủy
                                </button>
                              )}
                              <button onClick={handleHrmAdd} className={`flex-1 bg-${cfg.color}-600 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:opacity-90 transition shadow-lg flex items-center justify-center gap-2`}>
                                {editingHrmItem ? <Save size={18} /> : <Plus size={18} />}
                                {editingHrmItem ? 'Cập nhật' : 'Thêm mới'}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                          {cfg.items.map((item: any) => (
                            <div key={item.id} className={`flex items-center justify-between p-5 rounded-2xl bg-white border border-slate-100 hover:border-${cfg.color}-200 hover:shadow-md transition-all group`}>
                              <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 bg-${cfg.color}-50 text-${cfg.color}-600 rounded-xl flex items-center justify-center font-black text-xs`}>
                                  <cfg.icon size={18} />
                                </div>
                                <div>
                                  <span className="text-sm font-bold text-slate-700 block">{item.name}</span>
                                  {(item.description || item.address) && (
                                    <span className="text-xs text-slate-400">{item.description || item.address}</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => handleHrmEdit(item)} className={`p-2 text-slate-400 hover:text-${cfg.color}-600 hover:bg-${cfg.color}-50 rounded-xl transition-colors`}><Edit2 size={16} /></button>
                                <button onClick={() => handleHrmDelete(item.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"><Trash2 size={16} /></button>
                              </div>
                            </div>
                          ))}
                          {cfg.items.length === 0 && (
                            <div className="text-center py-12 text-slate-400">
                              <cfg.icon size={40} className="mx-auto mb-3 opacity-30" />
                              <p className="text-sm font-bold">Chưa có dữ liệu nào</p>
                              <p className="text-xs">Hãy thêm {cfg.label.toLowerCase()} đầu tiên</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {activeTab === 'users' && (
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
          )}

          {activeTab === 'account' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                <h2 className="text-lg font-bold text-slate-800">Tài khoản cá nhân</h2>
                <p className="text-xs text-slate-500 font-medium">Thay đổi thông tin, ảnh đại diện và mật khẩu.</p>
              </div>
              <div className="p-6 space-y-8">
                {/* Avatar Section */}
                <div>
                  <h3 className="text-sm font-bold text-slate-800 mb-4">Ảnh đại diện</h3>
                  <div className="flex items-center gap-6">
                    <img src={currentUser.avatar} alt="Avatar" className="w-20 h-20 rounded-full border-4 border-slate-50 shadow-sm object-cover" />
                    <div className="space-y-2">
                      <button onClick={() => avatarInputRef.current?.click()} className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm flex items-center">
                        <Upload size={14} className="mr-2" /> Tải ảnh lên
                      </button>
                      <input type="file" ref={avatarInputRef} onChange={handleAvatarUpload} accept="image/*" className="hidden" />
                      <p className="text-[10px] text-slate-400">Định dạng hỗ trợ: JPG, PNG. Ảnh sẽ được tự động cắt theo hình vuông.</p>
                    </div>
                  </div>
                </div>

                {/* Password Section */}
                <h3 className="text-sm font-bold text-slate-800 mb-4">Đổi mật khẩu</h3>
                <form onSubmit={handleChangePassword} className="max-w-md space-y-4">
                  {passError && (
                    <div className="bg-red-50 border border-red-100 p-4 rounded-xl flex items-center gap-3 text-red-600">
                      <AlertCircle size={18} />
                      <p className="text-xs font-bold">{passError}</p>
                    </div>
                  )}
                  {passSuccess && (
                    <div className="bg-green-50 border border-green-100 p-4 rounded-xl flex items-center gap-3 text-green-600">
                      <Save size={18} />
                      <p className="text-xs font-bold">{passSuccess}</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mật khẩu hiện tại</label>
                    <input
                      type="password"
                      required
                      value={passwords.current}
                      onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-accent font-medium"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mật khẩu mới</label>
                    <input
                      type="password"
                      required
                      value={passwords.new}
                      onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-accent font-medium"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Xác nhận mật khẩu mới</label>
                    <input
                      type="password"
                      required
                      value={passwords.confirm}
                      onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-accent font-medium"
                    />
                  </div>

                  <button
                    type="submit"
                    className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition shadow-lg"
                  >
                    Cập nhật mật khẩu
                  </button>
                </form>

                <div className="pt-8 border-t border-slate-100">
                  <h3 className="text-sm font-bold text-slate-800 mb-2">Đăng xuất</h3>
                  <p className="text-xs text-slate-500 mb-4">Kết thúc phiên làm việc hiện tại trên thiết bị này.</p>
                  <button
                    onClick={() => {
                      logout();
                      window.location.href = '/login';
                    }}
                    className="px-6 py-3 bg-red-50 text-red-600 border border-red-100 rounded-xl font-bold hover:bg-red-600 hover:text-white transition"
                  >
                    Đăng xuất ngay
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'maintenance' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-6 border-b border-slate-100 bg-red-50/30">
                <h2 className="text-lg font-bold text-red-800 flex items-center">
                  <AlertCircle size={20} className="mr-2" /> Khu vực nguy hiểm
                </h2>
                <p className="text-xs text-red-500 font-medium">Các thao tác tại đây không thể hoàn tác. Hãy cẩn trọng.</p>
              </div>
              <div className="p-8 space-y-8">
                <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 rounded-2xl border border-red-100 bg-red-50/10">
                  <div className="space-y-1 text-center md:text-left">
                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Xóa toàn bộ dữ liệu vật tư & giao dịch</h3>
                    <p className="text-xs text-slate-500 max-w-md">Xóa sạch danh sách vật tư, lịch sử nhập/xuất kho, yêu cầu vật tư và nhật ký hoạt động. Danh mục kho bãi và người dùng sẽ được giữ lại.</p>
                  </div>
                  <button
                    onClick={() => {
                      triggerAction(
                        "Xác nhận XÓA SẠCH dữ liệu",
                        "Hành động này sẽ xóa toàn bộ vật tư và lịch sử giao dịch. Bạn sẽ không thể khôi phục lại dữ liệu này.",
                        'danger',
                        'XÓA VĨNH VIỄN',
                        () => {
                          clearAllData();
                          alert("Đã xóa sạch dữ liệu vật tư và giao dịch.");
                        },
                        true // countdown
                      );
                    }}
                    className="px-6 py-3 bg-red-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-red-700 transition shadow-lg shadow-red-500/20 flex items-center gap-2"
                  >
                    <Trash2 size={16} /> Xóa dữ liệu
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Warehouse Add/Edit Modal */}
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

      {isWhModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-black text-xs uppercase tracking-widest text-slate-800">
                {editingWarehouse ? 'Cập nhật kho bãi' : 'Thêm kho bãi mới'}
              </h3>
              <button onClick={() => setIsWhModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <form onSubmit={handleAddWarehouse} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tên kho nhận diện</label>
                <input type="text" value={newWhName} onChange={(e) => setNewWhName(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-accent outline-none font-bold" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loại hình kho</label>
                <select value={newWhType} onChange={(e) => setNewWhType(e.target.value as WarehouseType)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-accent outline-none font-bold">
                  <option value="SITE">Kho Công Trình</option>
                  <option value="GENERAL">Kho Tổng</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Địa chỉ vật lý</label>
                <textarea value={newWhAddress} onChange={(e) => setNewWhAddress(e.target.value)} rows={3} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-accent outline-none resize-none font-medium text-xs" />
              </div>
              <div className="pt-2 grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setIsWhModalOpen(false)} className="py-3 border border-slate-200 text-slate-500 rounded-xl font-bold text-xs hover:bg-slate-50 transition">Hủy bỏ</button>
                <button type="submit" className="py-3 bg-accent text-white rounded-xl font-bold text-xs hover:bg-blue-700 transition shadow-lg shadow-blue-500/20 flex items-center justify-center">
                  <Save size={16} className="mr-2" /> {editingWarehouse ? 'Cập nhật' : 'Lưu thông tin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
