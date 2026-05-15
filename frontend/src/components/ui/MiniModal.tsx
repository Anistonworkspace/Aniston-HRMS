import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface MiniModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export default function MiniModal({ open, onClose, title, children }: MiniModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;

    triggerRef.current = document.activeElement;

    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    firstFocusable?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []
      );
      if (focusable.length === 0) { e.preventDefault(); return; }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (triggerRef.current && 'focus' in triggerRef.current) {
        (triggerRef.current as HTMLElement).focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 'calc(var(--modal-z-index) + 10)' }}>
      <div
        className="absolute inset-0"
        style={{ background: 'var(--backdrop-color)' }}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mini-modal-title"
        className="relative w-full max-w-md flex flex-col animate-scale-in"
        style={{
          background: 'var(--modal-background-color)',
          borderRadius: 'var(--border-radius-big)',
          boxShadow: 'var(--box-shadow-large)',
          border: '1px solid var(--layout-border-color)',
          maxHeight: 'min(90dvh, calc(100dvh - 2rem))',
        }}
      >
        {/* Sticky header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <h3 id="mini-modal-title" className="font-semibold" style={{ font: 'var(--font-text1-bold)', color: 'var(--primary-text-color)' }}>{title}</h3>
          <button
            aria-label="Close"
            onClick={onClose}
            className="p-1 transition-colors"
            style={{ color: 'var(--icon-color)', borderRadius: 'var(--border-radius-small)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--primary-background-hover-color)'; e.currentTarget.style.color = 'var(--primary-text-color)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--icon-color)'; }}
          >
            <X size={16} />
          </button>
        </div>
        {/* Scrollable body */}
        <div className="px-5 pb-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
