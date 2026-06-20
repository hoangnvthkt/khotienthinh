import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Bot, BookOpen, Check, Database, FileText, LineChart, Loader2, Plus, RefreshCcw, Save, Sparkles, Trash2, X } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

type LearningTab = 'feedback' | 'memory' | 'rules' | 'glossary' | 'analytics';
type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'archived';

interface SettingsAiLearningProps {
  actorId: string;
}

const TABS: Array<{ id: LearningTab; label: string; icon: React.ElementType }> = [
  { id: 'feedback', label: 'Feedback Review', icon: Check },
  { id: 'memory', label: 'Memory', icon: Sparkles },
  { id: 'rules', label: 'Business Rules', icon: FileText },
  { id: 'glossary', label: 'Glossary', icon: BookOpen },
  { id: 'analytics', label: 'Analytics', icon: LineChart },
];

const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
  archived: 'Lưu trữ',
};

const statusClass = (status?: string) => {
  switch (status) {
    case 'approved': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
    case 'rejected': return 'bg-red-50 text-red-600 border-red-100';
    case 'archived': return 'bg-slate-100 text-slate-500 border-slate-200';
    default: return 'bg-amber-50 text-amber-600 border-amber-100';
  }
};

const emptyRuleForm = () => ({ title: '', content: '', domain: '', priority: 50, status: 'approved' as ReviewStatus });
const emptyGlossaryForm = () => ({ term: '', definition: '', aliases: '', domain: '', status: 'approved' as ReviewStatus });
const emptyMemoryForm = () => ({ content: '', category: 'correction', scope: 'enterprise', domain: '', importance: 3, status: 'approved' as ReviewStatus });

const SettingsAiLearning: React.FC<SettingsAiLearningProps> = ({ actorId }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<LearningTab>('feedback');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<any[]>([]);
  const [memory, setMemory] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [glossary, setGlossary] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [ruleForm, setRuleForm] = useState(emptyRuleForm);
  const [glossaryForm, setGlossaryForm] = useState(emptyGlossaryForm);
  const [memoryForm, setMemoryForm] = useState(emptyMemoryForm);

  const fetchData = async () => {
    setLoading(true);
    const [feedbackRes, memoryRes, rulesRes, glossaryRes, runsRes] = await Promise.all([
      supabase.from('ai_feedback').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('ai_memory').select('*').order('updated_at', { ascending: false }).limit(100),
      supabase.from('ai_business_rules').select('*').order('priority', { ascending: false }).order('updated_at', { ascending: false }).limit(100),
      supabase.from('ai_business_glossary').select('*').order('term', { ascending: true }).limit(100),
      supabase.from('ai_chat_runs').select('*').order('created_at', { ascending: false }).limit(120),
    ]);
    if (feedbackRes.data) setFeedback(feedbackRes.data);
    if (memoryRes.data) setMemory(memoryRes.data);
    if (rulesRes.data) setRules(rulesRes.data);
    if (glossaryRes.data) setGlossary(glossaryRes.data);
    if (runsRes.data) setRuns(runsRes.data);
    const firstError = feedbackRes.error || memoryRes.error || rulesRes.error || glossaryRes.error || runsRes.error;
    if (firstError) toast.error('Không tải được AI Learning', firstError.message);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const stats = useMemo(() => {
    const totalRuns = runs.length;
    const successRuns = runs.filter(r => r.status === 'success').length;
    const avgMs = runs.length
      ? Math.round(runs.reduce((sum, r) => sum + Number(r.response_time_ms || 0), 0) / runs.length)
      : 0;
    return {
      pendingFeedback: feedback.filter(f => f.status === 'pending').length,
      approvedMemory: memory.filter(m => m.status === 'approved').length,
      approvedRules: rules.filter(r => r.status === 'approved').length,
      glossaryTerms: glossary.filter(g => g.status === 'approved').length,
      successRate: totalRuns ? Math.round((successRuns / totalRuns) * 100) : 0,
      avgMs,
    };
  }, [feedback, glossary, memory, rules, runs]);

  const updateFeedbackStatus = async (row: any, status: ReviewStatus) => {
    const { error } = await supabase
      .from('ai_feedback')
      .update({
        status,
        reviewed_by: actorId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (error) {
      toast.error('Không cập nhật được feedback', error.message);
      return;
    }
    toast.success('Đã cập nhật feedback');
    fetchData();
  };

  const approveFeedbackAsMemory = async (row: any) => {
    const content = String(row.approved_answer || row.correction_text || row.answer || '').trim();
    if (!content) {
      toast.error('Thiếu nội dung memory', 'Feedback này chưa có correction hoặc câu trả lời để duyệt.');
      return;
    }
    const { error } = await supabase.from('ai_memory').insert({
      user_id: null,
      scope: 'enterprise',
      category: 'correction',
      content,
      status: 'approved',
      importance: 4,
      source: 'feedback',
      source_message_id: row.ai_message_id || null,
      approved_by: actorId,
      approved_at: new Date().toISOString(),
      metadata: {
        feedbackId: row.id,
        question: row.question || null,
      },
    });
    if (error) {
      toast.error('Không tạo được memory', error.message);
      return;
    }
    await updateFeedbackStatus(row, 'approved');
  };

  const saveRule = async () => {
    if (!ruleForm.title.trim() || !ruleForm.content.trim()) return;
    const { error } = await supabase.from('ai_business_rules').insert({
      title: ruleForm.title.trim(),
      content: ruleForm.content.trim(),
      domain: ruleForm.domain.trim() || null,
      priority: Number(ruleForm.priority || 50),
      status: ruleForm.status,
      created_by: actorId,
      approved_by: ruleForm.status === 'approved' ? actorId : null,
      approved_at: ruleForm.status === 'approved' ? new Date().toISOString() : null,
    });
    if (error) return toast.error('Không lưu được rule', error.message);
    setRuleForm(emptyRuleForm());
    toast.success('Đã thêm business rule');
    fetchData();
  };

  const saveGlossary = async () => {
    if (!glossaryForm.term.trim() || !glossaryForm.definition.trim()) return;
    const { error } = await supabase.from('ai_business_glossary').insert({
      term: glossaryForm.term.trim(),
      definition: glossaryForm.definition.trim(),
      aliases: glossaryForm.aliases.split(',').map(v => v.trim()).filter(Boolean),
      domain: glossaryForm.domain.trim() || null,
      status: glossaryForm.status,
      created_by: actorId,
      approved_by: glossaryForm.status === 'approved' ? actorId : null,
      approved_at: glossaryForm.status === 'approved' ? new Date().toISOString() : null,
    });
    if (error) return toast.error('Không lưu được glossary', error.message);
    setGlossaryForm(emptyGlossaryForm());
    toast.success('Đã thêm thuật ngữ');
    fetchData();
  };

  const saveMemory = async () => {
    if (!memoryForm.content.trim()) return;
    const { error } = await supabase.from('ai_memory').insert({
      user_id: memoryForm.scope === 'user' ? actorId : null,
      scope: memoryForm.scope,
      category: memoryForm.category,
      content: memoryForm.content.trim(),
      domain: memoryForm.domain.trim() || null,
      importance: Number(memoryForm.importance || 3),
      status: memoryForm.status,
      source: 'manual',
      approved_by: memoryForm.status === 'approved' ? actorId : null,
      approved_at: memoryForm.status === 'approved' ? new Date().toISOString() : null,
    });
    if (error) return toast.error('Không lưu được memory', error.message);
    setMemoryForm(emptyMemoryForm());
    toast.success('Đã thêm memory');
    fetchData();
  };

  const setRowStatus = async (table: 'ai_memory' | 'ai_business_rules' | 'ai_business_glossary', id: string, status: ReviewStatus) => {
    const payload: Record<string, any> = { status, updated_at: new Date().toISOString() };
    if (status === 'approved') {
      payload.approved_by = actorId;
      payload.approved_at = new Date().toISOString();
    }
    const { error } = await supabase.from(table).update(payload).eq('id', id);
    if (error) return toast.error('Không cập nhật được trạng thái', error.message);
    fetchData();
  };

  const deleteRow = async (table: 'ai_memory' | 'ai_business_rules' | 'ai_business_glossary', id: string, label: string) => {
    const ok = await confirm({ title: 'Xoá AI Learning item', targetName: label });
    if (!ok) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return toast.error('Không xoá được item', error.message);
    toast.success('Đã xoá item');
    fetchData();
  };

  const renderStatusActions = (
    table: 'ai_memory' | 'ai_business_rules' | 'ai_business_glossary',
    row: any,
    label: string,
  ) => (
    <div className="flex items-center gap-1">
      <button onClick={() => setRowStatus(table, row.id, 'approved')} className="w-8 h-8 rounded-lg text-emerald-500 hover:bg-emerald-50" title="Duyệt">
        <Check size={15} />
      </button>
      <button onClick={() => setRowStatus(table, row.id, 'archived')} className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100" title="Lưu trữ">
        <X size={15} />
      </button>
      <button onClick={() => deleteRow(table, row.id, label)} className="w-8 h-8 rounded-lg text-red-400 hover:bg-red-50" title="Xoá">
        <Trash2 size={15} />
      </button>
    </div>
  );

  return (
    <div className="animate-in slide-in-from-right-4 duration-300 space-y-5">
      <div className="rounded-2xl bg-slate-900 text-white p-5 shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center">
              <Bot size={24} />
            </div>
            <div>
              <h2 className="text-lg font-black">AI Learning</h2>
              <p className="text-xs text-white/60">Quản lý tri thức đã duyệt cho ChibiBot và AI Assistant</p>
            </div>
          </div>
          <button onClick={fetchData} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-black">
            <RefreshCcw size={14} /> Làm mới
          </button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 mt-5">
          {[
            ['Feedback chờ', stats.pendingFeedback],
            ['Memory duyệt', stats.approvedMemory],
            ['Rules duyệt', stats.approvedRules],
            ['Glossary', stats.glossaryTerms],
            ['Success rate', `${stats.successRate}%`],
            ['Avg latency', `${stats.avgMs}ms`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-white/10 px-3 py-2.5">
              <p className="text-lg font-black">{value}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/50 font-bold">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black border transition ${
                activeTab === tab.id
                  ? 'bg-slate-900 text-white border-slate-900 shadow-lg'
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Icon size={14} /> {tab.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 size={20} className="animate-spin mr-2" /> Đang tải AI Learning...
        </div>
      ) : (
        <>
          {activeTab === 'feedback' && (
            <div className="space-y-3">
              {feedback.map(row => (
                <div key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-black ${statusClass(row.status)}`}>{STATUS_LABEL[row.status as ReviewStatus] || row.status}</span>
                        <span className={`text-[10px] font-black ${row.rating === 1 ? 'text-emerald-500' : 'text-red-500'}`}>{row.rating === 1 ? 'Positive' : 'Negative'}</span>
                        <span className="text-[10px] text-slate-400">{new Date(row.created_at).toLocaleString('vi-VN')}</span>
                      </div>
                      <p className="mt-2 text-xs font-bold text-slate-500">Q: {row.question || 'Không có câu hỏi lưu kèm'}</p>
                      <p className="mt-1 text-sm text-slate-700 line-clamp-3">{row.correction_text || row.approved_answer || row.reason || row.comment || row.answer}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => approveFeedbackAsMemory(row)} className="w-9 h-9 rounded-xl text-emerald-500 hover:bg-emerald-50" title="Duyệt thành memory">
                        <Sparkles size={16} />
                      </button>
                      <button onClick={() => updateFeedbackStatus(row, 'rejected')} className="w-9 h-9 rounded-xl text-red-400 hover:bg-red-50" title="Từ chối">
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {feedback.length === 0 && <EmptyState label="Chưa có feedback AI" />}
            </div>
          )}

          {activeTab === 'memory' && (
            <div className="space-y-4">
              <EditorBand>
                <textarea value={memoryForm.content} onChange={e => setMemoryForm({ ...memoryForm, content: e.target.value })} rows={3} className="field col-span-2" placeholder="Memory content đã kiểm chứng..." />
                <select value={memoryForm.category} onChange={e => setMemoryForm({ ...memoryForm, category: e.target.value })} className="field">
                  <option value="company_fact">Company fact</option>
                  <option value="query_pattern">Query pattern</option>
                  <option value="preference">Preference</option>
                  <option value="correction">Correction</option>
                </select>
                <select value={memoryForm.scope} onChange={e => setMemoryForm({ ...memoryForm, scope: e.target.value })} className="field">
                  <option value="enterprise">Enterprise</option>
                  <option value="domain">Domain</option>
                  <option value="user">User</option>
                </select>
                <input value={memoryForm.domain} onChange={e => setMemoryForm({ ...memoryForm, domain: e.target.value })} className="field" placeholder="Domain" />
                <button onClick={saveMemory} className="primary-btn"><Plus size={14} /> Thêm memory</button>
              </EditorBand>
              {memory.map(row => (
                <ListRow key={row.id} status={row.status} title={`${row.scope}/${row.category}`} body={row.content} meta={row.domain || 'global'} actions={renderStatusActions('ai_memory', row, row.content?.slice(0, 40) || 'memory')} />
              ))}
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="space-y-4">
              <EditorBand>
                <input value={ruleForm.title} onChange={e => setRuleForm({ ...ruleForm, title: e.target.value })} className="field" placeholder="Tên rule" />
                <input value={ruleForm.domain} onChange={e => setRuleForm({ ...ruleForm, domain: e.target.value })} className="field" placeholder="Domain" />
                <input type="number" value={ruleForm.priority} onChange={e => setRuleForm({ ...ruleForm, priority: Number(e.target.value) })} className="field" min={0} max={100} />
                <textarea value={ruleForm.content} onChange={e => setRuleForm({ ...ruleForm, content: e.target.value })} rows={3} className="field col-span-2" placeholder="Nội dung rule nghiệp vụ..." />
                <button onClick={saveRule} className="primary-btn"><Save size={14} /> Lưu rule</button>
              </EditorBand>
              {rules.map(row => (
                <ListRow key={row.id} status={row.status} title={row.title} body={row.content} meta={`${row.domain || 'global'} · priority ${row.priority}`} actions={renderStatusActions('ai_business_rules', row, row.title)} />
              ))}
            </div>
          )}

          {activeTab === 'glossary' && (
            <div className="space-y-4">
              <EditorBand>
                <input value={glossaryForm.term} onChange={e => setGlossaryForm({ ...glossaryForm, term: e.target.value })} className="field" placeholder="Thuật ngữ" />
                <input value={glossaryForm.aliases} onChange={e => setGlossaryForm({ ...glossaryForm, aliases: e.target.value })} className="field" placeholder="Aliases, cách nhau bằng dấu phẩy" />
                <input value={glossaryForm.domain} onChange={e => setGlossaryForm({ ...glossaryForm, domain: e.target.value })} className="field" placeholder="Domain" />
                <textarea value={glossaryForm.definition} onChange={e => setGlossaryForm({ ...glossaryForm, definition: e.target.value })} rows={3} className="field col-span-2" placeholder="Định nghĩa nội bộ..." />
                <button onClick={saveGlossary} className="primary-btn"><Plus size={14} /> Thêm thuật ngữ</button>
              </EditorBand>
              {glossary.map(row => (
                <ListRow key={row.id} status={row.status} title={row.term} body={row.definition} meta={`${row.domain || 'global'}${row.aliases?.length ? ` · ${row.aliases.join(', ')}` : ''}`} actions={renderStatusActions('ai_business_glossary', row, row.term)} />
              ))}
            </div>
          )}

          {activeTab === 'analytics' && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_0.8fr] gap-3 px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <span>Câu hỏi</span><span>Tool</span><span>Status</span><span>Latency</span><span>Time</span>
              </div>
              {runs.map(row => (
                <div key={row.id} className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_0.8fr] gap-3 px-4 py-3 text-xs border-b border-slate-50 last:border-b-0">
                  <span className="font-medium text-slate-700 truncate">{row.question || '-'}</span>
                  <span className="text-slate-500 truncate">{row.tool_name || row.route_action || '-'}</span>
                  <span className={`font-black ${row.status === 'success' ? 'text-emerald-500' : row.status === 'error' ? 'text-red-500' : 'text-amber-500'}`}>{row.status}</span>
                  <span className="text-slate-500">{row.response_time_ms || 0}ms</span>
                  <span className="text-slate-400">{new Date(row.created_at).toLocaleString('vi-VN')}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <style>{`
        .field {
          border: 1px solid rgb(226 232 240);
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 13px;
          outline: none;
          background: white;
        }
        .field:focus { border-color: rgb(99 102 241); }
        .primary-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 12px;
          background: rgb(15 23 42);
          color: white;
          padding: 10px 14px;
          font-size: 12px;
          font-weight: 900;
        }
      `}</style>
    </div>
  );
};

const EditorBand: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    {children}
  </div>
);

const ListRow: React.FC<{ status: string; title: string; body: string; meta?: string; actions: React.ReactNode }> = ({ status, title, body, meta, actions }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-black text-slate-800">{title}</h3>
          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-black ${statusClass(status)}`}>{STATUS_LABEL[status as ReviewStatus] || status}</span>
        </div>
        {meta && <p className="text-[11px] text-slate-400 font-bold mt-1">{meta}</p>}
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">{body}</p>
      </div>
      <div className="shrink-0">{actions}</div>
    </div>
  </div>
);

const EmptyState: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
    <Database size={28} className="mb-2 text-slate-300" />
    <p className="text-sm font-bold">{label}</p>
  </div>
);

export default SettingsAiLearning;
