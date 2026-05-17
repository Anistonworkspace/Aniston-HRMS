import { useState } from 'react';
import {
  MapPin, Star, Plus, Trash2, Edit2, Loader2, X, Check, AlertCircle,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  useGetGeoLocationsQuery,
  useGetSavedLocationsQuery,
  useCreateSavedLocationMutation,
  useUpdateSavedLocationMutation,
  useDeleteSavedLocationMutation,
  usePromoteVisitToSavedLocationMutation,
  type SavedLocation,
  type CreateSavedLocationRequest,
} from '../attendance/attendanceApi';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import toast from 'react-hot-toast';

// Fix Leaflet default icon (same pattern as RosterPage)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Special gold icon for important/saved locations
const importantIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function FitBoundsToMarkers({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  if (coords.length > 0) {
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }
  return null;
}

type SubTab = 'all-visits' | 'saved-locations';

const CATEGORY_OPTIONS = ['client', 'warehouse', 'field-office', 'delivery', 'other'];

export default function VisitLocationsTab() {
  const [subTab, setSubTab] = useState<SubTab>('all-visits');

  // Filters for All Visits
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');

  // Promote modal state
  const [promoteVisitId, setPromoteVisitId] = useState<string | null>(null);
  const [promoteName, setPromoteName] = useState('');

  // Create/edit saved location modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<SavedLocation | null>(null);
  const [locForm, setLocForm] = useState<CreateSavedLocationRequest>({
    name: '', latitude: 0, longitude: 0, radiusMeters: 100, isImportant: false, category: '',
  });

  // Queries
  const { data: empRes } = useGetEmployeesQuery({ page: 1, limit: 200 });
  const employees: any[] = (empRes as any)?.data?.employees || [];

  const geoParams: any = {};
  if (filterEmployee) geoParams.employeeId = filterEmployee;
  if (filterStart) geoParams.startDate = filterStart;
  if (filterEnd) geoParams.endDate = filterEnd;
  const { data: visitsRes, isLoading: visitsLoading } = useGetGeoLocationsQuery(geoParams);
  const visits: any[] = visitsRes?.data || [];

  const { data: savedLocs = [], isLoading: savedLoading } = useGetSavedLocationsQuery();

  // Mutations
  const [promoteVisit, { isLoading: promoting }] = usePromoteVisitToSavedLocationMutation();
  const [createSavedLoc, { isLoading: creating }] = useCreateSavedLocationMutation();
  const [updateSavedLoc, { isLoading: updating }] = useUpdateSavedLocationMutation();
  const [deleteSavedLoc] = useDeleteSavedLocationMutation();

  // --- All Visits handlers ---
  async function handlePromote() {
    if (!promoteVisitId || !promoteName.trim()) return;
    try {
      await promoteVisit({ visitId: promoteVisitId, name: promoteName.trim() }).unwrap();
      toast.success('Location saved successfully');
      setPromoteVisitId(null);
      setPromoteName('');
    } catch {
      toast.error('Failed to save location');
    }
  }

  // --- Saved Locations handlers ---
  function openCreate() {
    setLocForm({ name: '', latitude: 0, longitude: 0, radiusMeters: 100, isImportant: false, category: '' });
    setEditingLocation(null);
    setShowCreateModal(true);
  }

  function openEdit(loc: SavedLocation) {
    setLocForm({
      name: loc.name,
      address: loc.address,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radiusMeters: loc.radiusMeters,
      isImportant: loc.isImportant,
      category: loc.category || '',
    });
    setEditingLocation(loc);
    setShowCreateModal(true);
  }

  async function handleSaveLocation() {
    if (!locForm.name.trim() || !locForm.latitude || !locForm.longitude) {
      toast.error('Name, latitude, and longitude are required');
      return;
    }
    try {
      if (editingLocation) {
        await updateSavedLoc({ id: editingLocation.id, ...locForm }).unwrap();
        toast.success('Location updated');
      } else {
        await createSavedLoc(locForm).unwrap();
        toast.success('Location created');
      }
      setShowCreateModal(false);
    } catch {
      toast.error('Failed to save location');
    }
  }

  async function handleDeleteSaved(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await deleteSavedLoc(id).unwrap();
      toast.success('Location deleted');
    } catch {
      toast.error('Failed to delete location');
    }
  }

  // Map coords for all visits
  const visitCoords: [number, number][] = visits
    .filter((v) => v.latitude && v.longitude)
    .map((v) => [v.latitude, v.longitude]);

  // Map coords for saved locations
  const savedCoords: [number, number][] = savedLocs
    .filter((l) => l.latitude && l.longitude)
    .map((l) => [l.latitude, l.longitude]);

  const defaultCenter: [number, number] = [20.5937, 78.9629]; // India center

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-2">
        {(['all-visits', 'saved-locations'] as SubTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
              subTab === t
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t === 'all-visits' ? 'All Visits' : 'Saved Locations'}
          </button>
        ))}
      </div>

      {/* ===== ALL VISITS ===== */}
      {subTab === 'all-visits' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="layer-card p-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Employee</label>
              <select
                value={filterEmployee}
                onChange={(e) => setFilterEmployee(e.target.value)}
                className="input-glass text-sm w-48"
              >
                <option value="">All Employees</option>
                {employees.map((emp: any) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">From Date</label>
              <input
                type="date"
                value={filterStart}
                onChange={(e) => setFilterStart(e.target.value)}
                className="input-glass text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">To Date</label>
              <input
                type="date"
                value={filterEnd}
                onChange={(e) => setFilterEnd(e.target.value)}
                className="input-glass text-sm"
              />
            </div>
            {(filterEmployee || filterStart || filterEnd) && (
              <button
                onClick={() => { setFilterEmployee(''); setFilterStart(''); setFilterEnd(''); }}
                className="text-sm text-gray-500 hover:text-red-500 flex items-center gap-1"
              >
                <X size={14} /> Clear
              </button>
            )}
          </div>

          {/* Map */}
          {visitCoords.length > 0 && (
            <div className="layer-card overflow-hidden" style={{ height: 300 }}>
              <MapContainer
                center={visitCoords[0] || defaultCenter}
                zoom={11}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                <FitBoundsToMarkers coords={visitCoords} />
                {visits.map((v) => (
                  v.latitude && v.longitude ? (
                    <Marker key={v.id} position={[v.latitude, v.longitude]}>
                      <Popup>
                        <div className="text-xs">
                          <strong>{v.customName || v.locationName || 'Unknown location'}</strong>
                          <br />
                          {v.durationMinutes} min stay
                          {v.isImportant && <span className="ml-1 text-amber-600">★ Saved</span>}
                        </div>
                      </Popup>
                    </Marker>
                  ) : null
                ))}
              </MapContainer>
            </div>
          )}

          {/* Visits list */}
          {visitsLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-indigo-600" size={28} /></div>
          ) : visits.length === 0 ? (
            <div className="layer-card p-8 text-center text-gray-400">
              <MapPin size={40} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No visit locations found for the selected filters.</p>
            </div>
          ) : (
            <div className="layer-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Employee</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Arrival</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Duration</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v: any) => (
                    <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <MapPin size={14} className="text-indigo-400 shrink-0" />
                          <span className="font-medium text-gray-800">
                            {v.customName || v.locationName || 'Unknown'}
                          </span>
                        </div>
                        {v.latitude && v.longitude && (
                          <div className="text-xs text-gray-400 mt-0.5 ml-5" data-mono>
                            {v.latitude.toFixed(4)}, {v.longitude.toFixed(4)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {v.attendance?.employee
                          ? `${v.attendance.employee.firstName} ${v.attendance.employee.lastName}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {v.arrivalTime
                          ? new Date(v.arrivalTime).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        <span data-mono>
                          {v.durationMinutes >= 60
                            ? `${Math.floor(v.durationMinutes / 60)}h ${v.durationMinutes % 60}m`
                            : `${v.durationMinutes}m`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {v.isSignificant && (
                            <span className="badge bg-blue-50 text-blue-600 text-xs px-2 py-0.5 rounded-full">
                              Significant
                            </span>
                          )}
                          {v.isImportant && (
                            <span className="badge bg-amber-50 text-amber-600 text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Star size={10} /> Saved
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!v.isImportant && (
                          <button
                            onClick={() => { setPromoteVisitId(v.id); setPromoteName(v.customName || v.locationName || ''); }}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium border border-indigo-200 hover:border-indigo-400 px-2 py-1 rounded transition-colors"
                          >
                            Save as Location
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===== SAVED LOCATIONS ===== */}
      {subTab === 'saved-locations' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">{savedLocs.length} saved location{savedLocs.length !== 1 ? 's' : ''}</p>
            <button onClick={openCreate} className="btn-primary flex items-center gap-2 text-sm">
              <Plus size={16} /> Add Location
            </button>
          </div>

          {/* Map for saved locations */}
          {savedCoords.length > 0 && (
            <div className="layer-card overflow-hidden" style={{ height: 300 }}>
              <MapContainer
                center={savedCoords[0] || defaultCenter}
                zoom={11}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                <FitBoundsToMarkers coords={savedCoords} />
                {savedLocs.map((loc) => (
                  <Marker
                    key={loc.id}
                    position={[loc.latitude, loc.longitude]}
                    icon={loc.isImportant ? importantIcon : new L.Icon.Default()}
                  >
                    <Popup>
                      <div className="text-xs">
                        <strong>{loc.name}</strong>
                        {loc.address && <><br />{loc.address}</>}
                        {loc.category && <><br /><span className="text-gray-500">Category: {loc.category}</span></>}
                        <br />
                        <span className="text-gray-500">Radius: {loc.radiusMeters}m</span>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          )}

          {savedLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-indigo-600" size={28} /></div>
          ) : savedLocs.length === 0 ? (
            <div className="layer-card p-8 text-center text-gray-400">
              <Star size={40} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No saved locations yet. Save a visit or add one manually.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {savedLocs.map((loc) => (
                <div key={loc.id} className="layer-card p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <MapPin size={16} className={loc.isImportant ? 'text-amber-500 shrink-0' : 'text-indigo-400 shrink-0'} />
                      <span className="font-semibold text-gray-800 truncate">{loc.name}</span>
                      {loc.isImportant && (
                        <Star size={13} className="text-amber-500 shrink-0" fill="currentColor" />
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEdit(loc)}
                        className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteSaved(loc.id, loc.name)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {loc.address && (
                    <p className="text-xs text-gray-500 ml-6">{loc.address}</p>
                  )}
                  <div className="flex flex-wrap gap-2 ml-6">
                    {loc.category && (
                      <span className="badge bg-indigo-50 text-indigo-600 text-xs px-2 py-0.5 rounded-full capitalize">
                        {loc.category}
                      </span>
                    )}
                    <span className="badge bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full" data-mono>
                      {loc.radiusMeters}m radius
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 ml-6" data-mono>
                    {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                  </div>
                  {loc.addedBy && (
                    <div className="text-xs text-gray-400 ml-6">
                      Added by {loc.addedBy.name || loc.addedBy.email}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== PROMOTE VISIT MODAL ===== */}
      {promoteVisitId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <Star size={18} className="text-amber-500" />
              <h3 className="text-base font-semibold text-gray-900">Save as Location</h3>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Give this GPS visit a name to save it as a permanent location.
            </p>
            <input
              type="text"
              value={promoteName}
              onChange={(e) => setPromoteName(e.target.value)}
              placeholder="Location name (e.g. Client Office - Mumbai)"
              className="input-glass w-full mb-4"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handlePromote(); }}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setPromoteVisitId(null); setPromoteName(''); }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handlePromote}
                disabled={!promoteName.trim() || promoting}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                {promoting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Save Location
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== CREATE / EDIT SAVED LOCATION MODAL ===== */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 my-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MapPin size={18} className="text-indigo-500" />
                <h3 className="text-base font-semibold text-gray-900">
                  {editingLocation ? 'Edit Location' : 'Add Location'}
                </h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Name *</label>
                <input
                  type="text"
                  value={locForm.name}
                  onChange={(e) => setLocForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Client Office - Mumbai"
                  className="input-glass w-full"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Address</label>
                <input
                  type="text"
                  value={locForm.address || ''}
                  onChange={(e) => setLocForm((p) => ({ ...p, address: e.target.value }))}
                  placeholder="Street address (optional)"
                  className="input-glass w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Latitude *</label>
                  <input
                    type="number"
                    value={locForm.latitude || ''}
                    onChange={(e) => setLocForm((p) => ({ ...p, latitude: parseFloat(e.target.value) || 0 }))}
                    placeholder="e.g. 19.0760"
                    step="0.0001"
                    className="input-glass w-full"
                    data-mono
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Longitude *</label>
                  <input
                    type="number"
                    value={locForm.longitude || ''}
                    onChange={(e) => setLocForm((p) => ({ ...p, longitude: parseFloat(e.target.value) || 0 }))}
                    placeholder="e.g. 72.8777"
                    step="0.0001"
                    className="input-glass w-full"
                    data-mono
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Radius (meters)</label>
                  <input
                    type="number"
                    value={locForm.radiusMeters || 100}
                    onChange={(e) => setLocForm((p) => ({ ...p, radiusMeters: parseInt(e.target.value) || 100 }))}
                    min={50}
                    max={2000}
                    className="input-glass w-full"
                    data-mono
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Category</label>
                  <select
                    value={locForm.category || ''}
                    onChange={(e) => setLocForm((p) => ({ ...p, category: e.target.value }))}
                    className="input-glass w-full"
                  >
                    <option value="">Select category</option>
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c} className="capitalize">{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={locForm.isImportant ?? false}
                  onChange={(e) => setLocForm((p) => ({ ...p, isImportant: e.target.checked }))}
                  className="rounded text-indigo-600"
                />
                <span className="text-sm text-gray-700">Mark as Important</span>
                <Star size={14} className="text-amber-500" />
              </label>
              {(!locForm.name.trim() || !locForm.latitude || !locForm.longitude) && (
                <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 rounded p-2">
                  <AlertCircle size={13} />
                  Name, latitude, and longitude are required.
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end mt-5">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveLocation}
                disabled={!locForm.name.trim() || !locForm.latitude || !locForm.longitude || creating || updating}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                {(creating || updating) ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {editingLocation ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
