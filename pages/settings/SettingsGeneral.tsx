import React from 'react';
import { Save, Upload, Trash } from 'lucide-react';

interface SettingsGeneralProps {
  appName: string;
  setAppName: (v: string) => void;
  appLogo: string;
  setAppLogo: (v: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSaveGeneral: (e: React.FormEvent) => void;
}

const SettingsGeneral: React.FC<SettingsGeneralProps> = ({
  appName, setAppName, appLogo, setAppLogo,
  fileInputRef, handleLogoUpload, handleSaveGeneral
}) => (
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
);

export default SettingsGeneral;
