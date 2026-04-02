import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API = import.meta.env.VITE_API_URL ?? '';

export default function Stations() {
  const { token } = useAuth();
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', station }
  const [assignModal, setAssignModal] = useState(null); // null | { stationId }
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/stations`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setStations(data.stations ?? []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id) {
    if (!confirm('Delete this station?')) return;
    await fetch(`${API}/api/stations/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    load();
  }

  async function handleUnassign(stationId, mobile) {
    await fetch(`${API}/api/stations/${stationId}/unassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mobile }),
    });
    load();
  }

  async function handleClearAll() {
    await fetch(`${API}/api/stations/clear-agents`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    setConfirmClear(false);
    load();
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {modal && <StationModal mode={modal.mode} station={modal.station} token={token} onClose={() => setModal(null)} onSuccess={() => { setModal(null); load(); }} />}
      {assignModal && <AssignModal stationId={assignModal.stationId} token={token} onClose={() => setAssignModal(null)} onSuccess={() => { setAssignModal(null); load(); }} />}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Stations</h1>
          <p className="text-sm text-slate-500 dark:text-zinc-500 mt-0.5">{stations.length} support stations</p>
        </div>
        <div className="flex gap-2 self-start">
          <button onClick={load} title="Refresh" className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8a5.5 5.5 0 11-1.1-3.3"/><path d="M13.5 2v3h-3"/>
            </svg>
          </button>
          <button onClick={() => setConfirmClear(true)} className="px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 text-sm font-medium transition-colors">
            Clear All Agents
          </button>
          <button onClick={() => setModal({ mode: 'create' })} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">
            Add Station
          </button>
        </div>
      </div>

      {/* Confirm clear */}
      {confirmClear && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center justify-between">
          <p className="text-sm text-amber-700 dark:text-amber-400">Remove all agents from all stations? This cannot be undone.</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmClear(false)} className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-600 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">Cancel</button>
            <button onClick={handleClearAll} className="px-3 py-1.5 text-xs rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors">Confirm</button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-400 dark:text-zinc-500">Loading stations...</p>
        </div>
      ) : stations.length === 0 ? (
        <div className="text-center py-20 text-slate-400 dark:text-zinc-500">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
          </svg>
          <p className="text-sm font-medium">No stations yet</p>
          <p className="text-xs mt-1">Click "Add Station" to create one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {stations.map(s => (
            <div key={s.id} className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-4 transition-colors">
              {/* Station header */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{s.station_name}</h3>
                  <p className="text-xs text-slate-500 dark:text-zinc-500 font-mono mt-0.5">{s.station_number}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setAssignModal({ stationId: s.id })} title="Assign Agent" className="w-7 h-7 flex items-center justify-center rounded-lg text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 3v10M3 8h10"/>
                    </svg>
                  </button>
                  <button onClick={() => setModal({ mode: 'edit', station: s })} title="Edit" className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11.5 1.5l3 3L5 14H2v-3z"/>
                    </svg>
                  </button>
                  <button onClick={() => handleDelete(s.id)} title="Delete" className="w-7 h-7 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Agents */}
              {(!s.agents || s.agents.length === 0) ? (
                <div className="flex items-center gap-2 py-2">
                  <span className="text-xs text-slate-400 dark:text-zinc-500 italic">No agent assigned</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">TEMP</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {s.agents.map((a, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-slate-50 dark:bg-zinc-800/50">
                      <div>
                        <p className="text-xs font-medium text-slate-700 dark:text-zinc-200">{a.name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono">{a.mobile}</p>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 mt-0.5 inline-block">TEMP</span>
                      </div>
                      <button onClick={() => handleUnassign(s.id, a.mobile)} title="Remove" className="w-6 h-6 flex items-center justify-center rounded text-red-400 hover:bg-red-100 dark:hover:bg-red-950/40 transition-colors shrink-0">
                        <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StationModal({ mode, station, token, onClose, onSuccess }) {
  const [name, setName] = useState(station?.station_name || '');
  const [number, setNumber] = useState(station?.station_number || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !number.trim()) { setError('Both fields are required'); return; }
    setSaving(true); setError('');
    try {
      const url = mode === 'edit' ? `${API}/api/stations/${station.id}` : `${API}/api/stations`;
      const res = await fetch(url, {
        method: mode === 'edit' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ station_name: name.trim(), station_number: number.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed'); setSaving(false); return; }
      onSuccess();
    } catch (err) { setError(err.message); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={handleSubmit} className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{mode === 'edit' ? 'Edit Station' : 'New Station'}</h2>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div>
          <label className="text-xs text-slate-500 dark:text-zinc-400 mb-1 block">Station Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label className="text-xs text-slate-500 dark:text-zinc-400 mb-1 block">Station Number *</label>
          <input value={number} onChange={e => setNumber(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-sm text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50">{saving ? 'Saving...' : mode === 'edit' ? 'Update' : 'Create'}</button>
        </div>
      </form>
    </div>
  );
}

function AssignModal({ stationId, token, onClose, onSuccess }) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !mobile.trim()) { setError('Both fields are required'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`${API}/api/stations/${stationId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim(), mobile: mobile.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed'); setSaving(false); return; }
      onSuccess();
    } catch (err) { setError(err.message); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={handleSubmit} className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Assign Agent</h2>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div>
          <label className="text-xs text-slate-500 dark:text-zinc-400 mb-1 block">Agent Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label className="text-xs text-slate-500 dark:text-zinc-400 mb-1 block">Agent Mobile Number *</label>
          <input value={mobile} onChange={e => setMobile(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-sm text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50">{saving ? 'Assigning...' : 'Assign'}</button>
        </div>
      </form>
    </div>
  );
}
