/** Apply this before each radar's hard filters; never override a human rejection or pending review. */
export function feedCandidate(deal: any): boolean {
  return deal.estado_aprobacion === 'aprobado'
    || (deal.estado_aprobacion === 'no_aplica' && deal.detalle_cotizacion?.budgetScope === 'radar')
    || (Boolean(deal.es_oportunidad_oro) && !['pendiente', 'rechazado'].includes(deal.estado_aprobacion));
}

/** A later verified observation supersedes older prices, including a rise above budget. */
export function latestQuotes(deals: any[]): any[] {
  const normalize = (value: unknown) => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const selected = new Map<string, any>();
  for (const deal of deals) {
    const key = JSON.stringify([deal.ida_origen_destino, deal.vuelta_origen_destino, deal.ida_fecha, deal.vuelta_fecha,
      deal.pasajeros, normalize(deal.aerolinea), deal.cantidad_escalas, deal.fuente,
      deal.detalle_cotizacion?.paymentCondition || null]);
    const previous = selected.get(key);
    const observed = (d: any) => Date.parse(d.detalle_cotizacion?.observedAt || d.created_at || '') || 0;
    if (!previous || observed(deal) > observed(previous)
      || (observed(deal) === observed(previous) && Number(deal.precio_total_usd) < Number(previous.precio_total_usd))) selected.set(key, deal);
  }
  return [...selected.values()].sort((a, b) => Number(a.precio_total_usd) - Number(b.precio_total_usd));
}
