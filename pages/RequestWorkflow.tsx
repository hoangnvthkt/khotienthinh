
import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { MaterialRequest, RequestStatus, Role } from '../types';
import { Plus, Search, FileText, ArrowRight, Truck, CheckCircle, Clock, AlertCircle, Inbox, Send as SendIcon, PackageSearch, ShieldAlert } from 'lucide-react';
import RequestModal from '../components/RequestModal';

const RequestWorkflow: React.FC = () => {
  const { requests, warehouses, user, users } = useApp();
  const [filterStatus, setFilterStatus] = useState<string>('ALL');


  const [searchTerm, setSearchTerm] = useState('');
  
  const [isModalOpen, setModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<MaterialRequest | undefined>(undefined);

  const filteredRequests = useMemo(() => {
     return requests.filter(req => {
        const isAdmin = user.role === Role.ADMIN;
        const isSiteKeeper = user.assignedWarehouseId && req.siteWarehouseId === user.assignedWarehouseId;
        const isSourceKeeper = user.assignedWarehouseId && req.sourceWarehouseId === user.assignedWarehouseId;

        if (!isAdmin && !isSiteKeeper && !isSourceKeeper) return false;

        const matchStatus = filterStatus === 'ALL' || req.status === filterStatus;
        const matchSearch = req.code.toLowerCase().includes(searchTerm.toLowerCase());
        return matchStatus && matchSearch;
     });
  }, [requests, filterStatus, searchTerm, user]);

  const handleOpenCreate = () => {
     setSelectedRequest(undefined);
     setModalOpen(true);
  };

  const handleOpenRequest = (req: MaterialRequest) => {
     setSelectedRequest(req);
     setModalOpen(true);
  };

  const getStatusBadge = (status: RequestStatus) => {
      switch (status) {
          case RequestStatus.PENDING: return <span className="bg-yellow-100 text-yellow-800 text-[10px] px-2 py-0.5 rounded font-bold flex items-center w-fit"><Clock size={10} className="mr-1"/> CHỜ DUYỆT</span>;
          case RequestStatus.APPROVED: return <span className="bg-blue-100 text-blue-800 text-[10px] px-2 py-0.5 rounded font-bold flex items-center w-fit"><AlertCircle size={10} className="mr-1"/> CHỜ XUẤT HÀNG</span>;
          case RequestStatus.IN_TRANSIT: return <span className="bg-purple-100 text-purple-800 text-[10px] px-2 py-0.5 rounded font-bold flex items-center w-fit"><Truck size={10} className="mr-1"/> ĐANG GIAO HÀNG</span>;
          case RequestStatus.COMPLETED: return <span className="bg-green-100 text-green-800 text-[10px] px-2 py-0.5 rounded font-bold flex items-center w-fit"><CheckCircle size={10} className="mr-1"/> ĐÃ NHẬN HÀNG</span>;
          case RequestStatus.REJECTED: return <span className="bg-red-100 text-red-800 text-[10px] px-2 py-0.5 rounded font-bold">BỊ TỪ CHỐI</span>;
          default: return <span className="bg-slate-100 text-slate-800 text-[10px] px-2 py-0.5 rounded font-bold">NHÁP</span>;
      }
  };

  return (
    <div className="space-y-6">
      <RequestModal isOpen={isModalOpen} onClose={() => setModalOpen(false)} request={selectedRequest} />

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
         <div>
            <h1 className="text-2xl font-bold text-slate-800">Điều phối vật tư</h1>
            <p className="text-sm text-slate-500">Quy trình Yêu cầu - Duyệt - Xuất - Nhận thông minh.</p>
         </div>
         {(
           <button onClick={handleOpenCreate} className="flex items-center px-4 py-2 bg-accent text-white rounded-lg hover:bg-blue-700 transition font-bold shadow-lg shadow-blue-500/20">
              <Plus size={18} className="mr-2" /> Tạo đề xuất mới
           </button>
         )}
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4">
         <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input 
              type="text" placeholder="Tìm kiếm theo mã phiếu..." 
              value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-accent"
            />
         </div>
         <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
            {[
               { id: 'ALL', label: 'Tất cả' },
               { id: 'PENDING', label: 'Chờ duyệt' },
               { id: 'APPROVED', label: 'Chờ xuất' },
               { id: 'IN_TRANSIT', label: 'Đang giao' },
               { id: 'COMPLETED', label: 'Đã nhận' }
            ].map(status => (
                <button
                   key={status.id} onClick={() => setFilterStatus(status.id)}
                   className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors
                      ${filterStatus === status.id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}
                   `}
                >
                   {status.label}
                </button>
            ))}
         </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
         {filteredRequests.map((req) => {
             const siteName = warehouses.find(w => w.id === req.siteWarehouseId)?.name || 'N/A';
             const sourceName = warehouses.find(w => w.id === req.sourceWarehouseId)?.name || 'Chưa gán';
             
             const isIncoming = user.assignedWarehouseId === req.siteWarehouseId;
             const isOutgoing = user.assignedWarehouseId === req.sourceWarehouseId;

             // Logic hiển thị nút hành động nhanh
             const needsExport = req.status === RequestStatus.APPROVED && (user.role === Role.ADMIN || isOutgoing);
             const needsReceive = req.status === RequestStatus.IN_TRANSIT && (user.role === Role.ADMIN || isIncoming);

             return (
                 <div key={req.id} onClick={() => handleOpenRequest(req)} className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 hover:border-accent/50 transition-all cursor-pointer group relative overflow-hidden">
                    {/* Visual indicators */}
                    {(needsExport || needsReceive) && <div className="absolute top-0 left-0 w-1 h-full bg-accent animate-pulse"></div>}
                    
                    <div className="flex flex-col md:flex-row justify-between gap-4">
                       <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                             <span className="font-mono text-[10px] font-bold bg-slate-100 px-2 py-1 rounded border border-slate-200 text-slate-600">{req.code}</span>
                             {getStatusBadge(req.status)}
                             
                             <span className="text-[10px] font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                                BY: {users.find(u => u.id === req.requesterId)?.name || 'N/A'}
                             </span>

                             {user.assignedWarehouseId && (
                                <>
                                   {isIncoming && <span className="flex items-center text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100"><Inbox size={10} className="mr-1"/> KHO NHẬN</span>}
                                   {isOutgoing && <span className="flex items-center text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-100"><SendIcon size={10} className="mr-1"/> KHO XUẤT</span>}
                                </>
                             )}
                          </div>
                          
                          <div className="flex items-center gap-6 mb-4">
                             <div className="flex-1">
                                <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Cung cấp bởi</p>
                                <div className="font-bold text-slate-700 flex items-center">
                                    <PackageSearch size={14} className="mr-2 text-slate-300" />
                                    {sourceName}
                                </div>
                             </div>
                             <ArrowRight size={20} className="text-slate-200" />
                             <div className="flex-1 text-right md:text-left">
                                <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Điều chuyển đến</p>
                                <div className="font-bold text-slate-800 flex items-center md:justify-start justify-end">
                                    <Truck size={14} className="mr-2 text-slate-300" />
                                    {siteName}
                                </div>
                             </div>
                          </div>

                          <div className="flex flex-wrap gap-2 opacity-60">
                             {req.items.length} loại vật tư trong phiếu • Cập nhật: {new Date(req.createdDate).toLocaleTimeString('vi-VN')}
                          </div>
                       </div>

                       <div className="flex flex-row md:flex-col justify-center items-end gap-3 border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6 min-w-[180px]">
                          {needsExport && (
                              <button className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 flex items-center justify-center transition-all shadow-md shadow-blue-500/20 whitespace-nowrap">
                                 <Truck size={14} className="mr-2" /> XUẤT KHO NGAY
                              </button>
                          )}
                          
                          {needsReceive && (
                              <button className="w-full px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 flex items-center justify-center transition-all shadow-md shadow-green-500/20 whitespace-nowrap">
                                 <CheckCircle size={14} className="mr-2" /> NHẬN HÀNG XONG
                              </button>
                          )}

                          {req.status === RequestStatus.PENDING && user.role === Role.ADMIN && (
                              <button className="w-full px-4 py-2 bg-yellow-500 text-white rounded-lg text-xs font-bold hover:bg-yellow-600 flex items-center justify-center transition-all shadow-md shadow-yellow-500/20 whitespace-nowrap">
                                 <AlertCircle size={14} className="mr-2" /> THẨM ĐỊNH PHIẾU
                              </button>
                          )}

                          <div className="text-[10px] text-slate-400 font-medium italic">Bấm để xem chi tiết phiếu</div>
                       </div>
                    </div>
                 </div>
             );
         })}
         {filteredRequests.length === 0 && (
             <div className="text-center py-24 bg-white rounded-2xl border border-dashed border-slate-200">
                <FileText className="w-16 h-16 text-slate-100 mx-auto mb-4" />
                <p className="text-slate-400 font-bold">Không tìm thấy phiếu yêu cầu phù hợp.</p>
             </div>
         )}
      </div>
    </div>
  );
};

export default RequestWorkflow;
