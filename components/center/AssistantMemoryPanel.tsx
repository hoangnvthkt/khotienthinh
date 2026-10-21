import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { aliasNorm } from '../../lib/aiLearning';
import { habitTitle, type MemoryActions, type PersonalMemory, type SharedGroup } from '../../lib/aiMemory';

// Trợ lý v2 · T4b "AI đã nhớ gì" (chủ SP duyệt 18/10/2026): một chỗ xem mọi điều Trợ lý đang nhớ và tự bấm Quên.
//   Của tôi  — ghi nhớ (tự viết / bấm Lưu trên thẻ "nhớ giúp") + lựa chọn đã nhớ (người duyệt, kho) — chỉ mình thấy.
//   Cách gọi chung — chữ người dùng gọi → mã / NCC / hạng mục / tổ đội, theo phạm vi mình có quyền dạy; quên là quên cho mọi người.

const KIND_LABEL: Record<string, string> = { item: 'Vật tư', vendor: 'NCC', task: 'Hạng mục', crew: 'Tổ đội', area: 'Mũi' };
const NOTE_EXAMPLES = ['Phụ trách dự án SMB-2026', 'Trả lời ngắn gọn, số liệu trước', 'Đơn mua thép thường chọn kho Sơn Miền Bắc'];
const NOTE_LIMIT = 30;
const ddmm = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : ''; };

type Load<T> = T | 'loading' | 'error';

const AssistantMemoryPanel: React.FC<{ actions: MemoryActions; you: string; onClose: () => void }> = ({ actions, you, onClose }) => {
  const [tab, setTab] = useState<'mine' | 'shared'>('mine');
  const [personal, setPersonal] = useState<Load<PersonalMemory>>('loading');
  const [shared, setShared] = useState<Load<SharedGroup[]>>('loading');
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const You = you.charAt(0).toUpperCase() + you.slice(1);

  const loadPersonal = useCallback(() => { setPersonal('loading'); actions.personal().then(setPersonal, () => setPersonal('error')); }, [actions]);
  const loadShared = useCallback(() => { setShared('loading'); actions.shared().then(setShared, () => setShared('error')); }, [actions]);
  useEffect(() => { loadPersonal(); loadShared(); }, [loadPersonal, loadShared]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length < 3) { setMessage({ tone: 'error', text: 'Ghi nhớ quá ngắn.' }); return; }
    setAdding(true); setMessage(null);
    try {
      const saved = await actions.addNote(text);
      setDraft('');
      setMessage({ tone: 'ok', text: saved.created ? 'Đã lưu ghi nhớ.' : 'Ghi nhớ này đã có.' });
      loadPersonal();
    } catch (e) { setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Chưa lưu được.' }); } finally { setAdding(false); }
  };

  const forget = async (scope: 'personal' | 'shared', id: string) => {
    setBusyId(id); setMessage(null); setConfirmId(null);
    try {
      await actions.forget(scope, id);
      if (scope === 'personal') setPersonal(p => (typeof p === 'object' ? { notes: p.notes.filter(n => n.id !== id), habits: p.habits.filter(h => h.id !== id) } : p));
      else setShared(g => (Array.isArray(g) ? g.map(x => ({ ...x, items: x.items.filter(i => i.id !== id) })).filter(x => x.items.length) : g));
      setMessage({ tone: 'ok', text: 'Đã quên.' });
    } catch (e) { setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Chưa quên được.' }); } finally { setBusyId(null); }
  };

  const groups = useMemo(() => {
    if (!Array.isArray(shared)) return shared;
    const q = aliasNorm(query);
    if (!q) return shared;
    return shared.map(g => ({ ...g, items: g.items.filter(i => aliasNorm(`${i.alias} ${i.target}`).includes(q)) })).filter(g => g.items.length);
  }, [shared, query]);
  const noteCount = typeof personal === 'object' ? personal.notes.length : null;
  const sharedCount = Array.isArray(shared) ? shared.reduce((n, g) => n + g.items.length, 0) : null;

  return (
    <div className="vcc-mem" role="region" aria-label="Trí nhớ của Trợ lý">
      <div className="vcc-chat-col">
        <div className="vcc-mem-head">
          <button type="button" className="vcc-btn" onClick={onClose}><ArrowLeft size={14} /> Về hội thoại</button>
          <div>
            <h3>Trí nhớ của Trợ lý</h3>
            <p>Chỉ nhớ điều {you} đã xác nhận · Quên là xóa hẳn</p>
          </div>
        </div>
        <div className="vcc-mem-tabs" role="tablist" aria-label="Loại trí nhớ">
          <button type="button" role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}>Của {you}{noteCount != null && typeof personal === 'object' ? ` · ${noteCount + personal.habits.length}` : ''}</button>
          <button type="button" role="tab" aria-selected={tab === 'shared'} onClick={() => setTab('shared')} title="Chữ người dùng gọi → mã, NCC, hạng mục đã xác nhận khi gửi / lưu; dùng chung trong dự án / Mua hàng">Cách gọi chung{sharedCount != null ? ` · ${sharedCount}` : ''}</button>
        </div>
        {message && <p className="vcc-mem-msg" data-tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>{message.tone === 'error' && <AlertTriangle size={13} aria-hidden="true" />} {message.text}</p>}

        {tab === 'mine' && (
          <div role="tabpanel" aria-label={`Của ${you}`}>
            <section className="vcc-mem-sec" aria-label="Ghi nhớ">
              <h4>Ghi nhớ {noteCount != null && <span>{noteCount}/{NOTE_LIMIT}</span>}</h4>
              <form className="vcc-mem-add" onSubmit={e => void add(e)}>
                <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={300} aria-label="Ghi nhớ mới" placeholder="Điều Trợ lý nên nhớ" disabled={adding} />
                <button type="submit" className="vcc-btn" data-pri="true" disabled={adding || draft.trim().length < 3}>{adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Thêm</button>
              </form>
              {personal === 'loading' && <p className="vcc-mem-empty" role="status"><Loader2 size={13} className="animate-spin" /> Đang tải…</p>}
              {personal === 'error' && <p className="vcc-mem-empty" role="alert">Chưa đọc được trí nhớ. <button type="button" className="vcc-mem-link" onClick={loadPersonal}>Thử lại</button></p>}
              {typeof personal === 'object' && personal.notes.length === 0 && (
                <div className="vcc-mem-empty">
                  <p>Chưa có ghi nhớ. Gõ ở trên, hoặc nói với Trợ lý “nhớ giúp …”. Ví dụ:</p>
                  <div className="vcc-mem-examples">{NOTE_EXAMPLES.map(x => <button key={x} type="button" className="vcc-chip" onClick={() => setDraft(x)}>{x}</button>)}</div>
                </div>
              )}
              {typeof personal === 'object' && personal.notes.length > 0 && (
                <ul className="vcc-mem-list">
                  {personal.notes.map(n => (
                    <li key={n.id}>
                      <div className="vcc-mem-main"><p>{n.text}</p><span>{n.source === 'assistant' ? 'Từ hội thoại' : `${You} viết`} · {ddmm(n.createdAt)}</span></div>
                      <button type="button" className="vcc-mem-forget" onClick={() => void forget('personal', n.id)} disabled={busyId === n.id} aria-label={`Quên ghi nhớ: ${n.text}`}>
                        {busyId === n.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Quên</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="vcc-mem-sec" aria-label="Lựa chọn đã nhớ">
              <h4>Lựa chọn đã nhớ</h4>
              {typeof personal === 'object' && personal.habits.length === 0 && <p className="vcc-mem-empty">Gửi đề xuất / đơn mua trên thẻ Trợ lý, lần sau thẻ chọn sẵn người duyệt và kho {you} đã chọn.</p>}
              {typeof personal === 'object' && personal.habits.length > 0 && (
                <ul className="vcc-mem-list">
                  {personal.habits.map(h => (
                    <li key={h.id}>
                      <div className="vcc-mem-main"><p>{habitTitle(h)}: <b>{h.label}</b></p><span>{h.hits} lần · {ddmm(h.updatedAt)}</span></div>
                      <button type="button" className="vcc-mem-forget" onClick={() => void forget('personal', h.id)} disabled={busyId === h.id} aria-label={`Quên lựa chọn: ${habitTitle(h)}`}>
                        {busyId === h.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Quên</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {tab === 'shared' && (
          <div role="tabpanel" aria-label="Cách gọi chung">
            {Array.isArray(shared) && sharedCount! > 8 && (
              <label className="vcc-mem-search"><Search size={14} aria-hidden="true" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm cách gọi hoặc mã" aria-label="Tìm cách gọi" /></label>
            )}
            {groups === 'loading' && <p className="vcc-mem-empty" role="status"><Loader2 size={13} className="animate-spin" /> Đang tải…</p>}
            {groups === 'error' && <p className="vcc-mem-empty" role="alert">Chưa đọc được cách gọi chung. <button type="button" className="vcc-mem-link" onClick={loadShared}>Thử lại</button></p>}
            {Array.isArray(groups) && groups.length === 0 && (
              <p className="vcc-mem-empty">{query ? 'Không thấy cách gọi nào khớp.' : `Chưa có cách gọi nào được nhớ ở phạm vi ${you} phụ trách.`}</p>
            )}
            {Array.isArray(groups) && groups.map(g => (
              <details key={g.key} className="vcc-mem-group" open={groups.length <= 3 || Boolean(query)}>
                <summary><b>{g.title}</b> <span>{g.items.length}</span></summary>
                <ul className="vcc-mem-list">
                  {g.items.map(i => (
                    <li key={i.id}>
                      <div className="vcc-mem-main">
                        <p>“{i.alias}” → <b>{i.target}</b></p>
                        <span>{KIND_LABEL[i.kind] || i.kind} · {i.hits} lần{i.by ? ` · ${i.by}` : ''} · {ddmm(i.lastUsedAt)}</span>
                      </div>
                      {confirmId === i.id ? (
                        <span className="vcc-mem-confirm" role="group" aria-label={`Xác nhận quên “${i.alias}”`}>
                          <span>Quên cho mọi người?</span>
                          <button type="button" className="vcc-mem-forget" data-danger="true" onClick={() => void forget('shared', i.id)}>Quên</button>
                          <button type="button" className="vcc-mem-forget" onClick={() => setConfirmId(null)}>Giữ</button>
                        </span>
                      ) : (
                        <button type="button" className="vcc-mem-forget" onClick={() => setConfirmId(i.id)} disabled={busyId === i.id} aria-label={`Quên cách gọi: ${i.alias}`}>
                          {busyId === i.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Quên</button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AssistantMemoryPanel;
