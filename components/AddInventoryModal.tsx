
import React, { useMemo, useState, useEffect } from 'react';
import { X, Save, ShieldAlert, Truck, MapPin, Loader2 } from 'lucide-react';
import { BusinessPartner, InventoryItem, Role, Transaction, TransactionType, TransactionStatus } from '../types';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { partnerService } from '../lib/partnerService';
import { supplierPartnerBridge } from '../lib/supplierPartnerBridge';

interface AddInventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (item: InventoryItem) => void | Promise<void>;
}

const AddInventoryModal: React.FC<AddInventoryModalProps> = ({ isOpen, onClose, onAdd }) => {
  const { warehouses, categories, units, user, addTransaction, logActivity } = useApp();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [supplierPartners, setSupplierPartners] = useState<BusinessPartner[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierLoading, setSupplierLoading] = useState(false);

  const [formData, setFormData] = useState({
    sku: '',
    name: '',
    category: '',
    unit: '',
    purchaseUnit: '', // Đơn vị mua (KG, Tấn...) - để trống nếu giống đơn vị tồn kho
    supplierId: '',
    priceIn: 0,
    priceOut: 0,
    minStock: 0,
    defaultLeadTimeDays: 7,
    location: '',
    initialWarehouseId: '',
    initialStock: 0,
  });

  // Khởi tạo giá trị kho mặc định cho Thủ kho
  useEffect(() => {
    if (isOpen) {
      if (user.assignedWarehouseId) {
        setFormData(prev => ({ ...prev, initialWarehouseId: user.assignedWarehouseId || '' }));
      } else {
        setFormData(prev => ({ ...prev, initialWarehouseId: '' }));
      }
    }
  }, [isOpen, user]);

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setSupplierLoading(true);
    partnerService.list({ classification: 'supplier' })
      .then(rows => {
        if (!alive) return;
        setSupplierPartners(rows);
      })
      .catch(error => {
        if (!alive) return;
        logApiError('addInventory.loadSupplierPartners', error);
        toast.error('Không tải được HĐ đối tác', getApiErrorMessage(error, 'Không thể tải danh sách nhà cung cấp từ HĐ đối tác.'));
      })
      .finally(() => {
        if (alive) setSupplierLoading(false);
      });
    return () => { alive = false; };
  }, [isOpen, toast]);

  const filteredSupplierPartners = useMemo(() => {
    const keyword = supplierSearch.trim().toLowerCase();
    const rows = supplierPartners.map(partner => ({
      partner,
      haystack: [partner.name, partner.code, partner.taxCode, partner.phone, partner.contactName, partner.contactPhone]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
    }));
    if (!keyword) return rows.slice(0, 8).map(row => row.partner);
    return rows
      .filter(row => row.haystack.includes(keyword))
      .slice(0, 8)
      .map(row => row.partner);
  }, [supplierPartners, supplierSearch]);

  const selectedSupplierPartner = useMemo(
    () => supplierPartners.find(partner => partner.id === formData.supplierId),
    [formData.supplierId, supplierPartners],
  );

  const clearSupplier = () => {
    setFormData(prev => ({ ...prev, supplierId: '' }));
    setSupplierSearch('');
    setSupplierOpen(false);
  };

  const pickSupplier = (partner: BusinessPartner) => {
    setFormData(prev => ({ ...prev, supplierId: partner.id }));
    setSupplierSearch(partner.name);
    setSupplierOpen(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const numberFields = ['priceIn', 'priceOut', 'minStock', 'defaultLeadTimeDays', 'initialStock'];

    setFormData(prev => ({
      ...prev,
      [name]: numberFields.includes(name) ? Number(value) : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.sku || !formData.name || !formData.category || !formData.unit) {
      toast.error('Thiếu thông tin', 'Vui lòng nhập đầy đủ: Mã SKU, Tên, Danh mục, Đơn vị tính');
      return;
    }

    // 1. Tạo vật tư mới trong danh mục
    const newItem: InventoryItem = {
      id: `it-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      sku: formData.sku,
      name: formData.name,
      category: formData.category,
      unit: formData.unit,
      purchaseUnit: (formData.purchaseUnit && formData.purchaseUnit !== formData.unit) ? formData.purchaseUnit : undefined,
      supplierId: formData.supplierId || undefined,
      priceIn: formData.priceIn,
      priceOut: formData.priceOut,
      minStock: formData.minStock,
      defaultLeadTimeDays: formData.defaultLeadTimeDays,
      location: formData.location || undefined,
      stockByWarehouse: {}
    };

    setSaving(true);
    try {
      await supplierPartnerBridge.ensureLegacySupplier(selectedSupplierPartner);
      await onAdd(newItem);

      // 2. Nếu có nhập số lượng ban đầu, tạo Transaction
      if (formData.initialWarehouseId && formData.initialStock > 0) {
      // Mọi tài khoản (kể cả Admin) đều phải qua bước duyệt phiếu khi nhập tồn kho ban đầu
      const status = TransactionStatus.PENDING;

      const pendingTx: Transaction = {
        id: `tx-init-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: TransactionType.IMPORT,
        date: new Date().toISOString(),
        items: [{ itemId: newItem.id, quantity: formData.initialStock, price: formData.priceIn }],
        targetWarehouseId: formData.initialWarehouseId,
        supplierId: formData.supplierId || undefined,
        requesterId: user.id,
        status: status,
        note: `Nhập kho khởi tạo cho vật tư mới: ${newItem.name}`
      };

        await addTransaction(pendingTx);
        logActivity('REQUEST', 'Đề xuất vật tư mới', `Tạo vật tư "${newItem.name}" và đề xuất nhập ${formData.initialStock} ${newItem.unit} vào kho.`, 'INFO');
        toast.success('Đã tạo vật tư', `Số lượng ${formData.initialStock} ${newItem.unit} đang chờ Admin phê duyệt để vào kho.`);
      } else {
        logActivity('INVENTORY', 'Thêm danh mục', `Đã thêm vật tư mới "${newItem.name}" vào hệ thống.`, 'SUCCESS');
        toast.success('Thêm vật tư thành công', `"${newItem.name}" đã được thêm vào danh mục.`);
      }

      onClose();
      setFormData({
        sku: '', name: '', category: '', unit: '', purchaseUnit: '', supplierId: '',
        priceIn: 0, priceOut: 0, minStock: 0, defaultLeadTimeDays: 7, location: '',
        initialWarehouseId: '', initialStock: 0
      });
      setSupplierSearch('');
    } catch (err: any) {
      logApiError('addInventory.save', err);
      toast.error('Không thể thêm vật tư', getApiErrorMessage(err, 'Không thể lưu vật tư hoặc phiếu nhập kho lên Supabase.'));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const hasAssignedWarehouse = !!user.assignedWarehouseId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
          <div>
            <h3 className="font-bold text-lg text-slate-800">Thêm vật tư mới</h3>
            {hasAssignedWarehouse && <p className="text-[10px] text-orange-600 font-bold uppercase tracking-tight">Bạn chỉ thêm vật tư vào kho được phân công</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Mã SKU <span className="text-red-500">*</span></label>
              <input
                type="text" name="sku" value={formData.sku} onChange={handleChange}
                placeholder="VD: STEEL-001"
                className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-accent outline-none font-mono"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Tên vật tư <span className="text-red-500">*</span></label>
              <input
                type="text" name="name" value={formData.name} onChange={handleChange}
                placeholder="VD: Thép cuộn phi 6"
                className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-accent outline-none"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Danh mục <span className="text-red-500">*</span></label>
              <select
                name="category" value={formData.category} onChange={handleChange}
                className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-accent outline-none bg-white"
                required
              >
                <option value="">-- Chọn danh mục --</option>
                {categories.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Đơn vị tính <span className="text-red-500">*</span></label>
              <select
                name="unit" value={formData.unit} onChange={handleChange}
                className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-accent outline-none bg-white"
                required
              >
                <option value="">-- Chọn đơn vị --</option>
                {units.map(unit => <option key={unit.id} value={unit.name}>{unit.name}</option>)}
              </select>
            </div>

            {/* Đơn vị mua hàng - Tính năng Dual Unit */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                Đơn vị mua hàng
                <span className="text-[10px] font-normal text-slate-400">(tùy chọn - chỉ điền nếu khác đơn vị tồn kho)</span>
              </label>
              <div className="flex gap-3 items-start">
                <select
                  name="purchaseUnit" value={formData.purchaseUnit} onChange={handleChange}
                  className="flex-1 p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white"
                >
                  <option value="">— Giống đơn vị tồn kho —</option>
                  {units.map(unit => <option key={unit.id} value={unit.name}>{unit.name}</option>)}
                </select>
                {formData.purchaseUnit && formData.purchaseUnit !== formData.unit && formData.unit && (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-black px-3 py-2.5 rounded-lg whitespace-nowrap">
                    Mua: <span className="text-amber-600">{formData.purchaseUnit}</span>
                    <span className="text-amber-400">→</span>
                    Kho: <span className="text-amber-600">{formData.unit}</span>
                  </div>
                )}
              </div>
              {formData.purchaseUnit && formData.purchaseUnit !== formData.unit && (
                <p className="text-[10px] text-amber-600 font-bold">
                  ℹ️ Vật tư này sẽ hỗ trợ nhập kho theo {formData.purchaseUnit}, xuất kho theo {formData.unit || '...'}
                </p>
              )}
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-slate-700 flex items-center">
                <Truck size={14} className="mr-2 text-slate-400" /> Nhà cung cấp mặc định
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={supplierSearch || selectedSupplierPartner?.name || ''}
                  onFocus={() => setSupplierOpen(true)}
                  onBlur={() => window.setTimeout(() => setSupplierOpen(false), 140)}
                  onChange={event => {
                    setSupplierSearch(event.target.value);
                    setFormData(prev => ({ ...prev, supplierId: '' }));
                    setSupplierOpen(true);
                  }}
                  placeholder="Gõ tên để tìm NCC từ HĐ đối tác..."
                  className="w-full p-2.5 pr-20 border border-slate-200 rounded-lg focus:ring-2 focus:ring-accent outline-none bg-white"
                />
                {(formData.supplierId || supplierSearch) && (
                  <button
                    type="button"
                    onMouseDown={event => event.preventDefault()}
                    onClick={clearSupplier}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md text-[10px] font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    Xoá
                  </button>
                )}
                {supplierOpen && (
                  <div className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                    {supplierLoading && (
                      <div className="px-3 py-3 text-xs font-bold text-slate-400 flex items-center gap-2">
                        <Loader2 size={13} className="animate-spin" /> Đang tải HĐ đối tác...
                      </div>
                    )}
                    {!supplierLoading && filteredSupplierPartners.map(partner => (
                      <button
                        key={partner.id}
                        type="button"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => pickSupplier(partner)}
                        className="w-full px-3 py-2 text-left text-xs hover:bg-blue-50 border-b border-slate-50 last:border-b-0"
                      >
                        <div className="font-bold text-slate-700 truncate">{partner.name}</div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {[partner.code, partner.taxCode, partner.phone, partner.contactName].filter(Boolean).join(' • ') || 'HĐ đối tác'}
                        </div>
                      </button>
                    ))}
                    {!supplierLoading && filteredSupplierPartners.length === 0 && (
                      <div className="px-3 py-3 text-xs font-bold text-amber-600">
                        Không tìm thấy NCC trong HĐ đối tác.
                      </div>
                    )}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-slate-400 font-medium">
                Danh sách lấy từ Hợp đồng → HĐ đối tác, chỉ các đối tác được phân loại “Nhà cung cấp”.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Giá nhập (VNĐ)</label>
              <input
                type="number" name="priceIn" value={formData.priceIn} onChange={handleChange} min="0"
                className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-accent outline-none font-bold text-slate-700"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Giá xuất (VNĐ)</label>
              <input
                type="number" name="priceOut" value={formData.priceOut} onChange={handleChange} min="0"
                className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-accent outline-none font-bold text-accent"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-slate-700">Mức tồn tối thiểu (Cảnh báo)</label>
              <input
                type="number" name="minStock" value={formData.minStock} onChange={handleChange} min="0"
                className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-accent outline-none"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-slate-700">Lead time mặc định cho kế hoạch vật tư (ngày)</label>
              <input
                type="number" name="defaultLeadTimeDays" value={formData.defaultLeadTimeDays} onChange={handleChange} min="0" max="365"
                className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-accent outline-none font-bold text-slate-700"
              />
              <p className="text-[10px] text-slate-400 font-medium">Dùng khi dự án chưa khai báo rule lead time riêng cho vật tư này.</p>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-slate-700 flex items-center">
                <MapPin size={14} className="mr-2 text-slate-400" /> Vị trí trong kho (Bin Location)
              </label>
              <input
                type="text" name="location" value={formData.location} onChange={handleChange}
                placeholder="VD: Kệ A-3, Ô 2"
                className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-accent outline-none"
              />
            </div>

            {/* Initial Stock Section */}
            <div className="md:col-span-2 border-t border-slate-100 pt-4 mt-2">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-slate-800 flex items-center">
                  Nhập tồn kho khởi tạo
                </h4>
                {hasAssignedWarehouse && (
                  <span className="text-[9px] bg-orange-50 text-orange-600 px-2 py-1 rounded-full border border-orange-100 flex items-center">
                    <ShieldAlert size={10} className="mr-1" /> Cần Admin phê duyệt
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Kho nhận hàng</label>
                  <select
                    name="initialWarehouseId"
                    value={formData.initialWarehouseId}
                    onChange={handleChange}
                    disabled={hasAssignedWarehouse}
                    className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-accent outline-none bg-white disabled:bg-white disabled:text-slate-700 font-bold"
                  >
                    {!hasAssignedWarehouse && <option value="">-- Chọn kho --</option>}
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Số lượng ban đầu</label>
                  <input
                    type="number"
                    name="initialStock"
                    value={formData.initialStock}
                    onChange={handleChange}
                    min="0"
                    className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-accent outline-none font-bold text-accent"
                    placeholder="0"
                  />
                </div>
              </div>
              {hasAssignedWarehouse && (
                <p className="text-[10px] text-slate-400 mt-2 italic">
                  * Bạn chỉ được phép thêm vật tư vào kho <strong>{warehouses.find(w => w.id === user.assignedWarehouseId)?.name}</strong>.
                </p>
              )}
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-slate-100 flex justify-end gap-3">
            <button
              type="button" onClick={onClose}
              disabled={saving}
              className="px-6 py-2.5 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-colors disabled:opacity-60"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 bg-accent text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center shadow-lg shadow-blue-500/30 disabled:opacity-60"
            >
              {saving ? <Loader2 size={18} className="mr-2 animate-spin" /> : <Save size={18} className="mr-2" />} {saving ? 'Đang lưu...' : 'Lưu & Gửi đề xuất'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddInventoryModal;
