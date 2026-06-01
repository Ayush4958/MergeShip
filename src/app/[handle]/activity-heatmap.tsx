'use client';

import { useMemo } from 'react';

type ActivityHeatmapProps = {
  data: { date: string; count: number }[];
};

export function ActivityHeatmap({ data }: ActivityHeatmapProps) {
  // Generate last 90 days
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = [];

    // Create map for fast lookup
    const countsMap = new Map(data.map((d) => [d.date, d.count]));

    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0]!;
      result.push({
        date: dateStr,
        count: countsMap.get(dateStr) || 0,
      });
    }
    return result;
  }, [data]);

  // Weeks for grid (approx 13 weeks for 90 days)
  const weeks = useMemo(() => {
    const w = [];
    for (let i = 0; i < days.length; i += 7) {
      w.push(days.slice(i, i + 7));
    }
    return w;
  }, [days]);

  const getColor = (count: number) => {
    if (count === 0) return 'bg-[#161b22] border-[#21262d]';
    if (count <= 2) return 'bg-emerald-900 border-emerald-800';
    if (count <= 5) return 'bg-emerald-700 border-emerald-600';
    if (count <= 8) return 'bg-emerald-500 border-emerald-400';
    return 'bg-emerald-400 border-emerald-300';
  };

  return (
    <div className="mt-8 border border-[#21262d] bg-[#161b22] p-4">
      <h2 className="mb-4 text-[11px] uppercase tracking-widest text-zinc-500">90-Day Activity</h2>

      <div className="flex gap-1 overflow-x-auto pb-2">
        {weeks.map((week, wIdx) => (
          <div key={wIdx} className="flex flex-col gap-1">
            {week.map((day) => (
              <div
                key={day.date}
                title={`${day.count} activities on ${day.date}`}
                className={`h-3 w-3 rounded-sm border ${getColor(day.count)} transition-colors hover:border-zinc-300`}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
        <span>Less</span>
        <div className="flex gap-1">
          <div className="h-3 w-3 rounded-sm border border-[#21262d] bg-[#161b22]" />
          <div className="h-3 w-3 rounded-sm border border-emerald-800 bg-emerald-900" />
          <div className="h-3 w-3 rounded-sm border border-emerald-600 bg-emerald-700" />
          <div className="h-3 w-3 rounded-sm border border-emerald-400 bg-emerald-500" />
          <div className="h-3 w-3 rounded-sm border border-emerald-300 bg-emerald-400" />
        </div>
        <span>More</span>
      </div>
    </div>
  );
}
