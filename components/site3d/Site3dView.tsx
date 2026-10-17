import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Smartphone, Upload, X } from 'lucide-react';
import { StateBox, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import type { Site3dAccess, Site3dProject, Site3dResult } from '../../lib/site3d/site3dData';
import { SITE_MODEL_LABEL, type Site3dHooks, type SiteModelKind, type SiteModels } from '../../lib/site3d/site3dService';
import { createSiteScene } from './siteScene';
import logoUrl from './tien-thinh-logo.jpg';
import './site3d.css';

// Công trường 3D (tab của Trung tâm điều hành). Người xem: Ban lãnh đạo / người Admin cấp quyền xem — mở để trình chiếu tiến độ
// công trường trong họp: chọn công trường → xem mô hình theo ngày → Trình chiếu. Bố cục mỗi công trường dựng sẵn trong siteScene;
// số liệu (hạng mục, %, nhật ký, máy, tồn kho) đọc sống từ Vioo. Mô hình thiết kế XinHai tải từ kho riêng tư.

export interface SiteLayout { code: string; key: 'SMB' | 'DA29'; label: string; title: string; sign: string; models: boolean }
// Công trường đã dựng cấu hình 3D (mã dự án trong Vioo). Thêm công trường mới = thêm bố cục trong siteScene + một dòng ở đây.
export const SITE_LAYOUTS: SiteLayout[] = [
  { code: 'DA29', key: 'DA29', label: 'XinHai', title: 'Công trường XinHai (Thú nhồi bông GĐ2)', sign: 'Nhà máy XinHai Vina · giai đoạn 2', models: true },
  { code: 'SMB-2026', key: 'SMB', label: 'Sơn Miền Bắc', title: 'Công trường Sơn Miền Bắc', sign: 'Nhà máy Sơn Miền Bắc', models: false },
];

const SITE_KEY = 's3d_site';
const MOTION_KEY = 's3d_motion';
const PHONE_OK_KEY = 's3d_phone_ok';
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* chỉ là tiện ích */ } };
const isPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 640px)').matches;
const lowEnd = () => {
  if (typeof window === 'undefined') return false;
  const coarse = !!window.matchMedia?.('(pointer: coarse)').matches;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return isPhone() || (coarse && Math.min(window.screen?.width || 0, window.screen?.height || 0) < 820) || (typeof memory === 'number' && memory < 4);
};
const mb = (bytes: number | null) => (bytes == null ? '—' : `${(bytes / 1048576).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`);
const viDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

type SiteState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; result: Site3dResult };

const Site3dView: React.FC<{
  hooks: Site3dHooks;
  access: Extract<Site3dAccess, { access: true }>;
  /** Tab đang hiện (ẩn tab / chuyển vùng trên điện thoại thì dừng vẽ). */
  active: boolean;
  /** Mã người dùng: công trường đang chọn lưu riêng từng tài khoản. */
  storageOwner?: string;
  /** Bản thử nghiệm: gắn window.__site3d để kiểm. */
  exposeDebug?: boolean;
}> = ({ hooks, access, active, storageOwner, exposeDebug = false }) => {
  const sites = useMemo(() => SITE_LAYOUTS
    .map(layout => ({ layout, project: access.projects.find(project => project.code === layout.code) }))
    .filter((row): row is { layout: SiteLayout; project: Site3dProject } => !!row.project), [access.projects]);
  const siteKey = storageOwner ? `${SITE_KEY}:${storageOwner}` : SITE_KEY;
  const [code, setCode] = useState<string | null>(() => {
    const saved = read(siteKey);
    return sites.find(row => row.layout.code === saved)?.layout.code ?? sites[0]?.layout.code ?? null;
  });
  useEffect(() => { if (code && !sites.some(row => row.layout.code === code)) setCode(sites[0]?.layout.code ?? null); }, [code, sites]);
  const [phoneOk, setPhoneOk] = useState(() => !isPhone() || read(PHONE_OK_KEY) === '1');
  const [state, setState] = useState<SiteState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [modelsVersion, setModelsVersion] = useState(0);
  const site = sites.find(row => row.layout.code === code) || null;

  useEffect(() => {
    if (!site || !phoneOk) return undefined;
    let alive = true;
    setState({ status: 'loading' });
    hooks.loadSite(site.layout.code)
      .then(result => { if (alive) setState({ status: 'ready', result }); })
      .catch(error => { if (alive) setState({ status: 'error', message: error instanceof Error ? error.message : 'Không tải được số liệu công trường.' }); });
    return () => { alive = false; };
  }, [hooks, site, phoneOk, attempt]);

  const frameRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReturnType<typeof createSiteScene> | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const switchSite = useCallback((next: string) => { setCode(next); write(siteKey, next); }, [siteKey]);
  const ready = state.status === 'ready' && state.result.access && 'data' in state.result ? state.result : null;

  useEffect(() => {
    if (!ready || !site || !frameRef.current || !hostRef.current) return undefined;
    const project = ready.project;
    const withModels = site.layout.models && !!hooks.listModels && !!hooks.fetchModel;
    let listing: Promise<SiteModels> | null = null;
    const loadModel = withModels ? async (kind: SiteModelKind, onProgress: (fraction: number) => void) => {
      listing = listing || hooks.listModels!(project.id);
      const file = (await listing)[kind];
      return file ? hooks.fetchModel!(file, onProgress) : null;
    } : undefined;
    const scene = createSiteScene({
      frame: frameRef.current, host: hostRef.current, site: site.layout.key, data: ready.data,
      title: site.layout.title, code: project.code, signLine: site.layout.sign,
      sites: sites.map(row => ({ code: row.layout.code, label: row.layout.label })), onSwitchSite: switchSite,
      logoUrl, loadModel, autoLoadModels: !lowEnd(), canManage: ready.canManage && !!hooks.uploadModel,
      onManageModels: () => setModelsOpen(true), quality: lowEnd() ? 'low' : 'high',
      motion: read(MOTION_KEY) === '1', onMotionChange: (on: boolean) => write(MOTION_KEY, on ? '1' : '0'),
    });
    sceneRef.current = scene;
    scene.setActive(activeRef.current);
    if (exposeDebug) (window as unknown as { __site3d?: unknown }).__site3d = scene.debug;
    return () => { scene.dispose(); if (sceneRef.current === scene) sceneRef.current = null; };
  }, [ready, site, sites, hooks, switchSite, exposeDebug, modelsVersion]);
  useEffect(() => { sceneRef.current?.setActive(active); }, [active]);

  if (!sites.length) {
    return <div className="mx-auto max-w-xl p-6"><StateBox kind="empty" title="Chưa có công trường nào dựng 3D"
      message={`Đang dựng sẵn ${SITE_LAYOUTS.map(row => `${row.label} (${row.code})`).join(', ')}; chưa thấy dự án đang hoạt động nào khớp mã.`} /></div>;
  }
  if (!phoneOk) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center">
          <Smartphone size={26} className="mx-auto text-teal-600" />
          <p className="mt-3 font-semibold text-foreground">Công trường 3D xem tốt nhất trên máy tính</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Mô hình dùng nhiều bộ nhớ. Trên điện thoại sẽ chạy bản nhẹ, mô hình thiết kế chỉ tải khi bạn bấm.</p>
          <button type="button" className={`${primaryBtn} mt-4 w-full`} onClick={() => { write(PHONE_OK_KEY, '1'); setPhoneOk(true); }}>Vẫn mở trên điện thoại</button>
        </div>
      </div>
    );
  }
  const result = state.status === 'ready' ? state.result : null;
  return (
    <div className="s3d-frame" ref={frameRef} data-testid="site3d">
      <div ref={hostRef} />
      {state.status === 'loading' && <div className="s3d-overlay"><div><StateBox kind="loading" title={`Đang dựng ${site?.layout.title || 'công trường'}…`} /></div></div>}
      {state.status === 'error' && <div className="s3d-overlay"><div><StateBox kind="error" title="Chưa tải được số liệu công trường" message={state.message} onRetry={() => setAttempt(value => value + 1)} /></div></div>}
      {result && !result.access && <div className="s3d-overlay"><div><StateBox kind="denied" title="Bạn chưa có quyền xem công trường 3D" message="Nhờ Admin cấp quyền “Xem công trường 3D” ở màn Phân quyền." /></div></div>}
      {result && result.access && !result.project && <div className="s3d-overlay"><div><StateBox kind="empty" title="Không tìm thấy dự án" message={`Dự án ${code} không còn trong Vioo hoặc đã đổi mã.`} /></div></div>}
      {modelsOpen && ready?.project && hooks.listModels && hooks.uploadModel && (
        <ModelsDialog projectId={ready.project.id} projectName={ready.project.name} hooks={hooks}
          onClose={changed => { setModelsOpen(false); if (changed) setModelsVersion(value => value + 1); }} />
      )}
    </div>
  );
};

// Admin: tải lên / thay mô hình của công trường. Ghi đè đúng đường dẫn; người xem mở lại tab là thấy bản mới.
const ModelsDialog: React.FC<{ projectId: string; projectName: string; hooks: Site3dHooks; onClose: (changed: boolean) => void }> = ({ projectId, projectName, hooks, onClose }) => {
  const [models, setModels] = useState<SiteModels | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<SiteModelKind | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const refresh = useCallback(() => {
    setError(null);
    hooks.listModels!(projectId).then(setModels).catch(cause => setError(cause instanceof Error ? cause.message : 'Không đọc được danh sách mô hình.'));
  }, [hooks, projectId]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(changed); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, changed, onClose]);
  const upload = async (kind: SiteModelKind, file: File | undefined) => {
    if (!file) return;
    setBusy(kind); setError(null); setDone(null);
    try {
      await hooks.uploadModel!(projectId, kind, file);
      setDone(`Đã tải lên ${SITE_MODEL_LABEL[kind].toLowerCase()} (${mb(file.size)}).`); setChanged(true); refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tải lên được mô hình.'); }
    finally { setBusy(null); }
  };
  return (
    <div className="s3d-dialog" role="dialog" aria-modal="true" aria-label="Mô hình công trường">
      <div className="s3d-dialog-card">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-teal-700 text-white"><Box size={18} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">Mô hình công trường</h2>
            <p className="text-sm text-muted-foreground">{projectName}</p>
          </div>
          <button type="button" className="rounded-lg p-1.5 hover:bg-muted" onClick={() => onClose(changed)} disabled={!!busy} aria-label="Đóng"><X size={16} /></button>
        </div>
        <div className="mt-4 grid gap-3">
          {(['architecture', 'structure'] as SiteModelKind[]).map(kind => {
            const file = models?.[kind];
            return (
              <div key={kind} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{SITE_MODEL_LABEL[kind]}</p>
                    <p className="text-xs text-muted-foreground">{models === null ? 'Đang kiểm…' : file ? `${mb(file.size)} · cập nhật ${viDateTime(file.updatedAt)}` : 'Chưa có'}</p>
                  </div>
                  <label className={`${file ? secondaryBtn : primaryBtn} cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                    <Upload size={14} /> {busy === kind ? 'Đang tải lên…' : file ? 'Thay tệp' : 'Tải lên'}
                    <input type="file" accept=".glb,model/gltf-binary" className="sr-only" disabled={!!busy}
                      onChange={event => { const picked = event.target.files?.[0]; event.target.value = ''; void upload(kind, picked); }} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        {error && <p role="alert" className="mt-3 text-sm font-medium text-rose-700">{error}</p>}
        {done && <p className="mt-3 text-sm font-medium text-leaf-700">{done}</p>}
        <p className="mt-3 text-xs text-muted-foreground">Tệp .glb tối đa 60 MB, xuất bằng bộ chuyển đổi trong scripts/site3d. Chỉ người được cấp quyền “Xem công trường 3D” tải về xem.</p>
        <div className="mt-4 flex justify-end"><button type="button" className={secondaryBtn} onClick={() => onClose(changed)} disabled={!!busy}>Xong</button></div>
      </div>
    </div>
  );
};

export default Site3dView;
