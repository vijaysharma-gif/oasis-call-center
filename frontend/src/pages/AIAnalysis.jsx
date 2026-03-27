import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDateRange, useAgentMap } from '../hooks/useCalls';
import TranscriptionModal from '../components/TranscriptionModal';
import * as XLSX from 'xlsx';
import Pagination from '../components/Pagination';

const API = import.meta.env.VITE_API_URL ?? '';

function formatDate(str) {
  if (!str) return '—';
  try { return new Date(str).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return str; }
}

function formatDuration(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const CATEGORY_COLORS = [
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
];

function useCategoryColor(category, categories) {
  const idx = categories.indexOf(category);
  return CATEGORY_COLORS[(idx >= 0 ? idx : 0) % CATEGORY_COLORS.length];
}

export default function AIAnalysis() {
  const { token, isAdmin, user } = useAuth();
  const { minDate, maxDate } = useDateRange(token);
  const agentMap = useAgentMap(token, isAdmin);

  const [analyses,    setAnalyses]    = useState([]);
  const [total,       setTotal]       = useState(0);
  const [categories,  setCategories]  = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [page,        setPage]        = useState(1);
  const [pageSize,    setPageSize]    = useState(25);
  const [search,      setSearch]      = useState('');
  const [category,    setCategory]    = useState('');
  const [dateFrom,    setDateFrom]    = useState('');
  const [dateTo,      setDateTo]      = useState('');
  const [selected,    setSelected]    = useState(null);
  const [exporting,   setExporting]   = useState(false);
  const [sortBy,      setSortBy]      = useState('created_at');
  const [sortDir,     setSortDir]     = useState('desc');
  // Agent-only: map of call_id → tickets[]
  const [ticketMap,   setTicketMap]   = useState({});

  const effectiveFrom = dateFrom || minDate;
  const effectiveTo   = dateTo   || maxDate;
  const isDateFiltered = !!(dateFrom || dateTo);

  // For agents: fetch tickets keyed by call_id whenever analysis rows change
  useEffect(() => {
    if (isAdmin || analyses.length === 0) return;
    fetch(`${API}/api/tickets?limit=200&offset=0&agentNumber=${encodeURIComponent(user?.agent_number ?? '')}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        const map = {};
        for (const t of data.tickets ?? []) {
          if (t.call_id) {
            if (!map[t.call_id]) map[t.call_id] = [];
            map[t.call_id].push(t);
          }
        }
        setTicketMap(map);
      })
      .catch(() => {});
  }, [isAdmin, analyses, token, user?.agent_number]);

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
    setPage(1);
  }

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: pageSize, offset: (page - 1) * pageSize, sortBy, sortDir });
      if (search)        params.append('search',   search);
      if (category)      params.append('category', category);
      if (effectiveFrom) params.append('dateFrom', `${effectiveFrom}T00:00`);
      if (effectiveTo)   params.append('dateTo',   `${effectiveTo}T23:59`);

      const res  = await fetch(`${API}/api/analysis?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to load'); return; }
      setAnalyses(data.analyses ?? []);
      setTotal(data.total ?? 0);
      if (data.categories?.length) setCategories(data.categories);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, page, pageSize, search, category, effectiveFrom, effectiveTo, sortBy, sortDir]);

  useEffect(() => { load(); }, [load]);

  function clearFilters() { setSearch(''); setCategory(''); setDateFrom(''); setDateTo(''); setPage(1); }
  const isFiltered = !!(search || category || dateFrom || dateTo);

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ limit: 9999, offset: 0 });
      if (search)        params.append('search',   search);
      if (category)      params.append('category', category);
      if (effectiveFrom) params.append('dateFrom', `${effectiveFrom}T00:00`);
      if (effectiveTo)   params.append('dateTo',   `${effectiveTo}T23:59`);

      const res  = await fetch(`${API}/api/analysis?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      const rows = (data.analyses ?? []).map(a => ({
        'Call ID':       a.call_id,
        'Category':      a.category || '',
        'Sub-Category':  a.sub_category || '',
        'AI Insight':    a.ai_insight || '',
        'Summary':       a.summary || '',
        'Call Resolved': a.call_resolved || '',
        'Agent Score':   a.agent_score ?? '',
        'Audio Rating':  a.audio_quality?.rating || '',
        'Audio Issues':  a.audio_quality?.issues || '',
        'Bug':           a.bugs || '',
        'Language':      Array.isArray(a.language) ? a.language.join(', ') : (a.language || ''),
        'Caller':        a.call?.caller_number || '',
        'Agent Number':  a.call?.agent_number || '',
        'Duration (s)':  a.call?.duration ?? '',
        'Date':          a.call?.created_at ? new Date(a.call.created_at).toLocaleString('en-IN') : '',
      }));

      const ws  = XLSX.utils.json_to_sheet(rows);
      const wb  = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'AI Analysis');
      XLSX.writeFile(wb, `ai_analysis_${new Date().toISOString().slice(0,10)}.xlsx`);
    } catch (e) {
      console.error('Export failed', e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {selected && (
        <TranscriptionModal
          call={{ ...selected.call, call_id: selected.call_id }}
          token={token}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">AI Analysis</h1>
          <p className="text-sm text-slate-500 dark:text-zinc-500 mt-0.5">{total} analysed calls</p>
        </div>
        <button
          onClick={load}
          title="Refresh"
          className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors self-start"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13.5 8a5.5 5.5 0 11-1.1-3.3"/><path d="M13.5 2v3h-3"/>
          </svg>
        </button>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-zinc-500 pointer-events-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6.5" cy="6.5" r="4.5"/><path d="M10.5 10.5l3 3"/>
          </svg>
          <input
            type="text" value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search category, insight, call ID…"
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        {categories.length > 0 && (
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <svg className="w-4 h-4 text-slate-400 dark:text-zinc-500 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5 1v4M11 1v4M2 7h12"/></svg>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">From</label>
          <input
            type="date"
            value={effectiveFrom}
            max={effectiveTo}
            onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            className="px-2 py-1.5 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">To</label>
          <input
            type="date"
            value={effectiveTo}
            min={effectiveFrom}
            onChange={e => { setDateTo(e.target.value); setPage(1); }}
            className="px-2 py-1.5 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        {isDateFiltered && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-600 text-xs text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
          >
            Reset
          </button>
        )}
        {isDateFiltered && (
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

      {/* Content */}
      {error ? (
        <div className="text-center py-16 text-red-500 dark:text-red-400">
          <p className="text-lg font-medium">Failed to load</p>
          <p className="text-sm mt-1 text-slate-500 dark:text-zinc-500">{error}</p>
        </div>
      ) : loading ? (
        <div className="text-center py-16 text-slate-400 dark:text-zinc-500">Loading…</div>
      ) : analyses.length === 0 ? (
        <div className="text-center py-20 text-slate-400 dark:text-zinc-500">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-40" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z"/>
          </svg>
          <p className="text-sm font-medium">No analysed calls found</p>
          {isFiltered && <p className="text-xs mt-1">Try adjusting your filters.</p>}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 text-left text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Sub-Category</th>
                  {isAdmin ? (
                    <>
                      <th className="px-4 py-3 font-semibold">AI Insight</th>
                      <SortTh col="bugs" label="Bug" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                    </>
                  ) : (
                    <th className="px-4 py-3 font-semibold">Tickets</th>
                  )}
                  <SortTh col="call_resolved" label="Resolved" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh col="agent_score"   label="Score"    sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh col="audio_quality" label="Quality"  sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <th className="px-4 py-3 font-semibold">Caller</th>
                  {isAdmin && <th className="px-4 py-3 font-semibold">Agent</th>}
                  <th className="px-4 py-3 font-semibold">Duration</th>
                  <SortTh col="created_at" label="Date" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <th className="px-4 py-3 font-semibold w-10"></th>
                </tr>
              </thead>
              <tbody>
                {analyses.map(a => (
                  <AnalysisRow
                    key={a.call_id}
                    analysis={a}
                    categories={categories}
                    agentMap={agentMap}
                    isAdmin={isAdmin}
                    tickets={ticketMap[a.call_id] ?? []}
                    onView={() => setSelected(a)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <Pagination
            page={page} pageSize={pageSize} total={total}
            onPageChange={setPage} onPageSizeChange={setPageSize}
          />
        </>
      )}
    </div>
  );
}

function VerifiedIcon() {
  return (
    <svg title="Verified" className="w-3 h-3 text-indigo-500 shrink-0" viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.28 5.78a.75.75 0 00-1.06-1.06L7 8.94 5.78 7.72a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z" clipRule="evenodd"/>
    </svg>
  );
}

const STATUS_BADGE = {
  Open:        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'In Progress':'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  Resolved:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Closed:      'bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400',
};

function AnalysisRow({ analysis, categories, agentMap = {}, isAdmin, tickets = [], onView }) {
  const catColor = useCategoryColor(analysis.category, categories);
  const call = analysis.call;

  return (
    <tr className="border-t border-slate-100 dark:border-zinc-800/60 hover:bg-slate-50 dark:hover:bg-zinc-900/50 transition-colors">
      <td className="px-4 py-3 max-w-[160px]">
        <span title={analysis.category} className={`px-2.5 py-1 rounded-md text-xs font-medium block truncate ${catColor}`}>
          {analysis.category || '—'}
        </span>
      </td>
      <td className="px-4 py-3 max-w-[180px]">
        {analysis.sub_category
          ? <span title={analysis.sub_category} className="px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300 block truncate">{analysis.sub_category}</span>
          : <span className="text-slate-400 dark:text-zinc-500 text-xs">—</span>}
      </td>

      {isAdmin ? (
        <>
          <td className="px-4 py-3 text-xs max-w-[200px]">
            {analysis.ai_insight
              ? <span className="font-medium text-amber-700 dark:text-amber-400">{analysis.ai_insight}</span>
              : <span className="text-slate-400 dark:text-zinc-500">—</span>}
          </td>
          <td className="px-4 py-3 text-xs max-w-[180px]">
            {analysis.bugs && analysis.bugs !== '-'
              ? <span className="text-red-600 dark:text-red-400 font-medium">{analysis.bugs}</span>
              : <span className="text-slate-400 dark:text-zinc-500">—</span>}
          </td>
        </>
      ) : (
        <td className="px-4 py-3 max-w-[200px]">
          {tickets.length === 0 ? (
            <span className="text-slate-400 dark:text-zinc-500 text-xs">—</span>
          ) : (
            <div className="flex flex-col gap-1">
              {tickets.map(t => (
                <span key={t._id} title={t.title} className={`px-2 py-0.5 rounded-full text-xs font-medium truncate block ${STATUS_BADGE[t.status] ?? STATUS_BADGE.Open}`}>
                  {t.title}
                </span>
              ))}
            </div>
          )}
        </td>
      )}

      <td className="px-4 py-3">
        <ResolvedBadge value={analysis.call_resolved} />
      </td>
      <td className="px-4 py-3">
        <AgentScore score={analysis.agent_score} />
      </td>
      <td className="px-4 py-3">
        <AudioBadge quality={analysis.audio_quality} />
      </td>
      <td className="px-4 py-3 text-slate-600 dark:text-zinc-300 tabular-nums text-xs">
        {call?.caller_number || '—'}
      </td>
      {isAdmin && (
        <td className="px-4 py-3 text-slate-600 dark:text-zinc-300 text-xs">
          <span className="flex items-center gap-1">
            {agentMap[call?.agent_number] && <VerifiedIcon />}
            {agentMap[call?.agent_number] || call?.agent_name || call?.agent_number || '—'}
          </span>
        </td>
      )}
      <td className="px-4 py-3 text-slate-500 dark:text-zinc-400 tabular-nums text-xs">
        {formatDuration(call?.duration)}
      </td>
      <td className="px-4 py-3 text-slate-500 dark:text-zinc-400 text-xs whitespace-nowrap">
        {formatDate(call?.call_start_time || analysis.created_at)}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={onView}
          title="View Transcription"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="12" height="12" rx="2"/>
            <path d="M5 6h6M5 9h4"/>
          </svg>
        </button>
      </td>
    </tr>
  );
}

function ResolvedBadge({ value }) {
  if (!value) return <span className="text-slate-400 dark:text-zinc-500 text-xs">—</span>;
  const map = {
    Yes:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    Partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    No:      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${map[value] ?? map.No}`}>
      {value}
    </span>
  );
}

function AgentScore({ score }) {
  if (score === null || score === undefined) return <span className="text-slate-400 dark:text-zinc-500 text-xs">—</span>;
  const color =
    score >= 8 ? 'text-emerald-600 dark:text-emerald-400' :
    score >= 5 ? 'text-amber-600 dark:text-amber-400' :
                 'text-red-600 dark:text-red-400';
  return (
    <span className={`text-sm font-bold tabular-nums ${color}`}>
      {score}<span className="text-xs font-normal text-slate-400 dark:text-zinc-500">/10</span>
    </span>
  );
}

function AudioBadge({ quality }) {
  if (!quality?.rating) return <span className="text-slate-400 dark:text-zinc-500 text-xs">—</span>;
  const map = {
    Good:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    Moderate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    Poor:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  return (
    <span
      title={quality.issues && quality.issues !== '-' ? quality.issues : undefined}
      className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap cursor-default ${map[quality.rating] ?? map.Moderate}`}
    >
      {quality.rating}
    </span>
  );
}

function SortTh({ col, label, sortBy, sortDir, onSort }) {
  const active = sortBy === col;
  return (
    <th
      className="px-4 py-3 font-semibold cursor-pointer select-none hover:text-slate-700 dark:hover:text-zinc-200 transition-colors whitespace-nowrap"
      onClick={() => onSort(col)}
    >
      <span className="flex items-center gap-1">
        {label}
        {active ? (
          sortDir === 'desc'
            ? <svg className="w-3 h-3 text-indigo-500" viewBox="0 0 16 16" fill="currentColor"><path d="M8 11l-4-5h8l-4 5z"/></svg>
            : <svg className="w-3 h-3 text-indigo-500" viewBox="0 0 16 16" fill="currentColor"><path d="M8 5l4 5H4l4-5z"/></svg>
        ) : (
          <svg className="w-3 h-3 opacity-30" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3l3 4H5l3-4zm0 10l-3-4h6l-3 4z"/></svg>
        )}
      </span>
    </th>
  );
}
