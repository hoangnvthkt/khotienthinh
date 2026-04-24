import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Bot, Plus, Edit2, Trash2, Save, X, MessageCircle, Clock, Smile, Zap, Heart, AlertCircle, ToggleLeft, ToggleRight } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

interface ChatbotMessage {
  id: string;
  message: string;
  type: 'greeting' | 'reminder' | 'fun' | 'motivation';
  emoji: string;
  time_range: string | null;
  is_active: boolean;
  created_at: string;
}

const TYPE_CONFIG = {
  greeting: { label: 'Chào hỏi', icon: Smile, color: 'amber', emoji: '👋' },
  reminder: { label: 'Nhắc nhở', icon: Clock, color: 'blue', emoji: '🔔' },
  fun: { label: 'Vui vẻ', icon: Zap, color: 'emerald', emoji: '😄' },
  motivation: { label: 'Động viên', icon: Heart, color: 'rose', emoji: '💪' },
} as const;

const SettingsChibiBot: React.FC = () => {
  const toast = useToast();
  const confirm = useConfirm();
  const [messages, setMessages] = useState<ChatbotMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMsg, setEditingMsg] = useState<ChatbotMessage | null>(null);
  const [form, setForm] = useState({
    message: '',
    type: 'fun' as ChatbotMessage['type'],
    emoji: '😊',
    time_range: '',
    is_active: true,
  });
  const [filterType, setFilterType] = useState<string>('all');

  // Load messages
  const fetchMessages = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('chatbot_messages')
      .select('*')
      .order('type', { ascending: true })
      .order('created_at', { ascending: false });
    if (data) setMessages(data);
    setLoading(false);
  };

  useEffect(() => { fetchMessages(); }, []);

  // CRUD
  const handleSave = async () => {
    if (!form.message.trim()) return;

    const payload = {
      message: form.message.trim(),
      type: form.type,
      emoji: form.emoji || '😊',
      time_range: form.time_range.trim() || null,
      is_active: form.is_active,
    };

    if (editingMsg) {
      await supabase.from('chatbot_messages').update(payload).eq('id', editingMsg.id);
    } else {
      await supabase.from('chatbot_messages').insert(payload);
    }

    setIsModalOpen(false);
    setEditingMsg(null);
    resetForm();
    fetchMessages();
    toast.success(editingMsg ? 'Cập nhật câu nói' : 'Thêm câu nói mới');
  };

  const handleDelete = async (id: string) => {
    const msg = messages.find(m => m.id === id);
    const ok = await confirm({ targetName: msg?.message?.slice(0, 40) || 'câu nói này', title: 'Xoá câu nói ChibiBot' });
    if (!ok) return;
    await supabase.from('chatbot_messages').delete().eq('id', id);
    fetchMessages();
    toast.success('Xoá câu nói thành công');
  };

  const handleToggle = async (msg: ChatbotMessage) => {
    await supabase.from('chatbot_messages').update({ is_active: !msg.is_active }).eq('id', msg.id);
    fetchMessages();
  };

  const handleEdit = (msg: ChatbotMessage) => {
    setEditingMsg(msg);
    setForm({
      message: msg.message,
      type: msg.type,
      emoji: msg.emoji,
      time_range: msg.time_range || '',
      is_active: msg.is_active,
    });
    setIsModalOpen(true);
  };

  const resetForm = () => {
    setForm({ message: '', type: 'fun', emoji: '😊', time_range: '', is_active: true });
    setEditingMsg(null);
  };

  const openAddModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const filteredMessages = filterType === 'all' ? messages : messages.filter(m => m.type === filterType);

  const typeCounts = messages.reduce((acc, m) => {
    acc[m.type] = (acc[m.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="animate-in slide-in-from-right-4 duration-300 space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-3xl p-6 text-white shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
              <Bot size={28} />
            </div>
            <div>
              <h2 className="text-xl font-black">Trợ lý ảo ChibiBot</h2>
              <p className="text-white/70 text-sm font-medium">Quản lý câu nói bong bóng chat ngẫu nhiên</p>
            </div>
          </div>
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 px-5 py-3 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-2xl font-black text-xs uppercase tracking-widest transition-all hover:scale-105"
          >
            <Plus size={16} /> Thêm câu nói
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          {(Object.entries(TYPE_CONFIG) as [keyof typeof TYPE_CONFIG, typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([key, cfg]) => (
            <div key={key} className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-2xl">{cfg.emoji}</span>
              <div>
                <p className="text-lg font-black">{typeCounts[key] || 0}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">{cfg.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterType('all')}
          className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
            filterType === 'all'
              ? 'bg-slate-800 text-white shadow-lg'
              : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
          }`}
        >
          Tất cả ({messages.length})
        </button>
        {(Object.entries(TYPE_CONFIG) as [keyof typeof TYPE_CONFIG, typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setFilterType(key)}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 ${
              filterType === key
                ? `bg-${cfg.color}-500 text-white shadow-lg`
                : `bg-white border border-slate-200 text-slate-500 hover:bg-slate-50`
            }`}
          >
            <span>{cfg.emoji}</span> {cfg.label} ({typeCounts[key] || 0})
          </button>
        ))}
      </div>

      {/* Messages List */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full mr-3" />
            Đang tải...
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-3">
              <MessageCircle size={28} className="text-slate-300" />
            </div>
            <p className="text-slate-400 font-medium text-sm">Chưa có câu nói nào</p>
            <button onClick={openAddModal} className="mt-3 text-indigo-500 text-xs font-bold hover:underline">
              + Thêm câu nói đầu tiên
            </button>
          </div>
        ) : (
          filteredMessages.map(msg => {
            const cfg = TYPE_CONFIG[msg.type];
            return (
              <div
                key={msg.id}
                className={`bg-white rounded-2xl border border-slate-100 p-5 hover:shadow-lg hover:border-indigo-100 transition-all group ${
                  !msg.is_active ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className={`w-10 h-10 bg-${cfg.color}-50 text-${cfg.color}-500 rounded-xl flex items-center justify-center shrink-0 text-lg`}>
                      {msg.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-700 leading-relaxed">{msg.message}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-${cfg.color}-50 text-${cfg.color}-600`}>
                          {cfg.emoji} {cfg.label}
                        </span>
                        {msg.time_range && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">
                            <Clock size={9} /> {msg.time_range}
                          </span>
                        )}
                        {!msg.is_active && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-500">
                            Đã tắt
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => handleToggle(msg)}
                      className={`p-2 rounded-xl transition-colors ${
                        msg.is_active
                          ? 'text-emerald-500 hover:bg-emerald-50'
                          : 'text-slate-400 hover:bg-slate-100'
                      }`}
                      title={msg.is_active ? 'Tắt' : 'Bật'}
                    >
                      {msg.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    </button>
                    <button
                      onClick={() => handleEdit(msg)}
                      className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => handleDelete(msg.id)}
                      className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg overflow-hidden">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-100 dark:border-slate-700 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/50 rounded-xl flex items-center justify-center">
                    <Bot size={20} className="text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-800 dark:text-white">
                      {editingMsg ? 'Sửa câu nói' : 'Thêm câu nói mới'}
                    </h3>
                    <p className="text-xs text-slate-500">ChibiBot sẽ nói câu này ngẫu nhiên</p>
                  </div>
                </div>
                <button
                  onClick={() => { setIsModalOpen(false); resetForm(); }}
                  className="p-2 hover:bg-slate-200/50 rounded-xl transition"
                >
                  <X size={18} className="text-slate-400" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              {/* Message */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nội dung *</label>
                <textarea
                  value={form.message}
                  onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  className="w-full p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                  rows={3}
                  placeholder="VD: Chào buổi sáng! Hôm nay bạn khỏe không? 🌅"
                />
                <p className="text-[10px] text-slate-400">Dùng {'{name}'} để thay bằng tên người dùng. VD: "Hi {'{name}'}, cháy nào!"</p>
              </div>

              {/* Type + Emoji */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loại</label>
                  <select
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}
                    className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.emoji} {cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Emoji</label>
                  <input
                    type="text"
                    value={form.emoji}
                    onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))}
                    className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 text-center text-2xl"
                    placeholder="😊"
                    maxLength={4}
                  />
                </div>
              </div>

              {/* Time Range */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Khung giờ hiển thị <span className="text-slate-300">(để trống = bất cứ lúc nào)</span>
                </label>
                <input
                  type="text"
                  value={form.time_range}
                  onChange={e => setForm(f => ({ ...f, time_range: e.target.value }))}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="VD: 08:00-09:00 (định dạng HH:MM-HH:MM)"
                />
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <AlertCircle size={14} className="text-slate-400" />
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Trạng thái hiển thị</span>
                </div>
                <button
                  onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                    form.is_active
                      ? 'bg-emerald-100 text-emerald-600'
                      : 'bg-red-100 text-red-500'
                  }`}
                >
                  {form.is_active ? <><ToggleRight size={14} /> Đang bật</> : <><ToggleLeft size={14} /> Đã tắt</>}
                </button>
              </div>

              {/* Preview */}
              <div className="bg-indigo-50 dark:bg-indigo-950/20 rounded-2xl p-4 border border-indigo-100 dark:border-indigo-900/30">
                <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">Xem trước</p>
                <div className="bg-white dark:bg-slate-800 rounded-xl px-4 py-3 shadow-sm border border-slate-100 dark:border-slate-700">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {form.emoji} {form.message || 'Nội dung câu nói...'}
                  </p>
                  <p className="text-[10px] text-indigo-400 mt-1 font-bold">💬 Nhấn để chat với AI</p>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 pt-0 grid grid-cols-2 gap-3">
              <button
                onClick={() => { setIsModalOpen(false); resetForm(); }}
                className="py-3 border border-slate-200 text-slate-500 rounded-xl font-bold text-xs hover:bg-slate-50 transition"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleSave}
                disabled={!form.message.trim()}
                className="py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs hover:bg-indigo-700 transition shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Save size={14} /> {editingMsg ? 'Cập nhật' : 'Thêm mới'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsChibiBot;
