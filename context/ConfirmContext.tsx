/**
 * ConfirmContext — Global confirmation dialog system
 *
 * Cách dùng:
 *   const confirm = useConfirm();
 *   const ok = await confirm({ title: 'Xoá?', targetName: 'Nhân viên A' });
 *   if (ok) { ... xoá ... }
 */
import React, { createContext, useContext, useRef, useState, useCallback } from 'react';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import ReasonConfirmModal from '../components/ReasonConfirmModal';

interface ConfirmOptions {
  title?: string;
  targetName: string;
  subtitle?: string;
  warningText?: string;
  confirmText?: string;
  actionLabel?: string;
  cancelLabel?: string;
  intent?: 'danger' | 'warning' | 'success';
  countdownSeconds?: number;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

interface ReasonConfirmOptions {
  title?: string;
  targetName: string;
  subtitle?: string;
  warningText?: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  actionLabel?: string;
  cancelLabel?: string;
  intent?: 'danger' | 'warning' | 'success';
  countdownSeconds?: number;
}

type ReasonConfirmFn = (opts: ReasonConfirmOptions) => Promise<string | null>;

const ReasonConfirmContext = createContext<ReasonConfirmFn | undefined>(undefined);

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({ targetName: '' });
  const resolveRef = useRef<(value: boolean) => void>(null!);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reasonOpts, setReasonOpts] = useState<ReasonConfirmOptions>({ targetName: '' });
  const reasonResolveRef = useRef<(value: string | null) => void>(null!);

  const confirm: ConfirmFn = useCallback((options) => {
    return new Promise<boolean>((resolve) => {
      setOpts(options);
      setIsOpen(true);
      resolveRef.current = resolve;
    });
  }, []);

  const handleConfirm = () => {
    setIsOpen(false);
    resolveRef.current(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    resolveRef.current(false);
  };

  const reasonConfirm: ReasonConfirmFn = useCallback((options) => {
    return new Promise<string | null>((resolve) => {
      setReasonOpts(options);
      setReasonOpen(true);
      reasonResolveRef.current = resolve;
    });
  }, []);

  const handleReasonConfirm = (reason: string) => {
    setReasonOpen(false);
    reasonResolveRef.current(reason);
  };

  const handleReasonClose = () => {
    setReasonOpen(false);
    reasonResolveRef.current(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      <ReasonConfirmContext.Provider value={reasonConfirm}>
        {children}
        <ConfirmDeleteModal
          isOpen={isOpen}
          onClose={handleClose}
          onConfirm={handleConfirm}
          title={opts.title}
          targetName={opts.targetName}
          subtitle={opts.subtitle}
          warningText={opts.warningText}
          confirmText={opts.confirmText}
          actionLabel={opts.actionLabel}
          cancelLabel={opts.cancelLabel}
          intent={opts.intent}
          countdownSeconds={opts.countdownSeconds ?? 2}
        />
        <ReasonConfirmModal
          isOpen={reasonOpen}
          onClose={handleReasonClose}
          onConfirm={handleReasonConfirm}
          title={reasonOpts.title}
          targetName={reasonOpts.targetName}
          subtitle={reasonOpts.subtitle}
          warningText={reasonOpts.warningText}
          reasonLabel={reasonOpts.reasonLabel}
          reasonPlaceholder={reasonOpts.reasonPlaceholder}
          actionLabel={reasonOpts.actionLabel}
          cancelLabel={reasonOpts.cancelLabel}
          intent={reasonOpts.intent}
          countdownSeconds={reasonOpts.countdownSeconds ?? 0}
        />
      </ReasonConfirmContext.Provider>
    </ConfirmContext.Provider>
  );
};

export const useConfirm = (): ConfirmFn => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
};

export const useReasonConfirm = (): ReasonConfirmFn => {
  const ctx = useContext(ReasonConfirmContext);
  if (!ctx) throw new Error('useReasonConfirm must be used within ConfirmProvider');
  return ctx;
};
