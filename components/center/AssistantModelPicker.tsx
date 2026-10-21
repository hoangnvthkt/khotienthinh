import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, EyeOff } from 'lucide-react';
import type { MyAiModel } from '../../lib/aiGateway';

// Chọn model ngay ở ô hỏi (chủ SP 18/10/2026, học từ màn /ai cũ — thẻ model nhưng đặt dưới ô hỏi): chỉ hiện các model Quản trị AI đã cấp
// (Trung tâm AI). Một model → nhãn tĩnh; nhiều model → menu thẻ: biểu tượng, tên, mô tả, "không đọc ảnh". Lựa chọn nhớ trên máy.

export const MODEL_STORAGE_KEY = 'vcc-assistant-model';
export const readStoredModel = () => { try { return localStorage.getItem(MODEL_STORAGE_KEY); } catch { return null; } };
export const storeModel = (id: string) => { try { localStorage.setItem(MODEL_STORAGE_KEY, id); } catch { /* chế độ riêng tư */ } };

/** Model dùng cho câu này: model đang chọn; có ảnh mà model không đọc ảnh → model đọc ảnh đầu tiên được cấp. */
export const modelForTurn = (models: readonly MyAiModel[], chosenId: string | null, hasImages: boolean): { model: MyAiModel | null; switched: boolean } => {
  const chosen = models.find(m => m.id === chosenId) || models.find(m => m.isDefault) || models[0] || null;
  if (!chosen || !hasImages || chosen.vision) return { model: chosen, switched: false };
  const vision = models.find(m => m.vision);
  return vision ? { model: vision, switched: true } : { model: chosen, switched: false };
};

const AssistantModelPicker: React.FC<{ models: MyAiModel[]; value: string | null; onChange: (id: string) => void; disabled?: boolean }> = ({ models, value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const current = models.find(m => m.id === value) || models.find(m => m.isDefault) || models[0];
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  if (!current) return null;
  if (models.length === 1) {
    return <span className="vcc-model" data-static="true" title={current.blurb || current.model}>{current.icon && <span aria-hidden="true">{current.icon}</span>}<span className="vcc-model-name">{current.name}</span></span>;
  }
  return (
    <div className="vcc-model-wrap" ref={box}>
      <button type="button" className="vcc-model" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen(o => !o)}
        aria-label={`Model: ${current.name}. Đổi model`} title={current.blurb || current.model}>
        {current.icon && <span aria-hidden="true">{current.icon}</span>}<span className="vcc-model-name">{current.name}</span><ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="vcc-model-menu" role="listbox" aria-label="Chọn model AI">
          <p className="vcc-model-head">Chọn model AI</p>
          {models.map(m => (
            <button key={m.id} type="button" role="option" aria-selected={m.id === current.id} className="vcc-model-opt"
              onClick={() => { onChange(m.id); setOpen(false); }}>
              <span className="vcc-model-icon" aria-hidden="true">{m.icon || '🤖'}</span>
              <span className="vcc-model-text">
                <span className="vcc-model-title">{m.name}{m.isDefault && <span className="vcc-model-tag">Mặc định</span>}</span>
                {m.blurb && <span className="vcc-model-blurb">{m.blurb}</span>}
                {!m.vision && <span className="vcc-model-blurb vcc-model-novision"><EyeOff size={11} aria-hidden="true" /> Không đọc ảnh — câu có ảnh tự dùng model đọc ảnh</span>}
              </span>
              {m.id === current.id && <Check size={15} className="vcc-model-check" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default AssistantModelPicker;
