import React from 'react';
import { Save, Upload, Trash } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

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
}) => {
  const { uiMode, setUiMode } = useTheme();

  return (
    <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
      <div className="p-6 border-b border-border bg-muted/30">
        <h2 className="text-lg font-bold text-foreground">Thông tin ứng dụng</h2>
        <p className="text-xs text-muted-foreground font-medium">Cấu hình nhận diện thương hiệu công ty.</p>
      </div>
      <form onSubmit={handleSaveGeneral} className="p-6 space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center">Tên doanh nghiệp</label>
              <input
                type="text" value={appName} onChange={(e) => setAppName(e.target.value)}
                className="w-full p-3 bg-muted/50 border border-border rounded-xl focus:ring-2 focus:ring-accent outline-none font-bold text-foreground"
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest block">Chế độ hiển thị (UI Mode)</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setUiMode('modern')}
                  className={`p-4 border rounded-xl text-left transition-all ${
                    uiMode === 'modern'
                      ? 'border-accent bg-accent/5 ring-2 ring-accent text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  <div className="font-bold text-sm text-foreground">Modern Mode</div>
                  <div className="text-[11px] mt-1 leading-relaxed">Giao diện hiện đại, bo tròn mềm mại, gradient & shadow.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setUiMode('enterprise')}
                  className={`p-4 border rounded-xl text-left transition-all ${
                    uiMode === 'enterprise'
                      ? 'border-accent bg-accent/5 ring-2 ring-accent text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  <div className="font-bold text-sm text-foreground">Enterprise Mode</div>
                  <div className="text-[11px] mt-1 leading-relaxed">Giao diện phẳng, sạch sẽ, border mảnh, mật độ cao (Light theme).</div>
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Logo công ty</label>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => fileInputRef.current?.click()} className="flex-1 px-4 py-3 bg-card border border-border rounded-xl font-bold text-foreground hover:bg-muted transition flex items-center justify-center gap-2">
                  <Upload size={18} /> Tải logo mới
                </button>
                <input type="file" ref={fileInputRef} onChange={handleLogoUpload} accept="image/*" className="hidden" />
                {appLogo && (
                  <button type="button" onClick={() => setAppLogo('')} className="p-3 bg-destructive/10 text-destructive rounded-xl border border-destructive/20 hover:bg-destructive hover:text-destructive-foreground transition shadow-sm"><Trash size={18} /></button>
                )}
              </div>
            </div>
          </div>
          <div className="space-y-4 bg-muted/20 p-6 rounded-2xl border border-dashed border-border">
            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest text-center block">Xem trước thương hiệu</label>
            <div className="bg-primary p-6 rounded-xl flex items-center gap-4 shadow-xl">
              {appLogo ? <img src={appLogo} alt="" className="w-10 h-10 object-contain rounded" /> : <div className="w-10 h-10 bg-accent rounded flex items-center justify-center font-bold text-white">KV</div>}
              <span className="text-white text-xl font-black">{appName}</span>
            </div>
          </div>
        </div>
        <div className="pt-4 border-t border-border flex justify-end">
          <button type="submit" className="px-8 py-3 bg-accent text-white rounded-xl font-bold hover:bg-blue-700 transition shadow-lg shadow-blue-500/20 flex items-center"><Save size={18} className="mr-2" /> Lưu cấu hình</button>
        </div>
      </form>
    </div>
  );
};

export default SettingsGeneral;
