export default function StatsBar({ stats }) {
  if (!stats) return null;

  const cards = [
    { label: 'Total Calls',    value: stats.total,              color: 'text-indigo-600 dark:text-indigo-400' },
    { label: "Today's Calls",  value: stats.today,              color: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'With Recording', value: stats.recorded,           color: 'text-sky-600 dark:text-sky-400' },
    { label: 'Avg Duration',   value: `${stats.avgDuration}s`,  color: 'text-violet-600 dark:text-violet-400' },
    { label: 'Avg Agent Duration', value: `${stats.avgAgentDuration}s`, color: 'text-amber-600 dark:text-amber-400' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      {cards.map(({ label, value, color }) => (
        <div key={label} className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl px-4 py-3 transition-colors">
          <p className="text-xs text-slate-500 dark:text-zinc-500 mb-0.5 uppercase tracking-wide">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}
