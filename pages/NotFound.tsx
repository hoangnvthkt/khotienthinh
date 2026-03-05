
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, Search } from 'lucide-react';

const NotFound: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-[70vh] flex flex-col items-center justify-center text-center p-8">
            <div className="relative mb-8">
                <div className="text-[120px] font-black text-slate-100 leading-none select-none">404</div>
                <div className="absolute inset-0 flex items-center justify-center">
                    <Search size={64} className="text-slate-300 opacity-60" />
                </div>
            </div>
            <h1 className="text-2xl font-black text-slate-800 mb-2 tracking-tight">Trang không tìm thấy</h1>
            <p className="text-slate-400 text-sm font-medium mb-8 max-w-sm">
                Trang bạn đang tìm kiếm không tồn tại hoặc đã bị di chuyển sang địa chỉ khác.
            </p>
            <button
                onClick={() => navigate('/')}
                className="flex items-center gap-2 px-8 py-3 bg-accent text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 active:scale-95"
            >
                <Home size={16} />
                Về Trang Chủ
            </button>
        </div>
    );
};

export default NotFound;
