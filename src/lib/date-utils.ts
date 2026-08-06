/** Determine date category for a timestamp in milliseconds */
export function getDateCategory(ms: number): 'today' | 'yesterday' | 'thisWeek' | 'earlier' {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;

  // Calculate start of current week (Monday)
  const dayOfWeek = now.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = todayStart - daysToMonday * 86400000;

  if (ms >= todayStart) return 'today';
  if (ms >= yesterdayStart) return 'yesterday';
  if (ms >= weekStart) return 'thisWeek';
  return 'earlier';
}
