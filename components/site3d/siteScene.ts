// @ts-nocheck
// Công trường 3D (Trung tâm điều hành): dựng công trường theo tiến độ thật của Vioo. Chuyển từ mockup đã duyệt
// docs/command-center/mockups/site-3d.html (doc 08 mục 13–16). Cảnh tự quản DOM của mình trong `host`; React chỉ lo tải số liệu, quyền, trạng thái.
// - Vẽ theo yêu cầu: không có gì đổi thì không vẽ (0 requestAnimationFrame khi đứng yên). "Chuyển động" (người đi lại, máy làm, xe chạy) là tuỳ chọn.
// - Trình chiếu: toàn màn hình, ẩn bảng, tự tham quan các góc nhìn, bật chuyển động. Esc để thoát.
// - Mô hình thiết kế (SketchUp → GLB) và kết cấu thép (Tekla → GLB) của XinHai tải từ kho riêng tư qua `loadModel`.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const TEMPLATE = `
<div class="s3d-stage" data-s3d="stage"></div>
<aside class="s3d-card s3d-left" data-s3d="left" aria-label="Tiến độ theo hạng mục">
  <div class="s3d-sites" data-s3d="sites"></div>
  <h1 data-s3d="title"></h1>
  <p class="s3d-sub" data-s3d="sub"></p>
  <div class="s3d-total"><b data-s3d="totalPct">—</b><span data-s3d="totalNote"></span></div>
  <div class="s3d-bar" data-s3d="totalBar"><i class="plan"></i><i class="act"></i></div>
  <div class="s3d-tree" data-s3d="tree"></div>
  <div class="s3d-legend">
    <span><i style="background:#1f8a70"></i>Thực tế · <i style="background:#cbd5e1"></i>Kế hoạch tới ngày đang xem</span>
    <span><i style="background:#c8834a"></i>Ván khuôn · <i style="background:#c2410c"></i>Cốt thép · <i style="background:#b9b6b0"></i>Bê tông xong</span>
    <span><i style="background:#9ca3af"></i>Giàn giáo, cây chống · <i style="background:#e8e4da"></i>Tường ALC · <i style="background:#b5523b"></i>Tường gạch</span>
    <span><i style="background:rgba(120,170,255,.35);border:1px dashed #6b8fd6"></i>Hình hoàn thành (bóng mờ)</span>
  </div>
</aside>
<div class="s3d-card s3d-views" data-s3d="views" role="toolbar" aria-label="Góc nhìn">
  <span data-s3d="viewBtns" style="display:contents"></span>
  <button type="button" data-s3d="btnGhost" aria-pressed="true">Hình hoàn thành</button>
  <button type="button" data-s3d="btnMotion" aria-pressed="false" title="Công nhân đi lại, máy làm việc, xe ra vào công trường">Chuyển động</button>
  <button type="button" data-s3d="btnHq" aria-pressed="false" hidden title="Bầu trời, ánh sáng và bóng đổ như ảnh phối cảnh (cần máy có card đồ hoạ)">Chất lượng cao</button>
  <button type="button" data-s3d="btnModels" hidden title="Tải lên / thay mô hình thiết kế và kết cấu thép">Mô hình</button>
  <span class="s3d-pill" data-s3d="realStatus"></span>
</div>
<div class="s3d-tools">
  <button type="button" data-s3d="btnInfo" aria-pressed="false" title="Ẩn bảng hạng mục và bảng thông tin, chỉ để mô hình">Ẩn thông tin</button>
  <button type="button" data-s3d="btnFinish" aria-pressed="false" title="Xem công trình khi đã hoàn thiện (theo thiết kế)">Xem hoàn thiện</button>
  <button type="button" class="s3d-primary" data-s3d="btnPresent" title="Toàn màn hình, tự tham quan công trường (Esc để thoát)">Trình chiếu</button>
</div>
<aside class="s3d-card s3d-right" data-s3d="info" aria-live="polite"></aside>
<div class="s3d-card s3d-timeline">
  <button type="button" data-s3d="btnPlay">▶ Phát</button>
  <div class="s3d-date" data-s3d="dateText">—</div>
  <div class="s3d-track"><div class="s3d-range" data-s3d="slider" role="slider" tabindex="0" aria-label="Ngày đang xem" aria-valuemin="0"><i class="s3d-range-fill"></i><i class="s3d-range-thumb"></i></div><div class="s3d-ticks" data-s3d="ticks"></div></div>
  <button type="button" data-s3d="btnToday">Hôm nay</button>
</div>
<div class="s3d-card s3d-hud" data-s3d="hud">
  <div class="s3d-hud-top"><img data-s3d="hudLogo" alt="" hidden><div><h1 data-s3d="hudTitle"></h1><div class="s3d-sub" style="margin:0" data-s3d="hudDate"></div></div></div>
  <div class="s3d-total"><b data-s3d="hudPct">—</b><span data-s3d="hudNote"></span></div>
  <div class="s3d-bar" data-s3d="hudBar"><i class="plan"></i><i class="act"></i></div>
</div>
<div class="s3d-present" data-s3d="presentBar">
  <button type="button" data-s3d="btnTour" aria-pressed="true">⏸ Tham quan</button>
  <button type="button" data-s3d="btnPlay2">▶ Phát tiến độ</button>
  <button type="button" data-s3d="btnFinish2" aria-pressed="false">Xem hoàn thiện</button>
  <button type="button" data-s3d="btnInfo2" aria-pressed="false">Hiện thông tin</button>
  <button type="button" class="s3d-primary" data-s3d="btnExit">Thoát trình chiếu</button>
</div>
<div class="s3d-toast" data-s3d="toast"></div>`;

export function createSiteScene(opts) {
  const { frame, host, site: SITE_KEY, data: DATA, title, code, signLine = '', sites = [], onSwitchSite, logoUrl, loadModel, autoLoadModels = true,
    canManage = false, onManageModels, quality = 'high', motion: motionInit = false, onMotionChange } = opts;
  const disposers = [];
  const listen = (target, type, fn, o) => { target.addEventListener(type, fn, o); disposers.push(() => target.removeEventListener(type, fn, o)); };
  let disposed = false;
  host.classList.add('s3d');
  host.innerHTML = TEMPLATE;
  const $ = id => host.querySelector(`[data-s3d="${id}"]`);
  const stage = $('stage');
  let W = Math.max(1, stage.clientWidth), H = Math.max(1, stage.clientHeight);

  /* ───────── Số liệu: đầu việc, % theo ngày, nhật ký, tồn kho công trường (vcc_site3d_v1) ───────── */
  const D0 = DATA.startMs, TODAY = Math.max(1, DATA.today);
  const TASK = {};
  for (const [wbs, parent, name, progress, ps, pe, as, ae, qty, unit] of DATA.tasks) TASK[wbs] = { wbs, parent, name, progress, ps, pe, as, ae, qty, unit, kids: [] };
  for (const t of Object.values(TASK)) if (t.parent && TASK[t.parent]) TASK[t.parent].kids.push(t);
  const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const dateOf = d => new Date(D0 + d * 86400000);
  const pad = n => String(n).padStart(2, '0');
  const dd = d => (d == null || !Number.isFinite(d) ? '—' : `${pad(dateOf(d).getUTCDate())}/${pad(dateOf(d).getUTCMonth() + 1)}`);
  const ddy = d => `${dd(d)}/${dateOf(d).getUTCFullYear()}`;
  const wd = d => WD[dateOf(d).getUTCDay()];
  // % thực tế của một đầu việc tại ngày d: chuỗi % theo ngày + nội suy theo ngày bắt đầu/kết thúc thực tế cho giai đoạn trước.
  let memoDay = -1; const memo = new Map();
  // Xem hoàn thiện: bộ dựng hình coi mọi đầu việc 100%; bảng số liệu vẫn đọc % thật (pReal).
  let FINISHED = false;
  const pAt = (wbs, d) => (FINISHED ? 100 : pReal(wbs, d));
  function pReal(wbs, d) {
    if (d !== memoDay) { memo.clear(); memoDay = d; }
    if (memo.has(wbs)) return memo.get(wbs);
    const t = TASK[wbs]; let v = 0;
    if (t) {
      const s = DATA.series[wbs];
      let fa = t.as, fb = t.ae; if (fa != null && fb != null && fb < fa) [fa, fb] = [fb, fa];
      if (d >= TODAY) v = t.progress;
      // Đầu việc đã xong có ngày thực tế: dựng theo ngày làm thật (% theo ngày thường được nhập muộn hơn).
      else if (t.progress >= 100 && fa != null && fb != null) v = d <= fa ? 0 : d >= fb ? 100 : 100 * (d - fa + 1) / (fb - fa + 1);
      else if (s && d >= s[0][0]) { v = s[0][1]; for (const [k2, p] of s) { if (k2 <= d) v = p; else break; } }
      else {
        const target = s ? s[0][1] : t.progress, endDay = s ? s[0][0] : TODAY;
        if (target > 0) {
          let a = t.as, b = t.ae; if (a != null && b != null && b < a) [a, b] = [b, a];
          if (a == null) { a = t.ps ?? endDay - 14; b = Math.min(t.pe ?? endDay, endDay); }
          if (b == null || target < 100) b = endDay;
          if (b <= a) b = a + 1;
          v = d <= a ? 0 : d >= b ? target : target * (d - a) / (b - a);
        }
      }
    }
    memo.set(wbs, v); return v;
  }
  const planAt = (t, d) => (t.ps == null || t.pe == null ? 0 : d <= t.ps ? 0 : d >= t.pe ? 100 : 100 * (d - t.ps) / Math.max(1, t.pe - t.ps));
  const leaves = t => (t.kids.length ? t.kids.flatMap(leaves) : [t]);
  const avg = (list, f) => (list.length ? list.reduce((s, x) => s + f(x), 0) / list.length : 0);
  const groupAt = (t, d) => avg(leaves(t), x => pReal(x.wbs, d));
  const groupPlan = (t, d) => avg(leaves(t), x => planAt(x, d));
  const taskName = w => TASK[w]?.name || '';

  /* ───────── Khung cảnh, vẽ theo yêu cầu ───────── */
  const HIGH = quality !== 'low';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dbe7f1'); scene.fog = new THREE.Fog('#dbe7f1', 420, 900);
  const camera = new THREE.PerspectiveCamera(38, W / H, 0.5, 1500);
  const renderer = new THREE.WebGLRenderer({ antialias: HIGH, powerPreference: HIGH ? 'high-performance' : 'default' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, HIGH ? 1.5 : 1)); renderer.setSize(W, H);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer(); labels.setSize(W, H);
  Object.assign(labels.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' }); stage.appendChild(labels.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 6; controls.maxDistance = 520; controls.autoRotateSpeed = 0.35;
  const hemi = new THREE.HemisphereLight('#ffffff', '#a9b7a0', 1.0); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e0', 1.7); sun.position.set(-90, 160, 110); sun.castShadow = true;
  sun.shadow.mapSize.set(HIGH ? 4096 : 2048, HIGH ? 4096 : 2048); Object.assign(sun.shadow.camera, { left: -170, right: 170, top: 170, bottom: -170, near: 10, far: 520 }); sun.shadow.bias = -0.0004; scene.add(sun); scene.add(sun.target); sun.target.position.set(0, 0, -50);

  let raf = 0, inTick = false, active = false, motion = false, lastTs = 0, extraFrames = 0, frames = 0, frameNo = 0, t = 0;
  // Chất lượng cao (máy tính): bầu trời + mặt trời, ánh sáng môi trường từ trời, tone mapping điện ảnh, GTAO (bóng ở góc khuất), khử răng cưa MSAA.
  let hq = false, composer = null, roomEnv = null, slowMs = 0;
  // Có việc đổi (bấm, xoay, đổi ngày): vẽ thêm vài khung rồi dừng. Đang chuyển động / bay camera / phát tiến độ thì vẽ liên tục.
  function invalidate(n = 2) { extraFrames = Math.max(extraFrames, n); if (!raf && !inTick && active && !disposed) raf = requestAnimationFrame(tick); }

  /* Kết cấu vẽ bằng canvas (không tải ảnh ngoài). */
  const TEXTURES = [];
  function canvasTex(w, h, draw, rx = 1, ry = 1) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(rx, ry); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; TEXTURES.push(tx); return tx; }
  const speckle = (base, dots, n = 2500, sz = 2) => (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i += 1) { g.fillStyle = dots[i % dots.length]; g.fillRect(Math.random() * w, Math.random() * h, sz * Math.random() + 0.5, sz * Math.random() + 0.5); } };
  const TX = {
    grass: canvasTex(256, 256, speckle('#7fae5b', ['#6f9e4d', '#8fbd68', '#76a553', '#9cc574']), 120, 120),
    // Cỏ chất lượng cao: mảng đậm nhạt lớn + hạt nhỏ, ô 50 m để không thấy lặp.
    grassHq: HIGH ? canvasTex(1024, 1024, (g, w, h) => { g.fillStyle = '#86b25f'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 160; i += 1) { const r = 40 + Math.random() * 140, x = Math.random() * w, y = Math.random() * h; const gr = g.createRadialGradient(x, y, 0, x, y, r); const c = ['#6f9e4a', '#92bd66', '#7aa851', '#9cc272'][i % 4]; gr.addColorStop(0, c + 'aa'); gr.addColorStop(1, c + '00'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
      for (let i = 0; i < 26000; i += 1) { g.fillStyle = ['#6a9947', '#a3cc78', '#77a650', '#5f8c40', '#b4d48a'][i % 5]; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2.5); } }, 48, 48) : null,
    dirt: canvasTex(256, 256, speckle('#b79a72', ['#a88a63', '#c4a983', '#9c7f5a', '#cdb48f'], 4000)),
    sand: canvasTex(256, 256, speckle('#d9c69c', ['#cdb98d', '#e4d3ad', '#c9b384'], 3000)),
    gravel: canvasTex(256, 256, speckle('#9a9a96', ['#7f7f7b', '#b3b3ae', '#8c8a84', '#c2c0ba', '#6e6d69'], 6000, 3)),
    asphalt: canvasTex(256, 256, speckle('#4a4e54', ['#3f4348', '#575b61', '#52565c'], 3000)),
    concrete: canvasTex(256, 256, speckle('#bdbab3', ['#b2afa8', '#c7c4bd', '#aeaba3'], 2500)),
    plywood: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#c8834a'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 3) { g.strokeStyle = `rgba(120,60,20,${0.08 + Math.random() * 0.12})`; g.beginPath(); g.moveTo(0, y + Math.random() * 2); g.bezierCurveTo(w / 3, y + Math.random() * 4, 2 * w / 3, y - Math.random() * 4, w, y); g.stroke(); } g.strokeStyle = 'rgba(80,40,10,.5)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h); }),
    brick: canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#d8cfc2'; g.fillRect(0, 0, w, h); const bw = 32, bh = 12; for (let r = 0; r * bh < h; r += 1) for (let c = -1; c * bw < w; c += 1) { const x = c * bw + (r % 2 ? bw / 2 : 0); g.fillStyle = ['#b5523b', '#a84a35', '#c05d44', '#9e4431'][(r * 7 + c * 3 + 40) % 4]; g.fillRect(x + 1, r * bh + 1, bw - 2, bh - 2); } }),
    alc: canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#c9c4b8'; g.fillRect(0, 0, w, h); const bw = 120, bh = 40; for (let r = 0; r * bh < h; r += 1) for (let c = -1; c * bw < w; c += 1) { const x = c * bw + (r % 2 ? bw / 2 : 0); g.fillStyle = ['#ebe7dd', '#e6e2d7', '#efebe2'][(r + c + 3) % 3]; g.fillRect(x + 1.5, r * bh + 1.5, bw - 3, bh - 3); } }),
    roof: canvasTex(128, 128, (g, w, h) => { for (let x = 0; x < w; x += 1) { const k2 = 0.5 + 0.5 * Math.cos((x / 16) * Math.PI * 2); const c = Math.round(215 + 30 * k2); g.fillStyle = `rgb(${c},${c + 2},${c + 5})`; g.fillRect(x, 0, 1, h); } }),
    panel: canvasTex(128, 128, (g, w, h) => { for (let x = 0; x < w; x += 1) { const k2 = (x % 32) < 4 ? 0.6 : 1; const c = Math.round(228 * k2); g.fillStyle = `rgb(${c},${c + 2},${c + 4})`; g.fillRect(x, 0, 1, h); } }),
    mesh: canvasTex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#b8461a'; g.lineWidth = 3; for (let i = 0; i <= w; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } }),
    nylon: canvasTex(128, 128, speckle('#2b2d31', ['#3a3d42', '#24262a', '#45484e'], 600, 6)),
    water: canvasTex(256, 256, speckle('#6f9a8f', ['#79a598', '#668e83', '#82ad9f'], 1500, 6), 30, 30),
    track: canvasTex(64, 32, (g, w, h) => { g.fillStyle = '#2a2a2a'; g.fillRect(0, 0, w, h); g.fillStyle = '#4a4a4a'; for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 5, h); }),
    bag: canvasTex(128, 64, (g, w, h) => { g.fillStyle = '#d6d3cb'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d4290'; g.font = 'bold 22px Arial'; g.fillText('PCB30', 26, 40); g.strokeStyle = '#b8b4aa'; g.strokeRect(2, 2, w - 4, h - 4); }),
    drum: canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#1d4ed8'; g.fillRect(0, 0, w, h); g.fillStyle = '#163da8'; g.fillRect(0, 18, w, 4); g.fillRect(0, 42, w, 4); }),
    mixer: canvasTex(128, 64, (g, w, h) => { g.fillStyle = '#f1f2f3'; g.fillRect(0, 0, w, h); g.strokeStyle = '#e04a1a'; g.lineWidth = 10; for (let x = -64; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 40, h); g.stroke(); } }),
  };
  const rep = (tx, rx, ry) => { const c = tx.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; TEXTURES.push(c); return c; };
  const MATS = [];
  const mat = (color, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra }); MATS.push(m); return m; };
  const M = {
    concrete: mat('#ffffff', { map: rep(TX.concrete, 2, 2) }), conc2: mat('#c9c6bf'), plywood: mat('#ffffff', { map: rep(TX.plywood, 1, 1) }),
    rebar: mat('#c2410c', { roughness: 0.6, metalness: 0.3 }), mesh: new THREE.MeshStandardMaterial({ map: rep(TX.mesh, 8, 8), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.6 }),
    scaffold: mat('#9ca3af', { metalness: 0.5, roughness: 0.4 }), plank: mat('#a16207'), steel: mat('#6b7280', { metalness: 0.55, roughness: 0.45 }), steelRed: mat('#9b2c2c', { metalness: 0.4, roughness: 0.5 }),
    purlin: mat('#b8c0c8', { metalness: 0.6, roughness: 0.35 }), roof: mat('#ffffff', { map: rep(TX.roof, 6, 1), metalness: 0.2, roughness: 0.5, side: THREE.DoubleSide }),
    panel: mat('#ffffff', { map: rep(TX.panel, 4, 1), side: THREE.DoubleSide }), alc: mat('#ffffff', { map: rep(TX.alc, 4, 6) }), brick: mat('#ffffff', { map: rep(TX.brick, 4, 8) }),
    sand: mat('#ffffff', { map: rep(TX.sand, 8, 8) }), paved: mat('#ffffff', { map: rep(TX.concrete, 40, 40), roughness: 0.75 }), gravel: mat('#ffffff', { map: rep(TX.gravel, 10, 10) }), dirt: mat('#ffffff', { map: rep(TX.dirt, 30, 30) }), pit: mat('#6b5235'),
    nylon: mat('#ffffff', { map: rep(TX.nylon, 6, 6), roughness: 0.3 }), floor: mat('#ffffff', { map: rep(TX.concrete, 10, 10), roughness: 0.6 }), asphalt: mat('#ffffff', { map: rep(TX.asphalt, 20, 2) }),
    grass: mat('#ffffff', { map: TX.grass }), water: mat('#ffffff', { map: TX.water, roughness: 0.15, metalness: 0.2 }), pipe: mat('#d32f2f', { roughness: 0.5 }), pvc: mat('#9ca3af'),
    pile: mat('#9e9a92'), glass: new THREE.MeshStandardMaterial({ color: '#5b8fd6', roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.85 }), darkClad: mat('#3c4149'), brown: mat('#8a4b2f'),
    white: mat('#f4f5f6'), yellow: mat('#f2b705', { roughness: 0.5 }), yellowDark: mat('#d79f00'), orange: mat('#ea7a1b'), black: mat('#1f1f1f'), tyre: mat('#1a1a1a', { roughness: 0.9 }),
    cab: new THREE.MeshStandardMaterial({ color: '#9ec3e8', roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.7 }), blue: mat('#1d4ed8'), grey: mat('#6b7280'), lightGrey: mat('#d1d5db'),
    track: mat('#ffffff', { map: rep(TX.track, 8, 1) }), bag: mat('#ffffff', { map: TX.bag }), drum: mat('#ffffff', { map: TX.drum, metalness: 0.4 }), mixer: mat('#ffffff', { map: rep(TX.mixer, 2, 1) }),
    bamboo: mat('#b8a24a'), wood: mat('#8b5a2b'), foil: mat('#d7dbe0', { metalness: 0.7, roughness: 0.3 }), green: mat('#2f9e44'), trunk: mat('#6b4a2b'), leaf: mat('#3f8a3a'), leaf2: mat('#4f9a46'), leaf3: mat('#2f7a33'),
    skin: mat('#f1c9a5'), vest: mat('#f97316'), helmetY: mat('#facc15'), helmetW: mat('#f8fafc'), jeans: mat('#334155'),
    ghost: new THREE.MeshBasicMaterial({ color: '#7aa7ff', transparent: true, opacity: 0.035, depthWrite: false }), ghostLine: new THREE.LineBasicMaterial({ color: '#5b7fc6', transparent: true, opacity: 0.38 }),
    hl: new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#ffb000', emissiveIntensity: 0.8 }), deck: mat('#ffffff', { map: rep(TX.roof, 8, 8), metalness: 0.5, roughness: 0.4 }), hit: new THREE.MeshBasicMaterial({ visible: false }),
  };
  for (const m of Object.values(M)) if (!MATS.includes(m)) MATS.push(m);
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const mesh = (geo, material, x = 0, y = 0, z = 0, parent = scene, shadow = true) => { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m; };
  const boxM = (w, h, d, material, x, y, z, parent = scene, shadow = true) => mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, parent, shadow);
  const cyl = (rt, rb, h, material, x, y, z, parent = scene, seg = 14) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material, x, y, z, parent);
  const flat = (w, d, material, x, y, z, parent = scene) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; parent.add(m); return m; };
  function label(html, cls = '', onClick = null) { const el = document.createElement('div'); el.className = `s3d-label ${cls}${onClick ? ' click' : ''}`; el.innerHTML = html; if (onClick) el.addEventListener('click', onClick); return new CSS2DObject(el); }
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3();
  const mtx = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => new THREE.Matrix4().compose(v3(x, y, z), tmpQ.setFromEuler(new THREE.Euler(0, ry, 0)), v3(sx, sy, sz));
  // Gộp nhiều hình (đã đặt vị trí) thành một hình để vẽ một lần.
  const place = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => { const g = geo.clone(); g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz))); g.translate(x, y, z); return g.index ? g.toNonIndexed() : g; };
  const merged = list => mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g)), false);

  /* Nhóm phần tử lặp (cột, ô sàn, khung kèo…) vẽ bằng InstancedMesh; tiến độ = hiện phần tử [from, to). */
  const ELEMS = [];
  class Elems {
    constructor(geo, material, mats, task, { shadow = true, cast = true } = {}) {
      this.mesh = new THREE.InstancedMesh(geo, material, Math.max(1, mats.length)); this.mats = mats; this.n = mats.length; this.task = task; this.base = material;
      this.mesh.castShadow = cast; this.mesh.receiveShadow = shadow; this.mesh.frustumCulled = false; this.mesh.userData.elems = this;
      this.from = -1; this.to = -1; this.range(0, 0); scene.add(this.mesh); ELEMS.push(this);
    }
    range(from, to) {
      if (this.disabled) { from = 0; to = 0; }
      from = Math.max(0, Math.min(this.n, Math.round(from))); to = Math.max(from, Math.min(this.n, Math.round(to)));
      if (from === this.from && to === this.to) return;
      this.from = from; this.to = to;
      for (let i = 0; i < this.n; i += 1) this.mesh.setMatrixAt(i, i >= from && i < to ? this.mats[i] : ZERO);
      this.mesh.instanceMatrix.needsUpdate = true; this.mesh.visible = to > from; this.mesh.boundingSphere = null; this.mesh.boundingBox = null;
    }
    frac(p) { this.range(0, this.n * p / 100); }
  }
  const UPDATERS = [];
  const ANOMALIES = {};
  const REPLACE = {}; // phần dựng theo tiến độ của từng nhà (ẩn khi mô hình thiết kế nhà đó đã hiện thật)
  const k = (n, p) => Math.round(n * Math.max(0, Math.min(100, p)) / 100);

  /* ───────── Mặt bằng (đơn vị m; x đông, z nam) ───────── */
  const kidsOf = w => (TASK[w] ? TASK[w].kids.map(x => x.wbs) : []);
  // SMB: theo mô hình SketchUp thật (17/10), tâm khu đất = gốc toạ độ; đường lớn phía tây, cổng góc tây nam.
  const SITE = SITE_KEY === 'SMB' ? { x0: -95.05, x1: 95.05, z0: -44.1, z1: 44.1 } : { x0: -110, x1: 111, z0: -129, z1: 129 };
  const ZONE = { x0: -105, x1: 78, z0: -112, z1: -1 }; // phần đất thi công giai đoạn 2 (XinHai)
  const BLD = SITE_KEY === 'SMB' ? {
    NVP: { name: 'Nhà văn phòng', short: 'Văn phòng', x0: -71.45, x1: -54.85, z0: -42.3, z1: -6.2, roots: ['1', '2', '3', '4'] },
    NX1: { name: 'Nhà xưởng 1', short: 'Xưởng 1', x0: -55.05, x1: 5.05, z0: -0.2, z1: 32.9, roots: ['5', '6', '7', '8'] },
    NX2: { name: 'Nhà xưởng 2', short: 'Xưởng 2', x0: -55.05, x1: 4.95, z0: -41.2, z1: -8.1, roots: ['9', '10', '11', '12'] },
    NX3: { name: 'Nhà xưởng 3', short: 'Xưởng 3', x0: 16.95, x1: 92.05, z0: -41.2, z1: 32.9, roots: ['13', '14', '15', '16'] },
    HT: { name: 'Hạ tầng', short: 'Hạ tầng', x0: SITE.x0, x1: SITE.x1, z0: SITE.z0, z1: SITE.z1, roots: ['17'] },
  } : {
    COC: { name: 'Phần cọc', short: 'Cọc', x0: -84.5, x1: 57, z0: -57.2, z1: -2.9, roots: kidsOf('1'), noLabel: true },
    NVP: { name: 'Nhà văn phòng (nhà điều hành)', short: 'Văn phòng', x0: 57.5, x1: 75.6, z0: -59, z1: -3, roots: kidsOf('2') },
    NNC: { name: 'Nhà nghỉ ca', short: 'Nghỉ ca', x0: -88.4, x1: -67, z0: -85.1, z1: -68, roots: kidsOf('3') },
    NX: { name: 'Xưởng sản xuất chính + kho', short: 'Xưởng', x0: -84.5, x1: 57, z0: -57.2, z1: -2.9, roots: kidsOf('4') },
    PHU: { name: 'WC + khí nén, trạm biến áp, hồ PCCC, nhà xe', short: 'Hạng mục phụ', x0: -60, x1: 78, z0: -140, z1: -10, roots: ['5', '6', '7'], noLabel: true },
    HT: { name: 'Hạ tầng, cây xanh, bàn giao', short: 'Hạ tầng', x0: SITE.x0, x1: SITE.x1, z0: SITE.z0, z1: SITE.z1, roots: ['8', '9'], noLabel: true },
  };
  // Mã hạng mục đổi / chưa có trong Vioo thì bỏ khỏi cây (mô hình vẫn dựng, phần đó để trống).
  for (const b of Object.values(BLD)) b.roots = b.roots.filter(r => TASK[r]);

  /* ───────── Đất, đường lớn, rừng cây xung quanh ───────── */
  flat(2400, 2400, M.grass, 0, SITE_KEY === 'DA29' ? -0.9 : -0.02, 0);
  const GR = SITE_KEY === 'SMB' ? SITE : ZONE;
  const siteGround = flat(GR.x1 - GR.x0, GR.z1 - GR.z0, M.dirt, (GR.x0 + GR.x1) / 2, 0.01, (GR.z0 + GR.z1) / 2);
  siteGround.userData.site = true;
  // Đường lớn phía tây SMB: đoạn trong mô hình (x ≈ −113 chạy bắc–nam, vòng về tây ở z ≈ −56) + nối dài ra ngoài mô hình.
  const ROAD_X = -113, ROAD_ZN = -56;
  const onRoad = (x, z) => (SITE_KEY === 'SMB' ? (Math.abs(x - ROAD_X) < 9 && z > ROAD_ZN - 6) || (Math.abs(z - ROAD_ZN) < 9 && x < ROAD_X + 6) : Math.abs(x + 80) < 9);
  const ctxG = new THREE.Group(); scene.add(ctxG); // nền tạm cho phần mô hình thiết kế đã có (ẩn khi tải xong mô hình)
  if (SITE_KEY === 'SMB') {
    flat(8, 640, M.asphalt, ROAD_X, 0.02, 68 + 320); flat(640, 8, M.asphalt, -172 - 320, 0.02, ROAD_ZN);
    flat(8, 128, M.asphalt, ROAD_X, 0.02, ROAD_ZN + 64, ctxG); flat(63, 8, M.asphalt, -140.5, 0.02, ROAD_ZN, ctxG); flat(20, 8, M.asphalt, -103, 0.02, 38.8, ctxG);
    // Cây xanh quanh khu đất: 3 InstancedMesh (thân + 2 tán) cho vài trăm cây, chừa đường lớn.
    const pts = []; let guard = 0;
    while (pts.length < (HIGH ? 480 : 240) && guard < 8000) { guard += 1; const x = -330 + Math.random() * 640, z = -260 + Math.random() * 520;
      if (x > SITE.x0 - 8 && x < SITE.x1 + 6 && z > SITE.z0 - 6 && z < SITE.z1 + 6) continue; if (onRoad(x, z)) continue; pts.push([x, z, 0.8 + Math.random() * 0.9]); }
    // Mỗi cây: thân thon + 3 tán lệch nhau, màu lá hơi khác nhau từng cây (instanceColor).
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.42, 3.2, 7), M.trunk, pts.length), c1 = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, HIGH ? 2 : 1), M.leaf, pts.length), c2 = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, HIGH ? 2 : 1), M.leaf2, pts.length), c3 = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, HIGH ? 2 : 1), M.leaf3, pts.length);
    const tint = new THREE.Color();
    pts.forEach(([x, z, sc], i) => { const ry = Math.random() * Math.PI * 2; trunk.setMatrixAt(i, mtx(x, 1.6 * sc, z, sc, sc, sc)); c1.setMatrixAt(i, mtx(x, 4.3 * sc, z, sc * 1.1, sc * 1.3, sc * 1.1, ry)); c2.setMatrixAt(i, mtx(x + 0.9 * sc, 5.5 * sc, z + 0.5 * sc, sc, sc * 0.9, sc, ry)); c3.setMatrixAt(i, mtx(x - 0.8 * sc, 5.2 * sc, z - 0.6 * sc, sc, sc, sc, ry));
      tint.setHSL(0.26 + Math.random() * 0.06, 0.45 + Math.random() * 0.2, 0.42 + Math.random() * 0.14); c1.setColorAt(i, tint); c2.setColorAt(i, tint.clone().offsetHSL(0.01, 0, 0.05)); c3.setColorAt(i, tint.clone().offsetHSL(-0.01, 0, -0.04)); });
    for (const m of [trunk, c1, c2, c3]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
  }

  /* ───────── Hình hoàn thành (bóng mờ theo phối cảnh) ───────── */
  const ghosts = new THREE.Group(); scene.add(ghosts);
  // Công trình tạm (lán BCH, rào tôn, đường đất, bãi vật tư) ẩn khi xem hoàn thiện; phần cảnh quan theo phối cảnh chỉ hiện khi xem hoàn thiện.
  const tempG = new THREE.Group(); scene.add(tempG);
  const finishG = new THREE.Group(); finishG.visible = false; scene.add(finishG);
  const ghostLabels = [];
  function ghostBox(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); const m = new THREE.Mesh(g, M.ghost); m.position.set(x, y, z); ghosts.add(m); const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), M.ghostLine); e.position.copy(m.position); ghosts.add(e); return m; }
  function ghostGable(b, eave, ridge) {
    const w = b.x1 - b.x0, len = b.z0 - b.z1, cx = (b.x0 + b.x1) / 2;
    ghostBox(w, eave, -len, cx, eave / 2, (b.z0 + b.z1) / 2);
    const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, ridge - eave); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: b.z1 - b.z0, bevelEnabled: false }); const m = new THREE.Mesh(g, M.ghost); m.position.set(cx, eave, b.z0); ghosts.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), M.ghostLine); e.position.copy(m.position); ghosts.add(e);
  }

  /* ───────── Bộ dựng phần tử theo tiến độ ───────── */
  // Cột: 3 giai đoạn cốt thép → ván khuôn → bê tông.
  function columns(pos, y0, y1, size, tk) {
    const h = y1 - y0, list = pos.map(([x, z]) => mtx(x, y0 + h / 2, z));
    const cage = merged([...[-1, 1].flatMap(a => [-1, 1].map(b => place(new THREE.BoxGeometry(0.035, h + 0.6, 0.035), a * size * 0.32, 0.3, b * size * 0.32))), ...Array.from({ length: Math.max(2, Math.round(h / 0.3)) }, (_, i) => place(new THREE.BoxGeometry(size * 0.7, 0.015, size * 0.7), 0, -h / 2 + 0.15 + i * 0.3, 0))]);
    const reb = new Elems(cage, M.rebar, list, tk.reb), form = new Elems(new THREE.BoxGeometry(size + 0.08, h, size + 0.08), M.plywood, list, tk.form), conc = new Elems(new THREE.BoxGeometry(size, h, size), M.concrete, list, tk.conc);
    UPDATERS.push(d => { const n = list.length, kc = k(n, pAt(tk.conc, d)), kf = Math.max(kc, k(n, pAt(tk.form, d))), kr = Math.max(kf, k(n, pAt(tk.reb, d))); conc.range(0, kc); form.range(kc, kf); reb.range(kf, kr); });
    return { reb, form, conc };
  }
  // Ô sàn: cây chống → ván khuôn → lưới thép → bê tông; tháo giáo xoá cây chống.
  const propGeo = (w, d, h) => { const parts = []; const nx = Math.max(2, Math.round(w / 1.6)), nz = Math.max(2, Math.round(d / 1.6));
    for (let i = 0; i < nx; i += 1) for (let j = 0; j < nz; j += 1) parts.push(place(new THREE.CylinderGeometry(0.03, 0.03, h, 5), -w / 2 + 0.4 + i * (w - 0.8) / (nx - 1), 0, -d / 2 + 0.4 + j * (d - 0.8) / (nz - 1)));
    for (let j = 0; j < nz; j += 1) parts.push(place(new THREE.BoxGeometry(w - 0.6, 0.06, 0.08), 0, h / 2 - 0.05, -d / 2 + 0.4 + j * (d - 0.8) / (nz - 1)));
    return merged(parts); };
  function slab(bays, y, thick, tk, propH, opt = {}) {
    const list = bays.map(b => mtx((b.x0 + b.x1) / 2, y, (b.z0 + b.z1) / 2, b.x1 - b.x0, 1, b.z1 - b.z0));
    const unitBox = new THREE.BoxGeometry(1, thick, 1), unitPly = new THREE.BoxGeometry(1, 0.05, 1), unitMesh = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const conc = new Elems(unitBox, M.concrete, list, tk.conc);
    const form = new Elems(unitPly, opt.formMat || M.plywood, bays.map(b => mtx((b.x0 + b.x1) / 2, y - thick / 2 + 0.02, (b.z0 + b.z1) / 2, b.x1 - b.x0, 1, b.z1 - b.z0)), tk.form);
    const reb = new Elems(unitMesh, M.mesh, bays.map(b => mtx((b.x0 + b.x1) / 2, y - thick / 2 + 0.12, (b.z0 + b.z1) / 2, b.x1 - b.x0, 1, b.z1 - b.z0)), tk.reb, { cast: false });
    const b0 = bays[0], pw = b0.x1 - b0.x0, pd = b0.z1 - b0.z0;
    const props = new Elems(propGeo(pw, pd, propH), M.scaffold, bays.map(b => mtx((b.x0 + b.x1) / 2, y - thick / 2 - propH / 2, (b.z0 + b.z1) / 2, (b.x1 - b.x0) / pw, 1, (b.z1 - b.z0) / pd)), tk.props);
    UPDATERS.push(d => { const n = bays.length, kc = k(n, pAt(tk.conc, d)), kr = Math.max(kc, k(n, pAt(tk.reb, d))), kf = Math.max(kr, k(n, pAt(tk.form, d))), kp = k(n, pAt(tk.props, d)), ks = tk.strip ? k(n, pAt(tk.strip, d)) : 0;
      conc.range(0, kc); reb.range(kc, kr); form.range(kc, kf); if (opt.noProps || FINISHED) props.range(0, 0); else props.range(Math.min(ks, kp), Math.max(kp, kf > 0 && !tk.props ? kf : kp)); });
    return { conc, form, reb, props };
  }
  // Móng: cọc → hố đào → đế móng → giằng → lấp đất (lấp xong thì móng khuất dưới nền).
  function foundation(pos, tk, footprint) {
    const list = pos.map(([x, z]) => mtx(x, 0, z));
    const pileGeo = merged([[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].map(([a, b]) => place(new THREE.CylinderGeometry(0.17, 0.17, 0.5, 10), a, 0.25, b)));
    const piles = new Elems(pileGeo, M.pile, list, tk.pile), pits = new Elems(new THREE.BoxGeometry(2.8, 0.04, 2.8), M.pit, pos.map(([x, z]) => mtx(x, 0.03, z)), tk.dig, { cast: false });
    const pads = new Elems(new THREE.BoxGeometry(2.2, 0.7, 2.2), M.concrete, pos.map(([x, z]) => mtx(x, 0.35, z)), tk.pad);
    const tieM = [];
    if (footprint) { const { xs, zs } = footprint; for (const x of xs) for (let j = 0; j < zs.length - 1; j += 1) tieM.push(mtx(x, 0.25, (zs[j] + zs[j + 1]) / 2, 0.3, 0.5, Math.abs(zs[j + 1] - zs[j]))); for (const z of zs) for (let i = 0; i < xs.length - 1; i += 1) tieM.push(mtx((xs[i] + xs[i + 1]) / 2, 0.25, z, Math.abs(xs[i + 1] - xs[i]), 0.5, 0.3)); }
    const tieE = tieM.length ? new Elems(new THREE.BoxGeometry(1, 1, 1), M.concrete, tieM, tk.tie) : null;
    const cage = merged([...[-0.9, -0.3, 0.3, 0.9].flatMap(a => [place(new THREE.BoxGeometry(2.0, 0.03, 0.03), 0, 0.1, a), place(new THREE.BoxGeometry(0.03, 0.03, 2.0), a, 0.1, 0)]), ...[-0.25, 0.25].flatMap(a => [-0.25, 0.25].map(b => place(new THREE.BoxGeometry(0.035, 1.3, 0.035), a, 0.7, b)))]);
    const padReb = tk.reb ? new Elems(cage, M.rebar, list, tk.reb) : null, padForm = tk.form ? new Elems(new THREE.BoxGeometry(2.35, 0.75, 2.35), M.plywood, pos.map(([x, z]) => mtx(x, 0.37, z)), tk.form) : null;
    const tieReb = tk.reb && tieM.length ? new Elems(new THREE.BoxGeometry(1, 1, 1), M.rebar, tieM.map(m => m.clone().multiply(new THREE.Matrix4().makeScale(0.7, 0.8, 1))), tk.reb) : null;
    const tieForm = tk.form && tieM.length ? new Elems(new THREE.BoxGeometry(1, 1, 1), M.plywood, tieM.map(m => m.clone().multiply(new THREE.Matrix4().makeScale(1.25, 1.05, 1))), tk.form) : null;
    UPDATERS.push(d => { const n = pos.length, fill = k(n, pAt(tk.backfill, d)), kp = k(n, pAt(tk.pad, d)), kf = Math.max(kp, tk.form ? k(n, pAt(tk.form, d)) : 0), kr = Math.max(kf, tk.reb ? k(n, pAt(tk.reb, d)) : 0);
      piles.range(Math.max(fill, kp, kr), k(n, pAt(tk.pile, d))); pits.range(fill, Math.max(k(n, pAt(tk.dig, d)), kr)); pads.range(fill, kp);
      if (padForm) padForm.range(Math.max(fill, kp), kf); if (padReb) padReb.range(Math.max(fill, kf), kr);
      if (tieE) { const m = tieE.n, tf = k(m, pAt(tk.backfill, d)), tc = k(m, pAt(tk.tie, d)), tfo = Math.max(tc, tk.form ? k(m, pAt(tk.form, d)) : 0), tr = Math.max(tfo, tk.reb ? k(m, pAt(tk.reb, d)) : 0);
        tieE.range(tf, tc); if (tieForm) tieForm.range(Math.max(tf, tc), tfo); if (tieReb) tieReb.range(Math.max(tf, tfo), tr); } });
  }
  // Nền: cát → base → nilong + thép → bê tông, theo dải dọc nhà.
  function groundFloor(b, strips, tk) {
    const w = b.x1 - b.x0, len = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, sl = len / strips, mk = y => Array.from({ length: strips }, (_, i) => mtx(cx, y, b.z1 - sl * (i + 0.5), w, 1, sl));
    const pl = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const sand = tk.sand ? new Elems(pl, M.sand, mk(0.05), tk.sand, { cast: false }) : null, base = new Elems(pl, M.gravel, mk(0.09), tk.base, { cast: false });
    const nyl = tk.mesh ? new Elems(pl, M.nylon, mk(0.12), tk.mesh, { cast: false }) : null, mesh2 = tk.mesh ? new Elems(pl, M.mesh, mk(0.16), tk.mesh, { cast: false }) : null;
    const conc = tk.conc ? new Elems(new THREE.BoxGeometry(1, 0.15, 1), M.floor, mk(0.14), tk.conc, { cast: false }) : null;
    UPDATERS.push(d => { const kc = conc ? k(strips, pAt(tk.conc, d)) : 0, km = nyl ? Math.max(kc, k(strips, pAt(tk.mesh, d))) : 0, kb = k(strips, pAt(tk.base, d));
      if (sand) sand.range(kb, k(strips, pAt(tk.sand, d))); base.range(km, kb); if (nyl) { nyl.range(kc, km); mesh2.range(kc, km); } if (conc) conc.range(0, kc); });
  }
  // Tường: từng đoạn xây theo %.
  function walls(segs, y0, h, material, task, thick = 0.2) {
    const list = segs.map(([ax, az, bx, bz]) => { const len = Math.hypot(bx - ax, bz - az); return mtx((ax + bx) / 2, y0 + h / 2, (az + bz) / 2, len, h, thick, -Math.atan2(bz - az, bx - ax)); });
    const e = new Elems(new THREE.BoxGeometry(1, 1, 1), material, list, task); UPDATERS.push(d => e.frac(pAt(task, d))); return e;
  }
  const perimeter = (b, nLong, nShort, inset = 0) => { const x0 = b.x0 + inset, x1 = b.x1 - inset, z0 = b.z0 + inset, z1 = b.z1 - inset, segs = [];
    for (let i = 0; i < nLong; i += 1) { const a = z1 - (z1 - z0) * i / nLong, c = z1 - (z1 - z0) * (i + 1) / nLong; segs.push([x0, a, x0, c], [x1, a, x1, c]); }
    for (let i = 0; i < nShort; i += 1) { const a = x0 + (x1 - x0) * i / nShort, c = x0 + (x1 - x0) * (i + 1) / nShort; segs.push([a, z1, c, z1]); segs.push([a, z0, c, z0]); }
    return segs; };
  // Hình chữ I và chữ C cho kết cấu thép.
  function iShape(h, b, tw, tf) { const s = new THREE.Shape(); s.moveTo(-b / 2, -h / 2); s.lineTo(b / 2, -h / 2); s.lineTo(b / 2, -h / 2 + tf); s.lineTo(tw / 2, -h / 2 + tf); s.lineTo(tw / 2, h / 2 - tf); s.lineTo(b / 2, h / 2 - tf); s.lineTo(b / 2, h / 2); s.lineTo(-b / 2, h / 2); s.lineTo(-b / 2, h / 2 - tf); s.lineTo(-tw / 2, h / 2 - tf); s.lineTo(-tw / 2, -h / 2 + tf); s.lineTo(-b / 2, -h / 2 + tf); s.closePath(); return s; }
  function cShape(h, b, th) { const s = new THREE.Shape(); s.moveTo(0, -h / 2); s.lineTo(b, -h / 2); s.lineTo(b, -h / 2 + th); s.lineTo(th, -h / 2 + th); s.lineTo(th, h / 2 - th); s.lineTo(b, h / 2 - th); s.lineTo(b, h / 2); s.lineTo(0, h / 2); s.closePath(); return s; }
  const member = (shape, len) => new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -len / 2);
  // Mái thép nhà xưởng: khung kèo theo từng trục, xà gồ theo từng bước cột, tôn mái và tôn/panel tường theo bước.
  function steelRoof(b, spans, frameZ, yBase, eave, ridge, tk) {
    const parts = [];
    for (const sp of spans) {
      const w = sp.x1 - sp.x0, cx = (sp.x0 + sp.x1) / 2, rise = ridge - eave, raf2 = Math.hypot(w / 2, rise), ang = Math.atan2(rise, w / 2);
      for (const x of [sp.x0, sp.x1]) parts.push(place(member(iShape(0.5, 0.25, 0.012, 0.02), eave - yBase), x, (eave + yBase) / 2, 0, Math.PI / 2, 0, 0));
      for (const [sx, a] of [[(sp.x0 + cx) / 2, ang], [(sp.x1 + cx) / 2, -ang]]) { const g = member(iShape(0.55, 0.22, 0.01, 0.016), raf2); g.rotateY(Math.PI / 2); g.rotateZ(a); g.translate(sx, eave + rise / 2, 0); parts.push(g.toNonIndexed()); }
    }
    const frames2 = new Elems(merged(parts), M.steelRed, frameZ.map(z => mtx(0, 0, z)), tk.steel);
    // Xà gồ C giữa hai khung liền nhau.
    const bayLen = Math.abs(frameZ[1] - frameZ[0]), pur = [];
    for (const sp of spans) { const w = sp.x1 - sp.x0, cx = (sp.x0 + sp.x1) / 2, rise = ridge - eave;
      for (let i = 0; i <= 7; i += 1) for (const side of [-1, 1]) { const f = i / 7, x = cx + side * (w / 2) * f, y = ridge - rise * f + 0.32; const g = member(cShape(0.2, 0.065, 0.003), bayLen); g.translate(x, y, 0); pur.push(g.toNonIndexed()); } }
    const purlins = new Elems(merged(pur), M.purlin, frameZ.slice(0, -1).map((z, i) => mtx(0, 0, (z + frameZ[i + 1]) / 2)), tk.steel);
    // Tôn mái.
    const sheet = []; for (const sp of spans) { const w = sp.x1 - sp.x0, cx = (sp.x0 + sp.x1) / 2, rise = ridge - eave, raf2 = Math.hypot(w / 2, rise) + 0.4, ang = Math.atan2(rise, w / 2);
      for (const side of [-1, 1]) { const g = new THREE.PlaneGeometry(raf2, bayLen).rotateX(-Math.PI / 2); g.rotateZ(side * -ang); g.translate(cx + side * w / 4, eave + rise / 2 + 0.45, 0); sheet.push(g); } }
    const roofE = new Elems(merged(sheet), M.roof, frameZ.slice(0, -1).map((z, i) => mtx(0, 0, (z + frameZ[i + 1]) / 2)), tk.roof, { cast: true });
    // Tôn / panel bao quanh phần trên (từ yBase tới diềm mái), theo bước cột hai bên.
    let clad = null;
    if (tk.clad) { const side = []; for (const x of [b.x0 - 0.15, b.x1 + 0.15]) side.push(new THREE.PlaneGeometry(bayLen, eave - yBase).rotateY(Math.PI / 2).translate(x, (eave + yBase) / 2, 0));
      clad = new Elems(merged(side), M.panel, frameZ.slice(0, -1).map((z, i) => mtx(0, 0, (z + frameZ[i + 1]) / 2)), tk.clad); }
    UPDATERS.push(d => { const nf = frameZ.length, kf = k(nf, pAt(tk.steel, d)); frames2.range(0, kf); purlins.range(0, Math.max(0, kf - 1)); roofE.range(0, k(nf - 1, pAt(tk.roof, d))); if (clad) clad.range(0, k(nf - 1, pAt(tk.clad, d))); });
  }
  // Ống PCCC đỏ chạy dọc nhà dưới mái, có ty treo.
  function fireLines(b, xs, y, task) {
    const len = b.z1 - b.z0, n = 10, seg = len / n, list = [];
    for (const x of xs) for (let i = 0; i < n; i += 1) list.push(mtx(x, y, b.z1 - seg * (i + 0.5), 1, 1, 1));
    const geo = merged([place(new THREE.CylinderGeometry(0.08, 0.08, seg, 10), 0, 0, 0, Math.PI / 2, 0, 0), place(new THREE.CylinderGeometry(0.01, 0.01, 1.2, 4), 0, 0.6, 0)]);
    const e = new Elems(geo, M.pipe, list, task); UPDATERS.push(d => e.frac(pAt(task, d)));
  }
  // Giàn giáo ngoài bao quanh nhà (khung ống + sàn công tác).
  function outerScaffold(b, height, task, removeTask) {
    const segs = perimeter(b, 6, 4, -1.2), list = [];
    for (const [ax, az, bx, bz] of segs) { const len = Math.hypot(bx - ax, bz - az); list.push(mtx((ax + bx) / 2, 0, (az + bz) / 2, 1, 1, 1, -Math.atan2(bz - az, bx - ax)).multiply(new THREE.Matrix4().makeScale(len / 4, 1, 1))); }
    const parts = []; for (let lv = 0; lv <= Math.floor(height / 2); lv += 1) { parts.push(place(new THREE.BoxGeometry(4, 0.05, 0.05), 0, lv * 2, 0)); parts.push(place(new THREE.BoxGeometry(4, 0.05, 0.05), 0, lv * 2, 1)); parts.push(place(new THREE.BoxGeometry(4, 0.04, 1), 0, lv * 2 + 0.03, 0.5)); }
    for (const x of [-2, 2]) for (const z of [0, 1]) parts.push(place(new THREE.CylinderGeometry(0.03, 0.03, height, 5), x, height / 2, z));
    const e = new Elems(merged(parts), M.scaffold, list, task); UPDATERS.push(d => (FINISHED ? e.range(0, 0) : e.range(removeTask ? k(e.n, pAt(removeTask, d)) : 0, k(e.n, pAt(task, d)))));
  }

  /* ───────── Bảng hiệu Ban chỉ huy: logo Tiến Thịnh + tên công trình (hai mặt) ───────── */
  function signTexture(line1, line2) {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 256; const g = c.getContext('2d');
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; TEXTURES.push(tx);
    const draw = img => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1280, 256); g.fillStyle = '#0b6b1e'; g.fillRect(0, 238, 1280, 18);
      let x0 = 48;
      if (img) { const h = 196, w = h * img.width / img.height; g.drawImage(img, 30, 22, w, h); x0 = 30 + w + 34; g.fillStyle = '#d1d5db'; g.fillRect(x0 - 18, 40, 3, 160); }
      g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = '#0a4d17'; g.font = '800 60px Arial, Helvetica, sans-serif'; g.fillText(line1, x0, 98, 1280 - x0 - 30);
      g.fillStyle = '#374151'; g.font = '600 38px Arial, Helvetica, sans-serif'; g.fillText(line2, x0, 176, 1280 - x0 - 30);
      tx.needsUpdate = true; invalidate();
    };
    draw(null);
    if (logoUrl) { const img = new Image(); img.onload = () => { if (!disposed) draw(img); }; img.src = logoUrl; }
    return tx;
  }
  function signBoard(parent, x, y, z, w, h, ry = 0) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
    const m = new THREE.MeshBasicMaterial({ map: signTexture('BAN CHỈ HUY CÔNG TRƯỜNG', signLine) }); MATS.push(m);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); front.position.z = 0.07; g.add(front);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); back.position.z = -0.07; back.rotation.y = Math.PI; g.add(back);
    boxM(w + 0.24, h + 0.24, 0.12, M.grey, 0, 0, 0, g);
    for (const s of [-1, 1]) boxM(0.16, 1.8, 0.16, M.grey, s * w * 0.36, -h / 2 - 0.9, 0, g);
    return g;
  }

  // Cây cau / dừa cảnh: thân cong nhẹ, 9 tàu lá rủ.
  function palm(parent, x, z, h = 6) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.random() * Math.PI * 2; parent.add(g);
    const tr = cyl(0.14, 0.26, h, M.trunk, 0, h / 2, 0, g, 8); tr.rotation.z = 0.06;
    for (let i = 0; i < 9; i += 1) { const f = new THREE.Group(); f.position.set(0, h, 0); f.rotation.y = (i / 9) * Math.PI * 2; f.rotation.z = -0.35 - (i % 3) * 0.18; g.add(f);
      const leaf = mesh(new THREE.PlaneGeometry(0.9, 3.8), i % 2 ? M.leaf : M.leaf3, 0, 0, 1.9, f); leaf.rotation.x = -Math.PI / 2 + 0.55; leaf.castShadow = true; }
    cyl(0.3, 0.3, 0.3, M.brown, 0, h, 0, g, 8);
    return g;
  }
  const FH = 3.6;
  // Dựng trong khung cục bộ (bề rộng theo x, chiều dài theo z) rồi xoay 90° về đúng chỗ trên mặt bằng thật:
  // x thật = z cục bộ + tx, z thật = tz − x cục bộ. Trả về các nhóm phần tử đã dựng (để ẩn khi mô hình thiết kế đã hiện thật).
  function placed(tx, tz, fn) {
    const n0 = ELEMS.length, g0 = ghosts.children.length, M4 = new THREE.Matrix4().makeTranslation(tx, 0, tz).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    fn();
    const made = ELEMS.slice(n0); for (const e of made) { e.mats = e.mats.map(m => M4.clone().multiply(m)); const f = e.from, to = e.to; e.from = -1; e.range(f, to); }
    for (const o of ghosts.children.slice(g0)) o.applyMatrix4(M4);
    return made;
  }
  if (SITE_KEY === 'SMB') {
  /* ───────── Nhà văn phòng 4 tầng + tum (16,6 × 36,1 m, mặt tiền nhìn sân phía tây) ───────── */
  {
    const C = [['2.1', '2.2', '2.3'], ['2.8', '2.9', '2.10'], ['2.16', '2.17', '2.18'], ['2.24', '2.25', '2.26']];
    const S = [['2.4', '2.5', '2.6', '2.7', '2.15'], ['2.11', '2.12', '2.13', '2.14', '2.23'], ['2.19', '2.20', '2.21', '2.22', '2.31'], ['2.27', '2.28', '2.29', '2.30', '2.39']];
    frameBuilding(BLD.NVP, { key: 'NVP', nx: 2, nz: 4, fh: FH, ghostH: 4 * FH + 3, noGhost: false,
      found: { pile: '1.2', dig: '1.3', pad: '1.8', tie: '1.13', backfill: '1.9', plinth: '1.14' }, ground: { sand: '1.16', base: '1.16' },
      floors: C.map((c, f) => ({ col: { reb: c[0], form: c[1], conc: c[2] }, slab: { props: S[f][0], form: S[f][1], reb: S[f][2], conc: S[f][3], strip: S[f][4] }, wall: ['3.1', '3.2', '3.3', '3.4'][f] })),
      tum: { col: { reb: '2.32', form: '2.33', conc: '2.34' }, slab: { props: '2.35', form: '2.36', reb: '2.37', conc: '2.38', strip: '2.39' } } });
    const n1 = ELEMS.length; outerScaffold(BLD.NVP, 4 * FH + 2, '3.11', null); REPLACE.NVP.push(...ELEMS.slice(n1));
  }

  /* ───────── Nhà xưởng 1, 2 (60 × 33 m, sàn tầng 2 ở +3,75, khung thép mái) ───────── */
  const factorySmall = (b, c) => {
    const xs = [b.x0, b.x0 + 15, b.x1], nz = 9, zs = Array.from({ length: nz }, (_, i) => b.z1 - (b.z1 - b.z0) * i / (nz - 1));
    const pos = []; zs.forEach(z => xs.forEach(x => pos.push([x, z])));
    foundation(pos, { pile: c.pile, dig: c.dig, pad: c.pad, tie: c.tie, backfill: c.backfill }, { xs, zs });
    walls(perimeter(b, 8, 2), 0, 0.5, M.brick, c.plinth, 0.22);
    groundFloor(b, 8, { sand: c.sand, base: c.base2 || c.base, mesh: c.floorMesh, conc: c.floorConc });
    // Cột tầng 1 chia theo khu trong tiến độ.
    for (const grp of c.colLow) { const sel = pos.filter((p, i) => Math.floor(i / 3) >= grp.rows[0] && Math.floor(i / 3) <= grp.rows[1]); columns(sel, 0, 3.55, 0.5, grp); }
    columns(pos, 3.85, 6.4, 0.5, c.colUp);
    const bays = []; for (let j = 0; j < nz - 1; j += 1) for (let i = 0; i < 2; i += 1) bays.push({ x0: xs[i] - (i === 0 ? 0.3 : 0), x1: xs[i + 1] + (i === 1 ? 0.3 : 0), z0: zs[j + 1], z1: zs[j] + (j === 0 ? 0.3 : 0) });
    slab(bays, 3.75, 0.2, c.slab2, 3.55);
    walls(perimeter(b, 8, 2, 0.1), 0.5, 10.3, M.alc, c.alcOut);
    walls(zs.slice(1, -1).filter((_, i) => i % 2 === 1).map(z => [b.x0 + 0.5, z, b.x1 - 0.5, z]), 0.5, 5.4, M.alc, c.alcIn, 0.15);
    steelRoof(b, [{ x0: b.x0, x1: b.x1 }], zs, 6.5, 12.4, 15.3, { steel: c.steel, roof: c.roof, clad: c.panel });
    fireLines(b, [b.x0 + 7.5, b.x1 - 7.5], 9.6, c.pccc);
    ghostGable(b, 12.4, 15.3);
  };
  // Xưởng 2 dính nhà văn phòng (phía bắc), xưởng 1 phía nam cạnh đường nội bộ (theo ảnh phối cảnh chủ SP ghi chú).
  REPLACE.NX1 = placed(-55.05, 32.9, () => factorySmall({ x0: 0, x1: 33.1, z0: 0, z1: 60.1 }, { pile: '5.1', dig: '5.2', pad: '5.7', tie: '5.12', backfill: '5.8', plinth: '5.13', sand: '5.16', base: '5.17', base2: '6.26',
    colLow: [{ rows: [0, 1], reb: '6.1', form: '6.2', conc: '6.3' }, { rows: [2, 3], reb: '6.8', form: '6.9', conc: '6.10' }, { rows: [4, 8], reb: '6.11', form: '6.12', conc: '6.13' }],
    colUp: { reb: '6.18', form: '6.19', conc: '6.20' }, slab2: { props: '6.21', form: '6.22', reb: '6.23', conc: '6.24', strip: '6.25' },
    floorMesh: '6.27', floorConc: '6.28', alcOut: '7.1', alcIn: '7.9', steel: '7.2', roof: '7.3', panel: '7.4', pccc: '7.7' }));
  REPLACE.NX2 = placed(-55.05, -8.1, () => factorySmall({ x0: 0, x1: 33.1, z0: 0, z1: 60 }, { pile: '9.1', dig: '9.2', pad: '9.7', tie: '9.12', backfill: '9.8', plinth: '9.13', sand: '9.16', base: '9.17', base2: '10.20',
    colLow: [{ rows: [0, 1], reb: '10.1', form: '10.2', conc: '10.3' }, { rows: [2, 8], reb: '10.9', form: '10.10', conc: '10.11' }],
    colUp: { reb: '10.12', form: '10.13', conc: '10.14' }, slab2: { props: '10.15', form: '10.16', reb: '10.17', conc: '10.18', strip: '10.19' },
    floorMesh: '10.21', floorConc: '10.22', alcOut: '11.1', alcIn: '11.9', steel: '11.2', roof: '11.3', panel: '11.4', pccc: '11.7' }));

  /* ───────── Nhà xưởng 3 (75,1 × 74,1 m, hai nhịp; khung theo trục Tekla, đầu tây gần cổng) ───────── */
  REPLACE.NX3 = placed(16.95, 32.9, () => {
    const b = { x0: 0, x1: 74.1, z0: 0, z1: 75.1 }, zs = [75.1, 66, 56.5, 47, 37.5, 28, 18.5, 9, 0], nz = zs.length;
    // Zone 1 = nhịp phía nam (giáp đường nội bộ), zone 2 = nhịp phía bắc.
    const Z = [{ xs: [0, 12.35, 24.7, 37.05], code: { dig: '13.3', pad: '13.8', backfill: '13.9', tie: '13.13', plinth: '13.14', low: ['14.1', '14.2', '14.3'], up: ['14.5', '14.6', '14.7'], slab: ['14.8', '14.9', '14.10', '14.11', '14.12'], mesh: '14.26', conc: '14.27', alc: '15.1' } },
               { xs: [49.4, 61.75, 74.1], x0: 37.05, code: { dig: '13.16', pad: '13.21', backfill: '13.22', tie: '13.26', plinth: '13.27', low: ['14.13', '14.14', '14.15'], up: ['14.17', '14.18', '14.19'], slab: ['14.20', '14.21', '14.22', '14.23', '14.24'], mesh: '14.28', conc: '14.29', alc: '15.2' } }];
    for (const zn of Z) {
      const c = zn.code, pos = []; zs.forEach(z => zn.xs.forEach(x => pos.push([x, z])));
      const allX = zn.x0 != null ? [zn.x0, ...zn.xs] : zn.xs;
      foundation(pos, { pile: '13.2', dig: c.dig, pad: c.pad, tie: c.tie, backfill: c.backfill }, { xs: zn.xs, zs });
      columns(pos, 0, 3.55, 0.55, { reb: c.low[0], form: c.low[1], conc: c.low[2] });
      columns(pos, 3.85, 6.4, 0.55, { reb: c.up[0], form: c.up[1], conc: c.up[2] });
      const bays = []; for (let j = 0; j < nz - 1; j += 1) for (let i = 0; i < allX.length - 1; i += 1) bays.push({ x0: allX[i], x1: allX[i + 1], z0: zs[j + 1], z1: zs[j] });
      slab(bays, 3.75, 0.22, { props: c.slab[0], form: c.slab[1], reb: c.slab[2], conc: c.slab[3], strip: c.slab[4] }, 3.55);
      const zb = { x0: allX[0], x1: allX[allX.length - 1], z0: b.z0, z1: b.z1 };
      groundFloor(zb, 10, { sand: '13.30', base: '14.25', mesh: c.mesh, conc: c.conc });
      walls(perimeter(zb, 10, 3).filter(([ax, , bx]) => !(zn.x0 != null && ax === zb.x0 && bx === zb.x0) && !(zn.x0 == null && ax === zb.x1 && bx === zb.x1)), 0.4, 10.4, M.alc, c.alc);
    }
    steelRoof(b, [{ x0: 0, x1: 37.05 }, { x0: 37.05, x1: 74.1 }], zs, 6.5, 12, 16.5, { steel: '15.3', roof: '15.5', clad: '15.4' });
    fireLines(b, [12.35, 24.7, 49.4, 61.75], 9.6, '15.8');
    ghostGable({ x0: 0, x1: 37.05, z0: b.z0, z1: b.z1 }, 12, 16.5); ghostGable({ x0: 37.05, x1: 74.1, z0: b.z0, z1: b.z1 }, 12, 16.5);
  });

  /* ───────── Hạ tầng: đường nội bộ (đường phía nam, đường giữa hai khối xưởng, đường trước nhà văn phòng, đường dọc xưởng 1), cống ───────── */
  const ROUTES = [
    { code: ['17.5', '17.6'], a: [-89, 38.8], b: [92, 38.8], w: 7 },
    { code: ['17.7', '17.8'], a: [11, 35], b: [11, -43], w: 7 },
    { code: ['17.9', '17.10'], a: [-76, 35], b: [-76, -40], w: 6 },
    { code: ['17.11', '17.12'], a: [-59, 35], b: [-59, -4], w: 5 },
  ];
  for (const r of ROUTES) {
    const n = 12, along = Math.abs(r.b[0] - r.a[0]) > 1, list = y => Array.from({ length: n }, (_, i) => { const f = (i + 0.5) / n, x = r.a[0] + (r.b[0] - r.a[0]) * f, z = r.a[1] + (r.b[1] - r.a[1]) * f, len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) / n; return mtx(x, y, z, along ? len : r.w, 1, along ? r.w : len); });
    const pl = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const base = new Elems(pl, M.gravel, list(0.06), r.code[0], { cast: false }), conc = new Elems(new THREE.BoxGeometry(1, 0.2, 1), M.floor, list(0.1), r.code[1], { cast: false });
    UPDATERS.push(d => { const kc = k(n, pAt(r.code[1], d)); conc.range(0, kc); base.range(kc, k(n, pAt(r.code[0], d))); });
  }
  REPLACE.HT = ELEMS.slice(-ROUTES.length * 2);
  { // Cống bi D400 dọc đường phía nam + hố ga: 650 md theo BOQ.
    const list = []; for (let x = -88; x < 92; x += 2.5) list.push(mtx(x, 0.25, 42.6, 1, 1, 1, Math.PI / 2));
    const e = new Elems(new THREE.CylinderGeometry(0.25, 0.25, 2.4, 14, 1, true).rotateX(Math.PI / 2), M.pile, list, '17.1'); UPDATERS.push(d => e.frac(FINISHED ? 0 : pAt('17.1', d))); // cống chôn dưới đường khi xong
    const trench = new Elems(new THREE.PlaneGeometry(2.5, 1.4).rotateX(-Math.PI / 2), M.pit, list.map(m => new THREE.Matrix4().makeTranslation(new THREE.Vector3().setFromMatrixPosition(m).x, 0.02, 42.6)), '17.1', { cast: false });
    UPDATERS.push(d => (FINISHED ? trench.range(0, 0) : trench.range(0, Math.min(trench.n, k(trench.n, pAt('17.1', d)) + 6))));
  }

  /* ───────── Hàng rào tôn tạm + cổng phía tây, ban chỉ huy cạnh cổng ───────── */
  {
    const GATE = [27, 42]; // cổng trên ranh phía tây (z), xe vào từ đường lớn theo đường nội bộ phía nam
    const fence = [];
    for (let x = SITE.x0; x < SITE.x1 - 0.1; x += 3) { fence.push([x, SITE.z1, Math.min(SITE.x1, x + 3), SITE.z1]); fence.push([x, SITE.z0, Math.min(SITE.x1, x + 3), SITE.z0]); }
    for (let z = SITE.z0; z < SITE.z1 - 0.1; z += 3) { const z2 = Math.min(SITE.z1, z + 3); fence.push([SITE.x1, z, SITE.x1, z2]); if (z2 <= GATE[0] || z >= GATE[1]) fence.push([SITE.x0, z, SITE.x0, z2]); }
    const list = fence.map(([ax, az, bx, bz]) => mtx((ax + bx) / 2, 1.1, (az + bz) / 2, Math.hypot(bx - ax, bz - az), 2.2, 0.2, -Math.atan2(bz - az, bx - ax)));
    const tole = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat('#2f6fb3'), list.length); list.forEach((m, i) => tole.setMatrixAt(i, m)); tole.castShadow = true; tempG.add(tole); // rào tôn tạm
    const sign = canvasTex(1024, 256, (g) => { g.fillStyle = '#1d4290'; g.fillRect(0, 0, 1024, 256); g.fillStyle = '#fff'; g.font = 'bold 74px Arial'; g.textAlign = 'center'; g.fillText('CÔNG TRÌNH SƠN MIỀN BẮC', 512, 110); g.font = '600 44px Arial'; g.fillText('Thi công: Tiến Thịnh Group', 512, 190); });
    sign.wrapS = sign.wrapT = THREE.ClampToEdgeWrapping;
    const boardMat = new THREE.MeshBasicMaterial({ map: sign }); MATS.push(boardMat);
    const board = mesh(new THREE.PlaneGeometry(10, 2.5), boardMat, SITE.x0 - 0.2, 3.6, 18, tempG); board.rotation.y = -Math.PI / 2;
    boxM(0.2, 4.8, 0.2, M.grey, SITE.x0 - 0.1, 2.4, 13.2, tempG); boxM(0.2, 4.8, 0.2, M.grey, SITE.x0 - 0.1, 2.4, 22.8, tempG);
    boxM(2.6, 2.6, 2.6, M.white, -91.5, 1.3, 24.5, tempG); boxM(3.2, 0.2, 3.2, M.blue, -91.5, 2.7, 24.5, tempG); // chòi bảo vệ tạm
    // Ban chỉ huy: container văn phòng 2 tầng, nhà vệ sinh, bồn nước; bảng hiệu có logo trên nóc, nhìn ra đường nội bộ.
    const cont = (x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); boxM(6.06, 2.6, 2.44, M.white, 0, 1.3, 0, g); for (let i = -2; i <= 2; i += 1) boxM(0.08, 2.6, 2.5, M.lightGrey, i * 1.2, 1.3, 0, g); boxM(1.2, 0.9, 0.05, M.cab, -1.5, 1.6, 1.24, g); boxM(0.9, 2, 0.05, M.blue, 1.6, 1.0, 1.24, g); tempG.add(g); return g; };
    cont(-85, 0, 32); cont(-85, 2.6, 32); cont(-78, 0, 32); boxM(1.4, 2.3, 1.4, M.blue, -73.5, 1.15, 32.5, tempG); cyl(1, 1, 2, M.white, -71, 3.2, 32, tempG); for (const x of [-71.8, -70.2]) boxM(0.15, 2.2, 0.15, M.grey, x, 1.1, 32, tempG);
    const stair = boxM(0.9, 0.1, 3.4, M.grey, -81.6, 1.3, 33.5, tempG); stair.rotation.x = 0.75;
    signBoard(tempG, -85, 5.2 + 1.9, 32, 7.5, 1.5);
    const bch = label('Ban chỉ huy công trường<small>container văn phòng · kho · nhà vệ sinh</small>'); bch.position.set(-83, 10.2, 32); tempG.add(bch);
    // Khi hoàn thiện: cây cau cảnh quanh hồ và dọc lối vào (ảnh phối cảnh; mô hình SketchUp đã bỏ cây vì quá nặng).
    for (const [x, z, h] of [[-91, -14, 7], [-79, -11, 6], [-93, -37, 6.5], [-77, -39, 7.5], [-90, 6, 6], [-90, 16, 7], [-82, 2, 5.5], [-70, 0, 6.5]]) palm(finishG, x, z, h);
  }
  }

  /* ───────── Máy móc chi tiết (dựng bằng hình học, không tải mô hình ngoài) ───────── */
  const MX = {
    y: mat('#f2b705', { roughness: 0.45, metalness: 0.15 }), yd: mat('#d29a00', { roughness: 0.5 }), k: mat('#26272a', { roughness: 0.7 }), kg: mat('#3a3d42', { roughness: 0.6, metalness: 0.3 }),
    chrome: mat('#dfe3e8', { metalness: 0.95, roughness: 0.18 }), w: mat('#f3f4f6', { roughness: 0.5 }), red: mat('#c62828', { roughness: 0.5 }), steelG: mat('#8b929b', { metalness: 0.6, roughness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: '#2b3f55', roughness: 0.05, metalness: 0.7, transparent: true, opacity: 0.82 }), light: mat('#fff7d6', { emissive: '#fff1b0', emissiveIntensity: 0.4 }),
    tread: mat('#ffffff', { map: rep(canvasTex(128, 32, (g, w, h) => { g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, w, h); g.fillStyle = '#303030'; for (let x = 0; x < w; x += 10) { g.fillRect(x, 0, 4, h / 2 - 2); g.fillRect(x + 5, h / 2 + 2, 4, h / 2 - 2); } }), 10, 1), roughness: 0.95 }),
    shoe: mat('#ffffff', { map: rep(canvasTex(64, 32, (g, w, h) => { g.fillStyle = '#2b2b2b'; g.fillRect(0, 0, w, h); g.fillStyle = '#505050'; for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 5, h); g.fillStyle = '#1c1c1c'; for (let x = 0; x < w; x += 8) g.fillRect(x + 5, 0, 1, h); }), 18, 1), roughness: 0.8, metalness: 0.3 }),
    decal: txt => { const m = new THREE.MeshBasicMaterial({ map: canvasTex(512, 96, g => { g.fillStyle = '#111'; g.font = '900 64px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 256, 50); }), transparent: true }); MATS.push(m); return m; },
  };
  MATS.push(MX.glass);
  function rr(p, w, h, r, cx = 0, cy = 0) { const x = cx - w / 2, y = cy - h / 2; p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r); p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h); p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r); p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y); return p; }
  const shapeRR = (w, h, r) => rr(new THREE.Shape(), w, h, r);
  // Đùn hình 2D thành khối. side=true: trục x của hình thành hướng tiến (z) của máy, bề dày nằm ngang (x).
  function ext(shape, depth, material, parent, { x = 0, y = 0, z = 0, side = false, bevel = 0, rx = 0, ry = 0, rz = 0 } = {}) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 12 }); g.translate(0, 0, -depth / 2);
    if (side) g.rotateY(-Math.PI / 2);
    const m = new THREE.Mesh(g, material); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  // Hình nhìn từ trên (mặt bằng) đùn lên theo chiều cao: điểm (px, pz) của mặt bằng.
  function planExt(pts, h, material, parent, y = 0, bevel = 0) { const s = new THREE.Shape(); pts.forEach(([px, pz], i) => (i ? s.lineTo(px, -pz) : s.moveTo(px, -pz))); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2 }); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, material); m.position.y = y; m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
  const arcPts = (cx, cz, r, a0, a1, n = 10) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; });
  // Xi lanh thủy lực giữa hai điểm (trong cùng hệ toạ độ cha): ống vàng + cần mạ crôm.
  function hyd(parent, a, b, r = 0.09, barrelMat = MX.y) {
    const dir = b.clone().sub(a), len = dir.length(), q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), dir.clone().normalize());
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len * 0.58, 14), barrelMat); barrel.position.copy(a).addScaledVector(dir, 0.29); barrel.quaternion.copy(q);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, len * 0.48, 10), MX.chrome); rod.position.copy(a).addScaledVector(dir, 0.76); rod.quaternion.copy(q);
    for (const m of [barrel, rod]) { m.castShadow = true; parent.add(m); } return { barrel, rod };
  }
  function tube(parent, pts, r, material, closed = false) { const c = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.1); const m = new THREE.Mesh(new THREE.TubeGeometry(c, 24, r, 8, closed), material); m.castShadow = true; parent.add(m); return m; }
  function gear(r, teeth, depth, material, parent, pos) { const s = new THREE.Shape(); for (let i = 0; i < teeth * 2; i += 1) { const a = (i / (teeth * 2)) * Math.PI * 2, rr2 = i % 2 ? r * 0.82 : r; const p = [Math.cos(a) * rr2, Math.sin(a) * rr2]; if (i) s.lineTo(...p); else s.moveTo(...p); } s.closePath(); const m = ext(s, depth, material, parent, { side: false, ry: Math.PI / 2 }); m.position.copy(pos); return m; }
  // Bánh xe; `sink` gom lốp + mâm để quay theo quãng đường khi xe chạy.
  function tyre(parent, x, y, z, r, w, twin = false, sink = null) {
    for (const o of twin ? [-w * 0.55, w * 0.55] : [0]) {
      const ty = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 28, 1, false), [MX.tread, MX.k, MX.k]); ty.rotation.z = Math.PI / 2; ty.position.set(x + o, y, z); ty.castShadow = true; parent.add(ty);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 16), MX.steelG); rim.rotation.z = Math.PI / 2; rim.position.copy(ty.position); parent.add(rim);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, w + 0.06, 8), MX.k); hub.rotation.z = Math.PI / 2; hub.position.copy(ty.position); parent.add(hub);
      if (sink) sink.push({ m: ty, r }, { m: rim, r });
    }
  }
  // Dải xích: vòng xích rỗng + khung, bánh sao, bánh dẫn hướng, con lăn.
  function trackUnit(parent, x, len, h, w) {
    const loop = shapeRR(len, h, h / 2); loop.holes.push(rr(new THREE.Path(), len - 0.26, h - 0.26, (h - 0.26) / 2)); ext(loop, w, MX.shoe, parent, { x, y: h / 2, side: true });
    ext(shapeRR(len - 0.9, h * 0.42, 0.08), w * 0.7, MX.k, parent, { x, y: h / 2, side: true });
    gear(h / 2 - 0.1, 11, w * 0.5, MX.kg, parent, v3(x, h / 2, -len / 2 + h / 2)); const id = cyl(h / 2 - 0.14, h / 2 - 0.14, w * 0.5, MX.kg, x, h / 2, len / 2 - h / 2, parent, 18); id.rotation.z = Math.PI / 2;
    for (let i = 0; i < 6; i += 1) { const r = cyl(0.11, 0.11, w * 0.55, MX.kg, x, 0.24, -len / 2 + h * 0.75 + i * (len - h * 1.5) / 5, parent, 10); r.rotation.z = Math.PI / 2; }
    for (const zz of [-len * 0.18, len * 0.18]) { const r = cyl(0.08, 0.08, w * 0.5, MX.kg, x, h - 0.2, zz, parent, 10); r.rotation.z = Math.PI / 2; }
  }
  // Cabin: khung tối + kính 3 mặt + mái.
  function cabin(parent, x, y, z, w, h, l, frameMat = MX.k, roofMat = MX.y) {
    boxM(w, h, l, frameMat, x, y + h / 2, z, parent);
    boxM(0.02, h * 0.62, l * 0.82, MX.glass, x - w / 2 - 0.011, y + h * 0.6, z, parent, false); boxM(0.02, h * 0.62, l * 0.82, MX.glass, x + w / 2 + 0.011, y + h * 0.6, z, parent, false);
    const ws = boxM(w * 0.86, h * 0.7, 0.02, MX.glass, x, y + h * 0.58, z + l / 2 + 0.011, parent, false); ws.rotation.x = -0.08; boxM(w * 0.86, h * 0.45, 0.02, MX.glass, x, y + h * 0.6, z - l / 2 - 0.011, parent, false);
    boxM(w + 0.06, 0.07, l + 0.06, roofMat, x, y + h + 0.035, z, parent);
  }

  function excavator() { // máy xúc bánh xích ~20 tấn (loại PC200): cần cong, tay gầu, gầu có răng, 4 xi lanh
    const g = new THREE.Group();
    for (const s of [-1, 1]) trackUnit(g, s * 1.1, 4.45, 0.92, 0.6);
    boxM(1.5, 0.45, 2.3, MX.k, 0, 0.8, 0, g); cyl(0.95, 0.95, 0.18, MX.kg, 0, 1.08, 0, g, 28);
    const up = new THREE.Group(); up.position.y = 1.17; g.add(up);
    planExt([[-1.32, 1.65], [1.32, 1.65], [1.32, -1.35], ...arcPts(0, -1.35, 1.32, 0, -Math.PI, 14).slice(1)], 0.28, MX.yd, up, 0); // sàn quay
    planExt([[-1.3, -1.25], [1.3, -1.25], ...arcPts(0, -1.25, 1.3, 0, -Math.PI, 14).slice(1, -1)], 1.0, MX.yd, up, 0.28, 0.03); // đối trọng bo tròn
    ext(shapeRR(1.6, 0.95, 0.18), 1.55, MX.y, up, { x: 0.52, y: 0.75, z: -0.45, side: true, bevel: 0.02 }); // nắp máy
    for (let i = 0; i < 6; i += 1) boxM(0.9, 0.02, 0.05, MX.k, 0.6, 1.24, -0.95 + i * 0.12, up, false); // lá tản nhiệt
    cyl(0.07, 0.07, 0.75, MX.k, 0.95, 1.55, -0.65, up, 10); boxM(1.0, 0.85, 1.2, MX.y, 0.78, 0.7, 1.0, up); // ống xả, thùng dầu thuỷ lực
    cabin(up, -0.78, 0.28, 0.95, 0.98, 1.62, 1.55, MX.k, MX.y);
    tube(up, [v3(0.3, 1.15, 1.6), v3(0.3, 1.15, 0.45), v3(1.25, 1.15, 0.45)], 0.025, MX.k); // tay vịn
    const dec = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.28), MX.decal('TIẾN THỊNH')); dec.position.set(0, 0.85, -2.57); dec.rotation.y = Math.PI; up.add(dec);
    const boom = new THREE.Group(); boom.position.set(0.12, 1.05, 1.25); up.add(boom);
    const bs = new THREE.Shape(); bs.moveTo(0, 0.32); bs.quadraticCurveTo(1.9, 1.15, 3.2, 1.0); bs.quadraticCurveTo(4.9, 0.62, 5.75, 0.22); bs.lineTo(5.75, -0.22); bs.quadraticCurveTo(4.8, 0.12, 3.2, 0.42); bs.quadraticCurveTo(1.7, 0.55, 0.15, -0.38); bs.closePath();
    ext(bs, 0.5, MX.y, boom, { side: true });
    for (const s of [-1, 1]) hyd(boom, v3(s * 0.38, -0.85, 0.35), v3(s * 0.33, 0.25, 2.55), 0.1);
    hyd(boom, v3(0, 1.0, 2.35), v3(0, 0.62, 5.45), 0.085);
    const stick = new THREE.Group(); stick.position.set(0, 0, 5.75); boom.add(stick);
    const ss = new THREE.Shape(); ss.moveTo(-0.55, 0.42); ss.lineTo(0.2, 0.36); ss.lineTo(2.95, 0.17); ss.lineTo(2.95, -0.17); ss.lineTo(0.2, -0.33); ss.lineTo(-0.45, 0.05); ss.closePath(); ext(ss, 0.42, MX.y, stick, { side: true });
    hyd(stick, v3(0, 0.45, -0.3), v3(0, 0.3, 2.5), 0.07);
    const bucket = new THREE.Group(); bucket.position.set(0, 0, 2.95); stick.add(bucket);
    const bk = new THREE.Shape(); bk.moveTo(-0.1, 0.22); bk.lineTo(0.35, 0.32); bk.quadraticCurveTo(1.15, 0.12, 1.08, -0.62); bk.lineTo(0.88, -0.6); bk.quadraticCurveTo(0.78, -0.02, 0.0, -0.18); bk.closePath();
    ext(bk, 1.0, MX.kg, bucket, { side: true });
    for (let i = 0; i < 5; i += 1) { const tt = boxM(0.08, 0.06, 0.22, MX.steelG, -0.4 + i * 0.2, -0.66, 1.0, bucket); tt.rotation.x = 0.5; }
    boom.rotation.x = -0.32; stick.rotation.x = 1.45; bucket.rotation.x = 0.6;
    g.userData.anim = tt => { up.rotation.y = Math.sin(tt * 0.33) * 0.85; boom.rotation.x = -0.32 + Math.sin(tt * 0.66) * 0.16; stick.rotation.x = 1.45 + Math.sin(tt * 0.66 + 1) * 0.32; bucket.rotation.x = 0.6 + Math.sin(tt * 0.66 + 2.1) * 0.55; };
    return g;
  }

  function mobileCrane(loadLen = 10) { // ô tô cẩu 25 tấn: 4 trục, chân chống chữ H, cần ống lồng 4 đoạn, xi lanh nâng cần, móc + dầm thép
    const g = new THREE.Group();
    boxM(1.0, 0.5, 11.2, MX.k, 0, 1.0, -0.2, g);
    for (const [z, twin] of [[4.55, false], [3.15, false], [-2.7, true], [-4.05, true]]) for (const s of [-1, 1]) tyre(g, s * 1.02, 0.55, z, 0.55, 0.38, twin);
    for (const z of [3.85, -3.4]) for (const s of [-1, 1]) boxM(0.62, 0.12, 2.3, MX.y, s * 1.02, 1.25, z, g);
    boxM(2.5, 0.35, 8.3, MX.y, 0, 1.45, -0.9, g); // sàn xe
    const cab = new THREE.Group(); cab.position.set(0, 1.25, 5.7); g.add(cab);
    const cs = new THREE.Shape(); cs.moveTo(-1.0, 0); cs.lineTo(1.0, 0); cs.lineTo(1.0, 0.85); cs.lineTo(0.65, 1.95); cs.lineTo(-1.0, 1.95); cs.closePath(); ext(cs, 2.5, MX.w, cab, { side: true, bevel: 0.02 });
    const wsh = boxM(2.3, 1.05, 0.02, MX.glass, 0, 1.42, 0.86, cab, false); wsh.rotation.x = -0.31;
    for (const s of [-1, 1]) { boxM(0.02, 0.75, 1.1, MX.glass, s * 1.27, 1.45, -0.2, cab, false); boxM(0.06, 0.32, 0.18, MX.k, s * 1.45, 1.6, 0.6, cab); tube(cab, [v3(s * 1.25, 1.75, 0.5), v3(s * 1.42, 1.78, 0.55)], 0.02, MX.k); }
    boxM(1.6, 0.42, 0.04, MX.k, 0, 0.45, 1.02, cab); for (const s of [-1, 1]) boxM(0.32, 0.16, 0.04, MX.light, s * 0.95, 0.55, 1.03, cab); boxM(2.5, 0.25, 0.25, MX.kg, 0, 0.12, 1.05, cab);
    for (const z of [2.35, -5.25]) for (const s of [-1, 1]) { boxM(2.4, 0.38, 0.42, MX.y, s * 2.3, 1.15, z, g); hyd(g, v3(s * 3.45, 1.0, z), v3(s * 3.45, 0.18, z), 0.12); boxM(0.8, 0.12, 0.8, MX.k, s * 3.45, 0.1, z, g); boxM(1.1, 0.1, 1.1, M.wood, s * 3.45, 0.05, z, g); }
    const sup = new THREE.Group(); sup.position.set(0, 1.62, -1.6); g.add(sup);
    cyl(1.15, 1.15, 0.3, MX.kg, 0, 0.15, 0, sup, 28); boxM(2.4, 0.55, 3.8, MX.y, 0, 0.55, -0.4, sup);
    boxM(2.4, 1.0, 1.0, MX.kg, 0, 1.0, -2.3, sup); boxM(2.42, 0.08, 1.02, MX.y, 0, 1.52, -2.3, sup); // đối trọng
    const drum = cyl(0.42, 0.42, 1.5, MX.k, 0, 1.25, -1.35, sup, 18); drum.rotation.z = Math.PI / 2; for (const s of [-1, 1]) boxM(0.08, 1.0, 1.0, MX.y, s * 0.82, 1.05, -1.35, sup);
    cabin(sup, -1.25, 0.6, 1.1, 0.85, 1.45, 1.7, MX.w, MX.y);
    const boom = new THREE.Group(); boom.position.set(0.15, 1.45, -1.9); sup.add(boom); const ELEV = -0.98; boom.rotation.x = ELEV;
    const secs = [[0.95, 1.05, 10.5], [0.8, 0.9, 9.6], [0.66, 0.76, 9.0], [0.54, 0.62, 8.4]]; let z = 0;
    secs.forEach(([w, h, l], i) => { ext(shapeRR(w, h, 0.12), l, i % 2 ? MX.w : MX.y, boom, { z: z + l / 2 }); if (i === 0) { const dcl = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.42), MX.decal('TIẾN THỊNH 25T')); dcl.position.set(w / 2 + 0.01, 0, 4); dcl.rotation.y = Math.PI / 2; boom.add(dcl); } z += i < secs.length - 1 ? l * 0.84 : l; });
    const tipZ = z; boxM(0.5, 0.75, 0.9, MX.y, 0, -0.1, tipZ + 0.2, boom); for (const xx of [-0.12, 0.12]) { const sh = cyl(0.32, 0.32, 0.08, MX.kg, xx, -0.15, tipZ + 0.45, boom, 16); sh.rotation.z = Math.PI / 2; }
    const footW = v3(0, 0.65, 0.9), onBoom = v3(0, -0.55, 4.6).applyAxisAngle(v3(1, 0, 0), ELEV).add(boom.position); hyd(sup, footW, onBoom, 0.2);
    const tipLocal = v3(0, -0.45, tipZ + 0.45);
    const hook = new THREE.Group(); scene.add(hook);
    const falls = [-0.12, 0.12].map(xx => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 5), MX.k); c.position.x = xx; hook.add(c); return c; });
    const block = new THREE.Group(); hook.add(block); boxM(0.55, 0.8, 0.32, MX.y, 0, -0.4, 0, block); const sv = cyl(0.22, 0.22, 0.36, MX.kg, 0, -0.15, 0, block, 14); sv.rotation.x = Math.PI / 2;
    const hk = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 8, 16, Math.PI * 1.4), MX.kg); hk.position.set(0, -1.0, 0); hk.rotation.z = Math.PI * 0.8; block.add(hk);
    const load = new THREE.Mesh(member(iShape(0.5, 0.22, 0.012, 0.02), loadLen), M.steelRed); load.castShadow = true; block.add(load); load.position.y = -3.0;
    for (const s of [-1, 1]) tube(block, [v3(0, -1.05, 0), v3(0, -2.75, s * loadLen * 0.32)], 0.015, MX.k);
    const tip = v3(0, 0, 0);
    const pose = tt => { sup.rotation.y = 0.45 + Math.sin(tt * 0.17) * 0.5; g.updateMatrixWorld(true); tip.copy(tipLocal); boom.localToWorld(tip);
      const drop = 7 + Math.sin(tt * 0.28) * 3; hook.position.copy(tip); for (const f of falls) { f.scale.y = drop; f.position.y = -drop / 2; } block.position.y = -drop; block.rotation.y = sup.rotation.y + g.rotation.y; };
    g.userData.anim = pose; g.userData.pose = pose;
    g.userData.hook = hook; return g;
  }

  function roller() { // xe lu rung một bánh thép (loại 12 tấn)
    const g = new THREE.Group();
    const drum = cyl(0.76, 0.76, 2.13, MX.steelG, 0, 0.76, 1.75, g, 32); drum.rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) { boxM(0.18, 1.1, 1.9, MX.y, s * 1.17, 1.02, 1.75, g); cyl(0.3, 0.3, 0.05, MX.k, s * 1.27, 0.76, 1.75, g, 16).rotation.z = Math.PI / 2; }
    boxM(2.5, 0.22, 1.9, MX.y, 0, 1.62, 1.75, g); boxM(0.9, 0.5, 0.6, MX.k, 0, 1.2, 0.45, g); // khung trước + khớp
    const hood = new THREE.Shape(); hood.moveTo(-1.6, 0); hood.lineTo(1.1, 0); hood.lineTo(1.1, 0.8); hood.quadraticCurveTo(0.9, 1.15, 0.4, 1.15); hood.lineTo(-1.35, 1.15); hood.quadraticCurveTo(-1.6, 1.1, -1.6, 0.8); hood.closePath();
    ext(hood, 1.95, MX.y, g, { y: 0.75, z: -1.1, side: true, bevel: 0.03 });
    for (const s of [-1, 1]) tyre(g, s * 0.95, 0.72, -1.55, 0.72, 0.6);
    boxM(0.55, 0.12, 0.55, MX.k, 0, 2.0, -0.25, g); boxM(0.5, 0.55, 0.12, MX.k, 0, 2.3, -0.5, g); const sw = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 6, 16), MX.k); sw.position.set(0, 2.45, 0.2); sw.rotation.x = -0.9; g.add(sw);
    for (const x of [-0.75, 0.75]) for (const zz of [0.4, -0.9]) cyl(0.045, 0.045, 1.6, MX.k, x, 2.75, zz, g, 8);
    boxM(1.65, 0.1, 1.6, MX.y, 0, 3.58, -0.25, g);
    const dec = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.22), MX.decal('TIẾN THỊNH')); dec.position.set(1.0, 1.4, -1.1); dec.rotation.y = Math.PI / 2; g.add(dec);
    g.userData.anim = tt => { drum.rotation.x = tt * 1.5; }; return g;
  }

  function dozer() { // máy ủi bánh xích
    const g = new THREE.Group(); for (const s of [-1, 1]) trackUnit(g, s * 1.0, 3.6, 1.0, 0.55);
    boxM(1.45, 0.6, 2.9, MX.k, 0, 0.95, -0.1, g);
    const hood = new THREE.Shape(); hood.moveTo(-0.6, 0); hood.lineTo(2.0, 0); hood.lineTo(2.0, 0.95); hood.lineTo(-0.6, 1.05); hood.closePath(); ext(hood, 1.5, MX.y, g, { y: 1.25, z: 0.1, side: true, bevel: 0.03 });
    for (let i = 0; i < 6; i += 1) boxM(1.3, 0.04, 0.03, MX.k, 0, 1.45 + i * 0.12, 2.15, g, false);
    cabin(g, 0, 1.35, -0.9, 1.5, 1.45, 1.3, MX.k, MX.y); boxM(1.9, 0.9, 1.4, MX.y, 0, 1.6, -0.9, g);
    const bl = new THREE.Shape(); bl.moveTo(0, 0); bl.quadraticCurveTo(0.55, 0.65, 0.12, 1.25); bl.lineTo(0.0, 1.25); bl.quadraticCurveTo(0.4, 0.62, -0.12, 0.02); bl.closePath();
    ext(bl, 3.5, MX.y, g, { y: 0.05, z: 2.35, side: true }); boxM(3.5, 0.08, 0.2, MX.steelG, 0, 0.05, 2.4, g);
    for (const s of [-1, 1]) { const a = boxM(0.18, 0.22, 2.0, MX.y, s * 1.35, 0.6, 1.3, g); a.rotation.x = -0.08; hyd(g, v3(s * 0.6, 2.0, 1.95), v3(s * 0.9, 1.1, 2.35), 0.08); }
    boxM(1.6, 0.25, 0.25, MX.y, 0, 1.0, -2.0, g); const sh = boxM(0.14, 1.1, 0.35, MX.kg, 0, 0.55, -2.3, g); sh.rotation.x = 0.35;
    return g;
  }

  // Ô tô tải ben 3 trục: cabin, thùng ben nâng quanh bản lề sau (đổ hàng), tải vật liệu trong thùng khi đi vào.
  function dumpTruck(color = M.blue) {
    const g = new THREE.Group(), wheels = []; boxM(0.95, 0.35, 7.6, MX.k, 0, 1.0, -0.2, g);
    const cab = new THREE.Group(); cab.position.set(0, 1.2, 3.1); g.add(cab);
    const cs = new THREE.Shape(); cs.moveTo(-0.9, 0); cs.lineTo(0.9, 0); cs.lineTo(0.9, 1.0); cs.lineTo(0.75, 1.95); cs.lineTo(-0.9, 2.0); cs.closePath(); ext(cs, 2.4, color, cab, { side: true, bevel: 0.02 });
    const ws = boxM(2.2, 0.9, 0.02, MX.glass, 0, 1.45, 0.83, cab, false); ws.rotation.x = -0.15; for (const s of [-1, 1]) { boxM(0.02, 0.7, 1.0, MX.glass, s * 1.22, 1.45, 0, cab, false); boxM(0.05, 0.35, 0.15, MX.k, s * 1.35, 1.55, 0.7, cab); }
    boxM(1.5, 0.5, 0.04, MX.kg, 0, 0.5, 0.93, cab); for (const s of [-1, 1]) boxM(0.3, 0.15, 0.04, MX.light, s * 0.92, 0.38, 0.94, cab); boxM(2.4, 0.25, 0.22, MX.kg, 0, 0.1, 0.95, cab);
    const hinge = new THREE.Group(); hinge.position.set(0, 1.3, -4.1); g.add(hinge);
    const bed = new THREE.Group(); bed.position.set(0, 0, 2.5); hinge.add(bed);
    boxM(2.4, 0.18, 5.0, MX.kg, 0, 0, 0, bed); for (const s of [-1, 1]) { boxM(0.08, 1.15, 5.0, M.grey, s * 1.18, 0.65, 0, bed); for (let i = 0; i < 6; i += 1) boxM(0.06, 1.15, 0.12, MX.kg, s * 1.24, 0.65, -2.3 + i * 0.92, bed); }
    boxM(2.4, 1.6, 0.1, M.grey, 0, 0.85, 2.48, bed); boxM(2.4, 1.15, 0.1, M.grey, 0, 0.65, -2.48, bed); boxM(2.5, 0.12, 0.6, M.grey, 0, 1.65, 2.7, bed);
    const cargo = mesh(new THREE.BoxGeometry(2.2, 0.75, 4.7), M.gravel, 0, 0.5, 0, bed); cargo.scale.y = 1;
    const heap = mesh(new THREE.ConeGeometry(1.5, 0.6, 16), M.gravel, 0, 1.15, 0, bed); heap.scale.set(1, 1, 1.9);
    tyre(g, -1.02, 0.52, 3.1, 0.52, 0.34, false, wheels); tyre(g, 1.02, 0.52, 3.1, 0.52, 0.34, false, wheels); for (const z of [-1.5, -2.8]) for (const s of [-1, 1]) tyre(g, s * 1.0, 0.52, z, 0.52, 0.3, true, wheels);
    const ft = cyl(0.3, 0.3, 0.9, M.lightGrey, -0.85, 0.85, 1.2, g, 14); ft.rotation.x = Math.PI / 2;
    g.userData.wheels = wheels;
    g.userData.setLoad = on => { cargo.visible = on; heap.visible = on; };
    g.userData.tilt = f => { hinge.rotation.x = -0.82 * f; };
    return g;
  }

  function mixerTruck() { // xe bồn trộn: bồn quay sọc, phễu nạp, máng xả, thang, bình nước
    const g = new THREE.Group(), wheels = []; boxM(0.95, 0.35, 8.0, MX.k, 0, 1.0, 0, g);
    const cab = new THREE.Group(); cab.position.set(0, 1.2, 3.5); g.add(cab);
    const cs = new THREE.Shape(); cs.moveTo(-0.9, 0); cs.lineTo(0.9, 0); cs.lineTo(0.9, 1.0); cs.lineTo(0.75, 1.95); cs.lineTo(-0.9, 2.0); cs.closePath(); ext(cs, 2.4, MX.w, cab, { side: true, bevel: 0.02 });
    const ws = boxM(2.2, 0.9, 0.02, MX.glass, 0, 1.45, 0.83, cab, false); ws.rotation.x = -0.15; for (const s of [-1, 1]) boxM(0.02, 0.7, 1.0, MX.glass, s * 1.22, 1.45, 0, cab, false);
    const drum = new THREE.Group(); drum.position.set(0, 2.55, -0.9); drum.rotation.x = 0.2; g.add(drum);
    const pts = []; for (let i = 0; i <= 14; i += 1) { const f = i / 14; pts.push(new THREE.Vector2(0.35 + Math.sin(f * Math.PI) * 1.2 + (1 - f) * 0.2, -2.7 + f * 5.4)); }
    const dm = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), M.mixer); dm.rotation.x = Math.PI / 2; dm.castShadow = true; drum.add(dm);
    for (const s of [-1, 1]) boxM(0.12, 1.2, 0.3, MX.kg, s * 1.0, 1.6, -3.0, g); boxM(0.12, 1.4, 0.3, MX.kg, 0, 1.75, 1.4, g);
    const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.25, 0.6, 12, 1, true), M.grey); hop.position.set(0, 3.55, -3.7); g.add(hop);
    const ch = boxM(0.4, 0.08, 1.6, M.grey, 0, 2.2, -4.5, g); ch.rotation.x = 0.35; ch.rotation.y = 0.5;
    tube(g, [v3(0.7, 1.2, -3.8), v3(0.7, 3.6, -3.4)], 0.02, MX.k); tube(g, [v3(0.4, 1.2, -3.8), v3(0.4, 3.6, -3.4)], 0.02, MX.k);
    const wt = cyl(0.3, 0.3, 0.9, M.blue, 0.95, 2.4, 1.3, g, 14); wt.rotation.z = Math.PI / 2;
    tyre(g, -1.02, 0.52, 3.4, 0.52, 0.34, false, wheels); tyre(g, 1.02, 0.52, 3.4, 0.52, 0.34, false, wheels); for (const z of [-1.5, -2.8]) for (const s of [-1, 1]) tyre(g, s * 1.0, 0.52, z, 0.52, 0.3, true, wheels);
    g.userData.wheels = wheels;
    g.userData.anim = tt => { dm.rotation.y = tt * 2.2; }; return g;
  }

  function pumpTruck() { // xe bơm cần: chân chống, cần 4 khúc có xi lanh, ống bê tông dọc cần, vòi mềm, phễu sau
    const g = new THREE.Group(); boxM(1.0, 0.4, 10.4, MX.k, 0, 1.05, 0, g);
    const cab = new THREE.Group(); cab.position.set(0, 1.25, 4.4); g.add(cab);
    const cs = new THREE.Shape(); cs.moveTo(-0.9, 0); cs.lineTo(0.9, 0); cs.lineTo(0.9, 1.0); cs.lineTo(0.75, 1.95); cs.lineTo(-0.9, 2.0); cs.closePath(); ext(cs, 2.4, MX.w, cab, { side: true, bevel: 0.02 });
    const ws = boxM(2.2, 0.9, 0.02, MX.glass, 0, 1.45, 0.83, cab, false); ws.rotation.x = -0.15;
    boxM(2.45, 1.1, 3.4, MX.w, 0, 1.85, -2.4, g); boxM(2.45, 0.08, 3.4, MX.red, 0, 2.42, -2.4, g);
    const hp = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.45, 0.7, 4, 1, true), M.grey); hp.position.set(0, 1.7, -5.0); hp.rotation.y = Math.PI / 4; g.add(hp);
    for (const z of [3.0, 1.5, -1.8, -3.3]) for (const s of [-1, 1]) tyre(g, s * 1.02, 0.52, z, 0.52, 0.34, z < 0);
    for (const [s, front] of [[-1, 1], [1, 1], [-1, 0], [1, 0]]) { const leg = boxM(3.0, 0.3, 0.3, MX.w, 0, 0.9, 0, g); const ang = front ? s * 0.6 : s * -0.25; leg.position.set(s * 1.6 + (front ? s * 0.2 : s * 0.1), 0.9, front ? 2.6 : -3.6); leg.rotation.y = front ? -ang : ang;
      const fx = leg.position.x + Math.cos(leg.rotation.y) * 1.4 * s, fz = leg.position.z - Math.sin(leg.rotation.y) * 1.4 * s; hyd(g, v3(fx, 0.85, fz), v3(fx, 0.12, fz), 0.1, MX.w); boxM(0.7, 0.1, 0.7, M.wood, fx, 0.05, fz, g); }
    const turret = new THREE.Group(); turret.position.set(0, 2.5, 1.2); g.add(turret); cyl(0.75, 0.75, 0.9, MX.w, 0, 0.45, 0, turret, 20); boxM(0.6, 1.0, 0.8, MX.red, 0, 1.2, 0, turret);
    const segs = [[8.5, -1.05], [8, 1.0], [7.2, 0.7], [6.2, 0.95]]; let parent = turret, off = v3(0, 1.4, 0);
    segs.forEach(([len, ang], i) => { const s = new THREE.Group(); s.position.copy(off); s.rotation.x = ang; parent.add(s); ext(shapeRR(0.48 - i * 0.06, 0.55 - i * 0.07, 0.06), len, i % 2 ? MX.red : MX.w, s, { z: len / 2 });
      const p = cyl(0.085, 0.085, len, MX.steelG, 0.32 - i * 0.03, -0.1, len / 2, s, 10); p.rotation.x = Math.PI / 2; hyd(s, v3(0, -0.45, 0.6), v3(0, -0.4, len * 0.42), 0.08 - i * 0.008, MX.w); parent = s; off = v3(0, 0, len); });
    tube(parent, [v3(0.25, 0, 6.2), v3(0.3, -1.2, 6.4), v3(0.25, -3.2, 6.3)], 0.1, MX.k);
    g.userData.anim = tt => { turret.rotation.y = Math.PI + Math.sin(tt * 0.2) * 0.35; }; return g;
  }

  function rammer() { // đầm cóc
    const g = new THREE.Group(); boxM(0.34, 0.06, 0.28, MX.k, 0, 0.03, 0, g);
    const bel = []; for (let i = 0; i <= 10; i += 1) bel.push(new THREE.Vector2(0.11 + (i % 2) * 0.03, 0.06 + i * 0.035)); g.add(new THREE.Mesh(new THREE.LatheGeometry(bel, 14), MX.k));
    cyl(0.09, 0.09, 0.35, M.orange, 0, 0.6, 0, g, 12); boxM(0.32, 0.26, 0.3, M.orange, 0, 0.88, -0.05, g); boxM(0.24, 0.14, 0.2, MX.red, 0, 1.08, -0.06, g);
    tube(g, [v3(-0.18, 0.85, -0.1), v3(-0.2, 1.05, -0.55), v3(0, 1.12, -0.7), v3(0.2, 1.05, -0.55), v3(0.18, 0.85, -0.1)], 0.018, MX.k);
    g.userData.anim = tt => { g.position.y = Math.abs(Math.sin(tt * 22)) * 0.05; }; return g;
  }

  // Xe con / xe khách đi trên đường lớn (bật Chuyển động).
  function car(color, van = false) {
    const g = new THREE.Group(), wheels = [], paint = mat(color, { metalness: 0.45, roughness: 0.35 });
    const s = new THREE.Shape();
    if (van) { s.moveTo(-2.5, 0.35); s.lineTo(2.5, 0.35); s.lineTo(2.55, 1.1); s.lineTo(2.1, 2.1); s.lineTo(-2.5, 2.15); s.closePath(); }
    else { s.moveTo(-2.25, 0.32); s.lineTo(2.25, 0.32); s.lineTo(2.3, 0.85); s.lineTo(1.3, 1.0); s.lineTo(0.65, 1.45); s.lineTo(-1.15, 1.45); s.lineTo(-1.9, 1.0); s.lineTo(-2.3, 0.92); s.closePath(); }
    ext(s, 1.78, paint, g, { side: true, bevel: 0.04 });
    if (van) { boxM(1.82, 0.7, 0.02, MX.glass, 0, 1.55, 2.25, g, false); for (const sd of [-1, 1]) boxM(0.02, 0.6, 3.6, MX.glass, sd * 0.93, 1.55, -0.2, g, false); }
    else { const w2 = boxM(1.6, 0.5, 0.02, MX.glass, 0, 1.2, 1.0, g, false); w2.rotation.x = -0.75; for (const sd of [-1, 1]) boxM(0.02, 0.36, 1.6, MX.glass, sd * 0.91, 1.2, -0.25, g, false); }
    for (const sd of [-1, 1]) boxM(0.34, 0.14, 0.04, MX.light, sd * 0.62, 0.68, van ? 2.56 : 2.31, g, false);
    for (const z of van ? [1.65, -1.75] : [1.4, -1.4]) for (const sd of [-1, 1]) tyre(g, sd * 0.84, 0.34, z, 0.34, 0.24, false, wheels);
    g.userData.wheels = wheels; return g;
  }

  /* ───────── Vật tư theo sổ kho công trường (tồn theo sổ) ───────── */
  const stacks = [];
  function stockOf(re) { return DATA.stock.filter(([n]) => re.test(n)); }
  function stackLabel(g, ttl, rows) { g.traverse(o => { if (o.isMesh) o.userData.stock = { title: ttl, rows }; }); stacks.push(g); }
  function rebarRack(x, z, items) { // giá kê thép cây 11,7 m, mỗi bó một loại đường kính
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
    for (const zz of [-4.5, -1.5, 1.5, 4.5]) boxM(3.6, 0.25, 0.25, M.wood, 0, 0.12, zz, g);
    items.slice(0, 8).forEach(([name, , qty], i) => { const dmm = Number((name.match(/D(\d+)/) || [])[1] || 12) / 1000, r = Math.max(0.012, dmm * 0.9), n = Math.min(60, Math.max(10, Math.round(Math.sqrt(Math.max(0, qty)) * 0.9)));
      const bars = new THREE.InstancedMesh(new THREE.CylinderGeometry(r, r, 11.7, 5).rotateX(Math.PI / 2), M.steel, n); const per = Math.ceil(Math.sqrt(n));
      for (let j = 0; j < n; j += 1) bars.setMatrixAt(j, mtx(-1.5 + (i % 4) * 0.95 + (j % per) * r * 2.4, 0.25 + Math.floor(i / 4) * 0.5 + Math.floor(j / per) * r * 2.2, 0)); bars.castShadow = true; g.add(bars); });
    stackLabel(g, 'Thép xây dựng (cây 11,7 m)', items); return g;
  }
  function palletStack(x, z, material, nx, ny, nz, bw, bh, bd, ttl, rows, gap = 0.04) {
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
    const n = nx * ny * nz, im = new THREE.InstancedMesh(new THREE.BoxGeometry(bw, bh, bd), material, n); let i = 0;
    for (let a = 0; a < nx; a += 1) for (let b = 0; b < ny; b += 1) for (let c = 0; c < nz; c += 1) im.setMatrixAt(i++, mtx((a - (nx - 1) / 2) * (bw + gap), 0.15 + bh / 2 + b * (bh + gap), (c - (nz - 1) / 2) * (bd + gap)));
    im.castShadow = true; im.receiveShadow = true; g.add(im); boxM(nx * (bw + gap) + 0.1, 0.14, nz * (bd + gap) + 0.1, M.wood, 0, 0.07, 0, g); stackLabel(g, ttl, rows); return g;
  }
  function pile(x, z, r, h, material, ttl, rows) { const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g); mesh(new THREE.ConeGeometry(r, h, 28, 1), material, 0, h / 2, 0, g); stackLabel(g, ttl, rows); return g; }
  function profileStack(x, z, shape, len, nx, ny, material, ttl, rows, sx = 0.12, sy = 0.08) {
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g); const geo = member(shape, len); const im = new THREE.InstancedMesh(geo, material, nx * ny); let i = 0;
    for (let a = 0; a < nx; a += 1) for (let b = 0; b < ny; b += 1) im.setMatrixAt(i++, mtx((a - nx / 2) * sx, 0.3 + b * sy, 0)); im.castShadow = true; g.add(im);
    for (const zz of [-len / 3, len / 3]) boxM(nx * sx + 0.3, 0.2, 0.2, M.wood, -sx / 2, 0.1, zz, g); stackLabel(g, ttl, rows); return g;
  }
  if (SITE_KEY === 'SMB') {
    const R = re => stockOf(re);
    // Bãi vật tư: dải đất giữa đường trước nhà văn phòng (x −76) và đường dọc xưởng 1 (x −59), từ z 2 tới 30 (chỗ bãi đỗ xe khi hoàn thiện).
    const Y = (ox, oz) => [-72 + (oz - 21), 2 + (ox - 4)];
    rebarRack(...Y(8, 27), R(/^Thép XD D(1[0-9]|2[0-9]|10)/));
    profileStack(...Y(14, 27.5), cShape(0.2, 0.065, 0.003), 9, 10, 6, M.purlin, 'Xà gồ C mạ kẽm', R(/Xà gồ/));
    profileStack(...Y(18.5, 27.5), (() => { const sh = new THREE.Shape(); sh.moveTo(-0.025, -0.05); sh.lineTo(0.025, -0.05); sh.lineTo(0.025, 0.05); sh.lineTo(-0.025, 0.05); sh.closePath(); const h = new THREE.Path(); h.moveTo(-0.022, -0.047); h.lineTo(-0.022, 0.047); h.lineTo(0.022, 0.047); h.lineTo(0.022, -0.047); h.closePath(); sh.holes.push(h); return sh; })(), 6, 14, 6, M.purlin, 'Thép hộp mạ kẽm', R(/Thép hộp/), 0.06, 0.11);
    palletStack(...Y(23, 23), mat('#c9c6be'), 2, 4, 1, 1.0, 0.36, 2.2, 'Lưới thép hàn D8', R(/Lưới thép hàn/));
    for (let i = 0; i < 4; i += 1) palletStack(...Y(26 + (i % 2) * 2.6, 22 + Math.floor(i / 2) * 3.2), M.alc, 2, 6, 1, 0.6, 0.1, 2.0, 'Tấm ALC (100 mm)', R(/ALC/));
    for (let i = 0; i < 6; i += 1) palletStack(...Y(6 + (i % 3) * 1.6, 21.5 + Math.floor(i / 3) * 1.6), M.brick, 3, 5, 3, 0.38, 0.2, 0.36, 'Gạch xây (rỗng, đặc, 6,5×10,5)', R(/Gạch/), 0.02);
    for (let i = 0; i < 3; i += 1) palletStack(...Y(12 + i * 1.6, 21.5), M.bag, 2, 6, 3, 0.62, 0.14, 0.4, 'Xi măng PCB30 (bao 50 kg)', R(/Xi măng/), 0.02);
    pile(...Y(31, 31), 2.6, 1.9, M.sand, 'Cát xây, trát', R(/Cát/)); pile(...Y(25, 33), 3.6, 2.4, M.gravel, 'Base B (cấp phối đá dăm)', R(/Base B/));
    profileStack(...Y(20, 33.5), (() => { const sh = new THREE.Shape(); sh.absarc(0, 0, 0.04, 0, Math.PI * 2, false); return sh; })(), 2.5, 16, 5, M.bamboo, 'Cọc tre 2,5 m', R(/Cọc tre/), 0.085, 0.08);
    { const g = new THREE.Group(); g.position.set(-66, 0, 30); scene.add(g); for (let i = 0; i < 9; i += 1) { const c = cyl(0.3, 0.3, 2.4, M.pile, (i % 3) * 0.65 - 0.65, 0.3 + Math.floor(i / 3) * 0.56, 0, g, 16); c.rotation.x = Math.PI / 2; } stackLabel(g, 'Cống bi D400 + đế cống', R(/ống|Đế cống/)); }
    palletStack(...Y(16, 33.5), M.foil, 1, 8, 1, 1.0, 0.1, 2.4, 'Tấm cách nhiệt', R(/cách nhiệt/));
    { const g = new THREE.Group(); g.position.set(-74.5, 0, 34.5); scene.add(g); for (let i = 0; i < 6; i += 1) cyl(0.29, 0.29, 0.88, M.drum, (i % 3) * 0.65, 0.44, Math.floor(i / 3) * 0.65, g, 14); stackLabel(g, 'Dầu Diezel / DO (phuy 200 L)', R(/Dầu/)); }
    { const g = new THREE.Group(); g.position.set(...(([x, z]) => [x, 0, z])(Y(9, 33.5))); scene.add(g); for (let i = 0; i < 6; i += 1) { const r = cyl(0.35, 0.35, 2.5, M.nylon, (i % 3) * 0.75, 0.35 + Math.floor(i / 3) * 0.7, 0, g, 14); r.rotation.z = Math.PI / 2; } stackLabel(g, 'Nilong lót nền', R(/[Nn]i ?long|Ni lông/)); }
    palletStack(...Y(4.5, 33.5), mat('#9aa0a6'), 2, 2, 2, 0.5, 0.35, 0.5, 'Bu lông móng (thùng)', R(/[Bb]u ?long móng|Bu lông móng/));
    palletStack(-71.5, 35, mat('#e5e7eb'), 2, 3, 2, 0.5, 0.45, 0.5, 'Sika (bao, thùng, can)', R(/Sika/));
  }

  /* ───────── XinHai (DA29): bố cục theo ảnh flycam + mô hình thiết kế ───────── */
  // Nhà khung bê tông n tầng: móng → cột / sàn từng tầng → tường từng tầng; dùng cho nhà văn phòng và nhà nghỉ ca.
  function frameBuilding(b, { key, nx, nz, fh, floors, found, ground, tum, ghostH, noGhost }) {
    const n0 = ELEMS.length;
    const xs = Array.from({ length: nx + 1 }, (_, i) => b.x0 + (b.x1 - b.x0) * i / nx), zs = Array.from({ length: nz + 1 }, (_, j) => b.z1 - (b.z1 - b.z0) * j / nz);
    const pos = []; zs.forEach(z => xs.forEach(x => pos.push([x, z])));
    foundation(pos, found, { xs, zs });
    if (found.plinth) walls(perimeter(b, nz, nx), 0, 0.6, M.brick, found.plinth, 0.22);
    groundFloor(b, nz * 2, ground);
    const bays = []; for (let j = 0; j < nz; j += 1) for (let i = 0; i < nx; i += 1) bays.push({ x0: xs[i] - (i === 0 ? 0.3 : 0), x1: xs[i + 1] + (i === nx - 1 ? 0.3 : 0), z0: zs[j + 1] - (j === nz - 1 ? 0.3 : 0), z1: zs[j] + (j === 0 ? 0.3 : 0) });
    const made = floors.map((f, i) => { const c = columns(pos, i * fh, (i + 1) * fh - 0.15, 0.45, f.col), sl = slab(bays, (i + 1) * fh, 0.2, f.slab, fh - 0.25); const w = f.wall ? walls(perimeter(b, nz, nx, 0.15), i * fh + 0.2, fh - 0.45, M.brick, f.wall) : null; return [c.reb, c.form, c.conc, sl.conc, sl.form, sl.reb, sl.props, w].filter(Boolean); });
    // Tầng trên không thể có khi cột tầng dưới chưa đổ: ẩn đi và ghi vào "Cần kiểm tra số liệu".
    UPDATERS.push(d => { const notes = []; floors.forEach((f, i) => { if (!i) return; const below = pAt(floors[i - 1].col.conc, d); if (below > 0) return;
      const ahead = [f.col.reb, f.col.form, f.col.conc, f.slab.form, f.slab.reb, f.slab.conc, f.wall].filter(Boolean).filter(w => pAt(w, d) > 0);
      if (ahead.length) { for (const e of made[i]) e.range(0, 0); notes.push(...ahead.map(w => `${w} · ${taskName(w)} ${Math.round(pAt(w, d))}% nhưng ${floors[i - 1].col.conc} · ${taskName(floors[i - 1].col.conc)} mới 0%`)); } });
      ANOMALIES[key] = notes; });
    if (tum) { const y0 = floors.length * fh, tp = [[b.x0, b.z0], [b.x0 + 6, b.z0], [b.x0, b.z0 + 6], [b.x0 + 6, b.z0 + 6]];
      columns(tp, y0, y0 + 3, 0.35, tum.col); slab([{ x0: b.x0 - 0.2, x1: b.x0 + 6.2, z0: b.z0 - 0.2, z1: b.z0 + 6.2 }], y0 + 3.1, 0.15, tum.slab, 2.9); if (tum.wall) walls(perimeter({ x0: b.x0, x1: b.x0 + 6, z0: b.z0, z1: b.z0 + 6 }, 1, 1, 0.1), y0 + 0.1, 2.8, M.brick, tum.wall); }
    if (!noGhost) ghostBox(b.x1 - b.x0, ghostH, b.z1 - b.z0, (b.x0 + b.x1) / 2, ghostH / 2, (b.z0 + b.z1) / 2);
    REPLACE[key] = ELEMS.slice(n0);
  }
  // Nhà xưởng khung thép 2 tầng (sàn deck), chia 3 phân đoạn theo trục. Dựng trong khung cục bộ (trục dọc = z) rồi xoay 90° về trục x thật.
  function steelFactoryDA(segs) {
    const W0 = 2.9, W1 = 57.2, xs = Array.from({ length: 7 }, (_, i) => W0 + (W1 - W0) * i / 6), mid = (W0 + W1) / 2;
    const AXZ = [0, 8.5, 17, 25.2, 33.4, 41.6, 49.8, 58, 66.4, 74.4, 82.6, 90.8, 99, 107.2, 115.4, 123.6, 131.8, 140].map(x => -84.5 + x);
    const R = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    for (const sg of segs) {
      const n0 = ELEMS.length;
      const frameZ = AXZ.filter(z => z >= sg.z0 - 0.01 && z <= sg.z1 + 0.01).sort((a, b) => b - a); if (sg.z1 > frameZ[0] + 0.5) frameZ.unshift(sg.z1);
      const pos = []; frameZ.forEach(z => xs.forEach(x => pos.push([x, z])));
      const r = { x0: W0, x1: W1, z0: sg.z0, z1: sg.z1 }, c = sg.c;
      foundation(pos, { pile: '1.2.1', dig: c.dig, reb: c.reb, form: c.form, pad: c.conc, tie: c.conc, backfill: c.fill }, { xs, zs: frameZ });
      walls(perimeter(r, frameZ.length - 1, 6), 0, 0.5, M.concrete, c.plinth, 0.25);
      groundFloor(r, frameZ.length - 1, { sand: c.fill, base: c.base, mesh: c.floorReb, conc: c.floor });
      const icol = new Elems(new THREE.ExtrudeGeometry(iShape(0.4, 0.2, 0.01, 0.015), { depth: 6.0, bevelEnabled: false }).rotateX(-Math.PI / 2), M.steelRed, pos.map(([x, z]) => mtx(x, 0.4, z)), '4.3.1');
      UPDATERS.push(d => icol.frac(pAt('4.3.1', d)));
      const bays = []; for (let j = 0; j < frameZ.length - 1; j += 1) for (let i = 0; i < xs.length - 1; i += 1) bays.push({ x0: xs[i], x1: xs[i + 1], z0: frameZ[j + 1], z1: frameZ[j] });
      slab(bays, 6.45, 0.14, { form: '4.3.1', reb: c.deckReb, conc: c.deck }, 6.0, { formMat: M.deck, noProps: true });
      walls(perimeter(r, frameZ.length - 1, 6, 0.1), 0.5, 5.8, M.brick, c.wall);
      steelRoof(r, [{ x0: W0, x1: mid }, { x0: mid, x1: W1 }], frameZ, 0.4, 12, 14.4, { steel: '4.3.1', roof: c.roof, clad: c.clad });
      const made = ELEMS.slice(n0); for (const e of made) { e.mats = e.mats.map(m => R.clone().multiply(m)); const f = e.from, to = e.to; e.from = -1; e.range(f, to); }
      REPLACE['NX:' + sg.key] = made;
      const lab = label(sg.name, 'mach'); lab.position.copy(v3(W0 - 3, 1.5, (sg.z0 + sg.z1) / 2).applyMatrix4(R)); scene.add(lab);
    }
  }
  function pilePress() { // robot ép cọc tĩnh (loại 260 t)
    const g = new THREE.Group();
    for (const s of [-1, 1]) { boxM(1.3, 0.9, 13, MX.y, s * 3.8, 0.45, 0, g); boxM(10.4, 0.7, 1.1, MX.yd, 0, 1.25, s * 4.6, g); }
    boxM(8.6, 0.55, 7.6, MX.yd, 0, 1.85, 0, g);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i += 1) for (let j = 0; j < 2; j += 1) boxM(3.0, 0.75, 1.6, M.concrete, s * 2.5, 2.55 + j * 0.8, -2.8 + i * 2.2, g);
    boxM(2.4, 3.4, 2.4, MX.y, 0, 3.8, 4.7, g); for (const x of [-0.85, 0.85]) hyd(g, v3(x, 2.2, 5.95), v3(x, 6.4, 5.95), 0.17);
    boxM(2.8, 0.5, 2.8, MX.yd, 0, 6.6, 4.7, g);
    const pileM = cyl(0.15, 0.15, 9, M.pile, 0, 4.0, 4.7, g, 18);
    cabin(g, 3.1, 2.15, 3.2, 1.4, 1.7, 1.7, MX.k, MX.y);
    const cr = new THREE.Group(); cr.position.set(-3.3, 2.15, -3.4); g.add(cr); cyl(0.4, 0.4, 0.5, MX.kg, 0, 0.25, 0, cr, 18);
    const arm = new THREE.Group(); arm.position.y = 0.7; cr.add(arm); arm.rotation.x = -0.55; ext(shapeRR(0.38, 0.48, 0.06), 9.5, MX.y, arm, { z: 4.75 });
    hyd(cr, v3(0, 0.4, 0.6), v3(0, 3.1, 3.4), 0.1);
    const hang = new THREE.Group(); hang.position.set(0, 0, 9.5); arm.add(hang); const cable = cyl(0.02, 0.02, 2.5, MX.k, 0, -1.25, 0, hang, 5); cable.rotation.x = 0.55;
    const p2 = cyl(0.15, 0.15, 10, M.pile, 0, -2.7, 0, hang, 16); p2.rotation.x = Math.PI / 2 + 0.55;
    const dec = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.4), MX.decal('ÉP CỌC 260T')); dec.position.set(0, 3.8, 5.92); g.add(dec);
    g.userData.anim = tt => { pileM.position.y = 4.0 - ((tt * 0.25) % 1) * 1.6; cr.rotation.y = -0.3 + Math.sin(tt * 0.18) * 0.35; };
    return g;
  }
  function rebarBench() { // bàn gia công thép: máy uốn + máy cắt + thép cây
    const g = new THREE.Group(); boxM(3.2, 0.12, 1.2, M.wood, 0, 0.85, 0, g); for (const x of [-1.4, 1.4]) for (const z of [-0.5, 0.5]) boxM(0.08, 0.85, 0.08, M.grey, x, 0.42, z, g);
    boxM(0.8, 0.6, 0.7, M.orange, -0.9, 1.21, 0, g); cyl(0.25, 0.25, 0.08, MX.kg, -0.9, 1.55, 0, g, 18); boxM(0.7, 0.55, 0.6, M.blue, 0.9, 1.18, 0, g); const disc = cyl(0.22, 0.22, 0.03, MX.steelG, 0.9, 1.6, 0.1, g, 20); disc.rotation.x = Math.PI / 2;
    const bars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 6, 5).rotateZ(Math.PI / 2), M.steel, 14); for (let i = 0; i < 14; i += 1) bars.setMatrixAt(i, mtx(0, 0.95 + (i % 2) * 0.03, -0.45 + i * 0.065)); g.add(bars);
    return g;
  }
  function spunPiles(x, z, n, items) { // cọc ly tâm D300 dài 10 m xếp tầng trên gỗ kê
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
    for (const zz of [-3.5, 0, 3.5]) boxM(n * 0.33 + 0.4, 0.2, 0.25, M.wood, 0, 0.1, zz, g);
    const geo = new THREE.CylinderGeometry(0.15, 0.15, 10, 18).rotateX(Math.PI / 2); const im = new THREE.InstancedMesh(geo, M.pile, n * 3); let c = 0;
    for (let l = 0; l < 3; l += 1) for (let i = 0; i < n - l; i += 1) im.setMatrixAt(c++, mtx((i - (n - l - 1) / 2) * 0.32, 0.36 + l * 0.28, 0)); im.count = c; im.castShadow = true; g.add(im);
    const holes = new THREE.InstancedMesh(new THREE.CircleGeometry(0.08, 12), M.black, c * 2); let h = 0; for (let l = 0; l < 3; l += 1) for (let i = 0; i < n - l; i += 1) for (const e of [-5.01, 5.01]) { holes.setMatrixAt(h++, new THREE.Matrix4().compose(v3((i - (n - l - 1) / 2) * 0.32, 0.36 + l * 0.28, e), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, e > 0 ? 0 : Math.PI, 0)), v3(1, 1, 1))); } holes.count = h; g.add(holes);
    stackLabel(g, 'Cọc ly tâm D300 (dài 10 m)', items); return g;
  }

  if (SITE_KEY === 'DA29') {
    const R = re => stockOf(re);
    frameBuilding(BLD.NVP, { key: 'NVP', nx: 2, nz: 6, fh: 4.2, ghostH: 12, noGhost: true, found: { pile: '1.2.1', dig: '2.1.1', reb: '2.1.4', form: '2.1.5', pad: '2.1.6', tie: '2.1.6', backfill: '2.2.1', plinth: '2.1.7' }, ground: { sand: '2.2.1', base: '2.2.2' },
      floors: [{ col: { reb: '2.3.1', form: '2.3.2', conc: '2.3.3' }, slab: { form: '2.3.4', reb: '2.3.5', conc: '2.3.6' }, wall: '2.5.1' }, { col: { reb: '2.4.1', form: '2.4.2', conc: '2.4.3' }, slab: { form: '2.4.4', reb: '2.4.5', conc: '2.4.6' }, wall: '2.5.2' }] });
    frameBuilding(BLD.NNC, { key: 'NNC', nx: 3, nz: 2, fh: 3.6, ghostH: 14, noGhost: true, found: { pile: '1.2.1', dig: '3.1.1', reb: '3.1.4', form: '3.1.5', pad: '3.1.6', tie: '3.1.6', backfill: '3.2.1', plinth: '3.1.7' }, ground: { sand: '3.2.1', base: '3.2.2' },
      floors: [{ col: { reb: '3.3.1', form: '3.3.2', conc: '3.3.3' }, slab: { form: '3.3.4', reb: '3.3.5', conc: '3.3.8' }, wall: '3.7.1' }, { col: { reb: '3.4.1', form: '3.4.2', conc: '3.4.3' }, slab: { form: '3.4.4', reb: '3.4.5', conc: '3.4.8' }, wall: '3.7.2' },
        { col: { reb: '3.5.1', form: '3.5.2', conc: '3.5.3' }, slab: { form: '3.5.4', reb: '3.5.5', conc: '3.5.8' }, wall: '3.7.3' }],
      tum: { col: { reb: '3.6.1', form: '3.6.2', conc: '3.6.3' }, slab: { form: '3.6.4', reb: '3.6.5', conc: '3.6.8' }, wall: '3.7.4' } });
    steelFactoryDA([
      { key: 'PD1', name: 'Phân đoạn 1 (trục 1–5)', z0: -84.5, z1: -84.5 + 33.4, c: { dig: '4.1.1.1', reb: '4.1.1.4', form: '4.1.1.5', conc: '4.1.1.6', fill: '4.1.1.7', plinth: '4.1.1.9', base: '4.2.3', floorReb: '4.8.1', floor: '4.8.2', deckReb: '4.7.1', deck: '4.7.2', wall: '4.4.1', roof: '4.5.1', clad: '4.6.1' } },
      { key: 'PD2', name: 'Phân đoạn 2 (trục 6–15)', z0: -84.5 + 33.4, z1: -84.5 + 107.2, c: { dig: '4.1.2.1', reb: '4.1.2.4', form: '4.1.2.5', conc: '4.1.2.6', fill: '4.2.5', plinth: '4.1.2.9', base: '4.2.6', floorReb: '4.8.3', floor: '4.8.4', deckReb: '4.7.3', deck: '4.7.4', wall: '4.4.2', roof: '4.5.2', clad: '4.6.2' } },
      { key: 'PD3', name: 'Phân đoạn 3 (trục 15–19)', z0: -84.5 + 107.2, z1: 57, c: { dig: '4.1.3.1', reb: '4.1.3.4', form: '4.1.3.5', conc: '4.1.3.6', fill: '4.1.3.7', plinth: '4.1.3.11', base: '4.2.9', floorReb: '4.8.5', floor: '4.8.6', deckReb: '4.7.5', deck: '4.7.6', wall: '4.4.3', roof: '4.5.3', clad: '4.6.3' } },
    ]);
    // Công trình tạm: BCH nhà dài mái tôn cạnh cổng (bảng hiệu có logo trên nóc), đường đất thi công, khu gia công lưới xanh, bãi vật tư.
    flat(8, 52, M.pit, -30, 0.03, -86, tempG); flat(176, 8, M.pit, -14, 0.03, -63, tempG);
    const bch = new THREE.Group(); bch.position.set(-50, 0, -97); tempG.add(bch); boxM(28, 3.2, 10, M.white, 0, 1.6, 0, bch);
    for (let i = -6; i <= 6; i += 2) boxM(1.4, 1.1, 0.06, M.cab, i * 2, 1.9, 5.03, bch);
    for (let i = -5; i <= 5; i += 2) boxM(1.4, 1.1, 0.06, M.cab, i * 2, 1.9, -5.03, bch);
    boxM(1.0, 2.1, 0.08, M.blue, 9, 1.05, -5.05, bch); // cửa ra vào phía cổng
    const shp = new THREE.Shape(); shp.moveTo(-5.6, 0); shp.lineTo(5.6, 0); shp.lineTo(0, 1.6); shp.closePath(); const rf = new THREE.Mesh(new THREE.ExtrudeGeometry(shp, { depth: 29, bevelEnabled: false }), mat('#eef2f5', { metalness: 0.3 })); rf.rotation.y = Math.PI / 2; rf.position.set(-14.5, 3.2, 0); rf.castShadow = true; bch.add(rf);
    boxM(29, 0.1, 0.5, M.blue, 0, 3.45, 5.3, bch); boxM(29, 0.1, 0.5, M.blue, 0, 3.45, -5.3, bch);
    signBoard(bch, 0, 3.2 + 1.6 + 1.25, 0, 11, 2.2);
    const bl = label('Ban chỉ huy công trường<small>nhà điều hành tạm · kho (công trình tạm)</small>'); bl.position.set(0, 10.5, 0); bch.add(bl);
    const net = new THREE.Mesh(new THREE.BoxGeometry(12, 3.4, 9), mat('#1f9d55', { transparent: true, opacity: 0.35, side: THREE.DoubleSide })); net.position.set(-98, 1.7, -96); tempG.add(net);
    spunPiles(-60, -80, 12, R(/Cọc ly tâm|Mũi cọc/)); spunPiles(-54, -80, 10, R(/Cọc ly tâm|Mũi cọc/));
    rebarRack(-46, -80, R(/^Thép XD D/));
    pile(-38.5, -74, 3.4, 2.2, M.gravel, 'Base B (cấp phối đá dăm)', R(/Base B/));
    palletStack(-40, -88, M.scaffold, 2, 8, 1, 1.0, 0.08, 1.7, 'Thang giáo', R(/Thang giáo/), 0.06);
  }

  /* ───────── Công nhân và máy theo nhật ký ngày ───────── */
  const crew = new THREE.Group(); scene.add(crew);
  const bodyGeo = new THREE.CapsuleGeometry(0.21, 0.6, 4, 10), headGeo = new THREE.SphereGeometry(0.17, 12, 10), helmGeo = new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), legGeo = new THREE.CapsuleGeometry(0.09, 0.5, 3, 6), armGeo = new THREE.CapsuleGeometry(0.065, 0.42, 3, 6);
  const toolGeo = new THREE.BoxGeometry(0.05, 0.05, 0.35), barGeo = new THREE.CylinderGeometry(0.018, 0.018, 3.2, 5).rotateZ(Math.PI / 2), boardGeo = new THREE.BoxGeometry(1.6, 0.03, 0.3), bagGeo = new THREE.BoxGeometry(0.45, 0.16, 0.32);
  const CREW_GEOS = [bodyGeo, headGeo, helmGeo, legGeo, armGeo, toolGeo, barGeo, boardGeo, bagGeo];
  const CARRY_YARD = SITE_KEY === 'DA29' ? { x0: -62, x1: -40, z0: -90, z1: -76 } : { x0: -72, x1: -61, z0: 3, z1: 29 };
  const rnd = (a, b) => a + Math.random() * (b - a);
  // Người: chân, tay xoay quanh hông / vai để bước đi, vung tay, gõ búa; có thể vác thép / ván / bao.
  function worker(x, y, z, helmet = M.helmetY, area = null, carrier = false) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.random() * Math.PI * 2;
    const legs = [-0.1, 0.1].map(sx => { const hip = new THREE.Group(); hip.position.set(sx, 0.62, 0); g.add(hip); mesh(legGeo, M.jeans, 0, -0.3, 0, hip); return hip; });
    mesh(bodyGeo, M.vest, 0, 1.0, 0, g); mesh(headGeo, M.skin, 0, 1.55, 0, g); mesh(helmGeo, helmet, 0, 1.6, 0, g);
    const arms = [-1, 1].map(sx => { const sh = new THREE.Group(); sh.position.set(sx * 0.27, 1.3, 0); sh.rotation.z = sx * 0.12; g.add(sh); mesh(armGeo, M.vest, 0, -0.26, 0, sh); return sh; });
    const tool = mesh(toolGeo, M.black, 0, -0.5, 0.12, arms[1]); tool.castShadow = false;
    const kinds = [barGeo, boardGeo, bagGeo], kind = Math.floor(Math.random() * 3), load = new THREE.Group(); load.position.set(0, 1.62, 0); g.add(load);
    if (kind === 0) for (let i = 0; i < 6; i += 1) mesh(barGeo, M.rebar, 0, (i % 2) * 0.04, (Math.floor(i / 2) - 1) * 0.04, load); else mesh(kinds[kind], kind === 1 ? M.plywood : M.bag, 0, 0, 0, load);
    load.visible = false;
    g.userData = { phase: Math.random() * 6, legs, arms, tool, load, area, carrier, y, state: 'work', timer: rnd(0.5, 5), speed: rnd(1.0, 1.45), ph: 0, toArea: true, tx: x, tz: z };
    crew.add(g); return g;
  }
  function pickIn(a) { if (a.rect) return [rnd(a.rect.x0, a.rect.x1), rnd(a.rect.z0, a.rect.z1)]; const ang = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * a.r; return [a.cx + Math.cos(ang) * r, a.cz + Math.sin(ang) * r]; }
  function nextTarget(w) {
    const u = w.userData, a = u.area; if (!a) return;
    if (u.carrier && !u.toArea) { u.tx = rnd(CARRY_YARD.x0, CARRY_YARD.x1); u.tz = rnd(CARRY_YARD.z0, CARRY_YARD.z1); }
    else { [u.tx, u.tz] = pickIn(a); }
    u.state = 'walk';
  }
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
  function stepCrew(dt, tt) {
    for (const w of crew.children) {
      const u = w.userData; if (!u.legs) continue;
      if (u.state === 'walk') {
        const dx = u.tx - w.position.x, dz = u.tz - w.position.z, d = Math.hypot(dx, dz);
        if (d < 0.2) {
          if (u.carrier) { u.load.visible = !u.toArea; u.timer = u.toArea ? rnd(2.5, 5) : rnd(1.2, 2.2); u.toArea = !u.toArea; } else u.timer = rnd(3, 9);
          u.state = 'work'; continue;
        }
        const step = Math.min(d, u.speed * dt); w.position.x += dx / d * step; w.position.z += dz / d * step;
        w.rotation.y += angDiff(Math.atan2(dx, dz), w.rotation.y) * Math.min(1, dt * 8);
        u.ph += dt * u.speed * 5.2; const sw = Math.sin(u.ph) * 0.55;
        u.legs[0].rotation.x = sw; u.legs[1].rotation.x = -sw;
        if (u.load.visible) { u.arms[0].rotation.x = u.arms[1].rotation.x = -2.6; } else { u.arms[0].rotation.x = -sw * 0.7; u.arms[1].rotation.x = sw * 0.7; }
        w.position.y = u.y + Math.abs(Math.cos(u.ph)) * 0.035; u.tool.visible = false;
      } else {
        u.timer -= dt; u.legs[0].rotation.x *= 0.85; u.legs[1].rotation.x *= 0.85; w.position.y = u.y;
        if (u.carrier && u.load.visible) { u.arms[0].rotation.x = u.arms[1].rotation.x = -2.6; u.tool.visible = false; }
        else { u.tool.visible = true; u.arms[1].rotation.x = -1.25 + Math.sin(tt * 7.5 + u.phase) * 0.55; u.arms[0].rotation.x = -0.7 + Math.sin(tt * 3 + u.phase) * 0.15; }
        if (u.timer <= 0) nextTarget(w);
      }
    }
  }
  const TEAM_PLACES = SITE_KEY === 'DA29' ? [
    { re: /nghỉ/i, at: () => [-77.7, 3.75, -76.5], name: 'Nhà nghỉ ca', rect: { x0: -87, x1: -68.5, z0: -84, z1: -69 } },
    { re: /bch/i, at: () => [-50, 0, -88], name: 'BCH', rect: { x0: -64, x1: -40, z0: -91, z1: -80 } },
    { re: /lấp đất/i, at: () => [39, 0, -30], name: 'Phân đoạn 3', rect: { x0: 24, x1: 55, z0: -55, z1: -5 } },
    { re: /đào/i, at: () => [-68, 0, -30], name: 'Phân đoạn 1', rect: { x0: -83, x1: -52, z0: -55, z1: -5 } },
    { re: /văn phòng|xưởng|cốt thép|ván khuôn|móng/i, at: () => [-14, 0, -30], name: 'Nhà xưởng PĐ2', rect: { x0: -50, x1: 22, z0: -55, z1: -5 } },
  ] : [
    { re: /alc|xây tường bao|xây alc/i, at: () => [-25, 0, 16], name: 'Xây ALC', rect: { x0: -52, x1: 2, z0: 2, z1: 30 } },
    { re: /kc|kết cấu|lắp dựng/i, at: () => [55, 12.6, -4], name: 'Lắp dựng kết cấu', up: true },
    { re: /pccc/i, at: () => [-25, 0, -25], name: 'PCCC', rect: { x0: -52, x1: 2, z0: -39, z1: -10 } },
    { re: /rào/i, at: () => [-92, 0, 0], name: 'Tường rào', rect: { x0: -94, x1: -90, z0: -40, z1: 24 } },
    { re: /hạ tầng|cống|đường/i, at: () => [0, 0, 39], name: 'Hạ tầng', rect: { x0: -80, x1: 88, z0: 36, z1: 42 } },
    { re: /sơn|bả/i, at: () => [-74, 0, -24], name: 'Sơn bả', rect: { x0: -75, x1: -72.5, z0: -40, z1: -8 } },
    { re: /văn phòng|nvp|cốt thép|vk|ván|bt|bê tông/i, at: () => [-63, 4 * FH + 0.1, -24], name: 'BT, cốt thép, ván khuôn' },
  ];
  const MACH_PLACES = SITE_KEY === 'DA29'
    ? { crane: [-60, 0, -70, Math.PI / 2], excavator: [-68, 0, -30, 0.6], roller: [39, 0, -30, 0], dozer: [-20, 0, -72, 1.2], rammer: [0, 0, -40, 0], truck: [-30, 0, -82, 0], pilepress: [10, 0, -30, 0], bender: [-98, 0, -96, 0] }
    : { crane: [11, 0, -6, Math.PI], excavator: [70, 0, 41.5, -1.2], roller: [20, 0, 38.8, Math.PI / 2], dozer: [-40, 0, 40.2, Math.PI / 2], rammer: [11, 0, 22, 0], truck: [-66, 0, 24, 0] };
  const MACH_MOVE = SITE_KEY === 'DA29' ? { roller: ['z', -30, 20, 0.25], dozer: ['x', -20, 10, 0.2] } : { roller: ['x', 25, 22, 0.25], dozer: ['x', -40, 8, 0.2] };
  const machines = {}; const machLabels = {};
  const BUILDERS = { crane: () => mobileCrane(12), excavator, roller, dozer, rammer, truck: () => dumpTruck(M.blue), pilepress: pilePress, bender: rebarBench };
  for (const [k2, place2] of Object.entries(MACH_PLACES)) {
    const g = BUILDERS[k2](); const [x, y, z, ry] = place2; g.position.set(x, y, z); g.rotation.y = ry; g.visible = false; scene.add(g); machines[k2] = g;
    g.traverse(o => { if (o.isMesh) o.userData.machine = k2; });
    const l = label('', 'mach'); l.position.set(0, k2 === 'crane' ? 5 : k2 === 'pilepress' ? 8 : 4.2, 0); g.add(l); machLabels[k2] = l;
  }
  machines.crane?.userData.pose?.(0);
  const MACH_NAME = { crane: 'Máy cẩu', excavator: 'Máy xúc', roller: 'Máy lu', dozer: 'Máy ủi', rammer: 'Đầm cóc', truck: 'Ô tô tải', pilepress: 'Máy ép cọc', bender: 'Máy uốn, cắt thép' };
  const pour = { pump: pumpTruck(), mixers: [mixerTruck(), mixerTruck()] }; for (const o of [pour.pump, ...pour.mixers]) { o.visible = false; scene.add(o); }
  for (const o of pour.mixers) o.traverse(m => { if (m.isMesh) m.userData.pourTruck = true; });
  const pourLabel = label('', 'pour'); pourLabel.position.set(0, 6, 0); pour.pump.add(pourLabel);

  /* ───────── Xe chạy (bật Chuyển động): vào cổng → điểm dừng (đổ hàng / đổ bê tông) → quay đầu ra cổng; bánh quay theo quãng đường ───────── */
  // Tuyến đi theo đường thật: SMB vào từ đường lớn phía tây (đi lên phía bắc) rẽ phải qua cổng vào đường nội bộ phía nam; XinHai vào từ đường lớn phía bắc qua cổng (x ≈ −30) xuống đường đất.
  const ENTRY = SITE_KEY === 'DA29'
    ? [[-220, -175], [-95, -152], [-48, -144.5], [-33, -139], [-29, -128], [-29, -113], [-30, -96]]
    : [[ROAD_X, 160], [ROAD_X, 70], [ROAD_X, 46], [-109, 39], [-95, 38.8], [-86, 38.8]];
  const TRUCK_TAIL = SITE_KEY === 'DA29' ? [[-30, -73], [-27, -63.5], [-4, -63]] : [[-66, 38.8]];
  const POUR_TAIL = SITE_KEY === 'DA29'
    ? { NX: [[-30, -73], [-27, -63.5], [-19, -63]], COC: [[-30, -73], [-27, -63.5], [-19, -63]], NVP: [[-30, -73], [-27, -63.5], [60, -63], [79, -58], [84, -44]], NNC: [[-33, -89.5], [-56, -89.5]] }
    : { NVP: [[-79, 38.8], [-76, 33], [-76, -8]], NX1: [[-40, 38.8]], NX2: [[6, 38.8], [11, 32], [11, -8]], NX3: [[40, 38.8]], HT: [[-15, 38.8]] };
  function makeRoute(points, lane = 1.4) {
    const off = pts => pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let hx = b[0] - a[0], hz = b[1] - a[1]; const l = Math.hypot(hx, hz) || 1; hx /= l; hz /= l; return new THREE.Vector3(p[0] - hz * lane, 0, p[1] + hx * lane); });
    const fwd = off(points), back = off([...points].reverse());
    const curve = new THREE.CatmullRomCurve3([...fwd, ...back], false, 'centripetal');
    const len = curve.getLength(), n = Math.max(32, Math.ceil(len / 0.6)), pts = curve.getSpacedPoints(n);
    const stopP = fwd[fwd.length - 1]; let stopI = 0, best = Infinity;
    for (let i = 0; i <= n; i += 1) { const d = pts[i].distanceToSquared(stopP); if (d < best) { best = d; stopI = i; } if (i > n * 0.7) break; }
    return { pts, n, len, stopS: stopI * len / n };
  }
  const DRIVERS = [];
  function driver(g, opts2) { const d = { g, route: null, speed: 6.5, stopDur: 8, wait: [3, 10], s: 0, v: 0, state: 'park', timer: 0, passedStop: false, enabled: false, ...opts2 }; DRIVERS.push(d); return d; }
  function placeOn(d, ds, snap = false) {
    const r = d.route, f = Math.max(0, Math.min(r.n, d.s / r.len * r.n)), i = Math.min(r.n - 1, Math.floor(f)), a = r.pts[i], b = r.pts[i + 1], u = f - i;
    d.g.position.set(a.x + (b.x - a.x) * u, 0, a.z + (b.z - a.z) * u);
    const c = r.pts[Math.min(r.n, i + 4)], p = r.pts[Math.max(0, i - 2)], yaw = Math.atan2(c.x - p.x, c.z - p.z);
    d.g.rotation.y = snap ? yaw : d.g.rotation.y + angDiff(yaw, d.g.rotation.y) * 0.3;
    for (const w of d.g.userData.wheels || []) w.m.rotation.x += ds / w.r;
  }
  function startDriver(d) { if (!d.route) return; d.state = 'drive'; d.passedStop = false; d.s = Math.random() * d.route.stopS * 0.9; d.v = d.speed; d.onLeg?.('in'); d.g.visible = true; placeOn(d, 0, true); }
  function parkDriver(d) { d.state = 'park'; d.g.visible = d.enabled; if (d.park) d.park(); }
  function stepDriver(d, dt) {
    const r = d.route; if (!r || !d.enabled) return;
    if (d.state === 'park') { startDriver(d); return; }
    if (d.state === 'wait') { d.timer -= dt; if (d.timer <= 0) { d.state = 'drive'; d.s = 0; d.v = d.speed * 0.6; d.passedStop = false; d.g.visible = true; d.onLeg?.('in'); placeOn(d, 0, true); } return; }
    if (d.state === 'stop') { d.timer -= dt; d.onStop?.(1 - Math.max(0, d.timer) / d.stopDur); if (d.timer <= 0) { d.state = 'drive'; d.onLeg?.('out'); } return; }
    const toStop = r.stopS - d.s;
    let target = !d.passedStop && toStop < 14 ? Math.max(1.0, d.speed * toStop / 14) : d.speed;
    // Xe sau giữ khoảng cách với xe trước cùng tuyến (xe bồn chờ lượt đổ).
    for (const o of DRIVERS) if (o !== d && o.route === r && o.enabled && (o.state === 'drive' || o.state === 'stop') && o.s > d.s && o.s - d.s < 13) target = Math.min(target, Math.max(0, (o.s - d.s - 10) * 0.8));
    d.v += (target - d.v) * Math.min(1, dt * 1.6);
    const ds = d.v * dt; d.s += ds;
    if (!d.passedStop && d.s >= r.stopS) { d.s = r.stopS; d.passedStop = true; d.state = 'stop'; d.timer = d.stopDur; d.v = 0; }
    if (d.s >= r.len) { d.state = 'wait'; d.timer = rnd(d.wait[0], d.wait[1]); d.g.visible = false; return; }
    placeOn(d, ds);
  }
  // Xe ben: vào có hàng, dừng nâng ben đổ, ra xe rỗng. Đứng yên (tắt chuyển động) thì đỗ ở chỗ cũ trong bãi.
  const truckDriver = driver(machines.truck, { speed: 7, stopDur: 9, wait: [4, 12], route: makeRoute([...ENTRY, ...TRUCK_TAIL]),
    onLeg: leg => { machines.truck.userData.setLoad(leg === 'in'); machines.truck.userData.tilt(0); },
    onStop: f => { const tilt = f < 0.3 ? f / 0.3 : f < 0.62 ? 1 : Math.max(0, (1 - f) / 0.38); machines.truck.userData.tilt(tilt); if (f > 0.45) machines.truck.userData.setLoad(false); },
    park: () => { const [x, y, z, ry] = MACH_PLACES.truck; machines.truck.position.set(x, y, z); machines.truck.rotation.y = ry; machines.truck.userData.tilt(0); machines.truck.userData.setLoad(true); } });
  // Xe bồn: hai xe thay nhau vào chờ đổ cạnh xe bơm (dừng lâu), rồi quay ra lấy chuyến khác.
  const mixerDrivers = pour.mixers.map((m, i) => driver(m, { speed: 6, stopDur: 22, wait: [2 + i * 9, 6 + i * 9], onLeg: null, onStop: null }));
  // Giao thông trên đường lớn: xe con, xe khách, xe tải chạy liên tục hai chiều.
  const TRAFFIC = [];
  const TRAFFIC_LANES = SITE_KEY === 'DA29'
    ? [[[-330, -197.6], [170, -104]], [[170, -104], [-330, -197.6]]]
    : [[[ROAD_X, 420], [ROAD_X, -24], [-117, -46], [-135, ROAD_ZN], [-520, ROAD_ZN]], [[-520, ROAD_ZN], [-135, ROAD_ZN], [-117, -46], [ROAD_X, -24], [ROAD_X, 420]]];
  {
    const kinds = [() => car('#e5e7eb'), () => car('#b91c1c'), () => car('#1f2937', true), () => dumpTruck(mat('#e5e7eb')), () => car('#2563eb'), () => car('#f8fafc', true)];
    let ki = 0;
    TRAFFIC_LANES.forEach((ln, li) => {
      const path = lanePath(ln, 2), per = SITE_KEY === 'DA29' ? 3 : 4;
      for (let j = 0; j < per; j += 1) {
        const g = kinds[ki++ % kinds.length](); if (g.userData.setLoad) g.userData.setLoad(false); scene.add(g);
        TRAFFIC.push({ g, path, s: ((j + li * 0.37) / per) * path.len + rnd(0, 30), v: rnd(9, 14) });
      }
    });
    for (const c of TRAFFIC) placeTraffic(c, 0);
  }
  // Làn xe: đi qua các điểm (đường cong mềm), lệch sang phải theo chiều chạy.
  function lanePath(points, lane) {
    const pts3 = points.map((p, i) => { const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)]; let hx = b[0] - a[0], hz = b[1] - a[1]; const l = Math.hypot(hx, hz) || 1; hx /= l; hz /= l; return new THREE.Vector3(p[0] - hz * lane, 0, p[1] + hx * lane); });
    const curve = new THREE.CatmullRomCurve3(pts3, false, 'centripetal'); const len = curve.getLength(), n = Math.max(16, Math.ceil(len / 2));
    return { pts: curve.getSpacedPoints(n), n, len };
  }
  function placeTraffic(c, ds) {
    const P = c.path; c.s = (c.s + ds) % P.len; const f = c.s / P.len * P.n, i = Math.min(P.n - 1, Math.floor(f)), u = f - i, a = P.pts[i], b = P.pts[i + 1];
    c.g.position.set(a.x + (b.x - a.x) * u, 0, a.z + (b.z - a.z) * u); c.g.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    for (const w of c.g.userData.wheels || []) w.m.rotation.x += ds / w.r;
  }

  const teamLabels = [];
  function logFor(d) { let best = null; for (const l of DATA.logs) { if (l[0] <= d && l[0] >= d - 7 && (l[1] > 0 || l[4].length)) best = l; } return best; }
  function machinesNear(d) { const set = new Map(); for (const l of DATA.logs) if (l[0] <= d && l[0] >= d - 6) for (const [ty, n] of l[3]) if (!set.has(ty)) set.set(ty, n); return set; }
  function pourOn(d) { // Đổ bê tông có % tăng trong ngày d → xe bơm + 2 xe bồn tới nhà đó.
    let best = null; for (const tk of Object.values(TASK)) { if (!/^Đổ bê tông/.test(tk.name) || tk.kids.length) continue; const a = pReal(tk.wbs, d - 1), b = pReal(tk.wbs, d); if (b - a > 0.5 && (!best || b - a > best.gain)) best = { t: tk, gain: b - a }; } return best; }
  const bldOf = wbs => Object.entries(BLD).find(([, b]) => b.roots.some(r => wbs === r || wbs.startsWith(r + '.')))?.[0];
  const POUR_AT = SITE_KEY === 'DA29' ? { NVP: [84, -31, 0], NNC: [-62, -76, 0], NX: [-14, -66, Math.PI / 2], COC: [-14, -66, Math.PI / 2], PHU: [0, 0, 0], HT: [0, 0, 0] } : { NVP: [-76, -24, 0], NX1: [-25, 35.5, Math.PI / 2], NX2: [11, -24, 0], NX3: [55, 35.5, Math.PI / 2], HT: [0, 35.5, Math.PI / 2] };
  const BCENTER = SITE_KEY === 'DA29' ? { NVP: [66, 0, -31], NNC: [-77.7, 3.75, -76.5], NX: [-14, 0, -30], COC: [-14, 0, -30], PHU: [-20, 0, 20], HT: [0, 0, -50] } : { NVP: [-63, 0, -24], NX1: [-25, 0, 16], NX2: [-25, 0, -25], NX3: [55, 0, -4], HT: [0, 0, 39] };
  function activeBuildings(d) { const g = {}; for (const tk of Object.values(TASK)) { if (tk.kids.length) continue; const gain = pReal(tk.wbs, d) - pReal(tk.wbs, d - 7); if (gain > 0.5) { const b = bldOf(tk.wbs); if (b) g[b] = (g[b] || 0) + gain; } } return Object.entries(g).sort((a, b) => b[1] - a[1]).map(([b]) => b); }
  function cluster(x, y, z, count, text, rect = null) { const n = Math.min(count, HIGH ? 24 : 12), area = rect ? { cx: (rect.x0 + rect.x1) / 2, cz: (rect.z0 + rect.z1) / 2, rect } : { cx: x, cz: z, r: y > 0.5 ? 4 : Math.min(12, 4 + n * 0.5) };
    for (let i = 0; i < n; i += 1) { const [px, pz] = pickIn(area); const w = worker(px, y, pz, i === 0 ? M.helmetW : M.helmetY, area, y < 0.5 && i > 0 && i % 4 === 3); if (i % 2) nextTarget(w); }
    const l = label(text, 'team'); l.position.set(x, y + 3.2, z); scene.add(l); teamLabels.push(l); }
  function clearCrew() { for (const w of [...crew.children]) { crew.remove(w); } for (const l of teamLabels) { l.element.remove(); l.parent?.remove(l); } teamLabels.length = 0; }
  function updateCrew(d) {
    clearCrew();
    const log = logFor(d); if (!log) return null;
    const named = [], generic = { count: 0 };
    for (const [task, count] of log[4]) { if (!(count > 0)) continue; const pl = TEAM_PLACES.find(p => p.re.test(task)); if (pl && !/^tổ đội$/i.test(task.trim())) named.push([task, count, pl]); else generic.count += count; }
    if (!named.length && !generic.count && log[1] > 0) generic.count = log[1];
    const used = new Map();
    for (const [task, count, pl] of named) { const [x, y, z] = pl.at(); const off = used.get(pl.name) || 0; used.set(pl.name, off + 1); cluster(x + off * 6, y, z, count, `${task} · ${count} người`, pl.rect || null); }
    // Nhật ký chỉ ghi "Tổ đội": chia người cho các nhà có đầu việc tăng % trong 7 ngày.
    if (generic.count) { const act = activeBuildings(d).filter(b => BCENTER[b]).slice(0, 3); const list = act.length ? act : ['NVP']; const per = Math.ceil(generic.count / list.length);
      list.forEach((b, i) => { const [x, y, z] = BCENTER[b]; const n = Math.min(per, generic.count - per * i); if (n > 0) cluster(x, y, z, n, `Tổ đội · ${n} người · ${BLD[b].short}`); }); }
    return log;
  }
  let pourBld = null;
  function updateMachines(d) {
    const near = machinesNear(d);
    for (const [k2, g] of Object.entries(machines)) { g.visible = near.has(k2); machLabels[k2].element.textContent = near.get(k2) || MACH_NAME[k2]; }
    truckDriver.enabled = near.has('truck');
    if (!truckDriver.enabled) machines.truck.visible = false; else if (!motion || truckDriver.state === 'park') parkDriver(truckDriver); else if (truckDriver.state === 'wait') machines.truck.visible = false;
    const p = pourOn(d), b = p ? bldOf(p.t.wbs) || 'HT' : null;
    if (p) { const [x, z, ry] = POUR_AT[b] || POUR_AT.HT; pour.pump.position.set(x, 0, z); pour.pump.rotation.y = ry;
      pourLabel.element.textContent = `Đổ bê tông · ${p.t.name.replace(/^Đổ bê tông\s*/, '')} · ${BLD[b]?.short || ''}`; }
    pour.pump.visible = !!p;
    const tail = b ? POUR_TAIL[b] : null;
    if (b !== pourBld) { pourBld = b; const route = tail ? makeRoute([...ENTRY, ...tail]) : null; for (const md of mixerDrivers) { md.route = route; md.state = 'park'; } }
    pour.mixers.forEach((m, i) => {
      const md = mixerDrivers[i]; md.enabled = !!p;
      md.park = () => { const [x, z, ry] = POUR_AT[b] || POUR_AT.HT; if (SITE_KEY === 'SMB') m.position.set(x - (ry ? 12 + i * 9 : 0), 0, z + (ry ? 0 : 12 + i * 9)); else m.position.set(x + (ry ? 0 : 3.5 * (i + 1)), 0, z + (ry ? -10 - i * 9 : 12 + i * 9)); m.rotation.y = ry; };
      if (!p) m.visible = false; else if (!motion || !md.route || md.state === 'park') parkDriver(md); else if (md.state === 'wait') m.visible = false;
    });
    return { near, pour: p };
  }

  /* ───────── Nhãn nhà, cây hạng mục, bảng thông tin ───────── */
  const bldLabels = {};
  for (const [key, b] of Object.entries(BLD)) { if (key === 'HT' || b.noLabel) continue; const l = label('', 'bld', () => selectBuilding(key)); l.position.set((b.x0 + b.x1) / 2, SITE_KEY === 'SMB' ? (key === 'NVP' ? 21 : 18.5) : key === 'NVP' ? 19 : 17, (b.z0 + b.z1) / 2); scene.add(l); bldLabels[key] = l; }
  const treeEl = $('tree'), info = $('info');
  let DAY = TODAY, selTask = null, selBld = null;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const pct = v => `${Math.round(v)}%`;
  const barHtml = (a, p) => `<div class="s3d-bar${a + 5 < p ? ' late' : ''}"><i class="plan" style="width:${Math.min(100, p)}%"></i><i class="act" style="width:${Math.min(100, a)}%"></i></div>`;
  const back = '<button type="button" class="s3d-link" data-back>← Ngày đang xem</button>';
  const treeBlds = Object.entries(BLD).filter(([, b]) => b.roots.length);
  function buildTree() {
    treeEl.innerHTML = treeBlds.map(([key, b]) => `<div class="s3d-node" data-bld="${key}"><button type="button" class="head" data-bld-head="${key}"><span class="tw">▶</span><span><span class="nm">${b.name}</span><span data-bar></span></span><span class="pct" data-pct></span></button>
      <div class="s3d-kids">${b.roots.map(r => `<div class="s3d-node" data-grp="${r}"><button type="button" class="head" data-grp-head="${r}"><span class="tw">▶</span><span><span class="nm">${esc(TASK[r].name.includes('-') ? TASK[r].name.replace(/^.*?-\s*/, '') : TASK[r].name)}</span><span data-bar></span></span><span class="pct" data-pct></span></button>
        <div class="s3d-kids">${leaves(TASK[r]).map(x => `<button type="button" class="s3d-task" data-task="${esc(x.wbs)}"><span>${esc(x.wbs)} · ${x.parent !== r && TASK[x.parent] ? `${esc(TASK[x.parent].name.replace(/\s*\(.*\)\s*/, ''))} · ` : ''}${esc(x.name)}<small data-dates></small></span><span class="pct" data-pct></span></button>`).join('')}</div></div>`).join('')}</div></div>`).join('')
      || '<p class="s3d-sub">Chưa có hạng mục nào khớp mô hình công trường này.</p>';
  }
  function totals(d) { const all = treeBlds.flatMap(([, b]) => b.roots.map(r => TASK[r])).flatMap(leaves); return { n: all.length, a: avg(all, x => pReal(x.wbs, d)), p: avg(all, x => planAt(x, d)) }; }
  function paintBar(el, a, p) { el.querySelector('.plan').style.width = `${Math.min(100, p)}%`; el.querySelector('.act').style.width = `${Math.min(100, a)}%`; el.classList.toggle('late', a + 5 < p); }
  function refreshTree() {
    const tot = totals(DAY);
    $('totalPct').textContent = tot.n ? pct(tot.a) : '—';
    $('totalNote').textContent = tot.n ? `trung bình ${tot.n} đầu việc · kế hoạch ${pct(tot.p)} tới ${dd(DAY)}` : 'chưa có đầu việc';
    paintBar($('totalBar'), tot.a, tot.p);
    $('hudPct').textContent = tot.n ? pct(tot.a) : '—'; $('hudNote').textContent = tot.n ? `thực tế · kế hoạch ${pct(tot.p)}` : ''; paintBar($('hudBar'), tot.a, tot.p);
    for (const [key, b] of treeBlds) {
      const node = treeEl.querySelector(`[data-bld="${key}"]`), ts = b.roots.map(r => TASK[r]).flatMap(leaves), a = avg(ts, x => pReal(x.wbs, DAY)), p = avg(ts, x => planAt(x, DAY));
      node.querySelector(':scope > .head [data-bar]').innerHTML = barHtml(a, p); node.querySelector(':scope > .head [data-pct]').textContent = pct(a);
      if (bldLabels[key]) bldLabels[key].element.innerHTML = FINISHED ? `${b.name}<small>khi hoàn thiện · hiện đã làm ${pct(a)}</small>` : `${b.name} · ${pct(a)}<small>kế hoạch ${pct(p)}${a + 5 < p ? ' · <span style="color:#b42318">chậm</span>' : ''}</small>`;
      for (const r of b.roots) { const g = node.querySelector(`[data-grp="${r}"]`), ga = groupAt(TASK[r], DAY), gp = groupPlan(TASK[r], DAY); g.querySelector(':scope > .head [data-bar]').innerHTML = barHtml(ga, gp); g.querySelector(':scope > .head [data-pct]').textContent = pct(ga);
        for (const x of leaves(TASK[r])) { const el = g.querySelector(`[data-task="${CSS.escape(x.wbs)}"]`), v = pReal(x.wbs, DAY), pv = planAt(x, DAY); el.querySelector('[data-pct]').innerHTML = `<span class="${v + 5 < pv ? 'late' : ''}">${pct(v)}</span>`;
          el.querySelector('[data-dates]').textContent = `KH ${dd(x.ps)}→${dd(x.pe)}${x.as != null ? ` · TT từ ${dd(Math.min(x.as, x.ae ?? x.as))}` : ''}`; } }
    }
  }
  listen(treeEl, 'click', e => {
    const tk = e.target.closest('[data-task]'); if (tk) { selectTask(tk.dataset.task); return; }
    const gh = e.target.closest('[data-grp-head]'); if (gh) { const n = gh.parentElement; n.dataset.open = n.dataset.open === 'true' ? 'false' : 'true'; return; }
    const bh = e.target.closest('[data-bld-head]'); if (bh) { const n = bh.parentElement; const open = n.dataset.open !== 'true'; n.dataset.open = String(open); if (open) selectBuilding(bh.dataset.bldHead, false); }
  });
  function showDay() {
    const log = logFor(DAY), m = machinesNear(DAY), p = pourOn(DAY);
    const recent = Object.values(TASK).filter(x => !x.kids.length).map(x => ({ t: x, gain: pReal(x.wbs, DAY) - pReal(x.wbs, DAY - 7) })).filter(x => x.gain > 0.5).sort((a, b) => b.gain - a.gain).slice(0, 8);
    info.innerHTML = `<h2>${wd(DAY)} ${ddy(DAY)}</h2><p class="s3d-sub">${log ? `Nhật ký ${dd(log[0])}${log[0] < DAY ? ` (${DAY - log[0]} ngày trước)` : ''} · ${log[2] === 'verified' ? 'đã duyệt' : log[2] === 'submitted' ? 'đã gửi' : 'nháp'}` : 'Không có nhật ký trong 7 ngày'}</p>
      <div class="s3d-row"><span>Công nhân</span><b>${log ? Math.max(log[1], log[4].reduce((a, [, c]) => a + (c > 0 ? c : 0), 0)) : '—'}</b></div>
      ${log && log[4].length ? log[4].filter(([, c]) => c > 0).map(([tk, c]) => `<div class="s3d-row"><span>${esc(tk)}</span><b>${c}</b></div>`).join('') : ''}
      <div class="s3d-sec">Máy trên công trường (7 ngày)</div>${m.size ? [...m].map(([ty, n]) => `<div class="s3d-row"><span>${esc(n || MACH_NAME[ty])}</span><b>${MACH_NAME[ty]}</b></div>`).join('') : '<p class="s3d-sub">Nhật ký không ghi máy.</p>'}
      ${p ? `<div class="s3d-sec">Đổ bê tông hôm nay</div><div class="s3d-row"><span>${esc(p.t.wbs)} · ${esc(p.t.name)}</span><b>+${Math.round(p.gain)}%</b></div>` : ''}
      <div class="s3d-sec">Tiến triển 7 ngày qua</div>${recent.length ? recent.map(({ t: x, gain }) => `<button type="button" class="s3d-task" data-task="${esc(x.wbs)}"><span>${esc(x.wbs)} · ${esc(x.name)}</span><span class="pct ok">+${Math.round(gain)}%</span></button>`).join('') : '<p class="s3d-sub">Không có đầu việc tăng %.</p>'}`;
  }
  listen(info, 'click', e => { const tk = e.target.closest('[data-task]'); if (tk) selectTask(tk.dataset.task); const bk = e.target.closest('[data-back]'); if (bk) { selTask = null; selBld = null; clearHL(); if (FINISHED) showFinished(); else showDay(); } if (e.target.closest('[data-unfinish]')) setFinished(false); });
  const CENTER = SITE_KEY === 'DA29' ? { NVP: [66, 4, -31, 70], NNC: [-77.7, 5, -76.5, 50], NX: [-14, 4, -30, 190], COC: [-14, 4, -30, 190], PHU: [0, 0, 0, 230], HT: [0, 0, -20, 260] } : { NVP: [-63, 6, -24, 55], NX1: [-25, 6, 16, 80], NX2: [-25, 6, -25, 80], NX3: [55, 6, -4, 120], HT: [0, 0, 0, 230] };
  function selectBuilding(key, fly = true) {
    selBld = key; const b = BLD[key], ts = b.roots.map(r => TASK[r]);
    info.innerHTML = `${back}<h2>${b.name}</h2><p class="s3d-sub">${dd(DAY)} · thực tế so với kế hoạch</p>
      ${ts.map(x => { const a = groupAt(x, DAY), p = groupPlan(x, DAY); return `<div class="s3d-row"><span>${esc(x.name.replace(/^.*?-\s*/, ''))}</span><b class="${a + 5 < p ? 'bad' : 'ok'}">${pct(a)} <small style="color:#737373;font-weight:500">/ KH ${pct(p)}</small></b></div>`; }).join('')}
      ${(ANOMALIES[key] || []).length ? `<div class="s3d-sec" style="color:#b42318">Cần kiểm tra số liệu</div>${ANOMALIES[key].map(n => `<p class="s3d-sub" style="margin:2px 0 6px">${esc(n)}</p>`).join('')}` : ''}
      <div class="s3d-sec">Đầu việc đang dở</div>${ts.flatMap(leaves).filter(x => { const v = pReal(x.wbs, DAY); return v > 0 && v < 100; }).map(x => `<button type="button" class="s3d-task" data-task="${esc(x.wbs)}"><span>${esc(x.wbs)} · ${esc(x.name)}</span><span class="pct">${pct(pReal(x.wbs, DAY))}</span></button>`).join('') || '<p class="s3d-sub">Không có.</p>'}`;
    if (fly && CENTER[key]) { const [x, y, z, r] = CENTER[key]; flyTo(v3(x, y, z), r); }
    invalidate();
  }
  let hlUntil = 0, hlList = [];
  function clearHL() { for (const e of hlList) e.mesh.material = e.base; hlList = []; treeEl.querySelectorAll('[aria-current]').forEach(x => x.removeAttribute('aria-current')); invalidate(); }
  function selectTask(wbs) {
    const tk = TASK[wbs]; if (!tk) return;
    clearHL(); selTask = wbs; hlList = ELEMS.filter(e => e.task === wbs && e.to > e.from); hlUntil = performance.now() + 3200;
    treeEl.querySelectorAll(`[data-task="${CSS.escape(wbs)}"]`).forEach(x => { x.setAttribute('aria-current', 'true'); const g = x.closest('.s3d-node[data-grp]'), b = x.closest('.s3d-node[data-bld]'); if (g) g.dataset.open = 'true'; if (b) b.dataset.open = 'true'; });
    const v = pReal(wbs, DAY), pv = planAt(tk, DAY), series = DATA.series[wbs] || [];
    info.innerHTML = `${back}<h2>${esc(wbs)} · ${esc(tk.name)}</h2><p class="s3d-sub">${esc(TASK[tk.parent]?.name || '')}</p>
      <div class="s3d-row"><span>Thực tế ${dd(DAY)}</span><b class="${v + 5 < pv ? 'bad' : 'ok'}">${pct(v)}</b></div><div class="s3d-row"><span>Kế hoạch tới ${dd(DAY)}</span><b>${pct(pv)}</b></div>
      <div class="s3d-row"><span>Kế hoạch</span><b>${dd(tk.ps)} → ${dd(tk.pe)}</b></div>
      <div class="s3d-row"><span>Thực tế</span><b>${tk.as != null ? dd(Math.min(tk.as, tk.ae ?? tk.as)) : '—'} → ${tk.ae != null && tk.progress >= 100 ? dd(Math.max(tk.as ?? tk.ae, tk.ae)) : 'đang làm'}</b></div>
      ${tk.qty ? `<div class="s3d-row"><span>Khối lượng BOQ</span><b>${tk.qty.toLocaleString('vi-VN')} ${esc(tk.unit || '')}</b></div>` : ''}
      <div class="s3d-row"><span>Phần tử 3D</span><b>${hlList.length ? `${hlList.reduce((s, e) => s + (e.to - e.from), 0)} đang hiện` : (v > 0 ? 'khuất hoặc chưa dựng hình' : 'chưa làm')}</b></div>
      ${series.length > 1 ? `<div class="s3d-sec">% theo ngày ghi nhận</div>${series.slice(-8).map(([d2, p2]) => `<div class="s3d-row"><span>${dd(d2)}</span><b>${pct(p2)}</b></div>`).join('')}` : ''}`;
    if (hlList.length) { const box = new THREE.Box3(); for (const e of hlList) for (let i = e.from; i < e.to; i += 1) { tmpP.setFromMatrixPosition(e.mats[i]); box.expandByPoint(tmpP); } const c = box.getCenter(v3(0, 0, 0)); flyTo(c, Math.max(30, box.getSize(v3(0, 0, 0)).length() * 1.3)); }
    invalidate();
  }

  /* ───────── Camera, chọn trong cảnh, thời gian ───────── */
  const VIEWS = SITE_KEY === 'DA29' ? { overview: [[-200, 150, -250], [10, 0, -20]], NNC: [[-48, 2.2, -99], [-79, 8, -77]], NVP: [[105, 6, -95], [70, 7, -40]], NX: [[-150, 90, -160], [-14, 3, -30]], NX_PD2: [[-40, 55, -125], [-14, 1, -30]], yard: [[-30, 25, -120], [-52, 1, -80]] } : { overview: [[-170, 125, 165], [5, 0, 0]], NVP: [[-118, 24, -8], [-63, 8, -24]], NX1: [[-25, 34, 105], [-25, 5, 16]], NX2: [[-25, 45, -120], [-25, 5, -25]], NX3: [[135, 60, 95], [55, 5, -4]], yard: [[-30, 22, 62], [-66, 1, 16]] };
  const VIEW_LIST = SITE_KEY === 'DA29' ? [['overview', 'Toàn cảnh'], ['NNC', 'Nhà nghỉ ca'], ['NVP', 'Nhà văn phòng'], ['NX', 'Nhà xưởng'], ['NX_PD2', 'Móng PĐ2'], ['yard', 'Bãi vật tư']] : [['overview', 'Toàn cảnh'], ['NVP', 'Nhà văn phòng'], ['NX1', 'Nhà xưởng 1'], ['NX2', 'Nhà xưởng 2'], ['NX3', 'Nhà xưởng 3'], ['yard', 'Bãi vật tư']];
  let camFrom = null, camTo = null, camT = 1;
  function flyTo(target, dist) { const dir = camera.position.clone().sub(controls.target).normalize(); camFrom = { p: camera.position.clone(), t: controls.target.clone() }; camTo = { p: target.clone().add(dir.multiplyScalar(dist)), t: target.clone() }; camT = 0; invalidate(); }
  function goView(v) { const [p, tg] = VIEWS[v]; camFrom = { p: camera.position.clone(), t: controls.target.clone() }; camTo = { p: v3(...p), t: v3(...tg) }; camT = 0; host.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v))); invalidate(); }
  $('viewBtns').innerHTML = VIEW_LIST.map(([v, t2], i) => `<button type="button" data-view="${v}" aria-pressed="${i === 0}">${t2}</button>`).join('');
  $('title').textContent = title; $('sub').textContent = `${code} · theo tiến độ trong Vioo`; $('hudTitle').textContent = title;
  if (logoUrl) { const img = $('hudLogo'); img.src = logoUrl; img.hidden = false; }
  $('sites').innerHTML = sites.length > 1 ? sites.map(s => `<button type="button" data-site="${esc(s.code)}" aria-pressed="${s.code === code}">${esc(s.label)}</button>`).join('') : '';
  listen($('sites'), 'click', e => { const b = e.target.closest('[data-site]'); if (b && b.dataset.site !== code) onSwitchSite?.(b.dataset.site); });
  camera.position.set(...VIEWS.overview[0]); controls.target.set(...VIEWS.overview[1]);
  host.querySelectorAll('[data-view]').forEach(b => { b.onclick = () => { tourStop(); goView(b.dataset.view); }; });
  const btnGhost = $('btnGhost');
  btnGhost.onclick = () => { ghosts.visible = !ghosts.visible; lod(); btnGhost.setAttribute('aria-pressed', String(ghosts.visible)); invalidate(); };
  if (loadModel) btnGhost.hidden = true; // có mô hình thiết kế: nút đổi thành chế độ mô hình khi tải xong
  const btnModels = $('btnModels'); btnModels.hidden = !(canManage && onManageModels); btnModels.onclick = () => onManageModels?.();
  const ray = new THREE.Raycaster(), down = new THREE.Vector2();
  listen(renderer.domElement, 'pointerdown', e => down.set(e.clientX, e.clientY));
  listen(renderer.domElement, 'pointerup', e => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
    for (const h of ray.intersectObjects(scene.children, true)) {
      if (!h.object.visible || ghosts.children.includes(h.object)) continue;
      const u = h.object.userData;
      if (u.tk) { const seg = tkSeg(u.tk.bay), ax = u.tk.bay + 1, w = u.tk.st === 'neo' ? TK_NEO[seg] : TK_TASK;
        info.innerHTML = `${back}<h2>${TK_NAME[u.tk.st] || 'Kết cấu thép'} · ${SITE_KEY === 'SMB' ? 'bước khung' : 'trục'} ${ax}–${ax + 1}</h2><p class="s3d-sub">Mô hình Tekla · ${tkPlace(u.tk.bay)}</p><div class="s3d-row"><span>Đầu việc</span><b>${esc(w)} · ${esc(taskName(w))}</b></div><div class="s3d-row"><span>Thực tế ${dd(DAY)}</span><b>${pct(pReal(w, DAY))}</b></div><div class="s3d-row"><span>Kế hoạch</span><b>${TASK[TK_TASK] ? `${dd(TASK[TK_TASK].ps)} → ${dd(TASK[TK_TASK].pe)}` : '—'}</b></div>`; invalidate(); return; }
      if (u.k) { const key = ['NNC', 'NVP', 'NX', 'NX1', 'NX2', 'NX3'].includes(u.k.part) ? u.k.part : null; if (key && BLD[key]?.roots.length) { selectBuilding(key); return; } continue; }
      if (u.elems) { if (TASK[u.elems.task]) { selectTask(u.elems.task); return; } continue; }
      if (u.stock) { const { title: st, rows } = u.stock; info.innerHTML = `${back}<h2>${esc(st)}</h2><p class="s3d-sub">Tồn kho công trường trong Vioo</p>${rows.length ? rows.map(([n, un, q]) => `<div class="s3d-row"><span>${esc(n)}</span><b>${Number(q).toLocaleString('vi-VN')} ${esc(un || '')}</b></div>`).join('') : '<p class="s3d-sub">Không có dòng tồn.</p>'}`; invalidate(); return; }
      if (u.machine) { const near = machinesNear(DAY); info.innerHTML = `${back}<h2>${MACH_NAME[u.machine]}</h2><p class="s3d-sub">${esc(near.get(u.machine) || '')}</p><p class="s3d-sub">Có trong nhật ký công trường 7 ngày tới ${dd(DAY)}. Vị trí trên mô hình là minh họa theo việc đang làm.</p>`; invalidate(); return; }
      if (u.site) return;
    }
  });
  const slider = $('slider'), dateText = $('dateText'), btnPlay = $('btnPlay'), btnPlay2 = $('btnPlay2');
  // Thanh trượt tự dựng: <input type="range"> làm tiến trình GPU của WebKit (bản Playwright, macOS 26) quay 100% CPU mãi (17/10).
  slider.setAttribute('aria-valuemax', String(TODAY));
  const fill = slider.querySelector('.s3d-range-fill'), thumb = slider.querySelector('.s3d-range-thumb');
  const paintSlider = d => { const f = `${(d / TODAY) * 100}%`; fill.style.width = f; thumb.style.left = f; slider.setAttribute('aria-valuenow', String(d)); slider.setAttribute('aria-valuetext', ddy(d)); };
  const slideTo = d => { setPlaying(false); setFinished(false, false); if (Math.round(d) !== DAY) setDay(d); };
  const dayAt = x => { const r = slider.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (x - r.left) / Math.max(1, r.width))) * TODAY); };
  slider.addEventListener('pointerdown', e => { slider.setPointerCapture?.(e.pointerId); slider.focus({ preventScroll: true }); slideTo(dayAt(e.clientX)); });
  slider.addEventListener('pointermove', e => { if (slider.hasPointerCapture?.(e.pointerId)) slideTo(dayAt(e.clientX)); });
  slider.addEventListener('keydown', e => {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -7, PageUp: 7 }[e.key];
    if (step) slideTo(Math.max(0, Math.min(TODAY, DAY + step))); else if (e.key === 'Home') slideTo(0); else if (e.key === 'End') slideTo(TODAY); else return;
    e.preventDefault();
  });
  btnPlay.title = `Phát tiến độ từ ${ddy(0)}`;
  { // Mốc đầu tháng trên thanh thời gian (thưa dần khi dự án dài).
    const marks = []; const s = dateOf(0); for (let y = s.getUTCFullYear(), m = s.getUTCMonth(); ; m += 1) { const ms = Date.UTC(y, m, 1), d = Math.round((ms - D0) / 86400000); if (d > TODAY) break; if (d >= 0) marks.push(d); if (marks.length > 40) break; }
    const step = Math.max(1, Math.ceil(marks.length / 7));
    $('ticks').innerHTML = marks.filter((_, i) => i % step === 0).map(d => `<span style="left:${(d / TODAY) * 100}%">${dd(d)}</span>`).join('');
  }
  let playing = false, playAcc = 0;
  const playStep = Math.max(1, Math.round(TODAY / 220));
  function setPlaying(on) { playing = on; btnPlay.textContent = on ? '⏸ Dừng' : '▶ Phát'; btnPlay2.textContent = on ? '⏸ Dừng tiến độ' : '▶ Phát tiến độ'; if (on) invalidate(); }
  const PLAN_END = (() => { let m = -Infinity; for (const x of Object.values(TASK)) if (x.pe != null && x.pe > m) m = x.pe; return Number.isFinite(m) ? m : null; })();
  function setDay(d) {
    DAY = Math.max(0, Math.min(TODAY, Math.round(d))); paintSlider(DAY);
    const txt = FINISHED ? `Khi hoàn thiện${PLAN_END != null ? ` · kế hoạch xong ${ddy(PLAN_END)}` : ''}` : `${wd(DAY)} ${ddy(DAY)}${DAY === TODAY ? ' · hôm nay' : ''}`;
    dateText.textContent = txt; $('hudDate').textContent = txt;
    for (const u of UPDATERS) u(DAY);
    if (FINISHED) hideSiteWork(); else { updateCrew(DAY); updateMachines(DAY); }
    refreshTree();
    if (FINISHED) showFinished(); else if (selTask) selectTask(selTask); else if (selBld) selectBuilding(selBld, false); else showDay();
    invalidate();
  }
  // Xem hoàn thiện: không còn người, máy, xe, vật tư, công trình tạm.
  function hideSiteWork() {
    clearCrew();
    for (const g of [...Object.values(machines), pour.pump, ...pour.mixers]) g.visible = false;
    for (const dr of DRIVERS) dr.enabled = false;
  }
  function showFinished() {
    const tot = totals(DAY), endOf = list => { let m = null; for (const x of list) if (x.pe != null && (m == null || x.pe > m)) m = x.pe; return m; };
    info.innerHTML = `<h2>Khi hoàn thiện</h2><p class="s3d-sub">${REAL.loaded ? 'Theo mô hình thiết kế' : 'Dựng đủ các hạng mục'}${PLAN_END != null ? ` · kế hoạch xong ${ddy(PLAN_END)}` : ''}</p>
      <div class="s3d-row"><span>Đã làm tới ${dd(DAY)}</span><b class="ok">${tot.n ? pct(tot.a) : '—'}</b></div>
      <div class="s3d-row"><span>Còn lại</span><b>${tot.n ? pct(100 - tot.a) : '—'}</b></div>
      ${treeBlds.length ? `<div class="s3d-sec">Từng hạng mục</div>${treeBlds.map(([, b]) => { const ts = b.roots.map(r => TASK[r]).flatMap(leaves), a = avg(ts, x => pReal(x.wbs, DAY)), end = endOf(ts);
        return `<div class="s3d-row"><span>${esc(b.name)}</span><b>${pct(a)} <small style="color:#737373;font-weight:500">${end != null ? `· xong ${dd(end)}` : ''}</small></b></div>`; }).join('')}` : ''}
      <p style="margin:10px 0 0"><button type="button" class="s3d-link" data-unfinish>← Về tiến độ thực tế</button></p>`;
  }
  const togglePlay = () => { const on = !playing; setFinished(false, false); if (on && DAY >= TODAY) setDay(0); setPlaying(on); };
  btnPlay.onclick = togglePlay; btnPlay2.onclick = togglePlay;
  $('btnToday').onclick = () => { setPlaying(false); setFinished(false, false); setDay(TODAY); };
  let toastT = null; function toast(text) { const el = $('toast'); el.textContent = text; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2200); }

  const lodV = new THREE.Vector3();
  function lod() { const far = camera.position.distanceTo(controls.target) > 170;
    for (const l of [...teamLabels, ...Object.values(machLabels), pourLabel]) { l.getWorldPosition(lodV); l.visible = far || lodV.distanceTo(controls.target) < 70; }
    for (const l of ghostLabels) { l.getWorldPosition(lodV); l.visible = ghosts.visible && camera.position.distanceTo(lodV) < 150; } }

  /* ───────── Mô hình thiết kế XinHai (SketchUp → GLB nén meshopt) + kết cấu thép Tekla ───────── */
  const REAL = { meshes: [], mode: 'ghost', loaded: false, loading: false };
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#8fb3e6', transparent: true, opacity: 0.1, depthWrite: false }); MATS.push(ghostMat);
  const done = (w, d) => (TASK[w] ? pAt(w, d) >= 99.5 : false);
  if (SITE_KEY === 'DA29') UPDATERS.push(d => { const segs = [['PĐ1 (trục 1–5, đầu cổng)', '4.1.1'], ['PĐ2 (trục 6–15)', '4.1.2'], ['PĐ3 (trục 15–19, giáp văn phòng)', '4.1.3']].map(([n, w]) => ({ n, w, ps: TASK[w]?.ps ?? 0, p: TASK[w] ? groupAt(TASK[w], d) : 0 })).sort((a, b) => a.ps - b.ps);
    const notes = []; for (let i = 0; i < segs.length; i += 1) for (let j = i + 1; j < segs.length; j += 1) if (segs[j].p - segs[i].p >= 40) notes.push(`Móng ${segs[j].n} ghi ${Math.round(segs[j].p)}% nhưng ${segs[i].n} (kế hoạch làm trước) mới ${Math.round(segs[i].p)}% — kiểm tra có nhập % nhầm phân đoạn không.`);
    ANOMALIES.NX = notes; });
  const allDone = (list, d) => list.length > 0 && list.every(w => done(w, d));
  const rootDone = (r, d) => (TASK[r] ? groupAt(TASK[r], d) >= 99.5 : false);
  const NNC_WALL = ['3.7.1', '3.7.2', '3.7.3', '3.7.4'], NVP_WALL = ['2.5.1', '2.5.2', '2.5.3', '2.5.3'];
  const STRUCT = new Set(['Slab', 'Column', 'Beam', 'StairFlight', 'Stair', 'Member', 'Footing', 'Roof', 'Building']);
  const segOf = xbin => (xbin * 141.5 / 18 < 33.4 ? 'PD1' : xbin * 141.5 / 18 < 107.2 ? 'PD2' : 'PD3');
  const SEG_ENV = { PD3: ['4.5.3', '4.6.3', '4.4.3'], PD2: ['4.5.2', '4.6.2', '4.4.2'], PD1: ['4.5.1', '4.6.1', '4.4.1'] };
  // 'real' | 'ghost' | 'hide' cho một khối của mô hình thiết kế tại ngày d.
  // SMB: mỗi nhà hiện thật theo phần (thân = tường xây xong, mái = lợp tôn xong, sàn = đổ bê tông sàn xong); văn phòng theo tầng.
  const SMB_REAL = {
    NVP: { walls: ['3.1', '3.2', '3.3', '3.4', '2.38'], facade: ['4.28', '4.23'], root: '2' },
    NX1: { body: ['7.1'], roof: ['7.3'], slab: ['6.24'], frame: ['7.2'] },
    NX2: { body: ['11.1'], roof: ['11.3'], slab: ['10.18'], frame: ['11.2'] },
    NX3: { body: ['15.1', '15.2'], roof: ['15.5'], slab: ['14.11', '14.23'], frame: ['15.3'] },
  };
  function realStateSMB(kk, d) {
    if (REAL.mode === 'steel') return kk.part === 'NX3' && kk.cat !== 'slab' ? 'hide' : 'real';
    let ok = true;
    const c = SMB_REAL[kk.part];
    if (kk.part === 'NVP') ok = kk.cat === 'facade' ? allDone(c.facade, d) : done(c.walls[Math.min(kk.lv, 4)], d);
    else if (c) ok = allDone(c[kk.cat] || c.body, d);
    else if (kk.part === 'PHU' || kk.part === 'HT') ok = rootDone('17', d);
    return ok ? 'real' : REAL.mode === 'off' ? 'hide' : 'ghost';
  }
  function realState(kk, d) {
    if (REAL.mode === 'full' || FINISHED) return 'real';
    if (SITE_KEY === 'SMB') return realStateSMB(kk, d);
    if (REAL.mode === 'steel') return kk.part === 'NX' || kk.part === 'NVP' ? 'hide' : 'real';
    if (kk.part === 'GD1' || kk.part === 'DIAHINH' || kk.part === 'NEN' || kk.part === '') return 'real';
    let ok = false;
    if (kk.part === 'NEN_GD2') ok = rootDone('8', d);
    else if (kk.part === 'NNC' || kk.part === 'NVP') { const wall = (kk.part === 'NNC' ? NNC_WALL : NVP_WALL)[Math.min(kk.lv, 3)];
      ok = STRUCT.has(kk.cat) || kk.cat === 'Wall' || kk.cat === 'CurtainWall' ? done(wall, d) : done(kk.part === 'NNC' ? '3.11' : '2.9', d); }
    else if (kk.part === 'NX') ok = allDone(SEG_ENV[segOf(kk.xbin)], d);
    else if (['XE5C', 'XE_TRUOC', 'XE_GOC', 'SAN_TRUOC'].includes(kk.part)) ok = rootDone('7', d);
    else if (kk.part === 'CONG' || kk.part === 'BAOVE') ok = rootDone('8', d);
    else if (kk.part === 'PHU_DONG') ok = rootDone('5', d) && rootDone('6', d);
    return ok ? 'real' : REAL.mode === 'off' ? 'hide' : 'ghost';
  }
  const TEKLA = [];
  // Trục Tekla 1 → 21 (m, gốc trục 1 ở đầu cổng — chủ SP xác nhận 17/10). PĐ1 trục 1–5, PĐ2 trục 5–15, PĐ3 trục 15–19; trục 19–21 là khung mái nhà văn phòng.
  // SMB xưởng 3: khung theo chiều dài 75 m (trục Tekla z), đầu tây gần cổng lắp trước; đầu việc 15.3 (lắp dựng kết cấu thép xưởng 3).
  const TK_AX = SITE_KEY === 'SMB' ? [0, 9, 18.5, 28, 37.5, 47, 56.5, 66, 75] : [0, 8.5, 17, 25.2, 33.4, 41.6, 49.8, 58, 66, 66.4, 74.4, 82.6, 90.8, 99, 107.2, 115.4, 123.6, 131.8, 140, 150, 160];
  const TK_TASK = SITE_KEY === 'SMB' ? '15.3' : '4.3.1';
  const tkSeg = bay => (SITE_KEY === 'SMB' ? 'NX3' : TK_AX[bay] >= 140 ? 'NVP' : TK_AX[bay] < 33.4 ? 'PD1' : TK_AX[bay] < 107.2 ? 'PD2' : 'PD3');
  const TK_NEO = { PD3: '4.1.3.4', PD2: '4.1.2.4', PD1: '4.1.1.4', NVP: '2.1.4', NX3: '13.8' };
  const tkPlace = bay => (SITE_KEY === 'SMB' ? 'Nhà xưởng 3' : tkSeg(bay) === 'NVP' ? 'Nhà văn phòng' : 'Nhà xưởng ' + tkSeg(bay).replace('PD', 'PĐ'));
  // Đầu việc 4.3.1 (lắp dựng kết cấu thép, sàn deck) chia giai đoạn: cột → kèo, dầm → giằng, xà gồ → tôn sàn deck → cầu thang; mỗi giai đoạn lắp dần từ đầu cổng vào.
  const TK_STAGE = { cot: [0, 40], keo: [20, 65], giang: [40, 85], deck: [60, 100], thang: [80, 100] };
  const TK_NAME = { neo: 'Bu lông neo', cot: 'Cột thép', keo: 'Kèo, dầm thép', giang: 'Giằng, xà gồ', deck: 'Tôn sàn deck', thang: 'Cầu thang, lan can thép' };
  function applyTekla(d) {
    const p = pAt(TK_TASK, d);
    for (const o of TEKLA) { const { st: stg, bay } = o.userData.tk; let vis;
      if (REAL.mode === 'full' || REAL.mode === 'steel' || FINISHED) vis = true;
      else if (stg === 'neo') vis = done(TK_NEO[tkSeg(bay)], d);
      else { const [a, b] = TK_STAGE[stg] || [0, 100], f = Math.max(0, Math.min(1, (p - a) / (b - a))); vis = bay < Math.round(f * TK_AX.length - 1e-9) + (f >= 1 ? 1 : 0); }
      o.visible = vis; }
  }
  function applyReal(d) {
    if (!REAL.loaded) return;
    const floorReal = { NNC: [false, false, false, false], NVP: [false, false, false, false] };
    for (const o of REAL.meshes) { const st = realState(o.userData.k, d); o.visible = st !== 'hide'; o.material = st === 'real' ? o.userData.orig : ghostMat; o.castShadow = st === 'real' && !o.userData.orig.transparent;
      const kk = o.userData.k; if (st === 'real' && (kk.part === 'NNC' || kk.part === 'NVP') && STRUCT.has(kk.cat)) floorReal[kk.part][Math.min(kk.lv, 3)] = true; }
    applyTekla(d);
    // Nhà / phân đoạn đã hiện mô hình thật thì ẩn phần dựng tiến độ trùng chỗ.
    if (REAL.mode === 'full' || REAL.mode === 'steel' || FINISHED) { for (const list of Object.values(REPLACE)) for (const e of list) e.range(0, 0); siteGround.visible = !FINISHED && REAL.mode === 'steel'; return; }
    siteGround.visible = true;
    if (SITE_KEY === 'SMB') {
      for (const key of ['NX1', 'NX2', 'NX3']) { const c = SMB_REAL[key]; if (allDone([...c.body, ...c.roof, ...c.slab], d)) for (const e of REPLACE[key] || []) e.range(0, 0); }
      if (allDone(SMB_REAL.NVP.walls, d) && rootDone('2', d)) for (const e of REPLACE.NVP || []) e.range(0, 0);
      if (rootDone('17', d)) for (const e of REPLACE.HT || []) e.range(0, 0);
      return;
    }
    for (const seg of ['PD1', 'PD2', 'PD3']) if (allDone(SEG_ENV[seg], d)) for (const e of REPLACE['NX:' + seg] || []) e.range(0, 0);
    for (const key of ['NNC', 'NVP']) if (floorReal[key][0] && done((key === 'NNC' ? NNC_WALL : NVP_WALL)[0], d) && rootDone(key === 'NNC' ? '3' : '2', d)) for (const e of REPLACE[key] || []) e.range(0, 0);
  }
  const btnGhostLabel = { ghost: 'Thiết kế: mờ', full: 'Thiết kế: hoàn thiện', steel: 'Thiết kế: khung thép', off: 'Thiết kế: ẩn' };
  const status = $('realStatus');
  const setStatus = (text, actionLabel = null, onAction = null) => {
    status.textContent = text || '';
    if (actionLabel) { const b = document.createElement('button'); b.type = 'button'; b.textContent = actionLabel; b.style.marginLeft = text ? '6px' : '0'; b.onclick = onAction; status.appendChild(b); }
    invalidate();
  };
  const boxRaycast = function (rc, out) { if (!this.visible) return; const p = rc.ray.intersectBox(this.userData.box, new THREE.Vector3()); if (p) out.push({ distance: rc.ray.origin.distanceTo(p), point: p, object: this }); };
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const parse = buf => new Promise((res, rej) => loader.parse(buf, '', res, rej));
  const MODEL_ROOTS = [];
  async function loadReal() {
    if (REAL.loading || REAL.loaded || !loadModel) return;
    REAL.loading = true;
    try {
      setStatus('Đang tải mô hình thiết kế…');
      const arch = await loadModel('architecture', f => setStatus(`Đang tải mô hình thiết kế ${Math.round(f * 100)}%`));
      if (disposed) return;
      if (!arch) { REAL.loading = false; btnGhost.hidden = FINISHED; setStatus(canManage ? 'Chưa có mô hình thiết kế' : ''); return; }
      setStatus('Đang dựng mô hình thiết kế…');
      const pm = new THREE.PMREMGenerator(renderer); roomEnv = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); TEXTURES.push(roomEnv);
      if (!hq) { scene.environment = roomEnv; scene.environmentIntensity = 0.45; }
      const g = await parse(arch); if (disposed) return;
      g.scene.position.y = SITE_KEY === 'SMB' ? 0 : -0.3; scene.add(g.scene); g.scene.updateMatrixWorld(true); MODEL_ROOTS.push(g.scene); ctxG.visible = false;
      const tuned = new Set();
      g.scene.traverse(o => { if (!o.isMesh) return; const [part, cat, lv, xbin] = (o.name || '').split('|'); o.userData.k = { part: part || '', cat: cat || '', lv: +lv || 0, xbin: +xbin || 0 }; o.userData.orig = o.material; o.receiveShadow = true;
        const m = o.material; if (m.transparent && !tuned.has(m)) { tuned.add(m); m.color.lerp(new THREE.Color('#cfe3f3'), 0.65); m.opacity = 0.32; m.roughness = 0.05; m.metalness = 0.15; m.depthWrite = false; }
        // Bấm chọn theo hộp bao (nhanh hơn dò từng tam giác của 2,5 triệu tam giác).
        o.geometry.computeBoundingBox(); o.userData.box = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); o.raycast = boxRaycast;
        REAL.meshes.push(o); });
      // Bụi cây viền (khối SketchUp đã gom thành [x, z, dài x, cao, dài z] trong extras của cảnh).
      const bushes = Array.isArray(g.scene.userData?.bushes) ? g.scene.userData.bushes : [];
      if (bushes.length) { const pts = []; for (const [x, z, sx, sy, sz] of bushes) { const long = Math.max(sx, sz), n = Math.max(1, Math.round(long / 1.1)); for (let i = 0; i < n; i += 1) { const f = (i + 0.5) / n - 0.5; pts.push([x + (sx >= sz ? f * sx : 0), z + (sx < sz ? f * sz : 0), Math.min(sy, 1.4)]); } }
        const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.6, 1), mat('#3f7f3a'), pts.length); pts.forEach(([x, z, h], i) => im.setMatrixAt(i, mtx(x, h * 0.45 - 0.3, z, 1, h / 1.2, 1))); im.castShadow = true; scene.add(im); }
      try {
        const tkBuf = await loadModel('structure', f => setStatus(`Đang tải kết cấu thép ${Math.round(f * 100)}%`));
        if (tkBuf && !disposed) {
          const tk = await parse(tkBuf);
          // XinHai: Tekla cùng hướng, dời về góc xưởng. SMB xưởng 3: Tekla xoay 90° (chiều dài Tekla z → x thật), góc tây nam xưởng.
          if (SITE_KEY === 'SMB') { tk.scene.position.set(92.05, 0.3, 32.9); tk.scene.rotation.y = Math.PI / 2; } else tk.scene.position.set(-84.5, -0.3, -2.9);
          scene.add(tk.scene); tk.scene.updateMatrixWorld(true); MODEL_ROOTS.push(tk.scene);
          tk.scene.traverse(o => { if (!o.isMesh) return; const [, stg, bay] = o.name.split('|'); o.userData.tk = { st: stg, bay: +bay }; o.castShadow = true; o.receiveShadow = true;
            o.geometry.computeBoundingBox(); o.userData.box = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); o.raycast = boxRaycast; TEKLA.push(o); });
          for (const key of SITE_KEY === 'SMB' ? ['NX3'] : ['NX:PD1', 'NX:PD2', 'NX:PD3']) for (const e of REPLACE[key] || []) if (e.task === TK_TASK) { e.disabled = true; e.range(0, 0); }
        }
      } catch (e) { console.warn('Site3D structure model failed:', e); }
      if (disposed) return;
      REAL.loaded = true; setStatus(''); tuneModelMaterials();
      btnGhost.hidden = FINISHED; btnGhost.textContent = btnGhostLabel[REAL.mode]; btnGhost.setAttribute('aria-pressed', 'true');
      btnGhost.onclick = () => { REAL.mode = REAL.mode === 'ghost' ? 'full' : REAL.mode === 'full' ? 'steel' : REAL.mode === 'steel' ? 'off' : 'ghost'; btnGhost.textContent = btnGhostLabel[REAL.mode]; btnGhost.setAttribute('aria-pressed', String(REAL.mode !== 'off')); setDay(DAY); };
      setDay(DAY);
    } catch (e) {
      console.error('Site3D model failed:', e);
      if (!disposed) setStatus('Chưa tải được mô hình thiết kế', 'Thử lại', () => { REAL.loading = false; loadReal(); });
    } finally { REAL.loading = false; }
  }
  {
    UPDATERS.push(d => applyReal(d));
    if (loadModel) { if (autoLoadModels) loadReal(); else setStatus('', 'Tải mô hình thiết kế (≈15 MB)', () => loadReal()); }
  }

  /* ───────── Chất lượng cao (trình chiếu trên máy tính) ───────── */
  // Vật liệu mô hình thiết kế theo chế độ: kính phản chiếu trời, mái tôn / kim loại bóng nhẹ.
  const tunedMats = new Map();
  function tuneModelMaterials() {
    for (const o of REAL.meshes) { const m = o.userData.orig; if (!m || tunedMats.get(m) === hq) continue; tunedMats.set(m, hq);
      const nm = (m.name || '').toLowerCase();
      if (m.transparent) { if (hq) { m.opacity = 0.42; m.roughness = 0.03; m.metalness = 0.55; m.color.set('#b9d3ea'); } else { m.opacity = 0.32; m.roughness = 0.05; m.metalness = 0.15; m.color.set('#cfe3f3'); } m.needsUpdate = true; }
      else if (/metal|ton\b|tôn|seamed|corrogated|zincalume|steel|alu|color_h08/.test(nm)) { m.metalness = hq ? HQP.metal : 0; m.roughness = hq ? 0.45 : 0.85; m.needsUpdate = true; } }
  }
  const sky = new Sky(); sky.scale.setScalar(3000); sky.visible = false; scene.add(sky);
  const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(42), THREE.MathUtils.degToRad(-48));
  const skyU = sky.material.uniforms; skyU.sunPosition.value.copy(SUN_DIR); skyU.turbidity.value = 3; skyU.rayleigh.value = 1.4; skyU.mieCoefficient.value = 0.004; skyU.mieDirectionalG.value = 0.8;
  let skyEnv = null, gtao = null;
  const canHq = HIGH && !!renderer.capabilities.isWebGL2;
  // Vẽ bằng phần mềm (máy ảo, trình duyệt headless, máy không có card đồ hoạ): không tự bật khi trình chiếu, chỉ bật tay.
  const swGl = (() => { try { const gl = renderer.getContext(), d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? /swiftshader|llvmpipe|software|mesa offscreen/i.test(String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL))) : false; } catch { return false; } })();
  // Tham số chất lượng cao (chỉnh được khi thử: debug.hqTune).
  const HQP = { exposure: 1.15, sun: 3.0, env: 0.65, hemi: 0.3, ao: 0.55, aoRadius: 1.8, metal: 0.12 };
  function applyHqParams() {
    if (!hq) return;
    renderer.toneMappingExposure = HQP.exposure; sun.intensity = HQP.sun; scene.environmentIntensity = HQP.env; hemi.intensity = HQP.hemi;
    if (gtao) { gtao.blendIntensity = HQP.ao; gtao.updateGtaoMaterial({ radius: HQP.aoRadius }); }
    for (const m of tunedMats.keys()) tunedMats.set(m, null); tuneModelMaterials(); invalidate();
  }
  function setHq(on) {
    on = !!on && canHq; if (on === hq) return; hq = on;
    sky.visible = hq; scene.background = hq ? null : new THREE.Color('#dbe7f1'); scene.fog.color.set(hq ? '#d5e1ec' : '#dbe7f1');
    renderer.toneMapping = hq ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping; renderer.toneMappingExposure = HQP.exposure;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); renderer.setSize(W, H);
    if (hq) {
      if (!skyEnv) { const pm = new THREE.PMREMGenerator(renderer); skyEnv = pm.fromScene(sky).texture; pm.dispose(); TEXTURES.push(skyEnv); }
      scene.environment = skyEnv; scene.environmentIntensity = HQP.env;
      sun.position.copy(SUN_DIR).multiplyScalar(420); sun.target.position.set(0, 0, 0); sun.intensity = HQP.sun; sun.color.set('#fff1d6'); sun.shadow.normalBias = 0.03; hemi.intensity = HQP.hemi;
      M.grass.map = TX.grassHq || TX.grass; M.grass.needsUpdate = true;
      const target = new THREE.WebGLRenderTarget(W, H, { samples: 4, type: THREE.HalfFloatType });
      composer = new EffectComposer(renderer, target); composer.addPass(new RenderPass(scene, camera));
      gtao = new GTAOPass(scene, camera, W, H, undefined, { radius: HQP.aoRadius, distanceExponent: 1, thickness: 1.2, scale: 1.1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
      gtao.blendIntensity = HQP.ao; composer.addPass(gtao); composer.addPass(new OutputPass()); composer.setSize(W, H);
    } else {
      scene.environment = roomEnv; scene.environmentIntensity = roomEnv ? 0.45 : 1;
      sun.position.set(-90, 160, 110); sun.target.position.set(0, 0, -50); sun.intensity = 1.7; sun.color.set('#fff4e0'); sun.shadow.normalBias = 0; hemi.intensity = 1.0;
      M.grass.map = TX.grass; M.grass.needsUpdate = true;
      if (composer) { for (const p of composer.passes) p.dispose?.(); composer.dispose(); composer = null; gtao = null; }
    }
    tuneModelMaterials(); btnHq.setAttribute('aria-pressed', String(hq)); invalidate();
  }
  const btnHq = $('btnHq'); btnHq.hidden = !canHq; btnHq.onclick = () => setHq(!hq);

  /* ───────── Chuyển động, ẩn thông tin, trình chiếu ───────── */
  const btnMotion = $('btnMotion'), btnInfo = $('btnInfo'), btnInfo2 = $('btnInfo2'), btnTour = $('btnTour');
  function setMotion(on, notify = true) {
    motion = !!on; btnMotion.setAttribute('aria-pressed', String(motion));
    for (const d of DRIVERS) { if (motion) { if (d.enabled && d.route) startDriver(d); } else parkDriver(d); }
    if (!motion) for (const d of DRIVERS) if (d.enabled) d.g.visible = true;
    if (notify) onMotionChange?.(motion);
    invalidate();
  }
  btnMotion.onclick = () => setMotion(!motion);
  let infoHidden = false;
  function setInfoHidden(on) {
    infoHidden = !!on; host.classList.toggle('s3d-noinfo', infoHidden);
    btnInfo.textContent = infoHidden ? 'Hiện thông tin' : 'Ẩn thông tin'; btnInfo.setAttribute('aria-pressed', String(infoHidden));
    btnInfo2.textContent = infoHidden ? 'Hiện thông tin' : 'Ẩn thông tin'; btnInfo2.setAttribute('aria-pressed', String(!infoHidden));
    invalidate();
  }
  btnInfo.onclick = () => setInfoHidden(!infoHidden); btnInfo2.onclick = () => setInfoHidden(!infoHidden);
  const btnFinish = $('btnFinish'), btnFinish2 = $('btnFinish2');
  let ghostsBefore = true;
  function setFinished(on, redraw = true) {
    if (FINISHED === !!on) return;
    FINISHED = !!on;
    if (FINISHED) { setPlaying(false); ghostsBefore = ghosts.visible; ghosts.visible = false; selTask = null; selBld = null; clearHL(); } else ghosts.visible = ghostsBefore;
    tempG.visible = !FINISHED; finishG.visible = FINISHED; for (const g of stacks) g.visible = !FINISHED; siteGround.material = FINISHED ? M.paved : M.dirt;
    btnGhost.hidden = FINISHED || (!!loadModel && !REAL.loaded);
    for (const b of [btnFinish, btnFinish2]) b.setAttribute('aria-pressed', String(FINISHED));
    host.classList.toggle('s3d-finished', FINISHED);
    if (redraw) setDay(DAY);
  }
  btnFinish.onclick = () => setFinished(!FINISHED); btnFinish2.onclick = () => setFinished(!FINISHED);
  const tour = { on: false, i: 0, t: 0, dwell: 14 };
  function tourStart() { tour.on = true; tour.t = 0; controls.autoRotate = false; goView(VIEW_LIST[tour.i % VIEW_LIST.length][0]); btnTour.textContent = '⏸ Tham quan'; btnTour.setAttribute('aria-pressed', 'true'); invalidate(); }
  function tourStop() { if (!tour.on && !controls.autoRotate) return; tour.on = false; controls.autoRotate = false; btnTour.textContent = '▶ Tham quan'; btnTour.setAttribute('aria-pressed', 'false'); }
  btnTour.onclick = () => (tour.on ? tourStop() : tourStart());
  let presenting = false, before = null;
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  async function present(on) {
    if (on === presenting) return;
    presenting = on;
    if (on) {
      before = { motion, infoHidden, hq };
      host.classList.add('s3d-presenting'); setInfoHidden(true); setMotion(true, false); if (canHq && !swGl) setHq(true); tour.i = 0; tourStart();
      const req = frame.requestFullscreen || frame.webkitRequestFullscreen;
      let full = false; try { if (req) { await req.call(frame); full = true; } } catch { full = false; }
      if (!full) frame.classList.add('s3d-frame-present'); // iPhone / khung nhúng không cho toàn màn hình
    } else {
      host.classList.remove('s3d-presenting'); frame.classList.remove('s3d-frame-present'); tourStop();
      if (before) { setInfoHidden(before.infoHidden); setMotion(before.motion, false); setHq(before.hq); }
      if (fsElement() === frame) { try { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch { /* đã thoát */ } }
    }
    resize(); invalidate();
  }
  $('btnPresent').onclick = () => present(true); $('btnExit').onclick = () => present(false);
  const onFs = () => { if (presenting && fsElement() !== frame && !frame.classList.contains('s3d-frame-present')) present(false); else resize(); };
  listen(document, 'fullscreenchange', onFs); listen(document, 'webkitfullscreenchange', onFs);
  listen(window, 'keydown', e => { if (e.key === 'Escape' && presenting) present(false); });
  controls.addEventListener('start', () => { camT = 1; tourStop(); invalidate(); });
  controls.addEventListener('change', () => invalidate());

  /* ───────── Vòng vẽ ───────── */
  // Bản nhẹ (điện thoại / máy yếu): tối đa 30 khung / giây khi đang chuyển động — đỡ nóng máy, hao pin.
  const minFrameMs = HIGH ? 0 : 32;
  function tick(now) {
    raf = 0; if (disposed || !active) return;
    if (minFrameMs && lastTs && now - lastTs < minFrameMs) { raf = requestAnimationFrame(tick); return; }
    inTick = true;
    const dt = lastTs ? Math.min((now - lastTs) / 1000, 0.05) : 1 / 60; lastTs = now; frameNo += 1;
    let busy = false;
    if (playing) { busy = true; playAcc += dt; if (playAcc > 0.3) { playAcc = 0; if (DAY >= TODAY) setPlaying(false); else setDay(DAY + playStep); } }
    if (motion) {
      busy = true; t += dt;
      for (const g of [...Object.values(machines), pour.pump, ...pour.mixers]) if (g.visible && g.userData.anim) g.userData.anim(t);
      for (const [k2, [ax, base, amp, sp]] of Object.entries(MACH_MOVE)) if (machines[k2]?.visible) machines[k2].position[ax] = base + Math.sin(t * sp) * amp;
      stepCrew(dt, t);
      for (const d of DRIVERS) stepDriver(d, dt);
      for (const c of TRAFFIC) placeTraffic(c, c.v * dt);
    }
    if (machines.crane?.userData.hook) machines.crane.userData.hook.visible = machines.crane.visible;
    if (hlList.length && now < hlUntil + 400) { busy = true; const on = now < hlUntil && Math.floor(now / 280) % 2 === 0; for (const e of hlList) e.mesh.material = on ? M.hl : e.base; }
    if (camT < 1) { busy = true; camT = Math.min(1, camT + dt * 0.8); const e = camT < 0.5 ? 2 * camT * camT : -1 + (4 - 2 * camT) * camT; camera.position.lerpVectors(camFrom.p, camTo.p, e); controls.target.lerpVectors(camFrom.t, camTo.t, e); }
    if (tour.on) { busy = true; tour.t += dt; if (camT >= 1) controls.autoRotate = true; if (tour.t > tour.dwell) { tour.t = 0; tour.i += 1; controls.autoRotate = false; goView(VIEW_LIST[tour.i % VIEW_LIST.length][0]); } }
    if (controls.update(dt)) busy = true;
    if (!motion || frameNo % 8 === 0) lod();
    if (hq && composer) composer.render(); else renderer.render(scene, camera);
    labels.render(scene, camera); frames += 1;
    // Máy yếu: chuyển động ở chất lượng cao dưới ~14 khung / giây liên tục 3 giây thì tự tắt, báo một dòng.
    if (hq && motion) { slowMs = dt > 0.07 ? slowMs + dt * 1000 : 0; if (slowMs > 3000) { slowMs = 0; setHq(false); toast('Máy chậm, đã tắt Chất lượng cao'); } }
    if (busy) extraFrames = 2; else extraFrames -= 1;
    inTick = false;
    if (extraFrames > 0 && active && !disposed) raf = requestAnimationFrame(tick); else { extraFrames = 0; lastTs = 0; }
  }
  function resize() {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    if (w === W && h === H) return; W = w; H = h;
    camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.setSize(W, H); labels.setSize(W, H); composer?.setSize(W, H); invalidate();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null; ro?.observe(stage);

  buildTree(); setDay(TODAY);
  if (stage.clientWidth < 700) setInfoHidden(true);
  setMotion(motionInit, false);

  function setActive(on) { active = !!on && !disposed; if (active) { resize(); invalidate(); } else if (raf) { cancelAnimationFrame(raf); raf = 0; lastTs = 0; if (presenting) present(false); } }
  function dispose() {
    if (disposed) return;
    if (presenting) { try { if (fsElement() === frame) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } catch { /* bỏ qua */ } frame.classList.remove('s3d-frame-present'); }
    disposed = true; active = false; if (raf) cancelAnimationFrame(raf); raf = 0; clearTimeout(toastT);
    ro?.disconnect(); for (const d of disposers) d(); controls.dispose();
    clearCrew();
    const geos = new Set(CREW_GEOS), mats = new Set(MATS);
    scene.traverse(o => { if (o.geometry) geos.add(o.geometry); const m = o.material; for (const mm of Array.isArray(m) ? m : m ? [m] : []) mats.add(mm); if (o.userData?.orig) mats.add(o.userData.orig); if (o.isInstancedMesh) o.dispose(); });
    for (const g of geos) g.dispose();
    for (const m of mats) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); }
    for (const tx of TEXTURES) tx.dispose();
    if (composer) { for (const p of composer.passes) p.dispose?.(); composer.dispose(); } sky.material.dispose(); sky.geometry.dispose();
    scene.environment = null; renderer.dispose(); renderer.forceContextLoss?.();
    host.innerHTML = ''; host.classList.remove('s3d', 's3d-noinfo', 's3d-presenting');
  }
  return {
    setActive, setMotion: on => setMotion(on, false), present, dispose, loadModels: () => loadReal(), setHq,
    debug: {
      setDay, day: () => DAY, frames: () => frames, finished: () => FINISHED, setFinished: on => setFinished(on), setHq, hq: () => hq, softwareGl: () => swGl, hqTune: p => { Object.assign(HQP, p); applyHqParams(); }, presenting: () => presenting, infoHidden: () => infoHidden, motion: () => motion,
      view: v => { goView(v); camT = 1; camera.position.copy(camTo.p); controls.target.copy(camTo.t); controls.update(); invalidate(); },
      focus: (x, y, z, dist, ax = -1, ay = 0.6, az = 1) => { camT = 1; controls.target.set(x, y, z); camera.position.set(x + ax * dist, y + ay * dist, z + az * dist); controls.update(); invalidate(); },
      real: () => ({ loaded: REAL.loaded, meshes: REAL.meshes.length, tekla: TEKLA.length, mode: REAL.mode }),
      mode: m => { REAL.mode = m; btnGhost.textContent = btnGhostLabel[m]; setDay(DAY); },
      drivers: () => DRIVERS.map(d => ({ enabled: d.enabled, state: d.state, visible: d.g.visible, x: d.g.position.x, z: d.g.position.z })),
      selectTask, selectBuilding, toast,
    },
  };
}
