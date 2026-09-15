/** Pure projection: never overwrite a user's original saved price. */
export function monitoredSavedDeal(saved: any, check: any, now = Date.now()) {
  if (saved?.fuente === 'manual_capture') {
    return {
      ...saved,
      id: saved.id,
      guardado_el: saved.guardado_el,
      ida_origen_destino: `${saved.origen}-${saved.destino}`,
      vuelta_origen_destino: `${saved.destino}-${saved.origen}`,
      saved_price_usd: Number(saved.precio_total_usd),
      tracking_status: 'Captura personal (sin seguimiento automático)',
      tracking_observed: false,
      tracking_stale: false,
    };
  }

  const candidate = check?.last_quote || (check?.outcome === 'observed' ? check.quote : null);
  const normalize = (s: unknown) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const matches = candidate && candidate.ida_origen_destino === `${saved.origen}-${saved.destino}`
    && candidate.ida_fecha === saved.ida_fecha && candidate.vuelta_fecha === saved.vuelta_fecha
    && Number(candidate.pasajeros) === Number(saved.pasajeros)
    && normalize(candidate.aerolinea) === normalize(saved.aerolinea)
    && candidate.vuelta_origen_destino === `${saved.destino}-${saved.origen}`
    && candidate.fuente === (saved.fuente === 'serpapi' ? 'google_flights' : saved.fuente)
    && candidate.cantidad_escalas != null && saved.cantidad_escalas != null
    && Number(candidate.cantidad_escalas) === Number(saved.cantidad_escalas)
    && (candidate.detalle_cotizacion?.paymentCondition || null) === (saved.detalle_cotizacion?.paymentCondition || null)
    && Number.isFinite(Number(candidate.precio_total_usd)) && Number(candidate.precio_total_usd) > 0;
  const observed = matches ? candidate : {};
  const observedAt = matches ? observed.detalle_cotizacion?.observedAt || check.last_observed_at || check.checked_at : null;
  const age = now - Date.parse(observedAt || '');
  const stale = !observedAt || age > 86400000 || age < -300000 || !Number.isFinite(age);
  const status = !check ? 'Pendiente de seguimiento' : check.outcome === 'blocked' ? 'Fuente en pausa'
    : check.outcome === 'error' || check.outcome === 'unverified' ? 'No se pudo verificar en la última consulta'
    : check.outcome === 'not_observed' ? 'No apareció en la última consulta; no confirma que se haya agotado'
    : stale ? 'Última cotización sin actualizar' : 'Cotización comparable actualizada';
  return { ...saved, ...observed, id: saved.id, guardado_el: saved.guardado_el,
    ida_origen_destino: `${saved.origen}-${saved.destino}`, vuelta_origen_destino: `${saved.destino}-${saved.origen}`,
    saved_price_usd: Number(saved.precio_total_usd), tracking_status: status,
    tracking_observed: !!matches, tracking_stale: stale, tracking_event_id: check?.event_id };
}

export function meaningfulDrop(saved: any, check: any, now = Date.now()): boolean {
  if (saved?.fuente === 'manual_capture') return false;
  const projected = monitoredSavedDeal(saved, check, now);
  const reduction = Number(saved.precio_total_usd) - Number(projected.precio_total_usd);
  return check?.outcome === 'observed' && projected.tracking_observed && !projected.tracking_stale
    && reduction >= 50 && reduction >= Number(saved.precio_total_usd) * .05;
}
