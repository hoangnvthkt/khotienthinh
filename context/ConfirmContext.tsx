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

interface ConfirmOptions {
  title?: string;
  targetName: string;
  subtitle?: string;
  warningText?: string;
  countdownSeconds?: number;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({ targetName: '' });
  const resolveRef = useRef<(value: boolean) => void>(null!);

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

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDeleteModal
        isOpen={isOpen}
        onClose={handleClose}
        onConfirm={handleConfirm}
        title={opts.title}
        targetName={opts.targetName}
        subtitle={opts.subtitle}
        warningText={opts.warningText}
        countdownSeconds={opts.countdownSeconds ?? 2}
      />
    </ConfirmContext.Provider>
  );
};

export const useConfirm = (): ConfirmFn => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
};
