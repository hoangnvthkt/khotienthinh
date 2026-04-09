import React, { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Check, X, Loader2 } from 'lucide-react';

// ══════════════════════════════════════════
//  WIZARD FORM — Reusable step-by-step wizard
//  Optimized for mobile field workers
// ══════════════════════════════════════════

export interface WizardStep {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  validate?: () => boolean | string;  // true = valid, string = error message
}

interface WizardFormProps {
  steps: WizardStep[];
  children: React.ReactNode[];    // One child per step
  onComplete: () => void | Promise<void>;
  onCancel: () => void;
  title?: string;
  completeLabel?: string;
  isSubmitting?: boolean;
}

const WizardForm: React.FC<WizardFormProps> = ({
  steps, children, onComplete, onCancel,
  title = 'Tạo mới',
  completeLabel = 'Hoàn tất',
  isSubmitting = false,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const totalSteps = steps.length;
  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === totalSteps - 1;
  const progress = ((currentStep + 1) / totalSteps) * 100;

  const goNext = useCallback(() => {
    // Validate current step
    if (step.validate) {
      const result = step.validate();
      if (result !== true) {
        setErrors(prev => ({ ...prev, [currentStep]: typeof result === 'string' ? result : 'Vui lòng điền đầy đủ thông tin' }));
        return;
      }
    }
    
    setErrors(prev => { const n = { ...prev }; delete n[currentStep]; return n; });
    setCompletedSteps(prev => new Set(prev).add(currentStep));

    if (isLast) {
      onComplete();
    } else {
      setCurrentStep(prev => Math.min(prev + 1, totalSteps - 1));
    }
  }, [currentStep, step, isLast, onComplete, totalSteps]);

  const goBack = useCallback(() => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
  }, []);

  const goToStep = useCallback((index: number) => {
    // Can only go to completed steps or current+1
    if (index <= currentStep || completedSteps.has(index - 1)) {
      setCurrentStep(index);
    }
  }, [currentStep, completedSteps]);

  return (
    <div className="fixed inset-0 z-[999] flex flex-col bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center justify-between mb-3">
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <X size={20} className="text-slate-500" />
          </button>
          <h2 className="text-sm font-black text-slate-800 dark:text-white">{title}</h2>
          <div className="w-8" /> {/* spacer */}
        </div>

        {/* Step Indicators */}
        <div className="flex items-center gap-1">
          {steps.map((s, i) => (
            <button
              key={s.id}
              onClick={() => goToStep(i)}
              className={`flex-1 flex flex-col items-center gap-1 py-1.5 rounded-lg transition-all ${
                i === currentStep
                  ? 'bg-indigo-50 dark:bg-indigo-900/30'
                  : completedSteps.has(i)
                  ? 'opacity-80 cursor-pointer'
                  : 'opacity-40 cursor-default'
              }`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all ${
                i === currentStep
                  ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                  : completedSteps.has(i)
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-400'
              }`}>
                {completedSteps.has(i) ? <Check size={14} /> : (s.icon || (i + 1))}
              </div>
              <span className={`text-[9px] font-bold truncate max-w-full ${
                i === currentStep ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'
              }`}>
                {s.title}
              </span>
            </button>
          ))}
        </div>

        {/* Progress Bar */}
        <div className="mt-2 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Step Content */}
      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="mb-3">
          <h3 className="text-lg font-black text-slate-800 dark:text-white">{step.title}</h3>
          {step.subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{step.subtitle}</p>
          )}
        </div>

        {/* Error */}
        {errors[currentStep] && (
          <div className="mb-3 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400 font-bold animate-shake">
            ⚠️ {errors[currentStep]}
          </div>
        )}

        {/* Step Body */}
        {children[currentStep]}
      </div>

      {/* Footer Navigation */}
      <div className="shrink-0 px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 safe-area-bottom">
        <div className="flex items-center gap-3">
          {!isFirst && (
            <button
              onClick={goBack}
              className="flex items-center gap-1 px-4 py-3 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <ChevronLeft size={16} /> Quay lại
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={goNext}
            disabled={isSubmitting}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black text-white shadow-lg transition-all ${
              isLast
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 shadow-emerald-500/30 hover:shadow-xl'
                : 'bg-gradient-to-r from-indigo-500 to-violet-500 shadow-indigo-500/30 hover:shadow-xl'
            } disabled:opacity-50`}
          >
            {isSubmitting ? (
              <><Loader2 size={16} className="animate-spin" /> Đang xử lý...</>
            ) : isLast ? (
              <><Check size={16} /> {completeLabel}</>
            ) : (
              <>Tiếp theo <ChevronRight size={16} /></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WizardForm;
