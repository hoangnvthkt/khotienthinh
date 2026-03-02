
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Shield, Lock, User as UserIcon, AlertCircle, Info } from 'lucide-react';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { users, setUser } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showForgotMsg, setShowForgotMsg] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const foundUser = users.find(u => u.username === username && u.password === password);

    if (foundUser) {
      setUser(foundUser);
      localStorage.setItem('khoviet_user', JSON.stringify(foundUser));
      navigate('/');
    } else {
      setError('Tên đăng nhập hoặc mật khẩu không chính xác.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
        <div className="p-8 bg-slate-900 text-white text-center relative">
          <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent rounded-full blur-3xl"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500 rounded-full blur-3xl"></div>
          </div>
          
          <div className="w-16 h-16 bg-accent rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20 relative z-10">
            <Shield className="text-white w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black tracking-tight relative z-10">KHOVIET</h1>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1 relative z-10">Hệ thống quản lý kho thông minh</p>
        </div>

        <div className="p-8">
          <form onSubmit={handleLogin} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-100 p-4 rounded-xl flex items-center gap-3 text-red-600 animate-in fade-in slide-in-from-top-2">
                <AlertCircle size={20} className="shrink-0" />
                <p className="text-xs font-bold">{error}</p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Tên đăng nhập</label>
              <div className="relative">
                <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input 
                  type="text" 
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-accent font-medium transition-all"
                  placeholder="Nhập tên đăng nhập..."
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Mật khẩu</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input 
                  type="password" 
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-accent font-medium transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input id="remember" type="checkbox" className="w-4 h-4 text-accent border-slate-300 rounded focus:ring-accent" />
                <label htmlFor="remember" className="ml-2 text-xs font-bold text-slate-500">Ghi nhớ đăng nhập</label>
              </div>
              <button 
                type="button"
                onClick={() => setShowForgotMsg(true)}
                className="text-xs font-bold text-accent hover:text-blue-700 transition-colors"
              >
                Quên mật khẩu?
              </button>
            </div>

            <button 
              type="submit"
              className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 active:scale-[0.98]"
            >
              Đăng nhập hệ thống
            </button>
          </form>

          {showForgotMsg && (
            <div className="mt-6 p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-3 text-blue-700 animate-in fade-in zoom-in-95">
              <Info size={20} className="shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-bold">Hỗ trợ khôi phục mật khẩu</p>
                <p className="text-[11px] font-medium opacity-80">Vui lòng liên hệ với Quản trị viên (Admin) của hệ thống để được cấp lại mật khẩu mới.</p>
                <button 
                  onClick={() => setShowForgotMsg(false)}
                  className="text-[10px] font-black uppercase tracking-widest mt-2 hover:underline"
                >
                  Đã hiểu
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 text-center">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">© 2024 KhoViet Smart Inventory System</p>
        </div>
      </div>
    </div>
  );
};

export default Login;
