import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL ?? '';

const STATUS_LABEL = {
  pending:    { text: 'Queued for analysis',  cls: 'text-amber-500 dark:text-amber-400'  },
  processing: { text: 'Analysis in progress…',cls: 'text-indigo-500 dark:text-indigo-400' },
  failed:     { text: 'Analysis failed',      cls: 'text-red-500 dark:text-red-400'       },
  completed:  { text: null, cls: '' },
};

export default function TranscriptionModal({ call, token, onClose }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!call?.call_id) { setLoading(false); return; }

    let cancelled = false;
    let pollTimer = null;

    async function fetchAnalysis() {
      try {
        const r = await fetch(`${API}/api/analysis/${call.call_id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (cancelled) return;

        if (r.status === 404) {
          setAnalysis({ status: 'not_found' });
          setLoading(false);
          return;
        }

        const data = await r.json();
        setAnalysis(data);
        setLoading(false);

        // Keep polling while still processing
        if (data.status === 'pending' || data.status === 'processing') {
          pollTimer = setTimeout(fetchAnalysis, 5000);
        }
      } catch {
        if (!cancelled) {
          setAnalysis({ status: 'not_found' });
          setLoading(false);
        }
      }
    }

    fetchAnalysis();
    return () => { cancelled = true; clearTimeout(pollTimer); };
  }, [call?.call_id]);

  const status = analysis?.status;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-zinc-700">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100">Call Transcription</h2>
            {call.call_id && (
              <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">ID: {call.call_id}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 dark:text-zinc-500 hover:bg-slate-100 dark:hover:bg-zinc-800 hover:text-slate-600 dark:hover:text-zinc-300 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 3l10 10M13 3L3 13"/>
            </svg>
          </button>
        </div>

        {/* ── Call meta ── */}
        <div className="px-5 py-3 border-b border-slate-100 dark:border-zinc-800 flex flex-wrap gap-4 text-xs text-slate-500 dark:text-zinc-400">
          {call.caller_number && <span>From: <span className="font-medium text-slate-700 dark:text-zinc-200">{call.caller_number}</span></span>}
          {call.called_number  && <span>To: <span className="font-medium text-slate-700 dark:text-zinc-200">{call.called_number}</span></span>}
          {call.agent_name     && <span>Agent: <span className="font-medium text-slate-700 dark:text-zinc-200">{call.agent_name}</span></span>}
          {analysis?.status === 'completed' && analysis.language?.length > 0 && (
            <span>Language: <span className="font-medium text-slate-700 dark:text-zinc-200">{analysis.language.join(', ')}</span></span>
          )}
        </div>

        {/* ── AI result pills (category / sub-category / summary / ai_insight) ── */}
        {status === 'completed' && (
          <div className="px-5 py-3 border-b border-slate-100 dark:border-zinc-800 space-y-3">
            <div className="flex flex-wrap gap-2">
              {analysis.category && (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                  {analysis.category}
                </span>
              )}
              {analysis.sub_category && (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                  {analysis.sub_category}
                </span>
              )}
            </div>
            {analysis.summary && analysis.summary !== 'N/A' && (
              <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">{analysis.summary}</p>
            )}
            {/* Metric row: Resolved · Agent Score · Audio Quality */}
            <div className="flex flex-wrap gap-2">
              {analysis.call_resolved && (() => {
                const map = { Yes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', Partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', No: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
                return <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${map[analysis.call_resolved] ?? map.No}`}>Resolved: {analysis.call_resolved}</span>;
              })()}
              {analysis.agent_score !== null && analysis.agent_score !== undefined && (() => {
                const color = analysis.agent_score >= 8 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : analysis.agent_score >= 5 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
                return <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>Agent Score: {analysis.agent_score}/10</span>;
              })()}
              {analysis.audio_quality?.rating && (() => {
                const map = { Good: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', Moderate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', Poor: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
                const issues = analysis.audio_quality.issues && analysis.audio_quality.issues !== '-' ? ` · ${analysis.audio_quality.issues}` : '';
                return <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${map[analysis.audio_quality.rating] ?? map.Moderate}`}>Audio: {analysis.audio_quality.rating}{issues}</span>;
              })()}
            </div>

            {analysis.ai_insight && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2.5">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">AI Insight</p>
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">{analysis.ai_insight}</p>
              </div>
            )}
            {analysis.bugs && analysis.bugs !== '-' && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2.5">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">Bug Detected</p>
                <p className="text-xs text-red-800 dark:text-red-300 leading-relaxed">{analysis.bugs}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center h-40 gap-3 text-slate-400 dark:text-zinc-500">
              <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/>
              </svg>
              <span className="text-sm">Loading…</span>
            </div>
          )}

          {/* Not found / no recording */}
          {!loading && (status === 'not_found' || !status) && (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-400 dark:text-zinc-500">
              <svg className="w-8 h-8 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 18.5a6.5 6.5 0 100-13 6.5 6.5 0 000 13z"/>
                <path d="M9.5 10a2.5 2.5 0 015 0v2a2.5 2.5 0 01-5 0v-2z"/>
                <path d="M12 15v3M8 18h8"/>
              </svg>
              <p className="text-sm">No analysis available for this call.</p>
              {!call.call_recording && (
                <p className="text-xs">No recording URL on file.</p>
              )}
            </div>
          )}

          {/* Pending / processing */}
          {!loading && (status === 'pending' || status === 'processing') && (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-slate-400 dark:text-zinc-500">
              <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/>
              </svg>
              <p className={`text-sm font-medium ${STATUS_LABEL[status]?.cls}`}>
                {STATUS_LABEL[status]?.text}
              </p>
              <p className="text-xs">This page will update automatically.</p>
            </div>
          )}

          {/* Failed */}
          {!loading && status === 'failed' && (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <svg className="w-8 h-8 text-red-400 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 8v4M12 16h.01"/>
              </svg>
              <p className="text-sm font-medium text-red-500 dark:text-red-400">Analysis failed</p>
              {analysis.error && (
                <p className="text-xs text-slate-400 dark:text-zinc-500 text-center max-w-sm">{analysis.error}</p>
              )}
            </div>
          )}

          {/* Completed — transcription */}
          {!loading && status === 'completed' && (
            analysis.transcription && analysis.transcription !== 'N/A' ? (
              <p className="text-sm text-slate-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap font-mono">
                {analysis.transcription}
              </p>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-400 dark:text-zinc-500">
                <p className="text-sm">No transcription text returned by AI.</p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
