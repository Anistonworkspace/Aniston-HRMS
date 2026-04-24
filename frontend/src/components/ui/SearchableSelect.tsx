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
    if (open && inputRef.current) {
      inputRef.current.focus();
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
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-3 py-2 bg-white border rounded-lg text-sm text-left transition-colors ${
          error ? 'border-red-300 focus:ring-red-400' : 'border-gray-300 hover:border-gray-400 focus:ring-indigo-400'
        } focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span className={selected ? 'text-gray-800' : 'text-gray-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}

      {open && (
        <div className="absolute z-[70] mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
            <Search size={14} className="text-gray-400 flex-shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full text-sm outline-none bg-transparent placeholder-gray-400"
            />
          </div>

          {/* Options */}
          <div className="overflow-y-auto max-h-48">
            {/* Clear selection */}
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                  setSearch('');
                }}
                className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 transition-colors"
              >
                Clear selection
              </button>
            )}

            {filtered.length === 0 && (
              <div className="px-3 py-3 text-sm text-gray-400 text-center">No results found</div>
            )}

            {filtered.map((option) => (
              <div
                key={option.value}
                className={`flex items-center justify-between text-sm transition-colors ${
                  option.value === value ? 'bg-indigo-50' : 'hover:bg-indigo-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    setSearch('');
                  }}
                  className={`flex-1 text-left px-3 py-2 flex items-center gap-2 ${
                    option.value === value ? 'text-indigo-700' : 'text-gray-700'
                  }`}
                >
                  <div className="flex-1">
                    <span>{option.label}</span>
                    {option.sublabel && (
                      <span className="text-xs text-gray-400 ml-2">{option.sublabel}</span>
                    )}
                  </div>
                  {option.value === value && <Check size={14} className="text-indigo-600 flex-shrink-0" />}
                </button>
                {canDelete && onDeleteClick && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteClick(option.value);
                    }}
                    className="px-2 py-2 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                    title={`Delete ${option.label}`}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Create option */}
          {canCreate && onCreateClick && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSearch('');
                onCreateClick();
              }}
              className="w-full text-left px-3 py-2.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 transition-colors border-t border-gray-100 flex items-center gap-2"
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
