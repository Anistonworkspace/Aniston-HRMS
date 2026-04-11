import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, MapPin, Loader2, X } from 'lucide-react';

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    state_district?: string;
    county?: string;
    country?: string;
    postcode?: string;
    road?: string;
    suburb?: string;
  };
}

interface LocationSearchProps {
  onSelect: (result: {
    name: string;
    address: string;
    city: string;
    state: string;
    lat: number;
    lng: number;
  }) => void;
  placeholder?: string;
}

export default function LocationSearch({ onSelect, placeholder = 'Search location in India...' }: LocationSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchNominatim = useCallback(async (q: string) => {
    if (q.length < 3) { setResults([]); return; }
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        format: 'json',
        q,
        countrycodes: 'in',
        limit: '6',
        addressdetails: '1',
      });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { 'User-Agent': 'AnistonHRMS/1.0' },
      });
      const data: NominatimResult[] = await res.json();
      setResults(data);
      setShowDropdown(data.length > 0);
    } catch {
      setResults([]);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length >= 3) {
      debounceRef.current = setTimeout(() => searchNominatim(query), 400);
    } else {
      setResults([]);
      setShowDropdown(false);
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, searchNominatim]);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (result: NominatimResult) => {
    const addr = result.address || {};
    const city = addr.city || addr.town || addr.village || addr.state_district || '';
    const state = addr.state || '';
    const road = addr.road || addr.suburb || '';
    const shortName = result.display_name.split(',').slice(0, 2).join(', ');

    onSelect({
      name: shortName,
      address: road ? `${road}, ${city}` : result.display_name.split(',').slice(0, 3).join(', '),
      city,
      state,
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
    });

    setQuery(shortName);
    setShowDropdown(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setShowDropdown(true); }}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
          placeholder={placeholder}
          className="input-glass w-full pl-9 pr-8 text-sm"
        />
        {isLoading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
        {query && !isLoading && (
          <button onClick={() => { setQuery(''); setResults([]); setShowDropdown(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
            <X size={14} />
          </button>
        )}
      </div>

      {showDropdown && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-200 z-[1000] max-h-64 overflow-y-auto">
          {results.map((r) => (
            <button key={r.place_id} onClick={() => handleSelect(r)}
              className="w-full text-left px-3 py-2.5 hover:bg-brand-50 transition-colors flex items-start gap-2 border-b border-gray-50 last:border-0">
              <MapPin size={14} className="text-brand-500 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-gray-700 line-clamp-1">{r.display_name.split(',').slice(0, 2).join(', ')}</p>
                <p className="text-[10px] text-gray-400 line-clamp-1">{r.display_name}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
