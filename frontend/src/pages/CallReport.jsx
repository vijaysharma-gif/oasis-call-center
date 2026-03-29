import { useState, useEffect } from 'react';
import { useCalls, useDateRange, useAgentMap } from '../hooks/useCalls';
import { useAuth } from '../contexts/AuthContext';
import CallsTable from '../components/CallsTable';
import CallTicketModal from '../components/CallTicketModal';
import InitiateCallModal from '../components/InitiateCallModal';
import * as XLSX from 'xlsx';
import Pagination from '../components/Pagination';

const API = import.meta.env.VITE_API_URL ?? '';

const STATUS_TABS = [
  { value: '',         label: 'All'      },
  { value: 'received', label: 'Received' },
  { value: 'missed',   label: 'Missed'   },
];

export default function CallReport() {
  const [search,      setSearch]      = useState('');
  const [status,      setStatus]      = useState('');
  const [page,        setPage]        = useState(1);
  const [dateFrom,    setDateFrom]    = useState('');
  const [dateTo,      setDateTo]      = useState('');
  const [agentNumber, setAgentNumber] = useState('');
  const [sortBy,      setSortBy]      = useState('created_at');
  const [sortDir,     setSortDir]     = useState('desc');
  const [ticketCall,  setTicketCall]  = useState(null);
  const [showDial,    setShowDial]    = useState(false);
  const [exporting,   setExporting]   = useState(false);
  const [agents,      setAgents]      = useState([]);
  const [pageSize,    setPageSize]    = useState(25);
  const { token, isAdmin, user } = useAuth();
  const { minDate, maxDate }    = useDateRange(token);
  const agentMap                = useAgentMap(token, isAdmin);

  // Fetch agent list for admin dropdown
  useEffect(() => {
    if (!isAdmin || !token) return;
    fetch(`${API}/api/agents`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setAgents(data.agents ?? []))
      .catch(() => {});
  }, [isAdmin, token]);

  // effectiveFrom uses the oldest call date as default lower bound.
  // effectiveTo is intentionally left empty when no user filter is set so that
  // new webhook arrivals are never hidden by a stale upper-date ceiling.
  const effectiveFrom = dateFrom || minDate;
  const effectiveTo   = dateTo   || maxDate;
  const isFiltered    = !!(dateFrom || dateTo);

  const { calls, total, loading, error, refetch } = useCalls({ search, status, page, pageSize, token, dateFrom: effectiveFrom, dateTo: effectiveTo, agentNumber, sortBy, sortDir });
  function handleSearch(e) { setSearch(e.target.value); setPage(1); }
  function handleStatus(val) { setStatus(val); setPage(1); }
  function handleDateFrom(e) {
    const val = e.target.value;
    setDateFrom(val);
    if (effectiveTo && val > effectiveTo) setDateTo(val);
    setPage(1);
  }
  function handleDateTo(e) {
    const val = e.target.value;
    setDateTo(val);
    if (effectiveFrom && val < effectiveFrom) setDateFrom(val);
    setPage(1);
  }
  function clearDates() { setDateFrom(''); setDateTo(''); setAgentNumber(''); setPage(1); }

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (search)        params.append('search',      search);
      if (status)        params.append('status',      status);
      if (effectiveFrom) params.append('dateFrom',    `${effectiveFrom}T00:00`);
      if (effectiveTo)   params.append('dateTo',      `${effectiveTo}T23:59`);
      if (agentNumber)   params.append('agentNumber', agentNumber);

      const res  = await fetch(`${API}/api/calls/export?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();

      const ws = XLSX.utils.json_to_sheet(data.rows);
      const headers = Object.keys(data.rows[0] || {});
      ws['!cols'] = headers.map(h => ({ wch: ['Summary', 'Bug Description', 'Transcription'].includes(h) ? 60 : (['Call ID', 'Recording URL'].includes(h) ? 30 : 18) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Call Report');

      const fileName = `call-report-${effectiveFrom || 'all'}-to-${effectiveTo || 'all'}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      alert(`Export failed: ${e.message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {ticketCall && (
        <CallTicketModal
          call={ticketCall}
          onClose={() => setTicketCall(null)}
        />
      )}
      {showDial && (
        <InitiateCallModal
          onClose={() => setShowDial(false)}
          onSuccess={refetch}
          defaultAgentNumber={!isAdmin ? user?.agent_number : ''}
        />
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Call Report</h1>
          <p className="text-sm text-slate-500 dark:text-zinc-500 mt-0.5">
            {total} total records · auto-refreshes every 5s
          </p>
        </div>
        <div className="flex gap-2 self-start">
          <button
            onClick={refetch}
            title="Refresh"
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8a5.5 5.5 0 11-1.1-3.3"/><path d="M13.5 2v3h-3"/>
            </svg>
          </button>
          <button
            onClick={() => setShowDial(true)}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            Initiate Call
          </button>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-zinc-500 pointer-events-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6.5" cy="6.5" r="4.5"/><path d="M10.5 10.5l3 3"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={handleSearch}
            placeholder="Search caller, called, agent…"
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        {isAdmin && agents.length > 0 && (
          <select
            value={agentNumber}
            onChange={e => { setAgentNumber(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="">All Agents</option>
            {agents.map(a => (
              <option key={a.id} value={a.agent_number}>{a.name} ({a.agent_number})</option>
            ))}
          </select>
        )}
        <div className="flex gap-1 bg-slate-100 dark:bg-zinc-800/60 rounded-lg p-1">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => handleStatus(tab.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                status === tab.value
                  ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-zinc-100 shadow-sm'
                  : 'text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <svg className="w-4 h-4 text-slate-400 dark:text-zinc-500 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5 1v4M11 1v4M2 7h12"/></svg>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">From</label>
          <input
            type="date"
            value={effectiveFrom}
            max={effectiveTo}
            onChange={handleDateFrom}
            className="px-2 py-1.5 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">To</label>
          <input
            type="date"
            value={effectiveTo}
            min={effectiveFrom}
            onChange={handleDateTo}
            className="px-2 py-1.5 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        {isFiltered && (
          <button
            onClick={clearDates}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-600 text-xs text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
          >
            Reset
          </button>
        )}
        {isFiltered && (
          <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Filtered</span>
        )}
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-medium transition-colors disabled:opacity-50 shrink-0 ml-auto"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1"/>
          </svg>
          {exporting ? 'Exporting…' : 'Export XLSX'}
        </button>
      </div>

      {/* Table */}
      {error ? (
        <div className="text-center py-16 text-red-500 dark:text-red-400">
          <p className="text-lg font-medium">Failed to connect to backend</p>
          <p className="text-sm mt-1 text-slate-500 dark:text-zinc-500">{error}</p>
        </div>
      ) : loading && calls.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-400 dark:text-zinc-500">Loading calls...</p>
        </div>
      ) : (
        <CallsTable
          key={`${search}|${status}|${page}|${dateFrom}|${dateTo}|${agentNumber}`}
          calls={calls}
          hasFilters={!!(search || status)}
          isAgent={!isAdmin}
          agentNumber={user?.agent_number}
          agentMap={agentMap}
          token={token}
          onCreateTicket={call => setTicketCall(call)}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={toggleSort}
        />
      )}

      {/* Pagination */}
      {!error && (
        <Pagination
          page={page} pageSize={pageSize} total={total}
          onPageChange={setPage} onPageSizeChange={setPageSize}
        />
      )}
    </div>
  );
}

