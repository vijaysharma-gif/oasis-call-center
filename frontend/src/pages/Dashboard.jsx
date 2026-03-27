import { useState, useEffect } from 'react';
import { useStats, useDateRange, initiateCall, pollClick2Call } from '../hooks/useCalls';
import { useAuth } from '../contexts/AuthContext';

const API = import.meta.env.VITE_API_URL ?? '';

function fmtDuration(s) {
  if (!s) return '0s';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function DonutChart({ received = 0, missed = 0, total = 0 }) {
  const R = 48;
  const C = 2 * Math.PI * R;
  const recDash = total > 0 ? (received / total) * C : 0;
  const misDash = total > 0 ? (missed  / total) * C : 0;
  return (
    <svg viewBox="0 0 120 120" className="w-32 h-32 shrink-0">
      <circle cx="60" cy="60" r={R} fill="none" stroke="#e2e8f0" strokeWidth="16" className="dark:hidden" />
      <circle cx="60" cy="60" r={R} fill="none" stroke="#27272a" strokeWidth="16" className="hidden dark:block" />
      {total > 0 && (
        <>
          <circle cx="60" cy="60" r={R} fill="none" stroke="#f87171" strokeWidth="16"
            strokeDasharray={`${misDash} ${C}`} strokeDashoffset={-recDash}
            transform="rotate(-90 60 60)" />
          <circle cx="60" cy="60" r={R} fill="none" stroke="#34d399" strokeWidth="16"
            strokeDasharray={`${recDash} ${C}`}
            transform="rotate(-90 60 60)" />
        </>
      )}
      <text x="60" y="56" textAnchor="middle" fontSize="18" fontWeight="700" fill="currentColor">{total}</text>
      <text x="60" y="70" textAnchor="middle" fontSize="9" fill="#94a3b8">Total</text>
    </svg>
  );
}

function TicketIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5.5A1.5 1.5 0 013.5 4h9A1.5 1.5 0 0114 5.5v1a1.5 1.5 0 010 3v1A1.5 1.5 0 0112.5 12h-9A1.5 1.5 0 012 10.5v-1a1.5 1.5 0 010-3v-1z"/><path d="M9 8h.01"/></svg>;
}

function StatCard({ label, value, color, icon }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl px-4 py-4 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-slate-500 dark:text-zinc-500 uppercase tracking-wide font-medium">{label}</p>
        <span className="text-slate-300 dark:text-zinc-700">{icon}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

export default function Dashboard({ onNavigate }) {
  const [dialState,  setDialState]    = useState({}); // { [id]: 'loading'|'success'|'error' }
  const [calledOut,  setCalledOut]    = useState(() => {
    try {
      const saved = localStorage.getItem('calledOutIds');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [dateFrom,   setDateFrom]     = useState('');
  const [dateTo,     setDateTo]       = useState('');
  const { token, isAdmin, user }      = useAuth();
  const { minDate, maxDate }          = useDateRange(token);

  // effectiveFrom uses oldest call date as lower bound; no upper ceiling by default.
  const effectiveFrom = dateFrom || minDate;
  const effectiveTo   = dateTo   || maxDate;
  const isFiltered    = !!(dateFrom || dateTo);

  const { stats, refetch: refetchStats } = useStats(token, { dateFrom: effectiveFrom, dateTo: effectiveTo });
  const s = stats ?? {};

  const [agentTickets,    setAgentTickets]    = useState([]);
  const [ticketsLoading,  setTicketsLoading]  = useState(false);

  useEffect(() => {
    if (isAdmin || !token) return;
    setTicketsLoading(true);
    fetch(`${API}/api/tickets?limit=50&offset=0&status=Open`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => setAgentTickets(data.tickets ?? []))
      .catch(() => {})
      .finally(() => setTicketsLoading(false));
  }, [isAdmin, token]);

  async function handleDial(call) {
    setDialState(s => ({ ...s, [call.id]: 'loading' }));
    try {
      const since = Date.now();
      const res   = await initiateCall(call.caller_number, user?.agent_number, token);
      const ok    = res.status === 'Success' || res.status === 'success';
      if (!ok) {
        setDialState(s => ({ ...s, [call.id]: 'error' }));
        setTimeout(() => setDialState(s => { const n = { ...s }; delete n[call.id]; return n; }), 3000);
        return;
      }
      // Hide immediately on successful initiation
      setCalledOut(prev => {
        const next = new Set([...prev, call.id]);
        try { localStorage.setItem('calledOutIds', JSON.stringify([...next])); } catch {}
        return next;
      });
      setDialState(s => ({ ...s, [call.id]: 'polling' }));
      pollClick2Call(call.caller_number, since, token, {
        onConfirmed: () => {
          // Already hidden — just clear dial state
          setDialState(s => { const n = { ...s }; delete n[call.id]; return n; });
        },
        onTimeout: () => {
          // Call never connected — restore to missed list
          setCalledOut(prev => {
            const next = new Set([...prev]);
            next.delete(call.id);
            try { localStorage.setItem('calledOutIds', JSON.stringify([...next])); } catch {}
            return next;
          });
          setDialState(s => ({ ...s, [call.id]: 'error' }));
          setTimeout(() => setDialState(s => { const n = { ...s }; delete n[call.id]; return n; }), 3000);
        },
      });
    } catch {
      setDialState(s => ({ ...s, [call.id]: 'error' }));
      setTimeout(() => setDialState(s => { const n = { ...s }; delete n[call.id]; return n; }), 3000);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">

      {/* Header + Date Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-zinc-500 mt-0.5">Overview · auto-refreshes every 5s</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap self-start">
          <svg className="w-4 h-4 text-slate-400 dark:text-zinc-500 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5 1v4M11 1v4M2 7h12"/></svg>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">From</label>
            <input
              type="date"
              value={effectiveFrom}
              max={effectiveTo}
              onChange={e => {
                const val = e.target.value;
                setDateFrom(val);
                if (effectiveTo && val > effectiveTo) setDateTo(val);
              }}
              className="px-2 py-1.5 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">To</label>
            <input
              type="date"
              value={effectiveTo}
              min={effectiveFrom}
              onChange={e => {
                const val = e.target.value;
                setDateTo(val);
                if (effectiveFrom && val < effectiveFrom) setDateFrom(val);
              }}
              className="px-2 py-1.5 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          {isFiltered && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-600 text-xs text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
            >
              Reset
            </button>
          )}
          {isFiltered && (
            <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Filtered</span>
          )}
          <div className="w-px h-6 bg-slate-300 dark:bg-zinc-700 shrink-0" />
          <button
            onClick={refetchStats}
            title="Refresh"
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8a5.5 5.5 0 11-1.1-3.3"/><path d="M13.5 2v3h-3"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className={`grid grid-cols-2 gap-3 mb-6 ${isAdmin ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}>
        <StatCard label="Total Calls"   value={s.total ?? '—'}                  color="text-indigo-600 dark:text-indigo-400"   icon={<PhoneIcon />} />
        {isAdmin  && <StatCard label="Received"     value={s.received ?? '—'}   color="text-emerald-600 dark:text-emerald-400" icon={<CheckIcon />} />}
        {isAdmin  && <StatCard label="Missed"       value={s.missed ?? '—'}     color="text-red-500 dark:text-red-400"         icon={<MissedIcon />} />}
        {!isAdmin && <StatCard label="Received"     value={s.received ?? '—'}   color="text-emerald-600 dark:text-emerald-400" icon={<CheckIcon />} />}
        {!isAdmin && <StatCard label="Avg Duration" value={fmtDuration(s.avgDuration)} color="text-violet-600 dark:text-violet-400" icon={<ClockIcon />} />}
        {!isAdmin && <StatCard label="Open Tickets" value={ticketsLoading ? '…' : agentTickets.length} color="text-amber-600 dark:text-amber-400" icon={<TicketIcon />} />}
      </div>

      {/* Charts Row */}
      <div className={`grid grid-cols-1 gap-4 mb-6 ${isAdmin ? 'lg:grid-cols-3' : 'hidden'}`}>
        {/* Received vs Missed donut — admin only */}
        {isAdmin && <div className="lg:col-span-1 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 transition-colors">
          <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200 mb-4">Received vs Missed</p>
          <div className="flex items-center gap-6">
            <DonutChart received={s.received} missed={s.missed} total={s.total} />
            <div className="flex flex-col gap-3 min-w-0">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-emerald-400 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 leading-none mb-1">Received</p>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 leading-none">{s.received ?? 0}</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">{s.total > 0 ? Math.round((s.received / s.total) * 100) : 0}%</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-red-400 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 leading-none mb-1">Missed</p>
                  <p className="text-2xl font-bold text-red-500 dark:text-red-400 leading-none">{s.missed ?? 0}</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">{s.total > 0 ? Math.round((s.missed / s.total) * 100) : 0}%</p>
                </div>
              </div>
            </div>
          </div>
        </div>}

        {/* Avg Call Duration with per-agent breakdown — admin only */}
        {isAdmin && <div className="lg:col-span-1 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 transition-colors flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200">Avg Call Duration</p>
            <span className="text-2xl font-extrabold text-violet-600 dark:text-violet-400">{fmtDuration(s.avgDuration)}</span>
          </div>
          <p className="text-xs text-slate-400 dark:text-zinc-500 mb-2 uppercase tracking-wide">By agent</p>
          <div className="flex-1 overflow-y-auto space-y-2 max-h-36">
            {(s.avgDurationByAgent ?? []).length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-zinc-500 py-2">No data</p>
            ) : (s.avgDurationByAgent ?? []).slice(0, 3).map(a => {
              const max = s.avgDurationByAgent[0]?.avgDuration || 1;
              const pct = Math.round((a.avgDuration / max) * 100);
              return (
                <div key={a.agent_number}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="flex items-center gap-1 text-xs text-slate-600 dark:text-zinc-300 truncate">
                      {a.verified && <svg className="w-3 h-3 text-indigo-500 shrink-0" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.28 5.78a.75.75 0 00-1.06-1.06L7 8.94 5.78 7.72a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z" clipRule="evenodd"/></svg>}
                      {a.agent_name}
                    </span>
                    <span className="text-xs font-semibold text-violet-600 dark:text-violet-400 shrink-0 ml-2">{fmtDuration(a.avgDuration)}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-400 dark:bg-violet-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>}

        {/* Today summary — admin only */}
        {isAdmin && <div className="lg:col-span-1 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 transition-colors flex flex-col">
          <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200 mb-3">Received by Agent</p>
          <div className="flex-1 overflow-y-auto space-y-1.5 max-h-44">
            {(s.todayByAgent ?? []).length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-zinc-500 py-2">No received calls</p>
            ) : (s.todayByAgent ?? []).slice(0, 4).map(a => (
              <div key={a.agent_number} className="flex items-center justify-between gap-2 py-1 border-b border-slate-50 dark:border-zinc-800/50 last:border-0">
                <span className="flex items-center gap-1 text-xs text-slate-600 dark:text-zinc-300 truncate">
                  {a.verified && <svg className="w-3 h-3 text-indigo-500 shrink-0" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.28 5.78a.75.75 0 00-1.06-1.06L7 8.94 5.78 7.72a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z" clipRule="evenodd"/></svg>}
                  {a.agent_name}
                </span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 shrink-0 tabular-nums">{a.count}</span>
              </div>
            ))}
          </div>
        </div>}
      </div>

      {/* Bottom two-panel grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Latest Missed Calls */}
        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 transition-colors flex flex-col max-h-[520px]">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200">Latest Missed Calls</p>
            {onNavigate && (
              <button
                onClick={() => onNavigate('call-report')}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                View all →
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {(s.latestMissed ?? []).filter(c => !calledOut.has(c.id)).length > 0 ? (
              <LatestMissedTable calls={(s.latestMissed ?? []).filter(c => !calledOut.has(c.id))} dialState={dialState} onDial={handleDial} />
            ) : (
              <p className="text-sm text-slate-400 dark:text-zinc-500 py-4 text-center">No missed calls</p>
            )}
          </div>
        </div>

        {/* AI Insights & Bugs (admin) / My Tickets (agent) */}
        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 transition-colors flex flex-col max-h-[520px] overflow-hidden">
          {isAdmin ? (
            <>
              <div className="flex items-center justify-between mb-4 shrink-0">
                <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200">AI Insights &amp; Bugs</p>
                {onNavigate && (
                  <button onClick={() => onNavigate('ai-analysis')} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                    View More →
                  </button>
                )}
              </div>
              <RecentInsightsList items={s.recentAnalysis ?? []} />
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4 shrink-0">
                <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200">Open Tickets</p>
                {onNavigate && (
                  <button onClick={() => onNavigate('tickets')} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                    View all →
                  </button>
                )}
              </div>
              <AgentTicketsList tickets={agentTickets} loading={ticketsLoading} />
            </>
          )}
        </div>

      </div>
    </div>
  );
}

function DurationBar({ label, value, color, max }) {
  const reference = max != null ? max : value;
  const pct = reference > 0 ? Math.min(100, Math.round((value / reference) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-slate-500 dark:text-zinc-400">{label}</span>
        <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">{fmtDuration(value)}</span>
      </div>
      <div className="h-2 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function LatestMissedTable({ calls, dialState, onDial }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 dark:border-zinc-800">
            {['Caller', 'Called', 'Time', 'Duration', ''].map(h => (
              <th key={h} className="pb-2 pr-4 text-left text-xs font-medium text-slate-400 dark:text-zinc-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calls.map(call => {
            const state = dialState[call.id];
            return (
              <tr key={call.id} className="border-b border-slate-50 dark:border-zinc-800/50 last:border-0">
                <td className="py-2.5 pr-4 text-slate-700 dark:text-zinc-300 tabular-nums whitespace-nowrap">{call.caller_number || '—'}</td>
                <td className="py-2.5 pr-4 text-slate-700 dark:text-zinc-300 tabular-nums whitespace-nowrap">{call.called_number || '—'}</td>
                <td className="py-2.5 pr-4 text-slate-500 dark:text-zinc-400 whitespace-nowrap text-xs">{fmtDate(call.call_start_time || call.created_at)}</td>
                <td className="py-2.5 pr-4 text-slate-700 dark:text-zinc-300 tabular-nums whitespace-nowrap">{call.duration ? fmtDuration(call.duration) : '—'}</td>
                <td className="py-2.5">
                  <button
                    onClick={() => onDial(call)}
                    disabled={state === 'loading' || state === 'polling'}
                    title={
                      state === 'polling'   ? 'Waiting for confirmation…' :
                      state === 'connected' ? 'Call connected!' :
                      state === 'initiated' ? 'Call initiated (no webhook yet)' :
                      `Call back ${call.caller_number}`
                    }
                    className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                      state === 'connected' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' :
                      state === 'initiated' ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400' :
                      state === 'error'     ? 'bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400' :
                      state === 'loading' || state === 'polling' ? 'text-slate-300 dark:text-zinc-600 cursor-wait' :
                      'text-slate-400 dark:text-zinc-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-600 dark:hover:text-indigo-400'
                    }`}
                  >
                    {state === 'loading' ? (
                      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="25" strokeDashoffset="6"/>
                      </svg>
                    ) : state === 'polling' ? (
                      <svg className="w-3.5 h-3.5 animate-pulse" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="8" cy="8" r="2"/><path d="M4 8a4 4 0 008 0M2 8a6 6 0 0012 0"/>
                      </svg>
                    ) : state === 'connected' ? (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8l3 3 7-7"/></svg>
                    ) : state === 'initiated' ? (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="8" cy="8" r="6"/><path d="M8 5v3M8 11h.01"/>
                      </svg>
                    ) : state === 'error' ? (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3.5A1.5 1.5 0 013.5 2h.879a1 1 0 01.958.713l.66 2.2a1 1 0 01-.23 1.002L4.5 6.5s1 2 5 5l1.085-1.267a1 1 0 011.003-.23l2.2.66A1 1 0 0114 11.62V12.5A1.5 1.5 0 0112.5 14C6.7 14 2 9.3 2 3.5z"/></svg>
                    )}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecentInsightsList({ items }) {
  if (!items.length) return (
    <p className="text-sm text-slate-400 dark:text-zinc-500 py-4 text-center flex-1">No AI analysis yet</p>
  );
  return (
    <div className="flex-1 overflow-y-auto space-y-2">
      {items.map(item => (
        <div key={item.id} className="pb-2 border-b border-slate-50 dark:border-zinc-800/50 last:border-0">
          {item.ai_insight && item.ai_insight !== '-' && (
            <p className="text-xs leading-snug">
              <span className="font-semibold text-slate-500 dark:text-zinc-400">Issue: </span>
              <span className="text-amber-700 dark:text-amber-400">{item.ai_insight}</span>
            </p>
          )}
          {item.bugs && item.bugs !== '-' && (
            <p className="text-xs leading-snug mt-0.5">
              <span className="font-semibold text-slate-500 dark:text-zinc-400">Bugs: </span>
              <span className="text-red-600 dark:text-red-400">{item.bugs}</span>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

const PRIORITY_COLOR = {
  High:   'text-red-600 dark:text-red-400',
  Medium: 'text-amber-600 dark:text-amber-400',
  Low:    'text-slate-500 dark:text-zinc-400',
};

function AgentTicketsList({ tickets, loading }) {
  if (loading) return <p className="text-sm text-slate-400 dark:text-zinc-500 py-4 text-center">Loading…</p>;
  if (!tickets.length) return <p className="text-sm text-slate-400 dark:text-zinc-500 py-4 text-center">No open tickets</p>;
  return (
    <div className="flex-1 overflow-y-auto space-y-2">
      {tickets.map(t => (
        <div key={t._id} className="flex items-start justify-between gap-3 pb-2 border-b border-slate-50 dark:border-zinc-800/50 last:border-0">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-700 dark:text-zinc-200 truncate">{t.title}</p>
            {t.customer_number && (
              <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5 tabular-nums">{t.customer_number}</p>
            )}
          </div>
          <span className={`text-xs font-medium shrink-0 ${PRIORITY_COLOR[t.priority] ?? PRIORITY_COLOR.Low}`}>
            {t.priority ?? '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

function PhoneIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3.5A1.5 1.5 0 013.5 2h.879a1 1 0 01.958.713l.66 2.2a1 1 0 01-.23 1.002L4.5 6.5s1 2 5 5l1.085-1.267a1 1 0 011.003-.23l2.2.66A1 1 0 0114 11.62V12.5A1.5 1.5 0 0112.5 14C6.7 14 2 9.3 2 3.5z"/></svg>;
}
function CheckIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 4L6 11 3 8"/></svg>;
}
function MissedIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l10 10M13 4L6 11 3 8"/></svg>;
}
function ClockIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/></svg>;
}
