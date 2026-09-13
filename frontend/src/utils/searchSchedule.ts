/** UTC hours mirror agent-hunt.yml; an offline test prevents countdown drift. */
export const SEARCH_HOURS_UTC = [9, 21] as const;
export function nextSearchAt(now = new Date()): Date {
  for (const hour of SEARCH_HOURS_UTC) {
    const next = new Date(now);
    next.setUTCHours(hour, 0, 0, 0);
    if (next > now) return next;
  }
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(SEARCH_HOURS_UTC[0], 0, 0, 0);
  return next;
}
export function scheduleLabel(timeZone?: string): string {
  const formatter = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
  return SEARCH_HOURS_UTC.map(hour => {
    const date = new Date(); date.setUTCHours(hour, 0, 0, 0); return formatter.format(date);
  }).join(' y ');
}
