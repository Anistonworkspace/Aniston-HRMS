import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Plus, Check, Trash2 } from 'lucide-react';

interface Option {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  canCreate?: boolean;
  createLabel?: string;
  onCreateClick?: () => void;
  canDelete?: boolean;
  onDeleteClick?: (value: string) => void;
  error?: string;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  label,
  required,
  disabled,
  canCreate,
  createLabel = '+ Add new',
  onCreateClick,
  canDelete,
  onDeleteClick,
  error,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const justOpenedRef = useRef(false);

  const selected = options.find((o) => o.value === value);

  const filtered = search
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          o.sublabel?.toLowerCase().includes(search.toLowerCase())
      )
    : options;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open && justOpenedRef.current && inputRef.current) {
      inputRef.current.focus();
      justOpenedRef.current = false;
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => { justOpenedRef.current = !open; setOpen(!open); }}
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-all disabled:cursor-not-allowed"
        style={{
          height: '40px',
          background: 'var(--secondary-background-color)',
          border: `1px solid ${error ? 'var(--negative-color)' : 'var(--ui-border-color)'}`,
          borderRadius: 'var(--border-radius-small)',
          color: selected ? 'var(--primary-text-color)' : 'var(--placeholder-color)',
          opacity: disabled ? 'var(--disabled-component-opacity)' : 1,
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.borderColor = error ? 'var(--negative-color)' : 'var(--primary-text-color)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = error ? 'var(--negative-color)' : 'var(--ui-border-color)'; }}
      >
        <span>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--icon-color)' }} />
      </button>

      {error && <p className="text-xs mt-1" style={{ color: 'var(--negative-color)', font: 'var(--font-text3-normal)' }}>{error}</p>}

      {open && (
        <div
          className="absolute z-[70] mt-1 w-full max-h-64 overflow-hidden"
          style={{
            background: 'var(--dialog-background-color)',
            border: '1px solid var(--layout-border-color)',
            borderRadius: 'var(--border-radius-medium)',
            boxShadow: 'var(--box-shadow-medium)',
          }}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--ui-background-color)' }}>
            <Search size={14} className="flex-shrink-0" style={{ color: 'var(--icon-color)' }} />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full text-sm outline-none bg-transparent"
              style={{ color: 'var(--primary-text-color)' }}
            />
          </div>

          {/* Options */}
          <div className="overflow-y-auto max-h-48">
            {value && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
                className="w-full text-left px-3 py-2 text-sm transition-colors"
                style={{ color: 'var(--secondary-text-color)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-background-hover-color)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Clear selection
              </button>
            )}

            {filtered.length === 0 && (
              <div className="px-3 py-3 text-sm text-center" style={{ color: 'var(--secondary-text-color)' }}>No results found</div>
            )}

            {filtered.map((option) => (
              <div
                key={option.value}
                className="flex items-center justify-between text-sm transition-colors"
                style={{ background: option.value === value ? 'var(--primary-selected-color)' : 'transparent' }}
                onMouseEnter={e => { if (option.value !== value) e.currentTarget.style.background = 'var(--primary-background-hover-color)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = option.value === value ? 'var(--primary-selected-color)' : 'transparent'; }}
              >
                <button
                  type="button"
                  onClick={() => { onChange(option.value); setOpen(false); setSearch(''); }}
                  className="flex-1 text-left px-3 py-2 flex items-center gap-2"
                  style={{ color: option.value === value ? 'var(--primary-color)' : 'var(--primary-text-color)' }}
                >
                  <div className="flex-1">
                    <span>{option.label}</span>
                    {option.sublabel && (
                      <span className="text-xs ml-2" style={{ color: 'var(--secondary-text-color)' }}>{option.sublabel}</span>
                    )}
                  </div>
                  {option.value === value && <Check size={14} className="flex-shrink-0" style={{ color: 'var(--primary-color)' }} />}
                </button>
                {canDelete && onDeleteClick && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteClick(option.value); }}
                    className="px-2 py-2 transition-colors flex-shrink-0"
                    style={{ color: 'var(--icon-color)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--negative-color)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--icon-color)')}
                    title={`Delete ${option.label}`}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {canCreate && onCreateClick && (
            <button
              type="button"
              onClick={() => { setOpen(false); setSearch(''); onCreateClick(); }}
              className="w-full text-left px-3 py-2.5 text-sm font-medium transition-colors flex items-center gap-2"
              style={{
                color: 'var(--primary-color)',
                borderTop: '1px solid var(--ui-background-color)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-highlighted-color)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Plus size={14} />
              {createLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
