// Sổ tay Vioo (B3, 22/10/2026) — dựng danh sách mục "làm sao để…" cho công cụ so_tay của Trợ lý từ ba nguồn:
//   1. docs/so-tay/*.md (mục viết tay, frontmatter + bước), 2. hướng dẫn Dự án docs/huong-dan-su-dung-phong-quan-ly-du-an.md
//   (mỗi mục có "Các bước thực hiện"), 3. danh mục màn hình / thao tác trong mã (lib/search/searchCatalog.ts).
// Thuần hàm (không đọc tệp) để vitest kiểm được và test so khớp tệp đã sinh.

export const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
export const slug = (s) => stripAccents(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const squeeze = (s) => s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
export const MAX_BODY = 1200;

/** Frontmatter đơn giản `key: value` giữa hai dòng ---. */
export const parseFrontmatter = (md) => {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(md.replace(/\r\n/g, '\n'));
  if (!m) return { meta: {}, body: md.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return { meta, body: m[2].trim() };
};
/** "route|Nhãn;route2|Nhãn2" → [{ route, label }]. */
export const parseRoutes = (s) => String(s || '').split(';').map(x => x.trim()).filter(Boolean).map(x => { const [route, label] = x.split('|'); return { route: route.trim(), label: (label || route).trim() }; });

export const entriesFromDocs = (files) => files.filter(f => !/readme\.md$/i.test(f.name)).map(f => {
  const { meta, body } = parseFrontmatter(f.text);
  const id = `so-tay-${slug(f.name.replace(/\.md$/i, ''))}`;
  return { id, title: meta.title || f.name, module: meta.module || 'Chung', routes: parseRoutes(meta.routes), permission: meta.permission || null,
    keywords: squeeze(stripAccents(`${meta.keywords || ''} ${meta.title || ''}`)), body: squeeze(body).slice(0, MAX_BODY), source: 'docs' };
});

/** Hướng dẫn Dự án: mục ## N. / ### N.M. có "Các bước thực hiện" → một mục sổ tay (mục đích + bước + lưu ý + lỗi hay gặp). */
export const entriesFromGuide = (text, guideName = 'huong-dan-su-dung-phong-quan-ly-du-an') => {
  const src = text.replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const sections = [];
  let current = null; let h2 = '';
  for (const line of lines) {
    const m2 = /^## (\d+)\.\s*(.+)$/.exec(line); const m3 = /^### (\d+\.\d+)\.\s*(.+)$/.exec(line);
    if (m2) { if (current) sections.push(current); h2 = m2[2].trim(); current = { num: m2[1], title: h2, parent: null, lines: [] }; continue; }
    if (m3) { if (current) sections.push(current); current = { num: m3[1], title: m3[2].trim(), parent: h2, lines: [] }; continue; }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);
  const part = (sec, name) => {
    const re = new RegExp(`^#{3,4} ${name}\\s*$`);
    const i = sec.lines.findIndex(l => re.test(l));
    if (i < 0) return '';
    const out = [];
    for (const l of sec.lines.slice(i + 1)) { if (/^#{2,4} /.test(l)) break; if (/\[HÌNH MINH HỌA/.test(l)) continue; out.push(l); }
    return squeeze(out.join('\n'));
  };
  const out = [];
  for (const sec of sections) {
    const steps = part(sec, 'Các bước thực hiện');
    if (!steps) continue;
    const purpose = part(sec, 'Mục đích'); const notes = part(sec, 'Lưu ý'); const errors = part(sec, 'Lỗi thường gặp và cách xử lý');
    const title = sec.parent && !/^Tab /.test(sec.parent) ? sec.title : sec.parent ? `${sec.parent.replace(/^Tab /, '')} · ${sec.title}` : sec.title;
    const allText = `${purpose}\n${steps}\n${notes}`;
    const routeMatch = /route `(\/[a-z0-9/_-]*)`/i.exec(allText);
    const body = squeeze([purpose ? `**Khi nào:** ${purpose}` : '', `**Các bước:**\n${steps}`, notes ? `**Lưu ý:**\n${notes}` : '', errors ? `**Lỗi hay gặp:**\n${errors}` : ''].filter(Boolean).join('\n')).slice(0, MAX_BODY);
    out.push({ id: `du-an-${sec.num.replace('.', '-')}-${slug(sec.title)}`, title: `Dự án: ${title}`, module: 'Dự án', routes: [{ route: routeMatch ? routeMatch[1] : '/da', label: 'Dự án' }],
      permission: null, keywords: squeeze(stripAccents(`${title} ${sec.parent || ''} du an`)), body, source: guideName });
  }
  return out;
};

/** Danh mục trong mã: thao tác nhanh (quickActionDefs) + màn hình ngoài thanh bên (EXTRA_PAGES) với từ khóa ẩn (ROUTE_KEYWORDS). */
export const entriesFromCatalog = ({ quickActions, extraPages, routeKeywords }) => {
  const actions = quickActions.map(a => ({
    id: `thao-tac-${slug(a.id)}`, title: a.title, module: a.context, routes: [{ route: a.route || a.gate, label: a.title }], permission: null,
    keywords: squeeze(stripAccents(`${a.keywords} ${a.title} ${a.subtitle}`)),
    body: `**${a.title}** — ${a.subtitle}.\n**Cách mở:** gõ "${a.title.toLowerCase()}" vào ô Tìm kiếm rồi chọn thao tác${a.needsProject ? ' (chọn dự án trước)' : ''}${a.modal ? ' — form mở ngay tại chỗ' : ''}${a.route ? `, hoặc mở màn ${a.route}` : ''}.`,
    source: 'catalog',
  }));
  const pages = extraPages.map(p => ({
    id: `man-${slug(p.route) || 'home'}`, title: `Màn hình ${p.title}`, module: p.context, routes: [{ route: p.route, label: p.title }], permission: null,
    keywords: squeeze(stripAccents(`${routeKeywords[p.route] || ''} ${p.title} ${p.context}`)),
    body: `**${p.title}** (${p.context}) — mở từ thanh bên hoặc gõ "${p.title.toLowerCase()}" ở ô Tìm kiếm.`, source: 'catalog',
  }));
  return [...actions, ...pages];
};

export const buildHandbook = ({ docs, guide, catalog }) => {
  const entries = [...entriesFromDocs(docs), ...entriesFromGuide(guide), ...entriesFromCatalog(catalog)];
  const seen = new Set();
  for (const e of entries) { if (seen.has(e.id)) throw new Error(`trùng id sổ tay: ${e.id}`); seen.add(e.id); }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
};

export const renderGenerated = (entries) => `// SINH TỰ ĐỘNG bởi scripts/handbook/build.mjs — không sửa tay. Nguồn: docs/so-tay/*.md, docs/huong-dan-su-dung-phong-quan-ly-du-an.md,
// lib/search/searchCatalog.ts. Chạy lại: npm run handbook:build (test assistantHandbook báo đỏ nếu quên).
export interface HandbookEntry {
  id: string; title: string; module: string; routes: Array<{ route: string; label: string }>; permission: string | null;
  /** Từ khóa + tiêu đề đã bỏ dấu, chữ thường — để khớp câu hỏi. */
  keywords: string; body: string; source: string;
}
export const HANDBOOK: HandbookEntry[] = ${JSON.stringify(entries, null, 1)};
`;
