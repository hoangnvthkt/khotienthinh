import { useEffect, useRef, type RefObject } from 'react';

export const useDialogFocusTrap = (active: boolean, container: RefObject<HTMLElement>, onEscape: () => void) => {
  const escapeRef=useRef(onEscape);escapeRef.current=onEscape;
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => container.current?.querySelector<HTMLElement>('[autofocus],button,input,select,textarea')?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); escapeRef.current(); return; }
      if (event.key !== 'Tab' || !container.current) return;
      const focusable = [...container.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first=focusable[0],last=focusable.at(-1)!;
      if (event.shiftKey && document.activeElement===first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement===last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown',onKeyDown);
    return ()=>{cancelAnimationFrame(frame);document.removeEventListener('keydown',onKeyDown);previous?.focus();};
  },[active,container]);
};
