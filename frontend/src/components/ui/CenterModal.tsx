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

interface CenterModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  maxWidth?: string;
  showClose?: boolean;
}

export default function CenterModal({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-lg',
  showClose = true,
}: CenterModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;

    // Capture the element that opened the modal so we can restore focus on close
    triggerRef.current = document.activeElement;

    // Move focus into the modal on open
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    firstFocusable?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;

      // Trap Tab/Shift+Tab inside the dialog
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
      // Restore focus to the trigger element when modal closes
      if (triggerRef.current && 'focus' in triggerRef.current) {
        (triggerRef.current as HTMLElement).focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 'var(--modal-z-index)' }}>
      {/* Overlay */}
      <div
        ref={overlayRef}
        className="absolute inset-0 transition-opacity"
        style={{ background: 'var(--backdrop-color)' }}
        onClick={onClose}
      />
      {/* Modal box — Monday.com §7.1 spec */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="center-modal-title"
        className={`relative ${maxWidth} w-full flex flex-col animate-scale-in`}
        style={{
          background: 'var(--modal-background-color)',
          borderRadius: 'var(--border-radius-big)',
          boxShadow: 'var(--box-shadow-large)',
          border: '1px solid var(--layout-border-color)',
          maxHeight: 'min(90dvh, calc(100dvh - 2rem))',
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-6 pt-6 pb-4 shrink-0"
          style={{ borderBottom: '1px solid var(--ui-background-color)' }}
        >
          <div>
            <h2 id="center-modal-title" className="font-bold" style={{ font: 'var(--font-h3)', color: 'var(--primary-text-color)' }}>{title}</h2>
            {subtitle && <p className="mt-1" style={{ font: 'var(--font-text2-normal)', color: 'var(--secondary-text-color)' }}>{subtitle}</p>}
          </div>
          {showClose && (
            <button
              aria-label="Close"
              onClick={onClose}
              className="p-1.5 transition-colors flex-shrink-0"
              style={{ color: 'var(--icon-color)', borderRadius: 'var(--border-radius-small)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--primary-background-hover-color)'; e.currentTarget.style.color = 'var(--primary-text-color)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--icon-color)'; }}
            >
              <X size={18} />
            </button>
          )}
        </div>
        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}
