export default function ExportButton({ exporting, label, onClick, children = 'Export CSV', className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={exporting}
      aria-busy={exporting}
      className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all shrink-0 overflow-hidden ${
        exporting
          ? 'border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/30 cursor-wait'
          : 'border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
      } ${className}`}
    >
      {exporting && (
        <span
          className="absolute inset-0 pointer-events-none bg-linear-to-r from-transparent via-emerald-300/40 dark:via-emerald-500/25 to-transparent animate-export-shimmer"
          aria-hidden
        />
      )}
      <span className="relative flex items-center gap-1.5">
        {exporting ? (
          <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M8 1.5a6.5 6.5 0 106.5 6.5" opacity="0.9" />
            <path d="M8 1.5a6.5 6.5 0 01.001 13" opacity="0.25" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1" />
          </svg>
        )}
        {exporting ? (label || 'Exporting...') : children}
      </span>
    </button>
  );
}
