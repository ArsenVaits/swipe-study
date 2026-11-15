/**
 * Puts the lessons of a series at the top of the feed, in plan order, keeping every other entry
 * after them. `order` lists the series' ids in plan order; `fresh` holds entries not in `previous` yet.
 */
export function placeSeries<T extends { id: string }>(previous: T[], order: string[], fresh: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of [...previous, ...fresh]) byId.set(item.id, item);
  const inSeries = new Set(order);
  const series = order.map((id) => byId.get(id)).filter((item): item is T => !!item);
  return [...series, ...previous.filter((item) => !inSeries.has(item.id))];
}
